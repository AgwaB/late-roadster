// City geometry, 2000s-racing-game realism: PBR asphalt/pavers/grass, photo-facade buildings, reflective glass towers,
// lane lines, river, bridges, tunnel + harbour dock, trees, street lights, office beacon.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as C from "../game/constants";
import {
  PARKED_KINDS,
  type Building,
  type City,
  type Prop,
  shortestPath,
} from "../game/city";
import type { LandmarkLayout } from "../game/landmarks";
import { DIRECTION as D, LED } from "../game/signs";
import { KIND_MODEL, blobShadowTexture } from "./vehicles";
import type { Assets } from "./assets";
import {
  fenceTexture,
  floorsTexture,
  shopTexture,
  treeTexture,
  directionBoardTexture,
  tunnelWallTexture,
  billboardAdTexture,
  stockChartTexture,
  skywaySignTexture,
  stockBoardTexture,
  tickerStripTexture,
  laneWearTexture,
  roadStainTexture,
} from "./procTex";

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}
function aabbBox(
  b: { x0: number; y0: number; x1: number; y1: number },
  h0: number,
  h1: number,
): THREE.BufferGeometry {
  return box(
    b.x1 - b.x0,
    h1 - h0,
    b.y1 - b.y0,
    (b.x0 + b.x1) / 2,
    (h0 + h1) / 2,
    -(b.y0 + b.y1) / 2,
  );
}
/** Photo textures are stored glTF-style (flipY = false) for the Blender slabs; in-game planes (v up) need a flipped copy. */
function flipV(t: THREE.Texture): THREE.Texture {
  const c = t.clone();
  c.flipY = true;
  c.needsUpdate = true;
  return c;
}

function colored(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}
/** Ground AO skirt around a footprint: a ring of quads whose vertex colour goes dark at the wall and white at
 *  distance w. Rendered with MultiplyBlending so it only darkens the pavement (cheap contact occlusion). */
function aoSkirt(
  b: { x0: number; y0: number; x1: number; y1: number },
  w: number,
  dark = 0.42,
): THREE.BufferGeometry {
  const H = 0.035;
  const pos: number[] = [],
    col: number[] = [],
    idx: number[] = [];
  const ring = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    nx: number,
    ny: number,
  ) => {
    // inner edge (a->b) dark, outer edge offset by (nx,ny)*w white
    const base = pos.length / 3;
    pos.push(
      ax,
      H,
      -ay,
      bx,
      H,
      -by,
      bx + nx * w,
      H,
      -(by + ny * w),
      ax + nx * w,
      H,
      -(ay + ny * w),
    );
    col.push(dark, dark, dark, dark, dark, dark, 1, 1, 1, 1, 1, 1);
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  // extend corners so the ring closes without gaps
  ring(b.x0 - w, b.y0, b.x1 + w, b.y0, 0, -1);
  ring(b.x1 + w, b.y1, b.x0 - w, b.y1, 0, 1);
  ring(b.x0, b.y1 + w, b.x0, b.y0 - w, -1, 0);
  ring(b.x1, b.y0 - w, b.x1, b.y1 + w, 1, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
/** Horizontal quad (x0..x1, y0..y1 in game coords) at height h with world-space UVs (1 tile = tile metres). */
function quad(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  h: number,
  tile: number,
): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array([
    x0,
    h,
    -y0,
    x1,
    h,
    -y0,
    x1,
    h,
    -y1,
    x0,
    h,
    -y1,
  ]);
  const uv = new Float32Array([
    x0 / tile,
    y0 / tile,
    x1 / tile,
    y0 / tile,
    x1 / tile,
    y1 / tile,
    x0 / tile,
    y1 / tile,
  ]);
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute(
    "normal",
    new THREE.BufferAttribute(
      new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
      3,
    ),
  );
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
/** Four vertical walls of a footprint with facade UVs (u along the wall in metres / tile, v = height / tile). */
function walls(
  b: { x0: number; y0: number; x1: number; y1: number },
  h: number,
  tile: number,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const side = (ax: number, ay: number, bx: number, by: number) => {
    const len = Math.hypot(bx - ax, by - ay);
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([ax, 0, -ay, bx, 0, -by, bx, h, -by, ax, h, -ay]),
        3,
      ),
    );
    const nx = (by - ay) / len,
      nz = (bx - ax) / len; // outward normal for CCW footprint (x right, y north)
    g.setAttribute(
      "normal",
      new THREE.BufferAttribute(
        new Float32Array([nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz]),
        3,
      ),
    );
    g.setAttribute(
      "uv",
      new THREE.BufferAttribute(
        new Float32Array([
          0,
          0,
          len / tile,
          0,
          len / tile,
          h / tile,
          0,
          h / tile,
        ]),
        2,
      ),
    );
    g.setIndex([0, 1, 2, 0, 2, 3]);
    parts.push(g);
  };
  side(b.x0, b.y0, b.x1, b.y0);
  side(b.x1, b.y0, b.x1, b.y1);
  side(b.x1, b.y1, b.x0, b.y1);
  side(b.x0, b.y1, b.x0, b.y0);
  return mergeGeometries(parts, false)!;
}

/** Vertical wall band between h0 and h1; u = metres / tileU, v = (h - h0) / tileV (tileV = h1 - h0 for a single band). */
function wallBand(
  b: { x0: number; y0: number; x1: number; y1: number },
  h0: number,
  h1: number,
  tileU: number,
  tileV: number,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const vT = tileV === 1 ? 1 : (h1 - h0) / tileV;
  const side = (ax: number, ay: number, bx: number, by: number) => {
    const len = Math.hypot(bx - ax, by - ay);
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([ax, h0, -ay, bx, h0, -by, bx, h1, -by, ax, h1, -ay]),
        3,
      ),
    );
    const nx = (by - ay) / len,
      nz = (bx - ax) / len;
    g.setAttribute(
      "normal",
      new THREE.BufferAttribute(
        new Float32Array([nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz]),
        3,
      ),
    );
    g.setAttribute(
      "uv",
      new THREE.BufferAttribute(
        new Float32Array([0, 0, len / tileU, 0, len / tileU, vT, 0, vT]),
        2,
      ),
    );
    g.setIndex([0, 1, 2, 0, 2, 3]);
    parts.push(g);
  };
  side(b.x0, b.y0, b.x1, b.y0);
  side(b.x1, b.y0, b.x1, b.y1);
  side(b.x1, b.y1, b.x0, b.y1);
  side(b.x0, b.y1, b.x0, b.y0);
  return mergeGeometries(parts, false)!;
}

function windowGridTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#9fb6cc";
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = "#2a3a4c";
  for (let y = 0; y < 128; y += 32) ctx.fillRect(0, y, 128, 5);
  for (let x = 0; x < 128; x += 32) ctx.fillRect(x, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Precast concrete grid tower: 12 m tile = 3 floors x 3 bays, warm light frame, teal recessed windows (bible #69958A). */
function precastGridTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#d9d3c4";
  ctx.fillRect(0, 0, 256, 256);
  const cell = 256 / 3,
    mull = 11;
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 3; x++) {
      const px = x * cell + mull,
        py = y * cell + mull,
        w = cell - mull * 2,
        hgt = cell - mull * 2;
      ctx.fillStyle = "#5f8a80";
      ctx.fillRect(px, py, w, hgt);
      ctx.fillStyle = "#79a398"; // sky reflection on the upper half
      ctx.fillRect(px, py, w, hgt * 0.45);
      ctx.fillStyle = "#4a4e52"; // shadow under the lintel
      ctx.fillRect(px, py, w, 4);
      ctx.fillStyle = "#ece7da"; // sill
      ctx.fillRect(px - 2, py + hgt, w + 4, 4);
    }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
/** Green band-glass office: horizontal teal glass bands alternating with white spandrels, 12 m tile = 3 floors. */
function bandGlassTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const fl = 256 / 3;
  for (let f = 0; f < 3; f++) {
    const y = f * fl;
    ctx.fillStyle = "#e6e9e4";
    ctx.fillRect(0, y, 256, fl * 0.42); // spandrel
    ctx.fillStyle = "#cfd4cf";
    ctx.fillRect(0, y + fl * 0.42 - 3, 256, 3); // band edge
    ctx.fillStyle = "#5b9a8c";
    ctx.fillRect(0, y + fl * 0.42, 256, fl * 0.58); // glass band
    ctx.fillStyle = "#7fb3a6";
    ctx.fillRect(0, y + fl * 0.42, 256, fl * 0.2); // sky reflection
    ctx.fillStyle = "#2f4a45"; // mullions
    for (let x = 0; x < 256; x += 32)
      ctx.fillRect(x, y + fl * 0.42, 2, fl * 0.58);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function waterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSun: { value: new THREE.Vector3(0.5, 0.6, -0.6).normalize() },
    },
    vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform float uTime; uniform vec3 uSun; varying vec3 vW;
      void main(){
        float r = sin(vW.x*0.25+uTime*0.9)*0.5 + sin(vW.z*0.17-uTime*0.6)*0.5 + sin((vW.x+vW.z)*0.08+uTime*0.4)*0.5;
        vec3 deep = vec3(0.10,0.30,0.42); vec3 light = vec3(0.35,0.58,0.70);
        vec3 c = mix(deep, light, 0.5+0.35*r);
        vec3 n = normalize(vec3(0.08*cos(vW.x*0.25+uTime*0.9), 1.0, 0.08*cos(vW.z*0.17-uTime*0.6)));
        vec3 v = normalize(cameraPosition - vW);
        float spec = pow(max(dot(reflect(-uSun, n), v), 0.0), 80.0);
        c += vec3(1.0,0.95,0.85)*spec*0.8;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

export interface CityView {
  group: THREE.Group;
  water: THREE.ShaderMaterial;
  cones: THREE.InstancedMesh;
  coneIndex: Map<number, number>;
  beacon: THREE.Mesh;
  update(t: number, camX?: number, camY?: number): void;
  /** 0 dry .. 1 wet: asphalt turns glossy/darker while it rains */
  setWet(k: number): void;
  /** free the GPU buffers, materials and textures this view created (shared asset resources are kept) */
  dispose(): void;
  /** round-3 landmarks placed this commute (HQ at the office, villa at home) */
  landmarks: { id: string; x: number; y: number; rot: number }[];
  /** hero building placements (model id, game-coord position, yaw, scale) */
  heroes: {
    id: string;
    x: number;
    y: number;
    rot: number;
    s: number;
    lodTop: number;
  }[];
  /** dev: streamed hero placements by model id */
  debugStreams?: {
    placements: { x: number; y: number; rot: number; s: number }[];
    count: number;
  }[];
}

export function buildCityView(
  city: City,
  assets: Assets,
  office: { x: number; y: number },
  layout?: LandmarkLayout,
): CityView {
  const group = new THREE.Group();
  // ---- round-3 landmarks (src/game/landmarks.ts): the city buildings on their lots are not drawn
  const skipLots = layout?.skip ?? new Set<Building>();
  const landmarks = layout?.landmarks ?? [];
  const T = (n: string) => assets.tex.get(n) ?? null;
  const pbr = (
    name: string,
    tile: number,
    extra: THREE.MeshStandardMaterialParameters = {},
  ) => {
    const m = new THREE.MeshStandardMaterial({
      map: T(name),
      normalMap: T(name + "_n"),
      roughness: 0.9,
      metalness: 0,
      ...extra,
    });
    void tile;
    return m;
  };
  const ASPHALT_TINT = new THREE.Color(0xc9c2ac);
  const asphalt = pbr("Asphalt033", 8, {
    roughness: 0.95,
    color: ASPHALT_TINT.clone(),
  });
  const pavers = pbr("PavingStones138", 4, {
    roughness: 0.95,
    color: 0xd2d0c8, // bible: pale grey sidewalk tile
  });
  // sidewalk slabs ~30 cm, not 1 m cobbles: double the repeat on the shared paver maps
  for (const t of [pavers.map, pavers.normalMap])
    if (t) {
      t.repeat.set(2, 2);
    }
  const concrete = pbr("Concrete034", 6, { roughness: 0.95, color: 0xa8a8a8 });
  const grass = new THREE.MeshStandardMaterial({
    map: T("Grass004"),
    roughness: 1,
    color: 0x8fa878,
  });
  const lim = C.CITY_HALF + C.ROAD_HALF;

  // ---- ground: grass base, block interiors (concrete), sidewalk rings (pavers), roadways (asphalt)
  // the grass stops at the river banks so the water (below ground level) shows; strips beyond the city close the gap
  const RH = C.RIVER_HALF;
  const base = new THREE.Mesh(
    mergeGeometries(
      [
        quad(-3000, -3000, -RH, 3000, -0.08, 5),
        quad(RH, -3000, 3000, 3000, -0.08, 5),
        quad(-RH, -3000, RH, -lim, -0.08, 5),
        quad(-RH, lim, RH, 3000, -0.08, 5),
      ],
      false,
    )!,
    grass,
  );
  base.receiveShadow = true;
  group.add(base);
  const paved: THREE.BufferGeometry[] = [],
    road: THREE.BufferGeometry[] = [],
    walk: THREE.BufferGeometry[] = [];
  for (let i = -C.K; i < C.K; i++)
    for (let j = -C.K; j < C.K; j++) {
      if (i === -1 || i === 0) continue;
      const x0 = i * C.P + C.ROADWAY_HALF,
        x1 = (i + 1) * C.P - C.ROADWAY_HALF,
        y0 = j * C.P + C.ROADWAY_HALF,
        y1 = (j + 1) * C.P - C.ROADWAY_HALF;
      walk.push(quad(x0, y0, x1, y1, C.CURB_H, 4)); // whole block at curb height: sidewalk ring
      paved.push(
        quad(
          x0 + C.SIDEWALK_W,
          y0 + C.SIDEWALK_W,
          x1 - C.SIDEWALK_W,
          y1 - C.SIDEWALK_W,
          C.CURB_H + 0.01,
          6,
        ),
      );
    }
  for (let k = -C.K; k <= C.K; k++) {
    if (k !== 0)
      road.push(
        quad(
          k * C.P - C.ROADWAY_HALF,
          -lim,
          k * C.P + C.ROADWAY_HALF,
          lim,
          0,
          8,
        ),
      );
    if (C.CROSSINGS.includes(k))
      road.push(
        quad(
          -lim,
          k * C.P - C.ROADWAY_HALF,
          lim,
          k * C.P + C.ROADWAY_HALF,
          0.005,
          8,
        ),
      );
    else {
      road.push(
        quad(
          -lim,
          k * C.P - C.ROADWAY_HALF,
          -C.P + C.ROADWAY_HALF,
          k * C.P + C.ROADWAY_HALF,
          0.005,
          8,
        ),
      );
      road.push(
        quad(
          C.P - C.ROADWAY_HALF,
          k * C.P - C.ROADWAY_HALF,
          lim,
          k * C.P + C.ROADWAY_HALF,
          0.005,
          8,
        ),
      );
    }
  }
  // riverfront sidewalks along the bank roads, cut where the bridge/tunnel roads cross them
  for (const sgn of [-1, 1]) {
    const xa = sgn > 0 ? C.P - C.ROAD_HALF : -C.P + C.ROADWAY_HALF,
      xb = sgn > 0 ? C.P - C.ROADWAY_HALF : -C.P + C.ROAD_HALF;
    let ya = -lim;
    for (const k of [...C.CROSSINGS].sort((a, b) => a - b)) {
      const yc = k * C.P;
      walk.push(quad(xa, ya, xb, yc - C.ROADWAY_HALF, C.CURB_H, 4));
      ya = yc + C.ROADWAY_HALF;
    }
    walk.push(quad(xa, ya, xb, lim, C.CURB_H, 4));
  }
  for (const [list, mat] of [
    [road, asphalt],
    [walk, pavers],
    [paved, concrete],
  ] as const) {
    const m = new THREE.Mesh(mergeGeometries(list, false)!, mat);
    m.receiveShadow = true;
    group.add(m);
  }
  group.add(laneLines(city));
  // curbs: thin concrete lip along every roadway edge
  {
    const parts: THREE.BufferGeometry[] = [];
    for (const e of city.edges) {
      const a = city.nodes[e.a],
        s0 = C.ROADWAY_HALF,
        s1 = e.len - C.ROADWAY_HALF;
      for (const sgn of [-1, 1])
        parts.push(
          e.axis === "x"
            ? box(
                s1 - s0,
                C.CURB_H + 0.02,
                0.4,
                a.x + (s0 + s1) / 2,
                (C.CURB_H + 0.02) / 2,
                -(a.y + sgn * (C.ROADWAY_HALF + 0.2)),
              )
            : box(
                0.4,
                C.CURB_H + 0.02,
                s1 - s0,
                a.x + sgn * (C.ROADWAY_HALF + 0.2),
                (C.CURB_H + 0.02) / 2,
                -(a.y + (s0 + s1) / 2),
              ),
        );
    }
    group.add(
      new THREE.Mesh(
        mergeGeometries(parts, false)!,
        new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 0.9 }),
      ),
    );
  }

  // ---- water + banks
  const water = waterMaterial();
  const wm = new THREE.Mesh(
    new THREE.PlaneGeometry(C.RIVER_HALF * 2, lim * 2),
    water,
  );
  wm.rotation.x = -Math.PI / 2;
  wm.position.y = -0.6;
  group.add(wm);
  for (const sgn of [-1, 1])
    group.add(
      new THREE.Mesh(
        box(6, 1.2, lim * 2, sgn * (C.RIVER_HALF + 3), -0.5, 0),
        concrete,
      ),
    );

  // ---- buildings: bright procedural facades (ground-floor signboard band + window floors), glass towers
  const NF = 8;
  const floorMats = Array.from(
    { length: NF },
    (_, i) =>
      new THREE.MeshStandardMaterial({
        map: floorsTexture(100 + i),
        roughness: 0.8,
      }),
  );
  const shopMats = Array.from(
    { length: NF },
    (_, i) =>
      new THREE.MeshStandardMaterial({
        map: shopTexture(200 + i),
        roughness: 0.7,
      }),
  );
  const floorParts: THREE.BufferGeometry[][] = Array.from(
    { length: NF },
    () => [],
  );
  const shopParts: THREE.BufferGeometry[][] = Array.from(
    { length: NF },
    () => [],
  );
  const roofs: THREE.BufferGeometry[] = [];
  const glassParts: THREE.BufferGeometry[] = [];
  const gridParts: THREE.BufferGeometry[] = [];
  const bandParts: THREE.BufferGeometry[] = [];
  // round-2 photo modules (I_01/02 apartment slabs, I_03/04 glass offices; 12 m x 3 floors x 3 bays) when present
  const iParts: THREE.BufferGeometry[][] = [[], [], [], []];
  const towerParts = T("I_01")
    ? [iParts[0], iParts[0], iParts[1], iParts[1], iParts[2], iParts[3]]
    : [glassParts, glassParts, gridParts, gridParts, bandParts];
  let seed = 11;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const SHOP_H = 4.5,
    FLOOR_H = 3.5;
  // photo-facade slabs (generated elevations) lead the frontage; Blender sign buildings and photoscanned
  // apartments mix in for variety
  const HERO_IDS = [
    // 14 photo slabs (8 round-1 facades + 6 round-2 with a different business on every floor), twice each
    ...Array.from({ length: 28 }, (_, i) => "photo_a" + ((i % 14) + 1)),
    ...[1, 2, 3, 4, 5, 6].map((i) => "photo_t" + i),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => "bldg_" + i),
    ...[1, 2, 3, 4, 5, 6].map((i) => "euro_" + i),
  ];
  const aoParts: THREE.BufferGeometry[] = [];
  const heroPlacements: {
    id: string;
    x: number;
    y: number;
    rot: number;
    s: number;
    /** roof of the always-drawn inset LOD box under the hero model */
    lodTop: number;
  }[] = [];
  const m4 = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    sc = new THREE.Vector3(),
    pos = new THREE.Vector3();
  for (const b of city.buildings) {
    if (skipLots.has(b)) continue;
    const tower = b.kind.includes("skyscraper");
    if (tower) {
      const h = Math.round((b.height * 1.15) / FLOOR_H) * FLOOR_H;
      // three tower families (bible P1): blue curtain wall, precast concrete grid, green band glass
      const fam = towerParts[Math.floor(rnd() * towerParts.length)];
      fam.push(walls(b.box, h, 12));
      roofs.push(quad(b.box.x0, b.box.y0, b.box.x1, b.box.y1, h, 6));
      const inset = 4;
      fam.push(
        walls(
          {
            x0: b.box.x0 + inset,
            y0: b.box.y0 + inset,
            x1: b.box.x1 - inset,
            y1: b.box.y1 - inset,
          },
          h + 8,
          12,
        ),
      );
      roofs.push(
        quad(
          b.box.x0 + inset,
          b.box.y0 + inset,
          b.box.x1 - inset,
          b.box.y1 - inset,
          h + 8,
          6,
        ),
      );
      continue;
    }
    if (rnd() < 1.01) {
      // (always; the procedural branch below is only a fallback) Detailed model buildings tiled along the street frontage (Raycity: a continuous row of narrow
      // commercial buildings), each with its own inset cheap LOD box for when the hero is streamed out.
      const w = b.box.x1 - b.box.x0,
        d = b.box.y1 - b.box.y0;
      const swap = Math.abs(b.rotY % Math.PI) > 0.1; // model x axis runs along lot y
      const lotAlong = swap ? d : w,
        lotDepth = swap ? w : d;
      const pick = () => {
        const id = HERO_IDS[Math.floor(rnd() * HERO_IDS.length)];
        const model = assets.models.get(id);
        if (!model) return null;
        const bw = model.body ? model.body.w : model.size.x,
          bd = model.body ? model.body.d : model.size.z,
          bh = model.body ? model.body.h : model.size.y;
        // fit the lot depth (clamped so storeys stay human-scale) and never exceed the frontage width
        const s =
          Math.min(Math.max(lotDepth / bd, 0.85), 1.25, (lotAlong + 0.3) / bw) *
          0.99;
        return { id, s, aw: bw * s, ad: bd * s, h: bh * s };
      };
      const row: NonNullable<ReturnType<typeof pick>>[] = [];
      let used = 0;
      for (let tries = 0; tries < 8 && used < lotAlong - 4; tries++) {
        const p = pick();
        if (!p) continue;
        if (used + p.aw > lotAlong + 0.5) continue;
        row.push(p);
        used += p.aw;
      }
      if (!row.length) {
        const p = pick();
        if (p) {
          const k = Math.min(1, lotAlong / p.aw);
          p.s *= k;
          p.aw *= k;
          p.ad *= k;
          p.h *= k;
          row.push(p);
          used = p.aw;
        }
      }
      if (row.length) {
        const gap = Math.max(0, lotAlong - used);
        const g = gap / (row.length + 1); // alley spacing
        // street side: model front (-y local) faces the roadway; keep the row flush with the lot's street edge
        const sinR = Math.sin(b.rotY),
          cosR = Math.cos(b.rotY);
        let cur = -lotAlong / 2 + g;
        for (const p of row) {
          const ax = cur + p.aw / 2; // along-street offset in model-local x
          const dz = (lotDepth - p.ad) / 2; // push toward the street edge (local -y is street)
          const lx = ax,
            ly = -dz;
          const x = b.cx + lx * cosR - ly * sinR,
            y = b.cy + lx * sinR + ly * cosR;
          const hw = (swap ? p.ad : p.aw) / 2 - 0.3,
            hd = (swap ? p.aw : p.ad) / 2 - 0.3;
          const ib = { x0: x - hw, y0: y - hd, x1: x + hw, y1: y + hd };
          const hh = p.h - 0.4;
          heroPlacements.push({
            id: p.id,
            x,
            y,
            rot: b.rotY,
            s: p.s,
            lodTop: hh,
          });
          aoParts.push(
            aoSkirt(
              {
                x0: ib.x0 + 0.3,
                y0: ib.y0 + 0.3,
                x1: ib.x1 - 0.3,
                y1: ib.y1 - 0.3,
              },
              1.6,
            ),
          );
          shopParts[Math.floor(rnd() * NF)].push(wallBand(ib, 0, SHOP_H, 8, 1));
          floorParts[Math.floor(rnd() * NF)].push(
            wallBand(ib, SHOP_H, hh, 8, FLOOR_H),
          );
          roofs.push(quad(ib.x0, ib.y0, ib.x1, ib.y1, hh, 6));
          cur += p.aw + g;
        }
        continue;
      }
    }
    const floors = Math.max(1, Math.round((b.height - SHOP_H) / FLOOR_H));
    const h = SHOP_H + floors * FLOOR_H;
    aoParts.push(aoSkirt(b.box, 1.6));
    const fi = Math.floor(rnd() * NF),
      si = Math.floor(rnd() * NF);
    shopParts[si].push(wallBand(b.box, 0, SHOP_H, 8, 1));
    floorParts[fi].push(wallBand(b.box, SHOP_H, h, 8, FLOOR_H));
    roofs.push(quad(b.box.x0, b.box.y0, b.box.x1, b.box.y1, h, 6));
    roofs.push(
      aabbBox(
        {
          x0: b.box.x0 - 0.3,
          y0: b.box.y0 - 0.3,
          x1: b.box.x1 + 0.3,
          y1: b.box.y1 + 0.3,
        },
        h,
        h + 0.6,
      ),
    ); // parapet
    if (rnd() < 0.5)
      roofs.push(
        aabbBox(
          {
            x0: b.box.x0 + 2,
            y0: b.box.y0 + 2,
            x1: b.box.x0 + 5,
            y1: b.box.y0 + 5,
          },
          h,
          h + 2.5,
        ),
      );
  }
  for (let i = 0; i < NF; i++) {
    if (floorParts[i].length) {
      const m = new THREE.Mesh(
        mergeGeometries(floorParts[i], false)!,
        floorMats[i],
      );
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    if (shopParts[i].length) {
      const m = new THREE.Mesh(
        mergeGeometries(shopParts[i], false)!,
        shopMats[i],
      );
      m.receiveShadow = true;
      group.add(m);
    }
  }
  if (aoParts.length) {
    const ao = new THREE.Mesh(
      mergeGeometries(aoParts, false)!,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        blending: THREE.MultiplyBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    ao.renderOrder = 2;
    group.add(ao);
  }
  const roofMesh = new THREE.Mesh(
    mergeGeometries(roofs, false)!,
    new THREE.MeshStandardMaterial({
      map: T("Concrete034"),
      roughness: 0.95,
      color: 0xb0b0b0,
    }),
  );
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = true;
  group.add(roofMesh);
  if (glassParts.length) {
    const glass = new THREE.MeshStandardMaterial({
      map: windowGridTexture(),
      color: 0xbfd6ea,
      metalness: 0.9,
      roughness: 0.12,
      envMapIntensity: 1.4,
    });
    const gm = new THREE.Mesh(mergeGeometries(glassParts, false)!, glass);
    gm.castShadow = true;
    group.add(gm);
  }
  if (gridParts.length) {
    const gm = new THREE.Mesh(
      mergeGeometries(gridParts, false)!,
      new THREE.MeshStandardMaterial({
        map: precastGridTexture(),
        roughness: 0.75,
        metalness: 0.05,
      }),
    );
    gm.castShadow = true;
    gm.receiveShadow = true;
    group.add(gm);
  }
  if (bandParts.length) {
    const gm = new THREE.Mesh(
      mergeGeometries(bandParts, false)!,
      new THREE.MeshStandardMaterial({
        map: bandGlassTexture(),
        roughness: 0.3,
        metalness: 0.45,
        envMapIntensity: 1.1,
      }),
    );
    gm.castShadow = true;
    group.add(gm);
  }

  iParts.forEach((parts, i) => {
    const t = T("I_0" + (i + 1));
    if (!parts.length || !t) return;
    const glassy = i >= 2;
    const gm = new THREE.Mesh(
      mergeGeometries(parts, false)!,
      new THREE.MeshStandardMaterial({
        map: flipV(t),
        roughness: glassy ? 0.35 : 0.85,
        metalness: glassy ? 0.35 : 0,
        envMapIntensity: glassy ? 1.2 : 0.8,
      }),
    );
    gm.castShadow = true;
    gm.receiveShadow = true;
    group.add(gm);
  });

  // ---- third-party model buildings on some lots (instanced per model part)
  type Placement = { x: number; y: number; rot: number; s: number };
  const streamed: {
    placements: Placement[];
    meshes: THREE.InstancedMesh[];
    r2: number;
  }[] = [];
  const inst = (id: string, placements: Placement[], stream = false) => {
    const model = assets.models.get(id);
    if (!model || !placements.length) return;
    const meshes: THREE.InstancedMesh[] = [];
    for (const p of model.parts) {
      const im = new THREE.InstancedMesh(
        p.geometry,
        p.material,
        placements.length,
      );
      placements.forEach((pl, i) => {
        pos.set(pl.x, 0, -pl.y);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pl.rot);
        sc.setScalar(pl.s);
        m4.compose(pos, q, sc);
        im.setMatrixAt(i, m4);
      });
      im.castShadow = false; // the inset LOD box (always present) casts the building shadow; heroes are too heavy for a second pass
      im.receiveShadow = true;
      if (stream) {
        im.count = 0;
        im.frustumCulled = false;
      }
      group.add(im);
      meshes.push(im);
    }
    if (stream)
      streamed.push({
        placements,
        meshes,
        r2: id.startsWith("euro") ? STREAM_R2_HEAVY : STREAM_R2,
      });
  };
  const STREAM_R2 = 290 * 290;
  const STREAM_R2_HEAVY = 170 * 170; // photoscanned apartments: ~20k tris each, keep them near
  let lastStream = -1e9,
    lastSX = 1e9,
    lastSY = 1e9;
  /** Show detailed building models only near the camera (the inset band building stands in for far lots). */
  const streamBuildings = (cx: number, cy: number, t: number) => {
    if (t - lastStream < 0.2 && Math.hypot(cx - lastSX, cy - lastSY) < 20)
      return;
    lastStream = t;
    lastSX = cx;
    lastSY = cy;
    for (const s of streamed) {
      let n = 0;
      for (const pl of s.placements) {
        const dx = pl.x - cx,
          dy = pl.y - cy;
        if (dx * dx + dy * dy > s.r2) continue;
        pos.set(pl.x, 0, -pl.y);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), pl.rot);
        sc.setScalar(pl.s);
        m4.compose(pos, q, sc);
        for (const im of s.meshes) im.setMatrixAt(n, m4);
        n++;
      }
      for (const im of s.meshes) {
        im.count = n;
        im.instanceMatrix.needsUpdate = true;
      }
    }
  };
  {
    const byId = new Map<string, Placement[]>();
    for (const h of heroPlacements)
      (byId.get(h.id) ?? byId.set(h.id, []).get(h.id)!).push({
        x: h.x,
        y: h.y,
        rot: h.rot,
        s: h.s,
      });
    for (const [id, list] of byId) inst(id, list, true);
    for (const l of landmarks) {
      if (assets.models.has(l.id)) {
        inst(l.id, [{ x: l.x, y: l.y, rot: l.rot, s: 1 }]);
        continue;
      }
      // model failed to load: plain boxes where the landmark is solid
      for (const b of l.solids)
        group.add(
          new THREE.Mesh(
            aabbBox(b.box, 0, b.height),
            new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.8 }),
          ),
        );
    }
    // HQ clock hands, stopped at 9:00 (the deadline): pivot measured on O_01, model-local Blender (x, y, z)
    for (const l of landmarks.filter((q) => q.id === "hq_r3")) {
      const g = new THREE.Group();
      g.position.set(l.x, 0, -l.y);
      g.rotation.y = l.rot;
      const hand = new THREE.MeshStandardMaterial({
        color: 0x14171b,
        roughness: 0.5,
      });
      const [px, py, pz] = [-7, -8.005 - 0.07, 37.139];
      const hour = new THREE.Mesh(
        new THREE.BoxGeometry(1.14, 0.21, 0.055),
        hand,
      );
      hour.position.set(px - 0.5, pz, -py); // pointing at 9 (viewer's left = model -x)
      const minute = new THREE.Mesh(
        new THREE.BoxGeometry(0.115, 1.64, 0.1),
        hand,
      );
      minute.position.set(px, pz + 0.72, -py - 0.03); // pointing at 12
      g.add(hour, minute);
      group.add(g);
    }
  }
  // camera-facing pedestrian cut-outs (round-2 K images), turned toward the player each frame in update()
  const peds: {
    mesh: THREE.InstancedMesh;
    spots: { x: number; y: number; z: number }[];
  }[] = [];
  let pedCamX = 1e9,
    pedCamY = 1e9;
  // ---- street props: traffic lights at intersection corners, bus stops, benches, trash cans, rooftop billboards
  {
    const lights: { x: number; y: number; rot: number; s: number }[] = [],
      stops: typeof lights = [],
      stopSpots: { x: number; y: number; axis: "x" | "y"; sgn: number }[] = [],
      benches: typeof lights = [],
      bins: typeof lights = [],
      boards: typeof lights = [];
    for (const n of city.nodes) {
      for (const [sx, sy, rot] of [
        [1, 1, Math.PI],
        [-1, 1, -Math.PI / 2],
        [-1, -1, 0],
        [1, -1, Math.PI / 2],
      ] as [number, number, number][]) {
        lights.push({
          x: n.x + sx * (C.ROADWAY_HALF + 1.5),
          y: n.y + sy * (C.ROADWAY_HALF + 1.5),
          rot,
          s: 1,
        });
      }
    }
    for (const e of city.edges) {
      if (e.crossing) continue;
      const a = city.nodes[e.a];
      for (const sgn of [-1, 1]) {
        if (rnd() < 0.3) {
          const s = C.ROAD_HALF + 30 + rnd() * (e.len - 2 * C.ROAD_HALF - 60);
          const off = C.ROADWAY_HALF + 4.5;
          const p =
            e.axis === "x"
              ? { x: a.x + s, y: a.y + sgn * off, rot: sgn > 0 ? Math.PI : 0 }
              : {
                  x: a.x + sgn * off,
                  y: a.y + s,
                  rot: sgn > 0 ? -Math.PI / 2 : Math.PI / 2,
                };
          stops.push({ ...p, s: 1 });
          stopSpots.push({ x: p.x, y: p.y, axis: e.axis, sgn });
          benches.push(
            e.axis === "x"
              ? { x: p.x + 7, y: p.y, rot: p.rot, s: 1 }
              : { x: p.x, y: p.y + 7, rot: p.rot, s: 1 },
          );
          bins.push(
            e.axis === "x"
              ? { x: p.x - 5, y: p.y, rot: 0, s: 1 }
              : { x: p.x, y: p.y - 5, rot: 0, s: 1 },
          );
        }
      }
    }
    for (const b of city.buildings)
      if (!b.kind.includes("skyscraper") && rnd() < 0.025)
        boards.push({ x: b.cx, y: b.cy, rot: b.rotY, s: 1 });
    // people waiting at the stops (K cut-outs) and a poster panel beside each stop (L posters)
    {
      const kTex = [1, 2, 3, 4, 5, 6].map((i) => T("K_0" + i));
      // round-3 late office workers (K2) run up to the HQ entrance
      const hq = landmarks.find((q) => q.id === "hq_r3");
      const k2 = [1, 2, 3].map((i) => T("K2_0" + i));
      const k2Base = kTex.length;
      if (hq && k2.every(Boolean)) kTex.push(...k2);
      const lTex = [1, 2, 3].map((i) => T("L_0" + i));
      const pedSpots: { x: number; y: number; z: number }[][] = kTex.map(
        () => [],
      );
      const panelMats: THREE.Matrix4[][] = lTex.map(() => []);
      if (hq && kTex.length > k2Base) {
        // on the forecourt in front of the entrance (model-local: tower front at y = -7.95)
        const c = Math.cos(hq.rot),
          s = Math.sin(hq.rot);
        [
          [-9.5, -12.5],
          [-5.5, -14.0],
          [-2.0, -11.8],
        ].forEach(([lx, ly], j) =>
          pedSpots[k2Base + j].push({
            x: hq.x + lx * c - ly * s,
            y: hq.y + lx * s + ly * c,
            z: C.CURB_H,
          }),
        );
      }
      const frames: THREE.BufferGeometry[] = [];
      // people waiting to cross at intersection corners (no fence there, so they read from the road)
      city.nodes.forEach((nd, ni) => {
        for (let c = 0; c < 4; c++) {
          if ((ni * 3 + c * 5) % 4 !== 0) continue; // roughly one corner in four
          const sx = c & 1 ? 1 : -1,
            sy = c & 2 ? 1 : -1;
          const n = 1 + ((ni + c) % 2);
          for (let j = 0; j < n; j++) {
            // beside the crosswalk, clear of the corner signal pole
            const along = C.ROADWAY_HALF + 3.2 + j * 0.9;
            const x =
                nd.x +
                sx * (c % 3 === 0 ? along : C.ROADWAY_HALF + 1.4 + j * 0.3),
              y =
                nd.y +
                sy * (c % 3 === 0 ? C.ROADWAY_HALF + 1.4 + j * 0.3 : along);
            pedSpots[(ni * 7 + c * 3 + j) % kTex.length].push({
              x,
              y,
              z: C.CURB_H,
            });
          }
        }
      });
      stopSpots.forEach((sp, i) => {
        // along-road and toward-road unit vectors (game coords)
        const ax = sp.axis === "x" ? 1 : 0,
          ay = sp.axis === "x" ? 0 : 1;
        const tx = sp.axis === "x" ? 0 : -sp.sgn,
          ty = sp.axis === "x" ? -sp.sgn : 0;
        const n = 1 + ((i * 7) % 3); // 1-3 people, deterministic
        for (let j = 0; j < n; j++) {
          const along = -2.2 + j * 2.1 + ((i * 13 + j * 5) % 7) * 0.12;
          // in front of the shelter (stop at ROADWAY_HALF + 4.5, ~1.5 m deep), behind the arterial barrier at +1.0
          const toward = 2.0 + ((i + j) % 3) * 0.3;
          const v = (i * 5 + j * 3) % kTex.length;
          pedSpots[v].push({
            x: sp.x + ax * along + tx * toward,
            y: sp.y + ay * along + ty * toward,
            z: C.CURB_H,
          });
        }
        if (lTex[0]) {
          const px = sp.x - ax * 9.5 + tx * 0.4,
            py = sp.y - ay * 9.5 + ty * 0.4;
          // panel faces along the road (both sides printed), so drivers see it coming and going
          const yaw = sp.axis === "x" ? Math.PI / 2 : 0;
          const m = new THREE.Matrix4().compose(
            new THREE.Vector3(px, C.CURB_H, -py),
            new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 1, 0),
              yaw,
            ),
            new THREE.Vector3(1, 1, 1),
          );
          panelMats[i % lTex.length].push(m);
          frames.push(
            colored(box(1.42, 2.5, 0.14, 0, 1.45, 0).applyMatrix4(m), 0x30343a),
          );
          frames.push(
            colored(box(0.5, 0.2, 0.3, 0, 0.1, 0).applyMatrix4(m), 0x30343a),
          );
        }
      });
      kTex.forEach((t, v) => {
        const list = pedSpots[v];
        if (!t || !list.length) return;
        const img = t.image as { width: number; height: number };
        const H = 1.62 + (v % 3) * 0.07;
        const geo = new THREE.PlaneGeometry(
          (H * img.width) / img.height,
          H,
        ).translate(0, H / 2, 0);
        const mesh = new THREE.InstancedMesh(
          geo,
          new THREE.MeshStandardMaterial({
            map: t,
            alphaTest: 0.5,
            roughness: 1,
            side: THREE.DoubleSide,
          }),
          list.length,
        );
        mesh.frustumCulled = false;
        group.add(mesh);
        peds.push({ mesh, spots: list });
      });
      lTex.forEach((t, v) => {
        const list = panelMats[v];
        if (!t || !list.length) return;
        const pg = mergeGeometries(
          [
            new THREE.PlaneGeometry(1.25, 2.22).translate(0, 1.5, 0.075),
            new THREE.PlaneGeometry(1.25, 2.22)
              .rotateY(Math.PI)
              .translate(0, 1.5, -0.075),
          ],
          false,
        )!;
        const pm = new THREE.InstancedMesh(
          pg,
          new THREE.MeshStandardMaterial({
            map: flipV(t),
            roughness: 0.4,
            emissive: 0xffffff,
            emissiveIntensity: 0.12,
            emissiveMap: flipV(t),
          }),
          list.length,
        );
        list.forEach((m, k) => pm.setMatrixAt(k, m));
        group.add(pm);
      });
      if (frames.length)
        group.add(
          new THREE.Mesh(
            mergeGeometries(frames, false)!,
            new THREE.MeshStandardMaterial({
              vertexColors: true,
              roughness: 0.5,
              metalness: 0.4,
            }),
          ),
        );
    }
    inst("57rxXzowK8w", lights);
    inst("OWczicNWhO", stops);
    inst("dOSjmdmKaxi", benches);
    inst("i7HDuYDLkx", bins);
    // billboards sit on roofs: raise by the building height via a second pass (model y offset)
    const bb = assets.models.get("e5jmUgocmaT");
    if (bb) {
      const mats: THREE.Matrix4[] = [];
      let i = 0;
      for (const b of city.buildings) {
        if (b.kind.includes("skyscraper") || i >= boards.length) continue;
        if (skipLots.has(b)) {
          if (
            Math.abs(b.cx - boards[i].x) < 0.01 &&
            Math.abs(b.cy - boards[i].y) < 0.01
          )
            i++; // the landmark took this lot: drop its rooftop board too
          continue;
        }
        if (
          Math.abs(b.cx - boards[i].x) > 0.01 ||
          Math.abs(b.cy - boards[i].y) > 0.01
        )
          continue;
        const h =
          SHOP_H +
          Math.max(1, Math.round((b.height - SHOP_H) / FLOOR_H)) * FLOOR_H;
        pos.set(b.cx, h, -b.cy);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rotY);
        sc.setScalar(1);
        mats.push(new THREE.Matrix4().compose(pos, q, sc));
        i++;
      }
      for (const p of bb.parts) {
        const im = new THREE.InstancedMesh(
          p.geometry,
          p.material,
          mats.length || 1,
        );
        mats.forEach((m, k) => im.setMatrixAt(k, m));
        im.count = mats.length;
        group.add(im);
      }
      // advert faces: the model's panel is blank; hang a fictional-brand poster on its front (model front = -x)
      const N_ADS = 8; // 6 brand adverts + 2 loop-the-loop stock charts (one board in four shows a chart)
      const adGeo = mergeGeometries(
        [
          new THREE.PlaneGeometry(8.0, 3.4)
            .rotateY(-Math.PI / 2)
            .translate(-1.3, 7.15, 0),
          new THREE.PlaneGeometry(8.0, 3.4)
            .rotateY(Math.PI / 2)
            .translate(-0.6, 7.15, 0),
        ],
        false,
      )!;
      for (let v = 0; v < N_ADS; v++) {
        const mine = mats.filter((_, k) => k % N_ADS === v);
        if (!mine.length) continue;
        const im = new THREE.InstancedMesh(
          adGeo,
          new THREE.MeshStandardMaterial({
            // generated photo adverts (E_01..06) when present; procedural fictional-brand posters otherwise
            map:
              v >= 6
                ? stockChartTexture(v - 6)
                : T("E_0" + (v + 1))
                  ? flipV(T("E_0" + (v + 1))!)
                  : billboardAdTexture(v),
            roughness: 0.6,
          }),
          mine.length,
        );
        mine.forEach((m, k) => im.setMatrixAt(k, m));
        group.add(im);
      }
    }
  }

  // ---- Raycity signature: red/white crash barriers + chain-link fences lining every road
  {
    const bar: THREE.BufferGeometry[] = [],
      fence: THREE.BufferGeometry[] = [];
    // round-2 photo blocks: J_01 red, J_02 white, J_03 worn red, J_04 worn white (one 2.1 m block per texture repeat)
    const jParts: THREE.BufferGeometry[][] = [[], [], [], []];
    const useJ = !!T("J_01");
    const block = (
      len: number,
      along: "x" | "y",
      cx: number,
      cy: number,
      cz: number,
    ) => {
      const g =
        along === "x"
          ? new THREE.BoxGeometry(len, BH, 0.5)
          : new THREE.BoxGeometry(0.5, BH, len);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each); stretch u on the faces that span len
      const longFaces = along === "x" ? [2, 3, 4, 5] : [0, 1, 2, 3];
      for (const f of longFaces)
        for (let i = f * 4; i < f * 4 + 4; i++) {
          // +y/-y faces span len along u for x-blocks but along v for y-blocks
          if (along === "y" && (f === 2 || f === 3))
            uv.setY(i, uv.getY(i) * (len / 2.1));
          else uv.setX(i, uv.getX(i) * (len / 2.1));
        }
      return g.translate(cx, cy, cz);
    };
    const off = C.ROADWAY_HALF + 1.0,
      BH = 0.9,
      FH = 1.4,
      SEG = 6;
    for (const e of city.edges) {
      if (e.crossing) continue;
      {
        const na = city.nodes[e.a];
        const arterial =
          (e.axis === "x" && C.CROSSINGS.includes(na.j)) ||
          (e.axis === "y" && (Math.abs(na.i) === 1 || Math.abs(na.i) === 4));
        if (!arterial) continue;
      }
      const a = city.nodes[e.a];
      const s0 = C.ROAD_HALF + 6,
        s1 = e.len - C.ROAD_HALF - 6;
      for (const sgn of [-1, 1]) {
        // a gap in front of the launch-demo stage so the run-in is open
        const st = city.stage;
        const line = a.y + sgn * off;
        let gap: number[] | null = null;
        if (st && e.axis === "x") {
          if (Math.abs(st.ux) > 0.5) {
            // strip parallel to this road (running east): open the barrier along the diagonal run-in
            if (Math.sign(st.oy - a.y) === sgn && Math.abs(st.oy - line) < 25)
              gap = [st.ox - 42 - a.x, st.ox + 4 - a.x];
          } else if (line > st.oy - 12 && line < st.oy)
            gap = [st.ox - a.x - 8, st.ox - a.x + 8];
        }
        // only a gap that actually falls on this road counts (a far-off one stretched the fence across junctions)
        if (gap && (gap[1] <= s0 || gap[0] >= s1)) gap = null;
        const inGap = (q0: number, q1: number) =>
          !!gap && q1 > gap[0] && q0 < gap[1];
        let k = 0;
        for (let s = s0; s < s1; s += SEG, k++) {
          const L = Math.min(SEG, s1 - s) - 0.15;
          if (inGap(s, s + L)) continue;
          const col = k % 2 === 0 ? 0xe03a2a : 0xf4f4f4;
          if (useJ) {
            const worn = (k * 7 + Math.round(a.x + a.y)) % 3 === 0 ? 2 : 0;
            jParts[(k % 2) + worn].push(
              e.axis === "x"
                ? block(
                    L,
                    "x",
                    a.x + s + L / 2,
                    C.CURB_H + BH / 2,
                    -(a.y + sgn * off),
                  )
                : block(
                    L,
                    "y",
                    a.x + sgn * off,
                    C.CURB_H + BH / 2,
                    -(a.y + s + L / 2),
                  ),
            );
            continue;
          }
          bar.push(
            colored(
              e.axis === "x"
                ? box(
                    L,
                    BH,
                    0.5,
                    a.x + s + L / 2,
                    C.CURB_H + BH / 2,
                    -(a.y + sgn * off),
                  )
                : box(
                    0.5,
                    BH,
                    L,
                    a.x + sgn * off,
                    C.CURB_H + BH / 2,
                    -(a.y + s + L / 2),
                  ),
              col,
            ),
          );
        }
        // fence plane above the barrier (split around the stage gap)
        const spans = gap
          ? [
              [s0, C.clamp(gap[0], s0, s1)],
              [C.clamp(gap[1], s0, s1), s1],
            ].filter(([q0, q1]) => q1 - q0 > 1)
          : [[s0, s1]];
        for (const [f0, f1] of spans) {
          const len = f1 - f0;
          const g = new THREE.PlaneGeometry(len, FH);
          const uv = g.attributes.uv as THREE.BufferAttribute;
          for (let i = 0; i < uv.count; i++)
            uv.setXY(i, uv.getX(i) * (len / 2), uv.getY(i) * (FH / 2));
          if (e.axis === "x")
            g.translate(
              a.x + (f0 + f1) / 2,
              C.CURB_H + BH + FH / 2,
              -(a.y + sgn * off),
            );
          else {
            g.rotateY(Math.PI / 2);
            g.translate(
              a.x + sgn * off,
              C.CURB_H + BH + FH / 2,
              -(a.y + (f0 + f1) / 2),
            );
          }
          fence.push(g);
        }
        // posts
        for (let s = s0; s <= s1; s += 12)
          if (!inGap(s - 0.1, s + 0.1))
            bar.push(
              colored(
                e.axis === "x"
                  ? box(
                      0.12,
                      BH + FH,
                      0.12,
                      a.x + s,
                      C.CURB_H + (BH + FH) / 2,
                      -(a.y + sgn * off),
                    )
                  : box(
                      0.12,
                      BH + FH,
                      0.12,
                      a.x + sgn * off,
                      C.CURB_H + (BH + FH) / 2,
                      -(a.y + s),
                    ),
                0x9aa0a8,
              ),
            );
      }
    }
    const bm = new THREE.Mesh(
      mergeGeometries(bar, false)!,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
    );
    bm.castShadow = true;
    group.add(bm);
    jParts.forEach((parts, i) => {
      const t = T("J_0" + (i + 1));
      if (!parts.length || !t) return;
      const jm = new THREE.Mesh(
        mergeGeometries(parts, false)!,
        new THREE.MeshStandardMaterial({ map: flipV(t), roughness: 0.8 }),
      );
      jm.castShadow = true;
      jm.receiveShadow = true;
      group.add(jm);
    });
    group.add(
      new THREE.Mesh(
        mergeGeometries(fence, false)!,
        new THREE.MeshStandardMaterial({
          map: fenceTexture(),
          transparent: true,
          alphaTest: 0.4,
          side: THREE.DoubleSide,
          roughness: 0.5,
          metalness: 0.4,
        }),
      ),
    );
  }

  // ---- city rim: photo noise walls (G) outside the perimeter roads, and a hazed photo skyline (D) beyond them.
  // Both hide the flat grass horizon the way Raycity's course edges do.
  {
    const WALL_H = 4.6, // G images are ~2.33:1 -> 10.7 m per tile
      TILE = WALL_H * 2.33,
      RUN = 4; // tiles per variant run
    const wallOff = C.CITY_HALF + C.ROADWAY_HALF + 2.2;
    const walls: THREE.BufferGeometry[][] = [[], []];
    const baseParts: THREE.BufferGeometry[] = [];
    const L = wallOff;
    for (const side of [0, 1, 2, 3]) {
      // 0: +y edge (wall faces -y), 1: -y edge, 2: +x edge (faces -x), 3: -x edge
      let k = 0;
      for (let s = -L; s < L; s += TILE * RUN, k++) {
        const len = Math.min(TILE * RUN, L - s);
        const g = new THREE.PlaneGeometry(len, WALL_H);
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++)
          uv.setXY(i, uv.getX(i) * (len / TILE), 1 - uv.getY(i));
        const mid = s + len / 2,
          cy = C.CURB_H + WALL_H / 2;
        if (side === 0)
          g.translate(mid, cy, -wallOff); // +z-facing plane looks back into the city
        else if (side === 1) g.rotateY(Math.PI).translate(mid, cy, wallOff);
        else if (side === 2)
          g.rotateY(-Math.PI / 2).translate(wallOff, cy, -mid);
        else g.rotateY(Math.PI / 2).translate(-wallOff, cy, -mid);
        walls[k % 2].push(g);
      }
      // low concrete plinth + posts every tile
      const horiz = side < 2;
      const c =
        side === 0
          ? -wallOff
          : side === 1
            ? wallOff
            : side === 2
              ? wallOff
              : -wallOff;
      baseParts.push(
        colored(
          horiz
            ? box(2 * L, 0.5, 0.5, 0, C.CURB_H + 0.25, c)
            : box(0.5, 0.5, 2 * L, c, C.CURB_H + 0.25, 0),
          0x9a9a96,
        ),
      );
    }
    for (const v of [0, 1]) {
      const t = T("G_0" + (v + 1));
      if (!t || !walls[v].length) continue;
      const m = new THREE.Mesh(
        mergeGeometries(walls[v], false)!,
        new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }),
      );
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    group.add(
      new THREE.Mesh(
        mergeGeometries(baseParts, false)!,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
      ),
    );

    // skyline backdrop: a square of tall panels 500 m past the rim, sky keyed to alpha, hazed toward the fog
    // colour in the shader (fog itself is off so the band stays readable instead of dissolving at 800 m)
    const SKY_D = C.CITY_HALF + 650,
      SKY_H = 230,
      SKY_W = SKY_H * 2.33;
    const skyMats = [0, 1, 2].map((v) => {
      const t = T("D_0" + (v + 1));
      if (!t) return null;
      const m = new THREE.MeshBasicMaterial({
        map: t,
        transparent: true,
        depthWrite: false,
        fog: false,
        side: THREE.FrontSide,
      });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uHaze = { value: new THREE.Color("#D9E3DF") };
        sh.fragmentShader = sh.fragmentShader
          .replace(
            "#include <common>",
            "#include <common>\nuniform vec3 uHaze;",
          )
          .replace(
            "#include <dithering_fragment>",
            "#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, 0.62);",
          );
      };
      return m;
    });
    if (skyMats.some(Boolean)) {
      const panels: THREE.BufferGeometry[][] = [[], [], []];
      const half = SKY_D + 60;
      let k = 0;
      for (const side of [0, 1, 2, 3])
        for (let s = -half; s < half; s += SKY_W, k++) {
          const w = Math.min(SKY_W, half - s);
          const g = new THREE.PlaneGeometry(w, SKY_H);
          const uv = g.attributes.uv as THREE.BufferAttribute;
          for (let i = 0; i < uv.count; i++)
            uv.setXY(i, uv.getX(i) * (w / SKY_W), uv.getY(i));
          const mid = s + w / 2,
            cy = SKY_H / 2 - 12; // sink the base a little so the image's street level hides behind the walls
          if (side === 0) g.translate(mid, cy, -SKY_D);
          else if (side === 1) g.rotateY(Math.PI).translate(mid, cy, SKY_D);
          else if (side === 2)
            g.rotateY(-Math.PI / 2).translate(SKY_D, cy, -mid);
          else g.rotateY(Math.PI / 2).translate(-SKY_D, cy, -mid);
          panels[k % 3].push(g);
        }
      for (const v of [0, 1, 2]) {
        if (!skyMats[v] || !panels[v].length) continue;
        const m = new THREE.Mesh(
          mergeGeometries(panels[v], false)!,
          skyMats[v]!,
        );
        m.renderOrder = -10;
        m.frustumCulled = true;
        group.add(m);
      }
    }
  }

  // ---- props
  const barrierParts: THREE.BufferGeometry[] = [],
    wallParts: THREE.BufferGeometry[] = [],
    tunnelWallParts: THREE.BufferGeometry[] = [],
    tunnelPhotoWalls: THREE.BufferGeometry[] = [],
    miscParts: THREE.BufferGeometry[] = [];
  const coneList: Prop[] = [],
    parkedList: Prop[] = [];
  const dumpsters: Placement[] = [];
  const parapets: Placement[] = [],
    lamps: Placement[] = [];
  const containers: Record<string, Placement[]> = {
    container_r3_red: [],
    container_r3_blue: [],
  };
  for (const p of city.props) {
    switch (p.kind) {
      case "cone":
        coneList.push(p);
        break;
      case "barrier":
        barrierParts.push(colored(aabbBox(p.box, p.h - 0.5, p.h), 0xff6a2a));
        barrierParts.push(
          colored(
            aabbBox(
              {
                x0: p.box.x0,
                y0: p.box.y0,
                x1: p.box.x0 + 0.3,
                y1: p.box.y0 + 0.3,
              },
              0,
              p.h - 0.5,
            ),
            0xdddddd,
          ),
        );
        barrierParts.push(
          colored(
            aabbBox(
              {
                x0: p.box.x1 - 0.3,
                y0: p.box.y1 - 0.3,
                x1: p.box.x1,
                y1: p.box.y1,
              },
              0,
              p.h - 0.5,
            ),
            0xdddddd,
          ),
        );
        break;
      case "toll":
        // the closed arms: red/white striped bars at the arm height across one direction's lanes, a stub post at
        // each end (booths, islands and the canopy are the toll plaza in src/render/memes.ts)
        {
          const n = Math.round((p.box.y1 - p.box.y0) / 1.5);
          const seg = (p.box.y1 - p.box.y0) / n;
          for (let k = 0; k < n; k++)
            barrierParts.push(
              colored(
                aabbBox(
                  {
                    x0: p.box.x0 - 0.05,
                    y0: p.box.y0 + k * seg,
                    x1: p.box.x1 + 0.05,
                    y1: p.box.y0 + (k + 1) * seg,
                  },
                  p.h - 0.28,
                  p.h,
                ),
                k % 2 ? 0xf4f4f4 : 0xe0251b,
              ),
            );
          for (const yy of [p.box.y0 - 0.5, p.box.y1 + 0.5])
            barrierParts.push(
              colored(
                aabbBox(
                  {
                    x0: p.box.x0 - 0.3,
                    y0: yy - 0.3,
                    x1: p.box.x1 + 0.3,
                    y1: yy + 0.3,
                  },
                  0,
                  p.h + 0.25,
                ),
                0xffd23f,
              ),
            );
        }
        break;
      case "wall":
        // bridge railings -> round-3 parapet segments (6 m, tiling) with lamp posts every 30 m, arms over the road
        if (
          p.h === 1.1 &&
          p.box.x1 - p.box.x0 > 150 &&
          assets.models.has("bridge_parapet_r3")
        ) {
          const y = (p.box.y0 + p.box.y1) / 2;
          for (let x = p.box.x0 + 3; x < p.box.x1; x += 6)
            parapets.push({ x, y, rot: 0, s: 1 });
          // which side is the road: the parapet pair straddles the bridge centre line
          const toRoad = city.props.some(
            (q) =>
              q !== p &&
              q.kind === "wall" &&
              q.h === 1.1 &&
              (q.box.y0 + q.box.y1) / 2 > y,
          )
            ? 1
            : -1;
          for (let x = p.box.x0 + 15; x < p.box.x1 - 5; x += 30)
            lamps.push({
              x,
              y: y + toRoad * 1.1, // the pole sits 1.1 m behind the model centre (the arm reaches over the road)
              rot: (toRoad * Math.PI) / 2,
              s: 1,
            });
          break;
        }
        // round-4 TW_01 photo on the tunnel's inner faces: one tile per 6.5 m of height, ~15 m along
        if (p.h > 5 && T("TW_01")) {
          const t = city.tunnel;
          const len = p.box.x1 - p.box.x0,
            hh = C.CEIL_H;
          const north = (p.box.y0 + p.box.y1) / 2 > (t.y0 + t.y1) / 2;
          const g = new THREE.PlaneGeometry(len, hh);
          const uv = g.attributes.uv as THREE.BufferAttribute;
          for (let i = 0; i < uv.count; i++)
            uv.setX(i, (uv.getX(i) * len) / (hh * (2048 / 878)));
          if (!north) g.rotateY(Math.PI);
          g.translate(
            (p.box.x0 + p.box.x1) / 2,
            hh / 2,
            -(north ? p.box.y0 - 0.02 : p.box.y1 + 0.02),
          );
          tunnelPhotoWalls.push(g);
        }
        // world-scale UVs (BoxGeometry would stretch one tile over a 340 m face); tall walls are the tunnel's
        (p.h > 5 ? tunnelWallParts : wallParts).push(
          walls(p.box, p.h, p.h > 5 ? 9 : 6),
          quad(p.box.x0, p.box.y0, p.box.x1, p.box.y1, p.h, 6),
        );
        break;
      case "dumpster":
        // round-3 model (2.0 x 1.2 x 1.3 m, NO DUMPING face south) scaled into the 2.4 x 1.6 x 1.5 m box
        if (assets.models.has("dumpster_r3"))
          dumpsters.push({
            x: (p.box.x0 + p.box.x1) / 2,
            y: (p.box.y0 + p.box.y1) / 2,
            rot: 0,
            s: p.h / 1.3,
          });
        else miscParts.push(colored(aabbBox(p.box, 0, p.h), 0x2f6f4f));
        break;
      case "container": {
        // the 12 m box holds two 20-ft round-3 containers end to end, doors outward
        const id =
          p.color === 0x3b7dd8 || p.color === 0x5cb85c
            ? "container_r3_blue"
            : "container_r3_red";
        if (assets.models.has(id)) {
          const cy = (p.box.y0 + p.box.y1) / 2;
          containers[id].push(
            { x: p.box.x0 + 3.03, y: cy, rot: Math.PI, s: 1 },
            { x: p.box.x1 - 3.03, y: cy, rot: 0, s: 1 },
          );
        } else
          miscParts.push(colored(aabbBox(p.box, 0, p.h), p.color ?? 0xd9534f));
        break;
      }
      case "parked":
        parkedList.push(p);
        break;
      case "jamcar":
        // the tunnel jam reuses the parked-car models, so it is a mix of kinds and colours, not one cloned sedan
        parkedList.push({
          ...p,
          variant: p.variant ?? (p.id * 7) % PARKED_KINDS.length,
        });
        break;
    }
  }
  group.add(
    new THREE.Mesh(
      mergeGeometries(barrierParts, false)!,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }),
    ),
  );
  const wallsMesh = new THREE.Mesh(
    mergeGeometries(wallParts, false)!,
    concrete,
  );
  wallsMesh.castShadow = true;
  wallsMesh.receiveShadow = true;
  group.add(wallsMesh);
  if (tunnelWallParts.length) {
    const tw = new THREE.Mesh(
      mergeGeometries(tunnelWallParts, false)!,
      new THREE.MeshStandardMaterial({
        map: tunnelWallTexture(),
        roughness: 0.85,
        color: 0xc8c8c4,
      }),
    );
    tw.castShadow = true;
    tw.receiveShadow = true;
    group.add(tw);
  }
  if (tunnelPhotoWalls.length) {
    const pw = new THREE.Mesh(
      mergeGeometries(tunnelPhotoWalls, false)!,
      new THREE.MeshStandardMaterial({
        map: T("TW_01"),
        roughness: 0.6,
        color: 0xd8d8d8,
        // the strip lights stay readable in the dim tube
        emissiveMap: T("TW_01"),
        emissive: 0x2a2a2a,
      }),
    );
    pw.receiveShadow = true;
    group.add(pw);
  }
  inst("dumpster_r3", dumpsters);
  inst("bridge_parapet_r3", parapets);
  inst("bridge_lamp_r3", lamps);
  // round-3 construction-zone dressing: arrow-board trailer before the taper, ROAD WORK sign on the verge,
  // a water-barrier line along the closed lanes, and a mini excavator parked on steel road plates
  {
    const lists: Record<string, Placement[]> = {
      cz_arrowboard: [],
      cz_sign: [],
      cz_barrier: [],
      cz_excavator: [],
    };
    const plates: THREE.BufferGeometry[] = [];
    const outer = (C.laneOffset(2) + C.laneOffset(3)) / 2; // the two closed lanes, right of travel
    for (const z of city.zones) {
      if (z.kind !== "construction") continue;
      const ax = z.x1 - z.x0 > z.y1 - z.y0;
      // local frame: u along travel (+x or +y) from the first cone, v to the right of travel
      const ox = ax ? z.x0 + 10 : (z.x0 + z.x1) / 2,
        oy = ax ? (z.y0 + z.y1) / 2 : z.y0 + 10;
      const at = (u: number, v: number, r: number): Placement =>
        ax
          ? { x: ox + u, y: oy - v, rot: r, s: 1 }
          : { x: ox + v, y: oy + u, rot: r + Math.PI / 2, s: 1 };
      lists.cz_arrowboard.push(at(-7, outer, 0));
      lists.cz_sign.push(at(-32, C.ROADWAY_HALF + 2.2, 0));
      for (let k = 0; k < 6; k++)
        lists.cz_barrier.push(
          at(39 + k * 2.05, C.laneOffset(1) + C.LANE_W / 2 + 0.3, 0),
        );
      lists.cz_excavator.push(at(45, outer, 2.4));
      const pc = at(45, outer, 0);
      plates.push(
        new THREE.PlaneGeometry(ax ? 11 : 7, ax ? 7 : 11)
          .rotateX(-Math.PI / 2)
          .translate(pc.x, 0.03, -pc.y),
      );
    }
    for (const [id, list] of Object.entries(lists)) inst(id, list);
    const cz5 = T("CZ_05");
    if (cz5 && plates.length) {
      const m = new THREE.Mesh(
        mergeGeometries(plates, false)!,
        new THREE.MeshStandardMaterial({
          map: cz5,
          roughness: 0.75,
          metalness: 0.2,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      m.receiveShadow = true;
      group.add(m);
    }
  }
  for (const [id, list] of Object.entries(containers)) inst(id, list);
  // round-3 rental e-scooters left on the sidewalk corners, as they are
  {
    const list: Placement[] = [];
    city.nodes.forEach((nd, ni) => {
      if ((ni * 7) % 5 !== 0) return;
      const c = ni % 4,
        sx = c & 1 ? 1 : -1,
        sy = c & 2 ? 1 : -1;
      for (let k = 0; k < 1 + (ni % 3); k++)
        list.push({
          x: nd.x + sx * (C.ROADWAY_HALF + 4 + k * 1.1),
          y: nd.y + sy * (C.ROADWAY_HALF + 7 + k * 0.4),
          rot: ((ni * 2.3 + k * 1.7) % 6.28) - 3.14,
          s: 1,
        });
    });
    inst("scooter_r3", list);
  }
  if (miscParts.length) {
    const misc = new THREE.Mesh(
      mergeGeometries(miscParts, false)!,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.6,
        metalness: 0.2,
      }),
    );
    misc.castShadow = true;
    group.add(misc);
  }
  const coneBaked = assets.baked.get("cone-flat");
  const cones = new THREE.InstancedMesh(
    coneBaked?.geometry ?? new THREE.ConeGeometry(0.3, 0.7, 8),
    coneBaked?.material ?? new THREE.MeshStandardMaterial({ color: 0xff7a1a }),
    Math.max(1, coneList.length),
  );
  const coneIndex = new Map<number, number>();
  coneList.forEach((p, i) => {
    m4.makeTranslation(
      (p.box.x0 + p.box.x1) / 2,
      0,
      -(p.box.y0 + p.box.y1) / 2,
    );
    if (coneBaked) m4.scale(new THREE.Vector3(1.4, 1.4, 1.4));
    cones.setMatrixAt(i, m4);
    coneIndex.set(p.id, i);
  });
  group.add(cones);
  // ---- parked cars: instanced NPC models, grouped by variant
  {
    const byId = new Map<string, Placement[]>();
    for (const p of parkedList) {
      const id = KIND_MODEL[PARKED_KINDS[p.variant ?? 0]];
      (byId.get(id) ?? byId.set(id, []).get(id)!).push({
        x: (p.box.x0 + p.box.x1) / 2,
        y: (p.box.y0 + p.box.y1) / 2,
        rot: p.heading,
        s: 1,
      });
    }
    for (const [id, list] of byId) inst(id, list, false);
    if (parkedList.length) {
      // soft contact shadows so the parked rows do not float
      const bg = new THREE.PlaneGeometry(5.2, 2.6)
        .rotateX(-Math.PI / 2)
        .translate(0, 0.03, 0);
      const blobs = new THREE.InstancedMesh(
        bg,
        new THREE.MeshBasicMaterial({
          map: blobShadowTexture(),
          transparent: true,
          depthWrite: false,
        }),
        parkedList.length,
      );
      parkedList.forEach((p, i) => {
        pos.set((p.box.x0 + p.box.x1) / 2, 0, -(p.box.y0 + p.box.y1) / 2);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.heading);
        sc.setScalar(1);
        m4.compose(pos, q, sc);
        blobs.setMatrixAt(i, m4);
      });
      blobs.renderOrder = 1;
      group.add(blobs);
    }
  }

  // ---- ramps
  const rampParts: THREE.BufferGeometry[] = [];
  for (const r of city.ramps) {
    const L = r.axis === "x" ? r.box.x1 - r.box.x0 : r.box.y1 - r.box.y0;
    const Wd = r.axis === "x" ? r.box.y1 - r.box.y0 : r.box.x1 - r.box.x0;
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([
          0,
          0,
          -Wd / 2,
          L,
          0,
          -Wd / 2,
          L,
          r.height,
          -Wd / 2,
          0,
          0,
          Wd / 2,
          L,
          0,
          Wd / 2,
          L,
          r.height,
          Wd / 2,
        ]),
        3,
      ),
    );
    g.setIndex([
      0, 2, 1, 3, 4, 5, 0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 2, 3, 5, 2, 0, 3,
    ]);
    g.computeVertexNormals();
    const heading =
      r.axis === "x"
        ? r.dir > 0
          ? 0
          : Math.PI
        : r.dir > 0
          ? Math.PI / 2
          : -Math.PI / 2;
    g.rotateY(heading);
    const sx =
      r.axis === "x"
        ? r.dir > 0
          ? r.box.x0
          : r.box.x1
        : (r.box.x0 + r.box.x1) / 2;
    const sy =
      r.axis === "y"
        ? r.dir > 0
          ? r.box.y0
          : r.box.y1
        : (r.box.y0 + r.box.y1) / 2;
    g.translate(sx, 0, -sy);
    rampParts.push(g.toNonIndexed());
  }
  if (rampParts.length) {
    const ramps = new THREE.Mesh(
      mergeGeometries(rampParts, false)!,
      new THREE.MeshStandardMaterial({ color: 0xf0b429, roughness: 0.8 }),
    );
    ramps.castShadow = true;
    group.add(ramps);
  }

  // ---- tunnel + harbour dock
  {
    const t = city.tunnel;
    const parts = [
      aabbBox(
        { x0: t.x0, y0: t.y0 - 1, x1: t.x1, y1: t.y1 + 1 },
        C.CEIL_H,
        C.CEIL_H + 0.6,
      ),
    ];
    for (const [px0, px1] of [
      [t.x0 - 1.5, t.x0],
      [t.x1, t.x1 + 1.5],
    ]) {
      parts.push(
        aabbBox(
          { x0: px0, y0: t.y0 - 3, x1: px1, y1: t.y0 - 0.2 },
          0,
          C.CEIL_H + 3,
        ),
      );
      parts.push(
        aabbBox(
          { x0: px0, y0: t.y1 + 0.2, x1: px1, y1: t.y1 + 3 },
          0,
          C.CEIL_H + 3,
        ),
      );
      parts.push(
        aabbBox(
          { x0: px0, y0: t.y0 - 3, x1: px1, y1: t.y1 + 3 },
          C.CEIL_H,
          C.CEIL_H + 3,
        ),
      );
    }
    parts.push(
      aabbBox(
        { x0: t.x0 - 10, y0: t.y0 - 30, x1: t.x1 + 10, y1: t.y1 + 30 },
        C.CEIL_H + 0.6,
        C.CEIL_H + 1.6,
      ),
    );
    // bible §3: grey patterned tile walls, warm emissive fixtures, baked gradients instead of per-lamp lights
    const tunnelMat = new THREE.MeshStandardMaterial({
      map: tunnelWallTexture(),
      roughness: 0.85,
      color: 0xc8c8c4,
    });
    const deckMat = concrete;
    const tun = new THREE.Mesh(
      mergeGeometries(parts.slice(1), false)!,
      tunnelMat,
    );
    tun.castShadow = true;
    tun.receiveShadow = true;
    group.add(tun);
    const deck = new THREE.Mesh(parts[0], deckMat);
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);
    // round-3 TN_01 headwall on both portals: RIVER TUNNEL / 6.5 m / CEILING LANE OPEN over the mouth. The image's
    // keyed mouth (69.6 % x 54.2 % of the frame) is scaled onto the real 30.4 x 6.5 m opening.
    const tn = T("TN_01");
    if (tn) {
      const mouthW = t.y1 - t.y0 + 0.4;
      const PW = mouthW / 0.696,
        PH = C.CEIL_H / 0.542;
      const tnMat = new THREE.MeshStandardMaterial({
        map: tn,
        alphaTest: 0.5,
        roughness: 0.9,
      });
      const back: THREE.BufferGeometry[] = [];
      // on the front edge of the approach roof slab (10 m out), which would otherwise hide the sign band up close
      for (const [x, face] of [
        [t.x0 - 10, -1],
        [t.x1 + 10, 1],
      ] as const) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), tnMat);
        m.rotation.y = (face * Math.PI) / 2;
        m.position.set(x + face * 0.06, PH / 2, -(t.y0 + t.y1) / 2);
        m.receiveShadow = true;
        group.add(m);
        // the headwall is wider and taller than the old portal frame: solid wall behind the overhang
        const bx0 = face < 0 ? x : x - 1.5,
          bx1 = bx0 + 1.5;
        for (const [y0, y1] of [
          [-PW / 2, t.y0 - 0.2],
          [t.y1 + 0.2, PW / 2],
        ])
          back.push(aabbBox({ x0: bx0, y0, x1: bx1, y1 }, 0, PH));
        back.push(
          aabbBox({ x0: bx0, y0: -PW / 2, x1: bx1, y1: PW / 2 }, C.CEIL_H, PH),
        );
      }
      const bm = new THREE.Mesh(mergeGeometries(back, false)!, tunnelMat);
      bm.castShadow = bm.receiveShadow = true;
      group.add(bm);
    }
    // ceiling underside: round-4 TC_01 photo (the CEILING LANE: lanes, arrows, light rows; the yellow centre line
    // sits on the tunnel's centre line), else a darker slab so the roof reads as an enclosed box
    const tc = T("TC_01");
    if (tc) {
      const wid = t.y1 - t.y0 + 2,
        len = t.x1 - t.x0;
      const g = new THREE.PlaneGeometry(len, wid).rotateX(Math.PI / 2); // faces down
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++)
        uv.setX(i, (uv.getX(i) * len) / (wid * (2048 / 878)));
      g.translate((t.x0 + t.x1) / 2, C.CEIL_H - 0.01, -(t.y0 + t.y1) / 2);
      group.add(
        new THREE.Mesh(
          g,
          new THREE.MeshStandardMaterial({
            map: tc,
            roughness: 0.8,
            color: 0xbdbdbd,
            emissiveMap: tc,
            emissive: 0x333333,
          }),
        ),
      );
    } else
      group.add(
        new THREE.Mesh(
          quad(t.x0, t.y0 - 1, t.x1, t.y1 + 1, C.CEIL_H - 0.01, 6).scale(
            1,
            -1,
            1,
          ),
          new THREE.MeshStandardMaterial({
            color: 0x4a4a46,
            roughness: 1,
            side: THREE.DoubleSide,
          }),
        ),
      );
    // side darkening on the roadway (multiply): walls to ~1/3 width
    {
      const sd: THREE.BufferGeometry[] = [];
      const w = (t.y1 - t.y0) * 0.38;
      const strip = (ya: number, yb: number, dark: number) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(
            [
              t.x0,
              0.035,
              -ya,
              t.x1,
              0.035,
              -ya,
              t.x1,
              0.035,
              -yb,
              t.x0,
              0.035,
              -yb,
            ],
            3,
          ),
        );
        g.setAttribute(
          "color",
          new THREE.Float32BufferAttribute(
            [dark, dark, dark, dark, dark, dark, 1, 1, 1, 1, 1, 1],
            3,
          ),
        );
        g.setIndex([0, 2, 1, 0, 3, 2]);
        return g;
      };
      sd.push(strip(t.y0, t.y0 + w, 0.5), strip(t.y1, t.y1 - w, 0.5));
      const m = new THREE.Mesh(
        mergeGeometries(sd, false)!,
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          blending: THREE.MultiplyBlending,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          side: THREE.DoubleSide,
        }),
      );
      m.renderOrder = 2;
      group.add(m);
    }
    const lamps: THREE.BufferGeometry[] = [];
    const pools: THREE.BufferGeometry[] = [];
    for (let x = t.x0 + 4; x < t.x1; x += 8) {
      lamps.push(box(2.5, 0.1, 0.5, x, C.CEIL_H - 0.06, -(t.y0 + t.y1) / 2));
      // warm light pool under each fixture (additive, soft radial via vertex colours on a fan)
      const cx = x,
        cy = (t.y0 + t.y1) / 2,
        R = 7;
      const pos: number[] = [cx, 0.03, -cy],
        col: number[] = [0.55, 0.42, 0.2],
        idx: number[] = [];
      for (let k = 0; k <= 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        pos.push(cx + Math.cos(a) * R, 0.03, -(cy + Math.sin(a) * R * 0.75));
        col.push(0, 0, 0);
      }
      for (let k = 1; k <= 12; k++) idx.push(0, k + 1, k);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      pools.push(g);
    }
    {
      const m = new THREE.Mesh(
        mergeGeometries(pools, false)!,
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          side: THREE.DoubleSide,
        }),
      );
      m.renderOrder = 3;
      group.add(m);
    }
    group.add(
      new THREE.Mesh(
        mergeGeometries(lamps, false)!,
        new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
      ),
    );
    const dockStuff: THREE.BufferGeometry[] = [];
    const cols = [0xd9534f, 0x3b7dd8, 0x5cb85c, 0xf0ad4e, 0x9b59b6];
    for (let i = 0; i < 40; i++) {
      const x = t.x0 + 10 + rnd() * (t.x1 - t.x0 - 20),
        y = (rnd() < 0.5 ? t.y0 - 26 : t.y1 + 18) + rnd() * 8;
      const stack = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < stack; k++)
        dockStuff.push(
          colored(
            box(12, 2.6, 2.5, x, C.CEIL_H + 1.6 + 1.3 + k * 2.6, -y),
            cols[Math.floor(rnd() * cols.length)],
          ),
        );
    }
    for (const x of [-120, 120]) {
      dockStuff.push(
        colored(box(3, 40, 3, x, C.CEIL_H + 21, -(t.y0 - 26)), 0xe8e2d0),
      );
      dockStuff.push(
        colored(box(3, 40, 3, x, C.CEIL_H + 21, -(t.y1 + 26)), 0xe8e2d0),
      );
      dockStuff.push(
        colored(box(4, 3, 90, x, C.CEIL_H + 42, -(t.y0 + t.y1) / 2), 0xe8e2d0),
      );
    }
    const ds = new THREE.Mesh(
      mergeGeometries(dockStuff, false)!,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.6,
        metalness: 0.3,
      }),
    );
    ds.castShadow = true;
    group.add(ds);
  }

  // ---- bridges
  for (const k of C.CROSSINGS) {
    if (k === C.TUNNEL_ROW) continue;
    const yc = k * C.P;
    const parts: THREE.BufferGeometry[] = [];
    for (const x of [-C.RIVER_HALF + 10, C.RIVER_HALF - 10])
      for (const sgn of [-1, 1]) {
        parts.push(
          colored(
            box(2.5, 40, 2.5, x, 20, -(yc + sgn * (C.ROADWAY_HALF + 2.5))),
            0xd8dde6,
          ),
        );
        parts.push(
          colored(box(2.5, 2.5, 2 * C.ROADWAY_HALF + 7, x, 39, -yc), 0xd8dde6),
        );
      }
    for (let x = -C.RIVER_HALF - 30; x <= C.RIVER_HALF + 30; x += 10) {
      const hgt = 4 + 32 * (Math.abs(x) / (C.RIVER_HALF + 30)) ** 2;
      for (const sgn of [-1, 1])
        parts.push(
          colored(
            box(
              0.3,
              hgt,
              0.3,
              x,
              hgt / 2 + 1,
              -(yc + sgn * (C.ROADWAY_HALF + 2.5)),
            ),
            0xc0c6d0,
          ),
        );
    }
    const br = new THREE.Mesh(
      mergeGeometries(parts, false)!,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        metalness: 0.6,
        roughness: 0.4,
      }),
    );
    br.castShadow = true;
    group.add(br);
  }

  // ---- trees: two billboard species (tall broadleaf avenue tree, small rounded street tree) along sidewalks and in parks
  const treeSpots = city.treeSpots.slice();
  for (const e of city.edges) {
    if (e.crossing) continue;
    const a = city.nodes[e.a];
    // irregular spacing: 16-26 m, with occasional gaps where a lamp or bus stop would sit
    let s = C.ROAD_HALF + 10 + ((e.id * 7) % 5);
    while (s < e.len - C.ROAD_HALF - 5) {
      for (const sgn of [-1, 1])
        if ((e.id * 31 + Math.floor(s) * 17 + sgn) % 11 !== 0)
          treeSpots.push(
            e.axis === "x"
              ? { x: a.x + s, y: a.y + sgn * (C.ROADWAY_HALF + 5.5) }
              : { x: a.x + sgn * (C.ROADWAY_HALF + 5.5), y: a.y + s },
          );
      s += 16 + ((e.id * 13 + Math.floor(s)) % 11);
    }
  }
  {
    const makeCrown = (H: number, W: number, crownY: number) => {
      const p1 = new THREE.PlaneGeometry(W, H).translate(0, H / 2, 0);
      const p2 = new THREE.PlaneGeometry(W, H)
        .rotateY(Math.PI / 3)
        .translate(0, H / 2, 0);
      const p3 = new THREE.PlaneGeometry(W, H)
        .rotateY(-Math.PI / 3)
        .translate(0, H / 2, 0);
      const geo = mergeGeometries([p1, p2, p3], false)!;
      // spherical normals around the crown centre: the three cards shade as one round volume
      // instead of three differently-lit planes (classic billboard-tree trick).
      const p = geo.attributes.position,
        nrm = geo.attributes.normal;
      const c = new THREE.Vector3(0, crownY, 0),
        v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.set(p.getX(i), p.getY(i), p.getZ(i)).sub(c);
        v.y += 1.5;
        v.normalize();
        nrm.setXYZ(i, v.x, v.y, v.z);
      }
      nrm.needsUpdate = true;
      return geo;
    };
    // Lambert: these are large double-sided alpha-tested cards (heavy overdraw); PBR buys nothing on matte leaves
    const matFor = (tex: THREE.Texture) =>
      new THREE.MeshLambertMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
      });
    const bigSpots: typeof treeSpots = [],
      smallSpots: typeof treeSpots = [];
    treeSpots.forEach((t, i) =>
      ((i * 7919) % 10 < 3 ? smallSpots : bigSpots).push(t),
    );
    // Blender-rendered billboards (tools/blender/tree_billboard.py): square cards, side = render extent in metres
    const bigTex = assets.tex.get("tree_big"),
      smallTex = assets.tex.get("tree_small");
    const big = new THREE.InstancedMesh(
      bigTex ? makeCrown(10.18, 10.18, 7.3) : makeCrown(10, 7.5, 6.2),
      matFor(bigTex ?? treeTexture()),
      Math.max(1, bigSpots.length),
    );
    const small = new THREE.InstancedMesh(
      smallTex ? makeCrown(6.57, 6.57, 4.8) : makeCrown(6, 5, 3.9),
      matFor(smallTex ?? treeTexture(1)),
      Math.max(1, smallSpots.length),
    );
    const tints = [
      new THREE.Color(0xe8e8e0),
      new THREE.Color(0xf4f0dc),
      new THREE.Color(0xd8e0cc),
      new THREE.Color(0xf0e8c8),
      new THREE.Color(0xdce6d0),
    ];
    const place = (
      im: THREE.InstancedMesh,
      spots: typeof treeSpots,
      baseS: number,
    ) => {
      spots.forEach((t, i) => {
        const s = baseS * (0.85 + ((i * 37) % 10) / 22);
        pos.set(t.x, 0, -t.y);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * 1.7) % 3.14);
        sc.setScalar(s);
        m4.compose(pos, q, sc);
        im.setMatrixAt(i, m4);
        im.setColorAt(i, tints[(i * 7) % tints.length]);
      });
      im.count = spots.length;
      im.castShadow = true; // alpha-tested crown shadows on the road: cheap cards, strong realism cue
      group.add(im);
    };
    place(big, bigSpots, 1);
    place(small, smallSpots, 1);
  }

  // ---- street lights
  {
    const spots: { x: number; y: number; rot: number }[] = [];
    for (const e of city.edges) {
      const a = city.nodes[e.a];
      for (let s = 25; s < e.len - 15; s += 45) {
        if (e.axis === "x") {
          for (const sgn of [-1, 1])
            spots.push({
              x: a.x + s,
              y: a.y + sgn * (C.ROADWAY_HALF + 2.0),
              rot: sgn > 0 ? Math.PI : 0,
            });
        } else {
          for (const sgn of [-1, 1])
            spots.push({
              x: a.x + sgn * (C.ROADWAY_HALF + 2.0),
              y: a.y + s,
              rot: sgn > 0 ? -Math.PI / 2 : Math.PI / 2,
            });
        }
      }
    }
    const poleGeo = mergeGeometries(
      [box(0.22, 9, 0.22, 0, 4.5, 0), box(0.18, 0.18, 4, 0, 9, -2)],
      false,
    )!;
    const poles = new THREE.InstancedMesh(
      poleGeo,
      new THREE.MeshStandardMaterial({
        color: 0x6b6f78,
        metalness: 0.6,
        roughness: 0.5,
      }),
      spots.length,
    );
    const lamps = new THREE.InstancedMesh(
      box(0.5, 0.25, 1.2, 0, 8.9, -3.6),
      new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4 }),
      spots.length,
    );
    spots.forEach((p, i) => {
      pos.set(p.x, 0, -p.y);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot);
      sc.setScalar(1);
      m4.compose(pos, q, sc);
      poles.setMatrixAt(i, m4);
      lamps.setMatrixAt(i, m4);
    });
    poles.castShadow = true;
    group.add(poles, lamps);
  }

  // ---- road wear: wheel-path darkening per lane + sparse stains/patches (multiply overlays, two draw calls)
  {
    const wear: THREE.BufferGeometry[] = [],
      stain: THREE.BufferGeometry[] = [];
    const Yw = 0.025;
    for (const e of city.edges) {
      const a = city.nodes[e.a];
      const s0 = C.ROAD_HALF,
        s1 = e.len - C.ROAD_HALF,
        L = s1 - s0;
      for (const side of [-1, 1]) {
        const o0 = side * C.MEDIAN_HALF,
          o1 = side * C.ROADWAY_HALF;
        const lo = Math.min(o0, o1),
          hi = Math.max(o0, o1);
        const g =
          e.axis === "x"
            ? quad(a.x + s0, a.y + lo, a.x + s1, a.y + hi, Yw, 1)
            : quad(a.x + lo, a.y + s0, a.x + hi, a.y + s1, Yw, 1);
        // uv: u across lanes (1 lane = 1 repeat), v along the road (20 m per repeat)
        const uv = g.attributes.uv as THREE.BufferAttribute;
        const pos = g.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) {
          const px = pos.getX(i),
            pz = -pos.getZ(i);
          const across = e.axis === "x" ? pz - a.y - lo : px - a.x - lo;
          const along = e.axis === "x" ? px - a.x - s0 : pz - a.y - s0;
          uv.setXY(i, across / C.LANE_W, along / 20);
        }
        wear.push(g);
        const g2 = g.clone();
        const uv2 = g2.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv2.count; i++)
          uv2.setXY(
            i,
            (uv2.getX(i) * C.LANE_W) / 24 + e.id * 0.37,
            (uv2.getY(i) * 20) / 24,
          );
        stain.push(g2);
        void L;
      }
    }
    const mk = (parts: THREE.BufferGeometry[], map: THREE.Texture) => {
      const m = new THREE.Mesh(
        mergeGeometries(parts, false)!,
        new THREE.MeshBasicMaterial({
          map,
          blending: THREE.MultiplyBlending,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
        }),
      );
      m.renderOrder = 2;
      group.add(m);
    };
    mk(wear, laneWearTexture());
    mk(stain, roadStainTexture());
  }

  // The exact same city-owned placement list drives rendering and static collisions.
  group.userData.signs = city.signs;
  // how many commutes' guidance routes use each edge: the meme dressing goes where every player drives
  const routeUse = new Map<number, number>();
  for (const cm of city.commutes) {
    const p = shortestPath(city, cm.home.id, cm.office.id);
    for (let i = 1; i < p.length; i++) {
      const eid = p[i - 1].edges.find((id) => {
        const e = city.edges[id];
        return e.a === p[i].id || e.b === p[i].id;
      });
      if (eid !== undefined) routeUse.set(eid, (routeUse.get(eid) ?? 0) + 1);
    }
  }
  // ---- utility poles + sagging wires on side streets (not on the fenced arterials)
  {
    const poleSpots: { x: number; y: number; rot: number }[] = [];
    const wirePts: number[] = [];
    const isArterial = (e: (typeof city.edges)[number]) => {
      const na = city.nodes[e.a];
      return (
        (e.axis === "x" && C.CROSSINGS.includes(na.j)) ||
        (e.axis === "y" && (Math.abs(na.i) === 1 || Math.abs(na.i) === 4))
      );
    };
    const wire = (
      ax: number,
      ay: number,
      bx: number,
      by: number,
      h: number,
    ) => {
      const N = 6,
        sag = 0.7;
      for (let i = 0; i < N; i++) {
        const t0 = i / N,
          t1 = (i + 1) / N;
        const y0 = h - sag * 4 * t0 * (1 - t0),
          y1 = h - sag * 4 * t1 * (1 - t1);
        wirePts.push(
          ax + (bx - ax) * t0,
          y0,
          -(ay + (by - ay) * t0),
          ax + (bx - ax) * t1,
          y1,
          -(ay + (by - ay) * t1),
        );
      }
    };
    for (const e of city.edges) {
      if (e.crossing || isArterial(e)) continue;
      const a = city.nodes[e.a];
      const side = (a.i + a.j) % 2 === 0 ? 1 : -1; // one side per street, alternating
      const off = side * (C.ROAD_HALF - 1.2);
      let prev: { x: number; y: number } | null = null;
      for (let s = C.ROAD_HALF + 4; s < e.len - C.ROAD_HALF - 2; s += 30) {
        const p =
          e.axis === "x"
            ? { x: a.x + s, y: a.y + off }
            : { x: a.x + off, y: a.y + s };
        if (inBoxAny(city, p.x, p.y)) {
          prev = null;
          continue;
        }
        poleSpots.push({
          x: p.x,
          y: p.y,
          rot: e.axis === "x" ? 0 : Math.PI / 2,
        });
        if (prev) {
          for (const [dh, dc] of [
            [0, -0.7],
            [0, 0.7],
            [-0.6, 0],
          ] as const) {
            const cx = e.axis === "x" ? 0 : dc,
              cy = e.axis === "x" ? dc : 0;
            wire(prev.x + cx, prev.y + cy, p.x + cx, p.y + cy, 9.4 + dh);
          }
        }
        prev = p;
      }
    }
    const pg = mergeGeometries(
      [
        new THREE.CylinderGeometry(0.14, 0.19, 10, 7).translate(0, 5, 0),
        box(1.8, 0.1, 0.1, 0, 9.4, 0), // crossarm
        box(0.06, 0.25, 0.06, -0.7, 9.5, 0),
        box(0.06, 0.25, 0.06, 0.7, 9.5, 0), // insulators
        box(0.5, 0.7, 0.4, 0.35, 7.6, 0), // transformer can
      ],
      false,
    )!;
    const poles = new THREE.InstancedMesh(
      pg,
      new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.95 }),
      poleSpots.length,
    );
    poleSpots.forEach((p, i) => {
      pos.set(p.x, 0, -p.y);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot);
      sc.setScalar(1);
      m4.compose(pos, q, sc);
      poles.setMatrixAt(i, m4);
    });
    poles.castShadow = true;
    group.add(poles);
    if (wirePts.length) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute("position", new THREE.Float32BufferAttribute(wirePts, 3));
      group.add(
        new THREE.LineSegments(
          wg,
          new THREE.LineBasicMaterial({ color: 0x23232a }),
        ),
      );
    }
  }

  // ---- green direction-sign gantries over the arterial approaches (bible: very characteristic overhead boards)
  {
    const BOARDS: [string, string, string, string, string][] = [
      ["Downtown", "Harbor", "\u2191", "\u2192", "12"],
      ["Station", "Old Town", "\u2191", "\u2190", "7"],
      ["Airport", "Riverside", "\u2192", "\u2191", "41"],
      ["City Hall", "Stadium", "\u2190", "\u2191", "3"],
      ["Marina", "University", "\u2191", "\u2192", "18"],
      ["Expressway", "Market", "\u2191", "\u2190", "60"],
    ];
    const posts = city.signs.direction;
    const per = BOARDS.map((_, i) => posts.filter((p) => p.board === i));
    // gantry: 7.5 m post + 9 m arm (local +x = across the road)
    const gg = mergeGeometries(
      [
        new THREE.CylinderGeometry(
          0.16,
          D.postRadius,
          D.postHeight,
          8,
        ).translate(0, D.postHeight / 2, 0),
        new THREE.CylinderGeometry(D.armRadius, D.armRadius, D.armLength, 8)
          .rotateZ(Math.PI / 2)
          .translate(D.armX, D.armHeight, 0),
        box(D.jointSize, D.jointSize, D.jointSize, 0, D.armHeight, 0),
      ],
      false,
    )!;
    const gm = new THREE.InstancedMesh(
      gg,
      new THREE.MeshStandardMaterial({
        color: 0x8c9199,
        metalness: 0.6,
        roughness: 0.45,
      }),
      posts.length,
    );
    posts.forEach((p, i) => {
      pos.set(p.x, 0, -p.y);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot);
      sc.setScalar(1);
      m4.compose(pos, q, sc);
      gm.setMatrixAt(i, m4);
    });
    gm.castShadow = true;
    group.add(gm);
    BOARDS.forEach((b, i) => {
      const list = per[i];
      if (!list.length) return;
      // board 4.2 x 2.1 m hung under the arm, centred 6 m out over lanes 2-3; double-sided plane so it reads from either yaw
      // two front-facing planes back to back (width along the arm, normals along local ±z = travel axis) so the
      // text reads correctly from either approach instead of mirrored through a double-sided plane
      const bg = mergeGeometries(
        [
          new THREE.PlaneGeometry(D.boardWidth, D.boardSize).translate(
            D.boardX,
            D.boardHeight,
            D.boardDepth / 2,
          ),
          new THREE.PlaneGeometry(D.boardWidth, D.boardSize)
            .rotateY(Math.PI)
            .translate(D.boardX, D.boardHeight, -D.boardDepth / 2),
        ],
        false,
      )!;
      const bm = new THREE.InstancedMesh(
        bg,
        new THREE.MeshStandardMaterial({
          map: directionBoardTexture(...b),
          roughness: 0.6,
        }),
        list.length,
      );
      list.forEach((p, k) => {
        pos.set(p.x, 0, -p.y);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot);
        sc.setScalar(1);
        m4.compose(pos, q, sc);
        bm.setMatrixAt(k, m4);
      });
      group.add(bm);
    });
  }

  /** edges the skyway deck runs over (no overhead dressing there) */
  const underSkyway = (id: number) => {
    const e = city.edges[id],
      a = city.nodes[e.a],
      b = city.nodes[e.b];
    return (
      e.axis === "x" &&
      a.y === city.skyway.y &&
      Math.max(a.x, b.x) > city.skyway.x0 &&
      Math.min(a.x, b.x) < city.skyway.x1
    );
  };

  // ---- meme wrecks (research board: "Roadster comes to town" AI images): cars rammed nose-first into overhead
  // sign boards on the arterials, and now and then a car that flew off a jump and ended up in a building. Static.
  {
    const KINDS = ["roadster", "sedan", "suv", "hatchback", "taxi"] as const;
    const wrecks = new Map<string, THREE.Matrix4[]>();
    const holesConcrete: THREE.BufferGeometry[] = [],
      holesGlass: THREE.BufferGeometry[] = [];
    const addWreck = (id: string, mm: THREE.Matrix4) =>
      (wrecks.get(id) ?? wrecks.set(id, []).get(id)!).push(mm);
    const debris: THREE.BufferGeometry[] = [];
    const ONE = new THREE.Vector3(1, 1, 1);
    const Yax = new THREE.Vector3(0, 1, 0);
    const qw = new THREE.Quaternion(),
      ew = new THREE.Euler();
    let k = 0;
    /** n items spread evenly over the whole list (the lists run west to east), offset so they avoid the edges */
    const spread = <T>(list: T[], n: number): T[] =>
      list.length <= n
        ? list
        : Array.from(
            { length: n },
            (_, j) => list[Math.floor(((j + 0.5) * list.length) / n)],
          );
    // sign gantries: nose through the board, tail up over the lanes, a torn flap hanging, chunks on the road
    const use = (eid: number) => routeUse.get(eid) ?? 0;
    // sign wrecks: the busiest commute-route gantries first, a few elsewhere for free roamers
    const gantryPick = city.signs.wrecks;
    // building crashes: a car buried nose-first in a facade (most a floor or two up, flown in; some through the
    // shopfront), on the busiest commute roads first and a few elsewhere
    const crashSpots: { px: number; py: number; heading: number; h: number }[] =
      [];
    {
      const routeEdges = [...routeUse.keys()]
        .filter((id) => !city.edges[id].crossing && !underSkyway(id))
        .sort((a, b) => use(b) - use(a));
      const others = city.edges
        .map((_, i) => i)
        .filter((i) => !routeUse.has(i) && !city.edges[i].crossing);
      [...routeEdges.slice(0, 10), ...spread(others, 4)].forEach((id, j) => {
        const e = city.edges[id],
          a = city.nodes[e.a],
          b = city.nodes[e.b];
        const sideSign = j % 2 ? 1 : -1; // which side of the road
        const lo =
            (e.axis === "x" ? Math.min(a.x, b.x) : Math.min(a.y, b.y)) +
            C.ROAD_HALF +
            4,
          hi =
            (e.axis === "x" ? Math.max(a.x, b.x) : Math.max(a.y, b.y)) -
            C.ROAD_HALF -
            4,
          mid = (lo + hi) / 2,
          roadLine = e.axis === "x" ? a.y : a.x;
        let best: (typeof city.buildings)[number] | null = null,
          bestD = Infinity;
        for (const bd of city.buildings) {
          if (bd.kind.includes("skyscraper")) continue;
          const bx = bd.box;
          const face =
            e.axis === "x"
              ? sideSign > 0
                ? bx.y0
                : bx.y1
              : sideSign > 0
                ? bx.x0
                : bx.x1;
          if (Math.abs(face - (roadLine + sideSign * C.ROAD_HALF)) > 6)
            continue;
          const [b0, b1] = e.axis === "x" ? [bx.x0, bx.x1] : [bx.y0, bx.y1];
          if (b0 < lo || b1 > hi) continue;
          const d = Math.abs((b0 + b1) / 2 - mid);
          if (d < bestD) {
            bestD = d;
            best = bd;
          }
        }
        if (!best) return;
        const bx = best.box;
        const up = (j * 37) % 3 !== 0;
        const h = up ? 3 + ((j * 53) % 4) : 0.15;
        const off = ((j * 29) % 7) - 3;
        if (e.axis === "x")
          crashSpots.push({
            px: C.clamp((bx.x0 + bx.x1) / 2 + off, bx.x0 + 3, bx.x1 - 3),
            py: sideSign > 0 ? bx.y0 : bx.y1,
            heading: sideSign > 0 ? Math.PI / 2 : -Math.PI / 2,
            h,
          });
        else
          crashSpots.push({
            px: sideSign > 0 ? bx.x0 : bx.x1,
            py: C.clamp((bx.y0 + bx.y1) / 2 + off, bx.y0 + 3, bx.y1 - 3),
            heading: sideSign > 0 ? 0 : Math.PI,
            h,
          });
      });
    }
    group.userData.wreckSpots = { gantry: gantryPick, building: crashSpots }; // dev lookup
    for (const p of gantryPick) {
      const id = KIND_MODEL[KINDS[k++ % KINDS.length]];
      const model = assets.models.get(id);
      if (!model) continue;
      // speared straight THROUGH the board (it flew in from the traffic side, +z): the board plane cuts the car in
      // half, the tail sticks out of the sign face toward oncoming drivers and the nose pokes out of the back
      ew.set(p.roll, p.yaw, p.pitch, "YXZ"); // roll, yaw (+x -> -z, through the board), nose down
      qw.setFromEuler(ew);
      const mid = new THREE.Vector3(0, model.size.y / 2, 0).applyQuaternion(qw);
      const local = new THREE.Matrix4().compose(
        new THREE.Vector3(p.localX, p.height, 0).sub(mid),
        qw,
        ONE,
      );
      const G = new THREE.Matrix4().compose(
        new THREE.Vector3(p.x, 0, -p.y),
        new THREE.Quaternion().setFromAxisAngle(Yax, p.rot),
        ONE,
      );
      addWreck(id, new THREE.Matrix4().multiplyMatrices(G, local));
      // a torn, ragged hole around the body on both faces of the board
      const cx = p.localX,
        cy = p.height;
      const rag = new THREE.Shape();
      for (let a = 0; a < 16; a++) {
        const t = (a / 16) * Math.PI * 2;
        const r = a % 2 ? 1 : 1.28 + ((a * 7) % 3) * 0.08;
        const px = Math.cos(t) * 1.25 * r,
          py = Math.sin(t) * 0.95 * r;
        if (a === 0) rag.moveTo(px, py);
        else rag.lineTo(px, py);
      }
      for (const z of [0.14, -0.14])
        debris.push(
          colored(
            new THREE.ShapeGeometry(rag).translate(cx, cy, z).applyMatrix4(G),
            0x0d140f,
          ),
        );
      // sign metal peeled out around the exit hole, bent back the way the car was going
      for (let j = 0; j < 6; j++) {
        const t = (j / 6) * Math.PI * 2 + 0.3;
        const rx = Math.cos(t) * 1.3,
          ry = Math.sin(t) * 1.0;
        const tx = -Math.sin(t),
          ty = Math.cos(t); // rim tangent
        const g = new THREE.BufferGeometry();
        g.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(
            [
              cx + rx - tx * 0.45,
              cy + ry - ty * 0.45,
              -0.14,
              cx + rx + tx * 0.45,
              cy + ry + ty * 0.45,
              -0.14,
              cx + rx * 1.15,
              cy + ry * 1.15,
              -0.95 - (j % 3) * 0.2,
            ],
            3,
          ),
        );
        // same attribute layout as the boxes / planes it is merged with (indexed, with uv)
        g.setAttribute(
          "uv",
          new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2),
        );
        g.setIndex([0, 1, 2]);
        g.computeVertexNormals();
        debris.push(colored(g.applyMatrix4(G), j % 2 ? 0x1f7a3a : 0xe8efe9));
      }
      for (let j = 0; j < 6; j++) {
        const s = 0.25 + ((j * 37) % 5) * 0.08;
        const ch = new THREE.BoxGeometry(s, 0.06, s * 0.7)
          .rotateY(j * 1.3)
          .translate(3.5 + j * 1.0, 0.03, ((j * 53) % 7) - 3);
        debris.push(colored(ch.applyMatrix4(G), j % 2 ? 0x1f7a3a : 0xb8bcc2));
      }
    }
    // power lines: car caught mid-span about 8 m up, wrapped in extra cables dipping through and around it
    const CRASH_KINDS = [
      "roadster",
      "roadster",
      "sedan",
      "suv",
      "taxi",
      "hatchback",
    ] as const;
    for (const sp of crashSpots) {
      const id = KIND_MODEL[CRASH_KINDS[k++ % CRASH_KINDS.length]];
      const model = assets.models.get(id);
      if (!model) continue;
      const L = model.size.x,
        H = model.size.y;
      const pitch = -(0.12 + ((k * 17) % 5) * 0.05); // nose down into the wall
      const roll = (((k * 31) % 7) - 3) * 0.06;
      ew.set(roll, sp.heading, pitch, "YXZ");
      qw.setFromEuler(ew);
      const fx = Math.cos(sp.heading),
        fy = Math.sin(sp.heading); // into the building
      const back = L / 2 - 1.7; // the nose is buried ~1.7 m deep
      const body = new THREE.Vector3(
        sp.px - fx * back,
        sp.h + H / 2,
        -(sp.py - fy * back),
      );
      const centre = new THREE.Vector3(0, H / 2, 0).applyQuaternion(qw);
      addWreck(id, new THREE.Matrix4().compose(body.sub(centre), qw, ONE));
      // the broken-in hole around the nose, and rubble + glass on the pavement below
      const psi = Math.atan2(-fx, fy); // plane normal faces out of the wall, toward the road
      // round-4 photo holes: smashed concrete up the facade, a burst glass shopfront at street level. The black
      // centre of the photo (~68% x 46% of it) frames the car body.
      const glass = sp.h < 1;
      const holeTex = T(glass ? "WR_02" : "WR_01");
      if (holeTex)
        (glass ? holesGlass : holesConcrete).push(
          new THREE.PlaneGeometry(3.9, 3.9)
            .rotateY(psi)
            .translate(sp.px - fx * 0.06, sp.h + H * 0.5, -(sp.py - fy * 0.06)),
        );
      else
        debris.push(
          colored(
            new THREE.PlaneGeometry(3.4, 2.4)
              .rotateY(psi)
              .translate(
                sp.px - fx * 0.04,
                sp.h + H * 0.5,
                -(sp.py - fy * 0.04),
              ),
            0x151515,
          ),
        );
      for (let j = 0; j < 9; j++) {
        const sz = 0.18 + ((j * 37) % 5) * 0.09;
        const out = 0.6 + ((j * 13) % 7) * 0.4,
          lat = ((j * 29) % 9) - 4;
        const gx = sp.px - fx * out - fy * lat * 0.4,
          gy = sp.py - fy * out + fx * lat * 0.4;
        debris.push(
          colored(
            new THREE.BoxGeometry(sz, sz * 0.5, sz * 0.8)
              .rotateY(j * 1.1)
              .translate(gx, C.CURB_H + sz * 0.25, -gy),
            j % 3 === 0 ? 0xa8c8d8 : 0x8f8d88,
          ),
        );
      }
    }
    for (const [id, list] of wrecks) {
      for (const part of assets.models.get(id)!.parts) {
        const im = new THREE.InstancedMesh(
          part.geometry,
          part.material,
          list.length,
        );
        list.forEach((mm, i) => im.setMatrixAt(i, mm));
        im.name = "wreck";
        im.castShadow = true;
        im.receiveShadow = true;
        group.add(im);
      }
    }
    (
      [
        [holesConcrete, "WR_01"],
        [holesGlass, "WR_02"],
      ] as const
    ).forEach(([list, name]) => {
      if (!list.length) return;
      group.add(
        new THREE.Mesh(
          mergeGeometries(list, false)!,
          new THREE.MeshStandardMaterial({
            map: T(name),
            alphaTest: 0.5,
            roughness: name === "WR_02" ? 0.3 : 0.9,
            metalness: name === "WR_02" ? 0.3 : 0,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
          }),
        ),
      );
    });
    if (debris.length)
      group.add(
        new THREE.Mesh(
          mergeGeometries(debris, false)!,
          new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.7,
            side: THREE.DoubleSide, // torn sign petals and holes are seen from both sides
          }),
        ),
      );
  }

  // ---- skyway: elevated deck over the y = 0 arterial east of the tunnel (E climbs on / drops off)
  let ticker: THREE.Texture | null = null;
  {
    const sw = city.skyway;
    const top = sw.h,
      bottom = sw.h - 1.4;
    type B = { x0: number; y0: number; x1: number; y1: number };
    /** a downward-facing quad (mirroring a flat quad in y does not reverse its winding, so flip the triangles) */
    const under = (b: B, h: number, tile: number) => {
      const g = quad(b.x0, b.y0, b.x1, b.y1, h, tile);
      const idx = g.index!;
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i + 1);
        idx.setX(i + 1, idx.getX(i + 2));
        idx.setX(i + 2, a);
      }
      const n = g.attributes.normal as THREE.BufferAttribute;
      for (let i = 0; i < n.count; i++) n.setY(i, -n.getY(i));
      return g;
    };
    /** a box with world-scale UVs on every face (BoxGeometry would stretch one tile over 500 m) */
    const solid = (b: B, y0: number, y1: number, tile: number) => [
      walls(b, y1 - y0, tile).translate(0, y0, 0),
      quad(b.x0, b.y0, b.x1, b.y1, y1, tile),
      under(b, y0, tile),
    ];
    const conc: THREE.BufferGeometry[] = [];
    const deck: B = {
      x0: sw.x0,
      y0: sw.y - sw.half,
      x1: sw.x1,
      y1: sw.y + sw.half,
    };
    conc.push(walls(deck, top - bottom, 6).translate(0, bottom, 0));
    conc.push(under(deck, bottom, 6)); // the deck soffit, seen from the road
    for (const s of [-1, 1]) {
      const y0 = sw.y + s * sw.half;
      const y1 = y0 - s * 0.45;
      conc.push(
        ...solid(
          { x0: sw.x0, y0: Math.min(y0, y1), x1: sw.x1, y1: Math.max(y0, y1) },
          top,
          top + 1.0,
          6,
        ),
      );
    }
    for (const p of sw.piers) {
      conc.push(...solid(p, 0, bottom - 1.2, 4));
      conc.push(
        ...solid(
          {
            x0: p.x0 - 0.5,
            y0: sw.y - sw.half + 0.6,
            x1: p.x1 + 0.5,
            y1: sw.y + sw.half - 0.6,
          },
          bottom - 1.2,
          bottom,
          4,
        ),
      );
    }
    const cm = new THREE.Mesh(mergeGeometries(conc, false)!, concrete);
    cm.castShadow = true;
    cm.receiveShadow = true;
    group.add(cm);
    const road = new THREE.Mesh(
      quad(deck.x0, deck.y0, deck.x1, deck.y1, top, 8),
      asphalt,
    );
    road.receiveShadow = true;
    group.add(road);
    // lane paint: double yellow centre line, dashed lane split, solid edge lines
    const paint: THREE.BufferGeometry[] = [];
    const line = (x0: number, x1: number, y: number, w: number, col: number) =>
      paint.push(
        colored(quad(x0, y - w / 2, x1, y + w / 2, top + 0.02, 4), col),
      );
    for (const s of [-1, 1]) {
      line(sw.x0, sw.x1, sw.y + s * 0.18, 0.14, 0xf2c230);
      line(sw.x0, sw.x1, sw.y + s * (sw.half - 0.9), 0.16, 0xf4f4f4);
      for (let x = sw.x0 + 4; x < sw.x1 - 6; x += 12)
        line(x, x + 6, sw.y + s * 3.9, 0.14, 0xf4f4f4);
    }
    group.add(
      new THREE.Mesh(
        mergeGeometries(paint, false)!,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
      ),
    );
    // the hint sign hangs under the west end, facing traffic coming out of the tunnel
    const signTex = skywaySignTexture();
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(13, 3.25),
      new THREE.MeshStandardMaterial({
        map: signTex,
        roughness: 0.5,
        emissive: 0xffffff,
        emissiveMap: signTex,
        emissiveIntensity: 0.25,
      }),
    );
    sign.rotation.y = -Math.PI / 2; // faces -x (west)
    sign.position.set(sw.x0 - 0.05, bottom - 1.7, -sw.y);
    group.add(sign);
  }

  const boardRDST = stockBoardTexture(0); // shared by the tunnel board and the road gantries
  // ---- giant LED stock board over the river-tunnel mouth: every commute drives straight at it for ~600 m
  {
    const { tx, W, H, bottom } = city.signs.tunnel;
    const board = boardRDST;
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshBasicMaterial({ map: board, color: 0xe8e8e8 }),
    );
    face.rotation.y = -Math.PI / 2; // faces -x (west, toward incoming traffic)
    face.position.set(tx, bottom + H / 2, 0);
    group.add(face);
    ticker = tickerStripTexture();
    ticker.repeat.set(2, 1);
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(W, 2.2),
      new THREE.MeshBasicMaterial({ map: ticker, color: 0xe8e8e8 }),
    );
    strip.rotation.y = -Math.PI / 2;
    strip.position.set(tx, bottom - 1.4, 0);
    group.add(strip);
    // dark frame, backing and two legs standing on the tunnel roof
    const frame: THREE.BufferGeometry[] = [
      box(0.8, H + 4.2, W + 1.6, tx + 0.45, bottom - 2.6 + (H + 4.2) / 2, 0),
      box(
        1.2,
        bottom - 2.5 - C.CEIL_H,
        1.2,
        tx + 1.5,
        (bottom - 2.5 + C.CEIL_H) / 2,
        -12,
      ),
      box(
        1.2,
        bottom - 2.5 - C.CEIL_H,
        1.2,
        tx + 1.5,
        (bottom - 2.5 + C.CEIL_H) / 2,
        12,
      ),
    ];
    const fm = new THREE.Mesh(
      mergeGeometries(frame, false)!,
      new THREE.MeshStandardMaterial({
        color: 0x1b1e24,
        roughness: 0.6,
        metalness: 0.4,
      }),
    );
    fm.castShadow = true;
    group.add(fm);
  }

  // ---- LED stock gantries spanning the busiest commute roads: RDST faces the commuters, ORBT the other way
  {
    const boardORBT = stockBoardTexture(1);
    const picks = city.signs.led;
    const { W, H, bottom } = LED;
    const front: THREE.BufferGeometry[] = [],
      backs: THREE.BufferGeometry[] = [],
      strips: THREE.BufferGeometry[] = [],
      steel: THREE.BufferGeometry[] = [];
    for (const p of picks) {
      const { x: mx, y: my, rot: psi, dx, dy } = p;
      front.push(
        new THREE.PlaneGeometry(W, H)
          .rotateY(psi)
          .translate(mx, bottom + H / 2, -my),
      );
      backs.push(
        new THREE.PlaneGeometry(W, H)
          .rotateY(psi + Math.PI)
          .translate(mx + dx * 0.7, bottom + H / 2, -(my + dy * 0.7)),
      );
      strips.push(
        new THREE.PlaneGeometry(W, 1.5)
          .rotateY(psi)
          .translate(mx, bottom - 0.9, -my),
      );
      steel.push(
        new THREE.BoxGeometry(W + 1.2, H + 2.6, 0.5)
          .rotateY(psi)
          .translate(
            mx + dx * 0.35,
            bottom - 1.8 + (H + 2.6) / 2,
            -(my + dy * 0.35),
          ),
      );
      for (const s of [-1, 1]) {
        const px = mx - dy * s * (W / 2 + 0.6),
          py = my + dx * s * (W / 2 + 0.6);
        steel.push(
          new THREE.BoxGeometry(1, bottom + H + 1.2, 1).translate(
            px,
            (bottom + H + 1.2) / 2,
            -py,
          ),
        );
      }
    }
    if (picks.length) {
      const screen = (geo: THREE.BufferGeometry[], map: THREE.Texture) =>
        group.add(
          new THREE.Mesh(
            mergeGeometries(geo, false)!,
            new THREE.MeshBasicMaterial({ map, color: 0xe8e8e8 }),
          ),
        );
      screen(front, boardRDST);
      screen(backs, boardORBT);
      if (ticker) screen(strips, ticker);
      const sm = new THREE.Mesh(
        mergeGeometries(steel, false)!,
        new THREE.MeshStandardMaterial({
          color: 0x1b1e24,
          roughness: 0.6,
          metalness: 0.4,
        }),
      );
      sm.castShadow = true;
      group.add(sm);
    }
    group.userData.ledGantries = picks.length; // dev lookup
  }

  // ---- finish: a CLOCK IN bay painted in the kerb lane at the HQ entrance, with a bobbing arrow over it
  const fin = layout?.finish ?? { x: office.x, y: office.y, heading: 0 };
  {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 256;
    const g = c.getContext("2d")!;
    g.strokeStyle = "#ffd23f";
    g.fillStyle = "#ffd23f";
    g.lineWidth = 14;
    g.strokeRect(10, 10, 1004, 236);
    // canvas +x runs along the arrival (the driver comes in from x = 0), canvas +y across the lane left -> right.
    // Road-marking style: stretched letters read by the approaching driver, then chevrons pointing on.
    g.font = "900 64px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const [word, x] of [
      ["CLOCK", 250],
      ["IN", 470],
    ] as const) {
      g.save();
      g.translate(x, 128);
      g.rotate(Math.PI / 2);
      g.scale(1, 2.4);
      g.fillText(word, 0, 0);
      g.restore();
    }
    for (let k = 0; k < 3; k++) {
      const x = 640 + k * 110;
      g.beginPath();
      g.moveTo(x, 50);
      g.lineTo(x + 70, 128);
      g.lineTo(x, 206);
      g.lineTo(x + 34, 206);
      g.lineTo(x + 104, 128);
      g.lineTo(x + 34, 50);
      g.closePath();
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const bay = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 4).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    );
    bay.rotation.y = fin.heading; // the canvas's +x runs along the arrival direction
    bay.position.set(fin.x, 0.05, -fin.y);
    bay.renderOrder = 3;
    group.add(bay);
  }
  const beacon = new THREE.Mesh(
    new THREE.ConeGeometry(2, 4, 4).rotateX(Math.PI), // tip down
    new THREE.MeshBasicMaterial({
      color: 0xffd23f,
      transparent: true,
      opacity: 0.9,
    }),
  );
  beacon.position.set(fin.x, 7, -fin.y);
  group.add(beacon);

  return {
    group,
    water,
    cones,
    coneIndex,
    beacon,
    heroes: heroPlacements,
    landmarks: landmarks.map(({ id, x, y, rot }) => ({ id, x, y, rot })),
    get debugStreams() {
      return streamed.map((s) => ({
        placements: s.placements,
        count: s.meshes[0]?.count ?? 0,
      }));
    },
    dispose() {
      disposeView(group, assets);
    },
    setWet(k) {
      asphalt.roughness = 0.95 - 0.7 * k;
      asphalt.envMapIntensity = 1 + 2 * k;
      asphalt.color.setScalar(1 - 0.4 * k).multiply(ASPHALT_TINT);
    },
    update(t, camX = 0, camY = 0) {
      streamBuildings(camX, camY, t);
      if (ticker) ticker.offset.x = (t * 0.035) % 1;
      // pedestrian cut-outs turn to face the player (cheap: only when the player moved a little)
      if (Math.abs(camX - pedCamX) + Math.abs(camY - pedCamY) > 0.5) {
        pedCamX = camX;
        pedCamY = camY;
        const pm = new THREE.Matrix4(),
          pq = new THREE.Quaternion(),
          pp = new THREE.Vector3(),
          ps = new THREE.Vector3(1, 1, 1),
          up = new THREE.Vector3(0, 1, 0);
        for (const { mesh, spots } of peds) {
          spots.forEach((s, i) => {
            pq.setFromAxisAngle(up, Math.atan2(camX - s.x, -camY + s.y));
            pm.compose(pp.set(s.x, s.z, -s.y), pq, ps);
            mesh.setMatrixAt(i, pm);
          });
          mesh.instanceMatrix.needsUpdate = true;
        }
      }
      water.uniforms.uTime.value = t;
      beacon.rotation.y = t * 1.5;
      beacon.position.y = 7 + 0.7 * Math.sin(t * 3);
    },
  };
}

