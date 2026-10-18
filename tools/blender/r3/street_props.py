"""Round-3 street props for Late Roadster; procedural meshes + embedded photo detail.

  /opt/homebrew/bin/blender -b -P tools/blender/r3/street_props.py -- --asset all
  /opt/homebrew/bin/blender -b -P tools/blender/r3/street_props.py -- --asset scooter
  /opt/homebrew/bin/blender -b -P tools/blender/r3/street_props.py -- --verify
  python3 tools/blender/r3/street_props.py --verify-files

Assets: dumpster, container_red, container_blue, scooter, all. All source PNGs are
read-only. Intermediate textures go exclusively into /tmp/r3-street_props/.
Requires external python3 with Pillow/numpy (texture prep / comparison sheets).
Each build starts from factory settings, in metres, Blender Z-up, ground-centred.
Scooter front and container door end are +X. Dumpster NO DUMPING face is -Y.
Textures are embedded PNG/JPEG <=1024 px; no runtime material-name binding needed.
GLBs and previews are written only to the explicitly assigned round-3 paths.
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
SRC = ROOT / "research/raycity/generated/2026-10-17-round3"
OUT = ROOT / "public/assets/gen"
PREVIEW = ROOT / "research/raycity/r3-assets/street_props"
TMP = Path("/tmp/r3-street_props")
NAMES = {
    "dumpster": "dumpster_r3",
    "container_red": "container_r3_red",
    "container_blue": "container_r3_blue",
    "scooter": "scooter_r3",
}


def prepare_textures():
    import numpy as np
    from PIL import Image, ImageDraw

    TMP.mkdir(parents=True, exist_ok=True)

    def save(image, name, size=None):
        image = image.convert("RGB")
        if size:
            image = image.resize(size, Image.Resampling.LANCZOS)
        image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        image.save(TMP / (name + ".jpg"), quality=94, subsampling=0)

    front = Image.open(SRC / "DP_01.png")
    side = Image.open(SRC / "DP_02.png")
    save(front.crop((104, 202, 1567, 863)), "dumpster_front")
    # QUAD ordering is upper-left, lower-left, lower-right, upper-right.
    wall = side.transform(
        (1024, 730),
        Image.Transform.QUAD,
        (145, 132, 145, 956, 1346, 956, 1346, 273),
        Image.Resampling.BICUBIC,
    )
    save(wall, "dumpster_side")
    lid = front.transform(
        (1024, 512),
        Image.Transform.QUAD,
        (213, 40, 82, 196, 1587, 196, 1455, 40),
        Image.Resampling.BICUBIC,
    )
    save(lid, "dumpster_lid")
    for colour, ident in [("red", "SC_01"), ("blue", "SC_02")]:
        save(Image.open(SRC / (ident + ".png")), "container_" + colour + "_side")
    door = Image.open(SRC / "SC_03.png").convert("RGB")
    save(door, "container_red_door")
    # Hue-shift only red paint. Preserve white stencils, neutral hardware and yellow
    # placards. SC_02 sampled blue sits at hue ~0.56 rather than electric cobalt.
    hsv = np.array(door.convert("HSV"), dtype=np.float32)
    rgb = np.array(door, dtype=np.float32)
    hue, sat = hsv[..., 0], hsv[..., 1]
    paint = ((hue < 19) | (hue > 244)) & (sat > 65) & (rgb[..., 0] > rgb[..., 2] * 1.18)
    hsv[..., 0][paint] = 146
    hsv[..., 1][paint] *= 0.82
    hsv[..., 2][paint] *= 0.92
    blue = Image.fromarray(np.uint8(np.clip(hsv, 0, 255)), "HSV").convert("RGB")
    save(blue, "container_blue_door")
    # One compact atlas: rear hub from S_01 plus neutral/reflective colour swatches.
    s = Image.open(SRC / "S_01.png").convert("RGB")
    atlas = Image.new("RGB", (512, 512), (36, 38, 35))
    wheel = s.crop((1153, 723, 1339, 909)).resize((384, 384), Image.Resampling.LANCZOS)
    atlas.paste(wheel, (0, 0))
    d = ImageDraw.Draw(atlas)
    d.rectangle((0, 400, 126, 511), fill=(237, 246, 247))
    d.rectangle((128, 400, 254, 511), fill=(241, 179, 16))
    d.rectangle((256, 400, 382, 511), fill=(192, 16, 21))
    d.rectangle((384, 400, 511, 511), fill=(98, 103, 99))
    atlas.save(TMP / "scooter_details.png")
    print("Prepared embedded textures in", TMP)


def make_sheets():
    from PIL import Image, ImageDraw

    PREVIEW.mkdir(parents=True, exist_ok=True)
    rows = {
        "dumpster": [("DP_01", "front"), ("DP_02", "side")],
        "container_red": [("SC_01", "side"), ("SC_03", "door")],
        "container_blue": [("SC_02", "side"), ("blue_door", "door")],
        "scooter": [("S_01", "side")],
    }
    for asset, entries in rows.items():
        if not (PREVIEW / (NAMES[asset] + "_" + entries[0][1] + ".png")).exists():
            continue
        sheet = Image.new("RGB", (1000, len(entries) * 390), (238, 240, 240))
        d = ImageDraw.Draw(sheet)
        for row, (ref, view) in enumerate(entries):
            source = (
                TMP / "container_blue_door.jpg"
                if ref == "blue_door"
                else SRC / (ref + ".png")
            )
            images = [
                Image.open(source).convert("RGBA"),
                Image.open(PREVIEW / (NAMES[asset] + "_" + view + ".png")).convert(
                    "RGBA"
                ),
            ]
            for col, image in enumerate(images):
                if col == 0 and ref.startswith(("DP", "S_")):
                    import numpy as np

                    a = np.asarray(image)[:, :, :3]
                    yy, xx = np.where(a.min(2) < 235)
                    image = image.crop(
                        (
                            max(0, int(xx.min()) - 8),
                            max(0, int(yy.min()) - 8),
                            min(image.width, int(xx.max()) + 9),
                            min(image.height, int(yy.max()) + 9),
                        )
                    )
                elif col == 1:
                    bbox = image.getchannel("A").getbbox()
                    if bbox:
                        image = image.crop(bbox)
                image.thumbnail((470, 340), Image.Resampling.LANCZOS)
                x, y = (
                    col * 500 + (500 - image.width) // 2,
                    row * 390 + 42 + (340 - image.height) // 2,
                )
                sheet.paste(image, (x, y), image)
                d.text(
                    (col * 500 + 15, row * 390 + 14),
                    (ref + " / reference")
                    if col == 0
                    else (NAMES[asset] + " / " + view),
                    fill=(22, 30, 28),
                )
        sheet.save(PREVIEW / (NAMES[asset] + "_comparison.png"))
    # Overview includes extra angles without implying a new source elevation.
    overview = Image.new("RGB", (1000, 800), (235, 238, 238))
    d = ImageDraw.Draw(overview)
    for i, name in enumerate(NAMES.values()):
        p = PREVIEW / (name + "_threequarter.png")
        if not p.exists():
            continue
        im = Image.open(p).convert("RGBA")
        im.thumbnail((480, 350), Image.Resampling.LANCZOS)
        x, y = (i % 2) * 500, (i // 2) * 400
        overview.paste(
            im, (x + (500 - im.width) // 2, y + 45 + (350 - im.height) // 2), im
        )
        d.text((x + 15, y + 15), name, fill=(22, 30, 28))
    overview.save(PREVIEW / "models_overview.png")


def verify_files():
    import numpy as np
    from PIL import Image

    records = []
    for asset, name in NAMES.items():
        path = OUT / (name + ".glb")
        if not path.exists():
            continue
        data = path.read_bytes()
        magic, version, length = struct.unpack_from("<III", data, 0)
        assert magic == 0x46546C67 and version == 2 and length == len(data)
        jl, jt = struct.unpack_from("<II", data, 12)
        assert jt == 0x4E4F534A
        doc = json.loads(data[20 : 20 + jl])
        bl, bt = struct.unpack_from("<II", data, 20 + jl)
        assert bt == 0x004E4942
        binary = data[28 + jl : 28 + jl + bl]

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
            width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
            offset = v.get("byteOffset", 0) + a.get("byteOffset", 0)
            stride = v.get("byteStride", np.dtype(dtype).itemsize * width)
            return np.ndarray(
                (a["count"], width),
                dtype=dtype,
                buffer=binary,
                offset=offset,
                strides=(stride, np.dtype(dtype).itemsize),
            )

        all_positions = []
        triangles = 0
        degenerate = 0
        for mesh in doc["meshes"]:
            for prim in mesh["primitives"]:
                assert prim.get("mode", 4) == 4
                pos = accessor(prim["attributes"]["POSITION"])
                assert np.isfinite(pos).all()
                indices = accessor(prim["indices"]).ravel().reshape(-1, 3)
                assert int(indices.max()) < len(pos)
                cross = np.cross(
                    pos[indices[:, 1]] - pos[indices[:, 0]],
                    pos[indices[:, 2]] - pos[indices[:, 0]],
                )
                degenerate += int(
                    np.count_nonzero(np.linalg.norm(cross, axis=1) < 1e-10)
                )
                triangles += len(indices)
                all_positions.append(pos)
        p = np.concatenate(all_positions)
        # All mesh object transforms were applied before export; assert this assumption.
        for node in doc["nodes"]:
            if "mesh" in node:
                assert (
                    "matrix" not in node
                    and "translation" not in node
                    and "scale" not in node
                    and "rotation" not in node
                ), node
        lo = p.min(0)
        hi = p.max(0)
        dims = hi - lo
        images = []
        for image in doc.get("images", []):
            assert "bufferView" in image and "uri" not in image
            v = doc["bufferViews"][image["bufferView"]]
            payload = binary[
                v.get("byteOffset", 0) : v.get("byteOffset", 0) + v["byteLength"]
            ]
            im = Image.open(io.BytesIO(payload))
            assert max(im.size) <= 1024
            images.append(
                {
                    "name": image.get("name"),
                    "size_px": list(im.size),
                    "mime": image["mimeType"],
                }
            )
        mats = [m["name"] for m in doc.get("materials", [])]
        assert triangles <= 1500 and len(mats) <= 4 and degenerate == 0
        assert abs(float(lo[1])) < 1e-5
        record = {
            "asset": name,
            "dimensions_blender_xyz_m": [round(float(dims[i]), 5) for i in (0, 2, 1)],
            "bbox_blender_min_m": [
                round(float(lo[0]), 6),
                round(float(-hi[2]), 6),
                round(float(lo[1]), 6),
            ],
            "bbox_blender_max_m": [
                round(float(hi[0]), 6),
                round(float(-lo[2]), 6),
                round(float(hi[1]), 6),
            ],
            "triangles": triangles,
            "degenerate_triangles": degenerate,
            "materials": mats,
            "objects": [n.get("name") for n in doc["nodes"] if "mesh" in n],
            "embedded_images": images,
            "file_bytes": len(data),
        }
        records.append(record)
        print(json.dumps(record))
    (PREVIEW / "models_verification.json").write_text(
        json.dumps(records, indent=2) + "\n"
    )


def run_blender(args):
    import bmesh
    import bpy
    from mathutils import Vector

    python = shutil.which("python3") or "/opt/homebrew/bin/python3"
    PREVIEW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    if args.verify:
        records = []
        for name in NAMES.values():
            bpy.ops.wm.read_factory_settings(use_empty=True)
            path = OUT / (name + ".glb")
            if not path.exists():
                continue
            bpy.ops.import_scene.gltf(filepath=str(path))
            objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
            vertices = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
            lo = [min(v[i] for v in vertices) for i in range(3)]
            hi = [max(v[i] for v in vertices) for i in range(3)]
            tris = 0
            loose = 0
            for o in objs:
                o.data.calc_loop_triangles()
                tris += len(o.data.loop_triangles)
                used = {i for p in o.data.polygons for i in p.vertices}
                loose += len(o.data.vertices) - len(used)
            assert tris <= 1500 and loose == 0 and abs(lo[2]) < 1e-5
            record = {
                "asset": name,
                "reimport_dimensions_m": [round(hi[i] - lo[i], 6) for i in range(3)],
                "triangles": tris,
                "loose_vertices": loose,
                "objects": [o.name for o in objs],
                "materials": [m.name for m in bpy.data.materials],
                "images": [
                    {
                        "name": im.name,
                        "size": list(im.size),
                        "packed": bool(im.packed_file),
                    }
                    for im in bpy.data.images
                    if im.size[0] > 0
                ],
            }
            records.append(record)
            print("REIMPORT", json.dumps(record))
        (PREVIEW / "models_reimport_verification.json").write_text(
            json.dumps(records, indent=2) + "\n"
        )
        return
    subprocess.run(
        [python, str(Path(__file__).resolve()), "--prepare-textures"], check=True
    )
    chosen = list(NAMES) if args.asset == "all" else [args.asset]
    for asset in chosen:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        parts = []

        def srgb(rgb):
            return tuple(
                c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb
            )

        def mat(name, rgb=(0.5, 0.5, 0.5), rough=0.8, metal=0.0, texture=None):
            m = bpy.data.materials.new(name)
            m.use_nodes = True
            bs = m.node_tree.nodes.get("Principled BSDF")
            bs.inputs["Base Color"].default_value = (*srgb(rgb), 1)
            bs.inputs["Roughness"].default_value = rough
            bs.inputs["Metallic"].default_value = metal
            if texture:
                im = bpy.data.images.load(str(TMP / texture), check_existing=True)
                im.pack()
                tex = m.node_tree.nodes.new("ShaderNodeTexImage")
                tex.image = im
                tex.interpolation = "Linear"
                m.node_tree.links.new(tex.outputs["Color"], bs.inputs["Base Color"])
                # A small baked-light contribution keeps photographic rust/stencil legible.
                m.node_tree.links.new(tex.outputs["Color"], bs.inputs["Emission Color"])
                bs.inputs["Emission Strength"].default_value = 0.12
            m.diffuse_color = (*srgb(rgb), 1)
            return m

        FULL = [(0, 0), (1, 0), (1, 1), (0, 1)]

        def mesh(name, vertices, faces, material, uvs=None, smooth=False):
            me = bpy.data.meshes.new(name)
            me.from_pydata(vertices, [], faces)
            me.update()
            ob = bpy.data.objects.new(name, me)
            bpy.context.collection.objects.link(ob)
            parts.append(ob)
            me.materials.append(material)
            uv = me.uv_layers.new(name="UVMap")
            for j, p in enumerate(me.polygons):
                p.use_smooth = smooth
                coords = (
                    uvs[j] if uvs is not None else [(0.5, 0.5)] * len(p.loop_indices)
                )
                for k, li in enumerate(p.loop_indices):
                    uv.data[li].uv = coords[k]
            return ob

        def quad(name, verts, material, uv=None):
            return mesh(name, verts, [(0, 1, 2, 3)], material, [uv or FULL])

        def box(name, center, size, material, uv=(0.2, 0.4)):
            x, y, z = center
            a, b, c = [v / 2 for v in size]
            v = [
                (x - a, y - b, z - c),
                (x + a, y - b, z - c),
                (x + a, y + b, z - c),
                (x - a, y + b, z - c),
                (x - a, y - b, z + c),
                (x + a, y - b, z + c),
                (x + a, y + b, z + c),
                (x - a, y + b, z + c),
            ]
            f = [
                (0, 1, 5, 4),
                (1, 2, 6, 5),
                (2, 3, 7, 6),
                (3, 0, 4, 7),
                (4, 5, 6, 7),
                (3, 2, 1, 0),
            ]
            return mesh(name, v, f, material, [[uv] * 4] * 6)

        def cylinder(name, a, b, r, material, n=12, uv=(0.5, 0.5)):
            a, b = Vector(a), Vector(b)
            axis = (b - a).normalized()
            u = axis.cross(Vector((0, 0, 1)))
            if u.length < 0.01:
                u = axis.cross(Vector((0, 1, 0)))
            u.normalize()
            v = axis.cross(u).normalized()
            verts = [
                tuple(
                    p
                    + r
                    * (
                        math.cos(2 * math.pi * i / n) * u
                        + math.sin(2 * math.pi * i / n) * v
                    )
                )
                for p in (a, b)
                for i in range(n)
            ]
            faces = [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
            faces += [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
            ob = mesh(name, verts, faces, material, [[uv] * len(f) for f in faces])
            for p in ob.data.polygons:
                p.use_smooth = len(p.vertices) == 4
            return ob

        def slope_box(
            name, x0, x1, y0, y1, z0, z1, thick, material, uvrange=(0, 1), sample=None
        ):
            v = [
                (x0, y0, z0 - thick),
                (x1, y0, z0 - thick),
                (x1, y1, z1 - thick),
                (x0, y1, z1 - thick),
                (x0, y0, z0),
                (x1, y0, z0),
                (x1, y1, z1),
                (x0, y1, z1),
            ]
            f = [
                (0, 1, 5, 4),
                (1, 2, 6, 5),
                (2, 3, 7, 6),
                (3, 0, 4, 7),
                (4, 5, 6, 7),
                (3, 2, 1, 0),
            ]
            u0, u1 = uvrange
            uv = [[(0.3, 0.4)] * 4 for _ in f]
            uv[4] = [(u0, 0), (u1, 0), (u1, 1), (u0, 1)]
            if sample:
                uv = [[sample] * 4 for _ in f]
            return mesh(name, v, f, material, uv)

        if asset == "dumpster":
            front = mat("dumpster:green_front_NO_DUMPING", texture="dumpster_front.jpg")
            side = mat("dumpster:green_side_rusted_steel", texture="dumpster_side.jpg")
            lid = mat(
                "dumpster:ribbed_black_lids", rough=0.91, texture="dumpster_lid.jpg"
            )
            rubber = mat(
                "dumpster:castor_rubber_and_pocket_interior",
                (0.045, 0.049, 0.045),
                0.92,
            )
            # Main body is a closed trapezoidal steel bin. Sloped top falls toward -Y.
            x = 0.94
            y = 0.55
            bottom = 0.17
            frontz = 1.055
            backz = 1.245
            quad(
                "front_photo",
                [(-x, -y, bottom), (x, -y, bottom), (x, -y, frontz), (-x, -y, frontz)],
                front,
            )
            quad(
                "back_steel",
                [(x, y, bottom), (-x, y, bottom), (-x, y, backz), (x, y, backz)],
                side,
            )
            quad(
                "left_side_photo",
                [(-x, y, bottom), (-x, -y, bottom), (-x, -y, frontz), (-x, y, backz)],
                side,
            )
            quad(
                "right_side_photo",
                [(x, -y, bottom), (x, y, bottom), (x, y, backz), (x, -y, frontz)],
                side,
                [(1, 0), (0, 0), (0, 1), (1, 1)],
            )
            quad(
                "body_top_seal",
                [(-x, -y, frontz), (x, -y, frontz), (x, y, backz), (-x, y, backz)],
                rubber,
            )
            quad(
                "body_underpan",
                [(-x, y, bottom), (x, y, bottom), (x, -y, bottom), (-x, -y, bottom)],
                side,
            )
            # Steel lip and two separately modelled closed sloping moulded lids.
            for yy, zz in [(-0.565, 1.035), (0.565, 1.23)]:
                box(
                    "rolled_top_lip",
                    (0, yy, zz),
                    (1.96, 0.07, 0.065),
                    front,
                    uv=(0.42, 0.96),
                )
            for k, (x0, x1) in enumerate([(-0.975, -0.013), (0.013, 0.975)]):
                slope_box(
                    "lid_" + str(k),
                    x0,
                    x1,
                    -0.585,
                    0.585,
                    1.086,
                    1.282,
                    0.032,
                    lid,
                    (k * 0.5, (k + 1) * 0.5),
                )
                for i in range(4):
                    xx = x0 + 0.095 + i * 0.215
                    slope_box(
                        "lid_stiffening_rib",
                        xx,
                        xx + 0.077,
                        -0.54,
                        0.53,
                        1.11,
                        1.293,
                        0.022,
                        lid,
                        sample=(0.2, 0.53),
                    )
                cylinder(
                    "lid_hinge",
                    (x0 + 0.035, 0.562, 1.275),
                    (x0 + 0.15, 0.562, 1.275),
                    0.025,
                    lid,
                    12,
                )
            # Four-sided fork pockets, visibly open at the street/front end.
            for xx in [-0.944, 0.944]:
                box(
                    "pocket_outer_wall",
                    (xx + (-0.043 if xx < 0 else 0.043), -0.045, 0.68),
                    (0.026, 1.10, 0.19),
                    side,
                )
                box(
                    "pocket_inner_wall",
                    (xx + (0.043 if xx < 0 else -0.043), -0.045, 0.68),
                    (0.026, 1.10, 0.19),
                    side,
                )
                for zz in [0.598, 0.762]:
                    box(
                        "pocket_horizontal_wall",
                        (xx, -0.045, zz),
                        (0.112, 1.10, 0.026),
                        side,
                    )
                box(
                    "pocket_dark_recess", (xx, 0.48, 0.68), (0.082, 0.012, 0.14), rubber
                )
            for xx in [-0.81, 0.81]:
                for yy in [-0.43, 0.43]:
                    cylinder(
                        "castor_wheel",
                        (xx - 0.035, yy, 0.075),
                        (xx + 0.035, yy, 0.075),
                        0.075,
                        rubber,
                        16,
                    )
                    box("castor_bracket", (xx, yy, 0.15), (0.105, 0.09, 0.09), side)
                    cylinder(
                        "castor_axle",
                        (xx - 0.055, yy, 0.075),
                        (xx + 0.055, yy, 0.075),
                        0.019,
                        lid,
                        8,
                    )
        elif asset.startswith("container"):
            colour = asset.split("_")[-1]
            paint = (0.64, 0.24, 0.18) if colour == "red" else (0.25, 0.43, 0.55)
            side = mat(
                "container:" + colour + "_SC_side",
                texture="container_" + colour + "_side.jpg",
            )
            door = mat(
                "container:" + colour + "_SC_door",
                texture="container_" + colour + "_door.jpg",
            )
            steel = mat(
                "container:" + colour + "_plain_corrugated_steel", paint, 0.88, 0.12
            )
            hardware = mat(
                "container:galvanized_locking_bars", (0.53, 0.54, 0.51), 0.7, 0.35
            )
            L, W, H = 6.06, 2.44, 2.59
            hx, hy = L / 2, W / 2
            # Shallow corrugations are physical and retain one continuous full-face UV.
            count = 36
            verts = []
            faces = []
            uvs = []
            profile = [0, 0.18, 0.40, 0.70, 1]
            depth = [0, 0, 0.016, 0.016, 0]
            for sign in [-1, 1]:
                for i in range(count):
                    for j in range(4):
                        u0 = (i + profile[j]) / count
                        u1 = (i + profile[j + 1]) / count
                        x0 = -hx + u0 * L
                        x1 = -hx + u1 * L
                        y0 = sign * (hy - depth[j])
                        y1 = sign * (hy - depth[j + 1])
                        points = [(x0, y0, 0), (x1, y1, 0), (x1, y1, H), (x0, y0, H)]
                        uv = [(u0, 0), (u1, 0), (u1, 1), (u0, 1)]
                        if sign > 0:
                            points.reverse()
                            uv = [(1 - u, v) for u, v in reversed(uv)]
                        start = len(verts)
                        verts += points
                        faces.append(tuple(range(start, start + 4)))
                        uvs.append(uv)
            mesh("container_long_side_corrugations", verts, faces, side, uvs)
            quad(
                "door_end_plus_X",
                [(hx, -hy, 0), (hx, hy, 0), (hx, hy, H), (hx, -hy, H)],
                door,
            )
            quad(
                "floor", [(-hx, hy, 0), (hx, hy, 0), (hx, -hy, 0), (-hx, -hy, 0)], steel
            )
            # Plain roof and blank -X end: recessed shallow trapezoidal corrugation.
            for plane, n in [("roof", 20), ("end", 12)]:
                verts = []
                faces = []
                for i in range(n):
                    for j in range(4):
                        a0 = (i + profile[j]) / n
                        a1 = (i + profile[j + 1]) / n
                        if plane == "roof":
                            x0 = -hx + a0 * L
                            x1 = -hx + a1 * L
                            points = [
                                (x0, -hy, H - depth[j]),
                                (x1, -hy, H - depth[j + 1]),
                                (x1, hy, H - depth[j + 1]),
                                (x0, hy, H - depth[j]),
                            ]
                        else:
                            y0 = hy - a0 * W
                            y1 = hy - a1 * W
                            points = [
                                (-hx + depth[j], y0, 0),
                                (-hx + depth[j + 1], y1, 0),
                                (-hx + depth[j + 1], y1, H),
                                (-hx + depth[j], y0, H),
                            ]
                        start = len(verts)
                        verts += points
                        faces.append(tuple(range(start, start + 4)))
                mesh("plain_" + plane + "_corrugations", verts, faces, steel)
            # Restrained perimeter steel for side-view edge thickness; all within ISO bbox.
            for yy in [-hy + 0.025, hy - 0.025]:
                for zz in [0.035, H - 0.035]:
                    box(
                        "side_perimeter_rail",
                        (0, yy, zz),
                        (L, 0.05, 0.07),
                        side,
                        uv=(0.2, 0.015 if zz < 1 else 0.985),
                    )
            # Physical locking bars stand just inside the exact +X bound, while the
            # photo door skin is inset so the hardware has depth without increasing L.
            for ob in parts:
                if ob.name == "door_end_plus_X":
                    for v in ob.data.vertices:
                        v.co.x -= 0.035
            for u in [0.237, 0.410, 0.589, 0.762]:
                yy = -hy + u * W
                cylinder(
                    "door_locking_bar",
                    (hx - 0.014, yy, 0.10),
                    (hx - 0.014, yy, H - 0.10),
                    0.014,
                    hardware,
                    8,
                )
                for zz in [0.30, 1.12, 2.28]:
                    box(
                        "bar_bracket",
                        (hx - 0.014, yy, zz),
                        (0.026, 0.065, 0.055),
                        hardware,
                    )
                box(
                    "door_latch_handle",
                    (hx - 0.013, yy - 0.06, 0.64),
                    (0.024, 0.15, 0.026),
                    hardware,
                )
        elif asset == "scooter":
            lime = mat(
                "scooter:lime_green_painted_aluminium", (0.64, 0.87, 0.055), 0.49, 0.18
            )
            dark = mat("scooter:charcoal_rubber_polymer", (0.095, 0.105, 0.10), 0.8)
            details = mat(
                "scooter:S_01_hubs_lamps_reflectors",
                texture="scooter_details.png",
                rough=0.62,
            )
            # Rear (-X) to front (+X); footprint centred on two 230 mm tyres.
            wheelx = [-0.425, 0.425]
            radius = 0.115
            for idx, x in enumerate(wheelx):
                n = 20
                ys = [-0.037, -0.027, 0.027, 0.037]
                rs = [0.098, 0.115, 0.115, 0.098]
                verts = [
                    (
                        x + r * math.cos(2 * math.pi * i / n),
                        y,
                        0.115 + r * math.sin(2 * math.pi * i / n),
                    )
                    for y, r in zip(ys, rs)
                    for i in range(n)
                ]
                faces = []
                for ring in range(3):
                    for i in range(n):
                        faces.append(
                            (
                                ring * n + i,
                                ring * n + (i + 1) % n,
                                (ring + 1) * n + (i + 1) % n,
                                (ring + 1) * n + i,
                            )
                        )
                mesh(
                    ("rear" if idx == 0 else "front") + "_tyre",
                    verts,
                    faces,
                    dark,
                    smooth=True,
                )
                for sign in [-1, 1]:
                    # Round mesh cap, not an alpha card: image hub detail stays embedded.
                    v = [
                        (
                            x + 0.098 * math.cos(2 * math.pi * i / n),
                            sign * 0.037,
                            0.115 + 0.098 * math.sin(2 * math.pi * i / n),
                        )
                        for i in range(n)
                    ]
                    uv = [
                        (
                            0.375 + 0.375 * 0.853 * math.cos(2 * math.pi * i / n),
                            0.625 + 0.375 * 0.853 * math.sin(2 * math.pi * i / n),
                        )
                        for i in range(n)
                    ]
                    if sign > 0:
                        v.reverse()
                        uv.reverse()
                    mesh("wheel_hub_photo", v, [tuple(range(n))], details, [uv])
                # Mudguards: thin closed shell, over the upper wheel arc.
                n = 8
                verts = []
                for r in [0.126, 0.137]:
                    for y in [-0.047, 0.047]:
                        for i in range(n + 1):
                            a = math.radians(12 + 156 * i / n)
                            verts.append(
                                (x + r * math.cos(a), y, 0.115 + r * math.sin(a))
                            )
                faces = []
                q = n + 1
                for i in range(n):
                    faces.extend(
                        [
                            (i, i + 1, q + i + 1, q + i),
                            (2 * q + i, 3 * q + i, 3 * q + i + 1, 2 * q + i + 1),
                            (i, 2 * q + i, 2 * q + i + 1, i + 1),
                            (q + i, q + i + 1, 3 * q + i + 1, 3 * q + i),
                        ]
                    )
                faces.extend([(0, q, 3 * q, 2 * q), (n, 2 * q + n, 3 * q + n, q + n)])
                mesh("wheel_mudguard", verts, faces, dark)
            # Low chamfered deck (extruded outline), separate black griptape.
            outline = [
                (-0.36, 0.135),
                (-0.30, 0.105),
                (0.23, 0.105),
                (0.30, 0.145),
                (0.26, 0.185),
                (-0.30, 0.185),
            ]
            verts = [(x, y, z) for y in [-0.085, 0.085] for x, z in outline]
            n = len(outline)
            faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [
                (i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)
            ]
            mesh("lime_deck", verts, faces, lime)
            box("deck_griptape", (-0.02, 0, 0.187), (0.52, 0.158, 0.006), dark)
            # Angled head tube and triangular rising neck reproduce S_01 silhouette.
            neck = [(0.19, 0.15), (0.285, 0.15), (0.43, 0.36), (0.37, 0.41)]
            v = [(x, y, z) for y in [-0.039, 0.039] for x, z in neck]
            mesh(
                "slanted_deck_neck",
                v,
                [
                    (3, 2, 1, 0),
                    (4, 5, 6, 7),
                    (0, 1, 5, 4),
                    (1, 2, 6, 5),
                    (2, 3, 7, 6),
                    (3, 0, 4, 7),
                ],
                lime,
            )
            cylinder("lime_stem", (0.407, 0, 0.28), (0.241, 0, 1.07), 0.028, lime, 12)
            cylinder(
                "black_control_head",
                (0.252, 0, 1.02),
                (0.226, 0, 1.155),
                0.031,
                dark,
                12,
            )
            cylinder(
                "stem_folding_collar",
                (0.379, 0, 0.415),
                (0.391, 0, 0.357),
                0.034,
                dark,
                12,
            )
            for yy in [-0.048, 0.048]:
                cylinder(
                    "front_fork", (0.425, yy, 0.115), (0.405, yy, 0.29), 0.024, dark, 10
                )
                cylinder(
                    "rear_swingarm",
                    (-0.425, yy, 0.115),
                    (-0.31, yy, 0.14),
                    0.021,
                    lime,
                    10,
                )
                box(
                    "amber_rear_reflector",
                    (-0.39, yy * 1.45, 0.135),
                    (0.075, 0.008, 0.018),
                    details,
                    uv=(0.375, 0.10),
                )
                box(
                    "amber_fork_reflector",
                    (0.431, yy * 1.45, 0.185),
                    (0.013, 0.008, 0.058),
                    details,
                    uv=(0.375, 0.10),
                )
            cylinder(
                "handlebar",
                (0.226, -0.245, 1.156),
                (0.226, 0.245, 1.156),
                0.014,
                dark,
                12,
            )
            for sign in [-1, 1]:
                cylinder(
                    "textured_grip",
                    (0.226, sign * 0.135, 1.156),
                    (0.226, sign * 0.25, 1.156),
                    0.022,
                    dark,
                    12,
                )
                cylinder(
                    "brake_lever",
                    (0.256, sign * 0.08, 1.14),
                    (0.30, sign * 0.20, 1.13),
                    0.008,
                    dark,
                    8,
                )
            box("handlebar_display", (0.243, 0, 1.17), (0.06, 0.052, 0.021), dark)
            cylinder(
                "bell", (0.235, 0.075, 1.165), (0.235, 0.075, 1.2), 0.018, dark, 10
            )
            # Round forward-facing lamp, white lens, rear red safety light.
            cylinder(
                "headlight_housing",
                (0.26, 0, 1.035),
                (0.314, 0, 1.035),
                0.032,
                dark,
                12,
            )
            cylinder(
                "headlight_lens",
                (0.314, 0, 1.035),
                (0.317, 0, 1.035),
                0.026,
                details,
                12,
                uv=(0.125, 0.10),
            )
            box(
                "red_tail_light",
                (-0.526, 0, 0.233),
                (0.012, 0.055, 0.035),
                details,
                uv=(0.625, 0.10),
            )
            # Visible brake cable is real low-poly geometry rather than a white card.
            cable = [
                (0.25, -0.045, 1.13),
                (0.315, -0.045, 1.06),
                (0.34, -0.04, 0.94),
                (0.39, -0.04, 0.43),
                (0.395, -0.044, 0.31),
            ]
            for a, b in zip(cable, cable[1:]):
                cylinder("brake_cable", a, b, 0.004, dark, 6)
            cylinder(
                "kickstand", (-0.11, 0.057, 0.14), (-0.18, 0.105, 0.023), 0.007, dark, 6
            )

        # Join to one draw hierarchy, apply all geometry transforms, weld shared edges,
        # recalculate outward normals, triangulate and remove any unused vertices.
        bpy.ops.object.select_all(action="DESELECT")
        for ob in parts:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        bpy.ops.object.join()
        obj = bpy.context.object
        obj.name = NAMES[asset]
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
        bm.to_mesh(obj.data)
        bm.free()
        obj.data.update()
        obj.data.name = NAMES[asset] + "_mesh"
        bpy.context.scene.unit_settings.system = "METRIC"
        bpy.context.scene.unit_settings.scale_length = 1
        tris = len(obj.data.polygons)
        assert tris <= 1500, (asset, tris)
        assert len(obj.data.materials) <= 4
        obj["forward_axis"] = "+X" if asset != "dumpster" else "street face -Y"
        obj["ground_origin"] = "footprint centre; minimum Blender Z=0"
        bpy.ops.export_scene.gltf(
            filepath=str(OUT / (NAMES[asset] + ".glb")),
            export_format="GLB",
            export_yup=True,
            export_apply=True,
            use_selection=True,
            export_cameras=False,
            export_lights=False,
            export_extras=True,
            export_image_format="AUTO",
            export_materials="EXPORT",
        )
        print("BUILT", NAMES[asset], tris, "triangles")
        if args.no_previews:
            continue
        scene = bpy.context.scene
        scene.render.engine = "BLENDER_EEVEE_NEXT"
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
        scene.render.film_transparent = True
        scene.render.image_settings.color_depth = "8"
        scene.world = bpy.data.worlds.new("Preview studio")
        scene.world.use_nodes = True
        scene.world.node_tree.nodes["Background"].inputs[0].default_value = (
            0.65,
            0.65,
            0.65,
            1,
        )
        scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
        scene.view_settings.view_transform = "Standard"
        scene.view_settings.look = "None"
        scene.view_settings.exposure = 0
        scene.view_settings.gamma = 1
        # CPU-friendly previews; scene geometry only is exported above.
        if hasattr(scene, "eevee"):
            scene.eevee.taa_render_samples = 24
        extent = max(obj.dimensions)
        height = obj.dimensions.z
        for loc, power, size in [((4, -6, 8), 650, 6), ((-5, 4, 6), 450, 5)]:
            data = bpy.data.lights.new("preview_softbox", "AREA")
            data.energy = power * max(1, extent / 3) ** 2
            data.shape = "DISK"
            data.size = size * max(1, extent / 3)
            light = bpy.data.objects.new("preview_softbox", data)
            scene.collection.objects.link(light)
            light.location = Vector(loc) * max(1, extent / 3)
            light.rotation_euler = (
                (Vector((0, 0, height * 0.5)) - light.location)
                .to_track_quat("-Z", "Y")
                .to_euler()
            )
        data = bpy.data.cameras.new("preview_camera")
        data.type = "ORTHO"
        camera = bpy.data.objects.new("preview_camera", data)
        scene.collection.objects.link(camera)
        scene.camera = camera
        centre = Vector((0, 0, height * 0.5))
        if asset == "dumpster":
            views = [
                ("front", (0, -8, 0), (1000, 700)),
                ("side", (-8, 0, 0), (800, 800)),
                ("top", (0, 0, 8), (1000, 700)),
                ("threequarter", (5, -7, 4), (1000, 800)),
            ]
        elif asset == "scooter":
            views = [
                ("side", (0, 8, 0), (900, 900)),
                ("front", (8, 0, 0), (600, 1000)),
                ("top", (0, 0, 8), (1000, 650)),
                ("threequarter", (5, 7, 3), (900, 1000)),
            ]
        else:
            views = [
                ("side", (0, -10, 0), (1000, 550)),
                ("door", (10, 0, 0), (850, 900)),
                ("top", (0, 0, 10), (1000, 550)),
                ("threequarter", (8, -10, 6), (1000, 700)),
            ]
        for view, offset, res in views:
            camera.location = centre + Vector(offset)
            direction = centre - camera.location
            camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
            scene.render.resolution_x, scene.render.resolution_y = res
            bpy.context.view_layer.update()
            inv = camera.matrix_world.inverted()
            coords = [inv @ (obj.matrix_world @ Vector(v)) for v in obj.bound_box]
            w = max(p.x for p in coords) - min(p.x for p in coords)
            h = max(p.y for p in coords) - min(p.y for p in coords)
            data.ortho_scale = max(w, h * res[0] / res[1]) * 1.13
            scene.render.filepath = str(PREVIEW / (NAMES[asset] + "_" + view + ".png"))
            bpy.ops.render.render(write_still=True)
    subprocess.run([python, str(Path(__file__).resolve()), "--sheets"], check=True)
    subprocess.run(
        [python, str(Path(__file__).resolve()), "--verify-files"], check=True
    )


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asset", choices=list(NAMES) + ["all"], default="all")
    parser.add_argument("--no-previews", action="store_true")
    parser.add_argument("--prepare-textures", action="store_true")
    parser.add_argument("--sheets", action="store_true")
    parser.add_argument("--verify-files", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args(argv)
    if args.prepare_textures:
        prepare_textures()
    elif args.sheets:
        make_sheets()
    elif args.verify_files:
        verify_files()
    else:
        run_blender(args)


if __name__ == "__main__":
    main()
