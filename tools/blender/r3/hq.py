"""ONTIME HOLDINGS: Round 3 photo-facade headquarters for Late Roadster.

  /opt/homebrew/bin/blender -b -P tools/blender/r3/hq.py -- --preview-dir research/raycity/r3-assets/buildings
  /opt/homebrew/bin/blender -b -P tools/blender/r3/hq.py -- --verify public/assets/gen/hq_r3.glb --report research/raycity/r3-assets/buildings/hq_verification.json

Defaults: public/assets/gen/hq_r3.glb and opaque, quality-88 O_01/O_03/O_04
WebPs in public/assets/photo/. Requires system Python 3 + Pillow for WebPs and
comparison sheets. Nothing is embedded: photo:, roof:, wall: materials follow
photo_building.py, including its bottom-left (0,0) Blender UV convention.
Preview image nodes are attached ONLY AFTER export. O_02 is deliberately unused:
the original entrance remains single, with a procedural canopy and three steps.

Units: metres, Blender Z up, facade -Y. Root is the ground-centre of the COMPLETE
38 x 20.1 m footprint (including steps). The main tower centre is (-7, 1.05, 0),
recorded separately in extras; bodyW/bodyD/bodyH remain 24/18/42. Roof equipment
extends above bodyH, just as in photo_building.py. Clock centres are measured from
O_01: pixel-edge coordinates (470.5, 193.5), between the opposing hour markers.
Both hand meshes point local +Z, with identity transforms and their origins at
the measured centre. Animate around Blender -Y / exported glTF +Z.

This file also supplies small mesh/render/verification helpers to villa.py.
"""

import argparse
import json
import math
import shutil
import struct
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Vector

PROJECT = Path(__file__).resolve().parents[3]
SOURCE = PROJECT / "research/raycity/generated/2026-10-17-round3"
ASSETS = PROJECT / "public/assets"
FULL = [(0, 0), (1, 0), (1, 1), (0, 1)]