/** geometries / materials / textures owned by the loaded assets: reused by every city view, never disposed */
const sharedCache = new WeakMap<Assets, WeakSet<object>>();
function sharedResources(assets: Assets): WeakSet<object> {
  let s = sharedCache.get(assets);
  if (s) return s;
  s = new WeakSet();
  const add = (b: {
    geometry: THREE.BufferGeometry;
    material: THREE.Material;
  }) => {
    s!.add(b.geometry);
    s!.add(b.material);
  };
  for (const m of assets.models.values()) {
    m.parts.forEach(add);
    m.bodyParts?.forEach(add);
    m.wheels?.forEach((w) => w.parts.forEach(add));
  }
  for (const b of assets.baked.values()) add(b);
  for (const g of assets.scenes.values())
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      s!.add(mesh.geometry);
      for (const mt of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material])
        s!.add(mt);
    });
  for (const t of assets.tex.values()) s.add(t);
  if (assets.sky) s.add(assets.sky);
  if (assets.skyBg) s.add(assets.skyBg);
  s.add(blobShadowTexture()); // page-wide cache, also under the player's car
  sharedCache.set(assets, s);
  return s;
}

function disposeView(group: THREE.Group, assets: Assets): void {
  const shared = sharedResources(assets);
  const geos = new Set<THREE.BufferGeometry>(),
    mats = new Set<THREE.Material>(),
    texs = new Set<THREE.Texture>();
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.geometry) return;
    if ((o as THREE.InstancedMesh).isInstancedMesh)
      (o as THREE.InstancedMesh).dispose();
    if (!shared.has(mesh.geometry)) geos.add(mesh.geometry);
    const ms = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mt of ms) if (mt && !shared.has(mt)) mats.add(mt);
  });
  for (const mt of mats) {
    for (const v of Object.values(mt))
      if (v instanceof THREE.Texture && !shared.has(v)) texs.add(v);
    const u = (mt as THREE.ShaderMaterial).uniforms;
    if (u)
      for (const { value } of Object.values(u))
        if (value instanceof THREE.Texture && !shared.has(value))
          texs.add(value);
  }
  geos.forEach((g) => g.dispose());
  mats.forEach((m) => m.dispose());
  texs.forEach((t) => t.dispose());
  group.clear();
}

