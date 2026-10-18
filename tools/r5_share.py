"""Round-5 share and lobby pictures: favicon/app icons (FV), the link-preview card (OG), the clip thumbnails (CL).

  python3 tools/r5_share.py [research/raycity/generated/2026-10-18-round5]

FV_01   -> public/favicon.svg (potrace of the three colour shapes), favicon-32.png, apple-touch-icon.png (180, full
           bleed), icon-192.png, icon-512.png (PNGs rendered from the SVG by rsvg-convert)
OG_01   -> public/og.jpg (1200x630, title set in Pretendard ExtraBold, SIL OFL 1.1)
CL_xx   -> public/assets/clips/<clip id>.webp (480x270) and the lobby's ON THE WAY tiles public/assets/lobby/*.webp
peloton -> public/assets/clips/peloton.webp: no CL image exists for it (CL_09 was drawn for the retired SKY LANE
           clip), so it is composited: the empty boulevard from round-3 R_05, the five BK_R riders (tools/r5_cutouts.py,
           run that first) and the round-3 R_07 rear view keyed and lifted over them on pale jets
Needs Pillow, numpy, potrace and rsvg-convert (librsvg) on PATH.
"""

import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from r3_cutouts import key_image, trim_grounded  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
R3 = ROOT / "research/raycity/generated/2026-10-17-round3"
SRC = (
    Path(sys.argv[1])
    if len(sys.argv) > 1
    else ROOT / "research/raycity/generated/2026-10-18-round5"
)
PUB = ROOT / "public"
FONT = Path.home() / "Library/Fonts/Pretendard-ExtraBold.otf"

NAVY = (11, 15, 34)
YELLOW = (255, 210, 63)

# CL block -> clip id (src/game/score.ts). CL_09 was drawn for the old SKY LANE clip and is not shipped.
CLIPS = {
    "CL_01": "toll",
    "CL_02": "park",
    "CL_03": "ramp",
    "CL_04": "kickflip",
    "CL_05": "ceiling",
    "CL_06": "skyway",
    "CL_07": "hop",
    "CL_08": "sinkhole",
    "CL_10": "refill",
    "CL_11": "reset",
    "CL_12": "news",
}
# lobby ON THE WAY tiles (2:1, full width): source, vertical focus 0..1
TILES = {"toll": ("CL_01", 0.0), "sinkhole": ("CL_08", 0.5), "ramp": ("CL_03", 0.0)}


def potrace_paths(mask: np.ndarray) -> str:
    """potrace one boolean mask; returns its <g> of paths in image pixel coordinates"""
    with tempfile.TemporaryDirectory() as td:
        pbm = Path(td) / "m.pbm"
        Image.fromarray(np.where(mask, 0, 255).astype(np.uint8)).convert("1").save(pbm)
        out = Path(td) / "m.svg"
        subprocess.run(
            ["potrace", "-s", "-t", "40", "-O", "0.4", "-o", str(out), str(pbm)],
            check=True,
        )
        svg = out.read_text()
    g = re.search(r'<g transform="([^"]+)"[^>]*>(.*?)</g>', svg, re.S)
    assert g, "potrace output without a group"
    return '<g transform="%s">%s</g>' % (g.group(1), g.group(2).strip())


def favicon() -> None:
    im = np.asarray(Image.open(SRC / "FV_01.png").convert("RGB")).astype(int)
    n = im.shape[0]
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    yellow = (r > 170) & (g > 120) & (b < 140) & (r - b > 90)
    silver = (r + g + b > 420) & ~yellow
    # the generated tile is a rounded square filling the frame; its corners measure ~13% of the side
    rad = round(n * 0.131)

    def svg(rounded: bool) -> str:
        rx = ' rx="%d"' % rad if rounded else ""
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}" width="{n}" height="{n}">'
            f'<rect width="{n}" height="{n}"{rx} fill="#0b0f22"/>'
            f'<g fill="#e6ebf5">{potrace_paths(silver)}</g><g fill="#ffd23f">{potrace_paths(yellow)}</g></svg>\n'
        )

    (PUB / "favicon.svg").write_text(svg(True))
    with tempfile.TemporaryDirectory() as td:
        sq = Path(td) / "square.svg"
        sq.write_text(svg(False))
        for name, size, src in [
            ("favicon-32.png", 32, PUB / "favicon.svg"),
            ("icon-192.png", 192, PUB / "favicon.svg"),
            ("icon-512.png", 512, PUB / "favicon.svg"),
            ("apple-touch-icon.png", 180, sq),  # iOS rounds it itself
        ]:
            subprocess.run(
                [
                    "rsvg-convert",
                    "-w",
                    str(size),
                    "-h",
                    str(size),
                    "-o",
                    str(PUB / name),
                    str(src),
                ],
                check=True,
            )
    print("favicon.svg", (PUB / "favicon.svg").stat().st_size, "bytes")


