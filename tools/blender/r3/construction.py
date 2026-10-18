"""Reference-driven construction props for Late Roadster (metres, Blender Z-up).

  /opt/homebrew/bin/blender -b -P tools/blender/r3/construction.py -- --asset all
  /opt/homebrew/bin/blender -b -P tools/blender/r3/construction.py -- --asset excavator
  /opt/homebrew/bin/blender -b -P tools/blender/r3/construction.py -- --verify-only

Assets: barrier, sign, arrowboard, excavator, plates, all. Requires system Python
with Pillow/numpy (override --python). Read-only references: round3/CZ_01..05.
Only writes the four assigned GLBs, CZ_05.webp, this task's preview directory,
and /tmp/r3-construction. Embedded PNG atlases are <=1024px. Photographic side
UVs retain the reference projection; unseen surfaces use matching atlas swatches.
The sign and arrow board face -X; excavator and trailer tongue point +X.
Static meshes are batched into one object per prop (at most four draw materials).
"""

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "research/raycity/generated/2026-10-17-round3"
PREVIEW = ROOT / "research/raycity/r3-assets/construction"
OUT = ROOT / "public/assets/gen"
SCRATCH = Path("/tmp/r3-construction")
ASSETS = ["barrier", "sign", "arrowboard", "excavator"]
IDS = dict(zip(ASSETS, ["CZ_01", "CZ_02", "CZ_03", "CZ_04"]))
argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--asset", choices=ASSETS + ["all", "plates"], default="all")
p.add_argument("--python", default="/opt/homebrew/bin/python3")
p.add_argument("--prepare", action="store_true")
p.add_argument("--sheets", action="store_true")
p.add_argument("--verify-only", action="store_true")
p.add_argument("--skip-previews", action="store_true")
ARGS = p.parse_args(argv)
for directory in [PREVIEW, OUT, SCRATCH]:
    directory.mkdir(parents=True, exist_ok=True)


def image_prepare():
    """Run in system Python: background tolerance, RGB defringe, PNG atlases."""
    import numpy as np
    from PIL import Image, ImageDraw

    chosen = ASSETS if ARGS.asset == "all" else [ARGS.asset]
    info = {}
    swatches = [
        (231, 83, 4),
        (233, 231, 220),
        (40, 43, 44),
        (135, 146, 149),
        (242, 181, 0),
        (68, 67, 60),
        (185, 195, 195),
        (8, 10, 11),
    ]
    for asset in chosen:
        if asset not in ASSETS:
            continue
        original = Image.open(SOURCE / (IDS[asset] + ".png")).convert("RGB")
        a = np.asarray(original).copy()
        # Key near-white connected to the image perimeter, not white paint or lettering.
        candidate = (a.min(2) >= 242) & (a.max(2).astype(int) - a.min(2) < 17)
        mask = Image.fromarray(np.where(candidate, 255, 0).astype("uint8"))
        for point in [
            (0, 0),
            (a.shape[1] - 1, 0),
            (0, a.shape[0] - 1),
            (a.shape[1] - 1, a.shape[0] - 1),
        ]:
            if mask.getpixel(point) == 255:
                ImageDraw.floodfill(mask, point, 128, thresh=0)
        opaque = np.asarray(mask) != 128
        # Propagate foreground RGB into the transparent fringe before resampling.
        valid = opaque.copy()
        color = a.astype("float32")
        for _ in range(10):
            counts = np.zeros(valid.shape, dtype="float32")
            sums = np.zeros(color.shape, dtype="float32")
            for dy, dx in [(0, -1), (0, 1), (-1, 0), (1, 0)]:
                v = np.roll(valid, (dy, dx), (0, 1))
                counts += v
                sums += np.roll(color, (dy, dx), (0, 1)) * v[..., None]
            new = (~valid) & (counts > 0)
            color[new] = sums[new] / counts[new, None]
            valid[new] = True
        color[~valid] = 0
        rgba = np.dstack(
            [np.clip(color, 0, 255).astype("uint8"), opaque.astype("uint8") * 255]
        )
        keyed = Image.fromarray(rgba)
        # Reserve the lower 64 pixels for flat surface swatches; fit entire reference above.
        scale = min(1024 / keyed.width, 940 / keyed.height)
        nw, nh = round(keyed.width * scale), round(keyed.height * scale)
        resized = keyed.resize((nw, nh), Image.Resampling.LANCZOS)
        atlas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
        atlas.paste(resized, (0, 0))
        draw = ImageDraw.Draw(atlas)
        for i, col in enumerate(swatches):
            draw.rectangle((128 * i, 960, 128 * i + 127, 1023), fill=(*col, 255))
        atlas.save(SCRATCH / (asset + ".png"))
        info[asset] = {
            "source_size": list(original.size),
            "atlas_picture_size": [nw, nh],
        }
        if asset == "arrowboard":
            board = original.crop((300, 30, 1148, 502))
            led = np.asarray(board).astype("float32")
            # Keep only bright amber emitters, not the halo or dark board.
            strength = np.minimum((led[:, :, 0] - 220) / 25, (led[:, :, 1] - 120) / 80)
            strength = np.minimum(strength, (180 - led[:, :, 2]) / 60)
            alpha = np.clip(strength, 0, 1)
            led[:, :, :3] = np.maximum(led, [255, 170, 0])
            led = Image.fromarray(
                np.dstack(
                    [
                        np.clip(led, 0, 255).astype("uint8"),
                        (alpha * 255).astype("uint8"),
                    ]
                )
            )
            led.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
            led.save(SCRATCH / "led_arrow.png")
    if info:
        existing = SCRATCH / "atlas_info.json"
        old = json.loads(existing.read_text()) if existing.exists() else {}
        old.update(info)
        existing.write_text(json.dumps(old, indent=2))
    if ARGS.asset in ["all", "plates"]:
        image = Image.open(SOURCE / "CZ_05.png").convert("RGB")
        image.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
        a = np.asarray(image).astype("float64")

        def seams(x):
            return {
                "LR": float(abs(x[:, 0] - x[:, -1]).mean()),
                "TB": float(abs(x[0] - x[-1]).mean()),
                "neighbour_x": float(abs(x[:, 1:] - x[:, :-1]).mean()),
                "neighbour_y": float(abs(x[1:] - x[:-1]).mean()),
            }

        before = seams(a)
        h, w = a.shape[:2]
        # Periodic-plus-smooth decomposition: remove the harmonic boundary jump,
        # retaining the plates, rust and high-frequency asphalt texture everywhere.
        v = np.zeros_like(a)
        v[0] = a[-1] - a[0]
        v[-1] = a[0] - a[-1]
        v[:, 0] += a[:, -1] - a[:, 0]
        v[:, -1] += a[:, 0] - a[:, -1]
        den = (
            2 * np.cos(2 * np.pi * np.arange(h) / h)[:, None]
            + 2 * np.cos(2 * np.pi * np.arange(w) / w)[None, :]
            - 4
        )
        den[0, 0] = 1
        smooth_f = np.fft.fft2(v, axes=(0, 1)) / den[..., None]
        smooth_f[0, 0] = 0
        periodic = a - np.fft.ifft2(smooth_f, axes=(0, 1)).real
        # Equalize only the narrow edge strips; smooth cosine falloff prevents a band.
        for axis in [1, 0]:
            b = np.swapaxes(periodic, 0, axis).copy()
            for i in range(12):
                weight = 0.5 * (1 + math.cos(math.pi * i / 12)) / 2
                left, right = b[i].copy(), b[-1 - i].copy()
                b[i] = left * (1 - weight) + right * weight
                b[-1 - i] = right * (1 - weight) + left * weight
            periodic = np.swapaxes(b, 0, axis)
        result = Image.fromarray(np.clip(periodic, 0, 255).astype("uint8"))
        texture_out = ROOT / "public/assets/photo/CZ_05.webp"
        texture_out.parent.mkdir(parents=True, exist_ok=True)
        result.save(texture_out, format="WEBP", quality=88, method=6)
        decoded = Image.open(texture_out).convert("RGB")
        after = seams(np.asarray(decoded).astype("float64"))
        report = {
            "metric": "mean absolute RGB difference, 0..255; after measured on decoded WebP",
            "before": before,
            "after": after,
            "dimensions_px": list(decoded.size),
            "file_bytes": texture_out.stat().st_size,
            "method": "periodic-plus-smooth Fourier decomposition + 12px cosine edge equalization",
        }
        (PREVIEW / "CZ_05_seams.json").write_text(json.dumps(report, indent=2))
        tile = decoded.resize((480, 480), Image.Resampling.LANCZOS)
        contact = Image.new("RGB", (960, 960))
        for x in [0, 480]:
            for y in [0, 480]:
                contact.paste(tile, (x, y))
        contact.save(PREVIEW / "CZ_05_tiled.png")
        comparison = Image.new("RGB", (1000, 540), "#eeeeee")
        d = ImageDraw.Draw(comparison)
        for x, im, label in [
            (10, image, "Reference"),
            (510, decoded, "Seamless WebP, Q88"),
        ]:
            im = im.copy()
            im.thumbnail((480, 480), Image.Resampling.LANCZOS)
            comparison.paste(im, (x, 30))
            d.text((x, 10), label, fill="black")
        d.text(
            (10, 518),
            f"Before L/R {before['LR']:.2f}, T/B {before['TB']:.2f}   After L/R {after['LR']:.2f}, T/B {after['TB']:.2f}",
            fill="black",
        )
        comparison.save(PREVIEW / "CZ_05_comparison.png")
        print("SEAMS", json.dumps(report))


