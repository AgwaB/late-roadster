"""Round-5 cut-outs and plane textures for the game.

  python3 tools/r5_cutouts.py [research/raycity/generated/2026-10-18-round5]

BK_01 / BK_02  five cyclists from behind / from the front -> public/assets/photo/BK_R1..BK_R5, BK_F1..BK_F5 (alpha
               WebP, one rider each, ground at the bottom edge; jersey order red, blue, lime, purple, white)
SM_01 / SM_03  white cab-over tractor, side (nose left) and front -> SM_01, SM_03 (alpha, trimmed to the truck)
MQ_01          seated suited mannequin -> MQ_01 (alpha)
EV_02          black mesh crowd barrier -> EV_02 (alpha from darkness, cropped post to post so it tiles)
EV_01, TP_01   grandstand front, toll canopy fascia -> EV_01, TP_01 (opaque, made to tile left-right)
TP_02          toll canopy soffit -> TP_02 (opaque, made to tile both ways)
The keyer is tools/r3_cutouts.py's (connected near-white background, enclosed pale fabric kept). Contact sheets on
grey go to research/raycity/r5-assets/.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from r3_cutouts import key_image, trim_grounded  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SRC = (
    Path(sys.argv[1])
    if len(sys.argv) > 1
    else ROOT / "research/raycity/generated/2026-10-18-round5"
)
OUT = ROOT / "public/assets/photo"
PREVIEW = ROOT / "research/raycity/r5-assets"


def save_alpha(im: Image.Image, name: str, max_h: int = 1024) -> Image.Image:
    if im.height > max_h:
        im = im.resize((round(im.width * max_h / im.height), max_h), Image.LANCZOS)
    path = OUT / (name + ".webp")
    im.save(path, "WEBP", quality=88, method=6, alpha_quality=100, exact=True)
    print(name, im.size, path.stat().st_size // 1024, "KiB")
    return Image.open(path).convert("RGBA")


def save_opaque(im: Image.Image, name: str) -> None:
    path = OUT / (name + ".webp")
    im.convert("RGB").save(path, "WEBP", quality=84, method=6)
    print(name, im.size, path.stat().st_size // 1024, "KiB")


def split_row(src: Image.Image, n: int) -> list[Image.Image]:
    """split a white-background sheet of n figures standing side by side at the widest empty column gaps"""
    rgb = np.asarray(src.convert("RGB")).astype(np.int16)
    occ = ((rgb.min(2) < 232) | (rgb.max(2) - rgb.min(2) > 14)).sum(0) > 2
    xs = np.where(occ)[0]
    runs, start = [], xs[0]
    for p, q in zip(xs[:-1], xs[1:]):
        if q - p > 1:
            runs.append((start, p + 1))
            start = q
    runs.append((start, xs[-1] + 1))
    # merge the narrowest gaps until n figures remain (a stray strap or wheel gap must not split a rider)
    while len(runs) > n:
        gaps = [runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)]
        i = int(np.argmin(gaps))
        runs[i : i + 2] = [(runs[i][0], runs[i + 1][1])]
    assert len(runs) == n, runs
    out = []
    for x0, x1 in runs:
        # each figure keyed on its own (the keyer keeps one main figure per image)
        out.append(
            key_image(
                src.crop((max(0, x0 - 12), 0, min(src.width, x1 + 12), src.height))
            )
        )
    return out


def ground(sub: Image.Image) -> Image.Image:
    """trim to the visible pixels with a 2% margin on top and sides, none below the wheels"""
    a = np.asarray(sub.getchannel("A")) > 12
    ys, xs = np.where(a)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    m = max(1, round((x1 - x0) * 0.02))
    c = sub.crop((x0, y0, x1, y1))
    res = Image.new("RGBA", (c.width + 2 * m, c.height + m))
    res.paste(c, (m, m))
    return res


def riders() -> list[tuple[str, Image.Image]]:
    items = []
    for src, tag in [("BK_01", "R"), ("BK_02", "F")]:
        for i, sub in enumerate(split_row(Image.open(SRC / (src + ".png")), 5)):
            items.append(
                (f"BK_{tag}{i + 1}", save_alpha(ground(sub), f"BK_{tag}{i + 1}", 768))
            )
    return items


def single(src: str, max_h: int) -> Image.Image:
    rgba, _, _ = trim_grounded(key_image(Image.open(SRC / (src + ".png"))))
    return save_alpha(rgba, src, max_h)


def barrier() -> Image.Image:
    rgb = np.asarray(Image.open(SRC / "EV_02.png").convert("RGB")).astype(np.float32)
    low = rgb.min(2)
    # black steel on white: coverage from darkness, colour a flat dark steel
    alpha = np.clip((236 - low) / (236 - 70), 0, 1)
    rows = np.where((alpha > 0.5).mean(1) > 0.02)[0]
    y0, y1 = rows.min(), rows.max() + 1
    # posts: columns dark over most of the fence height; crop from the first post's centre to the last's
    colcov = (alpha[y0:y1] > 0.5).mean(0)
    posts = np.where(colcov > 0.75)[0]
    groups = np.split(posts, np.where(np.diff(posts) > 1)[0] + 1)
    centres = [
        int(g.mean()) for g in groups if len(g) >= 8
    ]  # posts are thick; mesh wires are not
    x0, x1 = centres[0], centres[-1]
    print("EV_02 posts at", centres, "-> sections", len(centres) - 1)
    a = (alpha[y0:y1, x0:x1] * 255).astype(np.uint8)
    col = np.zeros((y1 - y0, x1 - x0, 3), np.uint8)
    col[...] = (30, 32, 36)
    im = Image.fromarray(np.dstack((col, a)), "RGBA")
    im = im.resize((1024, round(1024 * im.height / im.width)), Image.LANCZOS)
    return save_alpha(im, "EV_02", 1024)


def seam_lr(im: Image.Image, band: int) -> Image.Image:
    """make the left and right edges meet: cross-fade the right band into a copy of the left band"""
    a = np.asarray(im.convert("RGB")).astype(np.float32)
    w = a.shape[1]
    t = np.linspace(0, 1, band)[None, :, None]
    a[:, w - band :] = a[:, w - band :] * (1 - t) + a[:, :band] * t
    return Image.fromarray(a.astype(np.uint8))


def seam_tb(im: Image.Image, band: int) -> Image.Image:
    return seam_lr(im.transpose(Image.TRANSPOSE), band).transpose(Image.TRANSPOSE)


def planes() -> None:
    ev1 = Image.open(SRC / "EV_01.png").convert("RGB")
    save_opaque(
        seam_lr(ev1, 60).resize(
            (2048, round(2048 * ev1.height / ev1.width)), Image.LANCZOS
        ),
        "EV_01",
    )
    tp1 = Image.open(SRC / "TP_01.png").convert("RGB")
    save_opaque(
        seam_lr(tp1, 60).resize(
            (1024, round(1024 * tp1.height / tp1.width)), Image.LANCZOS
        ),
        "TP_01",
    )
    tp2 = Image.open(SRC / "TP_02.png").convert("RGB")
    save_opaque(
        seam_tb(seam_lr(tp2, 50), 50).resize((1024, 1024), Image.LANCZOS), "TP_02"
    )


def sheet(items: list[tuple[str, Image.Image]]) -> None:
    PREVIEW.mkdir(parents=True, exist_ok=True)
    cols, cw, chh = 5, 300, 330
    rows = (len(items) + cols - 1) // cols
    s = Image.new("RGB", (cols * cw, rows * chh), (112, 112, 112))
    d = ImageDraw.Draw(s)
    for i, (name, im) in enumerate(items):
        t = im.copy()
        t.thumbnail((cw - 20, chh - 30), Image.LANCZOS)
        x, y = (i % cols) * cw, (i // cols) * chh
        s.paste(t, (x + (cw - t.width) // 2, y + chh - 6 - t.height), t)
        d.text((x + 6, y + 4), name, fill="white")
    s.save(PREVIEW / "cutouts_grey.png")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    items = riders()
    for src, h in [("SM_01", 1024), ("SM_03", 1024), ("MQ_01", 512)]:
        items.append((src, single(src, h)))
    items.append(("EV_02", barrier()))
    planes()
    sheet(items)
