// Procedural canvas textures for the Raycity look: bright building facades with window rows and a ground-floor
// signboard band, chain-link fence, billboard trees.
import * as THREE from "three";

function tex(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
const pick = <T>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const WALLS = [
  "#f2f0ea",
  "#e9e4d8",
  "#dfe3e8",
  "#f5f3ee",
  "#e6e9ee",
  "#ece6da",
  "#d9dde3",
  "#f0ece2",
];
const SIGNS = [
  "#e8352b",
  "#1f6fd1",
  "#f2b61c",
  "#19a35a",
  "#7a3ae0",
  "#ff7a1a",
  "#111111",
  "#ffffff",
  "#e8352b",
  "#1f6fd1",
];

/** Upper floors: 1 tile = 8 m wide x 3.5 m tall (one floor), tiles vertically. */
export function floorsTexture(seed: number): THREE.CanvasTexture {
  const r = rng(seed);
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 224;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = pick(r, WALLS);
  ctx.fillRect(0, 0, 512, 224);
  // subtle panel lines
  ctx.fillStyle = "rgba(0,0,0,0.07)";
  ctx.fillRect(0, 0, 512, 6);
  ctx.fillRect(0, 218, 512, 6);
  const n = 3 + Math.floor(r() * 3); // windows per 8 m
  const ww = 512 / n;
  const wide = r() < 0.4; // strip windows
  for (let i = 0; i < n; i++) {
    const x0 = i * ww + (wide ? 6 : ww * 0.22),
      x1 = (i + 1) * ww - (wide ? 6 : ww * 0.22);
    const g = ctx.createLinearGradient(0, 40, 0, 190);
    g.addColorStop(0, "#9fc3e8");
    g.addColorStop(0.5, "#5c86b8");
    g.addColorStop(1, "#2d4e78");
    ctx.fillStyle = g;
    ctx.fillRect(x0, 46, x1 - x0, 140);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(x0, 46, x1 - x0, 14);
    ctx.strokeStyle = "rgba(40,50,60,0.6)";
    ctx.lineWidth = 3;
    ctx.strokeRect(x0, 46, x1 - x0, 140);
    ctx.fillStyle = "rgba(30,40,55,0.5)";
    ctx.fillRect(x0 + (x1 - x0) / 2 - 2, 46, 4, 140);
  }
  return tex(c);
}

/** Ground floor: 1 tile = 8 m wide x 4.5 m tall: glass storefront + colourful signboard band. Tiles horizontally only. */
export function shopTexture(seed: number): THREE.CanvasTexture {
  const r = rng(seed);
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 288;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = pick(r, ["#cfcac0", "#bfc2c6", "#d8d2c6", "#c9ccd1"]);
  ctx.fillRect(0, 0, 512, 288);
  // storefront glass (bottom 60%)
  const g = ctx.createLinearGradient(0, 110, 0, 288);
  g.addColorStop(0, "#6f93b8");
  g.addColorStop(1, "#2b4360");
  ctx.fillStyle = g;
  ctx.fillRect(14, 112, 484, 176);
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(14, 112, 484, 22);
  ctx.fillStyle = "#3a3f46";
  for (let x = 14; x <= 498; x += 121) ctx.fillRect(x - 3, 112, 6, 176);
  ctx.fillStyle = "#2a2d33";
  ctx.fillRect(0, 282, 512, 6);
  // signboards: 2-3 panels across the band (top 35%)
  const k = 2 + Math.floor(r() * 2);
  const pw = 512 / k;
  for (let i = 0; i < k; i++) {
    const col = pick(r, SIGNS);
    ctx.fillStyle = col;
    ctx.fillRect(i * pw + 6, 14, pw - 12, 84);
    ctx.fillStyle =
      col === "#ffffff" || col === "#f2b61c" ? "#1a1a1a" : "#ffffff";
    // abstract "lettering" blocks
    const m = 3 + Math.floor(r() * 4);
    for (let j = 0; j < m; j++) {
      const bx = i * pw + 22 + j * ((pw - 44) / m);
      ctx.fillRect(bx, 36 + r() * 10, (pw - 44) / m - 10, 28 + r() * 10);
    }
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 3;
    ctx.strokeRect(i * pw + 6, 14, pw - 12, 84);
  }
  // awning stripe under the signs
  ctx.fillStyle = pick(r, ["#c8322b", "#2a62b8", "#2f8f4e", "#444"]);
  ctx.fillRect(0, 98, 512, 12);
  return tex(c);
}

/** Chain-link fence: transparent diamond lattice. */
export function fenceTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = "#d7dbe0";
  ctx.lineWidth = 4;
  for (let i = -128; i < 256; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 128, 128);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i + 128, 0);
    ctx.lineTo(i, 128);
    ctx.stroke();
  }
  return tex(c);
}

