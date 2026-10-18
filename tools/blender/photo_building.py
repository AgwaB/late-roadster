"""Photo-facade slab buildings for Late Roadster (Raycity-style: a box with a photographic elevation).

  # G+3 slab from a full facade image (A_xx), roof F_xx:
  blender -b -P tools/blender/photo_building.py -- --out public/assets/gen/photo_a1.glb --kind A --img A_01 --roof F_01 --clad Tiles143 [--preview /tmp/p.png]
  # tall slab: shopfront strip (C_xx) + N stacked upper-floor modules (B_xx, 3 floors / 12 m each):
  blender -b -P tools/blender/photo_building.py -- --out public/assets/gen/photo_t1.glb --kind T --strip C_01 --module B_01 --stacks 2 --roof F_02 --clad Bricks059

Materials are named by convention and bound in the game (src/render/assets.ts): "photo:<tex>" (full-UV image),
"roof:<tex>", "wall:<cladding>" (world-scale UVs). Nothing is embedded in the GLB.
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def arg(n, d):
    return argv[argv.index(n) + 1] if n in argv else d


OUT = arg("--out", "/tmp/photo.glb")
KIND = arg("--kind", "A")
IMG = arg("--img", "A_01")
STRIP = arg("--strip", "C_01")
MODULE = arg("--module", "B_01")
STACKS = int(arg("--stacks", "2"))
ROOF = arg("--roof", "F_01")
CLAD = arg("--clad", "Tiles143")
SIDE = arg(
    "--side", ""
)  # H_xx: photographed blank side wall (12 x 16 m) on the sides/back; "" = cladding only
PREVIEW = arg("--preview", "")
SEED = int(arg("--seed", "1"))
random.seed(SEED)

W, D = 12.0, 12.0
if KIND == "A":
    H = 16.0  # the A image is specified as 12 x 16 m (G + 3)
else:
    STRIP_H = 5.0
    H = STRIP_H + 12.0 * STACKS

bpy.ops.wm.read_factory_settings(use_empty=True)

_MATS = {}


def mat(name, rgb=(0.8, 0.8, 0.8), rough=0.85):
    if name in _MATS:
        return _MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    _MATS[name] = m
    return m


M_CLAD = mat("wall:" + CLAD, (0.82, 0.8, 0.76))
M_CONC = mat("wall:Concrete034", (0.7, 0.7, 0.7))
M_ROOF = mat("roof:" + ROOF, (0.6, 0.6, 0.6))
M_AC = mat("ac", (0.82, 0.82, 0.8), 0.6)
M_DARK = mat("frame", (0.18, 0.19, 0.22), 0.5)

bm = bmesh.new()
uv_layer = bm.loops.layers.uv.new("UVMap")
mats = []  # material slot order


def slot(m):
    if m not in mats:
        mats.append(m)
    return mats.index(m)


def quad(p0, p1, p2, p3, m, uvs=None, world_uv_scale=None):
    """CCW quad (outward normal by right-hand rule). uvs: 4 (u,v) or None -> world box projection / scale."""
    vs = [bm.verts.new(Vector(p)) for p in (p0, p1, p2, p3)]
    f = bm.faces.new(vs)
    f.material_index = slot(m)
    f.smooth = False
    bm.faces.ensure_lookup_table()
    n = f.normal
    for i, l in enumerate(f.loops):
        if uvs is not None:
            l[uv_layer].uv = uvs[i]
        else:
            c = l.vert.co
            s = world_uv_scale or 3.0
            ax = max(range(3), key=lambda k: abs(n[k]))
            if ax == 0:
                l[uv_layer].uv = (c.y / s, c.z / s)
            elif ax == 1:
                l[uv_layer].uv = (c.x / s, c.z / s)
            else:
                l[uv_layer].uv = (c.x / s, c.y / s)
    return f


def box(cx, cy, cz, sx, sy, sz, m, scale=3.0):
    x0, x1 = cx - sx / 2, cx + sx / 2
    y0, y1 = cy - sy / 2, cy + sy / 2
    z0, z1 = cz - sz / 2, cz + sz / 2
    quad(
        (x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), m, world_uv_scale=scale
    )  # -y
    quad(
        (x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1), m, world_uv_scale=scale
    )  # +y
    quad(
        (x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1), m, world_uv_scale=scale
    )  # +x
    quad(
        (x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1), m, world_uv_scale=scale
    )  # -x
    quad(
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1), m, world_uv_scale=scale
    )  # top
    quad(
        (x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0), m, world_uv_scale=scale
    )  # bottom


hx, hy = W / 2, D / 2
# ---- street face (-y) : photo
if KIND == "A":
    quad(
        (-hx, -hy, 0),
        (hx, -hy, 0),
        (hx, -hy, H),
        (-hx, -hy, H),
        mat("photo:" + IMG),
        uvs=[(0, 0), (1, 0), (1, 1), (0, 1)],
    )
else:
    quad(
        (-hx, -hy, 0),
        (hx, -hy, 0),
        (hx, -hy, STRIP_H),
        (-hx, -hy, STRIP_H),
        mat("photo:" + STRIP),
        uvs=[(0, 0), (1, 0), (1, 1), (0, 1)],
    )
    quad(
        (-hx, -hy, STRIP_H),
        (hx, -hy, STRIP_H),
        (hx, -hy, H),
        (-hx, -hy, H),
        mat("photo:" + MODULE),
        uvs=[(0, 0), (1, 0), (1, STACKS), (0, STACKS)],
    )
    # slab bands hide the module seams and the strip/module joint
    for k in range(STACKS):
        z = STRIP_H + 12.0 * k
        box(0, -hy - 0.08, z, W + 0.2, 0.3, 0.35, M_CONC)
    # pier columns at both ends of the shopfront strip (the strip repeats per 12 m, so the seams are the corners)
    for sx in (-1, 1):
        box(sx * (hx - 0.25), -hy - 0.12, STRIP_H / 2, 0.5, 0.35, STRIP_H, M_CONC)
# ---- other faces: cladding with world UVs; roof: photo
# side/back walls: the photographed side wall covers the bottom 16 m (its native size), cladding above
SIDE_H = min(H, 16.0) if SIDE else 0.0
FULL = [(0, 0), (1, 0), (1, 1), (0, 1)]
for a, b in [
    ((hx, hy), (-hx, hy)),
    ((hx, -hy), (hx, hy)),
    ((-hx, hy), (-hx, -hy)),
]:  # back, +x, -x
    (ax, ay), (bx, by) = a, b
    if SIDE_H > 0:
        quad(
            (ax, ay, 0),
            (bx, by, 0),
            (bx, by, SIDE_H),
            (ax, ay, SIDE_H),
            mat("photo:" + SIDE),
            uvs=FULL,
        )
    if H > SIDE_H:
        quad((ax, ay, SIDE_H), (bx, by, SIDE_H), (bx, by, H), (ax, ay, H), M_CLAD)
quad(
    (-hx, -hy, H),
    (hx, -hy, H),
    (hx, hy, H),
    (-hx, hy, H),
    M_ROOF,
    uvs=[(0, 0), (1, 0), (1, 1), (0, 1)],
)
# ---- parapet ring + rooftop clutter (a bulkhead, a water tank, AC units, antenna)
P = 0.5
for cx, cy, sx, sy in [
    (0, -hy + 0.15, W, 0.3),
    (0, hy - 0.15, W, 0.3),
    (-hx + 0.15, 0, 0.3, D),
    (hx - 0.15, 0, 0.3, D),
]:
    box(cx, cy, H + P / 2, sx, sy, P, M_CONC)
box(-hx + 2.4, hy - 2.6, H + 1.4, 3.2, 4.0, 2.8, M_CLAD)
box(-hx + 2.4 - 1.65, hy - 2.6, H + 1.0, 0.1, 1.0, 2.0, M_DARK)  # bulkhead door
for k in range(random.randint(2, 4)):
    box(
        random.uniform(-hx + 2, hx - 2),
        random.uniform(-hy + 2, 0),
        H + 0.45,
        1.0,
        0.5,
        0.9,
        M_AC,
        1.0,
    )
box(hx - 1.0, -hy + 1.0, H + 2.0, 0.08, 0.08, 4.0, M_DARK)
# water tank: an octagonal prism
tank_c = Vector((hx - 2.2, hy - 2.2, H + 1.0))
ring = [
    tank_c + Vector((math.cos(a) * 1.1, math.sin(a) * 1.1, 0))
    for a in [i * math.pi / 4 for i in range(8)]
]
for i in range(8):
    a, b = ring[i], ring[(i + 1) % 8]
    quad(
        (a.x, a.y, a.z - 1.0),
        (b.x, b.y, b.z - 1.0),
        (b.x, b.y, b.z + 1.0),
        (a.x, a.y, a.z + 1.0),
        M_AC,
        world_uv_scale=1.0,
    )
top = bm.faces.new([bm.verts.new(Vector((p.x, p.y, p.z + 1.0))) for p in ring])
top.material_index = slot(M_AC)
for l in top.loops:
    l[uv_layer].uv = (l.vert.co.x, l.vert.co.y)

bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
me = bpy.data.meshes.new("photo")
bm.to_mesh(me)
bm.free()
for m in mats:
    me.materials.append(m)
ob = bpy.data.objects.new("photo", me)
bpy.context.collection.objects.link(ob)
ob["bodyW"] = W
ob["bodyD"] = D
ob["bodyH"] = H

os.makedirs(os.path.dirname(os.path.abspath(OUT)) or ".", exist_ok=True)
ob.select_set(True)
bpy.context.view_layer.objects.active = ob
bpy.ops.export_scene.gltf(
    filepath=os.path.abspath(OUT),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_image_format="NONE",
    export_extras=True,
)
print("EXPORTED", OUT, "kind", KIND, "H", H, "faces", len(me.polygons))

if PREVIEW:
    # quick EEVEE preview with the real textures so the UV layout can be checked
    TEX = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "assets"
    )
    for m in mats:
        name = m.name
        path = None
        if name.startswith("photo:") or name.startswith("roof:"):
            path = os.path.join(TEX, "photo", name.split(":")[1] + ".webp")
        elif name.startswith("wall:"):
            path = os.path.join(TEX, "tex", name.split(":")[1] + ".webp")
        if path and os.path.exists(path):
            nt = m.node_tree
            img = nt.nodes.new("ShaderNodeTexImage")
            img.image = bpy.data.images.load(path)
            nt.links.new(
                img.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"]
            )
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x, scene.render.resolution_y = 1100, 900
    world = bpy.data.worlds.new("w")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (
        0.6,
        0.72,
        0.9,
        1,
    )
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (math.radians(50), 0, math.radians(-30))
    bpy.context.collection.objects.link(so)
    cam = bpy.data.cameras.new("cam")
    cam.lens = 35
    co = bpy.data.objects.new("cam", cam)
    dist = H * 1.9 + 14
    # --pview side: three-quarter view showing the side wall
    co.location = (
        (dist * 0.75, -dist * 0.7, H * 0.55)
        if arg("--pview", "") == "side"
        else (dist * 0.15, -dist * 0.95, H * 0.55)
    )
    # aim at the building centre
    target = Vector((0, 0, H * 0.5))
    direction = target - Vector(co.location)
    co.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(co)
    scene.camera = co
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print("PREVIEW", PREVIEW)