def og_card() -> None:
    im = Image.open(SRC / "OG_01.png").convert("RGB")
    w, h = im.size
    ch = round(w * 630 / 1200)
    y0 = min(h - ch, 20)
    im = im.crop((0, y0, w, y0 + ch)).resize((1200, 630), Image.LANCZOS)
    # a navy wash over the left half keeps the title readable over the bright sky
    ramp = np.clip(1 - np.arange(1200) / 660, 0, 1) ** 1.4 * 205
    wash = Image.fromarray(np.tile(ramp.astype(np.uint8), (630, 1)), "L")
    im = Image.composite(Image.new("RGB", im.size, NAVY), im, wash)
    d = ImageDraw.Draw(im)
    big = ImageFont.truetype(str(FONT), 94)
    small = ImageFont.truetype(str(FONT), 30)
    x = 64
    d.text((x, 160), "LATE", font=big, fill=(255, 255, 255))
    d.text((x, 258), "ROADSTER", font=big, fill=(255, 255, 255))
    d.text((x + 4, 376), "T H I S   S I D E   U P", font=small, fill=YELLOW)
    d.text((x + 2, 444), "90 seconds. Don't be late.", font=small, fill=(220, 226, 240))
    im.save(PUB / "og.jpg", quality=86, optimize=True, progressive=True)
    print("og.jpg", (PUB / "og.jpg").stat().st_size, "bytes")


def thumbs() -> None:
    out = PUB / "assets/clips"
    out.mkdir(parents=True, exist_ok=True)
    for src, cid in CLIPS.items():
        im = Image.open(SRC / (src + ".png")).convert("RGB")
        im = im.resize((480, 270), Image.LANCZOS).filter(
            ImageFilter.UnsharpMask(1.2, 40, 2)
        )
        im.save(out / (cid + ".webp"), quality=80, method=6)
    for tile, (src, fy) in TILES.items():
        im = Image.open(SRC / (src + ".png")).convert("RGB")
        w, h = im.size
        ch = round(w / 2)
        y0 = round((h - ch) * fy)
        im = im.crop((0, y0, w, y0 + ch)).resize((480, 240), Image.LANCZOS)
        im.filter(ImageFilter.UnsharpMask(1.2, 40, 2)).save(
            PUB / "assets/lobby" / (tile + ".webp"), quality=80, method=6
        )
    total = sum(f.stat().st_size for f in out.glob("*.webp"))
    print("clips", len(list(out.glob("*.webp"))), "files", total // 1024, "KiB")


def warm(im: Image.Image, k=(1.05, 0.97, 0.88)) -> Image.Image:
    """tint a cut-out towards the low warm sun of the R_05 plate"""
    a = np.asarray(im).astype(np.float32)
    a[..., :3] *= k
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def peloton() -> None:
    bg = R3 / "R_05.png"
    bg = (
        Image.open(bg)
        .convert("RGB")
        .crop((0, 30, 530, 328))
        .resize((960, 540), Image.LANCZOS)
        .convert("RGBA")
    )
    riders = [
        Image.open(PUB / f"assets/photo/BK_R{i}.webp").convert("RGBA")
        for i in range(1, 6)
    ]
    shadow = Image.new("L", bg.size, 0)
    sd = ImageDraw.Draw(shadow)
    layer = Image.new("RGBA", bg.size)
    # five abreast across two lanes, feet on the road ~60 m out: (x, feet y, scale)
    place = [
        (250, 345, 0.92),
        (345, 360, 1.0),
        (440, 350, 0.96),
        (535, 362, 1.02),
        (625, 348, 0.93),
    ]
    for (x, y, s), r in sorted(zip(place, riders), key=lambda t: t[0][1]):
        h = int(140 * s)
        w = int(r.width * h / r.height)
        sd.ellipse((x - w * 0.45, y - 6, x + w * 0.45, y + 6), fill=110)
        layer.alpha_composite(
            warm(r.resize((w, h), Image.LANCZOS)).filter(ImageFilter.GaussianBlur(0.6)),
            (int(x - w / 2), y - h),
        )
    dark = Image.new("RGBA", bg.size, (20, 18, 22, 255))
    dark.putalpha(shadow.filter(ImageFilter.GaussianBlur(5)))
    bg.alpha_composite(dark)
    bg.alpha_composite(layer)
    car, _, _ = trim_grounded(key_image(Image.open(R3 / "R_07.png")))
    cw = 190
    car = warm(car.resize((cw, int(car.height * cw / car.width)), Image.LANCZOS))
    car = car.rotate(-6, resample=Image.BICUBIC, expand=True)
    cx, cby = 450, 180
    plume = Image.new("RGBA", bg.size, (0, 0, 0, 0))
    pd = ImageDraw.Draw(plume)
    for dx in (-64, -24, 24, 64):
        for k in range(14):
            yy, rad = cby - 14 + k * 8, 6 + k * 2.0
            pd.ellipse(
                (cx + dx - rad, yy - rad * 0.7, cx + dx + rad, yy + rad * 0.7),
                fill=(236, 242, 248, int(235 * (1 - k / 14) ** 1.3)),
            )
    bg.alpha_composite(plume.filter(ImageFilter.GaussianBlur(3)))
    bg.alpha_composite(car, (cx - car.width // 2, cby - car.height))
    # a bystander's handheld tilt, cropped back to 16:9
    out = bg.convert("RGB").rotate(1.6, resample=Image.BICUBIC)
    m = int(960 * 0.03)
    out = out.crop((m, int(m * 0.5625), 960 - m, 540 - int(m * 0.5625))).resize(
        (480, 270), Image.LANCZOS
    )
    out.save(PUB / "assets/clips/peloton.webp", quality=80, method=6)
    print("peloton.webp", (PUB / "assets/clips/peloton.webp").stat().st_size, "bytes")


if __name__ == "__main__":
    favicon()
    og_card()
    thumbs()
    peloton()
