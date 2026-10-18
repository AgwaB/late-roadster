"""MAPLE VILLA: Round 3 photo-facade home with a real open pilotis.

  /opt/homebrew/bin/blender -b -P tools/blender/r3/villa.py -- --preview-dir research/raycity/r3-assets/buildings
  /opt/homebrew/bin/blender -b -P tools/blender/r3/villa.py -- --verify public/assets/gen/villa_r3.glb --report research/raycity/r3-assets/buildings/villa_verification.json

Defaults: public/assets/gen/villa_r3.glb, external HM_01/HM_02.webp, quality 88.
Requires adjacent hq.py (shared mesh/render/verification helpers) and system
Python 3 + Pillow. HM_01 is cropped only: (0,0,1086,1424), removing the outside
sidewalk. The upper front uses source rows 0..1146 (includes the complete MAPLE
VILLA plaque), by UVs into this cropped WebP. The photographed pilotis is NOT
pasted over the opening. HM_02 is a full-UV, inward-facing rear wall at y=+5.

Metres, Blender Z up, front -Y. Root (0,0,0) is the 12 x 10 m footprint centre.
bodyW/bodyD/bodyH = 12/10/14; roof parapet/equipment extend above bodyH. Ceiling
underside is exactly z=2.6; four 0.7 m square front columns at x=+-5.65,+-2.35
leave x=-2..2 entirely clear. Posts are set back 0.1 m from the upper facade;
rear wall is 10 m behind the facade. No entrance plane or middle post blocks
parking. Existing game wall:Bricks059 uses world UVs at 3 metres per repeat.
All images remain external; preview texture shaders are bound after export.
"""

import argparse
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy
from hq import (
    ASSETS,
    FULL,
    SOURCE,
    Mesh,
    comparison,
    export,
    material,
    parapet,
    prepare_textures,
    preview_setup,
    render,
    root_object,
    verify,
)

CROP_BOTTOM = 1424
UPPER_BOTTOM = 1146


