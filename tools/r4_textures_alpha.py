"""Round-4 2D alpha decals, without Blender or game-code changes.

Run from any directory: python3 tools/r4_textures_alpha.py
Requires Pillow, numpy, scipy. Inputs are read-only round-4 PNGs. Writes ONLY
public/assets/photo/{WR_01,WR_02,PH_01,LP_01}.webp and alpha_*.png/alpha_report.md
in research/raycity/r4-assets/textures/. All noise uses fixed random seeds.

White-keying is BORDER-CONNECTED, not a global luminance mask: enclosed white
render and glass highlights, and the black hole interiors, remain opaque.
The inspection sheets composite the DECODED q88 WebPs (not pre-encode images).
"""

from hashlib import sha256
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from PIL import __version__ as pillow_version
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "research/raycity/generated/2026-10-18-round4"
OUTPUT = ROOT / "public/assets/photo"
PREVIEW = ROOT / "research/raycity/r4-assets/textures"
IDS = ("WR_01", "WR_02", "PH_01", "LP_01")
SIZE = 1024


def require(condition, message):
    """Keep asset acceptance checks active even with Python's -O flag."""
    if not condition:
        raise ValueError(message)


def bbox(mask):
    """Exclusive-right/bottom xyxy bounds, in pixel-index coordinates."""
    yy, xx = np.where(mask)
    require(xx.size > 0, "Cannot report the bounds of an empty mask")
    return [xx.min().item(), yy.min().item(), xx.max().item() + 1, yy.max().item() + 1]


def smoothstep(value):
    value = np.clip(value, 0, 1)
    return value * value * (3 - 2 * value)


def rgba_image(rgb, alpha):
    return Image.fromarray(
        np.dstack(
            (
                np.uint8(np.clip(rgb, 0, 255) + 0.5),
                np.uint8(np.clip(alpha, 0, 1) * 255 + 0.5),
            )
        )
    )


def bleed_transparent_rgb(image):
    """Restore colour dilation AFTER premultiplied resizing zeroes hidden RGB."""
    pixels = np.array(image)
    alpha = pixels[..., 3]
    _, nearest = ndi.distance_transform_edt(alpha < 128, return_indices=True)
    foreground = pixels[nearest[0], nearest[1], :3]
    pixels[alpha == 0, :3] = foreground[alpha == 0]
    return Image.fromarray(pixels)


def connected_background(rgb):
    """Flood tolerant near-white from all four borders; never seed interior whites."""
    low = rgb.min(axis=2)
    white = (low >= 244) & (np.ptp(rgb, axis=2) <= 12)
    seed = np.zeros_like(white)
    seed[0], seed[-1] = white[0], white[-1]
    seed[:, 0], seed[:, -1] = white[:, 0], white[:, -1]
    background = ndi.binary_propagation(seed, mask=white)
    return background, white & ~background