def make_sheets():
    import numpy as np
    from PIL import Image, ImageDraw

    bounds_file = SCRATCH / "preview_bounds.json"
    bounds = json.loads(bounds_file.read_text()) if bounds_file.exists() else {}
    sheets = []
    for asset in ASSETS:
        render_path = PREVIEW / (asset + "_reference_view.png")
        if not render_path.exists():
            continue
        source = Image.open(SOURCE / (IDS[asset] + ".png")).convert("RGB")
        yy, xx = np.where(np.asarray(source).min(2) < 235)
        source = source.crop(
            (
                max(0, xx.min() - 10),
                max(0, yy.min() - 10),
                min(source.width, xx.max() + 11),
                min(source.height, yy.max() + 11),
            )
        )
        render = Image.open(render_path).convert("RGB")
        if asset in bounds:
            render = render.crop(bounds[asset])
        sheet = Image.new("RGB", (1000, 520), "#f4f4f4")
        draw = ImageDraw.Draw(sheet)
        for i, im in enumerate([source, render]):
            im.thumbnail((480, 460), Image.Resampling.LANCZOS)
            sheet.paste(
                im, (10 + 500 * i + (480 - im.width) // 2, 40 + (460 - im.height) // 2)
            )
        draw.text((15, 14), IDS[asset] + " / reference", fill="#222222")
        draw.text(
            (515, 14), "cz_" + asset + " / matching orthographic view", fill="#222222"
        )
        sheet.save(PREVIEW / (asset + "_comparison.png"))
        sheets.append(sheet)
    if sheets:
        contact = Image.new("RGB", (1000, 520 * len(sheets)), "white")
        for i, sheet in enumerate(sheets):
            contact.paste(sheet, (0, 520 * i))
        contact.save(PREVIEW / "construction_comparisons.png")


if ARGS.prepare:
    image_prepare()
    raise SystemExit
if ARGS.sheets:
    make_sheets()
    raise SystemExit

import bmesh
import bpy
from mathutils import Vector

MATERIALS = {}
ATLAS = {}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATERIALS.clear()


def material(
    name,
    color=(0.5, 0.5, 0.5),
    roughness=0.7,
    metallic=0.0,
    image=None,
    mask=False,
    emission=0.0,
):
    if name in MATERIALS:
        return MATERIALS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.diffuse_color = (*color, 1)
    m.use_backface_culling = True
    shader = m.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    if image:
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(str(image), check_existing=True)
        tex.image.pack()
        m.node_tree.links.new(tex.outputs["Color"], shader.inputs["Base Color"])
        if mask:
            # Blender 4.5's exporter detects a shader ROUND node, not the legacy
            # material blend_method, to emit glTF alphaMode=MASK / cutoff=0.5.
            clip = m.node_tree.nodes.new("ShaderNodeMath")
            clip.operation = "ROUND"
            m.node_tree.links.new(tex.outputs["Alpha"], clip.inputs[0])
            m.node_tree.links.new(clip.outputs[0], shader.inputs["Alpha"])
            m.surface_render_method = "DITHERED"
            m.alpha_threshold = 0.5
        if emission:
            m.node_tree.links.new(tex.outputs["Color"], shader.inputs["Emission Color"])
            shader.inputs["Emission Strength"].default_value = emission
    MATERIALS[name] = m
    return m


def atlas_uv(asset, point):
    sw, sh = ATLAS[asset]["source_size"]
    nw, nh = ATLAS[asset]["atlas_picture_size"]
    return (point[0] / sw * nw / 1024, 1 - point[1] / sh * nh / 1024)


def swatch(i):
    return ((128 * i + 64) / 1024, 1 - 992 / 1024)


def mesh(name, vertices, faces, mats, indices=None, uvs=None, recalc=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata(vertices, [], faces)
    me.update()
    for m in mats:
        me.materials.append(m)
    if indices is not None:
        for poly, index in zip(me.polygons, indices):
            poly.material_index = index
    if uvs:
        layer = me.uv_layers.new(name="UVMap")
        for poly, uv in zip(me.polygons, uvs):
            for loop, coord in zip(poly.loop_indices, uv):
                layer.data[loop].uv = coord
    if recalc:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(me)
        bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def constant_uv(ob, coord):
    uv = ob.data.uv_layers.active or ob.data.uv_layers.new(name="UVMap")
    for loop in uv.data:
        loop.uv = coord
    return ob


def box(name, center, size, mat, color_uv=None, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    ob = bpy.context.object
    ob.name = name
    ob.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ob.data.materials.append(mat)
    if color_uv is not None:
        constant_uv(ob, color_uv)
    if bevel:
        mod = ob.modifiers.new("moulded_edge", "BEVEL")
        mod.width = bevel
        mod.segments = 1
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=mod.name)
        if color_uv is not None:
            constant_uv(ob, color_uv)
    return ob


def beam(name, a, b, width, depth, mat, color_uv=None):
    a, b = Vector(a), Vector(b)
    ob = box(name, (a + b) / 2, (width, depth, (b - a).length), mat, color_uv)
    ob.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return ob


def cylinder(name, a, b, radius, mat, vertices=12, color_uv=None):
    a, b = Vector(a), Vector(b)
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=(b - a).length, location=(a + b) / 2
    )
    ob = bpy.context.object
    ob.name = name
    ob.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    ob.data.materials.append(mat)
    if color_uv is not None:
        constant_uv(ob, color_uv)
    return ob


def profile(
    name,
    points,
    depth_lo,
    depth_hi,
    transform,
    photo,
    edge_mat=None,
    asset=None,
    color_index=0,
    back_photo=True,
):
    """Solid extrusion of a reference-space polygon; transform(px,py,depth)."""
    n = len(points)
    verts = [transform(*pt, dep) for dep in [depth_lo, depth_hi] for pt in points]
    faces = [list(reversed(range(n))), list(range(n, 2 * n))]
    uv = (
        [
            [atlas_uv(asset, points[i]) for i in reversed(range(n))],
            [atlas_uv(asset, pt) for pt in points],
        ]
        if asset
        else [[swatch(color_index)] * n] * 2
    )
    indices = [0, 0 if back_photo else 1]
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, j + n, i + n])
        # Long top edges keep the paint stripes by projecting to the source's top row.
        if asset == "barrier":
            uv.append(
                [
                    atlas_uv(asset, (max(160, min(1770, points[k][0])), 160))
                    for k in [i, j, j, i]
                ]
            )
        else:
            uv.append([swatch(color_index)] * 4)
        indices.append(1 if edge_mat else 0)
    return mesh(
        name, verts, faces, [photo, edge_mat] if edge_mat else [photo], indices, uv
    )


