"""Round-4 2D textures for Late Roadster; Pillow + numpy, no Blender.

Run from any directory: python3 /path/to/repo/tools/r4_textures_tiles.py
Only writes the six named WebPs and tiles_*.png / tiles_report.md previews.
Source PNGs are never modified. Coordinates are zero-based, top-left origin;
boxes/ranges are half-open. Tile previews use the actual decoded WebP assets;
explicitly named key-art inspection/before panels show the original source.
"""

from hashlib import sha256
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, features

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "research/raycity/generated/2026-10-18-round4"
DST = ROOT / "public/assets/photo"
PREVIEW = ROOT / "research/raycity/r4-assets/textures"
WIDTH = 2048
SIZES = {
    "TC_01": (1916, 821),
    "TW_01": (1915, 821),
    "MT_01": (1915, 821),
    "CR_01": (1254, 1254),
    "KA_01": (1672, 941),
}
MT_CROP = (0, 11, 1915, 796)
MT_DOORS = (483, 1005)  # Complete door assembly, including fixed sidelights.
MT_SLIDERS = (605, 878)  # The two active central sliding leaves.
# Tiny unidentified badge-like marks, not assertions of any particular brand.
# Parked-car boxes also cover the associated center light-bar badge/tick.
BADGES = [
    ("parked black car", (337, 764, 352, 783)),
    ("parked blue car", (583, 771, 599, 790)),
    ("parked silver car", (830, 772, 846, 790)),
    ("parked green SUV", (1108, 743, 1124, 769)),
    ("parked dark right car", (1377, 765, 1393, 786)),
    ("airborne silver nose", (752, 208, 766, 223)),
]


def rgb(array):
    """Round rather than truncate floating-point image computations."""
    return Image.fromarray(np.clip(np.rint(array), 0, 255).astype(np.uint8))


def load(name):
    with Image.open(SRC / f"{name}.png") as image:
        assert image.size == SIZES[name], f"Reinspect changed source: {name}"
        return image.convert("RGB")


def smoothstep(value):
    value = np.clip(value, 0, 1)
    return value * value * (3 - 2 * value)


def match_edge_columns(image, reach=6):
    """Equal endpoint columns, with a short, smooth additive color correction.

    This is only the final pixel-level polish, NOT the structural seam repair.
    Averages endpoints, not entire edge bands; no mirrored/doubled features.
    """
    array = np.asarray(image, dtype=np.float32).copy()
    delta = (array[:, -1] - array[:, 0]) / 2
    weight = (1 - smoothstep(np.linspace(0, 1, reach)))[None, :, None]
    array[:, :reach] += delta[:, None, :] * weight
    array[:, -reach:] -= delta[:, None, :] * weight[:, ::-1]
    return rgb(array)


def minimum_cut(cost):
    """Top-to-bottom minimum-error quilt cut, at most two pixels per row."""
    height, width = cost.shape
    score = cost[0].copy()
    trace = np.zeros((height, width), dtype=np.int8)
    shifts = np.arange(-2, 3)
    columns = np.arange(width)
    for row in range(1, height):
        choices = np.stack(
            [np.roll(score, shift) + 0.4 * abs(shift) for shift in shifts]
        )
        # Exclude rolled/wrapped DP entries, and force a genuine interior cut.
        choices[:, :8] = choices[:, -8:] = 1e9
        chosen = choices.argmin(axis=0)
        trace[row] = shifts[chosen]
        score = cost[row] + choices[chosen, columns]
    path = np.zeros(height, dtype=np.int32)
    path[-1] = score.argmin()
    for row in range(height - 1, 0, -1):
        path[row - 1] = path[row] - trace[row, path[row]]
    return path


