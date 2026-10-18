#!/usr/bin/env bash
# Shrink the shipped asset payload (SPEC §11 load budget):
#  - every GLB (tools/optimize_glb.mjs): meshopt compression, positions/normals quantised, UVs kept float
#    (the game rebinds textures onto them), embedded textures -> WebP <= 1024 px.
#    Scene graph, node names (wheels), extras (bodyW/D/H) and material names (photo:/wall:/roof:) are kept.
#  - loose textures: JPG/PNG -> WebP (normal maps capped at 1024 px), originals removed.
# Usage: tools/optimize_assets.sh   (idempotent: already-compressed GLBs are skipped)
set -euo pipefail
cd "$(dirname "$0")/.."
# tool deps live outside the game's package.json
TOOLS=${OPT_TOOLS_DIR:-/tmp/lr-gltf-tools}
if [ ! -d "$TOOLS/node_modules/@gltf-transform/functions" ]; then
  mkdir -p "$TOOLS" && (cd "$TOOLS" && npm init -y >/dev/null && npm i --silent @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 @gltf-transform/functions@4.5.1 meshoptimizer sharp >/dev/null)
fi
cp tools/optimize_glb.mjs "$TOOLS/opt.mjs"
# (cars/ = Kenney kit GLBs with an external texture reference; small, left as shipped)
for f in public/assets/{pp,gen,ph}/*.glb; do
  if grep -q EXT_meshopt_compression "$f"; then continue; fi
  tmp="$PWD/${f%.glb}.opt.glb"
  if (cd "$TOOLS" && node opt.mjs "$OLDPWD/$f" "$tmp" >/dev/null 2>&1); then
    mv "$tmp" "$f"
  else
    rm -f "$tmp"
    echo "skip $f"
  fi
done
python3 - <<'EOF'
import glob, os
from PIL import Image
def conv(src, q, max_side=None):
    im = Image.open(src)
    if max_side and max(im.size) > max_side:
        s = max_side / max(im.size)
        im = im.resize((round(im.size[0] * s), round(im.size[1] * s)), Image.LANCZOS)
    dst = os.path.splitext(src)[0] + ".webp"
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA" if "A" in im.mode or "transparency" in im.info else "RGB")
    im.save(dst, "WEBP", quality=q, method=6)
    os.remove(src)
for f in glob.glob("public/assets/tex/*.jpg") + glob.glob("public/assets/ph/facade/*.jpg"):
    n = os.path.basename(f)
    normal = n.endswith("_n.jpg") or "_nor_" in n or n.endswith("_arm.jpg")
    conv(f, 82 if not normal else 85, 1024 if normal else None)
for f in glob.glob("public/assets/photo/*.jpg"):
    conv(f, 82)
for f in glob.glob("public/assets/gen/tree_*.png"):
    conv(f, 85)
EOF
du -sh public/assets