def material(name, rgb=(0.8, 0.8, 0.8), roughness=0.85, metallic=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    mat.diffuse_color = (*rgb, 1)
    return mat


class Mesh:
    """Explicit outward-wound quads, no modifiers, world UVs at 3 metres/tile."""

    def __init__(self, name):
        self.name = name
        self.vertices, self.faces, self.uvs, self.indices, self.materials = (
            [],
            [],
            [],
            [],
            [],
        )

    def quad(self, points, mat, uv=None, scale=3.0):
        points = [tuple(p) for p in points]
        start = len(self.vertices)
        self.vertices.extend(points)
        self.faces.append(tuple(range(start, start + 4)))
        if mat not in self.materials:
            self.materials.append(mat)
        self.indices.append(self.materials.index(mat))
        if uv is None:
            normal = (Vector(points[1]) - Vector(points[0])).cross(
                Vector(points[2]) - Vector(points[0])
            )
            axis = max(range(3), key=lambda k: abs(normal[k]))
            uv = [
                (
                    (p[1] if axis == 0 else p[0]) / scale,
                    (p[1] if axis == 2 else p[2]) / scale,
                )
                for p in points
            ]
        self.uvs.extend(uv)

    def box(self, center, size, mat, scale=3.0, face_materials=None):
        x, y, z = center
        sx, sy, sz = size
        x0, x1, y0, y1, z0, z1 = (
            x - sx / 2,
            x + sx / 2,
            y - sy / 2,
            y + sy / 2,
            z - sz / 2,
            z + sz / 2,
        )
        for index, face in enumerate(
            [
                [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
                [(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)],
                [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)],
                [(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)],
                [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],
                [(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)],
            ]
        ):
            self.quad(
                face, face_materials[index] if face_materials else mat, scale=scale
            )

    def finish(self, root=None, location=(0, 0, 0)):
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.update()
        for mat in self.materials:
            mesh.materials.append(mat)
        uv = mesh.uv_layers.new(name="UVMap")
        for poly, index in zip(mesh.polygons, self.indices, strict=True):
            poly.material_index = index
            poly.use_smooth = False
        for loop, coords in zip(uv.data, self.uvs, strict=True):
            loop.uv = coords
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent = root
        obj.location = location
        return obj


def root_object(name, dims):
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    root["bodyW"], root["bodyD"], root["bodyH"] = dims
    root["facadeNormalBlender"] = [0, -1, 0]
    return root


def prepare_textures(names, crops=None):
    """No grading/keying/resampling unless over 2048; elevations are already opaque."""
    payload = {
        "source": str(SOURCE),
        "dest": str(ASSETS / "photo"),
        "names": names,
        "crops": crops or {},
    }
    code = r"""
import json, sys
from pathlib import Path
from PIL import Image
p=json.loads(sys.argv[1]); dst=Path(p['dest']); dst.mkdir(parents=True,exist_ok=True)
for name in p['names']:
    image=Image.open(Path(p['source'])/(name+'.png')).convert('RGB')
    if name in p['crops']: image=image.crop(tuple(p['crops'][name]))
    if max(image.size)>2048: image.thumbnail((2048,2048),Image.Resampling.LANCZOS)
    image.save(dst/(name+'.webp'),format='WEBP',quality=88,method=6)
    print('TEXTURE',name,image.size,'RGB opaque; quality 88')
"""
    subprocess.run(
        [shutil.which("python3") or "python3", "-c", code, json.dumps(payload)],
        check=True,
    )


def export(root, path):
    path = Path(path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for obj in root.children_recursive:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_extras=True,
        use_selection=True,
        export_image_format="NONE",
        export_animations=False,
        export_cameras=False,
        export_lights=False,
    )
    print("EXPORTED", path)


def parapet(mesh, cx, cy, w, d, h, mat, height=0.4, thickness=0.22):
    for x, y, sx, sy in [
        (cx, cy - d / 2 + thickness / 2, w, thickness),
        (cx, cy + d / 2 - thickness / 2, w, thickness),
        (cx - w / 2 + thickness / 2, cy, thickness, d - 2 * thickness),
        (cx + w / 2 - thickness / 2, cy, thickness, d - 2 * thickness),
    ]:
        mesh.box((x, y, h + height / 2), (sx, sy, height), mat)


def preview_setup():
    """Photo elevations are already lit: emission preview avoids double-lighting.

    This preview-only shader leaves exported game material contracts untouched.
    Roof/cladding use their real game images and normal surface lighting.
    """
    for mat in list(bpy.data.materials):
        if mat.name.startswith(("photo:", "roof:", "wall:")):
            kind, tex = mat.name.split(":", 1)
            path = ASSETS / ("tex" if kind == "wall" else "photo") / (tex + ".webp")
            if not path.exists():
                continue
            nt = mat.node_tree
            node = nt.nodes.new("ShaderNodeTexImage")
            node.image = bpy.data.images.load(str(path), check_existing=True)
            node.interpolation = "Linear"
            node.extension = "REPEAT"
            if kind == "photo":
                emit = nt.nodes.new("ShaderNodeEmission")
                nt.links.new(node.outputs["Color"], emit.inputs["Color"])
                emit.inputs["Strength"].default_value = 1.0
                nt.links.new(
                    emit.outputs["Emission"],
                    nt.nodes["Material Output"].inputs["Surface"],
                )
            else:
                nt.links.new(
                    node.outputs["Color"],
                    nt.nodes["Principled BSDF"].inputs["Base Color"],
                )
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.eevee.taa_render_samples = 24
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    scene.render.resolution_percentage = 100
    world = bpy.data.worlds.new("preview_world")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (
        0.78,
        0.81,
        0.86,
        1,
    )
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    for name, rot, energy in [
        ("preview_key", (35, -20, -25), 2.6),
        ("preview_fill", (25, 35, 145), 1.2),
    ]:
        data = bpy.data.lights.new(name, "SUN")
        data.energy = energy
        data.angle = math.radians(20)
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.rotation_euler = tuple(math.radians(v) for v in rot)
    ground = Mesh("preview_ground")
    ground.quad(
        [
            (-150, -150, -0.025),
            (150, -150, -0.025),
            (150, 150, -0.025),
            (-150, 150, -0.025),
        ],
        material("preview_ground", (0.58, 0.6, 0.62)),
    )
    ground.finish()
    data = bpy.data.cameras.new("preview_camera")
    data.type = "ORTHO"
    cam = bpy.data.objects.new("preview_camera", data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    return cam


def render(path, camera, position, target, scale, resolution=(900, 1000)):
    scene = bpy.context.scene
    camera.location = position
    camera.rotation_euler = (
        (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()
    )
    camera.data.ortho_scale = scale
    scene.render.resolution_x, scene.render.resolution_y = resolution
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    print("PREVIEW", path)


def comparison(path, rows):
    """Rows: label, reference path, render path, optional crop, physical aspect."""
    payload = {"out": str(path), "rows": rows}
    code = r"""
import json,sys
from PIL import Image, ImageOps, ImageDraw, ImageFont
p=json.loads(sys.argv[1]); rows=p['rows']; width=1000; rowh=590
sheet=Image.new('RGB',(width,rowh*len(rows)),(240,240,237)); draw=ImageDraw.Draw(sheet)
try: font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',18)
except OSError: font=ImageFont.load_default()
for k,row in enumerate(rows):
    label,refpath,renderpath,crop,aspect=row
    y=k*rowh
    draw.text((18,y+10),label,fill=(25,30,35),font=font)
    draw.text((18,y+36),'REFERENCE (mapped physical proportions)',fill=(70,75,80),font=font)
    draw.text((512,y+36),'PROCEDURAL ASSET / ORTHOGRAPHIC',fill=(70,75,80),font=font)
    for j,path in enumerate([refpath,renderpath]):
        im=Image.open(path).convert('RGB')
        if j==0:
            if crop: im=im.crop(tuple(crop))
            if aspect: im=im.resize((round(500*aspect),500),Image.Resampling.LANCZOS)
        im=ImageOps.contain(im,(472,rowh-76),Image.Resampling.LANCZOS)
        sheet.paste(im,(j*500+14+(472-im.width)//2,y+65+(rowh-76-im.height)//2))
    draw.line((500,y+57,500,y+rowh-5),fill=(195,198,200))
sheet.save(p['out'])
print('COMPARISON',p['out'])
"""
    subprocess.run(
        [shutil.which("python3") or "python3", "-c", code, json.dumps(payload)],
        check=True,
    )


def verify(path, report=None):
    """Fresh Blender import plus GLB JSON inspection; dimensions reported Z-up."""
    path = Path(path).resolve()
    data = path.read_bytes()
    assert data[:4] == b"glTF"
    length, kind = struct.unpack_from("<II", data, 12)
    assert kind == 0x4E4F534A
    gltf = json.loads(data[20 : 20 + length])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    points, meshes, loose, degenerate = [], [], 0, 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        obj.data.calc_loop_triangles()
        used = {i for p in obj.data.polygons for i in p.vertices}
        loose += len(obj.data.vertices) - len(used)
        degenerate += sum(t.area < 1e-10 for t in obj.data.loop_triangles)
        coords = [obj.matrix_world @ v.co for v in obj.data.vertices]
        points.extend(coords)
        lo = [min(p[k] for p in coords) for k in range(3)]
        hi = [max(p[k] for p in coords) for k in range(3)]
        meshes.append(
            {
                "name": obj.name,
                "triangles": len(obj.data.loop_triangles),
                "materials": [m.name for m in obj.data.materials],
                "bbox_min": lo,
                "bbox_max": hi,
                "origin": list(obj.matrix_world.translation),
                "scale": list(obj.scale),
            }
        )
    lo = [min(p[k] for p in points) for k in range(3)]
    hi = [max(p[k] for p in points) for k in range(3)]
    roots = {
        n.get("name", ""): n.get("extras", {})
        for n in gltf.get("nodes", [])
        if n.get("extras")
    }
    result = {
        "file": str(path.relative_to(PROJECT)),
        "file_bytes": len(data),
        "bbox_min_blender": lo,
        "bbox_max_blender": hi,
        "dimensions_blender_m": [hi[k] - lo[k] for k in range(3)],
        "triangles": sum(m["triangles"] for m in meshes),
        "objects": [o.name for o in bpy.context.scene.objects],
        "materials": [m["name"] for m in gltf.get("materials", [])],
        "embedded_images": gltf.get("images", []),
        "meshes": meshes,
        "extras": roots,
        "loose_vertices": loose,
        "degenerate_triangles": degenerate,
    }
    assert not result["embedded_images"], "Building textures must stay external"
    assert loose == 0 and degenerate == 0
    assert abs(lo[2]) < 1e-5, "Ground origin required"
    assert abs(lo[0] + hi[0]) < 1e-4 and abs(lo[1] + hi[1]) < 1e-4, (
        "Footprint must be centred"
    )
    limit = 3000 if "hq" in path.stem else 2500
    assert result["triangles"] <= limit
    # Inspect external texture dimensions without changing the source files.
    external = []
    for name in result["materials"]:
        if name.startswith("photo:"):
            texture_path = ASSETS / "photo" / (name.split(":", 1)[1] + ".webp")
            image = bpy.data.images.load(str(texture_path), check_existing=True)
            assert max(image.size) <= 2048
            external.append(
                {
                    "file": str(texture_path.relative_to(PROJECT)),
                    "size": list(image.size),
                    "bytes": texture_path.stat().st_size,
                }
            )
    result["external_photo_images"] = external
    if "hq" in path.stem:
        assert roots["hq_r3"]["bodyW"] == 24 and roots["hq_r3"]["bodyH"] == 42
        tower = bpy.data.objects["hq_tower"]
        assert all(
            abs(a - b) < 1e-4
            for a, b in zip(tower.dimensions, (24, 18, 42), strict=True)
        )
        # The front is outward -Y, and its UV V runs bottom-to-top as in photo_building.py.
        face = next(
            p
            for p in tower.data.polygons
            if tower.data.materials[p.material_index].name == "photo:O_01"
        )
        assert face.normal.y < -0.999
        uv_layer = tower.data.uv_layers.active.data
        for polygon in tower.data.polygons:
            name = tower.data.materials[polygon.material_index].name
            if name == "photo:O_01":
                for index in polygon.loop_indices:
                    vertex = tower.data.vertices[
                        tower.data.loops[index].vertex_index
                    ].co
                    uv = uv_layer[index].uv
                    assert abs(uv.x - (vertex.x + 19) / 24) < 1e-5
                    assert abs(uv.y - vertex.z / 42) < 1e-5
            if name == "photo:O_03" and polygon.normal.y > 0.999:
                for index in polygon.loop_indices:
                    vertex = tower.data.vertices[
                        tower.data.loops[index].vertex_index
                    ].co
                    assert abs(uv_layer[index].uv.x - (5 - vertex.x) / 18) < 1e-5
        expected_z = (1 - 193.5 / 1672) * 42
        result["clock_pivots_blender"] = {}
        for name in ("clock_hour", "clock_minute"):
            hand = bpy.data.objects[name]
            pivot = hand.matrix_world.translation
            assert abs(pivot.x + 7) < 1e-5 and abs(pivot.z - expected_z) < 1e-5
            assert abs(pivot.y + 8.005) < 1e-5
            assert hand.dimensions.z > hand.dimensions.x * 5
            assert all(abs(a - 1) < 1e-5 for a in hand.scale)
            result["clock_pivots_blender"][name] = list(pivot)
        result["checks"] = [
            "main body 24 x 18 x 42",
            "front outward -Y",
            "photo_building.py front UV orientation",
            "back O_03 UV repeat 4/3",
            "coincident measured clock pivots",
            "hands point up",
        ]
    else:
        assert roots["villa_r3"]["bodyW"] == 12 and roots["villa_r3"]["bodyH"] == 14
        graph = bpy.context.evaluated_depsgraph_get()
        rays = []
        for x in (-1.9, 0, 1.9):
            for z in (0.15, 1.3, 2.5):
                hit, point, normal, index, obj, matrix = bpy.context.scene.ray_cast(
                    graph, Vector((x, -5.5, z)), Vector((0, 1, 0)), distance=11
                )
                assert hit and abs(point.y - 5) < 1e-4, (
                    f"Blocked pilotis ray: x={x}, z={z}, hit={hit}, point={tuple(point)}"
                )
                rays.append({"x": x, "z": z, "first_hit_y": point.y})
        hit, point, normal, index, obj, matrix = bpy.context.scene.ray_cast(
            graph, Vector((0, 0, 0.01)), Vector((0, 0, 1)), distance=4
        )
        assert hit and abs(point.z - 2.6) < 1e-4
        result["pilotis_clearance_rays"] = rays
        result["ceiling_underside_z"] = point.z
        result["checks"] = [
            "body 12 x 10 x 14",
            "9 unobstructed central-bay rays to y=5",
            "ceiling underside z=2.6",
        ]
    result["verification_command"] = (
        "/opt/homebrew/bin/blender -b -t 4 -P tools/blender/r3/"
        + ("hq.py" if "hq" in path.stem else "villa.py")
        + " -- --verify "
        + result["file"]
        + (" --report " + str(report) if report else "")
    )
    if report:
        Path(report).parent.mkdir(parents=True, exist_ok=True)
        Path(report).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    print(
        "VERIFIED: ground, centred footprint, triangle budget, no embedded images, no loose/degenerate geometry"
    )
    return result


def build(out, preview_dir=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    prepare_textures(["O_01", "O_03", "O_04"])
    root = root_object("hq_r3", (24.0, 18.0, 42.0))
    root["mainBodyCentreBlender"] = [-7.0, 1.05, 0.0]
    root["fullFootprintW"], root["fullFootprintD"] = 38.0, 20.1
    root["annexW"], root["annexD"], root["annexH"] = 14.0, 18.0, 6.0
    root["annexCentreBlender"] = [12.0, 1.05, 0.0]
    root["clockPixelCentre"] = [470.5, 193.5]
    root["clockSourcePixels"] = [941, 1672]
    root["clockAxisGltf"] = [0, 0, 1]
    photo = material("photo:O_01")
    side = material("photo:O_03")
    parking = material("photo:O_04")
    roof = material("roof:F_01", (0.42, 0.43, 0.44))
    granite = material("granite:charcoal", (0.145, 0.16, 0.18), 0.75)
    dark = material("clock_and_vents:graphite", (0.018, 0.022, 0.027), 0.6, 0.15)
    metal = material("rooftop:aluminium", (0.52, 0.55, 0.56), 0.65, 0.15)
    # Design in tower-centred coordinates; translate geometry, not root transforms.
    shift = Vector((-7.0, 1.05, 0))

    def finish(mesh):
        mesh.vertices = [tuple(Vector(v) + shift) for v in mesh.vertices]
        return mesh.finish(root)

    main = Mesh("hq_tower")
    main.quad([(-12, -9, 0), (12, -9, 0), (12, -9, 42), (-12, -9, 42)], photo, FULL)
    main.quad(
        [(12, 9, 0), (-12, 9, 0), (-12, 9, 42), (12, 9, 42)],
        side,
        [(0, 0), (24 / 18, 0), (24 / 18, 1), (0, 1)],
    )
    main.quad([(12, -9, 0), (12, 9, 0), (12, 9, 42), (12, -9, 42)], side, FULL)
    main.quad([(-12, 9, 0), (-12, -9, 0), (-12, -9, 42), (-12, 9, 42)], side, FULL)
    main.quad([(-12, -9, 42), (12, -9, 42), (12, 9, 42), (-12, 9, 42)], roof, FULL)
    main.quad([(-12, 9, 0), (12, 9, 0), (12, -9, 0), (-12, -9, 0)], granite)
    finish(main)
    annex = Mesh("hq_staff_parking")
    annex.quad([(12, -9, 0), (26, -9, 0), (26, -9, 6), (12, -9, 6)], parking, FULL)
    annex.quad(
        [(26, -9, 0), (26, 9, 0), (26, 9, 6), (26, -9, 6)],
        side,
        [(0, 0), (1, 0), (1, 6 / 42), (0, 6 / 42)],
    )
    annex.quad(
        [(26, 9, 0), (12, 9, 0), (12, 9, 6), (26, 9, 6)],
        side,
        [(0, 0), (14 / 18, 0), (14 / 18, 6 / 42), (0, 6 / 42)],
    )
    annex.quad([(12, -9, 6), (26, -9, 6), (26, 9, 6), (12, 9, 6)], roof, FULL)
    annex.quad([(12, 9, 0), (26, 9, 0), (26, -9, 0), (12, -9, 0)], granite)
    parapet(annex, 19, 0, 14, 18, 6, granite, height=0.24)
    annex_obj = finish(annex)
    entrance = Mesh("hq_entrance_canopy_steps")
    entrance.box((0, -9.63, 9.85), (18.0, 1.3, 0.32), granite)
    for i in range(3):
        depth = 2.1 - i * 0.55
        entrance.box(
            (0, -9 - depth / 2, 0.075 + i * 0.15), (15.8, depth, 0.15), granite
        )
    canopy = finish(entrance)
    equipment = Mesh("hq_roof_parapet_units")
    parapet(equipment, 0, 0, 24, 18, 42, granite, height=0.45)
    equipment.box((-5, 3.6, 42.7), (4.1, 3.3, 1.4), metal)
    equipment.box((-5, 1.93, 42.53), (0.8, 0.035, 1.03), dark)
    for x, y in [(3, -1), (6, 2.6), (2.6, 4.9)]:
        equipment.box((x, y, 42.45), (2.4, 1.45, 0.9), metal)
        equipment.box((x, y, 42.915), (1.95, 1.05, 0.03), dark)
        for k in range(5):
            equipment.box((x - 0.8 + k * 0.4, y, 42.945), (0.07, 1.04, 0.03), metal)
    finish(equipment)
    cx = (470.5 / 941 - 0.5) * 24 + shift.x
    cz = (1 - 193.5 / 1672) * 42
    root["clockCentreBlender"] = [cx, -9 + shift.y - 0.055, cz]
    root["clockCentreGltf"] = [cx, cz, 9 - shift.y + 0.055]
    for name, length, width, y_offset in [
        ("clock_hour", 1.14, 0.21, 0.055),
        ("clock_minute", 1.64, 0.115, 0.10),
    ]:
        hand = Mesh(name)
        # Both object origins coincide; local normal offsets separate the thin blades.
        hand.box(
            (0, 0.055 - y_offset, (length - 0.15) / 2),
            (width, 0.026, length + 0.15),
            dark,
        )
        obj = hand.finish(root, (cx, -9 + shift.y - 0.055, cz))
        obj["clockPivotPixel"] = [470.5, 193.5]
        obj["rotationAxisGltf"] = [0, 0, 1]
    hub = Mesh("clock_hub")
    # A small square spindle, in the same dark finish, avoids an oversized clock boss.
    hub.box((cx, -9 + shift.y - 0.132, cz), (0.22, 0.025, 0.22), dark)
    hub.finish(root)
    export(root, out)
    if preview_dir:
        folder = Path(preview_dir).resolve()
        folder.mkdir(parents=True, exist_ok=True)
        camera = preview_setup()
        render(
            folder / "hq_three_quarter.png",
            camera,
            (69, -88, 62),
            (-1, 0, 21),
            57,
            (1000, 1000),
        )
        render(folder / "hq_top.png", camera, (0, 0, 110), (0, 0, 0), 43, (1000, 650))
        render(
            folder / "hq_back.png", camera, (0, 85, 21.7), (0, 1, 21.7), 45, (900, 1000)
        )
        render(
            folder / "hq_clock.png",
            camera,
            (cx, -30, cz),
            (cx, -8, cz),
            5.5,
            (800, 800),
        )
        # Orthographic reference views isolate the corresponding elevation only.
        saved = list(root.children_recursive)
        annex_obj.hide_render = True
        render(
            folder / "hq_front.png",
            camera,
            (-7, -85, 21.7),
            (-7, -8, 21.7),
            45,
            (600, 1000),
        )
        canopy.hide_render = True
        for obj in saved:
            if obj.name.startswith("clock_"):
                obj.hide_render = True
        render(
            folder / "hq_side.png",
            camera,
            (85, 1.05, 21.7),
            (0, 1.05, 21.7),
            45,
            (500, 1000),
        )
        for obj in saved:
            obj.hide_render = True
        annex_obj.hide_render = False
        render(
            folder / "hq_annex_front.png",
            camera,
            (12, -80, 3.1),
            (12, -8, 3.1),
            15.2,
            (1000, 460),
        )
        for obj in saved:
            obj.hide_render = False
        comparison(
            folder / "hq_comparison.png",
            [
                [
                    "ONTIME HOLDINGS / main tower: 24 x 42 m",
                    str(SOURCE / "O_01.png"),
                    str(folder / "hq_front.png"),
                    None,
                    24 / 42,
                ],
                [
                    "Tower side: 18 x 42 m / source intentionally mapped to assigned dimensions",
                    str(SOURCE / "O_03.png"),
                    str(folder / "hq_side.png"),
                    None,
                    18 / 42,
                ],
                [
                    "Staff car-park annex: 14 x 6 m",
                    str(SOURCE / "O_04.png"),
                    str(folder / "hq_annex_front.png"),
                    None,
                    14 / 6,
                ],
                [
                    "Clock / measured pivot (470.5, 193.5 px); independent hands at twelve",
                    str(SOURCE / "O_01.png"),
                    str(folder / "hq_clock.png"),
                    [363, 84, 578, 303],
                    1.0,
                ],
            ],
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=str(ASSETS / "gen/hq_r3.glb"))
    parser.add_argument("--preview-dir")
    parser.add_argument("--verify")
    parser.add_argument("--report")
    args = parser.parse_args(
        sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    )
    if args.verify:
        verify(args.verify, args.report)
    else:
        build(args.out, args.preview_dir)


if __name__ == "__main__":
    main()
