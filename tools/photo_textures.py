"""Convert a generated texture batch (research/raycity/generated/<folder>/) into game-ready WebP files under
public/assets/photo/: resized facades/ads/roofs/walls, seam-blended tiles, sky-keyed skylines (RGBA) and
background-keyed pedestrian cut-outs (RGBA).

  python3 tools/photo_textures.py research/raycity/generated/2026-10-17                    # round 1: A-G
  python3 tools/photo_textures.py research/raycity/generated/2026-10-17-round2-document    # round 2: A2, H-L
"""

import glob
import os
import sys

from PIL import Image, ImageFilter

SRC = sys.argv[1]
OUT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "public", "assets", "photo"
)
os.makedirs(OUT, exist_ok=True)


def seam_blend_x(im, frac=0.06):
    """Make the left/right edges continue into each other by cross-fading a strip taken from the opposite side."""
    w, h = im.size
    bw = max(8, int(w * frac))
    im = im.convert("RGB")
    left = im.crop((0, 0, bw, h))
    right = im.crop((w - bw, 0, w, h))
    # ramp 0..1 across the band
    ramp = Image.linear_gradient("L").rotate(90, expand=True).resize((bw, h))
    # right edge: blend towards the left edge content; left edge: towards the right edge content
    new_right = Image.composite(
        left, right, ramp
    )  # ramp=255 -> left content at far right
    new_left = Image.composite(right, left, ramp.transpose(Image.FLIP_LEFT_RIGHT))
    im.paste(new_right, (w - bw, 0))
    im.paste(new_left, (0, 0))
    return im


def seam_blend_y(im, frac=0.06):
    return seam_blend_x(im.transpose(Image.ROTATE_90), frac).transpose(Image.ROTATE_270)


def save_jpg(im, name, q=86):
    # shipped as WebP (same quality scale); the game loads photo/<name>.webp
    im.convert("RGB").save(
        os.path.join(OUT, name + ".webp"), "WEBP", quality=q, method=6
    )


def key_sky(im, thresh=244):
    """Alpha out the near-white sky: luminance above thresh and low saturation; soft edge via blur of the mask."""
    rgb = im.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    mask = Image.new("L", (w, h), 0)
    mp = mask.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            mx, mn = max(r, g, b), min(r, g, b)
            if mn > thresh and mx - mn < 14:
                mp[x, y] = 0
            else:
                mp[x, y] = 255
    # fill tiny holes inside buildings (bright windows) by min/max filtering, then soften
    mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    mask = mask.filter(ImageFilter.GaussianBlur(0.8))
    rgba = rgb.copy()
    rgba.putalpha(mask)
    return rgba


def key_cutout(im, thresh=238):
    """Pedestrian on a near-white studio background -> RGBA. Only the near-white region connected to the image
    border is removed (flood fill), so white shirts and sneakers inside the figure survive; edges are feathered."""
    import numpy as np
    from PIL import ImageDraw

    rgb = im.convert("RGB")
    a = np.asarray(rgb).astype(np.int16)
    mn, mx = a.min(axis=2), a.max(axis=2)
    white = ((mn > thresh) & (mx - mn < 16)).astype(np.uint8) * 255
    m = Image.fromarray(
        white, "L"
    ).copy()  # own buffer: floodfill must be able to write
    w, h = m.size
    for seed in [
        (0, 0),
        (w - 1, 0),
        (0, h - 1),
        (w - 1, h - 1),
        (w // 2, 0),
        (0, h // 2),
        (w - 1, h // 2),
    ]:
        if m.getpixel(seed) == 255:
            ImageDraw.floodfill(m, seed, 128)
    bg = np.asarray(m) == 128
    alpha = Image.fromarray(np.where(bg, 0, 255).astype(np.uint8), "L")
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.9))
    out = rgb.copy()
    out.putalpha(alpha)
    bbox = alpha.point(lambda v: 255 if v > 20 else 0).getbbox()
    return out.crop(bbox) if bbox else out


for f in sorted(glob.glob(os.path.join(SRC, "*.png"))):
    base = os.path.basename(f)[:-4]
    code = base.split("_")[0]
    num = base.split("_")[-1]
    im = Image.open(f)
    w, h = im.size
    if code == "A":  # facade 3:4 -> 1024x1365
        save_jpg(im.resize((1024, 1365), Image.LANCZOS), f"A_{num}", 80)
    elif code == "A2":  # round 2 facades, same format, varied businesses per floor
        save_jpg(im.resize((1024, 1365), Image.LANCZOS), f"A2_{num}", 80)
    elif code == "H":  # blank side walls 12 x 16 m (3:4)
        save_jpg(im.resize((768, 1024), Image.LANCZOS), f"H_{num}", 78)
    elif code == "I":  # tower module 12 x 12 m, repeats both ways: soften both seams
        save_jpg(
            seam_blend_y(
                seam_blend_x(im.resize((1024, 1024), Image.LANCZOS), 0.03), 0.03
            ),
            f"I_{num}",
            80,
        )
    elif code == "J":  # one 2.1 x 0.9 m barrier block, repeats along the road
        save_jpg(
            seam_blend_x(im.resize((1024, 439), Image.LANCZOS), 0.04), f"J_{num}", 78
        )
    elif code == "K":  # pedestrian cut-out (RGBA, cropped to the figure)
        cut = key_cutout(im)
        s = 900 / cut.height
        cut = cut.resize((max(8, round(cut.width * s)), 900), Image.LANCZOS)
        cut.save(os.path.join(OUT, f"K_{num}.webp"), quality=86, method=6)
    elif code == "L":  # bus-shelter poster 9:16
        save_jpg(im.resize((576, 1024), Image.LANCZOS), f"L_{num}", 80)
    elif (
        code == "B"
    ):  # upper floors: repeated vertically; the Blender model puts a slab band on each seam, so no blend
        save_jpg(im.resize((1024, 1024), Image.LANCZOS), f"B_{num}", 80)
    elif (
        code == "C"
    ):  # shopfront strip: repeated horizontally; a pier column hides each seam, so no blend
        save_jpg(im.resize((1792, 768), Image.LANCZOS), f"C_{num}", 80)
    elif code == "D":  # skyline: key the sky, tile horizontally, RGBA
        rgba = key_sky(im.resize((2048, 878), Image.LANCZOS))
        rgba = seam_blend_x(rgba.convert("RGB"), 0.04).convert("RGBA")
        a = key_sky(im.resize((2048, 878), Image.LANCZOS)).split()[3]
        a = seam_blend_x(a.convert("RGB"), 0.04).convert("L")
        rgba.putalpha(a)
        rgba = rgba.resize((1536, 658), Image.LANCZOS)
        rgba.save(
            os.path.join(OUT, f"D_{num}.webp"), quality=86, method=6
        )  # alpha + small
    elif code == "E":  # ads 21:9 -> 1024x439
        save_jpg(im.resize((1024, 439), Image.LANCZOS), f"E_{num}", 80)
    elif code == "F":  # roofs 1:1
        save_jpg(im.resize((768, 768), Image.LANCZOS), f"F_{num}", 78)
    elif code == "G":  # noise barrier: tile horizontally
        save_jpg(
            seam_blend_x(im.resize((1536, 658), Image.LANCZOS), 0.03), f"G_{num}", 78
        )
    print("OK", base, w, h)
print(
    "DONE",
    sum(os.path.getsize(os.path.join(OUT, x)) for x in os.listdir(OUT)) // 1024,
    "KB total",
)