def join_named(prefix, target_name):
    objs = [
        o
        for o in bpy.context.scene.objects
        if o.type == "MESH" and o.name.startswith(prefix)
    ]
    if not objs:
        return
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = target_name


def build_barrier():
    photo = material(
        "barrier_orange_white_photo", image=SCRATCH / "barrier.png", mask=True
    )
    dark = material("barrier_fill_caps", (0.035, 0.038, 0.04), 0.85)

    def tx(px, py, dep):
        z = (746 - py) / 676
        taper = 0.25 if z < 0.2 else (0.25 - (min(z, 0.98) - 0.2) / 0.78 * 0.105)
        return ((px - 959) / 921, dep * taper, z)

    points = [
        (121, 724),
        (131, 746),
        (367, 746),
        (385, 685),
        (549, 685),
        (564, 746),
        (622, 746),
        (641, 690),
        (725, 690),
        (749, 746),
        (1159, 746),
        (1178, 685),
        (1280, 685),
        (1299, 746),
        (1358, 746),
        (1378, 685),
        (1528, 685),
        (1548, 746),
        (1789, 746),
        (1811, 728),
        (1795, 113),
        (1782, 94),
        (1752, 85),
        (184, 85),
        (158, 92),
        (142, 111),
        (136, 173),
        (132, 590),
    ]
    profile("barrier_moulded_shell", points, -1, 1, tx, photo, asset="barrier")
    # End interlocks: two vertically stacked knuckles on each end, with real depth.
    for end, px in [("male", 66), ("female", 1840)]:
        for i, (top, bottom) in enumerate([(161, 289), (504, 639)]):
            if end == "male":
                poly = [
                    (38, top + 8),
                    (54, top),
                    (91, top),
                    (94, top + 42),
                    (136, top + 42),
                    (136, bottom - 29),
                    (95, bottom - 29),
                    (92, bottom),
                    (52, bottom),
                    (38, bottom - 6),
                ]
            else:
                poly = [
                    (1793, top + 16),
                    (1858, top + 16),
                    (1880, top + 25),
                    (1880, bottom - 6),
                    (1863, bottom),
                    (1803, bottom),
                    (1793, bottom - 12),
                ]
            profile(
                f"barrier_{end}_interlock_{i}",
                poly,
                -0.75,
                0.75,
                tx,
                photo,
                asset="barrier",
            )
    for px in [250, 1690]:
        x = (px - 959) / 921
        cylinder("barrier_fill_cap", (x, 0, 0.976), (x, 0, 1), 0.046, dark, 12)
    join_named("barrier_fill_cap", "barrier_fill_caps")
    # Explicit semantic origin at ground-centre is normalized again before export.


