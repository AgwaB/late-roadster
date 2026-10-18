"""Round-4 Late Roadster booster: reference-sooted body and one reusable landing leg.

Build / preview (Blender 4.5):
  /opt/homebrew/bin/blender -b --python-exit-code 1 -P tools/blender/r4/booster.py -- --iteration 3
Independently import BOTH exported GLBs, check budgets, and render the assembly:
  /opt/homebrew/bin/blender -b --python-exit-code 1 -P tools/blender/r4/booster.py -- --verify

Authoring is metres, +Z up. Standard glTF export is +Y up, as in round 3;
Blender import restores +Z. Body origin = centre of engine-bell ground plane.
Leg origin = hinge, -Z down, +X radially outward, +Y tangential hinge axle.
Assembly: T(1.9*cos(a),1.9*sin(a),8) @ Rz(a) @ Ry(-DEPLOY_ANGLE).
Only the two assigned GLBs and research/raycity/r4-assets/booster are written.
Texture / comparison helpers use system Python with Pillow and NumPy.
"""

import argparse
import json
import math
import shutil
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "research/raycity/r4-assets/booster"
TEXTURES = EVIDENCE / "textures"
REFERENCE = ROOT / "research/raycity/generated/2026-10-18-round4/BO_01.png"
BODY_PATH = ROOT / "public/assets/gen/booster_r4.glb"
LEG_PATH = ROOT / "public/assets/gen/booster_leg_r4.glb"
RADIUS, HEIGHT, HINGE_Z = 1.9, 45.5, 8.0
AZIMUTHS = (45, 135, 225, 315)


def deployment_angle():
    """Keep a 9 m rest-pose extremity and a small flat pad on z=0 when deployed."""
    low, high = 0.0, math.radians(40)
    for _ in range(48):
        angle = (low + high) / 2
        centre_length = 9.0 - 0.325 * math.sin(angle) - 0.08 * math.cos(angle)
        ground = HINGE_Z - centre_length * math.cos(angle) - 0.08
        if ground < 0:
            low = angle
        else:
            high = angle
    return (low + high) / 2


DEPLOY_ANGLE = deployment_angle()
PAD_CENTRE_LENGTH = 9.0 - 0.325 * math.sin(DEPLOY_ANGLE) - 0.08 * math.cos(DEPLOY_ANGLE)


def prepare_textures(iteration):
    """Cylindrical BO_01 projection, illumination removal, and an alpha lattice."""
    import numpy as np
    from PIL import Image, ImageDraw, ImageFilter

    TEXTURES.mkdir(parents=True, exist_ok=True)
    source = np.asarray(Image.open(REFERENCE).convert("RGB"), dtype=np.float32)
    height, width = 1024, 1024
    u = np.linspace(0, 4, width, endpoint=False)
    segment = np.floor(u).astype(int)
    t = u - segment
    t = np.where(segment % 2, 1 - t, t)
    # Use only the interior cylinder: neither white backdrop nor edge shading.
    xs = 470 + 70 * np.sin((t - 0.5) * math.pi / 2)
    ys = np.linspace(139, 1451, height)
    xi, yi = xs.astype(int), ys.astype(int)
    fx, fy = (xs - xi)[None, :, None], (ys - yi)[:, None, None]
    top = (
        source[yi[:, None], xi[None, :]] * (1 - fx)
        + source[yi[:, None], xi[None, :] + 1] * fx
    )
    bottom = (
        source[yi[:, None] + 1, xi[None, :]] * (1 - fx)
        + source[yi[:, None] + 1, xi[None, :] + 1] * fx
    )
    pixels = top * (1 - fy) + bottom * fy
    # Estimate daylight falloff from clean upper tank, not the black lower third.
    clean = np.percentile(pixels[95:370], 72, axis=0)
    gain = np.clip(235 / np.maximum(clean, 1), 0.92, 1.30)
    pixels *= gain[None, :, :]
    rng = np.random.default_rng(24018)
    noise = rng.random((64, 128)) * 255
    noise = (
        np.asarray(
            Image.fromarray(noise.astype("uint8")).resize(
                (width, height), Image.Resampling.BICUBIC
            ),
            dtype=float,
        )
        / 255
    )
    # Break perfect four-quadrant repeats without moving the reference's panel seams.
    angular = (0.96 + 0.04 * np.cos(np.arange(width) * 2 * math.pi / width))[
        None, :, None
    ]
    lower = np.linspace(0, 1, height)[:, None, None] ** 2
    pixels = pixels * (1 - lower * (1 - angular)) + (noise[..., None] - 0.5) * 4
    if iteration >= 2:
        # The first render was too white at the engine end. Layer irregular,
        # vertically stretched char over the photograph, retaining light scars.
        yy = np.linspace(0, 1, height)[:, None]
        angle = np.arange(width)[None, :] * 2 * math.pi / width
        plume = np.clip(
            0.58
            + 0.30 * np.sin(angle * 3 + 0.6)
            + 0.20 * np.sin(angle * 7 - yy * 2.5)
            + (noise - 0.5) * 0.55,
            0.10,
            1.0,
        )
        burn = np.clip((yy - 0.52) / 0.31, 0, 1) ** 1.25
        char = (burn * (0.36 + 0.56 * plume))[..., None]
        pixels = pixels * (1 - char) + np.array([28, 27, 24]) * char
    image = Image.fromarray(np.uint8(np.clip(pixels, 0, 255)))
    image.save(TEXTURES / "booster_soot_1024.jpg", quality=95, subsampling=0)

    # Constant dark RGB outside the holes prevents white halos on mipmapped edges.
    size = 512
    alpha = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(alpha)
    draw.rectangle((1, 1, size - 2, size - 2), outline=255, width=10)
    bar_width = 12 if iteration >= 3 else 8
    for x in range(0, size + 1, 64):
        draw.line((x, 0, x, size), fill=255, width=bar_width)
    for y in range(0, size + 1, 85):
        draw.line((0, y, size, y), fill=255, width=bar_width)
    # Cross-bracing catches a pixel even at skyline scale.
    draw.line((0, 0, size, size), fill=255, width=6)
    draw.line((0, size, size, 0), fill=255, width=6)
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.35))
    grid = Image.new("RGBA", (size, size), (50, 54, 56, 255))
    grid.putalpha(alpha)
    grid.save(TEXTURES / "grid_lattice_512.png")
    print("Prepared 1024px cylindrical soot and 512px MASK lattice.")


