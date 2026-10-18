"""Round-three toll plaza / bridge props for Late Roadster, built from references.

Usage (from the repository root):
  /opt/homebrew/bin/blender -b -P tools/blender/r3/toll_bridge.py -- --asset all
  /opt/homebrew/bin/blender -b -P tools/blender/r3/toll_bridge.py -- --asset bridge_lamp
  /opt/homebrew/bin/blender -b -P tools/blender/r3/toll_bridge.py -- --asset toll_canopy --no-preview
  python3 tools/blender/r3/toll_bridge.py --asset textures
  python3 tools/blender/r3/toll_bridge.py --verify
  /opt/homebrew/bin/blender -b -P tools/blender/r3/toll_bridge.py -- --reimport
  python3 tools/blender/r3/toll_bridge.py --sheets

Blender 4.5+, external Python 3 with Pillow/numpy. Each model starts from an empty
factory scene. All geometry is procedural, in metres, Z up; mesh origins are at
ground-level footprint centres. Traffic runs along X; booth's photo faces -X,
lamp's single curved arm points +X, parapet repeats every 6 m along X. Canopy
approach boards face -X over -Y lanes and +X over +Y lanes. Roof clearance is
6.5 m; elevated 14 x 6 m boards start at z=7.5. Their remaining full-width
fascias are plain painted steel. The BR_03 reference has twin arms; the specified
single +X arm is reproduced here, not a second opposing arm.

Props embed <=1024-pixel PNG/JPEG textures. TG_01 is keyed using border-connected
near-white (not pure-white equality), alpha edge decontamination and colour
bleeding; its material exports alpha MASK. BR_02 uses two aligned vertical plate
periods, then opposite-edge feathering. BR_04 preserves the stair and feathers
only the left/right border. Seam measurements are taken AFTER decoding Q88 WebP.
Only assigned outputs are written; intermediary files live in /tmp/r3-toll_bridge.
"""

import argparse
import io
import json
import math
import shutil
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "research/raycity/generated/2026-10-17-round3"
OUT = ROOT / "public/assets/gen"
PHOTO = ROOT / "public/assets/photo"
PREVIEW = ROOT / "research/raycity/r3-assets/toll_bridge"
SCRATCH = Path("/tmp/r3-toll_bridge")
SCRIPT = Path(__file__).resolve()
ASSETS = ("toll_booth", "toll_canopy", "bridge_lamp", "bridge_parapet")
BUDGETS = dict(zip(ASSETS, (1500, 2500, 800, 1000)))


def external_python(*args):
    exe = shutil.which("python3") or "/opt/homebrew/bin/python3"
    subprocess.run([exe, str(SCRIPT), *args], check=True)


def seam_measure(image):
    import numpy as np

    a = np.asarray(image.convert("RGB"), dtype=np.float32)
    return {
        "LR": round(float(np.abs(a[:, 0] - a[:, -1]).mean()), 4),
        "neighbor_x": round(float(np.abs(np.diff(a, axis=1)).mean()), 4),
        "TB": round(float(np.abs(a[0] - a[-1]).mean()), 4),
        "neighbor_y": round(float(np.abs(np.diff(a, axis=0)).mean()), 4),
    }


def feather_opposite_edges(image, horizontal=True, vertical=False, band=48):
    """Small symmetric feather, preserving all pixels outside the border bands."""
    import numpy as np
    from PIL import Image

    a = np.asarray(image.convert("RGB"), dtype=np.float32).copy()
    for axis, enabled in [(1, horizontal), (0, vertical)]:
        if not enabled:
            continue
        for k in range(band):
            weight = 0.25 * (1 + math.cos(math.pi * k / band))
            if axis == 1:
                l, r = a[:, k].copy(), a[:, -1 - k].copy()
                a[:, k], a[:, -1 - k] = (
                    l * (1 - weight) + r * weight,
                    r * (1 - weight) + l * weight,
                )
            else:
                t, b = a[k].copy(), a[-1 - k].copy()
                a[k], a[-1 - k] = (
                    t * (1 - weight) + b * weight,
                    b * (1 - weight) + t * weight,
                )
    return Image.fromarray(np.uint8(np.clip(np.rint(a), 0, 255)))


def key_booth(image):
    """Flood-fill the #FEFEFE exterior; keep enclosed bright panel reflections."""
    import numpy as np
    from PIL import Image, ImageDraw, ImageFilter

    a = np.asarray(image.convert("RGB"), dtype=np.float32)
    candidate = (a.min(axis=2) >= 239) & ((a.max(axis=2) - a.min(axis=2)) < 20)
    flood = Image.fromarray(np.uint8(candidate) * 255)
    # Exterior is connected to the four corners; flood does not eat panel highlights.
    for xy in [
        (0, 0),
        (image.width - 1, 0),
        (0, image.height - 1),
        (image.width - 1, image.height - 1),
    ]:
        if flood.getpixel(xy) == 255:
            ImageDraw.floodfill(flood, xy, 128)
    bg = np.asarray(flood) == 128
    alpha = np.ones(a.shape[:2], dtype=np.float32)
    alpha[bg] = 0
    rim = (
        np.asarray(Image.fromarray(np.uint8(bg) * 255).filter(ImageFilter.MaxFilter(3)))
        > 0
    )
    edge = rim & ~bg
    coverage = np.clip((254 - a.min(axis=2)) / 32.0, 0.0, 1.0)
    alpha[edge] = coverage[edge]
    # Unmix the white backing on the anti-aliased contour, then bleed valid colour
    # outward three pixels so minification cannot produce a white halo.
    safe = np.maximum(alpha, 1 / 255.0)
    corrected = np.clip((a - 254 * (1 - alpha[..., None])) / safe[..., None], 0, 255)
    rgb = np.where(edge[..., None], corrected, a)
    known = alpha > 0.45
    for _ in range(3):
        rgb2, next_known = rgb.copy(), known.copy()
        for dy, dx in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
            near = np.roll(known, (dy, dx), (0, 1)) & ~next_known
            rgb2[near] = np.roll(rgb, (dy, dx), (0, 1))[near]
            next_known[near] = True
        rgb, known = rgb2, next_known
    rgba = np.dstack((rgb, alpha * 255))
    result = Image.fromarray(np.uint8(np.clip(np.rint(rgba), 0, 255)), "RGBA")
    result.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    return result