def build_sign():
    photo = material(
        "road_work_reflective_photo",
        image=SCRATCH / "sign.png",
        mask=True,
        roughness=0.62,
    )
    metal = material("sign_galvanized_frame", (0.46, 0.51, 0.53), 0.5, 0.6)
    rubber = material("sign_rubber_feet", (0.025, 0.029, 0.03), 0.9)

    def tx(px, py, dep):
        return (dep, (543 - px) / 904, (1412 - py) * 1.5 / 1370)

    diamond = [
        (543, 42),
        (562, 48),
        (983, 467),
        (994, 489),
        (989, 511),
        (564, 922),
        (543, 934),
        (521, 927),
        (102, 513),
        (91, 492),
        (98, 471),
        (522, 51),
    ]
    # Front of these extrusions is the low-X cap; back is plain galvanized metal.
    profile(
        "road_work_diamond", diamond, -0.245, -0.225, tx, photo, metal, "sign", 0, False
    )
    plate = [
        (172, 937),
        (911, 937),
        (932, 953),
        (936, 1151),
        (919, 1171),
        (171, 1171),
        (151, 1154),
        (154, 957),
    ]
    profile(
        "road_work_text_plate",
        plate,
        -0.268,
        -0.248,
        tx,
        photo,
        metal,
        "sign",
        1,
        False,
    )
    for side in [-1, 1]:
        hinge = (0, side * 0.35, 1.225)
        for front in [-1, 1]:
            foot = (front * 0.32, side * 0.455, 0.035)
            beam("sign_frame_leg", foot, hinge, 0.035, 0.028, metal)
            box(
                "sign_foot",
                (front * 0.32, side * 0.455, 0.025),
                (0.072, 0.057, 0.05),
                rubber,
                bevel=0.006,
            )
        beam(
            "sign_frame_spreader",
            (-0.25, side * 0.428, 0.31),
            (0.25, side * 0.428, 0.31),
            0.018,
            0.02,
            metal,
        )
        beam(
            "sign_frame_panel_mount",
            (-0.223, side * 0.35, 0.5),
            (0, side * 0.35, 1.225),
            0.026,
            0.028,
            metal,
        )
        cylinder(
            "sign_frame_hinge",
            (0, side * 0.35 - 0.025, 1.225),
            (0, side * 0.35 + 0.025, 1.225),
            0.026,
            metal,
            10,
        )
    for z in [0.51, 0.95]:
        beam(
            "sign_frame_crossbar",
            (-0.22, -0.38, z),
            (-0.22, 0.38, z),
            0.028,
            0.022,
            metal,
        )
    join_named("sign_frame_", "sign_A_frame")
    join_named("sign_foot", "sign_four_rubber_feet")


def build_arrowboard():
    photo = material(
        "arrowboard_orange_photo",
        image=SCRATCH / "arrowboard.png",
        mask=True,
        roughness=0.65,
    )
    led = material(
        "led_arrow",
        image=SCRATCH / "led_arrow.png",
        mask=True,
        roughness=0.4,
        emission=3,
    )
    rubber = material("trailer_rubber_and_board_back", (0.028, 0.033, 0.037), 0.9)
    metal = material("trailer_galvanized_steel", (0.38, 0.42, 0.45), 0.46, 0.65)

    def tx(px, py, dep):
        return (dep, (724 - px) * 2.4 / 848, (1055 - py) * 1.2 / 472)

    panel = [
        (300, 35),
        (305, 30),
        (1143, 30),
        (1148, 35),
        (1148, 497),
        (1143, 502),
        (305, 502),
        (300, 497),
    ]
    profile(
        "arrowboard_display_housing",
        panel,
        -0.49,
        -0.38,
        tx,
        photo,
        rubber,
        "arrowboard",
        2,
        False,
    )
    verts = [
        tx(px, py, -0.493)
        for px, py in [(300, 502), (1148, 502), (1148, 30), (300, 30)]
    ]
    # Correct -X winding, left arrow remains left to approaching traffic.
    mesh(
        "arrowboard_left_LED_overlay",
        verts,
        [[0, 1, 2, 3]],
        [led],
        uvs=[[(0, 0), (1, 0), (1, 1), (0, 1)]],
        recalc=False,
    )
    # Rear fascia is projected from the same photographic rear elevation.
    bumper = [
        (312, 780),
        (325, 768),
        (1121, 768),
        (1135, 782),
        (1135, 870),
        (1125, 881),
        (322, 881),
        (312, 870),
    ]
    profile(
        "trailer_reflective_rear_and_lamps",
        bumper,
        -0.74,
        -0.61,
        tx,
        photo,
        asset="arrowboard",
    )
    for y in [-0.91, 0.91]:
        box("trailer_chassis_side", (0, y, 0.43), (1.25, 0.09, 0.11), photo, swatch(0))
    for x in [-0.58, 0.43]:
        box("trailer_chassis_cross", (x, 0, 0.44), (0.09, 1.9, 0.11), photo, swatch(0))
    cylinder("trailer_axle", (0, -1.22, 0.39), (0, 1.22, 0.39), 0.047, metal, 12)
    box(
        "trailer_battery_box",
        (0.16, 0, 0.66),
        (0.94, 1.43, 0.33),
        photo,
        swatch(0),
        0.025,
    )
    box("trailer_battery_lid", (0.16, 0, 0.84), (0.98, 1.49, 0.035), photo, swatch(0))
    box("arrowboard_mast_lower", (-0.29, 0, 1.01), (0.16, 0.19, 0.48), photo, swatch(0))
    box("arrowboard_mast_upper", (-0.29, 0, 1.36), (0.12, 0.13, 0.44), photo, swatch(0))
    box(
        "arrowboard_mast_collar",
        (-0.29, 0, 1.06),
        (0.22, 0.24, 0.045),
        photo,
        swatch(0),
    )
    box(
        "arrowboard_controller",
        (-0.32, -0.2, 1.14),
        (0.10, 0.15, 0.21),
        rubber,
        bevel=0.012,
    )
    for y in [-1.19, 1.19]:
        tire = cylinder(
            "trailer_tire", (0, y - 0.15, 0.39), (0, y + 0.15, 0.39), 0.39, rubber, 24
        )
        tire.data.materials.append(photo)
        uv_layer = tire.data.uv_layers.active
        for polygon in tire.data.polygons:
            if len(polygon.vertices) == 4:
                polygon.material_index = 1
                for loop_index in polygon.loop_indices:
                    co = (
                        tire.matrix_world
                        @ tire.data.vertices[
                            tire.data.loops[loop_index].vertex_index
                        ].co
                    )
                    px = (303 if y > 0 else 1142) - (co.y - y) * 43 / 0.15
                    py = 885 + (1 - co.z / 0.78) * 170
                    uv_layer.data[loop_index].uv = atlas_uv("arrowboard", (px, py))
        outer = y + math.copysign(0.154, y)
        cylinder(
            "trailer_hub",
            (0, outer - math.copysign(0.025, y), 0.39),
            (0, outer, 0.39),
            0.205,
            metal,
            16,
        )
        cylinder(
            "trailer_axle_cap",
            (0, outer, 0.39),
            (0, outer + math.copysign(0.025, y), 0.39),
            0.07,
            metal,
            10,
        )
        # Bent sheet fenders, rather than rectangular wheel-cover boxes.
        n = 10
        curve = [
            (math.cos(math.pi * i / n) * 0.46, 0.39 + math.sin(math.pi * i / n) * 0.46)
            for i in range(n + 1)
        ]
        # Crown the width too: the rear silhouette has rounded shoulders instead
        # of a square box above each tire.
        bands = [(-0.18, -0.10), (-0.13, -0.015), (0, 0), (0.13, -0.015), (0.18, -0.10)]
        vs = [(x, y + dy, z + dz) for dy, dz in bands for x, z in curve]
        fs = [
            [
                j * (n + 1) + i + n + 1,
                j * (n + 1) + i + n + 2,
                j * (n + 1) + i + 1,
                j * (n + 1) + i,
            ]
            for j in range(len(bands) - 1)
            for i in range(n)
        ]
        fender = mesh("trailer_curved_fender", vs, fs, [rubber], recalc=False)
        bpy.context.view_layer.objects.active = fender
        solid = fender.modifiers.new("sheet_thickness", "SOLIDIFY")
        solid.thickness = 0.018
        bpy.ops.object.modifier_apply(modifier=solid.name)
    for y in [-0.75, 0.75]:
        beam(
            "trailer_tow_V",
            (0.55, y, 0.42),
            (1.57, 0, 0.42),
            0.09,
            0.085,
            photo,
            swatch(0),
        )
    box("trailer_tongue", (1.52, 0, 0.42), (0.51, 0.10, 0.09), photo, swatch(0))
    box("trailer_hitch", (1.84, 0, 0.42), (0.25, 0.16, 0.12), metal, bevel=0.025)
    cylinder("trailer_jack", (1.25, 0.15, 0.055), (1.25, 0.15, 0.52), 0.025, metal, 10)
    box("trailer_jack_foot", (1.25, 0.15, 0.0275), (0.16, 0.16, 0.055), metal)
    join_named("trailer_chassis_", "trailer_chassis")
    join_named("trailer_tire", "trailer_two_tires")
    join_named("trailer_hub", "trailer_two_hubs")
    join_named("trailer_axle_cap", "trailer_hub_caps")
    join_named("trailer_curved_fender", "trailer_curved_fenders")
    join_named("trailer_tow_V", "trailer_tow_A_frame")