def build(out, preview_dir=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    prepare_textures(["HM_01", "HM_02"], {"HM_01": [0, 0, 1086, CROP_BOTTOM]})
    root = root_object("villa_r3", (12.0, 10.0, 14.0))
    root["pilotisClearWidth"] = 4.0
    root["pilotisClearHeight"] = 2.6
    root["pilotisDepth"] = 10.0
    root["pilotisFrontBlenderY"] = -5.0
    root["pilotisRearBlenderY"] = 5.0
    root["pilotisClearX"] = [-2.0, 2.0]
    root["facadeSourceCrop"] = [0, 0, 1086, CROP_BOTTOM]
    root["facadeUpperSourceRows"] = [0, UPPER_BOTTOM]
    photo = material("photo:HM_01")
    inside = material("photo:HM_02")
    brick = material("wall:Bricks059", (0.5, 0.26, 0.16))
    concrete = material("wall:Concrete034", (0.58, 0.57, 0.53))
    roof = material("roof:F_01", (0.45, 0.45, 0.43))
    dark = material("details:charcoal", (0.055, 0.06, 0.065), 0.8)
    ochre = material("pilotis:safety_ochre", (0.84, 0.57, 0.13), 0.75)
    # Upper floors are a true slab sitting above a hollow ground floor.
    upper = Mesh("villa_upper_floors")
    v0 = 1 - UPPER_BOTTOM / CROP_BOTTOM
    upper.quad(
        [(-6, -5, 2.6), (6, -5, 2.6), (6, -5, 14), (-6, -5, 14)],
        photo,
        [(0, v0), (1, v0), (1, 1), (0, 1)],
    )
    upper.quad([(6, 5, 2.6), (-6, 5, 2.6), (-6, 5, 14), (6, 5, 14)], brick)
    upper.quad([(6, -5, 2.6), (6, 5, 2.6), (6, 5, 14), (6, -5, 14)], brick)
    upper.quad([(-6, 5, 2.6), (-6, -5, 2.6), (-6, -5, 14), (-6, 5, 14)], brick)
    upper.quad([(-6, -5, 14), (6, -5, 14), (6, 5, 14), (-6, 5, 14)], roof, FULL)
    # The structural ceiling has actual thickness, not a facade over a solid box.
    upper.quad([(-6, 5, 2.85), (6, 5, 2.85), (6, -5, 2.85), (-6, -5, 2.85)], concrete)
    upper.finish(root)
    slab = Mesh("villa_pilotis_ceiling")
    slab.box((0, 0, 2.725), (11.98, 9.98, 0.25), concrete)
    slab.finish(root)
    posts = Mesh("villa_pilotis_columns")
    for x in (-5.65, -2.35, 2.35, 5.65):
        posts.box((x, -4.55, 1.3), (0.7, 0.7, 2.6), concrete)
        # Recessed front posts permit protective guards without increasing footprint.
        for edge in (-1, 1):
            for j in range(5):
                posts.box(
                    (x + edge * 0.275, -4.94, 0.35 + j * 0.2),
                    (0.09, 0.06, 0.2),
                    ochre if j % 2 == 0 else dark,
                )
    posts.finish(root)
    walls = Mesh("villa_pilotis_side_walls")
    # Outer brick surfaces, inner concrete returns, and front reveals.
    for sign in (-1, 1):
        x0, x1 = (5.82, 6.0) if sign > 0 else (-6.0, -5.82)
        faces = [concrete] * 6
        faces[2 if sign > 0 else 3] = brick
        # Side walls start behind the corner posts: no overlapping coplanar skins.
        walls.box(
            ((x0 + x1) / 2, 0.4, 1.3), (0.18, 9.2, 2.6), concrete, face_materials=faces
        )
    # Back-to-back single-sided surfaces: correct facade outside, reference inside.
    walls.quad([(6, 5, 0), (-6, 5, 0), (-6, 5, 2.6), (6, 5, 2.6)], brick)
    walls.finish(root)
    rear = Mesh("villa_pilotis_rear_photo")
    rear.quad(
        [(-5.82, 5, 0), (5.82, 5, 0), (5.82, 5, 2.6), (-5.82, 5, 2.6)], inside, FULL
    )
    rear.finish(root)
    floor = Mesh("villa_pilotis_floor_markings")
    floor.quad([(-6, -5, 0), (6, -5, 0), (6, 5, 0), (-6, 5, 0)], concrete)
    # Light markings share concrete; dark floor bays provide line contrast.
    for a, b in [(-5.4, -2.03), (-1.97, 1.97), (2.03, 5.4)]:
        floor.quad(
            [(a, -4.95, 0.003), (b, -4.95, 0.003), (b, 4.7, 0.003), (a, 4.7, 0.003)],
            dark,
        )
    # Side-bay stops only; the central 4 m approach stays free of obstacles.
    for x in (-3.7, 3.7):
        floor.box((x, 4.15, 0.075), (1.25, 0.24, 0.15), concrete)
        floor.box((x, 4.02, 0.085), (0.19, 0.02, 0.055), ochre)
    floor.finish(root)
    equipment = Mesh("villa_roof_parapet_units")
    parapet(equipment, 0, 0, 12, 10, 14, concrete, height=0.35, thickness=0.18)
    equipment.box((-3, 2.4, 14.55), (2.3, 2.4, 1.1), brick)
    equipment.box((-3, 2.4, 15.11), (2.3, 2.4, 0.02), concrete)
    equipment.box((-3, 1.18, 14.45), (0.65, 0.035, 0.9), dark)
    for x, y in [(2, 1.2), (3.7, 2.5)]:
        equipment.box((x, y, 14.24), (1.1, 0.7, 0.48), concrete)
        equipment.box((x, y, 14.49), (0.86, 0.5, 0.02), dark)
    equipment.finish(root)
    export(root, out)
    if preview_dir:
        folder = Path(preview_dir).resolve()
        folder.mkdir(parents=True, exist_ok=True)
        camera = preview_setup()
        render(
            folder / "villa_three_quarter.png",
            camera,
            (26, -34, 22),
            (0, 0, 6.8),
            20,
            (1000, 1000),
        )
        render(
            folder / "villa_front.png",
            camera,
            (0, -50, 7.4),
            (0, -5, 7.4),
            16.1,
            (820, 1000),
        )
        render(
            folder / "villa_side.png",
            camera,
            (45, 0, 7.4),
            (0, 0, 7.4),
            16.1,
            (720, 1000),
        )
        render(folder / "villa_top.png", camera, (0, 0, 55), (0, 0, 0), 14, (1000, 850))
        render(
            folder / "villa_pilotis.png",
            camera,
            (0, -22, 1.25),
            (0, 4, 1.25),
            12.8,
            (1000, 330),
        )
        # A low perspective view also reveals that the ten-metre pilotis is hollow.
        camera.data.type = "PERSP"
        camera.data.lens = 25
        render(
            folder / "villa_pilotis_inside.png",
            camera,
            (-1.15, -4.0, 1.15),
            (0.3, 5, 1.3),
            12.8,
            (1000, 620),
        )
        comparison(
            folder / "villa_comparison.png",
            [
                [
                    "MAPLE VILLA / 12 x 14 m body; actual open pilotis replaces the printed base",
                    str(SOURCE / "HM_01.png"),
                    str(folder / "villa_front.png"),
                    [0, 0, 1086, CROP_BOTTOM],
                    12 / 14,
                ],
                [
                    "Pilotis / 2.6 m headroom, 4 m middle bay, rear image 10 m behind facade",
                    str(SOURCE / "HM_02.png"),
                    str(folder / "villa_pilotis.png"),
                    None,
                    12 / 2.6,
                ],
            ],
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=str(ASSETS / "gen/villa_r3.glb"))
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
