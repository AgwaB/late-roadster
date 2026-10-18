# Assemble a building from Poly Haven's photoscanned "modular_urban_apartments_facade" kit (CC0).
#   blender -b -P tools/blender/euro_building.py -- --kit /tmp/ph/models/modular_urban_apartments_facade/modular_urban_apartments_facade_1k.gltf --out public/assets/gen/euro_1.glb --w 14 --d 12 --floors 4 --seed 1 [--preview /tmp/e.png] [--tex 1024] [--tris 40000]
import math
import os
import random
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1 :]


def arg(n, d):
    return args[args.index(n) + 1] if n in args else d


KIT = arg("--kit", "")
OUT = arg("--out", "/tmp/euro.glb")
PREVIEW = arg("--preview", "")
W = float(arg("--w", "14"))
D = float(arg("--d", "12"))
FLOORS = int(arg("--floors", "4"))
SEED = int(arg("--seed", "1"))
TEX = int(arg("--tex", "1024"))
TRIS = int(arg("--tris", "40000"))
random.seed(SEED)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=KIT)
kit = {o.name: o for o in bpy.data.objects if o.type == "MESH"}
# pre-decimate the kit so every placed module is cheap (kit is ~270k polys scanned)
KIT_RATIO = float(arg("--kitratio", "0.1"))
for o in kit.values():
    if o.data.users > 1:
        o.data = o.data.copy()  # modifiers cannot be applied to multi-user meshes
    if len(o.data.polygons) > 60:
        m = o.modifiers.new("dec", "DECIMATE")
        # scanned wall slabs are ~90% redundant coplanar tris; windows/crowns need more budget
        # walls: 0.028 keeps the plaster UVs clean; piers are flat strips placed ~80x per building;
        # inserts (windows/doors/crowns) take KIT_RATIO
        n0 = len(o.data.polygons)
        if o.name.startswith("wall_pier"):
            # thin strips placed ~80x per building: collapse smears their UVs, planar dissolve barely
            # reduces scan noise; un-subdivide keeps the grid topology and the plaster UVs
            m.decimate_type = "UNSUBDIV"
            m.iterations = int(arg("--pieriter", "4"))
        elif o.name.startswith("wall_"):
            m.ratio = max(0.028, 40 / n0)
        else:
            m.ratio = max(KIT_RATIO, 30 / n0)
        m.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.modifier_apply(modifier="dec")
        o.select_set(False)
# shrink kit textures once
for img in bpy.data.images:
    if img.size[0] > TEX:
        img.scale(TEX, int(TEX * img.size[1] / max(1, img.size[0])))


# local bbox (object space) per module
def bbox(o):
    xs = [v.co.x for v in o.data.vertices]
    ys = [v.co.y for v in o.data.vertices]
    zs = [v.co.z for v in o.data.vertices]
    return (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs))


BB = {n: bbox(o) for n, o in kit.items()}
MOD_W = 3.0
PIER = "wall_pier_standard_01"
PIER_W = BB[PIER][1] - BB[PIER][0]


def flatten_pier():
    """The scanned pier is a 382-tri strip placed ~80x per building (70% of the budget). Replace its mesh with a
    12-tri box of the same bounds whose faces sample the centre of the pier's own plaster UV region."""
    import bmesh

    src = kit[PIER]
    me = src.data
    uvl = me.uv_layers.active.data
    us = [l.uv.x for l in uvl]
    vs = [l.uv.y for l in uvl]
    u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
    # inner 60% of the region avoids the scan's ragged border
    du, dv = (u1 - u0) * 0.2, (v1 - v0) * 0.2
    u0, u1, v0, v1 = u0 + du, u1 - du, v0 + dv, v1 - dv
    x0, x1, y0, y1, z0, z1 = BB[PIER]
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x = x0 if v.co.x < 0 else x1
        v.co.y = y0 if v.co.y < 0 else y1
        v.co.z = z0 if v.co.z < 0 else z1
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for l in f.loops:
            c = l.vert.co
            tu = (
                (c.x - x0) / (x1 - x0)
                if abs(f.normal.y) > 0.5
                else (c.y - y0) / (y1 - y0)
                if abs(f.normal.x) > 0.5
                else (c.x - x0) / (x1 - x0)
            )
            tz = (
                (c.z - z0) / (z1 - z0)
                if abs(f.normal.z) < 0.5
                else (c.y - y0) / (y1 - y0)
            )
            l[uv].uv = (u0 + (u1 - u0) * tu, v0 + (v1 - v0) * tz)
    new = bpy.data.meshes.new(PIER + "_box")
    bm.to_mesh(new)
    bm.free()
    for m in me.materials:
        new.materials.append(m)
    src.data = new