def build_excavator():
    photo = material(
        "excavator_yellow_photo",
        image=SCRATCH / "excavator.png",
        mask=True,
        roughness=0.74,
    )
    rubber = material("excavator_rubber_tracks", (0.045, 0.043, 0.037), 0.95)
    metal = material("excavator_dark_steel", (0.045, 0.05, 0.055), 0.55, 0.35)
    glass = material(
        "glass_cab", (0.23, 0.39, 0.4), 0.19, 0.2, image=SCRATCH / "excavator.png"
    )
    sx, sz = 4.5 / (1493 - 184), 2.5 / (900 - 14)

    def tx(px, py, dep):
        return ((838.5 - px) * sx, dep, (900 - py) * sz)

    def part(name, points, lo, hi, edge=None, sw=4, mat=None):
        return profile(name, points, lo, hi, tx, mat or photo, edge, "excavator", sw)

    # Two genuine continuous track rings. The side texture carries the wear;
    # the sprockets, return run, open interior and treads remain actual geometry.
    centers = [(810, 803), (1397, 803)]
    outer = []
    for (cx, cy), start in [(centers[0], math.pi / 2), (centers[1], -math.pi / 2)]:
        for i in range(13):
            a = start + math.pi * i / 12
            outer.append((cx + 96 * math.cos(a), cy + 96 * math.sin(a)))
    inner = []
    for (cx, cy), start in [(centers[0], math.pi / 2), (centers[1], -math.pi / 2)]:
        for i in range(13):
            a = start + math.pi * i / 12
            inner.append((cx + 67 * math.cos(a), cy + 67 * math.sin(a)))
    n = len(outer)
    for side in [-1, 1]:
        lo, hi = side * 0.6 - 0.2, side * 0.6 + 0.2
        vs = [
            tx(*pt, dep) for dep in [lo, hi] for ring in [outer, inner] for pt in ring
        ]
        fs, uv, mi = [], [], []
        for i in range(n):
            j = (i + 1) % n
            for face, coords, idx in [
                ([i, j, j + 2 * n, i + 2 * n], [swatch(2)] * 4, 1),
                ([i + n, i + 3 * n, j + 3 * n, j + n], [swatch(2)] * 4, 1),
                (
                    [i, i + n, j + n, j],
                    [
                        atlas_uv("excavator", outer[i]),
                        atlas_uv("excavator", inner[i]),
                        atlas_uv("excavator", inner[j]),
                        atlas_uv("excavator", outer[j]),
                    ],
                    0,
                ),
                (
                    [i + 2 * n, j + 2 * n, j + 3 * n, i + 3 * n],
                    [
                        atlas_uv("excavator", outer[i]),
                        atlas_uv("excavator", outer[j]),
                        atlas_uv("excavator", inner[j]),
                        atlas_uv("excavator", inner[i]),
                    ],
                    0,
                ),
            ]:
                fs.append(face)
                uv.append(coords)
                mi.append(idx)
        mesh("excavator_track_ring", vs, fs, [photo, rubber], mi, uv)
        # End sprockets and three small road wheels behind the side frame.
        for px, py, radius in [
            (810, 803, 68),
            (1397, 803, 68),
            (962, 838, 35),
            (1104, 838, 35),
            (1242, 838, 35),
        ]:
            pts = [
                (
                    px + radius * math.cos(2 * math.pi * k / 12),
                    py + radius * math.sin(2 * math.pi * k / 12),
                )
                for k in range(12)
            ]
            part("excavator_track_wheel", pts, lo + 0.02, hi - 0.02, rubber)
        part(
            "excavator_track_side_frame",
            [(765, 770), (1313, 770), (1313, 854), (765, 854)],
            lo,
            hi,
            rubber,
        )
        # Raised rectangular shoes along both straight runs, low cost in triangles.
        for px in range(828, 1390, 48):
            for py in [707, 899]:
                point = tx(px, py, side * 0.6)
                z = point[2] + (0.008 if py == 707 else 0.007)
                box(
                    "excavator_tread",
                    (point[0], point[1], z),
                    (0.096, 0.4, 0.026),
                    rubber,
                )
        # A few radial end shoes articulate the curved track silhouette.
        for cx in [810, 1397]:
            for a in (
                [math.pi * 0.72, math.pi, math.pi * 1.28]
                if cx == 810
                else [-math.pi * 0.28, 0, math.pi * 0.28]
            ):
                px, py = cx + 96 * math.cos(a), 803 + 96 * math.sin(a)
                point = tx(px, py, side * 0.6)
                ob = box("excavator_tread", point, (0.085, 0.4, 0.026), rubber)
                ob.rotation_euler.y = math.atan2(-sz * math.cos(a), sx * math.sin(a))
    box("excavator_undercarriage", tx(1100, 750, 0), (2.02, 1.16, 0.19), metal)
    cylinder("excavator_slew_ring", tx(1080, 709, 0), tx(1080, 669, 0), 0.45, metal, 20)
    body = [
        (885, 575),
        (1138, 575),
        (1181, 589),
        (1212, 599),
        (1339, 578),
        (1386, 574),
        (1394, 602),
        (1391, 647),
        (1373, 675),
        (901, 675),
        (881, 663),
        (876, 612),
    ]
    part("excavator_lower_upper_body", body, -0.64, 0.64)
    counter = [
        (1148, 574),
        (1175, 431),
        (1192, 402),
        (1218, 392),
        (1346, 393),
        (1374, 411),
        (1383, 444),
        (1385, 573),
        (1334, 595),
        (1211, 598),
    ]
    part("excavator_rear_counterweight", counter, -0.61, 0.61)
    cab = [
        (890, 575),
        (896, 191),
        (914, 129),
        (941, 96),
        (982, 75),
        (1036, 64),
        (1257, 64),
        (1285, 72),
        (1299, 92),
        (1304, 380),
        (1220, 387),
        (1190, 401),
        (1170, 434),
        (1143, 575),
    ]
    part("excavator_cab_frame", cab, -0.565, 0.565, metal, 2)
    # Pane polygons are offset slightly from the steel cabin shell, not floating quads.
    panes = [
        [
            (946, 153),
            (968, 125),
            (1007, 108),
            (1119, 104),
            (1125, 111),
            (1126, 538),
            (1098, 546),
            (935, 545),
        ],
        [(1159, 96), (1251, 94), (1268, 110), (1274, 348), (1256, 362), (1160, 375)],
    ]
    for side in [-1, 1]:
        y = side * 0.568
        for i, poly in enumerate(panes):
            vertices = [tx(*point, y) for point in poly]
            face = list(range(len(poly)))
            if side > 0:
                face.reverse()
            mesh(
                "excavator_cab_glazing",
                vertices,
                [face],
                [glass],
                uvs=[[atlas_uv("excavator", poly[i]) for i in face]],
                recalc=False,
            )
    # Windshield at the front of the cab: approximate planar pane and steel rails.
    front = [
        tx(894, 165, -0.49),
        tx(894, 165, 0.49),
        tx(884, 532, 0.49),
        tx(884, 532, -0.49),
    ]
    mesh(
        "excavator_front_windshield",
        front,
        [[3, 2, 1, 0]],
        [glass],
        uvs=[[atlas_uv("excavator", (1000, 200))] * 4],
        recalc=False,
    )
    for y in [-0.53, 0.53]:
        beam("excavator_cab_rail", tx(894, 165, y), tx(884, 550, y), 0.04, 0.04, metal)
    # Main boom, raised dipper, linkage and curled bucket match the side reference.
    boom = [
        (345, 95),
        (365, 99),
        (651, 168),
        (663, 127),
        (679, 133),
        (697, 159),
        (721, 211),
        (819, 511),
        (842, 551),
        (813, 560),
        (779, 551),
        (747, 515),
        (648, 311),
        (626, 294),
        (610, 272),
        (601, 254),
        (580, 242),
        (450, 190),
        (355, 151),
        (333, 128),
        (333, 111),
    ]
    part("excavator_main_boom", boom, -0.19, 0.19)
    dipper = [
        (246, 132),
        (239, 122),
        (247, 84),
        (268, 43),
        (290, 17),
        (301, 14),
        (311, 19),
        (318, 32),
        (322, 65),
        (342, 97),
        (352, 119),
        (309, 378),
        (301, 426),
        (276, 442),
        (266, 419),
        (272, 365),
        (277, 244),
        (265, 177),
    ]
    part("excavator_raised_dipper", dipper, -0.16, 0.16)
    base = [
        (810, 507),
        (824, 520),
        (822, 549),
        (802, 581),
        (813, 651),
        (787, 663),
        (765, 661),
        (744, 631),
        (734, 600),
        (752, 578),
        (779, 542),
    ]
    part("excavator_boom_foot", base, -0.25, 0.25)
    part(
        "excavator_boom_swing_mount",
        [(803, 559), (879, 559), (879, 655), (810, 655)],
        -0.24,
        0.24,
        metal,
        2,
    )
    link = [
        (196, 392),
        (234, 370),
        (282, 359),
        (295, 366),
        (299, 379),
        (275, 389),
        (230, 401),
        (218, 416),
        (233, 465),
        (218, 477),
        (188, 412),
        (185, 402),
    ]
    part("excavator_bucket_link", link, -0.23, 0.23)
    part(
        "excavator_bucket_coupler",
        [
            (278, 411),
            (291, 416),
            (307, 449),
            (315, 470),
            (285, 482),
            (230, 493),
            (212, 481),
            (214, 467),
            (233, 450),
            (263, 423),
        ],
        -0.24,
        0.24,
        metal,
        2,
    )
    cheek = [
        (278, 451),
        (252, 458),
        (229, 482),
        (212, 515),
        (204, 548),
        (207, 577),
        (221, 601),
        (245, 617),
        (277, 628),
        (320, 621),
        (373, 601),
        (419, 576),
        (470, 543),
        (422, 553),
        (372, 554),
        (330, 518),
        (301, 473),
    ]
    # Two cheek plates with a curved joining shell; the mouth stays open.
    for side in [-1, 1]:
        part(
            "excavator_bucket_cheek",
            cheek,
            side * 0.31 - 0.012,
            side * 0.31 + 0.012,
            metal,
            2,
        )
    curve = cheek[:13]
    vs = [tx(*point, y) for y in [-0.31, 0.31] for point in curve]
    fs = [[i, i + 1, i + 1 + len(curve), i + len(curve)] for i in range(len(curve) - 1)]
    shell = mesh("excavator_bucket_curved_shell", vs, fs, [metal])
    bpy.context.view_layer.objects.active = shell
    solid = shell.modifiers.new("bucket_sheet_thickness", "SOLIDIFY")
    solid.thickness = 0.015
    bpy.ops.object.modifier_apply(modifier=solid.name)
    for y in [-0.24, 0, 0.24]:
        part(
            "excavator_bucket_tooth",
            [(416, 572), (468, 542), (481, 542), (446, 568)],
            y - 0.05,
            y + 0.05,
            metal,
            5,
        )
    # Dark hydraulic bodies and exposed metal piston rods are actual round members.
    hydraulics = [
        ((750, 580), (691, 414), (629, 293)),
        ((640, 135), (450, 78), (317, 32)),
        ((254, 146), (222, 307), (198, 393)),
    ]
    for i, (start, mid, end) in enumerate(hydraulics):
        y = 0.245 if i != 2 else 0.205
        cylinder(
            "excavator_hydraulic_body", tx(*start, y), tx(*mid, y), 0.038, metal, 10
        )
        cylinder(
            "excavator_hydraulic_rod",
            tx(*mid, y),
            tx(*end, y),
            0.018,
            photo,
            10,
            swatch(6),
        )
    # Low-poly hydraulic hoses, visible on either side of the boom.
    path = [
        (345, 96),
        (312, 83),
        (285, 94),
        (279, 121),
        (288, 153),
        (303, 197),
        (296, 258),
    ]
    path2 = [
        (667, 151),
        (708, 185),
        (735, 245),
        (779, 382),
        (811, 426),
        (838, 461),
        (846, 489),
        (836, 515),
    ]
    for side in [-1, 1]:
        for path_i in [path, path2]:
            for a, b in zip(path_i, path_i[1:]):
                cylinder(
                    "excavator_hose",
                    tx(*a, side * 0.22),
                    tx(*b, side * 0.22),
                    0.012,
                    rubber,
                    6,
                )
    for px, py in [
        (301, 28),
        (254, 122),
        (345, 113),
        (661, 140),
        (630, 282),
        (810, 520),
        (751, 600),
        (280, 423),
        (285, 371),
        (197, 402),
    ]:
        for side in [-1, 1]:
            cylinder(
                "excavator_pivot_pin",
                tx(px, py, side * 0.23),
                tx(px, py, side * 0.25),
                0.027,
                photo,
                8,
                swatch(6),
            )
    # Dozer blade and two lift arms at the forward end of the tracks.
    blade = [
        (546, 760),
        (586, 728),
        (622, 725),
        (637, 743),
        (611, 776),
        (606, 852),
        (590, 889),
        (521, 894),
        (539, 866),
        (551, 812),
    ]
    part("excavator_dozer_blade", blade, -0.75, 0.75, metal, 5)
    for y in [-0.46, 0.46]:
        beam("excavator_dozer_arm", tx(767, 798, y), tx(605, 813, y), 0.11, 0.09, metal)
        cylinder(
            "excavator_dozer_ram", tx(746, 741, y), tx(623, 775, y), 0.025, metal, 10
        )
    # Group repeated pieces without losing the main mechanical subassemblies.
    for prefix, name in [
        ("excavator_track_ring", "excavator_two_track_rings"),
        ("excavator_track_wheel", "excavator_ten_track_wheels"),
        ("excavator_track_side_frame", "excavator_track_side_frames"),
        ("excavator_tread", "excavator_track_shoes"),
        ("excavator_cab_glazing", "excavator_side_glazing"),
        ("excavator_cab_rail", "excavator_windshield_rails"),
        ("excavator_bucket_cheek", "excavator_bucket_side_plates"),
        ("excavator_bucket_tooth", "excavator_three_bucket_teeth"),
        ("excavator_hydraulic_", "excavator_hydraulic_cylinders"),
        ("excavator_hose", "excavator_hydraulic_hoses"),
        ("excavator_pivot_pin", "excavator_pivot_pins"),
        ("excavator_dozer_arm", "excavator_dozer_lift_arms"),
        ("excavator_dozer_ram", "excavator_dozer_hydraulics"),
    ]:
        join_named(prefix, name)


