# Procedural Korean-street commercial building for Late Roadster.
# Library: build(W, D, floors, seed) -> object (use live via blender-mcp)
# CLI:     blender -b -P tools/blender/building.py -- --out x.glb --seed 1 --w 14 --d 12 --floors 5 [--preview x.png]
import math
import os
import random
import sys

import bpy

HERE = (
    os.path.dirname(os.path.abspath(__file__))
    if "__file__" in globals()
    else os.getcwd()
)
TEX = (
    os.path.normpath(os.path.join(HERE, "..", "..", "public", "assets", "tex"))
    if "tools" in HERE
    else os.path.join(os.getcwd(), "public", "assets", "tex")
)
FONT_PATHS = [
    "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
]
FH = 3.5
SHOP_H = 4.5
# Sign text lives in a game-generated 8x8 atlas (2048x512, cell 256x64). Blender only assigns cell UVs. Rows 0-5 = shop/floor words, 6-7 = extra.
ATLAS_COLS = 8
ATLAS_ROWS = 8

WALLS = [
    (0.93, 0.91, 0.86),
    (0.86, 0.84, 0.78),
    (0.78, 0.80, 0.83),
    (0.90, 0.88, 0.84),
    (0.72, 0.68, 0.62),
    (0.84, 0.80, 0.72),
    (0.80, 0.74, 0.66),
    (0.62, 0.58, 0.55),
]
SIGN_COLORS = [
    (0.85, 0.12, 0.10),
    (0.10, 0.40, 0.80),
    (0.95, 0.70, 0.10),
    (0.10, 0.60, 0.30),
    (0.08, 0.08, 0.08),
    (0.95, 0.95, 0.95),
    (0.90, 0.35, 0.05),
    (0.55, 0.15, 0.60),
]
SHOP_WORDS = [
    "치킨",
    "노래방",
    "PC방",
    "커피",
    "약국",
    "편의점",
    "분식",
    "호프",
    "세탁소",
    "휴대폰",
    "COFFEE",
    "BANK",
    "GYM",
    "BBQ",
    "김밥",
    "떡볶이",
    "피자",
]
FLOOR_WORDS = [
    "치과",
    "학원",
    "부동산",
    "헬스",
    "미용실",
    "피부과",
    "당구장",
    "스터디카페",
    "태권도",
    "영어학원",
    "요가",
    "한의원",
    "법무사",
    "네일",
]

_MAT_CACHE = {}


def mat(name, rgb, rough=0.6, metal=0.0, tex=None, tint=None):
    key = (
        name,
        tuple(round(c, 3) for c in rgb),
        rough,
        metal,
        tex,
        tuple(round(c, 3) for c in tint) if tint else None,
    )
    if key in _MAT_CACHE and _MAT_CACHE[key].name in bpy.data.materials:
        return _MAT_CACHE[key]
    m = bpy.data.materials.new(name)
    _MAT_CACHE[key] = m
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    p = tex and os.path.join(
        TEX, tex + ".webp"
    )  # shipped textures are WebP (tools/optimize_assets.sh)
    if p and os.path.exists(p):
        img = nt.nodes.new("ShaderNodeTexImage")
        img.image = bpy.data.images.load(p, check_existing=True)
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs[6].default_value = (*(tint or rgb), 1)
        nt.links.new(img.outputs["Color"], mix.inputs[7])
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    return m