flatten_pier()
placed = []
PLACE_COUNT = {}


def place(name, x, y, z, rot, sx=1.0):
    """Duplicate kit module (shared mesh), bottom-centre at (x,y,z), facing outward along rot (0 = -y)."""
    src = kit[name]
    b = BB[name]
    PLACE_COUNT[name] = PLACE_COUNT.get(name, 0) + 1
    o = bpy.data.objects.new(name + "_i", src.data)
    bpy.context.scene.collection.objects.link(o)
    cx = (b[0] + b[1]) / 2
    cy = b[
        3
    ]  # kit modules: front face at max y? we align the back plane (max y) to the wall line
    o.rotation_euler = (0, 0, rot)
    o.scale = (sx, 1, 1)
    # local offset so that module bottom-centre sits at origin, then rotate into place
    off = Vector((-cx * sx, -cy, -b[4]))
    R = o.rotation_euler.to_matrix()
    o.location = Vector((x, y, z)) + R @ off
    placed.append(o)
    return o


# module families (wall panel -> insert)
UPPER = [
    "wall_window_centered_large_01",
    "wall_window_centered_large_02",
    "wall_window_centered_double_01",
    "wall_window_centered_double_02",
    "wall_window_centered_small_01",
    "wall_window_centered_small_02",
    "wall_window_offset_small_01",
    "wall_window_offset_small_03",
]
GROUND = [
    n
    for n in [
        "wall_door_window_small_01",
        "wall_door_window_small_02",
        "wall_door_window_small_03",
        "wall_door_window_small_05",
        "wall_door_window_small_07",
        "wall_door_centered_large_01",
        "wall_door_window_small_012",
        "wall_window_centered_double_01",
    ]
    if n in kit
]
UPPER = [n for n in UPPER if n in kit]


def insert_for(panel):
    return panel[len("wall_") :] if panel[len("wall_") :] in kit else None


BASE_H = BB["base_standard_01"][5] - BB["base_standard_01"][4]
DADO_H = BB["dado_standard_standard_01"][5] - BB["dado_standard_standard_01"][4]
FLOOR_H = 3.0
CORN_H = BB["cornice_standard_standard_01"][5] - BB["cornice_standard_standard_01"][4]
CROWN_H = BB["crown_standard_standard_01"][5] - BB["crown_standard_standard_01"][4]
H = BASE_H + DADO_H + FLOORS * FLOOR_H + CORN_H + CROWN_H