def prepare_images(asset="all"):
    from PIL import Image

    SCRATCH.mkdir(parents=True, exist_ok=True)
    PREVIEW.mkdir(parents=True, exist_ok=True)
    if asset in ("all", "toll_booth"):
        key_booth(Image.open(SOURCE / "TG_01.png")).save(SCRATCH / "TG_01_keyed.png")
    if asset in ("all", "toll_canopy"):
        im = Image.open(SOURCE / "TG_02.png").convert("RGB")
        im.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        im.save(SCRATCH / "TG_02_board.jpg", quality=94, subsampling=0)
    if asset in ("all", "bridge_lamp", "bridge_parapet"):
        # Galvanised pole patch, no background or white silhouette edge.
        metal = (
            Image.open(SOURCE / "BR_03.png").convert("RGB").crop((456, 610, 484, 1325))
        )
        metal = metal.resize((64, 512), Image.Resampling.LANCZOS)
        feather_opposite_edges(metal, True, True, 12).save(
            SCRATCH / "bridge_galvanised.jpg", quality=94
        )
    if asset in ("all", "bridge_parapet"):
        concrete = (
            Image.open(SOURCE / "BR_01.png").convert("RGB").crop((15, 370, 1901, 601))
        )
        concrete = concrete.resize((1024, 125), Image.Resampling.LANCZOS)
        feather_opposite_edges(concrete, True, False, 18).save(
            SCRATCH / "BR_01_concrete.jpg", quality=94
        )
    if asset in ("all", "textures"):
        PHOTO.mkdir(parents=True, exist_ok=True)
        results = {}
        for name in ("BR_02", "BR_04"):
            original = Image.open(SOURCE / (name + ".png")).convert("RGB")
            # Two matching panel periods, cutting below the corresponding dark
            # horizontal straps. This avoids blending a strap into a plain plate.
            crop = (
                (0, 151, 1254, 1239)
                if name == "BR_02"
                else (0, 0, original.width, original.height)
            )
            im = feather_opposite_edges(
                original.crop(crop),
                True,
                name == "BR_02",
                40 if name == "BR_02" else 64,
            )
            im.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
            path = PHOTO / (name + ".webp")
            im.save(path, format="WEBP", quality=88, method=6)
            decoded = Image.open(path).convert("RGB")
            results[name] = {
                "before": seam_measure(original),
                "after": seam_measure(decoded),
                "size": list(decoded.size),
                "crop_xyxy": list(crop),
                "file_bytes": path.stat().st_size,
                "mode": decoded.mode,
                "quality": 88,
                "tile_axes": "XY" if name == "BR_02" else "X",
            }
        (PREVIEW / "texture_seams.json").write_text(
            json.dumps(results, indent=2) + "\n"
        )
        print("SEAMS", json.dumps(results, indent=2))