def comparison(folder):
    from PIL import Image, ImageDraw, ImageFont

    folder = Path(folder).resolve()
    if not folder.is_relative_to(EVIDENCE):
        raise ValueError(
            "Comparison outputs must remain inside the assigned booster evidence directory"
        )
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 22)
        small = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 16)
    except OSError:
        font = small = ImageFont.load_default()
    sheet = Image.new("RGB", (1800, 1440), "#f1f3f4")
    draw = ImageDraw.Draw(sheet)
    draw.text((28, 18), "BO_01 REFERENCE / R4 GAME MESH", fill="#202832", font=font)
    draw.text(
        (28, 52),
        "45.5 m top | 1.9 m shell radius | four hinge-local legs at z=8 m",
        fill="#485361",
        font=small,
    )
    for col, (name, filename) in enumerate(
        [
            ("BO_01 / approved reference", REFERENCE),
            ("Orthographic / deployed assembly", folder / "front.png"),
            ("Three-quarter / same exported meshes", folder / "threequarter.png"),
        ]
    ):
        image = Image.open(filename).convert("RGBA")
        if col:
            bounds = image.getchannel("A").getbbox()
        else:
            import numpy as np

            rgb = np.asarray(image)[..., :3]
            yy, xx = np.where(rgb.min(axis=2) < 210)
            if not len(xx):
                raise ValueError("The reference has no visible object pixels")
            bounds = (
                max(0, xx.min().item() - 4),
                max(0, yy.min().item() - 4),
                min(image.width, xx.max().item() + 5),
                min(image.height, yy.max().item() + 5),
            )
        if bounds:
            image = image.crop(bounds)
        # Equal physical height, not independent contain-to-fit scaling.
        image = image.resize(
            (round(image.width * 1240 / image.height), 1240), Image.Resampling.LANCZOS
        )
        x, y = col * 600 + (600 - image.width) // 2, 125
        draw.rectangle((col * 600 + 12, 97, col * 600 + 588, 1390), fill="white")
        sheet.paste(image, (x, y), image)
        draw.text((col * 600 + 24, 78), name, fill="#2c3540", font=small)
    draw.text(
        (28, 1410),
        "Equal-height comparison. The reference's wider feet are narrowed to preserve the game's 9 m legs, z=8 m hinges, and approximately 30 degree splay.",
        fill="#485361",
        font=small,
    )
    sheet.save(folder / "comparison.png")
    print("Saved", folder / "comparison.png")


# Helpers deliberately run outside Blender, without importing bpy.
if "--prepare-textures" in sys.argv:
    try:
        prepare_textures(int(sys.argv[sys.argv.index("--prepare-textures") + 1]))
    except (IndexError, ValueError) as exc:
        raise SystemExit(f"Expected a numeric texture iteration: {exc}") from exc
    sys.exit(0)
if "--comparison" in sys.argv:
    comparison(sys.argv[sys.argv.index("--comparison") + 1])
    sys.exit(0)

