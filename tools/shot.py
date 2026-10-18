"""Headed Chrome screenshot/fps probe for the local dev server.
usage: python3 tools/shot.py OUT_PREFIX [turn_rad] [drive_s]
"""

import json
import sys

from playwright.sync_api import sync_playwright

out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/lr"
turn = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
drive = float(sys.argv[3]) if len(sys.argv) > 3 else 2.5
FPS_JS = """() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(Math.round(n / 2)); }; requestAnimationFrame(f); })"""
with sync_playwright() as p:
    b = p.chromium.launch(
        channel="chrome",
        headless=False,
        args=["--window-size=1440,900", "--autoplay-policy=no-user-gesture-required"],
    )
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto("http://localhost:5179/", wait_until="load", timeout=60000)
    pg.wait_for_timeout(15000)
    pg.keyboard.down("ArrowUp")
    pg.wait_for_timeout(int(drive * 1000))
    pg.screenshot(path=out + "_a.jpg", type="jpeg", quality=72)
    pg.keyboard.up("ArrowUp")
    pg.keyboard.down("ArrowDown")
    pg.wait_for_timeout(1500)
    pg.keyboard.up("ArrowDown")
    if turn:
        pg.evaluate(
            "(t) => { const c = window.lr.session.car; c.heading += t; c.v = 0; }", turn
        )
        pg.wait_for_timeout(1000)
        pg.screenshot(path=out + "_b.jpg", type="jpeg", quality=72)
    fps = pg.evaluate(FPS_JS)
    info = pg.evaluate(
        "() => { const r = window.lr && window.lr.renderer; return r ? { tris: r.info.render.triangles, calls: r.info.render.calls, geos: r.info.memory.geometries, tex: r.info.memory.textures } : null; }"
    )
    print(json.dumps({"fps": fps, "info": info}))
    b.close()