def normalize_and_export(asset):
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    bpy.context.view_layer.update()
    coords = [
        ob.matrix_world @ Vector(corner) for ob in objs for corner in ob.bound_box
    ]
    lo = Vector([min(p[i] for p in coords) for i in range(3)])
    hi = Vector([max(p[i] for p in coords) for i in range(3)])
    shift = Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
    for ob in objs:
        ob.location += shift
        ob.select_set(True)
    # Apply rotations/scales and bake positions into mesh coordinates, then put every
    # object's origin at the shared, ground-centred placement origin.
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for ob in objs:
        ob["asset_forward"] = (
            "+X" if asset in ["arrowboard", "excavator"] else "not_directional"
        )
        ob["visible_face"] = "-X" if asset in ["sign", "arrowboard"] else "both_Y_sides"
        # Triangulate concave profiles explicitly; this also makes budgeting exact.
        bpy.context.view_layer.objects.active = ob
        mod = ob.modifiers.new("game_triangles", "TRIANGULATE")
        bpy.ops.object.modifier_apply(modifier=mod.name)
    triangles = sum(len(ob.data.polygons) for ob in objs)
    limit = {"barrier": 800, "sign": 600, "arrowboard": 1500, "excavator": 4000}[asset]
    if triangles > limit:
        raise RuntimeError(f"{asset}: {triangles} triangles exceeds {limit}")
    # Static props need no per-part draw calls or animated hierarchy. Keep a named
    # parts inventory in extras, but export one mesh with <=4 material primitives.
    part_names = [ob.name for ob in objs]
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    combined = bpy.context.object
    combined.name = "cz_" + asset
    combined.data.name = combined.name + "_mesh"
    combined["parts"] = part_names
    combined["placement_origin"] = "ground_center"
    path = OUT / ("cz_" + asset + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        use_selection=True,
        export_extras=True,
        export_image_format="AUTO",
        export_materials="EXPORT",
    )
    print("EXPORTED", asset, triangles, "triangles", path.stat().st_size, "bytes")
    return hi - lo