def quilt_horizontal(image, overlap, protected_rows, texture_feather):
    """Overlap by a measured motif period, then cut rather than double-expose.

    Dashes/hazard paint remain single-source except a two-pixel cut antialias.
    Only unmarked concrete/grime gets a wider local blend. Neither the arrows,
    CEILING LANE stencil nor the SOS/exit signs intersects this edge repair.
    """
    array = np.asarray(image, dtype=np.float32)
    height, width, _ = array.shape
    right, left = array[:, -overlap:], array[:, :overlap]
    cost = np.abs(right - left).mean(axis=2)
    right_gradient = np.diff(right, axis=1, prepend=right[:, :1])
    left_gradient = np.diff(left, axis=1, prepend=left[:, :1])
    cost += 0.4 * np.abs(right_gradient - left_gradient).mean(axis=2)
    cost[:, :12] = cost[:, -12:] = 1e6
    path = minimum_cut(cost)
    feather = np.full(height, texture_feather, dtype=np.float32)
    for first, last in protected_rows:
        feather[first:last] = 1
    distance = np.arange(overlap)[None, :] - path[:, None]
    mask = smoothstep((distance / feather[:, None] + 1) / 2)[..., None]
    # Ensure the quilt joins unmodified source pixels at both overlap ends.
    mask[:, 0] = 0
    mask[:, -1] = 1
    quilt = right * (1 - mask) + left * mask
    tile = np.concatenate((quilt, array[:, overlap : width - overlap]), axis=1)
    # Put the repair around the wrap boundary, keeping the subject centered.
    return rgb(np.roll(tile, -(overlap // 2), axis=1))


def ceiling_lights(source, width):
    """Rephase the ten existing fixtures as one periodic row, without cloning.

    Their generated pitch was irregular and not commensurate with the dashes.
    A monotone 1D map aligns the ten original fixture centers to a uniform
    period. No fixture is mirrored, pasted twice or blended with another.
    Only the top/bottom strips of this mapped image are used below.
    """
    source = match_edge_columns(source, reach=24)
    array = np.asarray(source, dtype=np.float32)
    source_width = source.width
    centers = np.array([76, 275, 476, 677, 878, 1040, 1242, 1441, 1641, 1839])
    pitch = source_width / len(centers)
    target = 76 + np.arange(-1, len(centers) + 1) * pitch
    original = np.r_[centers[-1] - source_width, centers, centers[0] + source_width]
    x = np.interp(np.arange(source_width), target, original)
    x0 = np.floor(x).astype(np.int32)
    fraction = (x - x0)[None, :, None]
    mapped = array[:, x0 % source_width] * (1 - fraction)
    mapped += array[:, (x0 + 1) % source_width] * fraction
    return rgb(mapped).resize((width, source.height), Image.Resampling.LANCZOS)


def make_ceiling(source):
    # 404 native pixels align the six ~152-pixel dash periods and provide
    # enough overlap for a cut along the skid curves (101/253 did not).
    protected = [
        (123, 136),
        (214, 228),
        (297, 310),
        (386, 421),
        (525, 539),
        (613, 627),
        (696, 710),
    ]
    tile = quilt_horizontal(source, 404, protected, texture_feather=28)
    lights = np.asarray(ceiling_lights(source, tile.width), dtype=np.float32)
    body = np.asarray(tile, dtype=np.float32)
    y = np.arange(source.height)
    # All luminous panels/cable trays are fully single-source. Feather only
    # the plain concrete between the lights and the nearest dashed lane row.
    top = 1 - smoothstep((y - 62) / 44)
    bottom = smoothstep((y - 722) / 28)
    mask = np.maximum(top, bottom)[:, None, None]
    return rgb(lights * mask + body * (1 - mask))


def make_wall(source):
    # 255 native pixels align the diagonal hazard-stripe phase. The DP cut
    # threads the dark gap between fittings and the ordinary tile grout.
    return quilt_horizontal(source, 255, [(58, 136), (633, 672)], 4)


def save_webp(name, image, quality):
    path = DST / f"{name}.webp"
    image.convert("RGB").save(path, "WEBP", quality=quality, method=6)
    with Image.open(path) as decoded:
        assert decoded.mode == "RGB" and decoded.format == "WEBP"
        result = decoded.copy()
    print(
        f"{path.relative_to(ROOT)}: {result.width}x{result.height} RGB, "
        f"q{quality}, {path.stat().st_size:,} bytes"
    )
    return result


def seam_metrics(image):
    array = np.asarray(image, dtype=np.float32)
    seam = np.abs(array[:, -1] - array[:, 0])
    # A seam should be no more conspicuous than normal adjacent columns.
    adjacent = np.abs(array[:, 1:] - array[:, :-1]).mean(axis=(0, 2))
    return {
        "mae": seam.mean().item(),
        "max": seam.max().item(),
        "adjacent_median": np.median(adjacent).item(),
        "adjacent_p95": np.percentile(adjacent, 95).item(),
    }


def tile_previews(name, image):
    triple = Image.new("RGB", (image.width * 3, image.height))
    for index in range(3):
        triple.paste(image, (index * image.width, 0))
    triple.save(PREVIEW / f"tiles_{name}_3x.png")
    # Native resolution, small enough not to be downsampled by image viewers.
    for index in (1, 2):
        x = index * image.width
        triple.crop((x - 384, 0, x + 384, image.height)).save(
            PREVIEW / f"tiles_{name}_seam{index}_100.png"
        )
    return triple.resize((2048, round(image.height / 3)), Image.Resampling.LANCZOS)


def paint_badges(source):
    """Local horizontal inpainting with a soft perimeter, not a blur of logos.

    For each scanline, fit the body color between two nearby clean columns.
    This also continues the straight LED light bar instead of smearing it.
    The complete emblem is replaced; only a three-pixel perimeter is blended.
    """
    original = np.asarray(source, dtype=np.float32)
    result = original.copy()
    for _, (x0, y0, x1, y1) in BADGES:
        height, width = y1 - y0, x1 - x0
        left = original[y0:y1, x0 - 3 : x0].mean(axis=1)
        right = original[y0:y1, x1 : x1 + 3].mean(axis=1)
        fraction = np.linspace(0, 1, width)[None, :, None]
        fill = left[:, None] * (1 - fraction) + right[:, None] * fraction
        xx, yy = np.meshgrid(np.arange(width), np.arange(height))
        edge = np.minimum.reduce((xx, width - 1 - xx, yy, height - 1 - yy))
        mask = smoothstep(edge / 3)[..., None]
        result[y0:y1, x0:x1] = original[y0:y1, x0:x1] * (1 - mask) + fill * mask
    return rgb(result)


def key_art_previews(before, after):
    boxes = {
        "cars": (240, 670, 1480, 855),
        "flying": (680, 80, 1170, 390),
        "skyline": (0, 425, 1000, 680),
        "buildings": (1120, 0, 1672, 670),
    }
    for name, box in boxes.items():
        before.crop(box).save(PREVIEW / f"tiles_KA_inspect_{name}.png")
    # Source vs decoded delivery at 6x nearest-neighbor, all six edits.
    sheet = Image.new("RGB", (672, 6 * 148), (25, 25, 25))
    draw = ImageDraw.Draw(sheet)
    for index, (label, box) in enumerate(BADGES):
        x0, y0, x1, y1 = box
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        crop = (cx - 27, cy - 10, cx + 27, cy + 10)
        for column, image in enumerate((before, after)):
            patch = image.crop(crop).resize((324, 120), Image.Resampling.NEAREST)
            sheet.paste(patch, (column * 336, index * 148 + 24))
        draw.text((0, index * 148 + 5), f"{label}: source | cleaned WebP", fill="white")
    sheet.save(PREVIEW / "tiles_KA_badges_before_after.png")
    after.save(PREVIEW / "tiles_KA_clean.png")


def coordinate_previews(ceiling, wall, mart):
    annotations = [
        (
            "TC_rows",
            ceiling,
            [
                (138, "dash 1"),
                (236, "dash 2"),
                (324, "dash 3"),
                (568, "dash 4"),
                (663, "dash 5"),
                (750, "dash 6"),
                (421, "yellow upper"),
                (441, "yellow lower"),
                (39, "upper lights"),
                (820, "lower lights"),
            ],
        ),
        (
            "TW_rows",
            wall,
            [
                (97, "lights"),
                (681, "hazard top"),
                (714, "kerb top / hazard bottom"),
                (877, "kerb bottom"),
            ],
        ),
    ]
    for name, image, rows in annotations:
        preview = image.copy()
        draw = ImageDraw.Draw(preview)
        for row, label in rows:
            draw.line((0, row, image.width - 1, row), fill=(0, 255, 200))
            draw.text((12, max(0, row - 12)), f"y={row} {label}", fill=(255, 100, 255))
        preview.save(PREVIEW / f"tiles_{name}.png")
    preview = mart.copy()
    draw = ImageDraw.Draw(preview)
    for bounds, color in [(MT_DOORS, (0, 255, 220)), (MT_SLIDERS, (255, 80, 255))]:
        for coordinate in bounds:
            x = round(coordinate * WIDTH / 1915)
            draw.line((x, 460, x, mart.height - 1), fill=color, width=2)
    preview.save(PREVIEW / "tiles_MT_crop_doors.png")


def report(assets, seam_stats):
    lines = [
        "# Round-4 2D textures — Late Roadster",
        "",
        "Reproduce: `python3 tools/r4_textures_tiles.py` (Python 3, Pillow + numpy).",
        "No Blender, network access, game-code changes or source-image edits.",
        "",
        "All coordinates below use decoded output pixels, zero-based from the top-left.",
        "Boxes and x/y bands are half-open; row centers are approximate to ±2 px.",
        "Do not flip/rotate these images: tunnel travel is horizontal.",
        "",
        "## Delivered files",
        "",
        "| File in `public/assets/photo/` | Pixels | Format | Quality | Bytes |",
        "|---|---:|---|---:|---:|",
    ]
    for name, quality, image in assets:
        size = (DST / f"{name}.webp").stat().st_size
        lines.append(
            f"| {name}.webp | {image.width}×{image.height} | RGB WebP | {quality} | {size:,} |"
        )
    lines += [
        "",
        "## TC_01: ceiling lane mapping",
        "",
        "Output: **2048×878**. Source: 1916×821; no vertical crop or rotation.",
        "- Dashed divider row centers: **138, 236, 324, 568, 663, 750**.",
        "  Approximate paint bands: [134,144), [231,243), [318,330),",
        "  [563,575), [657,669), [745,757). Three above / three below the center.",
        "- Double yellow: upper **421**, lower **441**; median center **431**.",
        "  Approximate paint bands: [416,428), [436,448).",
        "- Light-fixture row centers: upper **39**, lower **820**.",
        "  Bright-panel bands approximately [32,47) and [814,828).",
        "- Ten fixtures per row, six intact dash rows, four original arrows, one",
        "  CEILING LANE stencil. Arrows still point left above / right below.",
        "- Native 404-pixel overlap aligns the dash period and skid curves.",
        "  A dynamic-programming minimum-error cut selects one source at a time;",
        "  paint gets only 2 px of cut antialiasing. Unmarked concrete/skid grime",
        "  gets up to 56 px",
        "  of localized feathering. No full-image crossfade, mirror or rotation.",
        "- The generated lamp pitch differs from the dash pitch. A separate",
        "  monotone horizontal remap places the ten ORIGINAL fixtures at a",
        "  regular periodic pitch (204.8 output px), without cloning/doubling",
        "  lamps. Top/bottom strips join the body only in unmarked concrete.",
        "- Quilt width is 1512 before fitting back to the original canvas aspect",
        "  at 2048×878. Horizontal motif spacing is rephased (~26.7% body stretch",
        "  relative to a uniform source resize); vertical lane geometry is unchanged.",
        "",
        "## TW_01: wall mapping",
        "",
        "Output: **2048×878**. Source: 1915×821; no vertical crop or rotation.",
        "- Light strip center **97**; bright panels approximately [86,108).",
        "  Fittings/tray assembly occupies approximately [61,145).",
        "- Hazard stripe band **[681,714)**; center **697**.",
        "- Concrete kerb top / stripe bottom: **714**. Kerb continues to the",
        "  bottom edge: last pixel row **877**, geometric boundary **878**.",
        "  There is no separate asphalt/floor strip in this corrected source.",
        "- Native 255-pixel overlap phase-matches the diagonal hazard stripes.",
        "  Minimum-error cut runs through the light gaps / wall material, with",
        "  a 2-pixel cut antialias on fixtures and paint, 8 px on plain material.",
        "  Quilt width 1660 is fitted to original canvas aspect (15.4% horizontal",
        "  rephase versus uniform resize). Single SOS cabinet and single exit sign",
        "  remain untouched and are NOT copied into the repair overlap.",
        "",
        "## Seam validation and previews",
        "",
        "A final six-column tapered additive correction makes pre-encode first",
        "and last RGB columns exactly equal. WebP q85 is lossy, so decoded columns",
        "are not asserted bit-identical. Measured differences on the actual delivery:",
        "",
        "| Tile | Before WebP edge MAE | Decoded edge MAE / max | Ordinary adjacent-column MAE median / p95 |",
        "|---|---:|---:|---:|",
    ]
    for name, metrics in seam_stats.items():
        lines.append(
            f"| {name} | 0.000 | {metrics['mae']:.3f} / {metrics['max']:.0f} | "
            f"{metrics['adjacent_median']:.3f} / {metrics['adjacent_p95']:.3f} |"
        )
    lines += [
        "",
        "- `tiles_TC_01_3x.png` and `tiles_TW_01_3x.png`: **6144×878** each;",
        "  exactly three decoded tiles side-by-side. Wraps at x=2048 and x=4096.",
        "- `tiles_*_seam1_100.png` / `tiles_*_seam2_100.png`: **768×878** each;",
        "  native-resolution crops around both wraps, with no guide lines hiding them.",
        "- `tiles_repeat_sheet.png`: compact comparison, not a substitute for 100% checks.",
        "- `tiles_TC_rows.png`, `tiles_TW_rows.png`: guide overlays, not game textures.",
        "",
        "## MT_01 facade",
        "",
        "- Native crop box: **(0, 11, 1915, 796)**, size 1915×785.",
        "- Removes the top 11-pixel grey cap strip and bottom 25-pixel grey",
        "  floor/base strip. Side edges are facade cladding, not background.",
        "- Output **2048×840** (cropped aspect retained).",
        "- Full doorway assembly incl. fixed sidelights: source x **[483,1005)**,",
        "  output x **[517,1075)**. Active central sliding leaves: source",
        "  x **[605,878)**, output x **[647,939)**.",
        "- `tiles_MT_crop_doors.png`: cyan = assembly; magenta = active sliders.",
        "- Existing store interior/corral depth cues remain; this is not a",
        "  geometrically rectified or surveyed orthographic building elevation.",
        "",
        "## CR_01 carton",
        "",
        "- No white/background border: crop **(0,0,1254,1254)** (full image).",
        "- Original crushed cardboard edges preserved; resized to **1024×1024**.",
        "",
        "## KA_01 logo / badge inspection",
        "",
        "Inspected native 1672×941 image plus native-resolution car, airborne-car,",
        "skyline and building crops. Six tiny badge-like hood/nose marks are visible;",
        "their shapes are not sufficient to identify a real-world brand. Removed",
        "conservatively, including the associated central light-bar ticks on parked",
        "cars, using scanline color interpolation from adjacent clean bodywork and",
        "a soft 3-pixel perimeter. No recognizable building logos, wheel-hub glyphs",
        "or other readable real-world marks found. This is visual inspection, not",
        "OCR, trademark search or an assertion that the vehicle designs are unbranded.",
        "",
        "Native/output-full edit boxes (left, top, right, bottom):",
        "",
    ]
    for label, box in BADGES:
        lines.append(f"- {label}: **{box}**.")
    lines += [
        "",
        "`tiles_KA_badges_before_after.png` shows source versus decoded q82",
        "closeups at 6× nearest-neighbor. `tiles_KA_inspect_*.png` are source",
        "inspection crops; they intentionally retain the original marks for audit.",
        "`tiles_KA_clean.png` is the final decoded full-size image.",
        "Full delivery: **1672×941 q82**. Small: **960×540 q80**, derived from",
        "the cleaned RGB master, not recompressed from the full-size WebP.",
        "",
        "## Review / limitations",
        "",
        "The initial all-in-one ceiling quilt made uneven/near-double lamp spacing;",
        "it was rejected in favor of the separate fixture rephase. Narrower 101/253",
        "pixel body overlaps left broken skid curves; a 404 px cut resolved these.",
        "Final three-tile sheets and native seam crops were visually reviewed at",
        "100%: no visible wrap discontinuity, cut lane/stripe or doubled lamp.",
        "Lossy WebP introduces small normal codec differences (table above);",
        "exact decoded edge identity",
        "is not promised. Source concrete/grime, approximate generated lane spacing,",
        "and facade perspective cues remain. Repetition of the intentional stencil",
        "and single SOS/exit pair once per tile is expected. No browser UV/mipmap",
        "integration was tested; use horizontal RepeatWrapping without atlas gutters.",
        "",
        "## Source integrity",
        "",
        "Only the following read-only generated inputs were consumed (SHA-256):",
        "",
    ]
    for name in SIZES:
        digest = sha256((SRC / f"{name}.png").read_bytes()).hexdigest()
        lines.append(f"- `{name}.png`: `{digest}`")
    lines += [
        "",
        f"Pillow/libwebp encoder: `{features.version('webp')}`. Deterministic",
        "within the same Pillow/libwebp toolchain; codec versions may change bytes.",
        "",
    ]
    (PREVIEW / "tiles_report.md").write_text("\n".join(lines), encoding="utf-8")


def main():
    DST.mkdir(parents=True, exist_ok=True)
    PREVIEW.mkdir(parents=True, exist_ok=True)
    assets, seam_stats, strips = [], {}, []
    for name, maker in (("TC_01", make_ceiling), ("TW_01", make_wall)):
        source = load(name)
        image = maker(source).resize(
            (WIDTH, round(source.height * WIDTH / source.width)),
            Image.Resampling.LANCZOS,
        )
        image = match_edge_columns(image)
        assert np.array_equal(np.asarray(image)[:, 0], np.asarray(image)[:, -1])
        decoded = save_webp(name, image, 85)
        metrics = seam_metrics(decoded)
        assert metrics["mae"] < metrics["adjacent_p95"], metrics
        seam_stats[name] = metrics
        strips.append(tile_previews(name, decoded))
        assets.append((name, 85, decoded))
    sheet = Image.new(
        "RGB", (2048, sum(strip.height + 24 for strip in strips)), "#202020"
    )
    y = 0
    for label, strip in zip(
        ("TC_01: three tiles", "TW_01: three tiles"), strips, strict=True
    ):
        ImageDraw.Draw(sheet).text((8, y + 6), label, fill="white")
        sheet.paste(strip, (0, y + 24))
        y += strip.height + 24
    sheet.save(PREVIEW / "tiles_repeat_sheet.png")
    mart = load("MT_01").crop(MT_CROP)
    mart = mart.resize(
        (WIDTH, round(mart.height * WIDTH / mart.width)), Image.Resampling.LANCZOS
    )
    mart = save_webp("MT_01", mart, 85)
    assets.append(("MT_01", 85, mart))
    cargo = save_webp(
        "CR_01", load("CR_01").resize((1024, 1024), Image.Resampling.LANCZOS), 85
    )
    assets.append(("CR_01", 85, cargo))
    cargo.save(PREVIEW / "tiles_CR_face.png")
    source = load("KA_01")
    cleaned = paint_badges(source)
    full = save_webp("KA_01", cleaned, 82)
    small = save_webp(
        "KA_01_sm",
        cleaned.resize(
            (960, round(source.height * 960 / source.width)), Image.Resampling.LANCZOS
        ),
        80,
    )
    assets.extend((("KA_01", 82, full), ("KA_01_sm", 80, small)))
    key_art_previews(source, full)
    coordinate_previews(assets[0][2], assets[1][2], mart)
    report(assets, seam_stats)
    print(f"Report: {(PREVIEW / 'tiles_report.md').relative_to(ROOT)}")
    for name, metrics in seam_stats.items():
        print(name, "decoded seam metrics:", metrics)


if __name__ == "__main__":
    main()
