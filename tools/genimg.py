"""Generate reference/texture images with Gemini image models (uses GEMINI_API_KEY).

python3 tools/genimg.py OUT.png "prompt" [--aspect 3:4] [--size 2K] [--model gemini-3-pro-image] [--ref image.png ...]
"""

import base64
import json
import os
import sys
import urllib.request

args = sys.argv[1:]
out = args[0]
prompt = args[1]


def opt(n, d):
    return args[args.index(n) + 1] if n in args else d


aspect = opt("--aspect", "1:1")
size = opt("--size", "2K")
model = opt("--model", "gemini-3-pro-image")
refs = [args[i + 1] for i, a in enumerate(args) if a == "--ref"]

parts = [{"text": prompt}]
for r in refs:
    with open(r, "rb") as f:
        parts.append(
            {
                "inline_data": {
                    "mime_type": "image/png" if r.endswith(".png") else "image/jpeg",
                    "data": base64.b64encode(f.read()).decode(),
                }
            }
        )
body = {
    "contents": [{"parts": parts}],
    "generationConfig": {
        "responseModalities": ["IMAGE"],
        "imageConfig": {"aspectRatio": aspect, "imageSize": size},
    },
}
req = urllib.request.Request(
    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={os.environ['GEMINI_API_KEY']}",
    data=json.dumps(body).encode(),
    headers={"Content-Type": "application/json"},
)
try:
    with urllib.request.urlopen(req, timeout=300) as resp:
        j = json.load(resp)
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode()[:600])
    sys.exit(1)
saved = False
for c in j.get("candidates", []):
    for p in c.get("content", {}).get("parts", []):
        if "inlineData" in p:
            data = base64.b64decode(p["inlineData"]["data"])
            with open(out, "wb") as f:
                f.write(data)
            saved = True
            print("SAVED", out, len(data), p["inlineData"].get("mimeType"))
        elif "text" in p:
            print("TEXT", p["text"][:200])
if not saved:
    print("NO IMAGE", json.dumps(j)[:800])
    sys.exit(2)
