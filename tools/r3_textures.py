"""Round-3 textures used directly by game-built planes (no Blender): meme signs, tunnel portal, underside sticker, wheel face.

  python3 tools/r3_textures.py
Writes public/assets/photo/{MS_01..MS_06,TN_01,R08S,R_06W}.webp (loaded via PHOTO_ALPHA, flipY on).
"""

import numpy as np
from PIL import Image, ImageFilter

SRC = "research/raycity/generated/2026-10-17-round3/"
DST = "public/assets/photo/"


def save(im, name, q=88):
  im.save(DST + name + ".webp", "WEBP", quality=q, method=6)
  print(name, im.size, im.mode)


# meme road signs: square, keep as is (they are full-bleed sign faces)
for i in range(1, 7):
  im = (
    Image.open(SRC + "MS_0%d.png" % i).convert("RGB").resize((768, 768), Image.LANCZOS)
  )
  save(im, "MS_0%d" % i)

# tunnel portal headwall: the flat black mouth becomes transparent (soft 1 px edge)
im = Image.open(SRC + "TN_01.png").convert("RGB")
a = np.asarray(im).astype(np.int16)
H, W, _ = a.shape
dark = a.max(2) < 40
box = np.zeros_like(dark)
box[376:, 293:1626] = True
hole = dark & box
alpha = np.where(hole, 0, 255).astype(np.uint8)
al = (
  Image.fromarray(alpha)
  .filter(ImageFilter.MinFilter(3))
  .filter(ImageFilter.GaussianBlur(0.8))
)
rgba = im.copy()
rgba.putalpha(al)
save(rgba, "TN_01", 90)

# underside: the R_08 battery-floor panel with the THIS SIDE UP sticker enlarged in the middle
r8 = Image.open(SRC + "R_08.png").convert("RGB")
b = np.asarray(r8).astype(np.int16)
white = b.min(2) > 225
# the sticker is the white blob near the image centre
cy, cx = b.shape[0] // 2, b.shape[1] // 2
ys, xs = np.where(white[cy - 200 : cy + 200, cx - 300 : cx + 300])
sy0, sy1 = ys.min() + cy - 200, ys.max() + cy - 200
sx0, sx1 = xs.min() + cx - 300, xs.max() + cx - 300
print("sticker bbox", sx0, sy0, sx1, sy1)
sticker = r8.crop((sx0, sy0, sx1 + 1, sy1 + 1)).rotate(
  -90, expand=True
)  # arrow up, text reads left to right
panel = r8.crop((cx - 330, cy - 145, cx + 330, cy + 145)).resize(
  (1024, 448), Image.LANCZOS
)
s = 400 / sticker.size[1]
sticker = sticker.resize((round(sticker.size[0] * s), 400), Image.LANCZOS)
panel.paste(sticker, ((1024 - sticker.size[0]) // 2, 24))
save(panel, "R08S")

# wheel face for the runaway-wheel hazard: circular cut-out
w = (
  Image.open(SRC + "R_06.png")
  .convert("RGB")
  .crop((52, 51, 52 + 1142, 51 + 1142))
  .resize((512, 512), Image.LANCZOS)
)
# the white background shows through between the spokes: fill it with the dark hub/brake shadow
wa = np.asarray(w).astype(np.int16)
gap = wa.min(2) > 200
wa[gap] = (26, 26, 28)
w = Image.fromarray(wa.astype(np.uint8))
yy, xx = np.mgrid[0:512, 0:512]
m = (((xx - 255.5) ** 2 + (yy - 255.5) ** 2) <= 254**2).astype(np.uint8) * 255
w.putalpha(Image.fromarray(m).filter(ImageFilter.GaussianBlur(0.7)))
save(w, "R_06W")
