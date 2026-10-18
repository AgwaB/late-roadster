// Canvas textures for the visual memes: stage banner, pothole water, underside sticker, toll lane signal, roof sign,
// flying-cart store sign. All text is fictional and English-only.
import * as THREE from "three";

function canvas(
  w: number,
  h: number,
): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}
function tex(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function bold(ctx: CanvasRenderingContext2D, px: number): void {
  ctx.font = "900 " + px + 'px "Arial Black", Impact, sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
}

/** Pothole decal: broken asphalt rim around a puddle that reflects the sky. Alpha-masked. */
export function potholeTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ring = (r0: number, jag: number, fill: string) => {
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const r = r0 * (1 - jag * rnd());
      ctx.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r * 0.86);
    }
    ctx.fillStyle = fill;
    ctx.fill();
  };
  ring(124, 0.18, "rgba(40,38,36,0.85)"); // crumbled edge
  ring(104, 0.14, "rgba(18,18,20,1)"); // hole
  const g = ctx.createRadialGradient(110, 118, 4, 128, 128, 90);
  g.addColorStop(0, "rgba(190,215,230,0.95)");
  g.addColorStop(0.6, "rgba(70,95,115,1)");
  g.addColorStop(1, "rgba(25,30,36,1)");
  ctx.beginPath();
  ctx.ellipse(128, 128, 86, 74, 0, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  for (let i = 0; i < 26; i++) {
    // loose chunks around the rim
    const k = 60 + rnd() * 40;
    ctx.fillStyle = "rgb(" + k + "," + (k - 2) + "," + (k - 5) + ")";
    const a = rnd() * Math.PI * 2,
      r = 100 + rnd() * 22;
    ctx.fillRect(
      128 + Math.cos(a) * r,
      128 + Math.sin(a) * r * 0.86,
      4 + rnd() * 8,
      3 + rnd() * 6,
    );
  }
  return tex(c);
}

/** Underside sticker seen from the street when a roadster flies over: "THIS SIDE UP" between hazard stripes. */
export function undersideTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 256);
  ctx.fillStyle = "#f2c230";
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = "#111";
  for (let x = -64; x < 512; x += 48)
    for (const y of [0, 216]) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 24, y);
      ctx.lineTo(x + 64, y + 40);
      ctx.lineTo(x + 40, y + 40);
      ctx.fill();
    }
  bold(ctx, 64);
  ctx.fillText("THIS SIDE UP", 256, 128);
  return tex(c);
}

/** Small roof sign next to the roof-parked roadsters. */
export function roofSignTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 256);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = "#1d4ed8";
  ctx.fillRect(12, 12, 488, 232);
  bold(ctx, 130);
  ctx.fillStyle = "#fff";
  ctx.fillText("P", 92, 132);
  bold(ctx, 44);
  ctx.textAlign = "left";
  ctx.fillText("ROOF PARKING", 166, 96);
  ctx.fillText("ROADSTERS ONLY", 166, 164);
  return tex(c);
}

/** Store front sign for the flying shopping carts. */
export function martSignTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 256);
  ctx.fillStyle = "#f5f1e6";
  ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = "#e0312b";
  ctx.fillRect(0, 0, 1024, 26);
  ctx.fillRect(0, 230, 1024, 26);
  bold(ctx, 120);
  ctx.fillText("ORBIT MART", 512, 112);
  bold(ctx, 40);
  ctx.fillStyle = "#222";
  ctx.fillText("NOW WITH JET-ASSIST CARTS", 512, 194);
  return tex(c);
}

/** Yellow/black diagonal hazard stripes (island noses). */
export function hazardStripeTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f2c200";
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#151515";
  for (let k = -128; k < 256; k += 48) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + 24, 0);
    g.lineTo(k + 24 + 128, 128);
    g.lineTo(k + 128, 128);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Toll canopy fascia (one face, ~35 x 1 m): navy band, a TOLL panel over the median, a green down-arrow over each
 * lane coming in (right half, as the driver sees it) and a red cross over the other direction's lanes. lanes: lane
 * centre offsets from the median as a fraction of the fascia width.
 */
export function tollFasciaTexture(lanes: number[]): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 2048;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#14294d";
  g.fillRect(0, 0, 2048, 64);
  g.fillStyle = "#e8ebee";
  g.fillRect(0, 0, 2048, 4);
  g.fillRect(0, 60, 2048, 4);
  const cx = 1024;
  g.fillStyle = "#ffffff";
  g.font = "900 40px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("TOLL", cx, 34);
  for (const f of lanes) {
    // approach lane: green arrow pointing down
    const xa = cx + f * 2048;
    g.fillStyle = "#0b0d10";
    g.fillRect(xa - 26, 8, 52, 48);
    g.fillStyle = "#3dff6a";
    g.beginPath();
    g.moveTo(xa - 8, 14);
    g.lineTo(xa + 8, 14);
    g.lineTo(xa + 8, 32);
    g.lineTo(xa + 18, 32);
    g.lineTo(xa, 52);
    g.lineTo(xa - 18, 32);
    g.lineTo(xa - 8, 32);
    g.closePath();
    g.fill();
    // the other direction's lane: red cross
    const xb = cx - f * 2048;
    g.fillStyle = "#0b0d10";
    g.fillRect(xb - 26, 8, 52, 48);
    g.strokeStyle = "#ff3030";
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(xb - 14, 18);
    g.lineTo(xb + 14, 46);
    g.moveTo(xb + 14, 18);
    g.lineTo(xb - 14, 46);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** "FLYERS $0" painted on the toll canopy roof (transparent, yellow), read by whoever flies in over it. */
export function flyersRoofTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 192;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffd23f";
  g.font = "900 150px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("FLYERS $0", 512, 100);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