def build(W=14.0, D=12.0, FLOORS=5, seed=1, name="building"):
    random.seed(seed)
    _MAT_CACHE.clear()
    H = SHOP_H + FLOORS * FH
    objs = []

    def box(nm, sx, sy, sz, x, y, z, m):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z))
        o = bpy.context.active_object
        o.scale = (sx, sy, sz)
        o.name = nm
        o.data.materials.append(m)
        objs.append(o)
        return o

    def text(word, w_avail, x, y, z, rot_z, color, size=0.8):
        bpy.ops.object.text_add(location=(x, y, z))
        t = bpy.context.active_object
        t.data.body = word
        t.data.align_x = "CENTER"
        t.data.align_y = "CENTER"
        t.data.extrude = 0.02
        t.data.size = size
        t.data.resolution_u = 2
        for fp in FONT_PATHS:
            if os.path.exists(fp):
                t.data.font = bpy.data.fonts.load(fp, check_existing=True)
                break
        t.rotation_euler = (math.pi / 2, 0, rot_z)
        t.data.materials.append(mat("txt", color, 0.5))
        bpy.context.view_layer.update()
        tw = t.dimensions.x
        if tw > w_avail * 0.9:
            t.scale = (w_avail * 0.9 / tw, w_avail * 0.9 / tw, 1)
        objs.append(t)
        return t

    def sign_colors():
        col = random.choice(SIGN_COLORS)
        tc = (0.98, 0.98, 0.98) if sum(col) < 1.6 else (0.08, 0.08, 0.08)
        return col, tc

    m_atlas = mat("signatlas", (1, 1, 1), 0.55)

    def sign_box(nm, sx, sy, sz, x, y, z, cell=None, rot=False):
        """A sign panel whose faces are UV-mapped to one atlas cell (text drawn by the game)."""
        o = box(nm, sx, sy, sz, x, y, z, m_atlas)
        o["cell"] = (
            random.randrange(ATLAS_COLS * ATLAS_ROWS) if cell is None else cell
        ) + 1
        o["cellrot"] = 1 if rot else 0
        return o

    wall_tint = random.choice(WALLS)
    # cladding: photo tiles/brick/dark tile (ambientCG, pre-tiled 3x so 3 m UV = 1 m physical) or plain concrete
    WALL_TEX = [
        ("Tiles143", (1.0, 0.98, 0.94)),
        ("Tiles143", (0.86, 0.86, 0.88)),
        ("Bricks059", (0.95, 0.92, 0.9)),
        ("Tiles140", (0.9, 0.9, 0.92)),
        ("Concrete034", wall_tint),
        ("Concrete034", wall_tint),
    ]
    wall_tex, wall_mul = random.choice(WALL_TEX)
    # material name carries the texture id: the game (assets.ts) binds the shared 2k texture + normal map by name
    m_wall = mat("wall:" + wall_tex, wall_mul, 0.8, tex=wall_tex, tint=wall_mul)
    m_wall2 = mat(
        "wall2", (0.58, 0.58, 0.60), 0.8, tex="Concrete034", tint=(0.62, 0.62, 0.64)
    )
    m_glass = mat("glass", (0.45, 0.62, 0.80), 0.08, 0.9)
    m_frame = mat("frame", (0.18, 0.19, 0.22), 0.5, 0.6)
    m_roof = mat(
        "roof", (0.5, 0.5, 0.52), 0.9, tex="Concrete034", tint=(0.5, 0.5, 0.52)
    )
    m_ac = mat("ac", (0.82, 0.82, 0.80), 0.6, 0.3)
    m_awn = mat(
        "awning",
        random.choice(
            [
                (0.75, 0.15, 0.12),
                (0.12, 0.35, 0.70),
                (0.15, 0.50, 0.25),
                (0.25, 0.25, 0.25),
            ]
        ),
        0.8,
    )
    m_shut = mat("shutter", (0.62, 0.64, 0.66), 0.5, 0.5)
    m_white = mat("white", (0.95, 0.95, 0.95), 0.4)

    box("core", W - 0.6, D - 0.6, H, 0, 0, H / 2, m_wall)

    def facade(length, axis, sign, front=False):
        n = max(2, int(length // 3.2))
        slot = length / n
        for f in range(FLOORS):
            z0 = SHOP_H + f * FH
            if axis == "x":
                box("sp", length, 0.3, 1.0, 0, sign * (D / 2 - 0.15), z0 + 0.5, m_wall)
            else:
                box("sp", 0.3, length, 1.0, sign * (W / 2 - 0.15), 0, z0 + 0.5, m_wall)
            for i in range(n):
                c = -length / 2 + slot * (i + 0.5)
                if axis == "x":
                    box(
                        "pier",
                        0.45,
                        0.32,
                        FH,
                        c - slot / 2 + 0.225,
                        sign * (D / 2 - 0.16),
                        z0 + FH / 2,
                        m_wall,
                    )
                else:
                    box(
                        "pier",
                        0.32,
                        0.45,
                        FH,
                        sign * (W / 2 - 0.16),
                        c - slot / 2 + 0.225,
                        z0 + FH / 2,
                        m_wall,
                    )
                gw = slot - 0.45 - 0.2
                gh = FH - 1.0 - 0.3
                if axis == "x":
                    box(
                        "glass",
                        gw,
                        0.05,
                        gh,
                        c + 0.1,
                        sign * (D / 2 - 0.42),
                        z0 + 1.0 + gh / 2 + 0.1,
                        m_glass,
                    )
                    box(
                        "mullion",
                        0.06,
                        0.08,
                        gh,
                        c + 0.1,
                        sign * (D / 2 - 0.38),
                        z0 + 1.0 + gh / 2 + 0.1,
                        m_frame,
                    )
                    box(
                        "frame",
                        gw + 0.12,
                        0.08,
                        0.08,
                        c + 0.1,
                        sign * (D / 2 - 0.36),
                        z0 + 1.0 + gh + 0.16,
                        m_frame,
                    )
                    box(
                        "sill",
                        gw + 0.2,
                        0.3,
                        0.08,
                        c + 0.1,
                        sign * (D / 2 - 0.3),
                        z0 + 1.0 + 0.06,
                        m_white,
                    )
                    if random.random() < 0.35:
                        box(
                            "ac",
                            0.75,
                            0.3,
                            0.55,
                            c + gw / 2 - 0.3,
                            sign * (D / 2 + 0.16),
                            z0 + 1.0 + 0.3,
                            m_ac,
                        )
                    # Korean streets: a sign panel on almost every floor of the street facade
                    if front and random.random() < 0.75:
                        sign_box(
                            "fsign",
                            gw + 0.1,
                            0.12,
                            0.75,
                            c + 0.1,
                            sign * (D / 2 + 0.07),
                            z0 + 0.5,
                        )
                else:
                    box(
                        "glass",
                        0.05,
                        gw,
                        gh,
                        sign * (W / 2 - 0.42),
                        c + 0.1,
                        z0 + 1.0 + gh / 2 + 0.1,
                        m_glass,
                    )
                    box(
                        "mullion",
                        0.08,
                        0.06,
                        gh,
                        sign * (W / 2 - 0.38),
                        c + 0.1,
                        z0 + 1.0 + gh / 2 + 0.1,
                        m_frame,
                    )
                    box(
                        "frame",
                        0.08,
                        gw + 0.12,
                        0.08,
                        sign * (W / 2 - 0.36),
                        c + 0.1,
                        z0 + 1.0 + gh + 0.16,
                        m_frame,
                    )
                    box(
                        "sill",
                        0.3,
                        gw + 0.2,
                        0.08,
                        sign * (W / 2 - 0.3),
                        c + 0.1,
                        z0 + 1.0 + 0.06,
                        m_white,
                    )
                    if random.random() < 0.35:
                        box(
                            "ac",
                            0.3,
                            0.75,
                            0.55,
                            sign * (W / 2 + 0.16),
                            c + gw / 2 - 0.3,
                            z0 + 1.0 + 0.3,
                            m_ac,
                        )
            if axis == "x":
                box(
                    "pier",
                    0.45,
                    0.32,
                    FH,
                    length / 2 - 0.225,
                    sign * (D / 2 - 0.16),
                    z0 + FH / 2,
                    m_wall,
                )
            else:
                box(
                    "pier",
                    0.32,
                    0.45,
                    FH,
                    sign * (W / 2 - 0.16),
                    length / 2 - 0.225,
                    z0 + FH / 2,
                    m_wall,
                )

    facade(W, "x", -1, front=True)
    facade(W, "x", 1)
    facade(D, "y", 1)
    facade(D, "y", -1)

    # ground floor shopfronts on the street side (-y)
    shops = max(1, int(W // 6))
    sw = W / shops
    for i in range(shops):
        cx = -W / 2 + sw * (i + 0.5)
        box("sfglass", sw - 0.6, 0.06, 3.0, cx, -D / 2 + 0.2, 1.6, m_glass)
        box("sfframe", sw - 0.5, 0.12, 0.12, cx, -D / 2 + 0.15, 3.15, m_frame)
        box("sfdoor", 0.06, 0.08, 2.4, cx + sw / 2 - 1.2, -D / 2 + 0.14, 1.2, m_frame)
        box(
            "sfpost",
            0.5,
            0.5,
            SHOP_H,
            cx - sw / 2 + 0.25,
            -D / 2 + 0.25,
            SHOP_H / 2,
            m_wall2,
        )
        box("step", sw - 0.6, 0.6, 0.15, cx, -D / 2 - 0.3, 0.075, m_wall2)
        sign_box("sign", sw - 0.4, 0.35, 1.0, cx, -D / 2 - 0.2, 3.85)
        if random.random() < 0.6:
            a = box("awning", sw - 0.8, 1.2, 0.08, cx, -D / 2 - 0.8, 3.2, m_awn)
            a.rotation_euler = (math.radians(-18), 0, 0)
    box("sfpost", 0.5, 0.5, SHOP_H, W / 2 - 0.25, -D / 2 + 0.25, SHOP_H / 2, m_wall2)
    box("back", W, 0.4, SHOP_H, 0, D / 2 - 0.2, SHOP_H / 2, m_wall2)
    for sign in (-1, 1):
        box("side", 0.4, D, SHOP_H, sign * (W / 2 - 0.2), 0, SHOP_H / 2, m_wall2)
        for k in range(max(1, int(D // 5))):
            box(
                "shutter",
                0.06,
                3.2,
                2.8,
                sign * (W / 2 + 0.02),
                -D / 2 + 2.5 + k * 5,
                1.5,
                m_shut,
            )
            for r in range(6):
                box(
                    "rib",
                    0.02,
                    3.2,
                    0.05,
                    sign * (W / 2 + 0.06),
                    -D / 2 + 2.5 + k * 5,
                    0.4 + r * 0.45,
                    m_frame,
                )
    # vertical sign on the front corner
    vs_h = FLOORS * FH * 0.7
    sign_box(
        "vsign",
        0.9,
        0.25,
        vs_h,
        W / 2 + 0.5,
        -D / 2 + 1.0,
        SHOP_H + FLOORS * FH * 0.4,
        rot=True,
    )
    # roof
    box("parapet", W, 0.35, 0.9, 0, D / 2 - 0.17, H + 0.45, m_wall)
    box("parapet", W, 0.35, 0.9, 0, -D / 2 + 0.17, H + 0.45, m_wall)
    box("parapet", 0.35, D, 0.9, W / 2 - 0.17, 0, H + 0.45, m_wall)
    box("parapet", 0.35, D, 0.9, -W / 2 + 0.17, 0, H + 0.45, m_wall)
    box("roofslab", W - 0.6, D - 0.6, 0.2, 0, 0, H + 0.1, m_roof)
    box("bulkhead", 3.2, 4.0, 2.8, -W / 2 + 2.3, D / 2 - 2.6, H + 1.4, m_wall)
    box("bulkdoor", 0.1, 1.0, 2.0, -W / 2 + 2.3 - 1.6, D / 2 - 2.6, H + 1.0, m_frame)
    bpy.ops.mesh.primitive_cylinder_add(
        radius=1.1, depth=2.0, location=(W / 2 - 2.0, D / 2 - 2.0, H + 1.5)
    )
    t = bpy.context.active_object
    t.data.materials.append(m_ac)
    objs.append(t)
    for k in range(random.randint(2, 5)):
        box(
            "rac",
            1.0,
            0.5,
            0.9,
            random.uniform(-W / 2 + 2, W / 2 - 2),
            random.uniform(-D / 2 + 2, 0),
            H + 0.65,
            m_ac,
        )
    box("antenna", 0.08, 0.08, 4.0, W / 2 - 1.0, -D / 2 + 1.0, H + 2.0, m_frame)
    # rooftop billboard frame (every other building)
    if random.random() < 0.5:
        box("bbpost", 0.15, 0.15, 3.0, -2.0, 0.5, H + 1.5, m_frame)
        box("bbpost", 0.15, 0.15, 3.0, 2.0, 0.5, H + 1.5, m_frame)
        sign_box("bb", 6.0, 0.15, 2.0, 0, 0.5, H + 3.5)

    # tag faces with the sign cell before joining (int attribute survives join)
    for o in objs:
        if o.type != "MESH":
            continue
        cell = o.get("cell", 0)
        rot = o.get("cellrot", 0)
        a = o.data.attributes.new("cell", "INT", "FACE")
        for i in range(len(a.data)):
            a.data[i].value = cell
        r = o.data.attributes.new("cellrot", "INT", "FACE")
        for i in range(len(r.data)):
            r.data[i].value = rot
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.join()
    bld = bpy.context.active_object
    bld.name = name
    bpy.ops.object.shade_flat()
    # UVs: world-scale box projection for everything, atlas cell rect for sign faces
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(bld.data)
    uv = bm.loops.layers.uv.verify()
    cl = bm.faces.layers.int.get("cell")
    rl = bm.faces.layers.int.get("cellrot")
    for f in bm.faces:
        n = f.normal
        cell = f[cl] - 1 if cl else -1
        if cell >= 0:
            # face-local rect: u along the face's horizontal extent, v along vertical
            cx = cell % ATLAS_COLS
            cy = cell // ATLAS_COLS
            u0 = cx / ATLAS_COLS
            u1 = (cx + 1) / ATLAS_COLS
            v0 = 1 - (cy + 1) / ATLAS_ROWS
            v1 = 1 - cy / ATLAS_ROWS
            vs = [l.vert.co for l in f.loops]
            horiz = (1, 0, 0) if abs(n.y) >= abs(n.x) else (0, 1, 0)
            hs = [v.x if horiz[0] else v.y for v in vs]
            zs = [v.z for v in vs]
            hmin, hmax, zmin, zmax = min(hs), max(hs), min(zs), max(zs)
            rot = f[rl] if rl else 0
            for l in f.loops:
                h = l.vert.co.x if horiz[0] else l.vert.co.y
                z = l.vert.co.z
                th = (h - hmin) / (hmax - hmin) if hmax > hmin else 0.5
                tz = (z - zmin) / (zmax - zmin) if zmax > zmin else 0.5
                # front faces read left->right; mirror for faces whose normal points the other way
                flip = (n.y > 0) if horiz[0] else (n.x < 0)
                if flip:
                    th = 1 - th
                if rot:
                    th, tz = tz, 1 - th
                l[uv].uv = (u0 + (u1 - u0) * th, v0 + (v1 - v0) * tz)
        else:
            ax = max(range(3), key=lambda i: abs(n[i]))
            for l in f.loops:
                c = l.vert.co
                if ax == 0:
                    l[uv].uv = (c.y / 3.0, c.z / 3.0)
                elif ax == 1:
                    l[uv].uv = (c.x / 3.0, c.z / 3.0)
                else:
                    l[uv].uv = (c.x / 3.0, c.y / 3.0)
    bm.to_mesh(bld.data)
    bm.free()
    bld.data.attributes.remove(bld.data.attributes["cell"])
    bld.data.attributes.remove(bld.data.attributes["cellrot"])
    bld["bodyW"] = W
    bld["bodyD"] = D
    bld["bodyH"] = H
    return bld


def export_glb(obj, out):
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_image_format="NONE",
        export_extras=True,
    )
    print("EXPORTED", out, "verts", len(obj.data.vertices))


def setup_preview_world():
    scene = bpy.context.scene
    scene.world = scene.world or bpy.data.worlds.new("w")
    scene.world.use_nodes = True
    wn = scene.world.node_tree
    sky = os.path.join(TEX, "sky.hdr")
    if os.path.exists(sky) and not any(n.type == "TEX_ENVIRONMENT" for n in wn.nodes):
        env = wn.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(sky, check_existing=True)
        wn.links.new(env.outputs["Color"], wn.nodes["Background"].inputs["Color"])
    wn.nodes["Background"].inputs["Strength"].default_value = 1.0


if "--" in sys.argv:
    args = sys.argv[sys.argv.index("--") + 1 :]

    def arg(n, d):
        return args[args.index(n) + 1] if n in args else d

    OUT = arg("--out", "/tmp/bldg.glb")
    PREVIEW = arg("--preview", "")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bld = build(
        float(arg("--w", "14")),
        float(arg("--d", "12")),
        int(arg("--floors", "5")),
        int(arg("--seed", "1")),
    )
    export_glb(bld, OUT)
    if PREVIEW:
        scene = bpy.context.scene
        W = bld.dimensions.x
        D = bld.dimensions.y
        H = bld.dimensions.z
        bpy.ops.object.light_add(type="SUN", location=(0, 0, 50))
        sun = bpy.context.active_object
        sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
        sun.data.energy = 2.5
        setup_preview_world()
        bpy.ops.object.camera_add(location=(W * 1.3, -D * 2.4, H * 0.7))
        cam = bpy.context.active_object
        cam.data.lens = 32
        bpy.ops.object.empty_add(location=(0, 0, H * 0.45))
        tgt = bpy.context.active_object
        c = cam.constraints.new(type="TRACK_TO")
        c.target = tgt
        c.track_axis = "TRACK_NEGATIVE_Z"
        c.up_axis = "UP_Y"
        scene.camera = cam
        bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
        g = bpy.context.active_object
        g.data.materials.append(
            mat(
                "ground",
                (0.45, 0.45, 0.47),
                0.9,
                tex="Asphalt033",
                tint=(0.6, 0.6, 0.62),
            )
        )
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.uv.cube_project(cube_size=8.0, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode="OBJECT")
        scene.render.engine = (
            "BLENDER_EEVEE_NEXT" if bpy.app.version >= (4, 2, 0) else "BLENDER_EEVEE"
        )
        scene.render.resolution_x = 1100
        scene.render.resolution_y = 700
        scene.render.filepath = PREVIEW
        bpy.ops.render.render(write_still=True)
        print("PREVIEW", PREVIEW)
