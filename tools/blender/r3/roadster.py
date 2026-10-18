"""Approved silver R3 Roadster, procedural game mesh, measured from R_01/R_02.

  /opt/homebrew/bin/blender -b -P tools/blender/r3/roadster.py -- \
    --out public/assets/gen/roadster_r3.glb \
    --preview-dir research/raycity/r3-assets/roadster
  # Independently import and verify the exported asset:
  /opt/homebrew/bin/blender -b -P tools/blender/r3/roadster.py -- \
    --verify public/assets/gen/roadster_r3.glb \
    --preview-dir research/raycity/r3-assets/roadster

Metres; +X forward, +Z up; origin ground/footprint centre. R_01's approved
44..1865 x 171..670 silhouette, not the over-wide end elevations, controls
proportions. Wheels are single-material meshes with local Y axles. The trim
atlas includes the tolerance-keyed R_06 rim and solid rubber/metal swatches:
this deliberately avoids glTF multi-primitive wheel nodes, which the current
game loader would mistake for extra wheels. R_08 supplies the small underside
sticker. Seven explicitly requested materials (the vehicle-specific exception
to the general four-material prop rule). No logos or incidental lettering.

All geometry, source crops, exports, spec, comparison and verification reports
are reproducible here. Pillow is called via system Python; scratch is confined
to /tmp/r3-roadster2. Previews and metadata never enter the exported GLB.
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
REFS = ROOT / "research/raycity/generated/2026-10-17-round3"
SCRATCH = Path("/tmp/r3-roadster2")
SCRATCH.mkdir(parents=True, exist_ok=True)


def prepare_images():
    import numpy as np
    from PIL import Image

    # Rim only: discard outer tyre, photograph the faceted spokes. Whites in
    # the open spoke apertures are near #FEFEFE, not exactly #FFFFFF.
    src = Image.open(REFS / "R_06.png").convert("RGB")
    crop = src.crop((148, 143, 1104, 1099)).resize((896, 896), Image.Resampling.LANCZOS)
    rgb = np.asarray(crop).astype(float)
    lo, hi = rgb.min(axis=2), rgb.max(axis=2)
    a = np.where(hi - lo < 22, np.clip((248 - lo) / 21, 0, 1), 1)
    # Unmatte the near-white fringe; no white halo around the keyed openings.
    corrected = (rgb - 254 * (1 - a[..., None])) / np.maximum(a[..., None], 0.03)
    rgba = np.dstack((np.clip(corrected * 0.82, 0, 255), a * 255)).astype("uint8")
    atlas = Image.new("RGBA", (1024, 1024), (16, 18, 20, 255))
    atlas.paste(Image.fromarray(rgba), (0, 0))
    for x, c in [
        (0, (18, 20, 22, 255)),
        (256, (34, 37, 40, 255)),
        (512, (76, 78, 81, 255)),
        (768, (10, 12, 14, 255)),
    ]:
        atlas.paste(c, (x, 920, x + 256, 1024))
    atlas.save(SCRATCH / "roadster_trim_atlas.png")

    # The rounded white sticker, not its surrounding black undertray.
    s = Image.open(REFS / "R_08.png").convert("RGB").crop((873, 324, 1051, 467))
    a = np.asarray(s).astype(float)
    h, w = a.shape[:2]
    yy, xx = np.mgrid[:h, :w]
    radius = 10
    dx = np.maximum(np.maximum(radius - xx, xx - (w - 1 - radius)), 0)
    dy = np.maximum(np.maximum(radius - yy, yy - (h - 1 - radius)), 0)
    alpha = np.clip(radius + 0.6 - np.sqrt(dx * dx + dy * dy), 0, 1)
    # At the cropped rounded edge, remove the dark source undertray fringe.
    a = np.where((alpha < 0.99)[..., None], np.maximum(a, 217), a)
    Image.fromarray(np.dstack((a, alpha * 255)).astype("uint8")).save(
        SCRATCH / "this_side_up.png"
    )


def comparison(out_dir):
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont

    out_dir = Path(out_dir)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 19)
        small = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 14)
    except OSError:
        font = small = ImageFont.load_default()
    rows = [
        ("side", "R_01", None),
        ("top", "R_02", None),
        ("front", "R_03", None),
        ("rear", "R_04", None),
        ("three-quarter", "R_00_v2", (505, 290, 1370, 655)),
        ("chase", "R_05", (495, 290, 1250, 727)),
    ]
    sheet = Image.new("RGB", (1000, 6 * 255 + 80), "#f4f5f6")
    draw = ImageDraw.Draw(sheet)
    draw.text((20, 9), "APPROVED REFERENCE  /  R3 GAME MESH", fill="#242a31", font=font)
    draw.text(
        (20, 37),
        "Side/top govern dimensions. End references are intentionally not used for width.",
        fill="#515c68",
        font=small,
    )
    for row, (view, ref, box) in enumerate(rows):
        y = 75 + row * 255
        reference = Image.open(REFS / (ref + ".png")).convert("RGB")
        if box:
            reference = reference.crop(box)
        else:
            arr = np.asarray(reference)
            mask = arr.min(axis=2) < 226
            ys, xs = np.where(mask)
            reference = reference.crop(
                (
                    max(0, xs.min() - 12),
                    max(0, ys.min() - 12),
                    min(reference.width, xs.max() + 13),
                    min(reference.height, ys.max() + 13),
                )
            )
        render = Image.open(out_dir / (view + ".png")).convert("RGBA")
        # Transparent orthographic renders get the same tight object crop as
        # the reference. Ground is deliberately absent in these comparisons.
        if render.getchannel("A").getextrema()[0] < 255:
            b = render.getchannel("A").getbbox()
            if b:
                render = render.crop(b)
            bg = Image.new("RGBA", render.size, "white")
            bg.alpha_composite(render)
            render = bg.convert("RGB")
        for col, im in enumerate([reference, render]):
            im.thumbnail((470, 211), Image.Resampling.LANCZOS)
            sheet.paste(
                im, (col * 500 + (500 - im.width) // 2, y + 25 + (213 - im.height) // 2)
            )
        draw.text((17, y), f"{ref} / {view}", fill="#242a31", font=small)
        draw.text((517, y), "4.60 x 1.86 x 1.26 m", fill="#242a31", font=small)
        draw.line((10, y + 249, 990, y + 249), fill="#cdd2d8", width=1)
    sheet.save(out_dir / "comparison.png")


if "--prepare-images" in sys.argv:
    prepare_images()
    sys.exit(0)
if "--comparison" in sys.argv:
    comparison(sys.argv[sys.argv.index("--comparison") + 1])
    sys.exit(0)

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--out", default=str(ROOT / "public/assets/gen/roadster_r3.glb"))
parser.add_argument(
    "--preview-dir", default=str(ROOT / "research/raycity/r3-assets/roadster")
)
parser.add_argument("--verify", default="")
parser.add_argument("--no-renders", action="store_true")
args = parser.parse_args(argv)
OUT = Path(args.out).resolve()
PREVIEW = Path(args.preview_dir).resolve()
PREVIEW.mkdir(parents=True, exist_ok=True)
PYTHON = shutil.which("python3") or "/opt/homebrew/bin/python3"

# Mandatory clean scene, including in the independent verification mode.
bpy.ops.wm.read_factory_settings(use_empty=True)

SCALE = 4.60 / (1865 - 44)
LENGTH, WIDTH, HEIGHT = 4.60, 1.86, 1.26
FRONT_X = 2.30 - (462 - 44) * SCALE
REAR_X = 2.30 - (1624 - 44) * SCALE
RADIUS, TRACK = 0.354, 1.60
GROUND, FRONT_LIGHT, REAR_LIGHT = 0.145, 0.485, 0.875
CENTRES = {
    "wheel_fl": (FRONT_X, TRACK / 2, RADIUS),
    "wheel_fr": (FRONT_X, -TRACK / 2, RADIUS),
    "wheel_rl": (REAR_X, TRACK / 2, RADIUS),
    "wheel_rr": (REAR_X, -TRACK / 2, RADIUS),
}


def verification(path):
    """Fresh Blender import plus GLB primitive/image inspection."""
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    coords = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
    mn = [min(v[i] for v in coords) for i in range(3)]
    mx = [max(v[i] for v in coords) for i in range(3)]
    material_tris = {}
    objects = []
    for o in meshes:
        o.data.calc_loop_triangles()
        loose = sum(
            1
            for v in o.data.vertices
            if not any(v.index in p.vertices for p in o.data.polygons)
        )
        for t in o.data.loop_triangles:
            name = o.data.materials[t.material_index].name
            material_tris[name] = material_tris.get(name, 0) + 1
        objects.append(
            {
                "name": o.name,
                "triangles": len(o.data.loop_triangles),
                "vertices": len(o.data.vertices),
                "origin": list(o.location),
                "materials": [m.name for m in o.data.materials],
                "looseVertices": loose,
            }
        )
    data = Path(path).read_bytes()
    jlen, jtype = struct.unpack_from("<II", data, 12)
    gltf = json.loads(data[20 : 20 + jlen])
    gltfverts = {}
    wheel_nodes = []
    names = [m["name"] for m in gltf.get("materials", [])]
    for m in gltf.get("meshes", []):
        for p in m["primitives"]:
            n = names[p["material"]]
            gltfverts[n] = (
                gltfverts.get(n, 0)
                + gltf["accessors"][p["attributes"]["POSITION"]]["count"]
            )
    for n in gltf.get("nodes", []):
        if n.get("name", "").startswith("wheel_"):
            wheel_nodes.append(
                {
                    "name": n["name"],
                    "primitiveCount": len(gltf["meshes"][n["mesh"]]["primitives"]),
                    "gltfTranslation": n.get("translation", [0, 0, 0]),
                }
            )
    images = [
        {
            "name": im.name,
            "width": im.size[0],
            "height": im.size[1],
            "packed": bool(im.packed_file),
        }
        for im in bpy.data.images
        if im.type == "IMAGE"
    ]
    report = {
        "file": str(path.relative_to(ROOT) if path.is_relative_to(ROOT) else path),
        "fileBytes": len(data),
        "fileKB": round(len(data) / 1024, 2),
        "bboxMinBlender": mn,
        "bboxMaxBlender": mx,
        "dimensionsM": [round(mx[i] - mn[i], 6) for i in range(3)],
        "triangleCount": sum(o["triangles"] for o in objects),
        "materialTriangles": material_tris,
        "materialNonIndexedVertices": {k: 3 * v for k, v in material_tris.items()},
        "materialGLTFPositionVertices": gltfverts,
        "objects": objects,
        "wheelNodes": wheel_nodes,
        "materials": names,
        "embeddedImages": images,
        "externalImageURIs": [i["uri"] for i in gltf.get("images", []) if "uri" in i],
    }
    assert set(names) == {
        "body",
        "glass_canopy",
        "trim",
        "light_front",
        "light_rear",
        "under",
        "sticker",
    }
    assert {o["name"] for o in objects} == set(CENTRES) | {
        "body_shell",
        "closed_canopy",
        "lower_trim_and_panel_seams",
        "front_light_strip",
        "rear_light_bar",
        "undertray_and_four_downward_nozzles",
        "underside_sticker",
    }
    assert all(
        max(abs(c) for c in o["origin"]) < 1e-7
        for o in objects
        if o["name"] not in CENTRES
    )
    assert abs(mn[0] + mx[0]) < 1e-6 and abs(mn[1] + mx[1]) < 1e-6
    assert report["triangleCount"] <= 14000, report["triangleCount"]
    assert all(
        abs(a - b) < 1e-4
        for a, b in zip(report["dimensionsM"], [LENGTH, WIDTH, HEIGHT])
    )
    assert abs(mn[2]) < 1e-6
    assert set(n["name"] for n in wheel_nodes) == set(CENTRES)
    assert all(n["primitiveCount"] == 1 for n in wheel_nodes)
    assert all(o["triangles"] <= 1000 for o in objects if o["name"] in CENTRES)
    assert material_tris["body"] > max(
        v for k, v in material_tris.items() if k != "body"
    )
    assert gltfverts["body"] > max(v for k, v in gltfverts.items() if k != "body")
    assert not report["externalImageURIs"]
    report["alphaModes"] = {
        m["name"]: m.get("alphaMode", "OPAQUE") for m in gltf["materials"]
    }
    assert report["alphaModes"]["trim"] == report["alphaModes"]["sticker"] == "MASK"
    assert len(images) == 2 and all(i["packed"] for i in images)
    assert all(max(i["width"], i["height"]) <= 1024 for i in images)
    assert all(o["looseVertices"] == 0 for o in objects)
    for o in objects:
        if o["name"] in CENTRES:
            assert all(
                abs(a - b) < 1e-5 for a, b in zip(o["origin"], CENTRES[o["name"]])
            )
    # Surface regressions are checked on the re-imported GLB, not on the
    # authoring functions. Respect backface culling as the browser does.
    depsgraph = bpy.context.evaluated_depsgraph_get()

    def visible_surface(origin, direction):
        origin, direction = Vector(origin), Vector(direction).normalized()
        for _ in range(32):
            hit, point, normal, _, obj, _ = bpy.context.scene.ray_cast(
                depsgraph, origin, direction
            )
            if not hit:
                return None
            if normal.dot(direction) < -1e-7:
                return obj.name
            origin = point + direction * 0.00002
        raise AssertionError("Too many backfaces in canopy visibility probe")

    probes = {}
    for label, x, ys in [
        ("broad_windscreen_rim", 1.50, [-0.38, 0, 0.38]),
        ("broad_rear_rim", -1.74, [-0.30, 0, 0.30]),
    ]:
        probes[label] = [visible_surface((x, y, 3), (0, 0, -1)) for y in ys]
        assert all(name == "closed_canopy" for name in probes[label]), probes
    for label, x, direction in [
        ("windscreen", 8, (-1, 0, 0)),
        ("rear_glass", -8, (1, 0, 0)),
    ]:
        probes[label] = [
            visible_surface((x, y, z), direction)
            for y in [-0.35, 0, 0.35]
            for z in [1.03, 1.12, 1.20]
        ]
        assert all(name == "closed_canopy" for name in probes[label]), probes
    rear_runs = {}
    for z in [1.01, 1.04, 1.08, 1.12, 1.16, 1.20, 1.24]:
        row = [
            visible_surface((-8, -0.90 + i * 0.01, z), (1, 0, 0)) == "closed_canopy"
            for i in range(181)
        ]
        runs = sum(
            is_glass and (i == 0 or not row[i - 1]) for i, is_glass in enumerate(row)
        )
        rear_runs[str(z)] = runs
        assert runs == 1, f"Rear glass split by a pillar/rail at z={z}: {runs} spans"
    camera = Vector((9, 6, 2.6))
    quarter = Vector((-1.10, 0.78433, 1.05871))
    probes["closed_rear_quarter_return"] = visible_surface(camera, quarter - camera)
    assert probes["closed_rear_quarter_return"] == "body_shell", probes
    report["canopySurfaceChecks"] = {
        "probes": probes,
        "rearGlassSpansByHeight": rear_runs,
    }
    report["assertions"] = (
        "PASS: dimensions, <=14000 triangles, exact object/material names, body-largest (both counts), 4 single-primitive wheel hubs, 2 packed <=1024px images, centred ground origins, no loose vertices; broad canopy rims, continuous unobstructed front/rear glass, closed C-pillar returns"
    )
    (PREVIEW / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return report


if args.verify:
    verification(Path(args.verify).resolve())
    sys.exit(0)

subprocess.run([PYTHON, str(Path(__file__).resolve()), "--prepare-images"], check=True)


def material(name, color, roughness=0.4, metal=0.0, emission=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Roughness"].default_value = roughness
    p.inputs["Metallic"].default_value = metal
    if emission:
        p.inputs["Emission Color"].default_value = (*color, 1)
        p.inputs["Emission Strength"].default_value = emission
    m.diffuse_color = (*color, 1)
    m.use_backface_culling = True
    return m


BODY = material("body", (0.58, 0.60, 0.63), 0.34, 0.40)
BODY.node_tree.nodes["Principled BSDF"].inputs["Coat Weight"].default_value = 0.35
BODY.node_tree.nodes["Principled BSDF"].inputs["Coat Roughness"].default_value = 0.16
GLASS = material("glass_canopy", (0.004, 0.005, 0.006), 0.34, 0.0)
GLASS.node_tree.nodes["Principled BSDF"].inputs["Coat Weight"].default_value = 0.0
GLASS.node_tree.nodes["Principled BSDF"].inputs[
    "Specular IOR Level"
].default_value = 0.01
TRIM = material("trim", (1, 1, 1), 0.76, 0.0)
TRIM.node_tree.nodes["Principled BSDF"].inputs[
    "Specular IOR Level"
].default_value = 0.22
FRONT = material("light_front", (0.86, 0.96, 1.0), 0.24, 0.0, 4)
REAR = material("light_rear", (1.0, 0.012, 0.004), 0.25, 0.0, 3)
UNDER = material("under", (0.012, 0.014, 0.017), 0.85, 0.0)
UNDER.node_tree.nodes["Principled BSDF"].inputs[
    "Specular IOR Level"
].default_value = 0.15
STICKER = material("sticker", (1, 1, 1), 0.9, 0.0)


def image_material(m, path, name):
    im = bpy.data.images.load(str(path), check_existing=True)
    im.name = name
    im.pack()
    n = m.node_tree.nodes.new("ShaderNodeTexImage")
    n.image = im
    p = m.node_tree.nodes["Principled BSDF"]
    m.node_tree.links.new(n.outputs["Color"], p.inputs["Base Color"])
    m.node_tree.links.new(n.outputs["Alpha"], p.inputs["Alpha"])
    # The exporter maps Blender's dithered/clip alpha to MASK when the old
    # compatibility alpha_threshold is set; force the GLB flag after export too.
    m.surface_render_method = "DITHERED"
    m.alpha_threshold = 0.5
    return im


image_material(TRIM, SCRATCH / "roadster_trim_atlas.png", "R_06_keyed_rim_and_trim")
image_material(STICKER, SCRATCH / "this_side_up.png", "R_08_this_side_up")
SWATCH = {
    "rubber": (0.125, 0.052),
    "rim": (0.375, 0.052),
    "brake": (0.625, 0.052),
    "black": (0.875, 0.052),
}


class Mesh:
    def __init__(self, name, mat):
        self.name, self.mat = name, mat
        self.v, self.f, self.uv, self.smooth = [], [], [], []

    def face(self, pts, uv=None, smooth=False, normal=None):
        pts = [tuple(p) for p in pts]
        if len(pts) < 3:
            return
        n = (Vector(pts[1]) - Vector(pts[0])).cross(Vector(pts[2]) - Vector(pts[0]))
        if n.length < 1e-10:
            # A tapered strip can collapse to one point: retain its triangle.
            uniq = []
            for p in pts:
                if not any((Vector(p) - Vector(q)).length < 1e-8 for q in uniq):
                    uniq.append(p)
            if len(uniq) < 3:
                return
            pts = uniq
            uv = None
            n = (Vector(pts[1]) - Vector(pts[0])).cross(Vector(pts[2]) - Vector(pts[0]))
        if uv is None:
            uv = (
                [SWATCH["rubber"]] * len(pts)
                if self.mat == TRIM
                else [(p[0] / 4.6 + 0.5, p[1] / 1.86 + 0.5) for p in pts]
            )
        if normal is not None and n.dot(Vector(normal)) < 0:
            pts, uv = pts[::-1], uv[::-1]
        indices = list(range(len(self.v), len(self.v) + len(pts)))
        self.v.extend(pts)
        self.f.append(indices)
        self.uv.append(uv)
        self.smooth.append(smooth)

    def finish(self, location=(0, 0, 0)):
        me = bpy.data.meshes.new(self.name)
        me.from_pydata(self.v, [], self.f)
        me.materials.append(self.mat)
        me.update()
        layer = me.uv_layers.new(name="UVMap")
        for p, uvs, smooth in zip(me.polygons, self.uv, self.smooth):
            p.use_smooth = smooth
            for li, uv in zip(p.loop_indices, uvs):
                layer.data[li].uv = uv
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.collection.objects.link(ob)
        ob.location = location
        # Geometry is authored in final metres, so no unapplied transforms.
        return ob


body = Mesh("body_shell", BODY)
glass = Mesh("closed_canopy", GLASS)
trim = Mesh("lower_trim_and_panel_seams", TRIM)
front = Mesh("front_light_strip", FRONT)
rear = Mesh("rear_light_bar", REAR)
under = Mesh("undertray_and_four_downward_nozzles", UNDER)
sticker = Mesh("underside_sticker", STICKER)


def lerp(points, x):
    points = sorted(points)
    if x <= points[0][0]:
        return points[0][1]
    if x >= points[-1][0]:
        return points[-1][1]
    for (a, va), (b, vb) in zip(points, points[1:]):
        if a <= x <= b:
            return va + (vb - va) * (x - a) / (b - a)
    raise ValueError(f"Uninterpolable profile coordinate {x}")


UPPER = [
    (-2.3, 0.905),
    (-1.77, 0.998),
    (-1.40, 0.98),
    (-1.1, 0.946),
    (-0.69, 0.902),
    (-0.25, 0.85),
    (0.18, 0.829),
    (0.90, 0.853),
    (1.24, 0.853),
    (1.52, 0.847),
    (1.68, 0.825),
    (2.15, 0.595),
]
HALFW = [
    (-2.3, 0.83),
    (-2.08, 0.905),
    (-1.69, 0.93),
    (-1.1, 0.93),
    (0.90, 0.93),
    (1.25, 0.93),
    (1.68, 0.90),
    (2.15, 0.84),
]
CREASE = [
    (-2.3, 0.89),
    (-1.69, 0.875),
    (-0.75, 0.83),
    (0, 0.76),
    (0.9, 0.675),
    (1.6, 0.60),
    (2.15, 0.56),
]
PAINT_BOTTOM = [
    (-2.3, 0.543),
    (-1.77, 0.46),
    (-1.3, 0.442),
    (-0.51, 0.333),
    (0.1, 0.30),
    (1.6, 0.28),
    (2.15, 0.28),
]
# The silver fender corners end behind the central bonnet's leading edge.
# This makes actual front-facing wraparound cheeks, not 25 mm end strips.
SIDE_FRONT_X = 2.15
SILL_BOTTOM = [(-2.3, 0.385), (-2.06, 0.24), (-1.86, GROUND), (SIDE_FRONT_X, GROUND)]
ARCH_R = 0.388


def arch_z(x):
    z = -1
    for cx in (FRONT_X, REAR_X):
        if abs(x - cx) <= ARCH_R + 1e-7:
            z = max(z, RADIUS + math.sqrt(max(0, ARCH_R**2 - (x - cx) ** 2)))
    return z


def side_y(x, z):
    lo, hi = lerp(PAINT_BOTTOM, x), lerp(UPPER, x)
    cr = min(hi - 0.002, max(lo + 0.002, lerp(CREASE, x)))
    w = lerp(HALFW, x)
    if z <= cr:
        return w - 0.028 + 0.028 * max(0, (z - lo) / (cr - lo))
    return w - 0.025 * ((z - cr) / (hi - cr))


# Upper semicircular wheel wells and vertical returns, no intersecting body
# boxes through the wheels. Longitudinal stations preserve the reference's
# sweeping crease and the tail's rising black sill.
xs = {round(-2.3 + i * 4.6 / 72, 7) for i in range(73)}
xs |= {x for p in [UPPER, HALFW, CREASE, PAINT_BOTTOM, SILL_BOTTOM] for x, _ in p}
for cx in (FRONT_X, REAR_X):
    for j in range(25):
        xs.add(cx + ARCH_R * math.cos(math.pi * j / 24))
    # Adjacent stations create the short vertical leg at each arch end.
    xs |= {cx - ARCH_R - 0.0002, cx + ARCH_R + 0.0002}
xs = sorted(x for x in xs if -2.3 <= x <= SIDE_FRONT_X)

for sign in (-1, 1):
    for a, b in zip(xs, xs[1:]):
        rows = []
        for x in (a, b):
            lo = max(lerp(PAINT_BOTTOM, x), arch_z(x))
            hi = lerp(UPPER, x)
            cr = max(lo, min(hi, lerp(CREASE, x)))
            levels = [lo, (lo + cr) / 2, cr, (cr + hi) / 2, hi]
            rows.append([(x, sign * side_y(x, z), z) for z in levels])
        for j in range(4):
            body.face(
                [rows[0][j], rows[1][j], rows[1][j + 1], rows[0][j + 1]],
                normal=(0, sign, 0),
            )
        # Black sill / rising rear bumper below paint, interrupted by arches.
        lows, highs = [], []
        for x in (a, b):
            low = max(lerp(SILL_BOTTOM, x), arch_z(x))
            high = lerp(PAINT_BOTTOM, x)
            lows.append(min(low, high))
            highs.append(high)
        if any(highs[i] - lows[i] > 1e-5 for i in (0, 1)):
            for j in range(2):
                pts = []
                for x, i, t in [
                    (a, 0, j / 2),
                    (b, 1, j / 2),
                    (b, 1, (j + 1) / 2),
                    (a, 0, (j + 1) / 2),
                ]:
                    z = lows[i] + (highs[i] - lows[i]) * t
                    y = sign * (lerp(HALFW, x) - 0.030 - (0.023 if t == 0 else 0))
                    pts.append((x, y, z))
                trim.face(pts, normal=(0, sign, 0))
    # Thin painted wheel-arch bevel and dark inner return, both continuous.
    for cx in (FRONT_X, REAR_X):
        for j in range(24):
            aa, bb = math.pi * j / 24, math.pi * (j + 1) / 24
            inner, outer, well = [], [], []
            for t in (aa, bb):
                x, z = cx + ARCH_R * math.cos(t), RADIUS + ARCH_R * math.sin(t)
                yi = sign * side_y(x, z)
                inner.append((x, yi, z))
                outer.append(
                    (
                        cx + (ARCH_R + 0.017) * math.cos(t),
                        yi - sign * 0.004,
                        RADIUS + (ARCH_R + 0.017) * math.sin(t),
                    )
                )
                well.append((x, sign * 0.69, z))
            trim.face(
                [inner[0], well[0], well[1], inner[1]],
                normal=(-math.cos((aa + bb) / 2), 0, -math.sin((aa + bb) / 2)),
            )
            # Opaque inner arch liner: the reference has black wells, not
            # transparent crescent holes between the tyre and painted edge.
            trim.face(
                [
                    (cx, sign * 0.66, RADIUS),
                    (
                        cx + ARCH_R * math.cos(aa),
                        sign * 0.66,
                        RADIUS + ARCH_R * math.sin(aa),
                    ),
                    (
                        cx + ARCH_R * math.cos(bb),
                        sign * 0.66,
                        RADIUS + ARCH_R * math.sin(bb),
                    ),
                ],
                uv=[SWATCH["black"]] * 3,
                normal=(0, sign, 0),
            )
        trim.face(
            [
                (cx - ARCH_R, sign * 0.66, GROUND),
                (cx + ARCH_R, sign * 0.66, GROUND),
                (cx + ARCH_R, sign * 0.66, RADIUS),
                (cx - ARCH_R, sign * 0.66, RADIUS),
            ],
            uv=[SWATCH["black"]] * 4,
            normal=(0, sign, 0),
        )

# Central hood and faceted fender crowns.
hood_x = [1.52, 1.68, 1.8, 2.0, SIDE_FRONT_X, 2.30]


def hood_h(x):
    return lerp([(1.52, 0.847), (1.80, 0.745), (2.07, 0.607), (2.30, 0.495)], x)


def hood_w(x):
    return lerp([(1.52, 0.52), (2.30, 0.65)], x)


for a, b in zip(hood_x, hood_x[1:]):
    for ya, yb in zip([-1, -0.5, 0, 0.5], [-0.5, 0, 0.5, 1]):
        body.face(
            [
                (a, ya * hood_w(a), hood_h(a)),
                (b, ya * hood_w(b), hood_h(b)),
                (b, yb * hood_w(b), hood_h(b)),
                (a, yb * hood_w(a), hood_h(a)),
            ],
            normal=(0, 0, 1),
        )
    for sign in (-1, 1):
        body.face(
            [
                (a, sign * hood_w(a), hood_h(a)),
                (b, sign * hood_w(b), hood_h(b)),
                (min(b, SIDE_FRONT_X), sign * (lerp(HALFW, b) - 0.025), lerp(UPPER, b)),
                (min(a, SIDE_FRONT_X), sign * (lerp(HALFW, a) - 0.025), lerp(UPPER, a)),
            ],
            normal=(0, sign * 0.25, 1),
        )

# Hairline bonnet/fender breaks emphasize the silver wedge's two diagonal
# facets without changing the silhouette or adding an applied grille frame.
for a, b in zip(hood_x, hood_x[1:]):
    for sign in (-1, 1):
        trim.face(
            [
                (x, sign * hood_w(x) + d, hood_h(x) + 0.0008)
                for x, d in [(a, -0.001), (b, -0.001), (b, 0.001), (a, 0.001)]
            ],
            normal=(0, 0, 1),
        )

# The roof is a very shallow bowed panoramic glass surface, not a tall cabin.
ROOF_Z = [
    (1.52, 0.847),
    (1.16, 0.985),
    (0.90, 1.070),
    (0.63, 1.153),
    (0.28, 1.220),
    (0.05, 1.250),
    (-0.25, 1.260),
    (-0.45, 1.256),
    (-0.69, 1.244),
    (-0.95, 1.215),
    (-1.1, 1.177),
    (-1.4, 1.095),
    (-1.77, 0.998),
]
# R_02 has broad transverse ends, not a lens pinched to points. Keep a
# full-width windscreen base and a gently tapering rear above the deck.
ROOF_W = [
    (1.52, 0.52),
    (1.44, 0.57),
    (1.30, 0.69),
    (1.16, 0.78),
    (0.90, 0.80),
    (0.63, 0.76),
    (0.28, 0.71),
    (0.05, 0.69),
    (-0.25, 0.65),
    (-0.45, 0.65),
    (-0.69, 0.66),
    (-0.95, 0.73),
    (-1.10, 0.75),
]
# Each transverse row sweeps back at the windscreen and forward at the rear.
# It never collapses in width: broad rounded rims replace end-point fans.
ROOF_EDGE_X = [(-1.77, -1.10), (-0.25, -0.25), (1.52, 0.90)]
# The cabin's rear shoulders are painted, not extra glass: the glass tapers
# inward while the C-pillars remain wide enough to hide the front glazing in
# a rear elevation. A narrow outer loft exposes the windscreen as dark ears.
GLASS_FRACTION = [
    (-1.77, 0.66),
    (-1.40, 0.74),
    (-1.10, 0.84),
    (-0.69, 0.94),
    (-0.25, 0.99),
    (0.05, 1.0),
    (1.52, 1.0),
]
WINDOW_TOP_W = ROOF_W
WINDOW_TOP = [
    (-1.10, 1.075),
    (-0.95, 1.105),
    (-0.69, 1.150),
    (-0.45, 1.180),
    (-0.25, 1.198),
    (0.05, 1.182),
    (0.5, 1.010),
    (0.90, 0.853),
]
WINDOW_LOW = [(-1.10, 1.075), (-0.69, 0.917), (0.18, 0.829), (0.90, 0.853)]
WINDOW_LOW_Y = [
    (-1.10, 0.75),
    (-0.95, 0.78),
    (-0.69, 0.83),
    (-0.25, 0.875),
    (0.18, 0.895),
    (0.50, 0.89),
    (0.90, 0.80),
]
ROOF_EDGE_Z = [
    (-1.10, 1.150),
    (-0.95, 1.190),
    (-0.69, 1.205),
    (-0.45, 1.210),
    (-0.25, 1.205),
    (0.05, 1.182),
    (0.5, 1.010),
    (0.90, 0.853),
]


def smooth_profile(points, x):
    """Shape-preserving cubic Hermite: smooth silhouettes, no overshoot."""
    points = sorted(points)
    if x <= points[0][0]:
        return points[0][1]
    if x >= points[-1][0]:
        return points[-1][1]
    h = [b[0] - a[0] for a, b in zip(points, points[1:])]
    d = [(b[1] - a[1]) / step for a, b, step in zip(points, points[1:], h)]
    m = [d[0]]
    for i in range(1, len(points) - 1):
        if d[i - 1] * d[i] <= 0:
            m.append(0)
        else:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m.append((w1 + w2) / (w1 / d[i - 1] + w2 / d[i]))
    m.append(d[-1])
    for i, ((a, va), (b, vb)) in enumerate(zip(points, points[1:])):
        if a <= x <= b:
            t = (x - a) / (b - a)
            return (
                (2 * t**3 - 3 * t**2 + 1) * va
                + (t**3 - 2 * t**2 + t) * h[i] * m[i]
                + (-2 * t**3 + 3 * t**2) * vb
                + (t**3 - t**2) * h[i] * m[i + 1]
            )
    raise ValueError(f"Uninterpolable canopy coordinate {x}")


roof_x = sorted(
    {round(-1.77 + i * 3.29 / 56, 7) for i in range(57)}
    | {
        x
        for profile in [ROOF_Z, ROOF_W, ROOF_EDGE_Z, WINDOW_LOW, WINDOW_LOW_Y]
        for x, _ in profile
    }
)


def roof_edge(x, sign):
    return (x, sign * smooth_profile(ROOF_W, x), smooth_profile(ROOF_EDGE_Z, x))


def shoulder(x, sign):
    return (x, sign * (lerp(HALFW, x) - 0.025), lerp(UPPER, x))


def window_point(x, sign, upper):
    return (
        x,
        sign * smooth_profile(WINDOW_TOP_W if upper else WINDOW_LOW_Y, x),
        smooth_profile(WINDOW_TOP if upper else WINDOW_LOW, x),
    )


def canopy_point(x, t):
    edge_x = smooth_profile(ROOF_EDGE_X, x)
    edge = roof_edge(edge_x, 1)
    peak = smooth_profile(ROOF_Z, x)
    # A shallow crown across the roof; flatten the rear rim across its
    # centre, rolling up only at the corners rather than making a smile.
    rear_blend = max(0.0, min(1.0, (-x - 0.65) / 1.12))
    cross_curve = (1 - rear_blend) * t**2 + rear_blend * t**8
    return Vector(
        (x + (edge_x - x) * t**6, t * edge[1], peak + (edge[2] - peak) * cross_curve)
    )


def canopy_normal(x, t):
    # Analytic-surface derivatives avoid triangulation-dependent highlight
    # ripples on the irregular station grid, including the broad end sections.
    x = max(-1.769, min(1.519, x))
    dx = canopy_point(x + 0.001, t) - canopy_point(x - 0.001, t)
    dt = canopy_point(x, t + 0.001) - canopy_point(x, t - 0.001)
    return dx.cross(dt).normalized()


def side_glass_point(x, t, sign):
    return Vector(window_point(x, sign, True)).lerp(
        Vector(window_point(x, sign, False)), t
    )


def side_glass_normal(x, t, sign):
    x = max(-1.099, min(0.899, x))
    dx = side_glass_point(x + 0.001, t, sign) - side_glass_point(x - 0.001, t, sign)
    dt = side_glass_point(x, 1, sign) - side_glass_point(x, 0, sign)
    normal = dx.cross(dt).normalized()
    return normal if normal.y * sign >= 0 else -normal


def position_key(point):
    # Match float32 Blender coordinates without inferring warped loft UVs.
    return tuple(round(c, 5) for c in point)


canopy_normal_lookup = {}
yy = [
    -1,
    -0.97,
    -0.92,
    -0.84,
    -0.73,
    -0.60,
    -0.42,
    -0.22,
    0,
    0.22,
    0.42,
    0.60,
    0.73,
    0.84,
    0.92,
    0.97,
    1,
]
for a, b in zip(roof_x, roof_x[1:]):
    for ya, yb in zip(yy, yy[1:]):
        pts = []
        for x, t in [(a, ya), (b, ya), (b, yb), (a, yb)]:
            t *= smooth_profile(GLASS_FRACTION, x)
            p = canopy_point(x, t)
            pts.append(p)
            canopy_normal_lookup[position_key(p)] = canopy_normal(x, t)
        glass.face(pts, smooth=True, normal=(0, 0, 1))
    for sign in (-1, 1):
        for i in range(4):
            pts = []
            for x, q in [(a, i / 4), (b, i / 4), (b, (i + 1) / 4), (a, (i + 1) / 4)]:
                fraction = smooth_profile(GLASS_FRACTION, x)
                pts.append(canopy_point(x, sign * (fraction + (1 - fraction) * q)))
            body.face(pts, smooth=True, normal=(0, sign * 0.25, 1))

side_x = [smooth_profile(ROOF_EDGE_X, x) for x in roof_x]
for a, b in zip(side_x, side_x[1:]):
    for sign in (-1, 1):
        ha, hb = roof_edge(a, sign), roof_edge(b, sign)
        wa, wb = window_point(a, sign, True), window_point(b, sign, True)
        la, lb = window_point(a, sign, False), window_point(b, sign, False)
        ba, bb = shoulder(a, sign), shoulder(b, sign)
        glass.face([wa, wb, lb, la], smooth=True, normal=(0, sign, 0.25))
        body.face([la, lb, bb, ba], normal=(0, sign * 0.5, 1))
        # The rear shoulder becomes a painted C-pillar outside the glass,
        # instead of a bright rail visibly bisecting the rear window.
        body.face([ha, hb, wb, wa], normal=(0, sign * 0.8, 0.4))
        if a >= smooth_profile(ROOF_EDGE_X, 0.05) - 1e-7:
            rail = []
            for p, t in [(ha, -1), (hb, -1), (hb, 1), (ha, 1)]:
                rail.append((p[0], p[1] + sign * t * 0.007, p[2] + 0.004 - t * 0.004))
            body.face(rail, normal=(0, sign * 0.8, 0.4))

# Join the curved windscreen/rear-window rims to the unchanged bonnet/deck.
for end in (1.52, -1.77):
    z = smooth_profile(ROOF_Z, end)
    # Keep equal Y coordinates across the join: narrowing the apron folds
    # its quads over themselves and opens backface-culling holes at the rim.
    half_width = canopy_point(end, 1).y
    fraction = smooth_profile(GLASS_FRACTION, end)
    rim_t = sorted(
        {t * fraction for t in yy}
        | {
            sign * (fraction + (1 - fraction) * i / 4)
            for i in range(5)
            for sign in (-1, 1)
        }
    )
    for ya, yb in zip(rim_t, rim_t[1:]):
        body.face(
            [
                canopy_point(end, ya),
                canopy_point(end, yb),
                (end, yb * half_width, z),
                (end, ya * half_width, z),
            ],
            normal=(0, 0, 1),
        )
    for sign in (-1, 1):
        edge = canopy_point(end, sign)
        # Close the A/C-pillar return. The side-window sill and roof rim
        # meet at different heights; omitting this triangle exposes the
        # opposite side window and even the lamp through the rear quarter.
        body.face(
            [edge, window_point(edge.x, sign, False), shoulder(edge.x, sign)],
            normal=(-1 if end > 0 else 1, 0, 0),
        )
        lip = Vector((end, sign * half_width, z))
        for i in range(12):
            ta, tb = i / 12, (i + 1) / 12
            pa, pb = edge.lerp(lip, ta), edge.lerp(lip, tb)
            body.face(
                [pa, pb, shoulder(pb.x, sign), shoulder(pa.x, sign)],
                normal=(0, sign * 0.3, 1),
            )

# Silver deck from the back of the panorama to the full-width lamp fascia.
deck_x = [-2.30, -2.08, -1.90, -1.77]
for a, b in zip(deck_x, deck_x[1:]):
    for sign in (-1, 1):
        za, zb = (
            lerp([(-2.3, 0.905), (-1.77, 0.998)], a),
            lerp([(-2.3, 0.905), (-1.77, 0.998)], b),
        )
        wa, wb = (
            lerp([(-2.3, 0.70), (-1.77, 0.42)], a),
            lerp([(-2.3, 0.70), (-1.77, 0.42)], b),
        )
        body.face(
            [(a, 0, za), (b, 0, zb), (b, sign * wb, zb), (a, sign * wa, za)],
            normal=(0, 0, 1),
        )
        body.face(
            [
                (a, sign * wa, za),
                (b, sign * wb, zb),
                shoulder(b, sign),
                shoulder(a, sign),
            ],
            normal=(0, sign * 0.3, 1),
        )


# Utility for thin solid panels (used sparingly; no loose curves in export).
def box(mesh, center, size):
    x, y, z = center
    a, b, c = [s / 2 for s in size]
    p = [
        (x - a, y - b, z - c),
        (x + a, y - b, z - c),
        (x + a, y + b, z - c),
        (x - a, y + b, z - c),
        (x - a, y - b, z + c),
        (x + a, y - b, z + c),
        (x + a, y + b, z + c),
        (x - a, y + b, z + c),
    ]
    for f in [
        (0, 3, 2, 1),
        (4, 5, 6, 7),
        (0, 1, 5, 4),
        (1, 2, 6, 5),
        (2, 3, 7, 6),
        (3, 0, 4, 7),
    ]:
        mesh.face([p[i] for i in f])


# Low silver wedge: the light is the bonnet's leading edge. Everything black
# behind it is a genuinely recessed cavity, not a front-most rectangular box.
body.face(
    [
        (2.30, -0.65, 0.495),
        (2.30, 0.65, 0.495),
        (2.30, 0.65, 0.490),
        (2.30, -0.65, 0.490),
    ],
    normal=(1, 0, 0),
)
box(front, (2.298, 0, FRONT_LIGHT), (0.004, 1.30, 0.010))
# Shadowed shelf beneath the projecting silver/light edge, then the bevelled
# bumper band. The band's front face is 0.08 m behind the silver nose.
trim.face(
    [
        (2.296, -0.65, 0.480),
        (2.296, 0.65, 0.480),
        (2.19, 0.635, 0.465),
        (2.19, -0.635, 0.465),
    ],
    normal=(0, 0, -1),
)
intake_rows = [
    (2.19, 0.635, 0.465),
    (2.22, 0.630, 0.444),
    (2.22, 0.618, 0.365),
    (2.18, 0.600, 0.340),
    (2.06, 0.565, 0.215),
]
for (xa, wa, za), (xb, wb, zb) in zip(intake_rows, intake_rows[1:]):
    trim.face(
        [(xa, -wa, za), (xa, wa, za), (xb, wb, zb), (xb, -wb, zb)],
        normal=(1, 0, 0),
    )
# An opaque inner wall closes the whole cavity behind the bumper and side
# returns. It is 0.28 m behind the nose; no daylight leaks through the intake.
trim.face(
    [
        (2.02, -0.81, GROUND),
        (2.02, 0.81, GROUND),
        (2.02, 0.81, 0.480),
        (2.02, -0.81, 0.480),
    ],
    uv=[SWATCH["black"]] * 4,
    normal=(1, 0, 0),
)
# A shallow angular splitter returns forward from the recessed intake floor,
# but remains behind the light and the silver fender cheeks.
lip = [
    (-0.805, 0.167),
    (-0.69, 0.165),
    (-0.57, 0.203),
    (0.57, 0.203),
    (0.69, 0.165),
    (0.805, 0.167),
]
for (ya, za), (yb, zb) in zip(lip, lip[1:]):
    trim.face(
        [
            (2.06, ya * 0.93, 0.215),
            (2.06, yb * 0.93, 0.215),
            (2.23, yb, zb),
            (2.23, ya, za),
        ],
        normal=(0, 0, 1),
    )
    trim.face(
        [
            (2.23, ya, za),
            (2.23, yb, zb),
            (2.22, yb, max(GROUND, zb - 0.018)),
            (2.22, ya, max(GROUND, za - 0.018)),
        ],
        uv=[SWATCH["rim"]] * 4,
        normal=(1, 0, 0),
    )
for sign in (-1, 1):
    # Interior side walls close oblique sight lines behind the cheek returns;
    # the back wall alone is not enough when viewed from the opposite corner.
    trim.face(
        [
            (2.02, sign * 0.69, GROUND),
            (2.24, sign * 0.69, GROUND),
            (2.24, sign * 0.69, 0.480),
            (2.02, sign * 0.69, 0.480),
        ],
        uv=[SWATCH["black"]] * 4,
        normal=(0, -sign, 0),
    )
    corner_top = (SIDE_FRONT_X, sign * 0.815, 0.595)
    corner_crease = (SIDE_FRONT_X, sign * 0.84, 0.56)
    corner_base = (SIDE_FRONT_X, sign * 0.812, 0.28)
    nose = (2.30, sign * 0.65, 0.495)
    cheek_base = (2.24, sign * 0.69, 0.28)
    body.face([nose, corner_top, corner_crease], normal=(1, sign * 0.4, 0.3))
    body.face([nose, corner_crease, corner_base, cheek_base], normal=(1, sign * 0.4, 0))
    # Silver inner return: a visible thickness at the intake's outer corners.
    body.face(
        [nose, cheek_base, (2.18, sign * 0.675, 0.28), (2.19, sign * 0.635, 0.465)],
        normal=(1, -sign, 0),
    )
    trim.face(
        [
            (2.19, sign * 0.635, 0.465),
            (2.18, sign * 0.675, 0.28),
            (2.23, sign * 0.69, 0.165),
            (2.06, sign * 0.565, 0.215),
        ],
        uv=[SWATCH["black"]] * 4,
        normal=(1, -sign, 0),
    )
    trim.face(
        [cheek_base, (2.18, sign * 0.675, 0.28), (2.23, sign * 0.69, 0.165)],
        uv=[SWATCH["black"]] * 3,
        normal=(1, -sign, 0),
    )
    trim.face(
        [
            cheek_base,
            corner_base,
            (SIDE_FRONT_X, sign * 0.787, GROUND),
            (2.23, sign * 0.805, 0.167),
            (2.23, sign * 0.69, 0.165),
        ],
        normal=(1, sign * 0.3, 0),
    )

# Rear fascia, actual recessed blank plate, no nozzle ring.
body.face(
    [
        (-2.30, -0.70, 0.905),
        (-2.30, 0.70, 0.905),
        (-2.30, 0.70, 0.885),
        (-2.30, -0.70, 0.885),
    ],
    normal=(-1, 0, 0),
)
box(rear, (-2.298, 0, REAR_LIGHT), (0.004, 1.40, 0.014))
trim.face(
    [
        (-2.297, -0.705, 0.862),
        (-2.297, 0.705, 0.862),
        (-2.298, 0.705, 0.785),
        (-2.298, -0.705, 0.785),
    ],
    normal=(-1, 0, 0),
)
trim.face(
    [
        (-2.298, -0.705, 0.785),
        (-2.298, -0.32, 0.785),
        (-2.298, -0.36, 0.585),
        (-2.298, -0.72, 0.55),
    ],
    normal=(-1, 0, 0),
)
trim.face(
    [
        (-2.298, 0.32, 0.785),
        (-2.298, 0.705, 0.785),
        (-2.298, 0.72, 0.55),
        (-2.298, 0.36, 0.585),
    ],
    normal=(-1, 0, 0),
)
trim.face(
    [
        (-2.298, -0.72, 0.55),
        (-2.298, -0.36, 0.585),
        (-2.298, 0.36, 0.585),
        (-2.298, 0.72, 0.55),
    ],
    normal=(-1, 0, 0),
)
plate_outer = [
    (-2.298, -0.32, 0.785),
    (-2.298, 0.32, 0.785),
    (-2.298, 0.36, 0.585),
    (-2.298, -0.36, 0.585),
]
plate_inner = [
    (-2.259, -0.307, 0.774),
    (-2.259, 0.307, 0.774),
    (-2.259, 0.344, 0.597),
    (-2.259, -0.344, 0.597),
]
for j in range(4):
    k = (j + 1) % 4
    trim.face(
        [plate_outer[j], plate_outer[k], plate_inner[k], plate_inner[j]],
        normal=(-1, 0, 0),
    )
trim.face(plate_inner, uv=[SWATCH["rim"]] * 4, normal=(-1, 0, 0))
# Recessed lower diffuser and angular lower lip.
trim.face(
    [
        (-2.29, -0.72, 0.55),
        (-2.29, 0.72, 0.55),
        (-2.245, 0.72, 0.395),
        (-2.245, -0.72, 0.395),
    ],
    normal=(-1, 0, 0),
)
trim.face(
    [
        (-2.245, -0.72, 0.395),
        (-2.245, 0.72, 0.395),
        (-1.86, 0.70, GROUND),
        (-1.86, -0.70, GROUND),
    ],
    normal=(-1, 0, -1),
)
outline = [
    (-0.79, 0.39),
    (-0.66, 0.414),
    (-0.54, 0.527),
    (0.54, 0.527),
    (0.66, 0.414),
    (0.79, 0.39),
]
for (ya, za), (yb, zb) in zip(outline, outline[1:]):
    trim.face(
        [
            (-2.30, ya, za),
            (-2.30, yb, zb),
            (-2.30, yb, zb - 0.025),
            (-2.30, ya, za - 0.025),
        ],
        uv=[SWATCH["rim"]] * 4,
        normal=(-1, 0, 0),
    )
for sign in (-1, 1):
    body.face(
        [
            (-2.3, sign * 0.70, 0.905),
            (-2.3, sign * 0.805, 0.905),
            (-2.3, sign * 0.83, 0.89),
            (-2.3, sign * 0.802, 0.543),
            (-2.3, sign * 0.72, 0.55),
        ],
        normal=(-1, 0, 0),
    )
    trim.face(
        [
            (-2.3, sign * 0.72, 0.55),
            (-2.3, sign * 0.802, 0.543),
            (-2.3, sign * 0.777, 0.385),
            (-2.3, sign * 0.72, 0.395),
        ],
        normal=(-1, 0, 0),
    )

# Minimal dark door and glazing splits, without logos, handles, or lettering.
for sign in (-1, 1):
    for xtop, xbottom in [(0.515, 0.628), (-0.754, -0.515)]:
        ztop, zbottom = lerp(UPPER, xtop), lerp(PAINT_BOTTOM, xbottom)
        for j in range(12):
            pts = []
            for t, delta in [
                (j / 12, -0.0012),
                ((j + 1) / 12, -0.0012),
                ((j + 1) / 12, 0.0012),
                (j / 12, 0.0012),
            ]:
                x, z = xtop + (xbottom - xtop) * t, ztop + (zbottom - ztop) * t
                pts.append((x + delta, sign * min(WIDTH / 2, side_y(x, z) + 0.002), z))
            trim.face(pts, normal=(0, sign, 0))
    for x in (0.22, -0.48):
        p, q = window_point(x, sign, True), window_point(x, sign, False)
        trim.face(
            [
                (p[0] - 0.004, p[1] + sign * 0.003, p[2]),
                (p[0] + 0.004, p[1] + sign * 0.003, p[2]),
                (q[0] + 0.004, q[1] + sign * 0.003, q[2]),
                (q[0] - 0.004, q[1] + sign * 0.003, q[2]),
            ],
            normal=(0, sign, 0.2),
        )


# Flat undertray with modest panel divisions, small inset four nozzle discs.
def tray_z(x):
    return max(0.165, lerp(SILL_BOTTOM, x))


tray_stations = [
    (-2.24, 0.62),
    (REAR_X - 0.40, 0.62),
    (REAR_X + 0.40, 0.62),
    (REAR_X + 0.48, 0.84),
    (FRONT_X - 0.48, 0.84),
    (FRONT_X - 0.40, 0.62),
    (FRONT_X + 0.40, 0.62),
    (2.21, 0.62),
]
for (a, wa), (b, wb) in zip(tray_stations, tray_stations[1:]):
    under.face(
        [
            (a, -wa, tray_z(a)),
            (a, wa, tray_z(a)),
            (b, wb, tray_z(b)),
            (b, -wb, tray_z(b)),
        ],
        normal=(0, 0, -1),
    )
# Close the underside of the side sills, preserving all four tyre apertures.
for a, b in zip(xs, xs[1:]):
    if any(abs((a + b) / 2 - cx) < ARCH_R + 0.015 for cx in (FRONT_X, REAR_X)):
        continue
    for sign in (-1, 1):
        under.face(
            [
                (a, sign * 0.60, tray_z(a)),
                (b, sign * 0.60, tray_z(b)),
                (b, sign * (lerp(HALFW, b) - 0.053), lerp(SILL_BOTTOM, b)),
                (a, sign * (lerp(HALFW, a) - 0.053), lerp(SILL_BOTTOM, a)),
            ],
            normal=(0, 0, -1),
        )
for x in (-1.04, 0.95):
    box(under, (x, 0, 0.162), (0.012, 1.20, 0.006))
for cx in (FRONT_X, REAR_X):
    box(under, (cx, 0, 0.26), (0.07, 1.48, 0.065))
for cx in (FRONT_X, REAR_X):
    for y in (-0.575, 0.575):
        n = 16
        for i in range(n):
            a, b = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            p = (cx + 0.065 * math.cos(a), y + 0.065 * math.sin(a), 0.145)
            q = (cx + 0.065 * math.cos(b), y + 0.065 * math.sin(b), 0.145)
            under.face([(cx, y, 0.145), q, p], normal=(0, 0, -1))
            under.face(
                [p, q, (q[0], q[1], 0.165), (p[0], p[1], 0.165)],
                normal=(math.cos(a), math.sin(a), 0),
            )
# From underneath with the nose at screen-left, the photographed arrow points
# toward +X. The alpha-masked rounded rectangle is 0.48 x 0.386 m, not billboard sized.
sticker.face(
    [
        (0.24, -0.193, 0.164),
        (-0.24, -0.193, 0.164),
        (-0.24, 0.193, 0.164),
        (0.24, 0.193, 0.164),
    ],
    uv=[(0, 0), (1, 0), (1, 1), (0, 1)],
    normal=(0, 0, -1),
)

# Four 760-triangle wheels, a matte low-profile tyre and R_06's dark 5-spoke
# faceted rim. All faces share one alpha-mask atlas material and one mesh node.
wheel_objects = []
for name, centre in CENTRES.items():
    w = Mesh(name, TRIM)
    sign = 1 if centre[1] > 0 else -1
    n = 40
    profile = [
        (-0.130, 0.295),
        (-0.128, 0.324),
        (-0.105, 0.348),
        (-0.075, RADIUS),
        (0.075, RADIUS),
        (0.105, 0.348),
        (0.128, 0.324),
        (0.130, 0.295),
    ]

    def pnt(angle, radius, y):
        return (radius * math.cos(angle), y, radius * math.sin(angle))

    for (ya, ra), (yb, rb) in zip(profile, profile[1:]):
        for i in range(n):
            a, b = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            w.face(
                [pnt(a, ra, ya), pnt(b, ra, ya), pnt(b, rb, yb), pnt(a, rb, yb)],
                smooth=True,
                normal=(math.cos((a + b) / 2), 0, math.sin((a + b) / 2)),
            )
    # Inner barrel: close tyre and provide depth through the cut-out spokes.
    for i in range(n):
        a, b = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        w.face(
            [
                pnt(a, 0.295, -0.13),
                pnt(a, 0.295, 0.13),
                pnt(b, 0.295, 0.13),
                pnt(b, 0.295, -0.13),
            ],
            uv=[SWATCH["rim"]] * 4,
            smooth=True,
            normal=(-math.cos((a + b) / 2), 0, -math.sin((a + b) / 2)),
        )
    for y, radius, color in [
        (-sign * 0.130, 0.295, "rim"),
        (sign * 0.104, 0.293, "brake"),
    ]:
        for i in range(n):
            a, b = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            w.face(
                [(0, y, 0), pnt(a, radius, y), pnt(b, radius, y)],
                uv=[SWATCH[color]] * 3,
                normal=(0, -sign if color == "rim" else sign, 0),
            )
    y = sign * 0.130
    for i in range(n):
        a, b = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        pts = [(0, y, 0), pnt(a, 0.295, y), pnt(b, 0.295, y)]
        # Keep the spokes mirrored consistently, with a vertical upper spoke.
        uvs = [(448 / 1024, 1 - 448 / 1024)]
        for angle in (a, b):
            uvs.append(
                (
                    (448 + 448 * math.cos(angle)) / 1024,
                    1 - (448 - 448 * math.sin(angle)) / 1024,
                )
            )
        w.face(pts, uv=uvs, normal=(0, sign, 0))
    ob = w.finish(centre)
    # Merge only identical vertices; UV seams stay intact as loop data.
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bm.to_mesh(ob.data)
    bm.free()
    wheel_objects.append(ob)

body_ob = body.finish()
other_objects = [m.finish() for m in [glass, trim, front, rear, under, sticker]]
asset_objects = [body_ob] + other_objects + wheel_objects


# The game tints its largest material group after converting to non-indexed
# triangles. Refine actual painted surfaces, never hidden filler geometry, so
# the requested body group wins both that count and raw GLB POSITION counts.
def triangle_count(ob):
    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)


nonbody = {}
for ob in asset_objects[1:]:
    name = ob.data.materials[0].name
    nonbody[name] = nonbody.get(name, 0) + triangle_count(ob)
target = max(4600, max(nonbody.values()) + 650)
bm = bmesh.new()
bm.from_mesh(body_ob.data)
bmesh.ops.triangulate(bm, faces=list(bm.faces))
bm.normal_update()
normal_layer = bm.verts.layers.float_vector.new("panel_normal")
by_position = {}
for face in bm.faces:
    for vert in face.verts:
        key = tuple(round(c, 6) for c in vert.co)
        by_position.setdefault(key, []).append((face.normal.copy(), face.calc_area()))
cos_limit = math.cos(math.radians(20))
for vert in bm.verts:
    own = sum(
        (face.normal * face.calc_area() for face in vert.link_faces), Vector()
    ).normalized()
    key = tuple(round(c, 6) for c in vert.co)
    # Keep the bonnet/fender diagonal and wrapped nose corners crisp, while
    # retaining the original restrained smoothing on the long side panels.
    limit = math.cos(math.radians(5)) if vert.co.x > 1.5 else cos_limit
    normal = sum(
        (n * area for n, area in by_position[key] if n.dot(own) >= limit), Vector()
    )
    vert[normal_layer] = normal.normalized()
# Split the largest painted triangles first; interpolate UVs on the new
# corners and retain sharp changes of plane. This regularises panel density.
while len(bm.faces) < target:
    faces = sorted(bm.faces, key=lambda f: f.calc_area(), reverse=True)
    count = min(len(faces), (target - len(bm.faces) + 1) // 2)
    layer = bm.loops.layers.uv.active
    for f in faces[:count]:
        vs = list(f.verts)
        uv = [l[layer].uv.copy() for l in f.loops]
        co = sum((v.co for v in vs), Vector()) / 3
        avg_uv = sum(uv, Vector((0, 0))) / 3
        bm.faces.remove(f)
        c = bm.verts.new(co)
        c[normal_layer] = sum((v[normal_layer] for v in vs), Vector()).normalized()
        for i in range(3):
            nf = bm.faces.new((vs[i], vs[(i + 1) % 3], c))
            for loop, v in zip(nf.loops, (uv[i], uv[(i + 1) % 3], avg_uv)):
                loop[layer].uv = v
            nf.smooth = False
bm.to_mesh(body_ob.data)
bm.free()

# Triangulate every mesh deterministically; remove zero-area faces and loose
# vertices. Keep manually authored outward normals on open thin surfaces.
for ob in asset_objects:
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bad = [f for f in bm.faces if f.calc_area() < 1e-11]
    if bad:
        bmesh.ops.delete(bm, geom=bad, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()

# The panorama is continuous glass: share normals across its section grid,
# rather than letting every authoring quad reflect a separate studio panel.
canopy_ob = other_objects[0]
bm = bmesh.new()
bm.from_mesh(canopy_ob.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
for face in bm.faces:
    face.smooth = True
bm.to_mesh(canopy_ob.data)
bm.free()
canopy_ob.data.update()
# Explicit loft normals keep the glass smooth regardless of triangle aspect
# ratio, while the silver roof rail masks the intended side-window crease.
canopy_normals = [Vector((0, 0, 1)) for _ in canopy_ob.data.loops]
for poly in canopy_ob.data.polygons:
    points = [canopy_ob.data.vertices[i].co for i in poly.vertices]
    is_roof = all(position_key(p) in canopy_normal_lookup for p in points)
    for li in poly.loop_indices:
        p = canopy_ob.data.vertices[canopy_ob.data.loops[li].vertex_index].co
        if is_roof:
            canopy_normals[li] = canopy_normal_lookup[position_key(p)]
        else:
            sign = 1 if p.y >= 0 else -1
            edge, low = window_point(p.x, sign, True), window_point(p.x, sign, False)
            t = (
                (p.z - edge[2]) / (low[2] - edge[2])
                if abs(low[2] - edge[2]) > 1e-6
                else 0
            )
            canopy_normals[li] = side_glass_normal(p.x, max(0, min(1, t)), sign)
canopy_ob.data.normals_split_custom_set(canopy_normals)

# Refined normals interpolate the original panel normals. Computing averages
# only after subdivision would introduce triangle-centre shading ripples.
me = body_ob.data
normal_attr = me.attributes["panel_normal"]
loop_normals = [normal_attr.data[loop.vertex_index].vector.copy() for loop in me.loops]
for poly in me.polygons:
    poly.use_smooth = True
me.normals_split_custom_set(loop_normals)
me.attributes.remove(normal_attr)

spec = {
    "lengthM": LENGTH,
    "widthM": WIDTH,
    "heightM": HEIGHT,
    "wheelbaseM": round(FRONT_X - REAR_X, 6),
    "trackM": TRACK,
    "wheelRadiusM": RADIUS,
    "wheelCentres": {
        k: {"x": round(p[0], 6), "y": p[1], "z": p[2]} for k, p in CENTRES.items()
    },
    "groundClearanceM": GROUND,
    "frontLightZ": FRONT_LIGHT,
    "rearLightZ": REAR_LIGHT,
    "downwardNozzleCentres": [
        {"x": round(x, 6), "y": y, "z": GROUND}
        for x in (FRONT_X, REAR_X)
        for y in (-0.575, 0.575)
    ],
    "coordinateSystem": "Blender metres: +X forward, +Y left, +Z up. GLB Y-up maps to game (x,z,-y).",
    "bodyWidthM": WIDTH,
    "frontOverhangM": round(2.3 - FRONT_X, 6),
    "rearOverhangM": round(2.3 + REAR_X, 6),
    "referenceMeasurements": {
        "R_01": {
            "imagePx": [1915, 821],
            "bboxPx": [44, 171, 1865, 670],
            "metresPerPixel": SCALE,
            "frontHubPx": [462, 530],
            "rearHubPx": [1624, 530],
            "tyreDiameterPx": 280,
            "sillBottomY": 613,
            "frontLightY": 478,
            "roofPeakY": 171,
        },
        "note": "R_01 controls side proportions. R_02 controls footprint taper. R_03/R_04 only supply end shape, not their exaggerated width.",
    },
    "refinement": {
        "nose": "Silver faceted wedge with swept-back fender corners, full-bonnet-width light_front strip, recessed trim bumper/intake and closed cavity returns.",
        "bonnetLeadingEdgeX": 2.30,
        "silverCornerX": SIDE_FRONT_X,
        "bumperFaceX": 2.22,
        "intakeBackWallX": 2.02,
        "frontLightWidthM": 1.30,
        "canopy": "Swept broad rounded windscreen rim, smooth shallow loft, tapered rounded rear glass and painted outer C-pillars; shoulder rails stay outside the rear glass.",
        "canopyFrontCentreX": 1.52,
        "canopyRearCentreX": -1.77,
        "canopyFrontRimWidthM": round(2 * canopy_point(1.52, 1).y, 6),
        "canopyRearRimWidthM": round(
            2 * canopy_point(-1.77, smooth_profile(GLASS_FRACTION, -1.77)).y, 6
        ),
        "canopySurface": "16 transverse glass panels per swept station, shared analytic surface normals, no point fans or interior rear rails.",
    },
    "loaderNotes": [
        "Use cat=car, len=4.6, fwd=1; model already faces +X.",
        "All four wheels are single-primitive meshes, with hub origins and Y rolling axes.",
        "body is the largest material group; keep its name and topology through optimisation.",
        "The GLB already includes the small underside sticker and four decorative downward discs.",
        "Existing buildPlayerCar adds a larger procedural sticker and six nozzles; parent integration should avoid duplicate decorations and remove old rear nozzles.",
        "Existing bakeMulti recreates untextured car materials; integration should preserve light_front/light_rear emissions and bind glass_canopy as dark mirror glass.",
    ],
}
(PREVIEW / "spec.json").write_text(json.dumps(spec, indent=2) + "\n")
body_ob["asset"] = "Approved silver R3 Roadster"
body_ob["forwardAxis"] = "+X"
body_ob["reference"] = "R_00_v2, R_01..R_08 (R_07 nozzle ring excluded)"

OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
for ob in asset_objects:
    ob.select_set(True)
bpy.context.view_layer.objects.active = body_ob
bpy.ops.export_scene.gltf(
    filepath=str(OUT),
    export_format="GLB",
    export_yup=True,
    export_apply=True,
    use_selection=True,
    export_extras=True,
    export_cameras=False,
    export_lights=False,
)


# Blender 4.5's DITHERED surface mode exports BLEND; these two textures are
# intentional hard cut-outs, not sorted translucent geometry. Preserve binary
# payload and every buffer offset while switching their glTF alphaMode to MASK.
def enforce_mask(path):
    data = path.read_bytes()
    old_len = struct.unpack_from("<I", data, 12)[0]
    try:
        doc = json.loads(data[20 : 20 + old_len])
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Invalid JSON in exported GLB {path}") from exc
    for m in doc["materials"]:
        if m["name"] in ("trim", "sticker"):
            m["alphaMode"] = "MASK"
            m["alphaCutoff"] = 0.5
    encoded = json.dumps(doc, separators=(",", ":")).encode()
    encoded += b" " * ((-len(encoded)) % 4)
    rest = data[20 + old_len :]
    total = 20 + len(encoded) + len(rest)
    path.write_bytes(
        struct.pack("<4sII", b"glTF", 2, total)
        + struct.pack("<II", len(encoded), 0x4E4F534A)
        + encoded
        + rest
    )


enforce_mask(OUT)
print("ASSET TRIANGLES", sum(triangle_count(o) for o in asset_objects))
print("BODY TRIANGLES", triangle_count(body_ob), "OTHER MATERIAL TRIANGLES", nonbody)

if args.no_renders:
    sys.exit(0)

# Isolated preview rig; generated only after export and never included in GLB.
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.render.resolution_x, scene.render.resolution_y = 960, 540
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.film_transparent = True
scene.render.image_settings.color_depth = "8"
scene.world = bpy.data.worlds.new("preview_world")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (
    0.43,
    0.46,
    0.50,
    1,
)
scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.65
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = -0.3
if hasattr(scene, "eevee"):
    scene.eevee.taa_render_samples = 48


def area(name, loc, energy, size, target=(0, 0, 0.5), color=(1, 1, 1), size_y=None):
    d = bpy.data.lights.new(name, "AREA")
    d.energy, d.color = energy, color
    d.specular_factor = (
        0.25  # broad diffuse studio cards, subdued windshield reflections
    )
    if size_y:
        d.shape, d.size, d.size_y = "RECTANGLE", size, size_y
    else:
        d.shape, d.size = "DISK", size
    o = bpy.data.objects.new(name, d)
    bpy.context.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector(target) - o.location).to_track_quat("-Z", "Y").to_euler()
    return o


area("preview_key", (3.5, 4.5, 6), 1000, 5, size_y=3)
area("preview_fill", (0, -4, 3), 650, 4, color=(0.88, 0.93, 1), size_y=5)
area("preview_roof_strip", (-2, 1, 5), 700, 5, size_y=1.5)
area("preview_front_fill", (5, -0.5, 1.8), 220, 3)
area("preview_rear_fill", (-5, 2, 2.5), 300, 3)

cam_data = bpy.data.cameras.new("preview_camera")
cam = bpy.data.objects.new("preview_camera", cam_data)
bpy.context.collection.objects.link(cam)
scene.camera = cam


def render(
    name, location, target, scale, resolution=(960, 540), top=False, perspective=False
):
    cam.location = location
    if top:
        cam.rotation_euler = (0, 0, math.pi)
    else:
        cam.rotation_euler = (
            (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
        )
    cam_data.type = "PERSP" if perspective else "ORTHO"
    cam_data.ortho_scale = scale
    cam_data.lens = 58
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.filepath = str(PREVIEW / (name + ".png"))
    bpy.ops.render.render(write_still=True)


render("side", (0, 8, 0.63), (0, 0, 0.63), 5.1, (960, 400))
render("top", (0, 0, 8), (0, 0, 0), 5.1, (960, 450), top=True)
render("front", (8, 0, 0.65), (0, 0, 0.65), 2.3, (740, 540))
render("rear", (-8, 0, 0.65), (0, 0, 0.65), 2.3, (740, 540))
render("three-quarter", (9, 6, 2.6), (0, 0, 0.59), 5.45, (960, 540), perspective=True)
render("chase", (-8, 5.5, 4.0), (0, 0, 0.55), 5.45, (960, 600), perspective=True)
# Additional underside makes the small decal/nozzles independently inspectable.
cam.location = (0, 0, -8)
cam.rotation_euler = (math.pi, 0, math.pi)
cam_data.type, cam_data.ortho_scale = "ORTHO", 5.1
area("preview_under_fill", (0, 0, -3), 700, 5, target=(0, 0, 0))
scene.render.resolution_x, scene.render.resolution_y = 960, 450
scene.render.filepath = str(PREVIEW / "underside.png")
bpy.ops.render.render(write_still=True)
subprocess.run(
    [PYTHON, str(Path(__file__).resolve()), "--comparison", str(PREVIEW)], check=True
)
print("WROTE", OUT, "AND PREVIEWS", PREVIEW)