function laneLines(city: City): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const Y = 0.02;
  for (const e of city.edges) {
    const a = city.nodes[e.a];
    const s0 = C.ROAD_HALF,
      s1 = e.len - C.ROAD_HALF;
    const along = (s: number) =>
      e.axis === "x" ? { x: a.x + s, y: a.y } : { x: a.x, y: a.y + s };
    const seg = (
      sA: number,
      sB: number,
      off: number,
      w: number,
      color: number,
    ) => {
      const p = along((sA + sB) / 2),
        L = sB - sA;
      // flat quads (2 tris) rather than boxes: ~200 marks per edge add up to half a million triangles otherwise
      parts.push(
        colored(
          e.axis === "x"
            ? quad(
                p.x - L / 2,
                p.y + off - w / 2,
                p.x + L / 2,
                p.y + off + w / 2,
                Y,
                1,
              )
            : quad(
                p.x + off - w / 2,
                p.y - L / 2,
                p.x + off + w / 2,
                p.y + L / 2,
                Y,
                1,
              ),
          color,
        ),
      );
    };
    {
      const p = along((s0 + s1) / 2),
        L = s1 - s0,
        w = C.MEDIAN_HALF * 2 - 0.2;
      parts.push(
        colored(
          e.axis === "x"
            ? box(L, 0.3, w, p.x, 0.15, -p.y)
            : box(w, 0.3, L, p.x, 0.15, -p.y),
          0x9a9da6,
        ),
      );
    }
    seg(s0, s1, C.MEDIAN_HALF + 0.25, 0.15, 0xe6c13a);
    seg(s0, s1, -(C.MEDIAN_HALF + 0.25), 0.15, 0xe6c13a);
    seg(s0, s1, C.ROADWAY_HALF - 0.2, 0.15, 0xdcdcdc);
    seg(s0, s1, -C.ROADWAY_HALF + 0.2, 0.15, 0xdcdcdc);
    for (let s = s0 + 2; s < s1 - 4; s += 12)
      for (let k = 1; k < C.LANES_PER_DIR; k++) {
        const off = C.MEDIAN_HALF + k * C.LANE_W;
        seg(s, s + 4, off, 0.15, 0xdcdcdc);
        seg(s, s + 4, -off, 0.15, 0xdcdcdc);
      }
    for (const end of [0, 1]) {
      if (e.crossing) break; // no zebra/stop paint at bridge and tunnel mouths
      const s = end === 0 ? s0 : s1;
      const n = Math.floor((C.ROADWAY_HALF - 0.5) / 1.1);
      for (let k = -n; k <= n; k++) {
        if (k === 0) continue;
        const sA = end === 0 ? s + 0.5 : s - 4.5;
        seg(sA, sA + 4, k * 1.1, 0.65, 0xcfd3dc);
      }
      // stop line on the approaching carriageway. Right-hand traffic: travelling +s the right side is
      // -y on x-edges and +x on y-edges (see edgePose); end 1 is approached by +s traffic.
      const sideSign = (end === 1 ? 1 : -1) * (e.axis === "x" ? -1 : 1);
      const sl = end === 0 ? s + 5.2 : s - 5.6;
      seg(
        sl,
        sl + 0.4,
        sideSign * (C.MEDIAN_HALF + (C.ROADWAY_HALF - C.MEDIAN_HALF) / 2),
        C.ROADWAY_HALF - C.MEDIAN_HALF - 0.4,
        0xe4e4e4,
      );
      // straight-ahead lane arrows ~10 m before the stop line (large readable road paint)
      for (let k = 0; k < C.LANES_PER_DIR; k++) {
        const off = sideSign * (C.MEDIAN_HALF + C.LANE_W * (k + 0.5));
        const dir = end === 0 ? -1 : 1; // direction of travel along s
        const base = end === 0 ? sl + 9.5 : sl - 9.5; // arrow tip end sits here
        seg(
          Math.min(base - dir * 1.8, base - dir * 4.6),
          Math.max(base - dir * 1.8, base - dir * 4.6),
          off,
          0.3,
          0xe4e4e4,
        ); // shaft 2.8 m
        for (let t = 0; t < 6; t++) {
          const w = 1.1 - t * 0.17; // head: 1.8 m long, 1.1 m base tapering to the tip
          const sA = base - dir * (1.8 - t * 0.3),
            sB = sA + dir * 0.3;
          seg(Math.min(sA, sB), Math.max(sA, sB), off, w, 0xe4e4e4);
        }
      }
    }
  }
  return new THREE.Mesh(
    mergeGeometries(parts, false)!,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7,
      color: 0xdddddd,
    }),
  );
}

/** True where a street-side pole must not stand: inside the tunnel box or over the river (bridge decks excluded). */
function inBoxAny(city: City, x: number, y: number): boolean {
  const t = city.tunnel;
  if (x >= t.x0 - 2 && x <= t.x1 + 2 && y >= t.y0 - 2 && y <= t.y1 + 2)
    return true;
  const r = city.river;
  if (x < r.x0 - 6 || x > r.x1 + 6 || y < r.y0 || y > r.y1) return false;
  for (const g of city.riverGaps)
    if (x >= g.x0 && x <= g.x1 && y >= g.y0 && y <= g.y1) return false;
  return true;
}