# four walls: (start point, direction unit, outward normal angle)
walls = [
    ((-W / 2, -D / 2), (1, 0), 0.0),
    ((W / 2, -D / 2), (0, 1), math.pi / 2),
    ((W / 2, D / 2), (-1, 0), math.pi),
    ((-W / 2, D / 2), (0, -1), -math.pi / 2),
]
style_upper = random.sample(UPPER, 3)
for wi, ((sx0, sy0), (dx, dy), rot) in enumerate(walls):
    L = W if dx else D
    n = max(1, round((L - PIER_W) / (MOD_W + PIER_W)))
    pitch = (L - PIER_W) / n
    scale = (pitch - PIER_W) / MOD_W
    street = wi == 0
    for i in range(n):
        s0 = PIER_W + i * pitch
        sc = s0 + (pitch - PIER_W) / 2
        px, py = sx0 + dx * sc, sy0 + dy * sc
        # base + dado
        place("base_standard_01", px, py, 0, rot, scale)
        place("dado_standard_standard_01", px, py, BASE_H, rot, scale)
        for f in range(FLOORS):
            z = BASE_H + DADO_H + f * FLOOR_H
            if f == 0 and (street or random.random() < 0.3):
                panel = random.choice(GROUND)
            else:
                panel = random.choice(style_upper)
            place(panel, px, py, z, rot, scale)
            ins = insert_for(panel)
            if ins:
                place(ins, px, py, z, rot, scale)
        place(
            "cornice_standard_standard_01",
            px,
            py,
            BASE_H + DADO_H + FLOORS * FLOOR_H,
            rot,
            scale,
        )
        place(
            "crown_standard_standard_01",
            px,
            py,
            BASE_H + DADO_H + FLOORS * FLOOR_H + CORN_H,
            rot,
            scale,
        )
    # piers between bays (and at both ends)
    for i in range(n + 1):
        s = i * pitch + PIER_W / 2
        px, py = sx0 + dx * s, sy0 + dy * s
        for f in range(FLOORS):
            place(PIER, px, py, BASE_H + DADO_H + f * FLOOR_H, rot)
        place("dado_pier_pedestal_01", px, py, BASE_H, rot)
        place(
            "cornice_pier_standard_01", px, py, BASE_H + DADO_H + FLOORS * FLOOR_H, rot
        )
        place(
            "crown_pier_pedestal_01",
            px,
            py,
            BASE_H + DADO_H + FLOORS * FLOOR_H + CORN_H,
            rot,
        )

# signboards on the street-facing ground floor and a few upper floors (text comes from the game's sign atlas)
ATLAS_COLS = 8
ATLAS_ROWS = 8
m_atlas = bpy.data.materials.new("signatlas")
m_atlas.use_nodes = True


def sign(x, y, z, w, h, rot, cell=None):
    cell = random.randrange(ATLAS_COLS * ATLAS_ROWS) if cell is None else cell
    cx, cy = cell % ATLAS_COLS, cell // ATLAS_COLS
    u0, u1 = cx / ATLAS_COLS, (cx + 1) / ATLAS_COLS
    v0, v1 = 1 - (cy + 1) / ATLAS_ROWS, 1 - cy / ATLAS_ROWS
    me = bpy.data.meshes.new("sign")
    d = 0.12
    verts = [
        (-w / 2, 0, 0),
        (w / 2, 0, 0),
        (w / 2, 0, h),
        (-w / 2, 0, h),
        (-w / 2, d, 0),
        (w / 2, d, 0),
        (w / 2, d, h),
        (-w / 2, d, h),
    ]
    faces = [(0, 1, 2, 3), (4, 0, 3, 7), (1, 5, 6, 2), (3, 2, 6, 7), (4, 5, 1, 0)]
    me.from_pydata(verts, [], faces)
    me.update()
    uv = me.uv_layers.new()
    fuv = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    for p in me.polygons:
        for k, li in enumerate(p.loop_indices):
            uv.data[li].uv = fuv[k % 4] if p.index == 0 else (u0 + 0.01, v0 + 0.01)
    me.materials.append(m_atlas)
    o = bpy.data.objects.new("sign", me)
    bpy.context.scene.collection.objects.link(o)
    o.rotation_euler = (0, 0, rot)
    o.location = (x, y, z)
    placed.append(o)
    return o


(sx0, sy0), (dx, dy), rot = walls[0]
L = W
n = max(1, round((L - PIER_W) / (MOD_W + PIER_W)))
pitch = (L - PIER_W) / n
for i in range(n):
    sc_ = PIER_W + i * pitch + (pitch - PIER_W) / 2
    px, py_ = sx0 + dx * sc_, sy0 + dy * sc_
    sign(
        px, py_ - 0.2, BASE_H + DADO_H + FLOOR_H - 0.95, pitch - PIER_W - 0.2, 0.8, rot
    )  # shop fascia
    for f in range(1, FLOORS):
        if random.random() < 0.5:
            sign(
                px + random.uniform(-0.3, 0.3),
                py_ - 0.16,
                BASE_H + DADO_H + f * FLOOR_H + 0.15,
                1.6,
                0.55,
                rot,
            )
if random.random() < 0.6:  # vertical corner sign
    sign(
        sx0 + W - 0.1,
        sy0 + 0.6,
        BASE_H + DADO_H + 0.6,
        0.8,
        FLOORS * FLOOR_H * 0.6,
        math.pi / 2,
    )


