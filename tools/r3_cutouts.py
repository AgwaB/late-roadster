"""Key the nine Round-3 commuter sprites, preserving white clothes and dark hair.

  python3 tools/r3_cutouts.py

Requires Pillow, numpy and scipy. Read-only inputs are the approved round-3 PNGs.
Writes only public/assets/photo/{S_02..S_07,K2_01..K2_03}.webp and inspection
sheets/metadata in research/raycity/r3-assets/street_props/. White is ~#FEFEFE:
connected near-white background is removed with tolerance; enclosed white garment
highlights are protected. A narrow matte band estimates coverage against #FEFEFE
and borrows interior foreground colour, avoiding white fringes on dark ground.
2% padding is applied to the top and sides, but never below ground contact.
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "research/raycity/generated/2026-10-17-round3"
OUT = ROOT / "public/assets/photo"
PREVIEW = ROOT / "research/raycity/r3-assets/street_props"
IDS = [f"S_{i:02d}" for i in range(2, 8)] + [f"K2_{i:02d}" for i in range(1, 4)]


def key_image(image):
    rgb = np.asarray(image.convert("RGB")).astype(np.float32)
    low, high = rgb.min(2), rgb.max(2)
    # Loose enough to remove off-white antialiasing, narrow enough for white cloth.
    white = (low >= 244) & ((high - low) <= 10)
    labels, count = ndi.label(white)
    border = np.unique(
        np.concatenate((labels[0], labels[-1], labels[:, 0], labels[:, -1]))
    )
    bg_ids = set(int(v) for v in border if v)
    boxes = ndi.find_objects(labels)
    sizes = np.bincount(labels.ravel())
    for label_id, sl in enumerate(boxes, 1):
        if label_id in bg_ids or sl is None or sizes[label_id] < 18:
            continue
        # Genuine enclosed holes (handlebars, bags, limbs) have a darker contour;
        # white highlights entirely enclosed by pale fabric are not background.
        ys, xs = sl
        yy = slice(max(0, ys.start - 3), min(rgb.shape[0], ys.stop + 3))
        xx = slice(max(0, xs.start - 3), min(rgb.shape[1], xs.stop + 3))
        region = labels[yy, xx] == label_id
        ring = ndi.binary_dilation(region, iterations=3) & ~region
        values = low[yy, xx][ring]
        if len(values) and np.mean(values < 198) > 0.12:
            bg_ids.add(label_id)
    background = np.isin(labels, list(bg_ids))
    solid = ~background
    # Discard isolated far-away noise while retaining small nearby hair strands.
    fg_labels, _ = ndi.label(solid)
    fg_sizes = np.bincount(fg_labels.ravel())
    fg_sizes[0] = 0
    main = fg_labels == int(fg_sizes.argmax())
    near_main = ndi.distance_transform_edt(~main) < 7
    solid &= near_main
    inside = ndi.distance_transform_edt(solid)
    core = inside >= 2.5
    _, nearest = ndi.distance_transform_edt(~core, return_indices=True)
    fore = rgb[nearest[0], nearest[1]]
    diff = 254.0 - fore
    denom = np.sum(diff * diff, axis=2)
    alpha_fit = np.sum((254.0 - rgb) * diff, axis=2) / np.maximum(denom, 40)
    alpha_fit = np.clip(alpha_fit, 0, 1)
    outside = ndi.distance_transform_edt(~solid)
    band = (inside < 2.5) & (outside <= 2.5)
    alpha = solid.astype(np.float32)
    alpha[band] = alpha_fit[band]
    alpha[outside > 2.5] = 0
    alpha[alpha < 0.025] = 0
    # Colour dilation / defringe: opaque interiors remain completely untouched.
    colour = rgb.copy()
    edge = band & (alpha < 0.995)
    colour[edge] = fore[edge]
    colour[alpha == 0] = fore[alpha == 0]
    rgba = np.dstack(
        (np.clip(colour, 0, 255).astype(np.uint8), np.uint8(alpha * 255 + 0.5))
    )
    return Image.fromarray(rgba)


def trim_grounded(rgba):
    a = np.asarray(rgba.getchannel("A"))
    yy, xx = np.where(a > 12)
    left, top, right, bottom = (
        int(xx.min()),
        int(yy.min()),
        int(xx.max() + 1),
        int(yy.max() + 1),
    )
    margin_x = max(1, round((right - left) * 0.02))
    margin_y = max(1, round((bottom - top) * 0.02))
    content = rgba.crop((left, top, right, bottom))
    result = Image.new(
        "RGBA", (content.width + margin_x * 2, content.height + margin_y)
    )
    result.paste(content, (margin_x, margin_y))
    if result.height > 1024:
        result = result.resize(
            (round(result.width * 1024 / result.height), 1024), Image.Resampling.LANCZOS
        )
    # End at the actual last visible contact row after resampling, not empty padding.
    aa = np.asarray(result.getchannel("A"))
    active_y = np.where(np.any(aa > 12, axis=1))[0]
    result = result.crop((0, 0, result.width, int(active_y[-1]) + 1))
    aa = np.asarray(result.getchannel("A"))
    contact = np.where(aa[-1] > 12)[0]
    anchor = (
        float((contact.min() + contact.max()) / 2 / result.width)
        if len(contact)
        else 0.5
    )
    return result, [left, top, right, bottom], anchor


def make_sheets(items):
    # Individual composites remain <=1000 px; large contact sheets are contact sheets,
    # not renders. Both backgrounds are intentionally neutral to expose any halo.
    for name, colour in [("black", (0, 0, 0)), ("grey", (112, 112, 112))]:
        sheet = Image.new("RGB", (990, 990), colour)
        draw = ImageDraw.Draw(sheet)
        for i, (ident, im) in enumerate(items):
            x, y = (i % 3) * 330, (i // 3) * 330
            thumb = im.copy()
            thumb.thumbnail((300, 300), Image.Resampling.LANCZOS)
            sheet.paste(
                thumb, (x + (330 - thumb.width) // 2, y + 326 - thumb.height), thumb
            )
            draw.text((x + 12, y + 8), ident, fill=(240, 240, 240))
        sheet.save(PREVIEW / f"sprites_{name}_contact.png")
    # Reference + alpha result, same orientation, useful for checking pale garments.
    for i, (ident, im) in enumerate(items):
        ref = Image.open(SOURCE / f"{ident}.png").convert("RGB")
        sheet = Image.new("RGB", (650, 640), (112, 112, 112))
        ref.thumbnail((310, 600), Image.Resampling.LANCZOS)
        out = im.copy()
        out.thumbnail((310, 600), Image.Resampling.LANCZOS)
        sheet.paste(ref, ((325 - ref.width) // 2, 630 - ref.height))
        sheet.paste(out, (325 + (325 - out.width) // 2, 630 - out.height), out)
        d = ImageDraw.Draw(sheet)
        d.text((10, 8), ident + " reference", fill="white")
        d.text((335, 8), "alpha WebP / grey", fill="white")
        sheet.save(PREVIEW / f"{ident}_comparison.png")
    # Large edge crops on both backgrounds, including white shirts/shoes and hair.
    checks = [
        ("S_04", (0.25, 0.10, 0.80, 0.38)),
        ("S_06", (0.18, 0.75, 0.76, 0.95)),
        ("K2_02", (0.18, 0, 0.88, 0.23)),
        ("K2_01", (0.1, 0.14, 0.95, 0.43)),
    ]
    sheet = Image.new("RGB", (1000, 800))
    d = ImageDraw.Draw(sheet)
    lookup = dict(items)
    for row, (ident, box) in enumerate(checks):
        im = lookup[ident]
        crop = im.crop(
            tuple(
                round(v * (im.width if n % 2 == 0 else im.height))
                for n, v in enumerate(box)
            )
        )
        crop.thumbnail((480, 180), Image.Resampling.LANCZOS)
        for col, bg in enumerate([(0, 0, 0), (112, 112, 112)]):
            x, y = col * 500, row * 200
            d.rectangle((x, y, x + 499, y + 199), fill=bg)
            sheet.paste(
                crop, (x + (500 - crop.width) // 2, y + 198 - crop.height), crop
            )
            d.text((x + 8, y + 5), ident + " edge check", fill="white")
    sheet.save(PREVIEW / "sprites_edge_checks.png")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    PREVIEW.mkdir(parents=True, exist_ok=True)
    report, items = [], []
    for ident in IDS:
        rgba, crop, anchor = trim_grounded(
            key_image(Image.open(SOURCE / f"{ident}.png"))
        )
        path = OUT / f"{ident}.webp"
        rgba.save(path, "WEBP", quality=90, method=6, alpha_quality=100, exact=True)
        # Inspect the encoded file, not merely the pre-encode in-memory image.
        encoded = Image.open(path).convert("RGBA")
        items.append((ident, encoded))
        aa = np.asarray(encoded.getchannel("A"))
        entry = {
            "id": ident,
            "size_px": list(encoded.size),
            "file_bytes": path.stat().st_size,
            "source_crop_xyxy": crop,
            "padding": "2% top/sides; zero below contact",
            "bottom_contact_u": round(anchor, 5),
            "bottom_contact_v": 1,
            "alpha_extrema": [int(aa.min()), int(aa.max())],
            "bottom_visible_pixels": int(np.count_nonzero(aa[-1] > 12)),
            "view": "rear three-quarter"
            if ident in ["S_02", "S_03", "S_04"]
            else "front three-quarter",
        }
        report.append(entry)
        print(
            ident,
            encoded.size,
            path.stat().st_size,
            "bottom contact",
            entry["bottom_visible_pixels"],
        )
    make_sheets(items)
    (PREVIEW / "sprites_verification.json").write_text(
        json.dumps(report, indent=2) + "\n"
    )


if __name__ == "__main__":
    main()
