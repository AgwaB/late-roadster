"""Render photoreal-ish tree billboards (RGBA PNG) for Late Roadster.

  blender -b -P tools/blender/tree_billboard.py -- --out public/assets/gen/tree_big.png --kind big --seed 3
  blender -b -P tools/blender/tree_billboard.py -- --out public/assets/gen/tree_small.png --kind small --seed 5

Builds a procedural broadleaf tree (tapered trunk, 3 branch levels, ~4k textured leaf cards with translucency),
lights it with the game's HDRI so the baked shading matches the in-game sky, and renders an orthographic side view
with a transparent film. The game maps the PNG onto 3 crossed cards (see cityMesh.ts).
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def arg(n, d):
    return argv[argv.index(n) + 1] if n in argv else d


OUT = arg("--out", "/tmp/tree.png")
KIND = arg("--kind", "big")
SEED = int(arg("--seed", "1"))
HDRI = arg("--hdri", "/tmp/ph/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr")
RES = int(arg("--res", "1024"))
random.seed(SEED)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = (
    "BLENDER_EEVEE_NEXT"
    if hasattr(bpy.types, "SceneEEVEE") and bpy.app.version >= (4, 2, 0)
    else "BLENDER_EEVEE"
)
scene.render.film_transparent = True
scene.render.resolution_x = RES
scene.render.resolution_y = RES
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
# AgX: photographic highlight roll-off and desaturation in the bake; the in-game Lambert adds direction on top
try:
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium Contrast"
    scene.view_settings.exposure = 0.35
except Exception:
    scene.view_settings.view_transform = "Filmic"
try:
    scene.eevee.taa_render_samples = 64
    scene.eevee.use_shadows = True
    scene.eevee.shadow_ray_count = 2
    scene.eevee.shadow_step_count = 4
    scene.eevee.use_fast_gi = True
    scene.eevee.fast_gi_distance = 2.0
except Exception:
    pass

# ---- species parameters
if KIND == "big":
    H_TRUNK, CROWN_R, CROWN_H, CROWN_Y0 = 2.6, 3.5, 4.6, 5.0
    N_LEAVES, LEAF = 34000, 0.125
else:
    H_TRUNK, CROWN_R, CROWN_H, CROWN_Y0 = 1.7, 2.4, 2.8, 3.4
    N_LEAVES, LEAF = 22000, 0.10
TOTAL_H = CROWN_Y0 + CROWN_H

# ---- leaf image (procedural, PIL-free): drawn into a Blender image
leaf_img = bpy.data.images.new("leaf", 128, 128, alpha=True)
px = [0.0] * (128 * 128 * 4)
for y in range(128):
    for x in range(128):
        u, v = (x + 0.5) / 128, (y + 0.5) / 128
        # leaf: lens shape along v, width profile ~ sin(pi v)
        half_w = 0.42 * math.sin(math.pi * min(1, max(0, v))) ** 0.8
        d = abs(u - 0.5)
        inside = d < half_w and 0.02 < v < 0.98
        i = (y * 128 + x) * 4
        if inside:
            edge = 1 - d / max(half_w, 1e-3)
            vein = math.exp(-(((u - 0.5) / 0.04) ** 2)) * 0.12
            g = 0.40 + 0.22 * edge + vein
            px[i] = 0.26 + 0.14 * edge + vein
            px[i + 1] = g
            px[i + 2] = 0.09 + 0.05 * edge
            px[i + 3] = 1.0
        else:
            px[i : i + 4] = [0, 0, 0, 0]
leaf_img.pixels.foreach_set(px)
leaf_img.pack()


def mat_leaf():
    m = bpy.data.materials.new("leaf")
    m.use_nodes = True
    try:
        m.surface_render_method = (
            "DITHERED"  # EEVEE Next: alpha clip + correct leaf-on-leaf shadows
        )
        m.use_transparent_shadow = True
    except Exception:
        try:
            m.blend_method = "CLIP"
            m.shadow_method = "CLIP"
        except Exception:
            pass
    m.use_backface_culling = False
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = leaf_img
    tex.interpolation = "Linear"
    # per-leaf colour variation via object info random
    info = nt.nodes.new("ShaderNodeObjectInfo")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.30, 0.36, 0.20, 1)
    ramp.color_ramp.elements[1].color = (0.95, 0.95, 0.60, 1)
    mid = ramp.color_ramp.elements.new(0.5)
    mid.color = (0.62, 0.70, 0.38, 1)
    mix = nt.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 1.0
    nt.links.new(info.outputs["Random"], ramp.inputs[0])
    nt.links.new(tex.outputs["Color"], mix.inputs[1])
    nt.links.new(ramp.outputs["Color"], mix.inputs[2])
    nt.links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.78
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.25
    if "Transmission Weight" in bsdf.inputs:
        bsdf.inputs["Transmission Weight"].default_value = 0.0
    if "Subsurface Weight" in bsdf.inputs:
        bsdf.inputs["Subsurface Weight"].default_value = 0.25
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def mat_bark():
    m = bpy.data.materials.new("bark")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 14
    noise.inputs["Detail"].default_value = 6
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.035, 0.025, 0.018, 1)
    ramp.color_ramp.elements[1].color = (0.15, 0.12, 0.085, 1)
    nt.links.new(noise.outputs["Fac"], ramp.inputs[0])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.95
    return m


M_LEAF, M_BARK = mat_leaf(), mat_bark()

# ---- trunk + branches as one bmesh of tapered tubes
bm = bmesh.new()


def tube(p0, p1, r0, r1, n=12):
    d = p1 - p0
    L = d.length
    if L < 1e-4:
        return
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix()
    ring0, ring1 = [], []
    for k in range(n):
        a = 2 * math.pi * k / n
        c = Vector((math.cos(a), math.sin(a), 0))
        ring0.append(bm.verts.new(p0 + rot @ (c * r0)))
        ring1.append(bm.verts.new(p1 + rot @ (c * r1)))
    for k in range(n):
        bm.faces.new((ring0[k], ring0[(k + 1) % n], ring1[(k + 1) % n], ring1[k]))


leaf_anchors = []


def branch(p, d, length, radius, level):
    segs = 4
    cur = p
    dirv = d.normalized()
    for s in range(segs):
        nxt = cur + dirv * (length / segs)
        # gentle upward curl + jitter
        dirv = (
            dirv
            + Vector((random.uniform(-0.25, 0.25), random.uniform(-0.25, 0.25), 0.18))
        ).normalized()
        tube(
            cur, nxt, radius * (1 - s / segs * 0.6), radius * (1 - (s + 1) / segs * 0.6)
        )
        cur = nxt
        if level >= 1 and s >= 1:
            leaf_anchors.append(cur)
    if level < 3:
        for _ in range(random.randint(2, 4) if level else random.randint(3, 5)):
            ang = random.uniform(0, 2 * math.pi)
            tilt = random.uniform(0.35, 0.95)
            nd = Vector((math.cos(ang) * tilt, math.sin(ang) * tilt, 1.0)).normalized()
            nd = (nd * 0.7 + dirv * 0.3).normalized()
            branch(
                cur - dirv * random.uniform(0, length * 0.3),
                nd,
                length * random.uniform(0.55, 0.75),
                radius * 0.55,
                level + 1,
            )


# trunk
base = Vector((0, 0, 0))
top = Vector((random.uniform(-0.15, 0.15), random.uniform(-0.15, 0.15), H_TRUNK))
tube(base, top, 0.22 if KIND == "big" else 0.15, 0.14 if KIND == "big" else 0.10, 10)
branch(top, Vector((0, 0, 1)), CROWN_H * 0.55, 0.13 if KIND == "big" else 0.09, 0)
me = bpy.data.meshes.new("trunk")
bm.to_mesh(me)
bm.free()
trunk = bpy.data.objects.new("trunk", me)
trunk.data.materials.append(M_BARK)
bpy.context.collection.objects.link(trunk)
bpy.context.view_layer.objects.active = trunk
trunk.select_set(True)
bpy.ops.object.shade_smooth()

# ---- leaves: a single mesh of quads, random orientation, distributed in a crown ellipsoid biased to the shell
lb = bmesh.new()
uv_layer = lb.loops.layers.uv.new("UVMap")
cz = CROWN_Y0 + CROWN_H * 0.5


# crown = union of 7-10 overlapping blobs around the branch tips -> irregular silhouette like a real canopy
BLOBS = []
for _ in range(random.randint(7, 10)):
    th = random.uniform(0, 2 * math.pi)
    rr = random.uniform(0.15, 0.7) * CROWN_R
    BLOBS.append(
        (
            Vector(
                (
                    math.cos(th) * rr,
                    math.sin(th) * rr,
                    cz + random.uniform(-0.35, 0.35) * CROWN_H,
                )
            ),
            random.uniform(0.45, 0.7) * CROWN_R,
        )
    )
BLOBS.append((Vector((0, 0, cz + CROWN_H * 0.1)), CROWN_R * 0.75))


def crown_point():
    c, r = random.choice(BLOBS)
    u = random.random() ** (1 / 1.5)
    th, ph = random.uniform(0, 2 * math.pi), math.acos(random.uniform(-1, 1))
    v = Vector(
        (math.sin(ph) * math.cos(th), math.sin(ph) * math.sin(th), math.cos(ph) * 0.85)
    ) * (u * r)
    return c + v


# leaves come in clumps of 6-14 around a clump centre (real foliage is clustered, not uniform)
CLUMPS = [crown_point() for _ in range(N_LEAVES // 14)]
for i in range(N_LEAVES):
    if random.random() < 0.9:
        p = random.choice(CLUMPS) + Vector(
            (random.gauss(0, 0.26), random.gauss(0, 0.26), random.gauss(0, 0.22))
        )
    else:
        p = random.choice(leaf_anchors) if leaf_anchors else crown_point()
    s = LEAF * random.uniform(0.75, 1.3)
    rot = (
        Matrix.Rotation(random.uniform(0, 2 * math.pi), 4, "Z")
        @ Matrix.Rotation(random.uniform(-1.2, 1.2), 4, "X")
        @ Matrix.Rotation(random.uniform(-0.6, 0.6), 4, "Y")
    )
    quad = [
        Vector((-s / 2, 0, 0)),
        Vector((s / 2, 0, 0)),
        Vector((s / 2, 0, s * 1.6)),
        Vector((-s / 2, 0, s * 1.6)),
    ]
    vs = [lb.verts.new(p + (rot @ q)) for q in quad]
    f = lb.faces.new(vs)
    for lp, uvc in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        lp[uv_layer].uv = uvc
lme = bpy.data.meshes.new("leaves")
lb.to_mesh(lme)
lb.free()
leaves = bpy.data.objects.new("leaves", lme)
leaves.data.materials.append(M_LEAF)
bpy.context.collection.objects.link(leaves)

# ---- world (game HDRI) + a soft sun from the upper-left-front; the in-game light adds the strong direction
world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
wn = world.node_tree
bg = wn.nodes["Background"]
if os.path.exists(HDRI):
    env = wn.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(HDRI)
    wn.links.new(env.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.85
else:
    bg.inputs["Color"].default_value = (0.55, 0.7, 0.9, 1)
sun = bpy.data.lights.new("sun", "SUN")
sun.energy = 5.5
sun.angle = math.radians(6)
so = bpy.data.objects.new("sun", sun)
so.rotation_euler = (math.radians(42), 0, math.radians(-40))
bpy.context.collection.objects.link(so)

# ---- orthographic side camera, framing the whole tree with a small margin
cam = bpy.data.cameras.new("cam")
cam.type = "ORTHO"
SIZE_M = max(TOTAL_H, 2.3 * CROWN_R) * 1.06
cam.ortho_scale = SIZE_M
co = bpy.data.objects.new("cam", cam)
co.location = (0, -30, SIZE_M / 2)
co.rotation_euler = (math.radians(90), 0, 0)
bpy.context.collection.objects.link(co)
scene.camera = co

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
scene.render.filepath = os.path.abspath(OUT)
bpy.ops.render.render(write_still=True)
# the game needs the card aspect: width = height = TOTAL_H * 1.04 metres
print(
    "TREE_DONE",
    OUT,
    "size_m",
    round(SIZE_M, 2),
    "trunk_top",
    H_TRUNK,
    "crown_r",
    CROWN_R,
)