# roof slab + parapet (simple), inside the facade ring
def mat(name, rgb, rough=0.9):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    return m


m_roof = mat("roof", (0.42, 0.42, 0.44))
m_wall = mat("wall", (0.80, 0.78, 0.74))


def box(sx, sy, sz, x, y, z, m):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z))
    o = bpy.context.active_object
    o.scale = (sx, sy, sz)
    o.data.materials.append(m)
    placed.append(o)
    return o


roof_z = BASE_H + DADO_H + FLOORS * FLOOR_H + CORN_H
box(W - 0.4, D - 0.4, 0.3, 0, 0, roof_z + 0.15, m_roof)
box(3.0, 3.6, 2.6, -W / 2 + 2.2, D / 2 - 2.4, roof_z + 1.3, m_wall)  # stair bulkhead
for k in range(random.randint(2, 4)):
    box(
        0.9,
        0.5,
        0.8,
        random.uniform(-W / 2 + 2, W / 2 - 2),
        random.uniform(-D / 2 + 2, 0),
        roof_z + 0.7,
        mat("ac", (0.8, 0.8, 0.78), 0.5),
    )
# backfill core so there are no see-through gaps
box(W - 0.9, D - 0.9, H, 0, 0, H / 2, m_wall)

if arg("--budget", ""):
    rows = []
    for n, c in PLACE_COUNT.items():
        me = kit[n].data
        me.calc_loop_triangles()
        rows.append((len(me.loop_triangles) * c, len(me.loop_triangles), c, n))
    for t, per, c, n in sorted(rows, reverse=True)[:14]:
        print("BUDGET", t, "=", per, "x", c, n)
# delete the original kit objects, join the placed ones
for o in list(kit.values()):
    bpy.data.objects.remove(o, do_unlink=True)
for o in bpy.context.scene.objects:
    o.select_set(o in placed)
bpy.context.view_layer.objects.active = placed[0]
bpy.ops.object.join()
bld = bpy.context.active_object
bld.name = "euro_building"
# decimate if over budget
tot = len(bld.data.polygons)
if tot > TRIS:
    mdec = bld.modifiers.new("dec", "DECIMATE")
    mdec.ratio = TRIS / tot
    bpy.ops.object.modifier_apply(modifier="dec")
bld["bodyW"] = W
bld["bodyD"] = D
bld["bodyH"] = H
os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_yup=True,
    export_image_format="NONE",
    export_extras=True,
)
print(
    "EXPORTED",
    OUT,
    "polys",
    tot,
    "->",
    len(bld.data.polygons),
    "H",
    round(H, 2),
    "bytes",
    os.path.getsize(OUT),
)

if PREVIEW:
    sc = bpy.context.scene
    sc.world = bpy.data.worlds.new("w")
    sc.world.use_nodes = True
    wn = sc.world.node_tree
    env = wn.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(
        os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..",
            "..",
            "public",
            "assets",
            "tex",
            "sky.hdr",
        )
    )
    wn.links.new(env.outputs["Color"], wn.nodes["Background"].inputs["Color"])
    bpy.ops.object.light_add(type="SUN", location=(0, 0, 50))
    sun = bpy.context.active_object
    sun.rotation_euler = (0.9, 0, -0.6)
    sun.data.energy = 2.5
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
    g = bpy.context.active_object
    g.data.materials.append(mat("ground", (0.35, 0.35, 0.37)))
    bpy.ops.object.camera_add(location=(W * 1.3, -D * 2.4, H * 0.7))
    cam = bpy.context.active_object
    cam.data.lens = 32
    bpy.ops.object.empty_add(location=(0, 0, H * 0.45))
    tgt = bpy.context.active_object
    c = cam.constraints.new(type="TRACK_TO")
    c.target = tgt
    c.track_axis = "TRACK_NEGATIVE_Z"
    c.up_axis = "UP_Y"
    sc.camera = cam
    sc.render.engine = "BLENDER_EEVEE_NEXT"
    sc.render.resolution_x = 1100
    sc.render.resolution_y = 700
    sc.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print("PREVIEW", PREVIEW)
