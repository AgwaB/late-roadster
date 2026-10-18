# Optimize a photoscanned glTF (e.g. Poly Haven) for the web: decimate to a triangle budget, shrink textures, pack as GLB.
#   blender -b -P tools/blender/optimize.py -- --in model.gltf --out public/assets/ph/model.glb --tris 3000 --tex 512 [--y0]
import os
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1 :]


def arg(n, d):
    return args[args.index(n) + 1] if n in args else d


SRC = arg("--in", "")
OUT = arg("--out", "/tmp/out.glb")
TRIS = int(arg("--tris", "3000"))
TEX = int(arg("--tex", "512"))
Y0 = "--y0" in args

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
total = sum(len(o.data.polygons) for o in meshes)
ratio = min(
    1.0, TRIS / max(1, total * 2)
)  # polygons are mostly quads/tris; be conservative
for o in meshes:
    if ratio < 0.98:
        m = o.modifiers.new("dec", "DECIMATE")
        m.ratio = ratio
        m.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.modifier_apply(modifier="dec")
        o.select_set(False)
# shrink textures
for img in bpy.data.images:
    if img.size[0] > TEX:
        img.scale(TEX, int(TEX * img.size[1] / max(1, img.size[0])))
# drop to ground (min z = 0) if requested
if Y0 and meshes:
    zmin = min((o.matrix_world @ v.co).z for o in meshes for v in o.data.vertices)
    for o in meshes:
        if o.parent is None:
            o.location.z -= zmin
for o in meshes:
    o.select_set(True)
os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_image_format="JPEG",
    export_jpeg_quality=80,
)
after = sum(len(o.data.polygons) for o in meshes)
print(
    "OPTIMIZED",
    os.path.basename(SRC),
    "polys",
    total,
    "->",
    after,
    "tex",
    TEX,
    "size",
    os.path.getsize(OUT),
)