# These modules are provided by Blender's Python, not system Python.
import bpy  # type: ignore[reportMissingImports]  # noqa: E402
from mathutils import Matrix, Vector  # type: ignore[reportMissingImports]  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--verify", action="store_true")
parser.add_argument("--iteration", type=int, default=3, choices=(1, 2, 3))
parser.add_argument("--no-renders", action="store_true")
args = parser.parse_args(argv)
EVIDENCE.mkdir(parents=True, exist_ok=True)
PYTHON = shutil.which("python3") or "/opt/homebrew/bin/python3"


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1


def srgb(hex_value):
    values = [int(hex_value[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(
        v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in values
    )


def material(name, color, roughness, metallic=0.0, texture=None, mask=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*srgb(color), 1)
    mat.use_backface_culling = not mask
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = mat.diffuse_color
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if texture:
        tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(str(TEXTURES / texture), check_existing=True)
        tex.image.pack()
        mat.node_tree.links.new(tex.outputs["Color"], shader.inputs["Base Color"])
        if mask:
            clip = mat.node_tree.nodes.new("ShaderNodeMath")
            clip.operation = "ROUND"
            mat.node_tree.links.new(tex.outputs["Alpha"], clip.inputs[0])
            mat.node_tree.links.new(clip.outputs[0], shader.inputs["Alpha"])
            mat.surface_render_method = "DITHERED"
            mat.alpha_threshold = 0.5
    return mat


def mesh(name, vertices, faces, mat, uvs=None, smooth=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    data.materials.append(mat)
    if uvs:
        uv = data.uv_layers.new(name="UVMap")
        for face, coords in zip(data.polygons, uvs, strict=True):
            for loop_index, coord in zip(face.loop_indices, coords, strict=True):
                uv.data[loop_index].uv = coord
    if smooth:
        for p in data.polygons:
            p.use_smooth = len(p.vertices) == 4
    ob = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(ob)
    return ob


def box(name, centre, size, mat, transform=None):
    c = Vector(centre)
    vertices = [
        c + Vector((x * size[0] / 2, y * size[1] / 2, z * size[2] / 2))
        for x, y, z in [
            (-1, -1, -1),
            (1, -1, -1),
            (1, 1, -1),
            (-1, 1, -1),
            (-1, -1, 1),
            (1, -1, 1),
            (1, 1, 1),
            (-1, 1, 1),
        ]
    ]
    if transform:
        vertices = [transform @ v for v in vertices]
    return mesh(
        name,
        vertices,
        [
            (0, 3, 2, 1),
            (4, 5, 6, 7),
            (0, 1, 5, 4),
            (1, 2, 6, 5),
            (2, 3, 7, 6),
            (3, 0, 4, 7),
        ],
        mat,
    )


def lathe(name, rings, mat, segments=32, centre=(0, 0, 0), caps=False, texture=False):
    """(z,r) rings; winding supports an open inward-folded bell lip."""
    vertices = [
        (
            centre[0] + r * math.cos(2 * math.pi * i / segments),
            centre[1] + r * math.sin(2 * math.pi * i / segments),
            centre[2] + z,
        )
        for z, r in rings
        for i in range(segments)
    ]
    faces, uvs = [], []
    for row in range(len(rings) - 1):
        for i in range(segments):
            j = (i + 1) % segments
            faces.append(
                (
                    row * segments + i,
                    row * segments + j,
                    (row + 1) * segments + j,
                    (row + 1) * segments + i,
                )
            )
            if texture:
                bottom_v = (rings[row][0] - 3.6) / (41.5 - 3.6)
                top_v = (rings[row + 1][0] - 3.6) / (41.5 - 3.6)
                uvs.append(
                    (
                        (i / segments, bottom_v),
                        ((i + 1) / segments, bottom_v),
                        ((i + 1) / segments, top_v),
                        (i / segments, top_v),
                    )
                )
    if caps:
        faces.extend(
            [
                tuple(reversed(range(segments))),
                tuple((len(rings) - 1) * segments + i for i in range(segments)),
            ]
        )
        if texture:
            uvs.extend([tuple((0.5, 0.5) for _ in range(segments))] * 2)
    return mesh(name, vertices, faces, mat, uvs=uvs, smooth=True)


def rod(name, a, b, radius, mat, segments=8, radius_b=None):
    a, b = Vector(a), Vector(b)
    length = (b - a).length
    ob = lathe(
        name,
        [(0, radius), (length, radius if radius_b is None else radius_b)],
        mat,
        segments=segments,
        caps=True,
    )
    rotate = (b - a).to_track_quat("Z", "Y").to_matrix()
    for vertex in ob.data.vertices:
        vertex.co = a + rotate @ vertex.co
    return ob


def merge(name, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    bpy.context.scene.cursor.location = (0, 0, 0)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    return obj


def radial(a):
    return Matrix.Rotation(math.radians(a), 4, "Z")


def build_body(mats, iteration):
    shell, carbon, hardware, engine, grid = mats
    body = []
    body.append(
        lathe(
            "booster_shell_sooted",
            [(3.6, RADIUS), (8, RADIUS), (22, RADIUS), (41.5, RADIUS)],
            shell,
            segments=48,
            texture=True,
        )
    )
    stage = [
        lathe(
            "interstage_shell",
            [
                (41.5, 1.9),
                (41.58, 1.9),
                (45.44, 1.9),
                (45.5, 1.86),
                (45.5, 1.74),
                (44.92, 1.74),
            ],
            carbon,
            segments=48,
        )
    ]
    stage.append(
        lathe(
            "interstage_inner_bulkhead",
            [(44.90, 1.74), (44.93, 1.74)],
            carbon,
            segments=32,
            caps=True,
        )
    )
    for i in range(12):
        a = i * 30
        stage.append(
            box(
                "interstage_panel_rib",
                (1.902, 0, 43.4),
                (0.045, 0.055, 3.57),
                carbon if iteration >= 2 else hardware,
                radial(a),
            )
        )
        for z in (41.74, 45.20):
            stage.append(
                box(
                    "interstage_latch",
                    (1.935, 0, z),
                    (0.085, 0.14, 0.19),
                    carbon,
                    radial(a),
                )
            )
    for z in (41.55, 45.39):
        stage.append(
            lathe(
                "interstage_lip",
                [(z - 0.045, 1.903), (z + 0.045, 1.903)],
                engine if iteration >= 2 else hardware,
                segments=48,
            )
        )
    body.append(merge("booster_interstage", stage))

    # Narrow physical collar at the tank / engine bay transition.
    collars = [
        lathe(
            "engine_bay_collar",
            [(3.42, 1.81), (3.52, 1.9), (3.65, 1.9)],
            engine,
            segments=48,
        )
    ]
    collars.append(
        lathe(
            "engine_bay_interior",
            [(2.64, 1.70), (3.45, 1.80)],
            carbon,
            segments=32,
            caps=True,
        )
    )
    body.append(merge("booster_engine_mount", collars))

    bells, pipes = [], []
    engine_centres = [(0, 0)] + [
        (1.22 * math.cos(i * math.pi / 4), 1.22 * math.sin(i * math.pi / 4))
        for i in range(8)
    ]
    for i, (x, y) in enumerate(engine_centres):
        # Exterior folds over the ground lip into a real dark nozzle interior.
        bells.append(
            lathe(
                f"bell_{i:02d}",
                list(
                    reversed(
                        [
                            (2.52, 0.18),
                            (1.67, 0.18),
                            (1.55, 0.26),
                            (1.35, 0.235),
                            (0.38, 0.405),
                            (0.07, 0.47),
                            (0.0, 0.47),
                            (0.035, 0.423),
                            (0.40, 0.355),
                            (1.29, 0.19),
                        ]
                    )
                ),
                engine,
                segments=12,
                centre=(x, y, 0),
            )
        )
        bells.append(
            lathe(
                f"bell_dark_throat_{i:02d}",
                [(1.30, 0.19), (1.32, 0.19)],
                carbon,
                segments=12,
                centre=(x, y, 0),
                caps=True,
            )
        )
        pipes.append(
            lathe(
                "bell_clamp",
                [(1.50, 0.271), (1.59, 0.271)],
                hardware,
                segments=12,
                centre=(x, y, 0),
            )
        )
        pipes.append(
            rod(
                "feed_pipe",
                (x + 0.21, y, 1.6),
                (x + 0.21, y, 2.98),
                0.045,
                hardware,
                segments=6,
            )
        )
        pipes.append(box("turbopump", (x - 0.12, y, 2.34), (0.36, 0.42, 0.48), engine))
    body.append(merge("booster_nine_engine_bells", bells))
    body.append(merge("booster_engine_plumbing", pipes))

    # Brackets are body-owned. Four empties encode the exact animation pivots.
    for a in AZIMUTHS:
        transform = radial(a)
        bracket = [
            box("hinge_saddle", (1.91, 0, 8), (0.16, 0.86, 0.92), carbon, transform)
        ]
        for y in (-0.33, 0.33):
            bracket.append(
                box("clevis_ear", (2.00, y, 8), (0.32, 0.14, 0.52), hardware, transform)
            )
        bracket.append(
            rod(
                "hinge_axle",
                transform @ Vector((1.9, -0.48, 8)),
                transform @ Vector((1.9, 0.48, 8)),
                0.14,
                engine,
                segments=10,
            )
        )
        for z in (7.67, 8.33):
            bracket.append(
                box(
                    "hinge_bolt",
                    (2.018, 0, z),
                    (0.075, 0.20, 0.10),
                    hardware,
                    transform,
                )
            )
        if iteration >= 2:
            bracket.append(
                box(
                    "lower_support_saddle",
                    (1.93, 0, 4.02),
                    (0.18, 0.74, 0.42),
                    carbon,
                    transform,
                )
            )
            bracket.append(
                rod(
                    "lower_support_pin",
                    transform @ Vector((1.94, -0.36, 4.0)),
                    transform @ Vector((1.94, 0.36, 4.0)),
                    0.11,
                    hardware,
                    segments=8,
                )
            )
        body.append(merge(f"hinge_bracket_{a:03d}", bracket))
        hinge = bpy.data.objects.new(f"leg_hinge_{a:03d}", None)
        bpy.context.collection.objects.link(hinge)
        hinge.location = transform @ Vector((RADIUS, 0, HINGE_Z))
        hinge.rotation_euler.z = math.radians(a)
        hinge.empty_display_size = 0.2
        hinge["azimuth_degrees"] = a
        hinge["rotation_axis_local"] = "+Y; deploy negative"
        body.append(hinge)

    # Four thin framed lattice panels. Alternate cants match BO_01's four visible fins.
    fin_azimuths = (45, 135, 225, 315) if iteration >= 2 else (0, 90, 180, 270)
    for i, a in enumerate(fin_azimuths):
        transform = radial(a)
        cant = 1 if i % 2 == 0 else -1
        root_z = (43.4 if cant > 0 else 42.4) if iteration >= 2 else 42.5
        tip_z = (44.4 if cant > 0 else 40.9) if iteration >= 2 else 42.5 + cant * 0.85
        start = Vector((2.18, 0, root_z))
        end = Vector((4.46, 0, tip_z))
        width = Vector((0, 0.43, 0.65))
        corners = [start - width, end - width, end + width, start + width]
        world = [transform @ p for p in corners]
        panel = mesh(
            f"grid_fin_{a:03d}",
            world,
            [(0, 1, 2, 3)],
            grid,
            uvs=[[(0, 0), (1, 0), (1, 1), (0, 1)]],
        )
        body.append(panel)
        frame = [
            rod("fin_frame", world[j], world[(j + 1) % 4], 0.065, carbon, segments=6)
            for j in range(4)
        ]
        frame.append(
            rod(
                "fin_hinge_arm",
                transform @ Vector((1.83, 0, root_z)),
                transform @ start,
                0.14,
                engine,
                segments=8,
            )
        )
        frame.append(
            rod(
                "fin_actuator",
                transform @ Vector((1.92, 0, root_z - 0.55)),
                transform @ Vector((2.47, 0, root_z - 0.10)),
                0.085,
                hardware,
                segments=8,
            )
        )
        body.append(merge(f"grid_frame_{a:03d}", frame))

    root = bpy.data.objects.new("booster_body", None)
    bpy.context.collection.objects.link(root)
    root["authoring_up"] = "+Z; standard glTF +Y up on disk"
    root["origin"] = "ground centre, engine bell lowest lip z=0"
    root["shell_radius_m"] = RADIUS
    root["top_z_m"] = HEIGHT
    root["leg_hinge_z_m"] = HINGE_Z
    root["leg_azimuths_deg"] = list(AZIMUTHS)
    for obj in body:
        obj.parent = root
    return [root] + body


def build_leg(carbon, hardware, iteration):
    pieces = []
    # The two carbon spars taper into long exposed metal pistons at the small pad.
    top_z = -0.08 if iteration >= 3 else -0.2
    piston_z, foot_z = -6.43, -PAD_CENTRE_LENGTH + 0.12
    for side in (-1, 1):
        a = Vector((0, side * 0.43, top_z))
        b = Vector((0.06, side * 0.13, foot_z))
        t = (piston_z - top_z) / (foot_z - top_z)
        split = a.lerp(b, t)
        pieces.append(
            rod("carbon_spar", a, split, 0.145, carbon, segments=8, radius_b=0.12)
        )
        pieces.append(rod("exposed_piston", split, b, 0.081, hardware, segments=8))
        direction = (b - a).normalized()
        pieces.append(
            rod(
                "piston_collar",
                split - direction * 0.15,
                split + direction * 0.12,
                0.142,
                hardware,
                segments=8,
            )
        )
        pieces.append(
            rod(
                "pad_fork",
                b,
                (0, side * 0.23, -PAD_CENTRE_LENGTH + 0.09),
                0.09,
                carbon,
                segments=6,
            )
        )
    if iteration >= 2:
        # Radial A-frame return: it nests inside the body when stowed and
        # meets the lower body clevis near z=4 m at the demonstrated deployment.
        for side in (-1, 1):
            start = Vector((-1.70, side * 0.25, -3.64))
            end = Vector((0.02, side * 0.13, foot_z))
            split = start.lerp(end, 0.68)
            pieces.append(
                rod(
                    "inner_support_carbon",
                    start,
                    split,
                    0.115,
                    carbon,
                    segments=8,
                    radius_b=0.105,
                )
            )
            pieces.append(
                rod("inner_support_piston", split, end, 0.071, hardware, segments=8)
            )
        pieces.append(
            rod(
                "inner_support_crosspin",
                (-1.70, -0.34, -3.64),
                (-1.70, 0.34, -3.64),
                0.10,
                hardware,
                segments=8,
            )
        )
    pieces.append(
        rod("hinge_crosspin", (0, -0.56, 0), (0, 0.56, 0), 0.13, hardware, segments=10)
    )
    for z, width in ((-0.55, 0.42), (-2.75, 0.34), (-5.65, 0.24)):
        pieces.append(
            rod(
                "a_frame_crossbrace",
                (0.03, -width, z),
                (0.03, width, z),
                0.075,
                carbon,
                segments=6,
            )
        )
    pieces.append(
        rod(
            "outward_shock",
            (0.15, 0, -0.6),
            (0.17, 0, -4.45),
            0.19,
            carbon,
            segments=8,
            radius_b=0.155,
        )
    )
    pieces.append(
        rod("shock_rod", (0.17, 0, -4.4), (0.08, 0, -6.65), 0.069, hardware, segments=8)
    )
    pieces.append(
        rod(
            "shock_lower_yoke",
            (0.08, -0.20, -6.65),
            (0.08, 0.20, -6.65),
            0.085,
            carbon,
            segments=6,
        )
    )
    # A chamfered eight-sided sole, pre-canted so the deployed bottom is flat.
    outline = [
        (-0.325, -0.38),
        (-0.19, -0.575),
        (0.19, -0.575),
        (0.325, -0.38),
        (0.325, 0.38),
        (0.19, 0.575),
        (-0.19, 0.575),
        (-0.325, 0.38),
    ]
    rotate = Matrix.Rotation(DEPLOY_ANGLE, 3, "Y")
    vertices = [
        rotate @ Vector((x, y, z)) + Vector((0, 0, -PAD_CENTRE_LENGTH))
        for z in (-0.08, 0.08)
        for x, y in outline
    ]
    faces = [tuple(reversed(range(8))), tuple(range(8, 16))] + [
        (i, (i + 1) % 8, (i + 1) % 8 + 8, i + 8) for i in range(8)
    ]
    pieces.append(mesh("small_foot_pad", vertices, faces, carbon))
    pieces.append(
        rod(
            "foot_axle",
            (0, -0.30, -PAD_CENTRE_LENGTH + 0.12),
            (0, 0.30, -PAD_CENTRE_LENGTH + 0.12),
            0.09,
            hardware,
            segments=8,
        )
    )
    leg = merge("booster_leg", pieces)
    leg["origin"] = "hinge (0,0,0)"
    leg["rest_direction"] = "-Z"
    leg["outward_face"] = "+X"
    leg["hinge_axle"] = "+Y"
    leg["rest_lowest_z_m"] = -9.0
    leg["deployed_angle_deg"] = math.degrees(DEPLOY_ANGLE)
    return [leg]


def glb_json(path):
    payload = Path(path).read_bytes()
    magic, version, length = struct.unpack_from("<4sII", payload)
    assert magic == b"glTF" and version == 2 and length == len(payload)
    json_length, chunk_type = struct.unpack_from("<II", payload, 12)
    assert chunk_type == 0x4E4F534A
    try:
        doc = json.loads(payload[20 : 20 + json_length])
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError(f"Invalid JSON chunk in {path}") from exc
    return doc, payload, json_length


def enforce_grid_mask(path):
    """Blender versions differ: force MASK, never BLEND, without changing binary data."""
    doc, payload, old_length = glb_json(path)
    for mat in doc.get("materials", []):
        if mat["name"].startswith("grid"):
            mat["alphaMode"] = "MASK"
            mat["alphaCutoff"] = 0.5
            mat["doubleSided"] = True
    encoded = json.dumps(doc, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    tail = payload[20 + old_length :]
    Path(path).write_bytes(
        struct.pack("<4sII", b"glTF", 2, 20 + len(encoded) + len(tail))
        + struct.pack("<II", len(encoded), 0x4E4F534A)
        + encoded
        + tail
    )


def export(path, objects):
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        use_selection=True,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )
    enforce_grid_mask(path)


def bbox(objects):
    coords = [
        o.matrix_world @ v.co
        for o in objects
        if o.type == "MESH"
        for v in o.data.vertices
    ]
    minimum = [min(v[i] for v in coords) for i in range(3)]
    maximum = [max(v[i] for v in coords) for i in range(3)]
    return {
        "min": [round(v, 6) for v in minimum],
        "max": [round(v, 6) for v in maximum],
        "size": [round(b - a, 6) for a, b in zip(minimum, maximum, strict=True)],
    }


def verify_one(path, budget, is_leg=False):
    reset()
    bpy.ops.import_scene.gltf(filepath=str(path))
    bpy.context.view_layer.update()
    objects = list(bpy.context.scene.objects)
    bounds = bbox(objects)
    doc, data, _ = glb_json(path)
    triangles = 0
    for obj in objects:
        if obj.type == "MESH":
            obj.data.calc_loop_triangles()
            triangles += len(obj.data.loop_triangles)
    gltf_triangles = sum(
        doc["accessors"][p["indices"]]["count"] // 3
        for m in doc["meshes"]
        for p in m["primitives"]
    )
    assert triangles == gltf_triangles
    assert triangles <= budget, f"{path.name}: {triangles} tris exceeds {budget}"
    assert len(doc["materials"]) <= 6
    assert all(
        "uri" not in image and "bufferView" in image for image in doc.get("images", [])
    )
    assert all("uri" not in b for b in doc.get("buffers", []))
    images = [
        {
            "name": image.name,
            "size": list(image.size),
            "packed": bool(image.packed_file),
        }
        for image in bpy.data.images
        if image.type == "IMAGE"
    ]
    assert all(max(image["size"]) <= 1024 and image["packed"] for image in images)
    materials = [
        {
            "name": mat["name"],
            "alphaMode": mat.get("alphaMode", "OPAQUE"),
            "doubleSided": mat.get("doubleSided", False),
        }
        for mat in doc["materials"]
    ]
    if is_leg:
        assert abs(bounds["min"][2] + 9) < 0.0001
        root = bpy.data.objects.get("booster_leg")
        assert root and root.matrix_world.translation.length < 1e-5
        assert bounds["max"][0] < 0.5 and bounds["min"][0] > -1.9
    else:
        assert (
            abs(bounds["min"][2]) < 0.0001 and abs(bounds["max"][2] - HEIGHT) < 0.0001
        )
        shell = bpy.data.objects["booster_shell_sooted"]
        shell_bounds = bbox([shell])
        assert abs(shell_bounds["size"][0] - 3.8) < 0.0001
        assert abs(shell_bounds["size"][1] - 3.8) < 0.0001
        assert (
            len(
                [
                    m
                    for m in materials
                    if m["name"].startswith("grid") and m["alphaMode"] == "MASK"
                ]
            )
            == 1
        )
        assert len([o for o in objects if o.name.startswith("grid_fin_")]) == 4
        assert not any(o.name == "booster_leg" for o in objects)
        for a in AZIMUTHS:
            hinge = bpy.data.objects[f"leg_hinge_{a:03d}"]
            expected = radial(a) @ Vector((RADIUS, 0, HINGE_Z))
            assert (hinge.matrix_world.translation - expected).length < 1e-5
        root = bpy.data.objects.get("booster_body")
        assert root and root.matrix_world.translation.length < 1e-5
    gltf_bounds = {
        "min": [bounds["min"][0], bounds["min"][2], -bounds["max"][1]],
        "max": [bounds["max"][0], bounds["max"][2], -bounds["min"][1]],
        "size": [bounds["size"][0], bounds["size"][2], bounds["size"][1]],
    }
    report = {
        "file": str(path.relative_to(ROOT)),
        "bytes": len(data),
        "authoringAxis": "+Z up (re-imported from standard +Y-up glTF)",
        "bbox_m": bounds,
        "gltf_y_up_bbox_m": gltf_bounds,
        "triangles": triangles,
        "triangleBudget": budget,
        "materials": materials,
        "embeddedImages": images,
        "nodes": [node.get("name", "") for node in doc["nodes"]],
        "checks": "passed",
    }
    print(json.dumps(report, indent=2))
    return report


def import_assembly():
    reset()
    bpy.ops.import_scene.gltf(filepath=str(BODY_PATH))
    body = list(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(LEG_PATH))
    rest_leg = bpy.data.objects["booster_leg"]
    rest_leg.hide_render = True
    legs = []
    for a in AZIMUTHS:
        leg = rest_leg.copy()
        # Data remain shared: these are four instances of the one exported asset.
        bpy.context.collection.objects.link(leg)
        leg.name = f"preview_leg_{a:03d}"
        leg.hide_render = False
        transform = radial(a)
        hinge = transform @ Vector((RADIUS, 0, HINGE_Z))
        leg.matrix_world = (
            Matrix.Translation(hinge)
            @ transform
            @ Matrix.Rotation(-DEPLOY_ANGLE, 4, "Y")
        )
        legs.append(leg)
    bpy.context.view_layer.update()
    for leg in legs:
        assert abs(bbox([leg])["min"][2]) < 1e-4
    return body, legs, rest_leg


def preview(folder):
    folder.mkdir(parents=True, exist_ok=True)
    body, legs, rest_leg = import_assembly()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.render.image_settings.color_depth = "8"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0.15
    scene.world = bpy.data.worlds.new("preview_world")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (
        0.62,
        0.66,
        0.72,
        1,
    )
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
    scene.eevee.taa_render_samples = 48

    def area(name, location, energy, size, target, color=(1, 1, 1)):
        data = bpy.data.lights.new(name, "AREA")
        data.energy, data.shape, data.size = energy, "DISK", size
        data.color = color
        ob = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(ob)
        ob.location = location
        ob.rotation_euler = (
            (Vector(target) - ob.location).to_track_quat("-Z", "Y").to_euler()
        )

    area("preview_key", (12, -18, 31), 11500, 22, (0, 0, 22))
    area("preview_fill", (-15, -8, 18), 7500, 25, (0, 0, 19), (0.90, 0.95, 1))
    area("preview_rim", (7, 12, 35), 16000, 20, (0, 0, 29))
    area("preview_bottom_card", (5, -10, 4), 1400, 9, (0, 0, 3))
    cam_data = bpy.data.cameras.new("preview_camera")
    cam = bpy.data.objects.new("preview_camera", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    cam_data.type = "ORTHO"
    cam_data.lens = 55
    cam_data.clip_end = 500

    def render(name, location, target, scale, resolution):
        cam.location = location
        cam.rotation_euler = (
            (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
        )
        cam_data.ortho_scale = scale
        scene.render.resolution_x, scene.render.resolution_y = resolution
        scene.render.filepath = str(folder / (name + ".png"))
        bpy.ops.render.render(write_still=True)

    render("front", (0, -90, 22.75), (0, 0, 22.75), 49, (800, 1440))
    render("threequarter", (55, -80, 36), (0, 0, 22.75), 49, (800, 1440))
    render("engine_legs", (17, -24, 10), (0, 0, 4.5), 17.2, (1200, 900))
    render("grid_fins", (11, -19, 46), (0, 0, 43.2), 10.8, (1200, 900))
    for ob in body + legs:
        ob.hide_render = True
    rest_leg.hide_render = False
    render("leg_rest", (15, -9, -3.2), (0, 0, -4.4), 10.5, (600, 1200))
    rest_leg.hide_render = True
    for ob in body + legs:
        ob.hide_render = False
    # A useful skyline-scale proof: the two boosters the game actually shows.
    assembly = [o for o in body + legs if o.type == "MESH"]
    for original in assembly:
        copy = original.copy()
        copy.parent = None
        copy.matrix_world = original.matrix_world.copy()
        copy.location.x += 17
        bpy.context.collection.objects.link(copy)
    render("skyline_pair", (8.5, -110, 30), (8.5, 0, 22), 55, (1000, 1000))
    subprocess.run(
        [PYTHON, str(Path(__file__).resolve()), "--comparison", str(folder)], check=True
    )


def main():
    if args.verify:
        records = [verify_one(BODY_PATH, 6000), verify_one(LEG_PATH, 800, is_leg=True)]
        body, legs, _ = import_assembly()
        feet = {leg.name: bbox([leg])["min"][2] for leg in legs}
        report = {
            "assets": records,
            "deployment": {
                "angle_degrees": math.degrees(DEPLOY_ANGLE),
                "hinge_z_m": HINGE_Z,
                "azimuth_degrees": list(AZIMUTHS),
                "formula_blender": "T(1.9*cos(a),1.9*sin(a),8) @ Rz(a) @ Ry(-angle)",
                "formula_gltf": "T(1.9*cos(a),8,-1.9*sin(a)) @ Ry(a) @ Rz(angle)",
                "observed_pad_min_z_m": feet,
                "assembly_bbox_m": bbox(body + legs),
            },
        }
        print("DEPLOYMENT", json.dumps(report["deployment"], indent=2))
        (EVIDENCE / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
        if not args.no_renders:
            preview(EVIDENCE / "verified")
        return
    subprocess.run(
        [
            PYTHON,
            str(Path(__file__).resolve()),
            "--prepare-textures",
            str(args.iteration),
        ],
        check=True,
    )
    reset()
    shell = material("body_soot", "ecebe5", 0.83, 0.08, "booster_soot_1024.jpg")
    carbon = material(
        "carbon_dark", "222628" if args.iteration >= 2 else "2c3033", 0.76, 0.18
    )
    hardware = material(
        "hardware_titanium", "666962" if args.iteration >= 2 else "82837c", 0.51, 0.65
    )
    engine = material(
        "engine_graphite", "46413c" if args.iteration >= 2 else "575451", 0.46, 0.72
    )
    grid = material(
        "grid_lattice", "323638", 0.70, 0.20, "grid_lattice_512.png", mask=True
    )
    body = build_body((shell, carbon, hardware, engine, grid), args.iteration)
    leg = build_leg(carbon, hardware, args.iteration)
    export(BODY_PATH, body)
    export(LEG_PATH, leg)
    print("Exported", BODY_PATH, LEG_PATH)
    if not args.no_renders:
        preview(EVIDENCE / f"iteration_{args.iteration:02d}")


if __name__ == "__main__":
    main()