def render_previews(asset, dimensions):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 760
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = 32
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast" if False else "None"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    world = bpy.data.worlds.new("preview_world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (
        0.8,
        0.83,
        0.87,
        1,
    )
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.65
    scene.world = world
    for name, loc, energy, size in [
        ("key", (-3, -4, 8), 350, 6),
        ("fill", (3, 5, 5), 250, 5),
    ]:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        ob = bpy.data.objects.new(name, data)
        scene.collection.objects.link(ob)
        ob.location = loc
        ob.rotation_euler = (
            (Vector((0, 0, dimensions.z * 0.5)) - ob.location)
            .to_track_quat("-Z", "Y")
            .to_euler()
        )
    ground = material("preview_ground", (0.88, 0.88, 0.86), 1)
    box("preview_ground_plane", (0, 0, -0.025), (200, 200, 0.05), ground)
    cam_data = bpy.data.cameras.new("preview_camera")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("preview_camera", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    target = Vector((0, 0, dimensions.z * 0.5))
    views = {
        "barrier": [(0, -8, dimensions.z * 0.5), (-3.4, -5, 2.7)],
        "sign": [(-8, 0, dimensions.z * 0.5), (-4, -3, 2.3)],
        "arrowboard": [(-10, 0, dimensions.z * 0.5), (-5, -4, 3.5)],
        "excavator": [(0, 10, dimensions.z * 0.5), (5, 8, 4.5)],
    }[asset]
    for i, loc in enumerate(views):
        cam.location = loc
        cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
        # Fit camera-space bounding points, not an approximate diagonal.
        bpy.context.view_layer.update()
        inv = cam.matrix_world.inverted()
        pts = [
            inv @ (ob.matrix_world @ Vector(c))
            for ob in bpy.context.scene.objects
            if ob.type == "MESH" and not ob.name.startswith("preview_")
            for c in ob.bound_box
        ]
        width = max(p.x for p in pts) - min(p.x for p in pts)
        height = max(p.y for p in pts) - min(p.y for p in pts)
        cam_data.ortho_scale = max(width, height * 960 / 760) * 1.16
        if i == 0:
            bounds_file = SCRATCH / "preview_bounds.json"
            bounds = json.loads(bounds_file.read_text()) if bounds_file.exists() else {}
            pw, ph = (
                width / cam_data.ortho_scale * 960,
                height / cam_data.ortho_scale * 960,
            )
            bounds[asset] = [
                round(480 - pw / 2 - 10),
                round(380 - ph / 2 - 10),
                round(480 + pw / 2 + 10),
                round(380 + ph / 2 + 10),
            ]
            bounds_file.write_text(json.dumps(bounds))
        scene.render.filepath = str(
            PREVIEW
            / (asset + ("_reference_view.png" if i == 0 else "_three_quarter.png"))
        )
        bpy.ops.render.render(write_still=True)


def verify():
    report = {}
    limits = {"barrier": 800, "sign": 600, "arrowboard": 1500, "excavator": 4000}
    for asset in ASSETS:
        path = OUT / ("cz_" + asset + ".glb")
        if not path.exists():
            continue
        reset()
        bpy.ops.import_scene.gltf(filepath=str(path))
        objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
        bpy.context.view_layer.update()
        coords = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
        lo = [min(c[i] for c in coords) for i in range(3)]
        hi = [max(c[i] for c in coords) for i in range(3)]
        tris = sum(
            sum(len(poly.vertices) - 2 for poly in ob.data.polygons) for ob in objs
        )
        materials = sorted({m.name for ob in objs for m in ob.data.materials if m})
        images = [
            {"name": im.name, "size_px": list(im.size), "packed": bool(im.packed_file)}
            for im in bpy.data.images
            if im.type == "IMAGE"
        ]
        loose = 0
        degenerate = 0
        for ob in objs:
            used = {v for p in ob.data.polygons for v in p.vertices}
            loose += len(ob.data.vertices) - len(used)
            degenerate += sum(poly.area < 1e-12 for poly in ob.data.polygons)
            assert all(math.isfinite(c) for v in ob.data.vertices for c in v.co)
            if asset in ["sign", "arrowboard"]:
                target_material = (
                    "road_work_reflective_photo" if asset == "sign" else "led_arrow"
                )
                facing = [
                    poly.normal.x
                    for poly in ob.data.polygons
                    if ob.data.materials[poly.material_index].name == target_material
                ]
                assert facing and max(facing) < -0.999, (asset, facing)
        # Independently inspect GLB JSON for alpha modes, image embedding and texture dimensions.
        import struct

        raw = path.read_bytes()
        length, kind = struct.unpack_from("<II", raw, 12)
        gltf = json.loads(raw[20 : 20 + length])
        material_modes = {
            m["name"]: m.get("alphaMode", "OPAQUE") for m in gltf.get("materials", [])
        }
        modes = {
            m["name"]: m.get("emissiveFactor")
            for m in gltf.get("materials", [])
            if "emissiveFactor" in m
        }
        entry = {
            "dimensions_m": [round(hi[i] - lo[i], 5) for i in range(3)],
            "bbox_min_m": [round(x, 5) for x in lo],
            "bbox_max_m": [round(x, 5) for x in hi],
            "triangles": tris,
            "triangle_budget": limits[asset],
            "objects": [ob.name for ob in objs],
            "materials": materials,
            "alpha_modes": material_modes,
            "emissive_factors": modes,
            "images": images,
            "file_bytes": path.stat().st_size,
            "embedded_images": all(
                "bufferView" in im and "uri" not in im for im in gltf.get("images", [])
            ),
            "loose_vertices": loose,
            "degenerate_triangles": degenerate,
        }
        assert tris <= limits[asset], entry
        assert len(materials) <= 4, entry
        assert abs(lo[2]) < 1e-4, entry
        assert abs(lo[0] + hi[0]) < 1e-4 and abs(lo[1] + hi[1]) < 1e-4, entry
        assert loose == 0 and degenerate == 0, entry
        assert all(max(im["size_px"]) <= 1024 for im in images), entry
        assert entry["embedded_images"], entry
        assert all(mode != "BLEND" for mode in material_modes.values()), entry
        report[asset] = entry
        print("VERIFIED", asset, json.dumps(entry))
    (PREVIEW / "verification.json").write_text(json.dumps(report, indent=2))
    return report


if ARGS.verify_only:
    verify()
else:
    subprocess.run(
        [
            ARGS.python,
            str(Path(__file__).resolve()),
            "--prepare",
            "--asset",
            ARGS.asset,
        ],
        check=True,
    )
    if ARGS.asset != "plates":
        ATLAS = json.loads((SCRATCH / "atlas_info.json").read_text())
        selected = ASSETS if ARGS.asset == "all" else [ARGS.asset]
        for asset in selected:
            reset()
            globals()["build_" + asset]()
            dimensions = normalize_and_export(asset)
            if not ARGS.skip_previews:
                render_previews(asset, dimensions)
        if not ARGS.skip_previews:
            subprocess.run(
                [ARGS.python, str(Path(__file__).resolve()), "--sheets"], check=True
            )