/** Leaf-clump card: hundreds of small leaves, dark interior and sunlit rim (Raycity-style regular crowns). */
export function treeTexture(variant = 0): THREE.CanvasTexture {
  const r = rng(99 + variant * 17);
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 512, 512);
  const cx = 256,
    cy = 230,
    R = 215;
  // leaves: draw from dark (inner/back) to light (outer/front)
  for (let i = 0; i < 4200; i++) {
    const a = r() * Math.PI * 2,
      d = r() ** 0.6 * R;
    const x = cx + Math.cos(a) * d,
      y = cy + Math.sin(a) * d * 0.9;
    const t = d / R; // 0 centre .. 1 rim
    const sun = Math.max(0, (-(x - cx) * 0.4 - (y - cy)) / R); // light from upper-left
    const v = 0.22 + 0.4 * t * t + 0.4 * sun + (r() - 0.5) * 0.12;
    const g = Math.min(255, Math.round(70 + 135 * v)),
      rr = Math.round(40 + 70 * v),
      b = Math.round(22 + 40 * v);
    ctx.fillStyle = "rgb(" + rr + "," + g + "," + b + ")";
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(r() * Math.PI);
    ctx.beginPath();
    ctx.ellipse(0, 0, 9 + r() * 7, 5 + r() * 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // trunk + a few branches peeking through
  ctx.strokeStyle = "#4a3a2c";
  ctx.lineWidth = 14;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(256, 512);
  ctx.lineTo(256, 300);
  ctx.stroke();
  ctx.lineWidth = 6;
  for (const [dx, dy] of [
    [-70, -60],
    [60, -80],
    [-30, -120],
    [40, -130],
  ]) {
    ctx.beginPath();
    ctx.moveTo(256, 310);
    ctx.lineTo(256 + dx, 310 + dy);
    ctx.stroke();
  }
  const t = tex(c, false);
  return t;
}

/** 8x8 sign atlas (2048x512) used by the Blender-generated buildings: each cell is one signboard with Korean/English text. */
const SIGN_WORDS = [
  "COFFEE",
  "PIZZA",
  "DENTAL",
  "BANK",
  "GYM",
  "LAUNDRY",
  "PHARMACY",
  "NOODLE",
  "BBQ",
  "BAKERY",
  "HOTEL",
  "TAXI",
  "MART 24H",
  "BARBER",
  "NAILS",
  "OPTICAL",
  "SUSHI",
  "BURGER",
  "TACOS",
  "RAMEN",
  "STUDIO",
  "CLINIC",
  "LAW OFFICE",
  "REALTY",
  "YOGA",
  "PC CAFE",
  "KARAOKE",
  "BILLIARDS",
  "FLOWERS",
  "PHOTO",
  "TATTOO",
  "VAPE",
  "PAWN",
  "LOTTO",
  "DELI",
  "DINER",
  "BOOKS",
  "MUSIC",
  "TOYS",
  "SHOES",
  "PHONE REPAIR",
  "KEYS",
  "PRINT",
  "BUTCHER",
  "WINE",
  "BAR",
  "CAFE",
  "TEA",
  "DONUTS",
  "GRILL",
  "KEBAB",
  "PHO",
  "DIM SUM",
  "CURRY",
  "ACADEMY",
  "DANCE",
  "MARTIAL ARTS",
  "PET SHOP",
  "VET",
  "DRY CLEAN",
  "CAR WASH",
  "TIRES",
  "PARKING",
  "ATM",
];
const SIGN_BG = [
  "#d92b1f",
  "#1a5fcf",
  "#f2b619",
  "#1b9a4d",
  "#141414",
  "#f5f5f5",
  "#e8641a",
  "#7a2bb0",
  "#ffffff",
  "#0d8f9a",
  "#c2185b",
  "#f5f5f5",
];
export function signAtlasTexture(): THREE.CanvasTexture {
  const COLS = 8,
    ROWS = 8,
    CW = 256,
    CH = 64;
  const c = document.createElement("canvas");
  c.width = COLS * CW;
  c.height = ROWS * CH;
  const ctx = c.getContext("2d")!;
  const r = rng(4242);
  for (let i = 0; i < COLS * ROWS; i++) {
    const x = (i % COLS) * CW,
      y = Math.floor(i / COLS) * CH;
    const bg = SIGN_BG[(i * 5 + Math.floor(r() * 3)) % SIGN_BG.length];
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, CW, CH);
    // inner border
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 3, y + 3, CW - 6, CH - 6);
    const dark = ["#f5f5f5", "#ffffff", "#f2b619"].includes(bg);
    ctx.fillStyle = dark ? "#111" : "#fff";
    const word = SIGN_WORDS[i % SIGN_WORDS.length];
    let size = 40;
    ctx.font =
      "bold " +
      size +
      'px "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
    while (ctx.measureText(word).width > CW - 36 && size > 18) {
      size -= 2;
      ctx.font =
        "bold " +
        size +
        'px "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(word, x + CW / 2, y + CH / 2 + 2);
    // small phone-number style line for realism on some signs
    if (r() < 0.4) {
      ctx.font = (dark ? "600 " : "500 ") + "13px sans-serif";
      ctx.fillText(
        "02-" +
          (300 + Math.floor(r() * 600)) +
          "-" +
          (1000 + Math.floor(r() * 9000)),
        x + CW / 2,
        y + CH - 11,
      );
    }
  }
  const t = tex(c, false);
  t.flipY = false; // glTF UV convention (v down) — Blender assigns v with cy counted from the top
  return t;
}