def central_black(rgb):
    """The connected near-black interior containing the centre (not all shadows)."""
    labels, _ = ndi.label(rgb.max(axis=2) <= 24)
    label = labels[rgb.shape[0] // 2, rgb.shape[1] // 2]
    if not label:
        raise ValueError("Expected an opaque near-black hole at the image centre")
    return labels == label


def key_wall(image):
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    background, protected_white = connected_background(rgb)
    solid = ~background
    inside = ndi.distance_transform_edt(solid)
    outside = ndi.distance_transform_edt(background)
    # 2.5 native pixels = 2.04 output pixels. Thin fragments need their own core,
    # rather than borrowing unrelated colour from the large facade next to them.
    core = inside >= 2.5
    labels, count = ndi.label(solid)
    for label, slices in enumerate(ndi.find_objects(labels), 1):
        if slices is None:
            continue
        part = labels[slices] == label
        if not np.any(core[slices] & part):
            distances = np.where(part, inside[slices], 0)
            core[slices] |= part & (distances >= distances.max())
    _, nearest = ndi.distance_transform_edt(~core, return_indices=True)
    foreground = rgb[nearest[0], nearest[1]]
    # Background is off-white (usually 254), not exactly 255. Estimate it only
    # from far-away flood-connected samples, never from the pale render itself.
    white_rgb = np.median(rgb[outside > 8], axis=0)
    difference = white_rgb - foreground
    denominator = np.sum(difference * difference, axis=2)
    fitted = np.sum((white_rgb - rgb) * difference, axis=2)
    fitted = np.clip(fitted / np.maximum(denominator, 48), 0, 1)
    band = (inside < 2.5) & (outside <= 2.0)
    alpha = solid.astype(np.float32)
    alpha[band] = fitted[band]
    alpha[alpha < 0.025] = 0
    alpha[protected_white] = 1
    hole = central_black(rgb)
    alpha[hole] = 1
    # Unmix the white matte, then stabilise very low-coverage RGB with the nearby
    # opaque foreground. Bleed foreground into zero-alpha pixels for filtering.
    unmixed = (rgb - (1 - alpha[..., None]) * white_rgb) / np.maximum(
        alpha[..., None], 0.035
    )
    confidence = smoothstep((alpha - 0.1) / 0.55)[..., None]
    clean_edge = unmixed * confidence + foreground * (1 - confidence)
    colour = rgb.copy()
    edge = band & (alpha < 0.995)
    colour[edge] = clean_edge[edge]
    colour[alpha == 0] = foreground[alpha == 0]
    require(np.all(alpha[hole] == 1), "Wall black interior lost opacity")
    require(np.all(alpha[protected_white] == 1), "Enclosed white detail lost opacity")
    rgba = rgba_image(colour, alpha).resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    rgba = bleed_transparent_rgb(rgba)
    metadata = {
        "matte_rgb": white_rgb.tolist(),
        "native_protected_white_pixels": protected_white.sum().item(),
        "native_black_bbox": bbox(hole),
        "native_connected_background_pixels": background.sum().item(),
        "native_fragment_components": count,
    }
    # Nearest-resampled masks are valid for testing interiors after WebP encoding;
    # erosion excludes pixels that intentionally receive resampling coverage.
    metadata["protected_test_mask"] = (
        np.asarray(
            Image.fromarray(np.uint8(protected_white & (inside >= 6)) * 255).resize(
                (SIZE, SIZE), Image.Resampling.NEAREST
            )
        )
        > 0
    )
    metadata["black_test_mask"] = (
        np.asarray(
            Image.fromarray(
                np.uint8(ndi.binary_erosion(hole, iterations=2)) * 255
            ).resize((SIZE, SIZE), Image.Resampling.NEAREST)
        )
        > 0
    )
    return rgba, metadata


def fit_circle(image):
    """Fit subpixel silhouette crossings, excluding canvas-clipped cardinal arcs."""
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    h, w = rgb.shape[:2]
    background, _ = connected_background(rgb)
    solid = ~background
    core = ndi.binary_erosion(solid, iterations=4)
    _, nearest = ndi.distance_transform_edt(~core, return_indices=True)
    foreground = rgb[nearest[0], nearest[1]]
    difference = 254 - foreground
    coverage = np.clip(
        np.sum((254 - rgb) * difference, axis=2)
        / np.maximum(np.sum(difference * difference, axis=2), 48),
        0,
        1,
    )
    angles = np.linspace(0, 2 * np.pi, 1440, endpoint=False)
    radial = np.arange(0.47 * min(h, w), 0.515 * min(h, w), 0.2)
    centre = np.array([(w - 1) / 2, (h - 1) / 2])
    x = centre[0] + np.cos(angles[:, None]) * radial
    y = centre[1] + np.sin(angles[:, None]) * radial
    values = ndi.map_coordinates(coverage, (y, x), order=1, mode="constant", cval=0)
    crossings = (values[:, :-1] >= 0.5) & (values[:, 1:] < 0.5)
    valid = crossings.any(axis=1)
    index = crossings.argmax(axis=1)
    row = np.arange(len(angles))
    weight = (values[row, index] - 0.5) / np.maximum(
        values[row, index] - values[row, index + 1], 1e-6
    )
    radius = radial[index] + weight * 0.2
    px = centre[0] + np.cos(angles) * radius
    py = centre[1] + np.sin(angles) * radius
    valid &= (px > 20) & (py > 20) & (px < w - 21) & (py < h - 21)
    points = np.column_stack((px[valid], py[valid]))
    # Median-based outlier rejection removes small generated nicks, not whole arcs.
    retained = points.copy()
    for _ in range(4):
        x, y = retained.T
        cx, cy, constant = np.linalg.lstsq(
            np.column_stack((2 * x, 2 * y, np.ones_like(x))), x * x + y * y, rcond=None
        )[0]
        radius = np.sqrt(constant + cx * cx + cy * cy)
        residual = np.hypot(points[:, 0] - cx, points[:, 1] - cy) - radius
        mad = np.median(np.abs(residual - np.median(residual)))
        retained = points[np.abs(residual - np.median(residual)) < max(1, mad * 3)]
    return (cx.item(), cy.item(), radius.item()), residual


def landing_pad(image):
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    (cx, cy, radius), residual = fit_circle(image)
    # The source slightly clips the cardinal extremities and is not a perfect
    # circle. Re-centre/inset the fitted deck so its AA edge has transparent room.
    out_cx = out_cy = (SIZE - 1) / 2
    out_radius = (SIZE - 1) / 2 - 2
    scale = out_radius / radius
    yy, xx = np.mgrid[:SIZE, :SIZE].astype(np.float32)
    dx, dy = xx - out_cx, yy - out_cy
    distance = np.hypot(dx, dy)
    source_x, source_y = cx + dx / scale, cy + dy / scale
    colour = np.stack(
        [
            ndi.map_coordinates(
                rgb[..., channel], (source_y, source_x), order=1, mode="nearest"
            )
            for channel in range(3)
        ],
        axis=2,
    )
    # Normalise only the final ~5 native pixels of the generated silhouette. RGB
    # comes from safely INSIDE the true dark outer lip; neither white background
    # nor a lossy white-key fringe can enter the geometrically circular edge.
    bleed_distance = max(5.0, -residual.min().item() + 2.0)
    inner_radius = radius - bleed_distance
    factor = inner_radius / np.maximum(distance / scale, 1e-6)
    inner_x, inner_y = cx + dx / scale * factor, cy + dy / scale * factor
    lip = np.stack(
        [
            ndi.map_coordinates(
                rgb[..., channel], (inner_y, inner_x), order=1, mode="nearest"
            )
            for channel in range(3)
        ],
        axis=2,
    )
    blend = smoothstep((distance / scale - inner_radius) / 1.5)[..., None]
    colour = colour * (1 - blend) + lip * blend
    # A 1.5 px coverage transition is entirely inside the reported circle.
    alpha = smoothstep((out_radius - distance) / 1.5)
    return rgba_image(colour, alpha), {
        "native_fitted_circle": [cx, cy, radius],
        "fit_residual_native_min_max": [residual.min().item(), residual.max().item()],
        "circle": [out_cx, out_cy, out_radius],
        "source_to_output_scale": scale,
        "lip_normalisation_native_px": bleed_distance,
    }


def noise_field(rng, grid_size, output_size=SIZE):
    grid = rng.random((grid_size, grid_size)).astype(np.float32)
    return (
        np.asarray(
            Image.fromarray(grid).resize(
                (output_size, output_size), Image.Resampling.BICUBIC
            )
        )
        - 0.5
    )


def pothole(image):
    # Source damage almost touches its frame; adding asphalt room is necessary to
    # preserve the rim AND provide a 10-15% image-width feather. The square inset
    # is never used as an alpha mask. Newly exposed asphalt comes from clean
    # source corner patches, with a short continuous extension at the inset seam.
    inner_size = 768
    inset = (SIZE - inner_size) // 2
    small = np.asarray(
        image.convert("RGB").resize((inner_size, inner_size), Image.Resampling.LANCZOS),
        dtype=np.float32,
    )
    rng = np.random.default_rng(4101)
    corner = small[:96, :96]
    # Mirrored tile avoids a discontinuity at each tile seam. Offset so the tile
    # has no alignment relationship with the inset photo's square boundary.
    # Use the same resampling scale as the photo, keeping aggregate size uniform.
    tile = np.concatenate((corner, corner[:, ::-1]), axis=1)
    tile = np.concatenate((tile, tile[::-1]), axis=0)
    base = np.tile(tile, (6, 6, 1))[73 : 73 + SIZE, 51 : 51 + SIZE].copy()
    yy, xx = np.mgrid[:SIZE, :SIZE]
    sx, sy = xx - inset, yy - inset
    # Mirror a SHORT texture continuation, never clamp a border row/column (that
    # creates visible horizontal/vertical streaks). Fade into clean asphalt before
    # reflections can duplicate recognisable sections of the broken rim.
    extension = np.pad(small, ((inset, inset), (inset, inset), (0, 0)), mode="reflect")
    beyond_x = np.maximum.reduce((-sx, sx - inner_size + 1, np.zeros_like(sx)))
    beyond_y = np.maximum.reduce((-sy, sy - inner_size + 1, np.zeros_like(sy)))
    beyond = np.hypot(beyond_x, beyond_y)
    seam = smoothstep(beyond / 24)[..., None]
    colour = extension * (1 - seam) + base * seam
    dx, dy = xx - (SIZE - 1) / 2, yy - (SIZE - 1) / 2
    distance = np.hypot(dx, dy)
    theta = np.arctan2(dy, dx)
    # Low-frequency shape plus three non-periodically aligned seeded noise scales.
    shape = (
        7 * np.sin(3 * theta + 0.6)
        + 5 * np.sin(5 * theta - 1.1)
        + 3 * np.sin(9 * theta + 0.9)
    )
    shape += 11 * noise_field(rng, 15) + 5 * noise_field(rng, 47)
    shape += 2 * noise_field(rng, 133)
    # The entire broken rim fits in r <= 379 after the inset. The first few px of
    # this smoothstep are virtually opaque; final support is <= 503 px in radius.
    start = 378 + shape * 0.50
    finish = np.minimum(start + 120 + shape * 0.35, 503)
    alpha = 1 - smoothstep((distance - start) / (finish - start))
    # Lower only outer-asphalt local contrast; water and the broken rim are intact.
    local = np.asarray(
        Image.fromarray(np.uint8(np.clip(colour, 0, 255))).filter(
            ImageFilter.GaussianBlur(7)
        ),
        dtype=np.float32,
    )
    outer = smoothstep((distance - 382) / 76)[..., None]
    colour = colour + 0.24 * outer * (local - colour)
    return rgba_image(colour, alpha), {
        "source_inset_xyxy": [inset, inset, inset + inner_size, inset + inner_size],
        "source_to_output_scale": inner_size / image.width,
        "fade_start_radius_range": [start.min().item(), start.max().item()],
        "fade_width_range": [
            (finish - start).min().item(),
            (finish - start).max().item(),
        ],
        "maximum_support_radius": 503,
        "outer_contrast_reduction": "up to 24% of local high-frequency contrast",
        "noise_seed": 4101,
    }


def backgrounds():
    yy, xx = np.mgrid[:SIZE, :SIZE]
    checker = np.where(((xx // 32 + yy // 32) % 2)[..., None], 164, 210)
    checker = np.repeat(checker, 3, axis=2).astype(np.uint8)
    rng = np.random.default_rng(104)
    grain = rng.normal(0, 3.2, (SIZE, SIZE))
    grain += noise_field(rng, 80) * 10
    grain += noise_field(rng, 16) * 7
    asphalt = np.clip(grain[..., None] + [109, 111, 112], 0, 255).astype(np.uint8)
    return {
        "checker": Image.fromarray(checker).convert("RGBA"),
        "asphalt": Image.fromarray(asphalt).convert("RGBA"),
        "dark": Image.new("RGBA", (SIZE, SIZE), (19, 23, 29, 255)),
    }


def previews(items):
    bases = backgrounds()
    sheet = Image.new("RGB", (1536, 4 * 540), (32, 34, 38))
    draw = ImageDraw.Draw(sheet)
    for row, (ident, image) in enumerate(items):
        for col, (name, base) in enumerate(bases.items()):
            composite = Image.alpha_composite(base, image).convert("RGB")
            composite.save(PREVIEW / f"alpha_{ident}_{name}.png", optimize=True)
            sheet.paste(
                composite.resize((512, 512), Image.Resampling.LANCZOS),
                (512 * col, 540 * row + 28),
            )
            draw.text(
                (512 * col + 12, 540 * row + 8), f"{ident} / {name}", fill="white"
            )
        image.getchannel("A").save(PREVIEW / f"alpha_{ident}_mask.png", optimize=True)
    sheet.save(PREVIEW / "alpha_contact.png", optimize=True)
    # Full-size decoded edge crops enlarged 2x on grey/dark, plus their alpha.
    checks = [
        ("WR_01", (92, 110, 348, 262)),
        ("WR_01", (684, 744, 940, 896)),
        ("WR_02", (182, 98, 438, 250)),
        ("WR_02", (560, 746, 816, 898)),
        ("PH_01", (0, 376, 256, 528)),
        ("LP_01", (16, 144, 272, 296)),
    ]
    edge_sheet = Image.new("RGB", (1536, len(checks) * 332), (32, 34, 38))
    draw = ImageDraw.Draw(edge_sheet)
    lookup = dict(items)
    for row, (ident, box) in enumerate(checks):
        for col, name in enumerate(("asphalt", "dark", "alpha")):
            if name == "alpha":
                crop = lookup[ident].getchannel("A").convert("RGB").crop(box)
            else:
                crop = (
                    Image.alpha_composite(bases[name], lookup[ident])
                    .convert("RGB")
                    .crop(box)
                )
            edge_sheet.paste(
                crop.resize((512, 304), Image.Resampling.NEAREST),
                (col * 512, row * 332 + 28),
            )
            draw.text(
                (col * 512 + 10, row * 332 + 8), f"{ident} / {name} / 2x", fill="white"
            )
    edge_sheet.save(PREVIEW / "alpha_edge_checks.png", optimize=True)


def report(entries):
    lines = [
        "# Round-4 alpha decals",
        "",
        "Rebuild: `python3 tools/r4_textures_alpha.py` (Pillow + numpy + scipy).",
        f"Encoder: Pillow {pillow_version}, WebP quality=88, method=6, alpha_quality=100, exact=True.",
        "All assets are 1024 x 1024 RGBA. No source PNG or game source is modified.",
        "Coordinates use x right / y down; bbox right and bottom are exclusive.",
        "",
        "## Encoded files and tests",
        "",
        "| File | Bytes | Visible bbox (alpha > 0) | Opaque pixels | Soft pixels | Zero alpha pixels |",
        "|---|---:|---|---:|---:|---:|",
    ]
    for entry in entries:
        lines.append(
            f"| `{entry['id']}.webp` | {entry['bytes']:,} | {entry['alpha_bbox']} | "
            f"{entry['opaque_pixels']:,} | {entry['soft_pixels']:,} | {entry['zero_pixels']:,} |"
        )
    lines += [
        "",
        "All decoded alpha planes exactly equal the pre-encode alpha planes; extrema 0/255.",
        "All four outer canvas borders are alpha 0. Files were fully decoded and validated.",
        "",
        "## Wall hole regions",
        "",
        "Black bbox = centre-connected component with decoded max(R,G,B) <= 24 and alpha=255.",
        "Bounding boxes contain the irregular silhouette: they are not wholly black rectangles.",
        "",
    ]
    for entry in entries[:2]:
        lines += [
            f"- **{entry['id']} black centre bbox:** `{entry['black_bbox']}` output pixels; "
            f"{entry['black_pixels']:,} pixels; all opaque.",
            f"  Source near-white enclosed highlights protected: {entry['native_protected_white_pixels']:,}; "
            f"decoded interior-highlight check: {entry['protected_test_pixels']:,} pixels at alpha 255.",
            f"  Source black-interior check: {entry['black_test_pixels']:,} output pixels at alpha 255.",
        ]
    lines += [
        "",
        "### Wall keying and defringe",
        "",
        "- Flood from all four image borders through min(R,G,B) >= 244, channel spread <= 12; "
        "no global white key and no enclosed-white hole removal.",
        "- Estimate off-white matte from distant background pixels; compute coverage only in "
        "a 2.5 native-pixel interior / 2 px exterior boundary band (about 1-2 output px).",
        "- Unmix the measured white matte; stabilise faint edges with nearest opaque interior "
        "colour. Thin disconnected fragments retain their own colour seeds. Dilate foreground "
        "RGB into transparent pixels. Resize using Pillow's premultiplied-alpha Lanczos, then "
        "restore hidden-RGB colour dilation for straight-alpha GPU filtering.",
        "- Black centre and enclosed white debris/glass highlights explicitly remain opaque.",
        "",
        "## Pothole",
        "",
    ]
    ph = entries[2]
    lines += [
        f"Source resampled to 768 x 768 and inset at `{ph['source_inset_xyxy']}`. "
        "The generated rim nearly touches the source border, so simply feathering the original "
        "full-frame image would erase it.",
        "Clean corner asphalt, matched to the inset aggregate scale, supplies the extension. "
        "A short reflected continuation crossfades over 24 px into clean asphalt (not stretched "
        "border pixels). No square mask is used.",
        f"Seeded angular/multiscale noise (seed {ph['noise_seed']}) modulates a smooth radial fade: "
        f"start radius {ph['fade_start_radius_range'][0]:.1f}-{ph['fade_start_radius_range'][1]:.1f} px; "
        f"feather width {ph['fade_width_range'][0]:.1f}-{ph['fade_width_range'][1]:.1f} px "
        "(roughly 11-12% of the image); support remains inside r=503 px.",
        "Only outer asphalt local contrast is reduced, by up to 24%; the muddy water and broken rim "
        "are unchanged apart from resampling/WebP encoding.",
        "",
        "## Landing pad",
        "",
    ]
    lp = entries[3]
    cx, cy, radius = lp["circle"]
    sx, sy, sr = lp["native_fitted_circle"]
    lo, hi = lp["fit_residual_native_min_max"]
    lines += [
        f"**Output circle centre/radius:** `({cx:.2f}, {cy:.2f}), r={radius:.2f}` pixels.",
        f"Native subpixel 50%-coverage circle fit: centre `({sx:.3f}, {sy:.3f})`, radius `{sr:.3f}` px; "
        f"observed radial residual `{lo:.2f}..{hi:.2f}` native pixels.",
        "Fit uses radial silhouette crossings away from canvas-clipped cardinal arcs, with "
        "robust least-squares outlier rejection. Deck is re-centred/inset to leave 2 px transparent margin.",
        "A 1.5 px antialias ramp is entirely inside the reported circle. Final lip RGB is extended "
        f"from {lp['lip_normalisation_native_px']:.1f} native pixels inboard, normalising the "
        "slightly noncircular generated edge without carrying white background into the circle.",
        "Outside the circle alpha is exactly 0; white paint/text/grates inside are not keyed.",
        "",
        "## Inspection previews",
        "",
        "`alpha_{WR_01,WR_02,PH_01,LP_01}_{checker,asphalt,dark}.png`: decoded WebPs composited "
        "at 1024 x 1024, with seeded mid-grey asphalt and dark #13171D backgrounds.",
        "`alpha_*_mask.png`: lossless alpha-channel previews.",
        "`alpha_contact.png`: all four assets on all three backgrounds.",
        "`alpha_edge_checks.png`: 2x enlarged crops on asphalt/dark plus alpha, for fringe inspection.",
        "",
        "### Visual inspection and correction",
        "",
        "Opened the decoded checker/asphalt/dark contact sheet, individual full-resolution dark "
        "composites for all four assets, the pothole asphalt/mask previews, and enlarged edge crops. "
        "The initial pothole extension showed stretched border-grain streaks; replaced clamped "
        "pixels with short reflection plus same-scale asphalt, regenerated, and inspected again. "
        "Final previews show no visible continuous white matte halo or square asphalt seam. "
        "Concrete flakes and glass fracture highlights remain light and opaque; both black "
        "interiors remain opaque. The pad edge is circular and its text/vents are intact.",
        "",
        "## Limitations",
        "",
        "Generated images are not measured geometry. The pothole's added outer asphalt is a "
        "deterministic continuation, not additional captured detail. Landing-pad lip geometry is "
        "normalised by a few pixels to a true circle. Physical glass/debris highlights remain light "
        "by design, not transparent. Game/browser integration is outside this task.",
        "",
        "## Source integrity",
        "",
    ]
    for entry in entries:
        lines.append(
            f"- `{entry['id']}.png`: SHA-256 `{entry['source_sha256']}` (unchanged after run)."
        )
    lines += ["", "## Output inventory", "", "| Path | Bytes |", "|---|---:|"]
    for path in (
        [ROOT / "tools/r4_textures_alpha.py"]
        + [OUTPUT / f"{ident}.webp" for ident in IDS]
        + sorted(PREVIEW.glob("alpha_*.png"))
    ):
        lines.append(f"| `{path.relative_to(ROOT)}` | {path.stat().st_size:,} |")
    (PREVIEW / "alpha_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    PREVIEW.mkdir(parents=True, exist_ok=True)
    entries, items = [], []
    for ident in IDS:
        source_path = SOURCE / f"{ident}.png"
        digest = sha256(source_path.read_bytes()).hexdigest()
        with Image.open(source_path) as source:
            source.load()
            if ident.startswith("WR"):
                rgba, data = key_wall(source)
            elif ident == "PH_01":
                rgba, data = pothole(source)
            else:
                rgba, data = landing_pad(source)
        output = OUTPUT / f"{ident}.webp"
        rgba.save(output, "WEBP", quality=88, method=6, alpha_quality=100, exact=True)
        with Image.open(output) as saved:
            saved.load()
            require(
                saved.mode == "RGBA" and saved.size == (SIZE, SIZE),
                f"{ident}: expected 1024 x 1024 RGBA",
            )
            decoded = saved.copy()
        pixels = np.asarray(decoded)
        alpha = pixels[..., 3]
        require(np.array_equal(alpha, np.asarray(rgba)[..., 3]), "WebP alpha changed")
        require(alpha.min() == 0 and alpha.max() == 255, "Expected alpha extrema 0/255")
        border = np.concatenate((alpha[0], alpha[-1], alpha[:, 0], alpha[:, -1]))
        require(not np.any(border), f"{ident}: nontransparent canvas border")
        if ident.startswith("WR"):
            hole = central_black(pixels[..., :3])
            require(np.all(alpha[hole] == 255), f"{ident}: transparent black interior")
            data["black_bbox"], data["black_pixels"] = bbox(hole), hole.sum().item()
            for name in ("protected", "black"):
                mask = data.pop(f"{name}_test_mask")
                require(
                    np.all(alpha[mask] == 255), f"{ident} lost {name} interior alpha"
                )
                data[f"{name}_test_pixels"] = mask.sum().item()
        if ident == "LP_01":
            yy, xx = np.mgrid[:SIZE, :SIZE]
            cx, cy, radius = data["circle"]
            require(
                np.all(alpha[np.hypot(xx - cx, yy - cy) > radius] == 0),
                "Landing pad extends beyond its circle",
            )
        require(
            sha256(source_path.read_bytes()).hexdigest() == digest, "Source PNG changed"
        )
        data.update(
            {
                "id": ident,
                "bytes": output.stat().st_size,
                "source_sha256": digest,
                "alpha_bbox": bbox(alpha > 0),
                "opaque_pixels": np.count_nonzero(alpha == 255),
                "soft_pixels": np.count_nonzero((alpha > 0) & (alpha < 255)),
                "zero_pixels": np.count_nonzero(alpha == 0),
            }
        )
        entries.append(data)
        items.append((ident, decoded))
        print(
            ident,
            decoded.size,
            output.stat().st_size,
            "bytes",
            "alpha bbox",
            data["alpha_bbox"],
        )
        if "black_bbox" in data:
            print("  black centre bbox:", data["black_bbox"])
        if "circle" in data:
            print("  circle cx/cy/r:", data["circle"])
    previews(items)
    report(entries)
    print("Wrote decoded previews and", PREVIEW / "alpha_report.md")


if __name__ == "__main__":
    main()
