"""ORBIT MART jet-assist shopping cart for Late Roadster (Blender 4.5+).

  /opt/homebrew/bin/blender -b -P tools/blender/r4/cart.py
  /opt/homebrew/bin/blender -b -P tools/blender/r4/cart.py -- --revision 3
  /opt/homebrew/bin/blender -b -P tools/blender/r4/cart.py -- --verify
  python3 tools/blender/r4/cart.py --verify-files

Metres, +X nose, +Z up, handle at -X, origin at the wheel footprint's ground
centre. glTF uses the standard +Y-up conversion: nose remains +X. The
jet_exhaust attachment's Blender local +Z (glTF local +Y) points down,
not along the cart's forward axis.
Grid wires are exclusively double-sided alpha-MASK planes; only structural
perimeter rails are geometry. Textures are deterministic, generated here, and
embedded in the GLB. No source reference is modified. All intermediate output
is contained in research/raycity/r4-assets/cart/. Requires system Python Pillow
and numpy for texture baking and comparison sheets. No optimizer is invoked.
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
REFERENCE = ROOT / "research/raycity/generated/2026-10-18-round4"
PREVIEW = ROOT / "research/raycity/r4-assets/cart"
TEXTURES = PREVIEW / "textures"
GLB = ROOT / "public/assets/gen/cart_r4.glb"
REVISIONS = {
    1: {
        "floor": 0.50,
        "nose_top": 0.86,
        "rear_top": 0.90,
        "handle_z": 1.005,
        "wheel_r": 0.075,
        "pod_z": 0.402,
        "pod_r": 0.050,
        "pod_length": 0.29,
        "nozzle_z": 0.265,
        "seat_x": -0.315,
        "seat_width": 0.30,
    },
    # Pass 01 review: basket/pod too high, castors and pod too small.
    2: {
        "floor": 0.46,
        "nose_top": 0.83,
        "rear_top": 0.87,
        "handle_z": 0.97,
        "wheel_r": 0.083,
        "pod_z": 0.362,
        "pod_r": 0.060,
        "pod_length": 0.34,
        "nozzle_z": 0.234,
        "seat_x": -0.315,
        "seat_width": 0.30,
    },
    # Pass 02 review: refine basket taper-height, longer pod and smaller/rearward flap.
    3: {
        "floor": 0.455,
        "nose_top": 0.825,
        "rear_top": 0.865,
        "handle_z": 0.97,
        "wheel_r": 0.083,
        "pod_z": 0.357,
        "pod_r": 0.059,
        "pod_length": 0.35,
        "nozzle_z": 0.235,
        "seat_x": -0.34,
        "seat_width": 0.27,
    },
}


def prepare_textures():
    """Bake silver wire atlas, red lettered grip, and dark pod detail atlas."""
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont

    TEXTURES.mkdir(parents=True, exist_ok=True)
    # Atlas coords use top-left pixel space; gutters prevent sampling neighbours.
    atlas = Image.new("RGBA", (512, 512), (150, 163, 168, 0))
    draw = ImageDraw.Draw(atlas)

    def grid(rect, columns, rows, vertical_width=3, horizontal_width=3, wall=False):
        x0, y0, x1, y1 = rect
        for i in range(columns + 1):
            x = round(x0 + (x1 - x0) * i / columns)
            draw.line((x, y0, x, y1), fill=(86, 101, 108, 255), width=vertical_width)
            draw.line((x - 1, y0, x - 1, y1), fill=(217, 226, 229, 255), width=1)
        horizontal_levels = (
            [0.0, 0.11, 0.52, 0.90, 1.0]
            if wall
            else [i / rows for i in range(rows + 1)]
        )
        for level in horizontal_levels:
            y = round(y0 + (y1 - y0) * level)
            draw.line((x0, y, x1, y), fill=(100, 113, 119, 255), width=horizontal_width)
            draw.line((x0, y - 1, x1, y - 1), fill=(230, 235, 236, 255), width=1)

    grid((4, 4, 507, 185), 27, 3, wall=True)
    grid((4, 197, 249, 375), 16, 3, wall=True)
    grid((263, 197, 507, 375), 17, 3, wall=True)
    grid((4, 391, 379, 507), 26, 9, 2, 1)
    grid((393, 391, 507, 507), 7, 4, 1, 1)
    atlas.save(TEXTURES / "wire_grid.png")

    # The only text geometry in the asset is this baked texture, never font curves.
    grip = Image.new("RGB", (512, 128), (197, 12, 23))
    font_candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    font_path = next((p for p in font_candidates if Path(p).exists()), None)
    font = (
        ImageFont.truetype(font_path, 42)
        if font_path
        else ImageFont.load_default(size=42)
    )
    gd = ImageDraw.Draw(grip)
    gd.text((256, 64), "ORBIT MART", font=font, anchor="mm", fill=(255, 252, 245))
    grip.save(TEXTURES / "orbit_handle.png")

    rng = np.random.default_rng(8417)
    noise = rng.normal(0, 1.35, (256, 512, 1))
    base = np.clip(np.array([53, 57, 58])[None, None, :] + noise, 0, 255).astype(
        "uint8"
    )
    pod = Image.fromarray(base, "RGB")
    pd = ImageDraw.Draw(pod)
    # Upper half wraps the pod barrel. Lower half has endcap and solid swatches.
    for x in (65, 174, 338, 447):
        pd.line((x, 0, x, 126), fill=(29, 33, 35), width=2)
        pd.line((x + 2, 0, x + 2, 126), fill=(79, 84, 86), width=1)
    for y in (22, 86):
        pd.rounded_rectangle(
            (215, y, 297, y + 30),
            radius=4,
            fill=(64, 69, 71),
            outline=(27, 30, 31),
            width=2,
        )
        for x in (221, 291):
            for yy in (y + 5, y + 25):
                pd.ellipse((x - 2, yy - 2, x + 2, yy + 2), fill=(123, 129, 130))
    pd.rectangle((0, 136, 125, 255), fill=(43, 47, 48))
    pd.ellipse((6, 140, 118, 252), fill=(60, 65, 66), outline=(19, 23, 24), width=4)
    pd.ellipse((22, 156, 102, 236), fill=(41, 45, 46), outline=(96, 101, 102), width=2)
    for i in range(10):
        angle = i * math.tau / 10
        x, y = 62 + math.cos(angle) * 49, 196 + math.sin(angle) * 49
        pd.ellipse((x - 2, y - 2, x + 2, y + 2), fill=(151, 158, 158))
    pd.rectangle((136, 136, 254, 255), fill=(37, 41, 42))
    pd.rectangle((267, 136, 383, 255), fill=(11, 13, 14))
    pd.rectangle((394, 136, 511, 255), fill=(67, 72, 73))
    # Wheel-hub concentric recess is baked into the same small atlas/material.
    pd.ellipse((398, 142, 506, 250), fill=(67, 72, 73), outline=(17, 21, 22), width=3)
    pd.ellipse((403, 147, 501, 245), outline=(106, 113, 115), width=2)
    pd.ellipse((412, 156, 492, 236), fill=(53, 59, 61), outline=(29, 35, 37), width=2)
    pod.save(TEXTURES / "jet_details.png")
    print("TEXTURES: wire_grid 512x512 RGBA, orbit_handle 512x128, jet_details 512x256")


def make_sheet(revision):
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont

    directory = PREVIEW / f"pass_{revision:02d}"
    sheet = Image.new("RGB", (1440, 1540), (233, 237, 238))
    draw = ImageDraw.Draw(sheet)
    font_path = "/System/Library/Fonts/Supplemental/Arial.ttf"
    font = (
        ImageFont.truetype(font_path, 22)
        if Path(font_path).exists()
        else ImageFont.load_default()
    )
    small = ImageFont.truetype(font_path, 17) if Path(font_path).exists() else font
    draw.text(
        (28, 18),
        f"ORBIT MART / CART R4 / PROPORTION PASS {revision:02d}",
        font=font,
        fill=(27, 39, 43),
    )
    pairs = [("CT_01", "side"), ("CT_02", "front"), ("CT_03", "top")]
    for row, (reference, view) in enumerate(pairs):
        for col in range(2):
            path = (
                REFERENCE / (reference + ".png")
                if col == 0
                else directory / (view + ".png")
            )
            image = Image.open(path).convert("RGBA")
            if col == 0:
                rgb = np.asarray(image)[..., :3]
                yy, xx = np.where(rgb.min(axis=2) < 220)
                image = image.crop(
                    (
                        xx.min().item() - 5,
                        yy.min().item() - 5,
                        xx.max().item() + 6,
                        yy.max().item() + 6,
                    )
                )
            else:
                box = image.getchannel("A").getbbox()
                if box:
                    image = image.crop(box)
            image.thumbnail((660, 410), Image.Resampling.LANCZOS)
            x = col * 720 + (720 - image.width) // 2
            y = 98 + row * 480 + (410 - image.height) // 2
            # Keep the true independent aspect ratios: no stretching to force a match.
            sheet.paste(
                Image.new("RGB", (688, 418), "white"), (col * 720 + 16, 94 + row * 480)
            )
            sheet.paste(image, (x, y), image)
            label = (
                f"{reference} / reference"
                if col == 0
                else f"cart_r4 / {view} / exported GLB"
            )
            draw.text(
                (col * 720 + 30, 63 + row * 480), label, font=small, fill=(40, 53, 57)
            )
    draw.text(
        (28, 1516),
        "Orthographic. Side/top nose left. Front looks at +X nose. Physical dimensions take priority over inconsistent references.",
        font=small,
        fill=(60, 73, 77),
    )
    sheet.save(directory / "comparison.png")
    if revision == max(REVISIONS):
        shutil.copyfile(directory / "comparison.png", PREVIEW / "comparison.png")


def require(condition, message):
    """Verification stays enabled under python -O as well as ordinary execution."""
    if not condition:
        raise ValueError(message)


def verify_files():
    """Inspect the actual GLB buffers, not just pre-export Blender objects."""
    import numpy as np
    from PIL import Image

    data = GLB.read_bytes()
    magic, version, length = struct.unpack_from("<III", data)
    require(
        (magic, version, length) == (0x46546C67, 2, len(data)), "Invalid GLB 2.0 header"
    )
    jl, jt = struct.unpack_from("<II", data, 12)
    require(jt == 0x4E4F534A, "GLB JSON chunk missing")
    try:
        document = json.loads(data[20 : 20 + jl])
    except (ValueError, UnicodeError) as error:
        raise ValueError("GLB JSON chunk is invalid") from error
    bl, bt = struct.unpack_from("<II", data, 20 + jl)
    require(bt == 0x004E4942, "GLB binary chunk missing")
    require(
        all("uri" not in item for item in document["buffers"]),
        "External buffer dependency",
    )
    binary = data[28 + jl : 28 + jl + bl]

    def accessor(index):
        item = document["accessors"][index]
        view = document["bufferViews"][item["bufferView"]]
        dtype = np.dtype({5123: "<u2", 5125: "<u4", 5126: "<f4"}[item["componentType"]])
        width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[item["type"]]
        return np.ndarray(
            (item["count"], width),
            dtype=dtype,
            buffer=binary,
            offset=view.get("byteOffset", 0) + item.get("byteOffset", 0),
            strides=(view.get("byteStride", dtype.itemsize * width), dtype.itemsize),
        )

    positions, triangles, degenerate = [], 0, 0
    per_mesh, mesh_positions, wire_positions = {}, {}, []
    wire_triangles = 0
    for mesh in document["meshes"]:
        count = 0
        mesh_positions[mesh["name"]] = []
        for primitive in mesh["primitives"]:
            require(primitive.get("mode", 4) == 4, "Non-triangle primitive")
            xyz = accessor(primitive["attributes"]["POSITION"])
            indices = accessor(primitive["indices"]).ravel().reshape(-1, 3)
            require(
                np.isfinite(xyz).all() and indices.max() < len(xyz),
                "Invalid positions or indices",
            )
            area = np.cross(
                xyz[indices[:, 1]] - xyz[indices[:, 0]],
                xyz[indices[:, 2]] - xyz[indices[:, 0]],
            )
            degenerate += (np.linalg.norm(area, axis=1) < 1e-10).sum().item()
            count += len(indices)
            positions.append(xyz)
            mesh_positions[mesh["name"]].append(xyz)
            mat_name = document["materials"][primitive["material"]]["name"]
            if mat_name.startswith("wire"):
                wire_triangles += len(indices)
                if mesh["name"] == "cart_basket_mesh":
                    wire_positions.append(xyz)
        triangles += count
        per_mesh[mesh["name"]] = count
    for node in document["nodes"]:
        if "mesh" in node:
            require(
                not any(
                    key in node
                    for key in ("matrix", "translation", "rotation", "scale")
                ),
                f"Non-identity mesh transform: {node['name']}",
            )
    xyz = np.concatenate(positions)
    # Standard exporter conversion: Blender (x,y,z) -> glTF (x,z,-y).
    blender = xyz[:, [0, 2, 1]] * np.array([1, -1, 1])
    low, high = blender.min(axis=0), blender.max(axis=0)
    material_names = [material["name"] for material in document["materials"]]
    wire = [m for m in document["materials"] if m["name"].startswith("wire")]
    require(
        wire
        and all(m.get("alphaMode") == "MASK" and m.get("doubleSided") for m in wire),
        "Wire must be double-sided alpha MASK",
    )
    require(
        all(m.get("alphaMode", "OPAQUE") != "BLEND" for m in document["materials"]),
        "Unwanted alpha BLEND",
    )
    require(wire_triangles == 12, "Grid must be six quads, not modelled wires")
    images = []
    for image in document["images"]:
        require("bufferView" in image and "uri" not in image, "Image not embedded")
        view = document["bufferViews"][image["bufferView"]]
        offset = view.get("byteOffset", 0)
        im = Image.open(io.BytesIO(binary[offset : offset + view["byteLength"]]))
        require(max(im.size) <= 512, "Texture exceeds 512 px")
        images.append(
            {
                "name": image["name"],
                "pixels": list(im.size),
                "mode": im.mode,
                "embedded": True,
            }
        )
    nodes = [node["name"] for node in document["nodes"]]
    require(
        {
            "cart_basket",
            "cart_handle",
            "cart_wheels",
            "cart_jet",
            "jet_exhaust",
        }.issubset(nodes),
        "Required node missing",
    )
    require(
        triangles <= 3000 and len(material_names) <= 6 and degenerate == 0,
        "Budget or geometry check failed",
    )
    require(abs(low[2]) < 1e-6, "Ground origin is not Z=0")
    wheels = np.concatenate(mesh_positions["cart_wheels_mesh"])
    require(
        np.allclose((wheels.min(0) + wheels.max(0))[[0, 2]], 0, atol=1e-6),
        "Wheel footprint is not centred",
    )
    basket_wire = np.concatenate(wire_positions)
    wire_size = np.ptp(basket_wire, axis=0)[[0, 2, 1]].round(6).tolist()
    require(
        np.allclose(wire_size[:2], [0.95, 0.58], atol=1e-6), "Wrong basket dimensions"
    )
    exhaust = next(n for n in document["nodes"] if n["name"] == "jet_exhaust")
    q = np.asarray(exhaust["rotation"])
    local_down = np.asarray(
        [0, 1, 0]
    )  # Blender +Z becomes glTF +Y, including local basis.
    gltf_direction = local_down + 2 * np.cross(
        q[:3], np.cross(q[:3], local_down) + q[3] * local_down
    )
    require(
        np.allclose(gltf_direction, [0, -1, 0], atol=1e-6),
        "Jet node does not point down",
    )
    revision = next(n for n in document["nodes"] if n["name"] == "cart_basket")[
        "extras"
    ]["asset_revision"]
    if revision == 3:
        require(
            np.allclose(high - low, [1.15, 0.62, 1.0], atol=1e-6),
            "Final outer dimensions drifted",
        )
        require(
            np.allclose(exhaust["translation"], [0, 0.235, 0], atol=1e-6),
            "Final exhaust position drifted",
        )
    record = {
        "file": str(GLB.relative_to(ROOT)),
        "file_bytes": len(data),
        "bbox_min_blender_m": low.round(6).tolist(),
        "bbox_max_blender_m": high.round(6).tolist(),
        "dimensions_blender_xyz_m": (high - low).round(6).tolist(),
        "triangles": triangles,
        "degenerate_triangles": degenerate,
        "triangles_by_mesh": per_mesh,
        "materials": material_names,
        "wire_alpha_mode": wire[0]["alphaMode"],
        "wire_alpha_cutoff": wire[0].get("alphaCutoff", 0.5),
        "nodes": nodes,
        "embedded_textures": images,
        "jet_exhaust_gltf": exhaust,
        "basket_wire_dimensions_m": wire_size,
        "wire_triangles": wire_triangles,
        "jet_exhaust_direction_gltf": gltf_direction.round(6).tolist(),
    }
    (PREVIEW / "verification.json").write_text(json.dumps(record, indent=2) + "\n")
    print("GLB_VERIFY", json.dumps(record, indent=2))
    return record


def run_blender(args):
    import bmesh  # pyright: ignore[reportMissingImports] - supplied by Blender
    import bpy  # pyright: ignore[reportMissingImports] - supplied by Blender
    from mathutils import Vector  # pyright: ignore[reportMissingImports]

    python = shutil.which("python3") or "/opt/homebrew/bin/python3"
    PREVIEW.mkdir(parents=True, exist_ok=True)
    GLB.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if args.verify:
        bpy.ops.import_scene.gltf(filepath=str(GLB))
        meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
        points = [obj.matrix_world @ v.co for obj in meshes for v in obj.data.vertices]
        low = [min(p[i] for p in points) for i in range(3)]
        high = [max(p[i] for p in points) for i in range(3)]
        triangles, loose = 0, 0
        for obj in meshes:
            obj.data.calc_loop_triangles()
            triangles += len(obj.data.loop_triangles)
            loose += len(obj.data.vertices) - len(
                {v for p in obj.data.polygons for v in p.vertices}
            )
        exhaust = bpy.data.objects["jet_exhaust"]
        direction = (exhaust.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()
        require(
            (direction - Vector((0, 0, -1))).length < 1e-5,
            "Reimported jet axis not downward",
        )
        require(
            triangles <= 3000 and len(bpy.data.materials) <= 6 and loose == 0,
            "Reimport geometry/budget failed",
        )
        require(abs(low[2]) < 1e-6, "Reimported ground Z is not zero")
        record = {
            "bbox_min_m": [round(v, 6) for v in low],
            "bbox_max_m": [round(v, 6) for v in high],
            "dimensions_m": [round(high[i] - low[i], 6) for i in range(3)],
            "triangles": triangles,
            "loose_vertices": loose,
            "materials": [m.name for m in bpy.data.materials],
            "nodes": [obj.name for obj in bpy.context.scene.objects],
            "jet_exhaust_position_m": [
                round(v, 6) for v in exhaust.matrix_world.translation
            ],
            "jet_exhaust_local_positive_z_world": [round(v, 6) for v in direction],
        }
        (PREVIEW / "reimport_verification.json").write_text(
            json.dumps(record, indent=2) + "\n"
        )
        print("BLENDER_REIMPORT", json.dumps(record, indent=2))
        subprocess.run(
            [python, str(Path(__file__).resolve()), "--verify-files"], check=True
        )
        return

    subprocess.run(
        [python, str(Path(__file__).resolve()), "--prepare-textures"], check=True
    )
    cfg = REVISIONS[args.revision]
    groups = {
        name: []
        for name in (
            "cart_basket",
            "cart_frame",
            "cart_handle",
            "cart_child_seat",
            "cart_wheels",
            "cart_jet",
        )
    }
    group = "cart_basket"

    def linear(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    def material(name, rgb, roughness, metallic=0.0, texture=None, masked=False):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (*(linear(v) for v in rgb), 1)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        if texture:
            tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
            tex.image = bpy.data.images.load(
                str(TEXTURES / texture), check_existing=True
            )
            tex.image.pack()
            tex.extension = "EXTEND"
            mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            if masked:
                # Blender 4.5 glTF recognizes this explicit threshold as alphaMode MASK.
                clip = mat.node_tree.nodes.new("ShaderNodeMath")
                clip.operation = "GREATER_THAN"
                clip.inputs[1].default_value = 0.45
                mat.node_tree.links.new(tex.outputs["Alpha"], clip.inputs[0])
                mat.node_tree.links.new(clip.outputs[0], bsdf.inputs["Alpha"])
                mat.surface_render_method = "DITHERED"
                mat.use_backface_culling = False
        return mat

    chrome = material("chrome_satin_steel", (0.68, 0.73, 0.75), 0.29, 0.72)
    wire = material(
        "wire_grid_mask", (0.62, 0.67, 0.69), 0.39, 0.30, "wire_grid.png", True
    )
    red = material(
        "red_ORBIT_MART_plastic", (0.78, 0.04, 0.08), 0.30, 0.0, "orbit_handle.png"
    )
    rubber = material("rubber_castor_tread", (0.055, 0.063, 0.067), 0.80)
    graphite = material(
        "graphite_jet_and_hubs", (0.17, 0.19, 0.20), 0.44, 0.48, "jet_details.png"
    )
    default_uv = {red.name: (0.015, 0.015), graphite.name: (0.38, 0.22)}

    def mesh(name, verts, faces, mat, uvs=None, smooth=False):
        data = bpy.data.meshes.new(name)
        data.from_pydata(verts, [], faces)
        data.update()
        data.materials.append(mat)
        uv = data.uv_layers.new(name="UVMap")
        for i, polygon in enumerate(data.polygons):
            polygon.use_smooth = smooth and len(polygon.vertices) == 4
            coords = (
                uvs[i]
                if uvs
                else [default_uv.get(mat.name, (0.5, 0.5))] * len(polygon.vertices)
            )
            for loop, coord in zip(polygon.loop_indices, coords, strict=True):
                uv.data[loop].uv = coord
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        groups[group].append(obj)
        return obj

    def panel(name, vertices, region):
        x0, y0, x1, y1 = region
        # World-planar mapping keeps every wire straight across a triangulated
        # trapezoid. Mapping its four corners to a rectangle bends wires at the
        # hidden diagonal, a conspicuous defect discovered in pass 01.
        spans = [
            max(v[i] for v in vertices) - min(v[i] for v in vertices) for i in range(3)
        ]
        ua, va = (0, 1) if spans[2] < 1e-6 else ((1, 2) if spans[0] < 0.1 else (0, 2))
        umin, vmin = min(v[ua] for v in vertices), min(v[va] for v in vertices)
        uv = [
            (
                (x0 + (p[ua] - umin) / spans[ua] * (x1 - x0)) / 512,
                1 - (y1 - (p[va] - vmin) / spans[va] * (y1 - y0)) / 512,
            )
            for p in vertices
        ]
        return mesh(name, vertices, [(0, 1, 2, 3)], wire, [uv])

    def box(name, centre, dimensions, mat, bevel=0.0):
        x, y, z = centre
        dx, dy, dz = [v / 2 for v in dimensions]
        vertices = [
            (x + sx * dx, y + sy * dy, z + sz * dz)
            for sz in (-1, 1)
            for sy in (-1, 1)
            for sx in (-1, 1)
        ]
        faces = [
            (0, 2, 3, 1),
            (4, 5, 7, 6),
            (0, 1, 5, 4),
            (1, 3, 7, 5),
            (3, 2, 6, 7),
            (2, 0, 4, 6),
        ]
        obj = mesh(name, vertices, faces, mat)
        if bevel:
            bpy.context.view_layer.objects.active = obj
            mod = obj.modifiers.new("small_moulded_bevel", "BEVEL")
            mod.width, mod.segments = bevel, 1
            bpy.ops.object.modifier_apply(modifier=mod.name)
        return obj

    def tube(name, points, radius, mat, n=6, closed=False):
        points = [Vector(p) for p in points]
        vertices = []
        for i, p in enumerate(points):
            before = points[(i - 1) % len(points)] if i or closed else p
            after = (
                points[(i + 1) % len(points)] if i < len(points) - 1 or closed else p
            )
            tangent = (after - before).normalized()
            u = Vector((0, 0, 1))
            u -= tangent * tangent.dot(u)
            if u.length < 0.01:
                u = Vector((0, 1, 0))
                u -= tangent * tangent.dot(u)
            u.normalize()
            v = tangent.cross(u).normalized()
            vertices.extend(
                tuple(
                    p
                    + radius
                    * (u * math.cos(math.tau * j / n) + v * math.sin(math.tau * j / n))
                )
                for j in range(n)
            )
        faces = []
        for i in range(len(points) if closed else len(points) - 1):
            a, b = i * n, ((i + 1) % len(points)) * n
            faces.extend(
                (a + j, a + (j + 1) % n, b + (j + 1) % n, b + j) for j in range(n)
            )
        if not closed:
            faces.extend(
                [
                    tuple(reversed(range(n))),
                    tuple(range((len(points) - 1) * n, len(points) * n)),
                ]
            )
        return mesh(name, vertices, faces, mat, smooth=True)

    def lathe(
        name, origin, axis, profile, mat, n=12, cap=True, body_uv=False, end_uv=False
    ):
        axis = Vector(axis).normalized()
        u = axis.cross(Vector((0, 0, 1)))
        if u.length < 0.01:
            u = Vector((1, 0, 0))
        u.normalize()
        v = axis.cross(u).normalized()
        origin = Vector(origin)
        vertices = [
            tuple(
                origin
                + axis * t
                + r * (u * math.cos(math.tau * j / n) + v * math.sin(math.tau * j / n))
            )
            for t, r in profile
            for j in range(n)
        ]
        faces, uvs = [], []
        for i in range(len(profile) - 1):
            for j in range(n):
                faces.append(
                    (
                        i * n + j,
                        i * n + (j + 1) % n,
                        (i + 1) * n + (j + 1) % n,
                        (i + 1) * n + j,
                    )
                )
                if body_uv:
                    a = (profile[i][0] - profile[0][0]) / (
                        profile[-1][0] - profile[0][0]
                    )
                    b = (profile[i + 1][0] - profile[0][0]) / (
                        profile[-1][0] - profile[0][0]
                    )
                    uvs.append(
                        [
                            (a, 0.51 + j / n * 0.48),
                            (a, 0.51 + (j + 1) / n * 0.48),
                            (b, 0.51 + (j + 1) / n * 0.48),
                            (b, 0.51 + j / n * 0.48),
                        ]
                    )
                else:
                    uvs.append([default_uv.get(mat.name, (0.5, 0.5))] * 4)
        if cap:
            for start, reverse in ((0, True), (len(profile) - 1, False)):
                indices = list(range(n))
                if reverse:
                    indices.reverse()
                faces.append(tuple(start * n + j for j in indices))
                uvs.append(
                    [
                        (
                            62 / 512 + math.cos(math.tau * j / n) * 56 / 512,
                            1 - 196 / 256 + math.sin(math.tau * j / n) * 56 / 256,
                        )
                        for j in indices
                    ]
                    if end_uv
                    else [default_uv.get(mat.name, (0.5, 0.5))] * n
                )
        return mesh(name, vertices, faces, mat, uvs, smooth=True)

    def cylinder(name, a, b, radius, mat, n=8):
        vector = Vector(b) - Vector(a)
        return lathe(name, a, vector, [(0, radius), (vector.length, radius)], mat, n)

    def rim(name, x0, x1, rear_width, front_width, z0, z1, radius, mat):
        def point(x, sign):
            t = (x - x0) / (x1 - x0)
            return (
                x,
                sign * (rear_width + (front_width - rear_width) * t) / 2,
                z0 + (z1 - z0) * t,
            )

        corners = [
            Vector(point(x0, -1)),
            Vector(point(x1, -1)),
            Vector(point(x1, 1)),
            Vector(point(x0, 1)),
        ]
        rounded = []
        for i, corner in enumerate(corners):
            rounded.extend(
                [
                    corner + (corners[(i - 1) % 4] - corner).normalized() * 0.018,
                    corner + (corners[(i + 1) % 4] - corner).normalized() * 0.018,
                ]
            )
        return tube(name, rounded, radius, mat, closed=True)

    floor = cfg["floor"]
    # The walls are four trapezoids, the floor is a fifth: ten triangles total.
    rear_x, nose_x = -0.435, 0.515
    bottom_rear, bottom_nose = -0.36, 0.455
    for sign in (-1, 1):
        panel(
            "basket_side_alpha",
            [
                (bottom_rear, sign * 0.245, floor),
                (bottom_nose, sign * 0.227, floor),
                (nose_x, sign * 0.267, cfg["nose_top"]),
                (rear_x, sign * 0.29, cfg["rear_top"]),
            ],
            (4, 4, 507, 185),
        )
    panel(
        "basket_nose_alpha",
        [
            (bottom_nose, -0.227, floor),
            (bottom_nose, 0.227, floor),
            (nose_x, 0.267, cfg["nose_top"]),
            (nose_x, -0.267, cfg["nose_top"]),
        ],
        (4, 197, 249, 375),
    )
    panel(
        "basket_rear_gate_alpha",
        [
            (bottom_rear, 0.245, floor),
            (bottom_rear, -0.245, floor),
            (rear_x, -0.29, cfg["rear_top"]),
            (rear_x, 0.29, cfg["rear_top"]),
        ],
        (263, 197, 507, 375),
    )
    panel(
        "basket_floor_alpha",
        [
            (bottom_rear, -0.245, floor),
            (bottom_nose, -0.227, floor),
            (bottom_nose, 0.227, floor),
            (bottom_rear, 0.245, floor),
        ],
        (4, 391, 379, 507),
    )
    rim(
        "top_structural_rim",
        rear_x,
        nose_x,
        0.58,
        0.534,
        cfg["rear_top"],
        cfg["nose_top"],
        0.006,
        chrome,
    )
    rim(
        "floor_structural_rim",
        bottom_rear,
        bottom_nose,
        0.49,
        0.454,
        floor,
        floor,
        0.005,
        chrome,
    )
    for sign in (-1, 1):
        tube(
            "nose_corner_rail",
            [
                (bottom_nose, sign * 0.227, floor),
                (nose_x, sign * 0.267, cfg["nose_top"]),
            ],
            0.004,
            chrome,
        )
        # One contiguous L cap avoids the coplanar overlap of two little boxes.
        xy = [
            (0.449, 0.251),
            (0.495, 0.251),
            (0.495, 0.205),
            (0.535, 0.205),
            (0.535, 0.287),
            (0.449, 0.287),
        ]
        verts = [
            (x, sign * y, cfg["nose_top"] + dz) for dz in (-0.021, 0.025) for x, y in xy
        ]
        faces = [tuple(reversed(range(6))), tuple(range(6, 12))]
        faces += [(i, (i + 1) % 6, (i + 1) % 6 + 6, i + 6) for i in range(6)]
        cap = mesh("red_moulded_L_corner", verts, faces, red)
        bpy.context.view_layer.objects.active = cap
        bevel = cap.modifiers.new("rounded_plastic_edges", "BEVEL")
        bevel.width, bevel.segments = 0.004, 1
        bpy.ops.object.modifier_apply(modifier=bevel.name)

    group = "cart_frame"
    rim("lower_tray_frame", -0.465, 0.465, 0.51, 0.49, 0.216, 0.216, 0.010, chrome)
    panel(
        "lower_tray_alpha",
        [
            (-0.455, -0.245, 0.217),
            (0.455, -0.235, 0.217),
            (0.455, 0.235, 0.217),
            (-0.455, 0.245, 0.217),
        ],
        (393, 391, 507, 507),
    )
    for sign in (-1, 1):
        tube(
            "bent_cantilever_leg",
            [
                (-0.44, sign * 0.248, 0.216),
                (-0.438, sign * 0.248, 0.26),
                (-0.25, sign * 0.245, floor - 0.025),
                (-0.21, sign * 0.245, floor - 0.01),
                (0.42, sign * 0.227, floor - 0.01),
            ],
            0.012,
            chrome,
            8,
        )
        tube(
            "basket_underfloor_crossrail",
            [
                (-0.22, sign * 0.245, floor - 0.012),
                (-0.36, sign * 0.245, floor - 0.012),
            ],
            0.010,
            chrome,
        )

    group = "cart_handle"
    for sign in (-1, 1):
        tube(
            "rear_handle_upright",
            [
                (-0.355, sign * 0.248, floor),
                (-0.49, sign * 0.282, cfg["rear_top"] + 0.025),
                (-0.55, sign * 0.282, cfg["handle_z"] - 0.018),
                (-0.585, sign * 0.282, cfg["handle_z"]),
            ],
            0.011,
            chrome,
            8,
        )
        cylinder(
            "red_grip_endcap",
            (-0.585, sign * 0.263, cfg["handle_z"]),
            (-0.585, sign * 0.31, cfg["handle_z"]),
            0.030,
            red,
            12,
        )
        cylinder(
            "handle_endcap_rivet",
            (-0.613, sign * 0.281, cfg["handle_z"]),
            (-0.615, sign * 0.281, cfg["handle_z"]),
            0.005,
            chrome,
            6,
        )
        tube(
            "basket_to_handle_clip",
            [
                (-0.435, sign * 0.287, cfg["rear_top"]),
                (-0.48, sign * 0.282, cfg["rear_top"] + 0.004),
            ],
            0.007,
            chrome,
        )
        box(
            "rear_gate_hinge",
            (-0.443, sign * 0.286, cfg["rear_top"]),
            (0.025, 0.024, 0.030),
            chrome,
        )
    grip = cylinder(
        "red_lettered_grip",
        (-0.585, -0.267, cfg["handle_z"]),
        (-0.585, 0.267, cfg["handle_z"]),
        0.022,
        red,
        16,
    )
    # Assign complete faces, never individual vertices, to the top label strip.
    # Otherwise interpolation from swatch UVs creates false white streaks.
    for polygon in grip.data.polygons:
        if len(polygon.vertices) != 4:
            continue
        centre = polygon.center
        top_arc = abs(math.atan2(centre.x + 0.585, centre.z - cfg["handle_z"])) < 1.18
        for loop in polygon.loop_indices:
            x, y, z = grip.data.vertices[grip.data.loops[loop].vertex_index].co
            angle = math.atan2(x + 0.585, z - cfg["handle_z"])
            uv = ((y + 0.267) / 0.534, 0.5 - angle / (math.pi * 0.75))
            grip.data.uv_layers.active.data[loop].uv = uv if top_arc else (0.015, 0.015)

    group = "cart_child_seat"
    seat_z = floor + 0.235
    box(
        "red_fold_down_seat",
        (cfg["seat_x"], 0, seat_z),
        (0.13, cfg["seat_width"], 0.019),
        red,
        0.004,
    )
    for sign in (-1, 1):
        tube(
            "child_seat_support",
            [
                (-0.41, sign * 0.18, cfg["rear_top"] + 0.055),
                (-0.27, sign * 0.18, cfg["rear_top"] + 0.04),
                (-0.245, sign * 0.18, seat_z - 0.013),
                (-0.37, sign * 0.18, seat_z - 0.013),
            ],
            0.004,
            chrome,
        )
    tube(
        "child_seat_top_crossrail",
        [(-0.27, -0.18, cfg["rear_top"] + 0.04), (-0.27, 0.18, cfg["rear_top"] + 0.04)],
        0.004,
        chrome,
    )

    group = "cart_wheels"
    r = cfg["wheel_r"]
    for x in (-0.405, 0.405):
        for y in (-0.253, 0.253):
            # Symmetric actual tire footprint, regardless of trailing swivel offset.
            lathe(
                "castor_tire",
                (x, y, r),
                (0, 1, 0),
                [
                    (-0.025, r * 0.60),
                    (-0.025, r * 0.80),
                    (-0.017, r),
                    (0.017, r),
                    (0.025, r * 0.80),
                    (0.025, r * 0.60),
                ],
                rubber,
                16,
                cap=False,
            )
            hub = cylinder(
                "castor_hub",
                (x, y - 0.0255, r),
                (x, y + 0.0255, r),
                r * 0.62,
                graphite,
                16,
            )
            for polygon in hub.data.polygons:
                if len(polygon.vertices) == 4:
                    continue
                for loop in polygon.loop_indices:
                    vx, _, vz = hub.data.vertices[hub.data.loops[loop].vertex_index].co
                    hub.data.uv_layers.active.data[loop].uv = (
                        (452 + (vx - x) / (r * 0.62) * 54) / 512,
                        1 - (196 + (vz - r) / (r * 0.62) * 54) / 256,
                    )
            cylinder(
                "castor_axle", (x, y - 0.040, r), (x, y + 0.040, r), 0.009, chrome, 8
            )
            for sign in (-1, 1):
                # Broad stamped fork plates, not spindly round rods.
                profile = [
                    (x - 0.014, r - 0.009),
                    (x + 0.014, r - 0.009),
                    (x + 0.050, 0.185),
                    (x, 0.185),
                ]
                vertices = [
                    (xx, y + sign * 0.033 + dy, zz)
                    for dy in (-0.0035, 0.0035)
                    for xx, zz in profile
                ]
                faces = [(3, 2, 1, 0), (4, 5, 6, 7)]
                faces += [(j, (j + 1) % 4, (j + 1) % 4 + 4, j + 4) for j in range(4)]
                mesh("castor_stamped_fork", vertices, faces, chrome)
            cylinder(
                "castor_swivel_bearing",
                (x + 0.025, y, 0.183),
                (x + 0.025, y, 0.207),
                0.028,
                chrome,
                8,
            )
            box(
                "castor_mount_plate",
                (x + 0.025, y, 0.208),
                (0.062, 0.060, 0.009),
                chrome,
            )

    group = "cart_jet"
    pod_z, pod_r, length = cfg["pod_z"], cfg["pod_r"], cfg["pod_length"]
    half = length / 2
    lathe(
        "cold_gas_barrel",
        (0, 0, pod_z),
        (1, 0, 0),
        [
            (-half, pod_r * 0.73),
            (-half + 0.018, pod_r),
            (half - 0.018, pod_r),
            (half, pod_r * 0.73),
        ],
        graphite,
        12,
        body_uv=True,
        end_uv=True,
    )
    for sign in (-1, 1):
        x = sign * (half - 0.055)
        lathe(
            "jet_clamp_band",
            (x, 0, pod_z),
            (1, 0, 0),
            [(-0.008, pod_r + 0.002), (0.008, pod_r + 0.002)],
            chrome,
            12,
            cap=False,
        )
        box(
            "jet_clamp_to_floor",
            (x, 0, (floor + pod_z + pod_r) / 2),
            (0.026, 0.052, floor - pod_z - pod_r + 0.012),
            chrome,
        )
        for y in (-0.046, 0.046):
            cylinder(
                "jet_clamp_bolt",
                (x, y, pod_z + pod_r * 0.40),
                (x, y, pod_z + pod_r + 0.012),
                0.004,
                chrome,
                6,
            )
    neck_z = pod_z - pod_r - 0.007
    cylinder("nozzle_neck", (0, 0, neck_z), (0, 0, neck_z + 0.016), 0.028, chrome, 12)
    # Open nozzle ring with a recessed dark throat, never a capped flat grey disk.
    exit_z = cfg["nozzle_z"]
    lathe(
        "downward_nozzle",
        (0, 0, 0),
        (0, 0, 1),
        [(exit_z + 0.025, 0.015), (exit_z, 0.034), (exit_z, 0.040), (neck_z, 0.023)],
        graphite,
        12,
        cap=False,
    )
    throat = cylinder(
        "recessed_nozzle_throat",
        (0, 0, exit_z + 0.023),
        (0, 0, exit_z + 0.025),
        0.015,
        graphite,
        12,
    )
    for item in throat.data.uv_layers.active.data:
        item.uv = (0.63, 0.23)

    # Join by meaningful function, not into one anonymous mesh. Object transforms
    # remain identity, simplifying the runtime and the independent buffer audit.
    final_objects = []
    for name, objects in groups.items():
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        obj = bpy.context.object
        obj.name = name
        obj.data.name = name + "_mesh"
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
        bm.to_mesh(obj.data)
        bm.free()
        obj.data.update()
        final_objects.append(obj)
    attachment = bpy.data.objects.new("jet_exhaust", None)
    bpy.context.collection.objects.link(attachment)
    attachment.empty_display_type = "SINGLE_ARROW"
    attachment.empty_display_size = 0.065
    attachment.location = (0, 0, exit_z)
    attachment.rotation_euler = (math.pi, 0, 0)
    attachment.parent = bpy.data.objects["cart_jet"]
    attachment["purpose"] = (
        "Flame attachment; Blender local +Z / glTF local +Y points outward/downward"
    )
    attachment["axis_local_blender"] = "+Z"
    attachment["axis_local_gltf"] = "+Y"
    attachment["direction_blender"] = [0, 0, -1]
    attachment["direction_gltf"] = [0, -1, 0]
    bpy.data.objects["cart_basket"]["asset_revision"] = args.revision
    bpy.data.objects["cart_basket"]["forward_axis"] = "+X nose / -X handle"
    bpy.data.objects["cart_basket"]["origin"] = (
        "Ground centre of four tire contact patches"
    )
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0
    bpy.ops.object.select_all(action="DESELECT")
    for obj in final_objects + [attachment]:
        obj.select_set(True)
    triangles = sum(len(obj.data.polygons) for obj in final_objects)
    print("BUILD", args.revision, triangles, "triangles")
    require(triangles <= 3000, f"Triangle budget exceeded: {triangles}")
    bpy.ops.export_scene.gltf(
        filepath=str(GLB),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        export_materials="EXPORT",
    )
    subprocess.run(
        [python, str(Path(__file__).resolve()), "--verify-files"], check=True
    )
    if args.no_previews:
        return
    # Render a fresh import: sheets show what the GLB contains, not hidden source features.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB))
    render_views(args.revision)
    subprocess.run(
        [
            python,
            str(Path(__file__).resolve()),
            "--sheets",
            "--revision",
            str(args.revision),
        ],
        check=True,
    )


def render_views(revision):
    import bpy  # pyright: ignore[reportMissingImports]
    from mathutils import Vector  # pyright: ignore[reportMissingImports]

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48 if revision == 3 else 24
    scene.cycles.use_denoising = True
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.world = bpy.data.worlds.new("White product studio")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (
        0.78,
        0.81,
        0.83,
        1,
    )
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.65
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    for position, energy, size in [
        ((1, 3, 4), 300, 3),
        ((-3, -2, 2), 220, 2),
        ((3, -3, 1), 130, 2),
    ]:
        data = bpy.data.lights.new("studio_softbox", "AREA")
        data.energy, data.shape, data.size = energy, "DISK", size
        obj = bpy.data.objects.new("studio_softbox", data)
        scene.collection.objects.link(obj)
        obj.location = position
        obj.rotation_euler = (
            (Vector((0, 0, 0.5)) - obj.location).to_track_quat("-Z", "Y").to_euler()
        )
    camera_data = bpy.data.cameras.new("Orthographic reference camera")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("Orthographic reference camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    directory = PREVIEW / f"pass_{revision:02d}"
    directory.mkdir(parents=True, exist_ok=True)
    points = [
        obj.matrix_world @ vertex.co
        for obj in scene.objects
        if obj.type == "MESH"
        for vertex in obj.data.vertices
    ]
    centre = Vector(
        tuple(
            (max(p[i] for p in points) + min(p[i] for p in points)) / 2
            for i in range(3)
        )
    )
    for name, offset, up, resolution in [
        ("side", (0, 5, 0), "Y", (1280, 960)),
        ("front", (5, 0, 0), "Y", (960, 1100)),
        ("top", (0, 0, 5), "-X", (1280, 850)),
        ("threequarter", (3.7, 5.2, 2.8), "Y", (1280, 1100)),
    ]:
        camera.location = centre + Vector(offset)
        direction = centre - camera.location
        # Top looks down -Z with image-right = world -X: nose points left.
        camera.rotation_euler = (
            (0, 0, math.pi)
            if name == "top"
            else direction.to_track_quat("-Z", up).to_euler()
        )
        scene.render.resolution_x, scene.render.resolution_y = resolution
        bpy.context.view_layer.update()
        inverse = camera.matrix_world.inverted()
        projected = [inverse @ point for point in points]
        width = max(p.x for p in projected) - min(p.x for p in projected)
        height = max(p.y for p in projected) - min(p.y for p in projected)
        camera_data.ortho_scale = (
            max(width, height * resolution[0] / resolution[1]) * 1.12
        )
        scene.render.filepath = str(directory / (name + ".png"))
        bpy.ops.render.render(write_still=True)
    print("RENDERS", directory)


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--revision", type=int, choices=sorted(REVISIONS), default=max(REVISIONS)
    )
    parser.add_argument("--prepare-textures", action="store_true")
    parser.add_argument("--sheets", action="store_true")
    parser.add_argument("--no-previews", action="store_true")
    parser.add_argument("--verify-files", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args(argv)
    if args.prepare_textures:
        prepare_textures()
    elif args.sheets:
        make_sheet(args.revision)
    elif args.verify_files:
        verify_files()
    else:
        run_blender(args)


if __name__ == "__main__":
    main()