/** Authored daytime sky (bible §3): #85B8E6 blue, soft white cumulus, pale #D9E3DF horizon. Equirect 2048x1024. */
export function skyTexture(): THREE.CanvasTexture {
  const r = rng(7);
  const W = 2048,
    H = 1024;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.0, "#4f86cc");
  g.addColorStop(0.25, "#6ea4dd");
  g.addColorStop(0.42, "#7cb0e2");
  g.addColorStop(0.48, "#9cc2e4");
  g.addColorStop(0.5, "#D9E3DF");
  g.addColorStop(0.52, "#cfd6cd");
  g.addColorStop(1.0, "#9ea39a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // cumulus: clusters of soft discs, flatter and smaller toward the horizon
  const puff = (x: number, y: number, rad: number, a: number) => {
    const gr = ctx.createRadialGradient(x, y, rad * 0.15, x, y, rad);
    gr.addColorStop(0, "rgba(255,255,255," + a + ")");
    gr.addColorStop(0.55, "rgba(255,255,255," + (a * 0.7).toFixed(3) + ")");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  };
  for (let i = 0; i < 26; i++) {
    const y = H * (0.3 + r() * 0.18); // between 0.3 (36° up) and 0.48 (just above the horizon)
    const k = (y / H - 0.3) / 0.18; // 0 high .. 1 near horizon
    const x = r() * W;
    const size = (50 + r() * 70) * (1 - 0.6 * k);
    const n = 5 + Math.floor(r() * 6);
    for (let j = 0; j < n; j++) {
      const dx = (r() - 0.5) * size * 2.4,
        dy = (r() - 0.7) * size * 0.7;
      puff(x + dx, y + dy, size * (0.45 + r() * 0.5), 0.45 + r() * 0.3);
      // wrap seam
      if (x + dx > W - 300)
        puff(x + dx - W, y + dy, size * (0.45 + r() * 0.5), 0.6);
      if (x + dx < 300)
        puff(x + dx + W, y + dy, size * (0.45 + r() * 0.5), 0.6);
    }
    // slightly shaded underside
    ctx.fillStyle = "rgba(160,175,195,0.18)";
    ctx.beginPath();
    ctx.ellipse(x, y + size * 0.35, size * 1.3, size * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

/** Green overhead direction board (English destinations, white border, arrows). 1024x512, two destinations per board. */
export function directionBoardTexture(
  top: string,
  bottom: string,
  arrowTop: string,
  arrowBottom: string,
  route: string,
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#1f7a3f";
  ctx.fillRect(0, 0, 1024, 512);
  ctx.strokeStyle = "#f4f7f2";
  ctx.lineWidth = 14;
  ctx.strokeRect(18, 18, 988, 476);
  ctx.fillStyle = "#f4f7f2";
  ctx.font = "bold 150px Helvetica, Arial, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(arrowTop, 60, 150);
  ctx.fillText(arrowBottom, 60, 370);
  ctx.font = "bold 120px Helvetica, Arial, sans-serif";
  ctx.fillText(top, 230, 150);
  ctx.fillText(bottom, 230, 370);
  // route shield
  ctx.fillStyle = "#f4f7f2";
  ctx.beginPath();
  ctx.roundRect(820, 60, 150, 110, 18);
  ctx.fill();
  ctx.fillStyle = "#1f7a3f";
  ctx.font = "bold 82px Helvetica, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(route, 895, 118);
  // divider
  ctx.fillStyle = "#f4f7f2";
  ctx.fillRect(60, 254, 740, 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Tunnel wall: grey ceramic tile courses, dark lower band, hazard curb stripe. 1 tile = 6 m (world UVs). */
export function tunnelWallTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#b9bcb6";
  ctx.fillRect(0, 0, 256, 256);
  // tile grout (0.3 m tiles -> ~13 px)
  ctx.fillStyle = "#9ea19b";
  for (let y = 0; y < 256; y += 13) ctx.fillRect(0, y, 256, 1);
  for (let x = 0; x < 256; x += 13) ctx.fillRect(x, 0, 1, 256);
  // grime gradient toward the bottom third
  const g = ctx.createLinearGradient(0, 160, 0, 256);
  g.addColorStop(0, "rgba(60,58,50,0)");
  g.addColorStop(1, "rgba(60,58,50,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 160, 256, 96);
  // dark service band + hazard stripe along the curb (bottom of the tile = ground)
  ctx.fillStyle = "#4d4f4b";
  ctx.fillRect(0, 214, 256, 42);
  for (let x = 0; x < 256; x += 32) {
    ctx.fillStyle = "#e2c338";
    ctx.fillRect(x, 236, 16, 20);
    ctx.fillStyle = "#222";
    ctx.fillRect(x + 16, 236, 16, 20);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Fictional billboard adverts (English, no real brands): bold type on colour blocks, 1024x448. */
export function billboardAdTexture(i: number): THREE.CanvasTexture {
  const ADS: [string, string, string, string, string][] = [
    // headline, sub, bg, accent, ink
    ["VOLT", "ENERGY DRINK", "#f2c200", "#111111", "#111111"],
    ["Sunday Burger", "OPEN 24H", "#c8102e", "#ffffff", "#ffffff"],
    ["NOVA mobile", "FAST 5G", "#0b3d91", "#79c7ff", "#ffffff"],
    ["Harbor Cola", "ICE COLD", "#1b1b1b", "#e63946", "#ffffff"],
    ["Blue Tiger Air", "FLIGHTS FROM $49", "#1d8fbf", "#ffffff", "#ffffff"],
    [
      "MEGA MART 24H",
      "EVERYTHING · EVERY NIGHT",
      "#2a9d4f",
      "#ffffff",
      "#ffffff",
    ],
  ];
  const [head, sub, bg, accent, ink] = ADS[i % ADS.length];
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 448;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1024, 448);
  // accent shape: big circle / diagonal band per variant
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.9;
  if (i % 3 === 0) {
    ctx.beginPath();
    ctx.arc(820, 224, 170, 0, Math.PI * 2);
    ctx.fill();
  } else if (i % 3 === 1) {
    ctx.beginPath();
    ctx.moveTo(700, 0);
    ctx.lineTo(1024, 0);
    ctx.lineTo(1024, 448);
    ctx.lineTo(560, 448);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillRect(0, 330, 1024, 118);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = ink;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = "bold 150px Helvetica, Arial, sans-serif";
  ctx.fillText(head, 50, 180);
  ctx.font = "bold 44px Helvetica, Arial, sans-serif";
  ctx.fillStyle = i % 3 === 2 ? bg : ink;
  ctx.fillText(sub, 56, i % 3 === 2 ? 390 : 300);
  // frame
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 1014, 438);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Lane wear overlay (multiply): one lane across u (two darker wheel paths), noisy along v. Tiles 3.5 m x 20 m. */
export function laneWearTexture(): THREE.CanvasTexture {
  const r = rng(4242);
  const W = 128,
    H = 512;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(W, H);
  // low-frequency noise along v so the wear fades in and out
  const n1 = Array.from({ length: 16 }, () => 0.6 + r() * 0.4);
  for (let y = 0; y < H; y++) {
    const t = (y / H) * 16,
      i0 = Math.floor(t) % 16,
      i1 = (i0 + 1) % 16,
      f = t - Math.floor(t);
    const amp = n1[i0] * (1 - f) + n1[i1] * f;
    for (let x = 0; x < W; x++) {
      const u = x / W; // 0..1 across the lane
      const wheel =
        Math.exp(-(((u - 0.27) / 0.09) ** 2)) +
        Math.exp(-(((u - 0.73) / 0.09) ** 2));
      const grain = (r() - 0.5) * 0.06;
      const v = 1 - wheel * 0.16 * amp + grain;
      const k = Math.max(0, Math.min(1, v)) * 255;
      const i = (y * W + x) * 4;
      img.data[i] = k;
      img.data[i + 1] = k;
      img.data[i + 2] = k;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
/** Sparse road stains / patches (multiply): oil spots, repair patches, crack lines. Tiles 24 m. */
export function roadStainTexture(): THREE.CanvasTexture {
  const r = rng(777);
  const S = 512;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, S, S);
  // repair patches: slightly darker rectangles with soft edges
  for (let i = 0; i < 5; i++) {
    const x = r() * S,
      y = r() * S,
      w = 40 + r() * 120,
      h = 20 + r() * 60;
    ctx.fillStyle = "rgba(0,0,0," + (0.05 + r() * 0.08).toFixed(3) + ")";
    ctx.fillRect(x, y, w, h);
  }
  // oil / grime blobs
  for (let i = 0; i < 9; i++) {
    const x = r() * S,
      y = r() * S,
      rad = 8 + r() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, "rgba(0,0,0," + (0.18 + r() * 0.15).toFixed(3) + ")");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  // cracks
  ctx.strokeStyle = "rgba(0,0,0,0.22)";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 7; i++) {
    let x = r() * S,
      y = r() * S;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      x += (r() - 0.5) * 60;
      y += (r() - 0.5) * 60;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/**
 * Rooftop advert variant: a stock chart that does a loop-the-loop (the "chart doing the Roadster stunt" meme).
 * Fictional tickers only (no real company names). variant 0: climbs into a ramp loop and ends high;
 * variant 1: does a full 360 and lands exactly where it started.
 */
export function stockChartTexture(variant: number): THREE.CanvasTexture {
  const W = 1024,
    H = 436;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0b0e14";
  g.fillRect(0, 0, W, H);
  const v = variant % 2;
  const ticker = v === 0 ? "RDST" : "ORBT";
  const sub = v === 0 ? "MOTOR INDEX 2026" : "ORBIT EXCHANGE 2026";
  const change = v === 0 ? "±∞%" : "\u25B2 +0.00% (it flipped)";
  g.textBaseline = "alphabetic";
  g.fillStyle = "#ffffff";
  g.font = "800 44px system-ui, sans-serif";
  g.fillText(ticker, 40, 64);
  g.fillStyle = "#8b93a1";
  g.font = "500 18px system-ui, sans-serif";
  g.fillText(sub, 40 + g.measureText(ticker).width * 2.2 + 16, 62);
  g.fillStyle = "#ffffff";
  g.font = "800 50px system-ui, sans-serif";
  g.fillText(v === 0 ? "$1,069.42" : "$420.69", 40, 124);
  g.fillStyle = "#39d353";
  g.font = "700 26px system-ui, sans-serif";
  g.fillText(change, 300, 122);
  // range chips, the last one is the joke
  const chips = [
    "1D",
    "5D",
    "1M",
    "6M",
    "YTD",
    "1Y",
    v === 0 ? "LOOP" : "FLIP",
  ];
  g.font = "700 16px system-ui, sans-serif";
  let cx = 40;
  for (const ch of chips) {
    const w = g.measureText(ch).width + 14;
    const last = ch === chips[chips.length - 1];
    g.fillStyle = last ? "#39d353" : "#1b2130";
    g.fillRect(cx, 140, w, 24);
    g.fillStyle = last ? "#0b0e14" : "#8b93a1";
    g.fillText(ch, cx + 7, 158);
    cx += w + 6;
  }
  // plot area
  const x0 = 60,
    x1 = 900,
    y0 = 180,
    y1 = 400;
  g.strokeStyle = "#1a2030";
  g.lineWidth = 1;
  for (let i = 0; i <= 6; i++) {
    const y = y0 + ((y1 - y0) * i) / 6;
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x1, y);
    g.stroke();
    g.fillStyle = "#5b6475";
    g.font = "500 13px system-ui, sans-serif";
    g.fillText("$" + (1300 - i * 160).toLocaleString("en-US"), x1 + 10, y + 4);
  }
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  months.forEach((m, i) => {
    g.fillStyle = "#5b6475";
    g.fillText(m, x0 + ((x1 - x0) * (i + 0.3)) / 12, y1 + 22);
  });
  // noisy flat start
  const pts: [number, number][] = [];
  let y = 372;
  const flatEnd = v === 0 ? x0 + (x1 - x0) * 0.42 : x0 + (x1 - x0) * 0.4;
  for (let x = x0; x <= flatEnd; x += 6) {
    y +=
      Math.sin(x * 0.11) * 2.2 +
      Math.sin(x * 0.037) * 1.4 +
      (((x * 7919) % 13) - 6) * 0.35;
    y = Math.min(390, Math.max(355, y));
    pts.push([x, y]);
  }
  const [lx, ly] = pts[pts.length - 1];
  // area under the flat part
  const grad = g.createLinearGradient(0, 340, 0, y1);
  grad.addColorStop(0, "rgba(57,211,83,0.28)");
  grad.addColorStop(1, "rgba(57,211,83,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(pts[0][0], y1);
  for (const [px, py] of pts) g.lineTo(px, py);
  g.lineTo(lx, y1);
  g.closePath();
  g.fill();
  const curve: [number, number][] = [];
  if (v === 0) {
    // ramp loop: sweep right and up around a D-shaped arc, finish heading left at the top
    const r = 105,
      ccx = lx + 190,
      ccy = ly - r;
    for (let x = lx; x <= ccx; x += 6)
      curve.push([x, ly - ((x - lx) / (ccx - lx)) ** 3 * 4]);
    for (let a = Math.PI / 2; a >= -Math.PI / 2; a -= 0.05)
      curve.push([ccx + Math.cos(a) * r, ccy + Math.sin(a) * r]);
    for (let x = ccx; x >= ccx - 150; x -= 6)
      curve.push([x, ccy - r + Math.sin(x * 0.2) * 1.5]);
    // ramp band + hatched deck + scaffold tower behind the line
    g.strokeStyle = "#262c37";
    g.lineWidth = 26;
    g.beginPath();
    g.arc(ccx, ccy, r, Math.PI / 2, -Math.PI / 2, true);
    g.stroke();
    g.fillStyle = "#262c37";
    g.fillRect(ccx - 160, ccy - r - 30, 200 + r, 14);
    g.strokeStyle = "#3a4250";
    g.lineWidth = 2;
    for (let hx = ccx - 160; hx < ccx + r + 40; hx += 10) {
      g.beginPath();
      g.moveTo(hx, ccy - r - 16);
      g.lineTo(hx + 10, ccy - r - 30);
      g.stroke();
    }
    const tx = ccx + r + 26;
    g.strokeStyle = "#3a4250";
    g.strokeRect(tx, ccy - r - 30, 24, y1 - (ccy - r - 30));
    for (let ty = ccy - r - 30; ty < y1; ty += 24) {
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(tx + 24, ty + 24);
      g.moveTo(tx + 24, ty);
      g.lineTo(tx, ty + 24);
      g.stroke();
    }
  } else {
    // full 360: up, over the top, down and onwards at the same level
    const r = 70,
      ccx = lx + 90,
      ccy = ly - r;
    for (let x = lx; x <= ccx; x += 6) curve.push([x, ly]);
    for (let a = Math.PI / 2; a >= -1.5 * Math.PI; a -= 0.05)
      curve.push([ccx + Math.cos(a) * r, ccy + Math.sin(a) * r]);
    for (let x = ccx; x <= x1 - 20; x += 6)
      curve.push([x, ly + Math.sin(x * 0.13) * 2]);
  }
  g.save();
  g.shadowColor = "rgba(57,211,83,0.9)";
  g.shadowBlur = 14;
  g.strokeStyle = "#39d353";
  g.lineWidth = 4;
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (const [px, py] of pts) g.lineTo(px, py);
  for (const [px, py] of curve) g.lineTo(px, py);
  g.stroke();
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Green sign hung under the skyway's west end: tells players the deck is reachable with E. */
export function skywaySignTexture(): THREE.CanvasTexture {
  const W = 1024,
    H = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#11713a";
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "#ffffff";
  g.lineWidth = 8;
  g.strokeRect(12, 12, W - 24, H - 24);
  g.fillStyle = "#ffffff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  // up arrow
  g.beginPath();
  g.moveTo(120, 60);
  g.lineTo(190, 140);
  g.lineTo(145, 140);
  g.lineTo(145, 200);
  g.lineTo(95, 200);
  g.lineTo(95, 140);
  g.lineTo(50, 140);
  g.closePath();
  g.fill();
  g.font = "800 120px system-ui, sans-serif";
  g.fillText("SKYWAY", 560, 108);
  g.font = "700 56px system-ui, sans-serif";
  g.fillStyle = "#ffd23f";
  g.fillText("PRESS E", 560, 200);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * The giant LED stock board over the river-tunnel mouth: huge ticker and change on top, the loop-the-loop chart
 * (cropped from stockChartTexture) filling the rest. Fictional ticker only.
 */
export function stockBoardTexture(variant = 0): THREE.CanvasTexture {
  const v = variant % 2;
  const src = stockChartTexture(v).image as HTMLCanvasElement;
  const ticker = v === 0 ? "RDST" : "ORBT";
  const W = 2048,
    H = 1024;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#05070b";
  g.fillRect(0, 0, W, H);
  g.textBaseline = "alphabetic";
  g.fillStyle = "#ffffff";
  g.font = "900 230px system-ui, sans-serif";
  g.fillText(ticker, 60, 250);
  const tw = g.measureText(ticker).width;
  g.fillStyle = "#39d353";
  g.font = "900 180px system-ui, sans-serif";
  g.fillText(v === 0 ? "\u25B2 +\u221E%" : "\u25B2 +0.00%", 60 + tw + 70, 245);
  g.fillStyle = "#8b93a1";
  g.font = "600 54px system-ui, sans-serif";
  g.fillText(
    v === 0 ? "$1,069.42  MOTOR INDEX  LIVE" : "$420.69  ORBIT EXCHANGE  LIVE",
    64,
    330,
  );
  // chart band: the plot area of the small board, scaled up
  g.drawImage(src, 0, 170, 1024, 266, 24, 380, 2000, 520);
  g.fillStyle = "#39d353";
  g.fillRect(0, H - 70, W, 70);
  g.fillStyle = "#05070b";
  g.font = "900 54px system-ui, sans-serif";
  g.fillText("MARKET OPEN 8:59", 60, H - 16);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Scrolling ticker strip under the stock board (wraps horizontally; animate texture.offset.x). */
export function tickerStripTexture(): THREE.CanvasTexture {
  const W = 2048,
    H = 128;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#05070b";
  g.fillRect(0, 0, W, H);
  g.textBaseline = "middle";
  g.font = "800 64px system-ui, sans-serif";
  const items: [string, string, boolean][] = [
    ["RDST", "+\u221E%", true],
    ["ORBT", "+0.00%", true],
    ["LATE", "-100%", false],
    ["JETS", "+12%", true],
    ["NAPS", "-3%", false],
  ];
  let x = 30;
  for (const [name, chg, up] of items) {
    g.fillStyle = "#ffffff";
    g.fillText(name, x, H / 2);
    x += g.measureText(name).width + 20;
    g.fillStyle = up ? "#39d353" : "#ff5a4f";
    g.fillText((up ? "\u25B2 " : "\u25BC ") + chg, x, H / 2);
    x += g.measureText((up ? "\u25B2 " : "\u25BC ") + chg).width + 70;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