def make_sheets():
    from PIL import Image, ImageDraw, ImageOps

    PREVIEW.mkdir(parents=True, exist_ok=True)

    def sheet(name, pairs, width=1000, rowheight=450):
        canvas = Image.new("RGB", (width, rowheight * len(pairs)), (248, 248, 247))
        draw = ImageDraw.Draw(canvas)
        for row, (left, right, label_l, label_r) in enumerate(pairs):
            for col, (im, label) in enumerate(((left, label_l), (right, label_r))):
                if isinstance(im, (str, Path)):
                    if not Path(im).exists():
                        continue
                    im = Image.open(im)
                if im.mode == "RGBA":
                    bg = Image.new("RGBA", im.size, (248, 248, 247, 255))
                    bg.alpha_composite(im)
                    im = bg.convert("RGB")
                im = ImageOps.contain(
                    im.convert("RGB"),
                    (width // 2 - 24, rowheight - 46),
                    Image.Resampling.LANCZOS,
                )
                x = col * (width // 2) + (width // 2 - im.width) // 2
                y = row * rowheight + 32 + (rowheight - 42 - im.height) // 2
                canvas.paste(im, (x, y))
                draw.text(
                    (col * width // 2 + 12, row * rowheight + 10),
                    label,
                    fill=(28, 35, 43),
                )
            draw.line(
                (
                    width // 2,
                    row * rowheight + 6,
                    width // 2,
                    (row + 1) * rowheight - 6,
                ),
                fill=(205, 210, 213),
            )
        canvas.save(PREVIEW / name)

    if (PREVIEW / "toll_booth_front.png").exists():
        sheet(
            "toll_booth_comparison.png",
            [
                (
                    SOURCE / "TG_01.png",
                    PREVIEW / "toll_booth_front.png",
                    "TG_01 reference | front",
                    "toll_booth_r3 | -X front",
                )
            ],
            rowheight=720,
        )
    if (PREVIEW / "toll_canopy_board.png").exists():
        sheet(
            "toll_canopy_comparison.png",
            [
                (
                    SOURCE / "TG_02.png",
                    PREVIEW / "toll_canopy_board.png",
                    "TG_02 reference | 21:9",
                    "-X board | 14 x 6 m, -Y lanes",
                ),
                (
                    PREVIEW / "toll_canopy_front.png",
                    PREVIEW / "toll_canopy_rear.png",
                    "-X approach | +X traffic on -Y",
                    "+X approach | -X traffic on +Y",
                ),
            ],
            rowheight=330,
        )
    if (PREVIEW / "bridge_lamp_side.png").exists():
        sheet(
            "bridge_lamp_comparison.png",
            [
                (
                    SOURCE / "BR_03.png",
                    PREVIEW / "bridge_lamp_side.png",
                    "BR_03 reference | twin arm",
                    "Specified single +X arm adaptation",
                )
            ],
            rowheight=800,
        )
    if (PREVIEW / "bridge_parapet_front.png").exists():
        sheet(
            "bridge_parapet_comparison.png",
            [
                (
                    SOURCE / "BR_01.png",
                    PREVIEW / "bridge_parapet_front.png",
                    "BR_01 reference | elevation",
                    "6 m segment | posts at 2 m centres",
                )
            ],
            rowheight=400,
        )
    for name in ("BR_02", "BR_04"):
        if not (PHOTO / (name + ".webp")).exists():
            continue
        tile = Image.open(PHOTO / (name + ".webp")).convert("RGB")
        tiled = Image.new(
            "RGB", (tile.width * 2, tile.height * (2 if name == "BR_02" else 1))
        )
        for x in range(2):
            for y in range(2 if name == "BR_02" else 1):
                tiled.paste(tile, (x * tile.width, y * tile.height))
        tiled.thumbnail((1000, 1000), Image.Resampling.LANCZOS)
        tiled.save(PREVIEW / (name + "_tiling.png"))
        sheet(
            name + "_comparison.png",
            [
                (
                    SOURCE / (name + ".png"),
                    tile,
                    name + " original",
                    name + " seamless Q88 WebP",
                )
            ],
            rowheight=500 if name == "BR_02" else 350,
        )
    print("COMPARISONS", PREVIEW)


def verify_glbs():
    """Parse actual exported GLB buffers, transforms, indices, images and materials."""
    import numpy as np
    from PIL import Image

    reports = {}
    for asset in ASSETS:
        path = OUT / (asset + "_r3.glb")
        if not path.exists():
            continue
        raw = path.read_bytes()
        magic, version, total = struct.unpack_from("<4sII", raw)
        assert magic == b"glTF" and version == 2 and total == len(raw)
        offset, doc, buf = 12, None, None
        while offset < len(raw):
            size, typ = struct.unpack_from("<I4s", raw, offset)
            offset += 8
            chunk = raw[offset : offset + size]
            offset += size
            if typ == b"JSON":
                doc = json.loads(chunk)
            if typ == b"BIN\0":
                buf = chunk

        def accessor(index):
            a = doc["accessors"][index]
            v = doc["bufferViews"][a["bufferView"]]
            dtype = {
                5120: "i1",
                5121: "u1",
                5122: "<i2",
                5123: "<u2",
                5125: "<u4",
                5126: "<f4",
            }[a["componentType"]]
            count = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[
                a["type"]
            ]
            start = v.get("byteOffset", 0) + a.get("byteOffset", 0)
            stride = v.get("byteStride", np.dtype(dtype).itemsize * count)
            return np.ndarray(
                (a["count"], count),
                dtype=dtype,
                buffer=buf,
                offset=start,
                strides=(stride, np.dtype(dtype).itemsize),
            ).copy()

        def local_matrix(node):
            if "matrix" in node:
                return np.asarray(node["matrix"], dtype=float).reshape(4, 4).T
            q = node.get("rotation", [0, 0, 0, 1])
            x, y, z, w = q
            r = np.array(
                [
                    [
                        1 - 2 * y * y - 2 * z * z,
                        2 * x * y - 2 * z * w,
                        2 * x * z + 2 * y * w,
                    ],
                    [
                        2 * x * y + 2 * z * w,
                        1 - 2 * x * x - 2 * z * z,
                        2 * y * z - 2 * x * w,
                    ],
                    [
                        2 * x * z - 2 * y * w,
                        2 * y * z + 2 * x * w,
                        1 - 2 * x * x - 2 * y * y,
                    ],
                ]
            )
            m = np.eye(4)
            m[:3, :3] = r @ np.diag(node.get("scale", [1, 1, 1]))
            m[:3, 3] = node.get("translation", [0, 0, 0])
            return m

        allpoints = []
        objects = []
        triangles = 0
        degenerates = 0
        unused = 0

        def visit(index, parent):
            nonlocal triangles, degenerates, unused
            node = doc["nodes"][index]
            world = parent @ local_matrix(node)
            if "mesh" in node:
                objects.append(node.get("name", str(index)))
                for p in doc["meshes"][node["mesh"]]["primitives"]:
                    assert p.get("mode", 4) == 4
                    v = accessor(p["attributes"]["POSITION"]).astype(float)
                    assert np.isfinite(v).all()
                    h = np.column_stack((v, np.ones(len(v))))
                    allpoints.append((h @ world.T)[:, :3])
                    ix = (
                        accessor(p["indices"]).reshape(-1).astype(int)
                        if "indices" in p
                        else np.arange(len(v))
                    )
                    assert len(ix) % 3 == 0 and ix.min() >= 0 and ix.max() < len(v)
                    unused += len(v) - len(np.unique(ix))
                    t = v[ix.reshape(-1, 3)]
                    area = np.linalg.norm(
                        np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1
                    )
                    degenerates += int((area < 1e-10).sum())
                    triangles += len(t)
                    if "NORMAL" in p["attributes"]:
                        normals = accessor(p["attributes"]["NORMAL"])
                        assert np.isfinite(normals).all() and np.allclose(
                            np.linalg.norm(normals, axis=1), 1, atol=0.015
                        )
            for child in node.get("children", []):
                visit(child, world)

        for n in doc["scenes"][doc.get("scene", 0)]["nodes"]:
            visit(n, np.eye(4))
        points = np.concatenate(allpoints)
        low = points.min(axis=0)
        high = points.max(axis=0)
        # glTF +Y up converts Blender (x,y,z) to (x,z,-y).
        bmin = [low[0], -high[2], low[1]]
        bmax = [high[0], -low[2], high[1]]
        dims = [bmax[i] - bmin[i] for i in range(3)]
        materials = [m.get("name", "unnamed") for m in doc.get("materials", [])]
        images = []
        for im in doc.get("images", []):
            assert "bufferView" in im, "Prop image must be embedded"
            v = doc["bufferViews"][im["bufferView"]]
            start = v.get("byteOffset", 0)
            image = Image.open(io.BytesIO(buf[start : start + v["byteLength"]]))
            assert max(image.size) <= 1024
            images.append(
                {
                    "name": im.get("name", ""),
                    "size": list(image.size),
                    "format": image.format,
                    "embedded": True,
                }
            )
        assert triangles <= BUDGETS[asset] and len(materials) <= 4
        assert abs(bmin[2]) < 0.0001 and degenerates == 0 and unused == 0
        if asset == "toll_booth":
            assert any(m.get("name") == "glass_booth" for m in doc["materials"])
            assert any(m.get("alphaMode") == "MASK" for m in doc["materials"])
        reports[asset] = {
            "path": str(path.relative_to(ROOT)),
            "dimensions_blender_xyz_m": [round(float(v), 4) for v in dims],
            "bbox_min_blender_m": [round(float(v), 4) for v in bmin],
            "bbox_max_blender_m": [round(float(v), 4) for v in bmax],
            "triangles": triangles,
            "triangle_budget": BUDGETS[asset],
            "objects": objects,
            "materials": materials,
            "alpha_modes": {
                m.get("name", ""): m.get("alphaMode", "OPAQUE")
                for m in doc["materials"]
            },
            "embedded_images": images,
            "bytes": len(raw),
            "file_KiB": round(len(raw) / 1024, 1),
            "degenerate_triangles": degenerates,
            "unreferenced_vertices": unused,
            "finite_unit_normals": True,
            "all_images_embedded": True,
        }
    PREVIEW.mkdir(parents=True, exist_ok=True)
    (PREVIEW / "verification.json").write_text(json.dumps(reports, indent=2) + "\n")
    print("VERIFIED", json.dumps(reports, indent=2))
    return reports


def reimport_verify():
    """Independent fresh-scene round trip, including outward closed-shell winding."""
    import bpy as fresh_bpy
    import bmesh

    expected = json.loads((PREVIEW / "verification.json").read_text())
    result = {}
    for asset in ASSETS:
        fresh_bpy.ops.wm.read_factory_settings(use_empty=True)
        fresh_bpy.ops.import_scene.gltf(filepath=str(OUT / (asset + "_r3.glb")))
        objects = [o for o in fresh_bpy.context.scene.objects if o.type == "MESH"]
        coords = [o.matrix_world @ v.co for o in objects for v in o.data.vertices]
        low = [min(v[i] for v in coords) for i in range(3)]
        high = [max(v[i] for v in coords) for i in range(3)]
        dims = [round(high[i] - low[i], 4) for i in range(3)]
        triangles = 0
        positive_shells, open_components, negative_shells = 0, 0, []
        for ob in objects:
            ob.data.calc_loop_triangles()
            triangles += len(ob.data.loop_triangles)
            assert ob.location.length < 1e-5 and all(
                abs(v - 1) < 1e-5 for v in ob.scale
            )
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
            unvisited = set(bm.faces)
            while unvisited:
                seed = unvisited.pop()
                component = {seed}
                pending = [seed]
                while pending:
                    f = pending.pop()
                    for edge in f.edges:
                        for adjacent in edge.link_faces:
                            if adjacent in unvisited:
                                unvisited.remove(adjacent)
                                component.add(adjacent)
                                pending.append(adjacent)
                edges = {e for f in component for e in f.edges}
                if all(len(e.link_faces) == 2 for e in edges):
                    volume = 0.0
                    for f in component:
                        verts = [v.co for v in f.verts]
                        for k in range(1, len(verts) - 1):
                            volume += verts[0].dot(verts[k].cross(verts[k + 1])) / 6
                    if volume < -1e-7:
                        negative_shells.append(round(volume, 8))
                    elif volume > 1e-9:
                        positive_shells += 1
                else:
                    open_components += 1
            bm.free()
        assert not negative_shells, (asset, negative_shells)
        assert triangles == expected[asset]["triangles"]
        assert dims == expected[asset]["dimensions_blender_xyz_m"]
        assert abs(low[2]) < 1e-5
        materials = sorted({m.name for ob in objects for m in ob.data.materials})
        assert materials == sorted(expected[asset]["materials"])
        result[asset] = {
            "dimensions_blender_xyz_m": dims,
            "triangles": triangles,
            "objects": [o.name for o in objects],
            "materials": materials,
            "images": [
                {"name": im.name, "size": list(im.size)}
                for im in fresh_bpy.data.images
                if im.type == "IMAGE"
            ],
            "positive_closed_shells": positive_shells,
            "inward_closed_shells": len(negative_shells),
            "open_or_intersecting_components": open_components,
            "identity_object_scale_ground_origin": True,
            "round_trip_matches_glb_parse": True,
        }
    (PREVIEW / "reimport_verification.json").write_text(
        json.dumps(result, indent=2) + "\n"
    )
    print("FRESH_REIMPORT", json.dumps(result, indent=2))


# Blender implementation is loaded lazily so the same reproducible script can
# use Pillow/numpy through the external Python installation.
bpy = None
Vector = None


class MeshBuilder:
    def __init__(self):
        self.vertices = []
        self.faces = []
        self.uvs = []
        self.face_mats = []
        self.smooth = []
        self.materials = []

    def face(self, coordinates, material, uvs=None, smooth=False):
        start = len(self.vertices)
        self.vertices.extend([tuple(p) for p in coordinates])
        self.faces.append(tuple(range(start, start + len(coordinates))))
        if material not in self.materials:
            self.materials.append(material)
        self.face_mats.append(self.materials.index(material))
        self.smooth.append(smooth)
        self.uvs.append(uvs or [(0, 0), (1, 0), (1, 1), (0, 1)][: len(coordinates)])

    def quad(self, a, b, c, d, material, uvs=None):
        self.face([a, b, c, d], material, uvs)

    def box(self, center, size, material, side_uv=None):
        x, y, z = center
        sx, sy, sz = [s * 0.5 for s in size]
        x0, x1 = x - sx, x + sx
        y0, y1 = y - sy, y + sy
        z0, z1 = z - sz, z + sz
        uv = side_uv or [(0, 0), (1, 0), (1, 1), (0, 1)]
        self.quad((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), material, uv)
        self.quad((x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1), material, uv)
        self.quad((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1), material)
        self.quad((x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1), material)
        self.quad(
            (x0, y0, z1),
            (x1, y0, z1),
            (x1, y1, z1),
            (x0, y1, z1),
            material,
            [(0, 0.85), (1, 0.85), (1, 1), (0, 1)],
        )
        self.quad((x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0), material)

    def tube(self, points, radii, material, sides=8, caps=True, uv_repeat=1):
        pts = [Vector(p) for p in points]
        rings = []
        for i, p in enumerate(pts):
            tangent = (pts[min(i + 1, len(pts) - 1)] - pts[max(0, i - 1)]).normalized()
            helper = Vector((0, 1, 0)) if abs(tangent.y) < 0.95 else Vector((1, 0, 0))
            a = (helper - tangent * helper.dot(tangent)).normalized()
            b = tangent.cross(a).normalized()
            r = radii[i] if isinstance(radii, (list, tuple)) else radii
            rings.append(
                [
                    p
                    + r
                    * (
                        math.cos(j * math.tau / sides) * a
                        + math.sin(j * math.tau / sides) * b
                    )
                    for j in range(sides)
                ]
            )
        for i in range(len(rings) - 1):
            for j in range(sides):
                k = (j + 1) % sides
                self.face(
                    [rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]],
                    material,
                    [
                        (j / sides, i / (len(rings) - 1) * uv_repeat),
                        ((j + 1) / sides, i / (len(rings) - 1) * uv_repeat),
                        ((j + 1) / sides, (i + 1) / (len(rings) - 1) * uv_repeat),
                        (j / sides, (i + 1) / (len(rings) - 1) * uv_repeat),
                    ],
                    True,
                )
        if caps:
            for ring, reverse in [(rings[0], True), (rings[-1], False)]:
                order = list(range(sides))
                order = order[::-1] if reverse else order
                self.face(
                    [ring[j] for j in order],
                    material,
                    [
                        (
                            0.5 + 0.5 * math.cos(j * math.tau / sides),
                            0.5 + 0.5 * math.sin(j * math.tau / sides),
                        )
                        for j in order
                    ],
                )

    def cylinder(self, a, b, r, material, sides=8):
        self.tube([a, b], r, material, sides)

    def finish(self, name):
        import bmesh

        mesh = bpy.data.meshes.new(name + "_mesh")
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.update()
        for m in self.materials:
            mesh.materials.append(m)
        uv = mesh.uv_layers.new(name="UVMap")
        for i, p in enumerate(mesh.polygons):
            p.material_index = self.face_mats[i]
            p.use_smooth = self.smooth[i]
            for li, uvco in zip(p.loop_indices, self.uvs[i]):
                uv.data[li].uv = uvco
        # Join coincident vertices, retaining per-loop UVs and flat/smooth intent.
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        return obj


def material(
    name,
    rgb=(0.6, 0.6, 0.6),
    rough=0.65,
    metal=0,
    image=None,
    mask=False,
    emission=None,
):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bs = m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (*rgb, 1)
    bs.inputs["Roughness"].default_value = rough
    bs.inputs["Metallic"].default_value = metal
    m.diffuse_color = (*rgb, 1)
    if image:
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(str(SCRATCH / image), check_existing=True)
        tex.image.pack()
        tex.interpolation = "Linear"
        tex.extension = "REPEAT"
        m.node_tree.links.new(tex.outputs["Color"], bs.inputs["Base Color"])
        if mask:
            clip = m.node_tree.nodes.new("ShaderNodeMath")
            clip.operation = "GREATER_THAN"
            clip.inputs[1].default_value = 0.5
            m.node_tree.links.new(tex.outputs["Alpha"], clip.inputs[0])
            m.node_tree.links.new(clip.outputs[0], bs.inputs["Alpha"])
            m.surface_render_method = "DITHERED"
            m.alpha_threshold = 0.5
    if emission:
        bs.inputs["Emission Color"].default_value = (*emission, 1)
        bs.inputs["Emission Strength"].default_value = 2.2
    m.use_backface_culling = True
    return m


def crop_uv(box, image_size=(1086, 1448)):
    x0, y0, x1, y1 = box
    w, h = image_size
    return [
        (x0 / w, 1 - y1 / h),
        (x1 / w, 1 - y1 / h),
        (x1 / w, 1 - y0 / h),
        (x0 / w, 1 - y0 / h),
    ]


def build_booth():
    b = MeshBuilder()
    white = material("booth_painted_white", (0.65, 0.68, 0.71), 0.6, 0.22)
    trim = material("booth_galvanised_frame", (0.28, 0.32, 0.35), 0.4, 0.65)
    glass = material("glass_booth", (0.055, 0.085, 0.105), 0.15, 0.65)
    photo = material(
        "booth_TG01_cutout", rough=0.85, image="TG_01_keyed.png", mask=True
    )
    b.box((0, 0, 0.10), (2.6, 1.70, 0.20), trim)
    b.box((0, 0, 0.69), (2.46, 1.64, 1.18), white)
    b.box((0, 0, 2.56), (2.46, 1.64, 0.32), white)
    b.box((0, 0, 2.845), (2.6, 1.80, 0.25), white)
    b.box((0, 0, 3.0 - 0.025), (2.55, 1.75, 0.05), trim)
    for x in (-1.20, 1.20):
        for y in (-0.79, 0.79):
            b.box((x, y, 1.49), (0.09, 0.09, 2.58), white)
    # Real side windows, opaque dark mirror-glass for the game's glass override.
    for y in (-0.823, 0.823):
        b.box((0, y, 1.87), (2.30, 0.018, 1.08), glass)
        for z in (1.30, 2.43):
            b.box((0, y, z), (2.40, 0.055, 0.055), trim)
        for x in (-1.17, 0, 1.17):
            b.box((x, y, 1.865), (0.055, 0.055, 1.075), white)
        b.box((0, y, 0.33), (0.035, 0.028, 0.30), trim)
        b.box((0, y, 1.22), (2.38, 0.035, 0.035), trim)
    # Plain back wall with a framed access door and its small upper window.
    b.box((1.238, 0, 1.48), (0.025, 1.55, 2.60), white)
    for y in (-0.45, 0.45):
        b.box((1.26, y, 1.29), (0.035, 0.025, 2.18), trim)
    b.box((1.26, 0, 2.37), (0.035, 0.92, 0.025), trim)
    b.box((1.264, 0, 1.91), (0.018, 0.76, 0.72), glass)
    b.box((1.29, 0.34, 1.19), (0.045, 0.04, 0.16), trim)
    # Photographic front is a keyed overlay, with exactly the house-style UV
    # ordering (bottom-left, bottom-right, top-right, top-left).
    b.quad(
        (-1.312, 0.9, 0),
        (-1.312, -0.9, 0),
        (-1.312, -0.9, 3),
        (-1.312, 0.9, 3),
        photo,
        crop_uv((116, 197, 970, 1414)),
    )
    b.cylinder((-1.21, 0, 2.97), (-1.21, 0, 3.095), 0.045, trim)
    b.box((-1.22, 0, 3.275), (0.18, 0.394, 0.42), trim)
    b.quad(
        (-1.313, 0.197, 3.065),
        (-1.313, -0.197, 3.065),
        (-1.313, -0.197, 3.485),
        (-1.313, 0.197, 3.485),
        photo,
        crop_uv((449, 21, 636, 193)),
    )
    obj = b.finish("toll_booth_r3")
    obj["photo_front"] = "-X"
    obj["footprint_m"] = [2.6, 1.8]
    obj["glass_override"] = "glass_booth"
    return obj


def build_canopy():
    b = MeshBuilder()
    white = material("canopy_painted_fascia", (0.72, 0.74, 0.75), 0.65, 0.12)
    steel = material("canopy_galvanised_structure", (0.31, 0.37, 0.41), 0.4, 0.7)
    board = material("canopy_TG02_board", rough=0.8, image="TG_02_board.jpg")
    light = material("light_canopy", (0.9, 0.88, 0.76), 0.5, emission=(1, 0.92, 0.72))
    b.box((0, 0, 7.0), (10, 32, 1), white)
    # Six columns: both roof ends, median and each outer verge. None in a lane.
    for x in (-3.75, 3.75):
        for y in (-15.8, 0, 15.8):
            b.box((x, y, 0.15), (0.58, 0.40, 0.30), steel)
            b.box((x, y, 3.40), (0.30, 0.30, 6.20), steel)
            b.box((x, y, 6.37), (0.60, 0.40, 0.26), steel)
        b.box((x, 0, 6.46), (0.32, 31.9, 0.08), steel)
    for y in (-15.75, 0, 15.75):
        b.box((0, y, 6.46), (9.4, 0.20, 0.08), steel)
    # Full-width, plain painted fascia except the one approach-specific TG board.
    for x in (-4.94, 4.94):
        b.box((x, 0, 10.5), (0.12, 32, 6), white)
        b.box((x, 0, 13.47), (0.16, 32, 0.06), steel)
        for y in (-15.95, 0, 15.95):
            b.box((x, y, 10.5), (0.18, 0.10, 6), steel)
        # Panel joins on the blank half only; the reference supplies board joins.
        signhalf = -1 if x < 0 else 1
        for y in (2, 4, 6, 8, 10, 12, 14):
            b.box(
                (x + signhalf * 0.065, -signhalf * y, 10.5), (0.012, 0.016, 5.90), steel
            )
    # -X: left of image = y=-1; +X: left of image = y=+1. No mirrored lettering.
    full = [(0, 0), (1, 0), (1, 1), (0, 1)]
    b.quad(
        (-5.055, -1, 7.5),
        (-5.055, -15, 7.5),
        (-5.055, -15, 13.5),
        (-5.055, -1, 13.5),
        board,
        full,
    )
    b.quad(
        (5.055, 1, 7.5),
        (5.055, 15, 7.5),
        (5.055, 15, 13.5),
        (5.055, 1, 13.5),
        board,
        full,
    )
    # A pair of slim luminaires per lane; positions are actual four-lane centres.
    for y in (-13.25, -9.75, -6.25, -2.75, 2.75, 6.25, 9.75, 13.25):
        for x in (-2.6, 2.6):
            b.box((x, y, 6.41), (1.6, 0.20, 0.12), steel)
            b.box((x, y, 6.343), (1.45, 0.145, 0.018), light)
    obj = b.finish("toll_canopy_r3")
    obj["traffic_axis"] = "X"
    obj["roof_underside_m"] = 6.5
    obj["roadway_width_m"] = 30
    obj["right_hand_traffic"] = "+X uses -Y half; -X uses +Y half"
    obj["approach_boards"] = "14x6 m: -X face y[-15,-1], +X face y[1,15], z[7.5,13.5]"
    obj["column_y_m"] = [-15.8, 0, 15.8]
    return obj


def build_lamp():
    b = MeshBuilder()
    metal = material(
        "bridge_galvanised", rough=0.58, metal=0.44, image="bridge_galvanised.jpg"
    )
    housing = material("lamp_dark_housing", (0.18, 0.21, 0.23), 0.5, 0.55)
    light = material("light_lamp", (0.90, 0.89, 0.75), 0.35, emission=(1, 0.93, 0.76))
    b.box((0, 0, 0.045), (0.80, 0.80, 0.09), metal)
    # Tapered pole, with small splice collars and reinforced base.
    b.tube(
        [(0, 0, 0.09), (0, 0, 0.55), (0, 0, 1.55), (0, 0, 6.65), (0, 0, 8.20)],
        [0.15, 0.125, 0.105, 0.085, 0.078],
        metal,
        10,
        uv_repeat=3,
    )
    for z, r in ((1.55, 0.116), (6.65, 0.094), (8.20, 0.087)):
        b.cylinder((0, 0, z - 0.018), (0, 0, z + 0.018), r, metal, 10)
    for x in (-0.31, 0.31):
        for y in (-0.31, 0.31):
            b.cylinder((x, y, 0.09), (x, y, 0.15), 0.027, metal, 6)
            b.cylinder((x, y, 0.15), (x, y, 0.18), 0.012, housing, 6)
    # Four small triangular foot gussets, each a closed triangular prism.
    for angle in (0, math.pi / 2, math.pi, math.pi * 1.5):
        ca, sa = math.cos(angle), math.sin(angle)

        def g(r, t, z):
            return (ca * r - sa * t, sa * r + ca * t, z)

        a, b0, c = g(0.12, -0.012, 0.10), g(0.31, -0.012, 0.10), g(0.12, -0.012, 0.57)
        d, e, f = g(0.12, 0.012, 0.10), g(0.31, 0.012, 0.10), g(0.12, 0.012, 0.57)
        b.face([a, b0, c], metal, [(0, 0), (1, 0), (0, 1)])
        b.face([d, f, e], metal, [(0, 0), (0, 1), (1, 0)])
        b.quad(a, d, e, b0, metal)
        b.quad(b0, e, f, c, metal)
        b.quad(c, f, d, a, metal)
    # Quarter-ellipse sweep: vertical tangent at the mast, horizontal at head.
    points = []
    for i in range(13):
        t = (math.pi / 2) * i / 12
        points.append((1.67 * (1 - math.cos(t)), 0, 8.20 + 1.55 * math.sin(t)))
    b.tube(points, [0.073 - i * 0.0017 for i in range(13)], metal, 8)
    b.cylinder((1.61, 0, 9.75), (1.76, 0, 9.75), 0.069, housing, 8)
    # Low-poly tapered luminaire, matching the shallow bevels of BR_03.
    lower = [
        (1.72, -0.13, 9.70),
        (2.37, -0.115, 9.70),
        (2.48, -0.08, 9.73),
        (2.48, 0.08, 9.73),
        (2.37, 0.115, 9.70),
        (1.72, 0.13, 9.70),
    ]
    middle = [
        (1.73, -0.19, 9.82),
        (2.36, -0.17, 9.83),
        (2.49, -0.115, 9.81),
        (2.49, 0.115, 9.81),
        (2.36, 0.17, 9.83),
        (1.73, 0.19, 9.82),
    ]
    upper = [
        (1.79, -0.14, 9.88),
        (2.32, -0.13, 9.91),
        (2.44, -0.075, 9.87),
        (2.44, 0.075, 9.87),
        (2.32, 0.13, 9.91),
        (1.79, 0.14, 9.88),
    ]
    for ring0, ring1 in ((lower, middle), (middle, upper)):
        for j in range(6):
            b.quad(ring0[j], ring0[(j + 1) % 6], ring1[(j + 1) % 6], ring1[j], housing)
    b.face(lower[::-1], housing, [(0, 0)] * 6)
    b.face(upper, housing, [(0, 0)] * 6)
    b.box((2.13, 0, 9.693), (0.53, 0.215, 0.016), light)
    # The lens rolls a little onto the lower bevel, as visible in the reference.
    b.quad(
        (1.83, -0.137, 9.71),
        (2.36, -0.124, 9.71),
        (2.36, -0.153, 9.77),
        (1.83, -0.166, 9.77),
        light,
    )
    obj = b.finish("bridge_lamp_r3")
    obj["forward_axis"] = "+X"
    obj["origin"] = "ground centre of base plate"
    obj["reference_adaptation"] = "Single +X arm from twin-arm BR_03"
    return obj


def build_parapet():
    b = MeshBuilder()
    concrete = material("concrete_BR01", rough=0.94, image="BR_01_concrete.jpg")
    metal = material(
        "bridge_galvanised", rough=0.5, metal=0.55, image="bridge_galvanised.jpg"
    )
    bolt = material("parapet_dark_bolts", (0.19, 0.22, 0.24), 0.5, 0.65)
    b.box((0, 0, 0.4), (6, 0.45, 0.8), concrete)
    # One-metre half bays at both ends: consecutive 6 m instances give a precise
    # 2 m post cadence with no overlapping end posts or protruding geometry.
    for x in (-2, 0, 2):
        b.box((x, 0, 0.815), (0.27, 0.23, 0.03), metal)
        b.box((x, 0, 1.09), (0.09, 0.09, 0.52), metal)
        for dx in (-0.09, 0.09):
            for dy in (-0.07, 0.07):
                b.cylinder((x + dx, dy, 0.83), (x + dx, dy, 0.86), 0.016, bolt, 6)
    for z in (1.055, 1.355):
        b.cylinder((-3, -0.007, z), (3, -0.007, z), 0.04, metal, 10)
    obj = b.finish("bridge_parapet_r3")
    obj["tile_axis"] = "X"
    obj["tile_length_m"] = 6
    obj["post_centres_x_m"] = [-2, 0, 2]
    obj["base_dimensions_xyz_m"] = [6, 0.45, 0.8]
    return obj


def render_views(asset, obj):
    from mathutils import Vector

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.render.resolution_percentage = 100
    scene.render.image_settings.compression = 40
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = 32
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = (
        "Medium High Contrast"
        if "Medium High Contrast"
        in [
            e.identifier
            for e in scene.view_settings.bl_rna.properties["look"].enum_items
        ]
        else "None"
    )
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    world = bpy.data.worlds.new("preview_world")
    world.use_nodes = True
    scene.world = world
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (
        0.78,
        0.83,
        0.9,
        1,
    )
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.65
    sun = bpy.data.lights.new("preview_sun", "SUN")
    sun.energy = 2.0
    sun.angle = 0.35
    so = bpy.data.objects.new("preview_sun", sun)
    scene.collection.objects.link(so)
    so.rotation_euler = (0.55, -0.45, -0.60)
    area = bpy.data.lights.new("preview_fill", "AREA")
    area.energy = 1500
    area.shape = "DISK"
    area.size = 9
    ao = bpy.data.objects.new("preview_fill", area)
    scene.collection.objects.link(ao)
    ao.location = (-8, -10, 12)
    if asset == "toll_canopy":
        # Keep the large softbox completely outside the 32 m structure.
        ao.location = (-35, -24, 30)
        area.size = 20
        area.energy = 3500
    ao.rotation_euler = (
        (Vector((0, 0, 2)) - ao.location).to_track_quat("-Z", "Y").to_euler()
    )
    ground = material("preview_only_ground", (0.88, 0.89, 0.9), 1)
    bpy.ops.mesh.primitive_plane_add(size=180, location=(0, 0, -0.012))
    floor = bpy.context.object
    floor.name = "preview_only_ground"
    floor.data.materials.append(ground)
    cam = bpy.data.cameras.new("preview_camera")
    co = bpy.data.objects.new("preview_camera", cam)
    scene.collection.objects.link(co)
    scene.camera = co
    cam.type = "ORTHO"
    cam.clip_end = 500

    def shot(name, location, target, scale, resolution, up="Y"):
        co.location = location
        co.rotation_euler = (
            (Vector(target) - co.location).to_track_quat("-Z", up).to_euler()
        )
        cam.ortho_scale = scale
        if name.endswith("_top"):
            co.rotation_euler = (0, 0, math.pi / 2)
        scene.render.resolution_x, scene.render.resolution_y = resolution
        scene.render.filepath = str(PREVIEW / (name + ".png"))
        bpy.ops.render.render(write_still=True)

    if asset == "toll_booth":
        shot("toll_booth_front", (-12, 0, 1.75), (0, 0, 1.75), 4.0, (700, 900))
        shot("toll_booth_side", (0, -12, 1.75), (0, 0, 1.75), 4.0, (800, 800))
        shot("toll_booth_threequarter", (-7, -7, 4.7), (0, 0, 1.65), 4.8, (900, 900))
    elif asset == "toll_canopy":
        shot("toll_canopy_front", (-60, 0, 6.75), (0, 0, 6.75), 35, (1000, 550))
        shot("toll_canopy_rear", (60, 0, 6.75), (0, 0, 6.75), 35, (1000, 550))
        shot("toll_canopy_threequarter", (-38, -40, 28), (0, 0, 6.5), 39, (1000, 700))
        shot("toll_canopy_top", (0, 0, 60), (0, 0, 0), 35, (1000, 600), up="X")
        shot("toll_canopy_board", (-25, -8, 10.5), (-5, -8, 10.5), 14.25, (1000, 450))
    elif asset == "bridge_lamp":
        shot("bridge_lamp_side", (1, -23, 5.0), (1, 0, 5.0), 10.8, (600, 1000))
        shot("bridge_lamp_threequarter", (13, -20, 10), (0.9, 0, 5), 11.2, (700, 1000))
        shot("bridge_lamp_head", (4, -4, 10.5), (1.8, 0, 9.5), 2.2, (900, 650))
    elif asset == "bridge_parapet":
        shot("bridge_parapet_front", (0, -12, 0.70), (0, 0, 0.70), 6.6, (1000, 350))
        shot(
            "bridge_parapet_threequarter", (-7, -10, 4), (0, 0, 0.65), 7.1, (1000, 550)
        )
        for x in (-6, 6):
            copy = obj.copy()
            copy.data = obj.data
            scene.collection.objects.link(copy)
            copy.location.x = x
        shot("bridge_parapet_tiling", (-5, -18, 6), (0, 0, 0.6), 20, (1000, 350))


def blender_main(args):
    global bpy, Vector
    import bpy as blender
    from mathutils import Vector as V

    bpy, Vector = blender, V
    external_python("--prepare", "--asset", args.asset)
    selected = ASSETS if args.asset == "all" else (args.asset,)
    builders = {
        "toll_booth": build_booth,
        "toll_canopy": build_canopy,
        "bridge_lamp": build_lamp,
        "bridge_parapet": build_parapet,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    PREVIEW.mkdir(parents=True, exist_ok=True)
    for asset in selected:
        if asset == "textures":
            continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        obj = builders[asset]()
        for ob in bpy.context.selected_objects:
            ob.select_set(False)
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.export_scene.gltf(
            filepath=str(OUT / (asset + "_r3.glb")),
            export_format="GLB",
            export_yup=True,
            export_apply=True,
            use_selection=True,
            export_extras=True,
            export_image_format="AUTO",
            export_texcoords=True,
            export_normals=True,
            export_materials="EXPORT",
            export_animations=False,
        )
        print("EXPORTED", asset)
        if not args.no_preview:
            render_views(asset, obj)
    external_python("--verify")
    if not args.no_preview:
        external_python("--sheets")


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--asset", choices=("all", "textures", *ASSETS), default="all")
    p.add_argument("--prepare", action="store_true", help=argparse.SUPPRESS)
    p.add_argument("--verify", action="store_true")
    p.add_argument("--reimport", action="store_true")
    p.add_argument("--sheets", action="store_true")
    p.add_argument("--no-preview", action="store_true")
    args = p.parse_args(argv)
    if args.prepare:
        prepare_images(args.asset)
    elif args.verify:
        verify_glbs()
    elif args.reimport:
        reimport_verify()
    elif args.sheets:
        make_sheets()
    elif args.asset == "textures":
        prepare_images("textures")
        make_sheets()
    else:
        blender_main(args)


if __name__ == "__main__":
    main()
