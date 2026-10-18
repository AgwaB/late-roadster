// Procedural grid city split by a river. Axis-aligned everything: roads, blocks, buildings, props.
// World is 2D (x, y) with y = north; the renderer maps (x, y) -> (x, 0, -y).
import * as C from "./constants";
import { mulberry32 } from "./rng";
import { dijkstra, shortestPath } from "./graph";
import { buildSigns, type CitySigns } from "./signs";
import { buildSkyLane, type SkyCar } from "./skylane";
import { VEHICLE_DIMS } from "./dims";
import { PLAZA, tollCanopy, tollQueue, tollSolids } from "./toll";
import {
  PLINTH,
  ROW,
  ROW_OFFSETS,
  ROW_S,
  rampSolids,
  venueSolids,
  type Solid,
  type WallRamp,
} from "./venue";

export interface AABB {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export const inBox = (b: AABB, x: number, y: number) =>
  x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
export const expand = (b: AABB, m: number): AABB => ({
  x0: b.x0 - m,
  y0: b.y0 - m,
  x1: b.x1 + m,
  y1: b.y1 + m,
});

export interface Building {
  box: AABB;
  kind: string;
  cx: number;
  cy: number;
  scale: number;
  rotY: number;
  height: number;
}
export type PropKind =
  | "cone"
  | "barrier"
  | "jamcar"
  | "parked"
  | "dumpster"
  | "toll"
  | "wall"
  | "container"
  | "stagecar";
export interface Prop {
  id: number;
  kind: PropKind;
  box: AABB;
  h: number;
  heading: number;
  hit: boolean;
  stomped: boolean;
  color?: number;
  /** parked: index into PARKED_KINDS; stagecar: index into ROW (src/game/venue.ts) */
  variant?: number;
  /** base height when it does not stand on the road (the jam up on the skyway deck); h is then above it */
  z0?: number;
}
export interface Ramp {
  box: AABB;
  axis: "x" | "y";
  dir: 1 | -1;
  height: number;
}
export interface Node {
  id: number;
  i: number;
  j: number;
  x: number;
  y: number;
  edges: number[];
}
export interface Edge {
  id: number;
  a: number;
  b: number;
  axis: "x" | "y";
  len: number;
  crossing: boolean;
  noNpc: { s0: number; s1: number; dir: 1 | -1 }[];
  /** lowest lane traffic may use here (the skyway's end ramps take the inner lane of both directions) */
  laneMin?: number;
}
export interface Commute {
  home: Node;
  office: Node;
  dist: number;
  homeHeading: number;
}
export interface Zone extends AABB {
  kind: "construction" | "jam";
}

/**
 * Elevated deck along one row: level at SKY_H on piers in the median, and at each end a solid ramp (one lane each
 * way, over the inner lanes) down to the road, widening into the full deck over the taper.
 */
export interface Skyway {
  x0: number;
  x1: number;
  y: number;
  /** half width of the full deck, incl. parapets */
  half: number;
  h: number;
  /** length of each end ramp: x0 .. x0 + ramp climbs from the road to the deck, x1 - ramp .. x1 drops back */
  ramp: number;
  /** half width of the ramps, incl. parapets */
  rampHalf: number;
  /** length over which the deck widens from the ramp to its full width */
  taper: number;
  piers: AABB[];
}

/** Water-filled pothole in one lane of a road (NPCs hop over it on their jets, the player thuds through it). */
export interface Pothole {
  x: number;
  y: number;
  r: number;
  edge: number;
  dir: 1 | -1;
  lane: number;
  s: number;
}

/**
 * The launch-event venue on the open event ground beside the commute corridor, as on the reveal night
 * (src/game/venue.ts): the kickflip run-in from the road side to a row of vehicles parked side by side across it, and
 * the hook ramp further back. The run-in starts at (ox, oy) along the unit direction (ux, uy); see stageAt.
 */
export interface Stage {
  ox: number;
  oy: number;
  ux: number;
  uy: number;
  /** the vehicle row's distance along the run-in */
  rowS: number;
  ramp: WallRamp;
  /** the dark arena floor (the whole event ground) */
  floor: AABB;
}

/** A roof you can land on and drive across (the toll canopy): ground at h for anything already up there. */
export interface Deck {
  box: AABB;
  h: number;
}

/** A point on the stage strip: s metres along the run, lat metres to the left of its centre line. */
export function stageAt(
  st: Stage,
  s: number,
  lat = 0,
): { x: number; y: number } {
  return {
    x: st.ox + st.ux * s - st.uy * lat,
    y: st.oy + st.uy * s + st.ux * lat,
  };
}

/** The FLYERS TOLL $0 gate across the commute corridor: position, its road edge and distance from that edge's node a. */
export interface Toll {
  x: number;
  y: number;
  edge: number;
  sA: number;
}

export interface City {
  skyway: Skyway;
  potholes: Pothole[];
  signs: CitySigns;
  stage: Stage | null;
  toll: Toll | null;
  /** covered spots with a drivable ceiling besides the river tunnel (none at the moment) */
  canopies: AABB[];
  /** height-aware static solids: the toll plaza and the event ramp */
  solids: Solid[];
  decks: Deck[];
  /** the flying-roadster stream over the corridor */
  sky: SkyCar[];
  seed: number;
  nodes: Node[];
  edges: Edge[];
  nodeIndex: Map<string, number>;
  buildings: Building[];
  props: Prop[];
  ramps: Ramp[];
  tunnel: AABB; // covered roadway
  river: AABB;
  riverGaps: AABB[]; // bridge / tunnel decks (not water)
  plazas: AABB[];
  zones: Zone[];
  commutes: Commute[];
  treeSpots: { x: number; y: number }[];
}

const BUILDINGS: { kind: string; w: number; d: number; h: number }[] = [
  { kind: "building-a", w: 0.88, d: 0.94, h: 1.29 },
  { kind: "building-b", w: 0.88, d: 0.94, h: 1.1 },
  { kind: "building-c", w: 0.88, d: 0.94, h: 1.5 },
  { kind: "building-d", w: 0.88, d: 0.94, h: 1.3 },
  { kind: "building-e", w: 0.88, d: 0.94, h: 1.7 },
  { kind: "building-f", w: 0.88, d: 0.94, h: 1.4 },
  { kind: "building-g", w: 0.88, d: 0.94, h: 1.2 },
  { kind: "building-h", w: 0.88, d: 0.94, h: 1.6 },
  { kind: "building-i", w: 0.88, d: 0.94, h: 1.3 },
  { kind: "building-j", w: 0.88, d: 0.94, h: 1.5 },
  { kind: "building-k", w: 0.88, d: 0.94, h: 1.2 },
  { kind: "building-l", w: 0.88, d: 0.94, h: 1.8 },
  { kind: "building-m", w: 0.88, d: 0.94, h: 1.4 },
  { kind: "building-n", w: 0.88, d: 0.94, h: 1.1 },
  { kind: "building-skyscraper-a", w: 1.36, d: 1.36, h: 2.88 },
  { kind: "building-skyscraper-b", w: 1.36, d: 1.36, h: 2.6 },
  { kind: "building-skyscraper-c", w: 1.36, d: 1.36, h: 3.1 },
  { kind: "building-skyscraper-d", w: 1.36, d: 1.36, h: 2.4 },
  { kind: "building-skyscraper-e", w: 1.36, d: 1.36, h: 3.3 },
];

export function buildCity(seed = 1): City {
  const rnd = mulberry32(seed >>> 0);
  const nodes: Node[] = [];
  const nodeIndex = new Map<string, number>();
  for (let i = -C.K; i <= C.K; i++) {
    if (i === 0) continue;
    for (let j = -C.K; j <= C.K; j++) {
      nodeIndex.set(i + "," + j, nodes.length);
      nodes.push({ id: nodes.length, i, j, x: i * C.P, y: j * C.P, edges: [] });
    }
  }
  const edges: Edge[] = [];
  const link = (a: Node, b: Node, axis: "x" | "y", crossing: boolean) => {
    const e: Edge = {
      id: edges.length,
      a: a.id,
      b: b.id,
      axis,
      len: Math.hypot(b.x - a.x, b.y - a.y),
      crossing,
      noNpc: [],
    };
    edges.push(e);
    a.edges.push(e.id);
    b.edges.push(e.id);
  };
  for (const n of nodes) {
    const up = nodeIndex.get(n.i + "," + (n.j + 1));
    if (up !== undefined) link(n, nodes[up], "y", false);
    const ri = n.i === -1 ? 1 : n.i + 1;
    const right = nodeIndex.get(ri + "," + n.j);
    if (right !== undefined) {
      if (n.i === -1) {
        if (C.CROSSINGS.includes(n.j)) link(n, nodes[right], "x", true);
      } else link(n, nodes[right], "x", false);
    }
  }

  // the skyway's end ramps stand in the inner lane of both directions: traffic keeps to lane 1 and out on those roads
  const skyway = buildSkyway();
  for (const e of edges) {
    const a = nodes[e.a],
      b = nodes[e.b];
    if (e.axis !== "x" || a.y !== skyway.y) continue;
    const lo = Math.min(a.x, b.x),
      hi = Math.max(a.x, b.x);
    const over = (u0: number, u1: number) => lo < u1 && hi > u0;
    if (
      over(skyway.x0, skyway.x0 + skyway.ramp) ||
      over(skyway.x1 - skyway.ramp, skyway.x1)
    )
      e.laneMin = 1;
  }

  const river: AABB = {
    x0: -C.RIVER_HALF,
    y0: -C.CITY_HALF - 200,
    x1: C.RIVER_HALF,
    y1: C.CITY_HALF + 200,
  };
  const riverGaps: AABB[] = C.CROSSINGS.map((k) => ({
    x0: -C.P,
    y0: k * C.P - C.ROAD_HALF,
    x1: C.P,
    y1: k * C.P + C.ROAD_HALF,
  }));
  const tunnel: AABB = {
    x0: -C.TUNNEL_HALF_X,
    y0: C.TUNNEL_ROW * C.P - C.ROADWAY_HALF,
    x1: C.TUNNEL_HALF_X,
    y1: C.TUNNEL_ROW * C.P + C.ROADWAY_HALF,
  };

  // ---- blocks & buildings
  const buildings: Building[] = [];
  const plazas: AABB[] = [];
  const props: Prop[] = [];
  const treeSpots: { x: number; y: number }[] = [];
  let pid = 1;
  const addProp = (
    kind: PropKind,
    box: AABB,
    h: number,
    heading = 0,
    color?: number,
  ) =>
    props.push({
      id: pid++,
      kind,
      box,
      h,
      heading,
      hit: false,
      stomped: false,
      color,
    });
  const LOW = BUILDINGS.filter((b) => !b.kind.includes("skyscraper"));
  const TALL = BUILDINGS.filter((b) => b.kind.includes("skyscraper"));
  const push = (
    b: (typeof BUILDINGS)[number],
    cx: number,
    cy: number,
    scale: number,
    rotY: number,
  ) => {
    const swap = Math.abs(Math.round(rotY / (Math.PI / 2))) % 2 === 1;
    const fw = (swap ? b.d : b.w) * scale,
      fd = (swap ? b.w : b.d) * scale;
    buildings.push({
      box: {
        x0: cx - fw / 2,
        y0: cy - fd / 2,
        x1: cx + fw / 2,
        y1: cy + fd / 2,
      },
      kind: b.kind,
      cx,
      cy,
      scale,
      rotY,
      height: b.h * scale,
    });
  };
  /** Fill a lot: either one tower, or a ring of natural-scale low-rises along the lot edges (open courtyard inside). */
  const placeBuilding = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    tallBias: number,
  ) => {
    const w = x1 - x0,
      d = y1 - y0;
    if (rnd() < tallBias) {
      const b = TALL[Math.floor(rnd() * TALL.length)];
      const scale =
        Math.min((w - 4) / b.w, (d - 4) / b.d, 34) * (0.8 + rnd() * 0.2);
      push(
        b,
        (x0 + x1) / 2,
        (y0 + y1) / 2,
        scale,
        Math.floor(rnd() * 4) * (Math.PI / 2),
      );
      return;
    }
    const S = 11 + rnd() * 2.5; // one Kenney floor ~ 3.5 m
    const depth = 0.94 * S;
    const row = (len: number, place: (t: number, slotW: number) => void) => {
      const n = Math.max(1, Math.round(len / (0.88 * S)));
      const slotW = len / n;
      for (let k = 0; k < n; k++) place(k * slotW + slotW / 2, slotW);
    };
    const pick = () => LOW[Math.floor(rnd() * LOW.length)];
    // south & north rows (full width), facing the street
    row(w, (tx, slotW) => {
      const b = pick();
      const s = Math.min(S, slotW / b.w);
      push(b, x0 + tx, y0 + (b.d * s) / 2, s, 0);
    });
    row(w, (tx, slotW) => {
      const b = pick();
      const s = Math.min(S, slotW / b.w);
      push(b, x0 + tx, y1 - (b.d * s) / 2, s, Math.PI);
    });
    // west & east rows between the corners
    const inner = d - 2 * depth;
    if (inner > 8) {
      row(inner, (ty, slotW) => {
        const b = pick();
        const s = Math.min(S, slotW / b.w);
        push(b, x0 + (b.d * s) / 2, y0 + depth + ty, s, -Math.PI / 2);
      });
      row(inner, (ty, slotW) => {
        const b = pick();
        const s = Math.min(S, slotW / b.w);
        push(b, x1 - (b.d * s) / 2, y0 + depth + ty, s, Math.PI / 2);
      });
    }
  };
  for (let i = -C.K; i < C.K; i++) {
    for (let j = -C.K; j < C.K; j++) {
      const x0 = i * C.P + C.ROAD_HALF,
        x1 = (i + 1) * C.P - C.ROAD_HALF;
      const y0 = j * C.P + C.ROAD_HALF,
        y1 = (j + 1) * C.P - C.ROAD_HALF;
      // the commute corridor (every route runs along y = 0 from x = -600 to 600, src/game/city.ts routeCost):
      // the open event ground for the launch stage west of the tunnel, and the ORBIT MART plaza east of it, both on
      // the south side (the right-hand side of eastbound traffic)
      if (j === -1 && (i === C.EVENT_BLOCK_I || i === C.MART_BLOCK_I)) {
        rnd(); // keep the block-type draw so the rest of the city is unchanged
        if (i === C.EVENT_BLOCK_I) {
          plazas.push({ x0, y0, x1, y1 });
          for (let t = 0; t < 6; t++)
            treeSpots.push({
              x: x0 + 8 + rnd() * (x1 - x0 - 16),
              y: y0 + 8 + rnd() * (y1 - y0 - 60),
            });
          continue;
        }
        // ORBIT MART plaza: corner buildings at the back only, so the store front shows from far down the corridor
        const s = 40;
        placeBuilding(x0, y0, x0 + s, y0 + s, 0);
        placeBuilding(x1 - s, y0, x1, y0 + s, 0);
        plazas.push({ x0, y0, x1, y1 });
        continue;
      }
      if (i === -1 || i === 0) {
        // riverfront park strip
        for (let t = 0; t < 5; t++)
          treeSpots.push({
            x:
              i === -1
                ? -C.RIVER_HALF - 12 - rnd() * 35
                : C.RIVER_HALF + 12 + rnd() * 35,
            y: y0 + 10 + rnd() * (y1 - y0 - 20),
          });
        if (rnd() < 0.5)
          addProp(
            "container",
            {
              x0:
                (i === -1 ? -(C.P - C.ROAD_HALF) + 8 : C.RIVER_HALF + 15) +
                rnd() * 10,
              y0: y0 + 20 + rnd() * 50,
              x1: 0,
              y1: 0,
            },
            2.6,
            0,
            [0xd9534f, 0x3b7dd8, 0x5cb85c, 0xf0ad4e][Math.floor(rnd() * 4)],
          );
        continue;
      }
      const tallBias =
        Math.max(0.05, 0.35 - (Math.abs(i + 0.5) + Math.abs(j + 0.5)) / 14) +
        (i >= 3 ? 0.15 : 0);
      const r = rnd();
      if (r < 0.5) {
        // 2x2 with cross alley (8 m), alley slightly off-center
        const ax = (x0 + x1) / 2 + (rnd() - 0.5) * 24,
          ay = (y0 + y1) / 2 + (rnd() - 0.5) * 24;
        placeBuilding(x0, y0, ax - 4, ay - 4, tallBias);
        placeBuilding(ax + 4, y0, x1, ay - 4, tallBias);
        placeBuilding(x0, ay + 4, ax - 4, y1, tallBias);
        placeBuilding(ax + 4, ay + 4, x1, y1, tallBias);
        if (rnd() < 0.35)
          addProp(
            "dumpster",
            { x0: ax - 3.6, y0: ay + 15 + rnd() * 20, x1: ax - 1.2, y1: 0 },
            1.5,
            Math.PI / 2,
          );
      } else if (r < 0.75) {
        // 1x2 split with one alley
        if (rnd() < 0.5) {
          const ax = (x0 + x1) / 2 + (rnd() - 0.5) * 20;
          placeBuilding(x0, y0, ax - 4, y1, tallBias);
          placeBuilding(ax + 4, y0, x1, y1, tallBias);
        } else {
          const ay = (y0 + y1) / 2 + (rnd() - 0.5) * 20;
          placeBuilding(x0, y0, x1, ay - 4, tallBias);
          placeBuilding(x0, ay + 4, x1, y1, tallBias);
        }
      } else {
        // plaza: four corner buildings, open paved middle
        const s = 40;
        placeBuilding(x0, y0, x0 + s, y0 + s, 0);
        placeBuilding(x1 - s, y0, x1, y0 + s, 0);
        placeBuilding(x0, y1 - s, x0 + s, y1, 0);
        placeBuilding(x1 - s, y1 - s, x1, y1, 0);
        plazas.push({ x0, y0, x1, y1 });
        for (let t = 0; t < 4; t++)
          treeSpots.push({
            x: x0 + s + 6 + rnd() * (x1 - x0 - 2 * s - 12),
            y: y0 + s + 6 + rnd() * (y1 - y0 - 2 * s - 12),
          });
      }
    }
  }
  // fix container/dumpster boxes (x1,y1 were placeholders)
  for (const p of props) {
    if (p.kind === "container") {
      p.box.x1 = p.box.x0 + 12;
      p.box.y1 = p.box.y0 + 2.5;
    }
    if (p.kind === "dumpster") {
      p.box.x1 = p.box.x0 + 2.4;
      p.box.y1 = p.box.y0 + 1.6;
    }
  }

  // ---- tunnel walls, bridge railings, boundary walls
  for (const sgn of [-1, 1]) {
    addProp(
      "wall",
      {
        x0: tunnel.x0,
        y0: sgn > 0 ? tunnel.y1 : tunnel.y0 - 1,
        x1: tunnel.x1,
        y1: sgn > 0 ? tunnel.y1 + 1 : tunnel.y0,
      },
      C.CEIL_H + 1.5,
    );
    for (const k of C.CROSSINGS)
      if (k !== C.TUNNEL_ROW) {
        const yc = k * C.P;
        addProp(
          "wall",
          {
            x0: -C.RIVER_HALF - 10,
            y0: sgn > 0 ? yc + C.ROADWAY_HALF + 0.6 : yc - C.ROADWAY_HALF - 1.2,
            x1: C.RIVER_HALF + 10,
            y1: sgn > 0 ? yc + C.ROADWAY_HALF + 1.2 : yc - C.ROADWAY_HALF - 0.6,
          },
          1.1,
        );
      }
  }
  const B = C.CITY_HALF + C.ROAD_HALF;
  addProp("wall", { x0: -B - 2, y0: -B - 2, x1: B + 2, y1: -B }, 2);
  addProp("wall", { x0: -B - 2, y0: B, x1: B + 2, y1: B + 2 }, 2);
  addProp("wall", { x0: -B - 2, y0: -B, x1: -B, y1: B }, 2);
  addProp("wall", { x0: B, y0: -B, x1: B + 2, y1: B }, 2);
  // river banks: no wall (you can fall in), but the dead-end roads get a barrier
  for (let j = -C.K; j <= C.K; j++) {
    if (C.CROSSINGS.includes(j)) continue;
    const yc = j * C.P;
    addProp(
      "barrier",
      {
        x0: -C.P + C.ROAD_HALF,
        y0: yc - C.ROADWAY_HALF,
        x1: -C.P + C.ROAD_HALF + 0.8,
        y1: yc + C.ROADWAY_HALF,
      },
      1.2,
      Math.PI / 2,
    );
    addProp(
      "barrier",
      {
        x0: C.P - C.ROAD_HALF - 0.8,
        y0: yc - C.ROADWAY_HALF,
        x1: C.P - C.ROAD_HALF,
        y1: yc + C.ROADWAY_HALF,
      },
      1.2,
      Math.PI / 2,
    );
  }

  // ---- hazards: construction (3 segments), tunnel jam, toll gate
  const ramps: Ramp[] = [];
  const zones: Zone[] = [];
  const candidates = edges.filter(
    (e) =>
      !e.crossing &&
      !e.laneMin &&
      Math.abs(nodes[e.a].i) <= 3 &&
      Math.abs(nodes[e.a].j) <= 3,
  );
  for (let n = 0; n < 3; n++) {
    const e = candidates.splice(Math.floor(rnd() * candidates.length), 1)[0];
    const a = nodes[e.a],
      b = nodes[e.b];
    // eastbound / northbound direction only
    const dir: 1 | -1 = 1;
    const s0 = 40;
    if (e.axis === "x") {
      const y = a.y,
        x = a.x + s0; // travelling +x: right side = -y
      const laneIn = y - C.laneOffset(1),
        laneOut = y - (C.laneOffset(2) + C.laneOffset(3)) / 2;
      for (let k = 0; k < 6; k++)
        addProp(
          "cone",
          {
            x0: x + k * 6 - 0.25,
            y0: laneOut - 0.25 - 0.6,
            x1: x + k * 6 + 0.25,
            y1: laneOut + 0.25 - 0.6,
          },
          0.7,
        );
      ramps.push({
        box: { x0: x + 6, y0: laneIn - 1.7, x1: x + 18, y1: laneIn + 1.7 },
        axis: "x",
        dir,
        height: 2.2,
      });
      addProp(
        "barrier",
        {
          x0: x + 36,
          y0: laneOut - C.LANE_W,
          x1: x + 36.8,
          y1: laneOut + C.LANE_W,
        },
        1.2,
        Math.PI / 2,
      );
      zones.push({
        kind: "construction",
        x0: x - 10,
        y0: y - C.ROADWAY_HALF,
        x1: x + 50,
        y1: y + C.ROADWAY_HALF,
      });
      e.noNpc.push({ s0: s0 - 60, s1: s0 + 50, dir });
    } else {
      const x = a.x,
        y = a.y + s0; // travelling +y: right side = +x
      const laneIn = x + C.laneOffset(1),
        laneOut = x + (C.laneOffset(2) + C.laneOffset(3)) / 2;
      for (let k = 0; k < 6; k++)
        addProp(
          "cone",
          {
            x0: laneOut - 0.25 + 0.6,
            y0: y + k * 6 - 0.25,
            x1: laneOut + 0.25 + 0.6,
            y1: y + k * 6 + 0.25,
          },
          0.7,
        );
      ramps.push({
        box: { x0: laneIn - 1.7, y0: y + 6, x1: laneIn + 1.7, y1: y + 18 },
        axis: "y",
        dir,
        height: 2.2,
      });
      addProp(
        "barrier",
        {
          x0: laneOut - C.LANE_W,
          y0: y + 36,
          x1: laneOut + C.LANE_W,
          y1: y + 36.8,
        },
        1.2,
        0,
      );
      zones.push({
        kind: "construction",
        x0: x - C.ROADWAY_HALF,
        y0: y - 10,
        x1: x + C.ROADWAY_HALF,
        y1: y + 50,
      });
      e.noNpc.push({ s0: s0 - 60, s1: s0 + 50, dir });
    }
    void b;
  }
  // the skyway deck is jammed in the middle ("over the jam"): rows of standing cars 12 m apart across all four lanes,
  // each with one lane free, the free lane moving at most one lane from row to row, so there is always a slalom to
  // weave (or roofs to hop across: every roof bounces the car on). The session treats them like the tunnel jam (z0 up
  // on the deck)
  {
    const sw = skyway;
    const lanes = [-5.5, -2.05, 2.05, 5.5];
    const FREE = [1, 1, 0, 1, 2, 3, 3, 2, 1, 1];
    let k = 0,
      row = 0;
    for (
      let x = sw.x0 + sw.ramp + sw.taper + 50;
      x < sw.x1 - sw.ramp - sw.taper - 40;
      x += 12, row++
    )
      lanes.forEach((ly, li) => {
        k++;
        if (li === FREE[row % FREE.length]) return; // this row's way through
        const variant = (k * 5 + li) % PARKED_KINDS.length;
        const d = VEHICLE_DIMS[PARKED_KINDS[variant]];
        const cx = x + (((k * 13) % 5) - 2) * 0.4;
        props.push({
          id: pid++,
          kind: "jamcar",
          box: {
            x0: cx - d.halfL,
            y0: sw.y + ly - d.halfW,
            x1: cx + d.halfL,
            y1: sw.y + ly + d.halfW,
          },
          h: d.h,
          z0: sw.h,
          heading: ly < 0 ? 0 : Math.PI,
          hit: false,
          stomped: false,
          variant,
        });
      });
  }
  // tunnel jam: eastbound lanes blocked for 60 m in the middle
  {
    const yc = C.TUNNEL_ROW * C.P;
    const jx0 = -30,
      jx1 = 40;
    for (let x = jx0; x < jx1; x += 9)
      for (const lane of [0, 1, 2, 3]) {
        const ly =
          yc - C.laneOffset(lane) + ((x * 7 + lane * 13) % 5) / 10 - 0.2;
        // a mix of kinds, each as big as its model
        const variant = (pid * 7) % PARKED_KINDS.length;
        const d = VEHICLE_DIMS[PARKED_KINDS[variant]];
        const cx = x + lane * 2;
        props.push({
          id: pid++,
          kind: "jamcar",
          box: {
            x0: cx - d.halfL,
            y0: ly - d.halfW,
            x1: cx + d.halfL,
            y1: ly + d.halfW,
          },
          h: d.h,
          heading: 0,
          hit: false,
          stomped: false,
          variant,
        });
      }
    zones.push({
      kind: "jam",
      x0: jx0 - 10,
      y0: yc - C.ROADWAY_HALF,
      x1: jx1 + 10,
      y1: yc,
    });
    const te = edges.find((e) => e.crossing && nodes[e.a].j === C.TUNNEL_ROW)!;
    te.noNpc.push({ s0: 0, s1: te.len, dir: 1 }); // eastbound tunnel: NPCs skip it (the jam is static)
  }
  // ---- parked cars in the outer lane of side streets (NPC traffic keeps to lanes 0-2)
  for (const e of edges) {
    if (e.crossing || e.noNpc.length) continue;
    const a = nodes[e.a];
    const arterial =
      (e.axis === "x" && C.CROSSINGS.includes(a.j)) ||
      (e.axis === "y" && (Math.abs(a.i) === 1 || Math.abs(a.i) === 4));
    if (arterial) continue;
    for (const dir of [1, -1] as const) {
      const off = C.laneOffset(3) + 0.35; // kerb-side lane, hugging the kerb
      for (
        let s = C.ROAD_HALF + 40;
        s < e.len - C.ROAD_HALF - 40;
        s += 7.5 + rnd() * 6
      ) {
        if (rnd() > 0.28) continue;
        const p = edgePoseRaw(e, a, nodes[e.b], dir, s, off);
        const variant = Math.floor(rnd() * PARKED_KINDS.length);
        const { halfL: hl, halfW: hw, h } = VEHICLE_DIMS[PARKED_KINDS[variant]];
        const box: AABB =
          e.axis === "x"
            ? { x0: p.x - hl, y0: p.y - hw, x1: p.x + hl, y1: p.y + hw }
            : { x0: p.x - hw, y0: p.y - hl, x1: p.x + hw, y1: p.y + hl };
        const prop = {
          id: pid++,
          kind: "parked" as PropKind,
          box,
          h,
          heading: p.heading,
          hit: false,
          stomped: false,
          variant,
        };
        props.push(prop);
      }
    }
  }
  // toll plaza across the commute corridor (src/game/toll.ts): booths, a canopy you can fly over (and land on), and
  // every lane jammed with drivers queueing to pay, both directions
  let toll: Toll | null = null;
  const solids: Solid[] = [];
  const decks: Deck[] = [];
  {
    const tx = C.TOLL_X;
    const e = edges.find(
      (q) =>
        q.axis === "x" &&
        nodes[q.a].j === 0 &&
        Math.min(nodes[q.a].x, nodes[q.b].x) < tx &&
        Math.max(nodes[q.a].x, nodes[q.b].x) > tx,
    );
    if (e) {
      const ax = nodes[e.a].x;
      toll = { x: tx, y: 0, edge: e.id, sA: Math.abs(tx - ax) };
      // one closed arm per direction, on its exit side of the booths
      for (const dir of [1, -1] as const) {
        const x = tx + dir * PLAZA.armOff;
        const y0 = dir > 0 ? -C.ROADWAY_HALF : C.MEDIAN_HALF,
          y1 = dir > 0 ? -C.MEDIAN_HALF : C.ROADWAY_HALF;
        addProp("toll", { x0: x - 0.4, y0, x1: x + 0.4, y1 }, 0.8, Math.PI / 2);
      }
      // the queue is spaced for car-sized bodies between the booth islands: no vans, pickups or wide SUVs in it
      const fits = PARKED_KINDS.flatMap((k, i) =>
        VEHICLE_DIMS[k].halfL <= C.CAR_HALF_L &&
        VEHICLE_DIMS[k].halfW <= C.CAR_HALF_W + 0.05
          ? [i]
          : [],
      );
      for (const q of tollQueue(toll)) {
        const variant =
          fits[(q.k * 3 + q.lane * 5 + (q.dir > 0 ? 0 : 1)) % fits.length];
        const d = VEHICLE_DIMS[PARKED_KINDS[variant]];
        props.push({
          id: pid++,
          kind: "jamcar",
          box: {
            x0: q.x - d.halfL,
            y0: q.y - d.halfW,
            x1: q.x + d.halfL,
            y1: q.y + d.halfW,
          },
          h: d.h,
          heading: q.dir > 0 ? 0 : Math.PI,
          hit: false,
          stomped: false,
          variant,
        });
      }
      // NPC traffic does not queue: ordinary cars "take a detour" past it, fellow roadsters fly over it
      const back =
        PLAZA.firstCar + (PLAZA.cars - 1) * PLAZA.carGap + C.CAR_HALF_L + 8;
      const sFrom = (x: number) => Math.abs(x - ax);
      for (const dir of [1, -1] as const) {
        const near = sFrom(tx + dir * (PLAZA.armOff + 2)),
          far = sFrom(tx - dir * back);
        const s0 = Math.min(near, far),
          s1 = Math.max(near, far);
        // noNpc s runs from the edge's start in the travel direction
        e.noNpc.push(
          dir > 0 ? { s0, s1, dir } : { s0: e.len - s1, s1: e.len - s0, dir },
        );
      }
      solids.push(...tollSolids(toll));
      decks.push({ box: tollCanopy(toll), h: PLAZA.top });
    }
  }

  // ---- launch-event venue on the open event ground right beside the eastbound corridor lanes (src/game/venue.ts):
  // the kickflip run-in along the road side, running east like the commute, with the vehicle row across it, and the
  // hook ramp further back, its curl in profile from the road
  let stage: Stage | null = null;
  {
    const pz = plazas.find(
      (p) =>
        p.x0 > C.EVENT_BLOCK_I * C.P &&
        p.x1 < (C.EVENT_BLOCK_I + 1) * C.P &&
        p.y1 < 0 &&
        p.y1 > -C.P,
    );
    if (pz) {
      const ramp: WallRamp = { x: pz.x1 - 37, y: pz.y1 - 75, ux: 1, uy: 0 };
      const st: Stage = {
        ox: pz.x0 + 3,
        oy: pz.y1 - 19,
        ux: 1,
        uy: 0,
        rowS: ROW_S,
        ramp,
        floor: { ...pz },
      };
      // side by side along the run-in, each broadside to it, nose to the road (the run is along +x: widths along x)
      ROW.forEach((v, i) => {
        const q = stageAt(st, ROW_S + ROW_OFFSETS[i]);
        props.push({
          id: pid++,
          kind: "stagecar",
          box: {
            x0: q.x - v.halfW,
            y0: q.y - v.halfL,
            x1: q.x + v.halfW,
            y1: q.y + v.halfL,
          },
          h: C.CURB_H + PLINTH.h + v.h, // roof height: plaza kerb level + plinth + vehicle
          heading: Math.PI / 2,
          hit: false,
          stomped: false,
          variant: i,
        });
      });
      solids.push(...rampSolids(ramp), ...venueSolids(pz, st.ox, st.oy));
      stage = st;
      // a dark arena: no trees on the event ground
      for (let i = treeSpots.length - 1; i >= 0; i--)
        if (inBox(pz, treeSpots[i].x, treeSpots[i].y)) treeSpots.splice(i, 1);
    }
  }

  // ---- commutes: west homes -> east offices with road distance in range
  const commutes: Commute[] = [];
  const homes = nodes.filter(
    (n) => (n.i === -4 || n.i === -3) && Math.abs(n.j) <= 4,
  );
  const offices = nodes.filter(
    (n) => (n.i === 3 || n.i === 4) && Math.abs(n.j) <= 4,
  );
  for (const h of homes) {
    const dist = dijkstra(nodes, edges, h.id);
    for (const o of offices) {
      const d = dist[o.id];
      if (d >= C.COMMUTE_MIN && d <= C.COMMUTE_MAX)
        commutes.push({ home: h, office: o, dist: d, homeHeading: 0 });
    }
  }

  const city: City = {
    stage,
    toll,
    canopies: [],
    solids,
    decks,
    sky: buildSkyLane(),
    potholes: [],
    signs: {
      direction: [],
      wrecks: [],
      led: [],
      tunnel: { id: "sign:tunnel", tx: 0, W: 48, H: 24, bottom: 14.8 },
      colliders: [],
    },
    seed,
    nodes,
    edges,
    nodeIndex,
    buildings,
    props,
    ramps,
    tunnel,
    river,
    riverGaps,
    plazas,
    zones,
    commutes,
    treeSpots,
    skyway,
  };
  solids.push(...skywaySolids(skyway));
  city.potholes = buildPotholes(city);
  city.signs = buildSigns(city);
  return city;
}

/**
 * Potholes on the busiest commute roads, in the lanes the commutes actually drive (the way the routes run along
 * each road): two per road, spread over lanes 0-2, none on the toll plaza's road.
 */
function buildPotholes(city: City): Pothole[] {
  const use = new Map<number, { n: number; fwd: number }>();
  for (const cm of city.commutes) {
    const p = shortestPath(city, cm.home.id, cm.office.id);
    for (let i = 1; i < p.length; i++) {
      const eid = p[i - 1].edges.find((id) => {
        const e = city.edges[id];
        return e.a === p[i].id || e.b === p[i].id;
      });
      if (eid === undefined) continue;
      const u = use.get(eid) ?? use.set(eid, { n: 0, fwd: 0 }).get(eid)!;
      u.n++;
      u.fwd += city.edges[eid].a === p[i - 1].id ? 1 : -1;
    }
  }
  const out: Pothole[] = [];
  [...use.keys()]
    // not on the bridges, under the toll queue, nor beside the skyway's ramps
    .filter(
      (id) =>
        !city.edges[id].crossing &&
        !city.edges[id].laneMin &&
        id !== city.toll?.edge,
    )
    .sort((a, b) => use.get(b)!.n - use.get(a)!.n)
    .slice(0, 14)
    .forEach((id, j) => {
      const e = city.edges[id],
        a = city.nodes[e.a],
        b = city.nodes[e.b];
      const dir: 1 | -1 = use.get(id)!.fwd >= 0 ? 1 : -1;
      for (const [k, f] of [
        [0, 0.34],
        [1, 0.64],
      ] as const) {
        const lane = 1 + ((j + k) % 2); // lanes 1-2: the hole never reaches the median
        const s = e.len * f;
        const p = edgePoseRaw(e, a, b, dir, s, C.laneOffset(lane));
        out.push({ x: p.x, y: p.y, r: 3.4, edge: id, dir, lane, s });
      }
    });
  return out;
}

/** Under a drivable ceiling: the river tunnel or the stage canopy. */
export function underRoof(city: City, x: number, y: number): boolean {
  return inBox(city.tunnel, x, y) || city.canopies.some((b) => inBox(b, x, y));
}

export { shortestPath } from "./graph";

/** Is (x, y) on a road band (roadway or sidewalk)? Returns the road axis/center or null. */
export function roadAt(
  x: number,
  y: number,
): { axis: "x" | "y"; center: number; lateral: number } | null {
  const kx = Math.round(x / C.P),
    ky = Math.round(y / C.P);
  const dx = Math.abs(x - kx * C.P),
    dy = Math.abs(y - ky * C.P);
  const onV =
    kx !== 0 &&
    Math.abs(kx) <= C.K &&
    dx <= C.ROAD_HALF &&
    Math.abs(y) <= C.CITY_HALF + C.ROAD_HALF;
  const onH =
    Math.abs(ky) <= C.K &&
    dy <= C.ROAD_HALF &&
    Math.abs(x) <= C.CITY_HALF + C.ROAD_HALF;
  if (onH && (!onV || dy <= dx)) {
    // horizontal roads stop at the river except on crossing rows
    if (Math.abs(x) < C.P - C.ROAD_HALF && !C.CROSSINGS.includes(ky))
      return onV
        ? { axis: "y", center: kx * C.P, lateral: x - kx * C.P }
        : null;
    return { axis: "x", center: ky * C.P, lateral: y - ky * C.P };
  }
  if (onV) return { axis: "y", center: kx * C.P, lateral: x - kx * C.P };
  return null;
}

export function inRiver(city: City, x: number, y: number): boolean {
  if (!inBox(city.river, x, y)) return false;
  for (const g of city.riverGaps) if (inBox(g, x, y)) return false;
  return true;
}

function buildSkyway(): Skyway {
  const piers: AABB[] = [];
  // a pier every 40 m in the median under the level deck (the ramps are solid), never inside a crossing intersection
  for (let x = C.SKY_X0 + 20; x <= C.SKY_X1 - 20; x += 40) {
    const node = Math.round(x / C.P) * C.P;
    if (Math.abs(x - node) < C.ROAD_HALF + 2) continue;
    if (x < C.SKY_X0 + C.SKY_RAMP + 2 || x > C.SKY_X1 - C.SKY_RAMP - 2)
      continue;
    piers.push({ x0: x - 0.8, y0: -0.8, x1: x + 0.8, y1: 0.8 });
  }
  return {
    x0: C.SKY_X0,
    x1: C.SKY_X1,
    y: 0,
    half: C.SKY_HALF,
    h: C.SKY_H,
    ramp: C.SKY_RAMP,
    rampHalf: C.SKY_RAMP_HALF,
    taper: C.SKY_TAPER,
    piers,
  };
}

/**
 * The skyway's cross-section at x: surface height, its gradient along x (signed: + climbs toward +x), half width
 * incl. parapets, and whether it stands on a solid ramp (else the deck slab on piers). Null off its length.
 * The ramps follow an S-curve (smoothstep), level at both ends, so nothing launches the car at the top or bottom.
 */
export function skywayAt(
  s: Skyway,
  x: number,
): { h: number; grade: number; half: number; ramp: boolean } | null {
  if (x < s.x0 || x > s.x1) return null;
  const west = x - s.x0 <= s.x1 - x;
  const d = west ? x - s.x0 : s.x1 - x;
  if (d < s.ramp) {
    const q = d / s.ramp;
    const g = (6 * s.h * q * (1 - q)) / s.ramp;
    return {
      h: s.h * q * q * (3 - 2 * q),
      grade: west ? g : -g,
      half: s.rampHalf,
      ramp: true,
    };
  }
  const k = Math.min(1, (d - s.ramp) / s.taper);
  return {
    h: s.h,
    grade: 0,
    half: s.rampHalf + (s.half - s.rampHalf) * k,
    ramp: false,
  };
}

/** Parapet thickness on the skyway and its ramps (their outer faces are the half widths), and height above the road. */
export const SKY_PARAPET = { t: 0.45, h: 1.0 } as const;

/**
 * Sideways push (in y) that takes a body of half width hw, spanning bottom..top in height, at (x, y) out of the
 * skyway's parapet walls (the outer face runs down to the road beside a ramp, the deck's fascia beside the deck), or
 * null when clear. A body on the deck / ramp is kept on it, one outside is kept off; over the top of a parapet
 * (a hop) it passes.
 */
export function skywayParapet(
  s: Skyway,
  x: number,
  y: number,
  hw: number,
  bottom: number,
  top: number,
): number | null {
  const k = skywayAt(s, x);
  if (!k) return null;
  const lo = k.ramp ? 0 : k.h - 1.4,
    hi = k.h + SKY_PARAPET.h;
  if (top <= lo || bottom >= hi) return null;
  const dy = y - s.y,
    a = Math.abs(dy),
    inner = k.half - SKY_PARAPET.t;
  if (a + hw <= inner || a - hw >= k.half) return null;
  const sg = dy < 0 ? -1 : 1;
  return a < k.half - SKY_PARAPET.t / 2
    ? sg * (inner - hw) - dy
    : sg * (k.half + hw) - dy;
}

/**
 * The ramps' solid bodies as steps (5 m long, from the road up to a metre under the surface, so a car on the ramp
 * never touches them): a car beside a ramp, or under the deck in the inner lane, runs into the concrete.
 */
function skywaySolids(s: Skyway): Solid[] {
  const out: Solid[] = [];
  const step = 5;
  for (const west of [true, false])
    for (let d = 0; d < s.ramp - 1e-6; d += step) {
      const d1 = Math.min(s.ramp, d + step);
      const x0 = west ? s.x0 + d : s.x1 - d1,
        x1 = west ? s.x0 + d1 : s.x1 - d;
      const top = skywayAt(s, west ? x0 : x1)!.h - 1;
      if (top < 0.2) continue;
      out.push({
        box: { x0, y0: s.y - s.rampHalf, x1, y1: s.y + s.rampHalf },
        bottom: 0,
        top,
        what: "parapet",
        key: "skyway",
      });
    }
  return out;
}

export function inTunnel(city: City, x: number, y: number): boolean {
  return inBox(city.tunnel, x, y);
}

export function groundAt(
  city: City,
  x: number,
  y: number,
  /** current height of whatever stands here: at deck level over the skyway the deck is the ground */
  h?: number,
): { h: number; slope: number; axis: "x" | "y"; dir: number } {
  if (h !== undefined) {
    // the skyway: its ramps from a metre under their surface up (solid underneath), the deck from 1.5 m under it
    const sw = city.skyway;
    const k = skywayAt(sw, x);
    if (k && Math.abs(y - sw.y) <= k.half && h >= k.h - (k.ramp ? 1 : 1.5))
      return {
        h: k.h,
        slope: Math.abs(k.grade),
        axis: "x",
        dir: k.grade < 0 ? -1 : 1,
      };
  }
  if (h !== undefined)
    for (const d of city.decks)
      if (h >= d.h - 1.5 && inBox(d.box, x, y))
        return { h: d.h, slope: 0, axis: "x", dir: 1 };
  for (const r of city.ramps) {
    if (!inBox(r.box, x, y)) continue;
    const len = r.axis === "x" ? r.box.x1 - r.box.x0 : r.box.y1 - r.box.y0;
    const t =
      r.axis === "x"
        ? r.dir > 0
          ? x - r.box.x0
          : r.box.x1 - x
        : r.dir > 0
          ? y - r.box.y0
          : r.box.y1 - y;
    const slope = r.height / len;
    return { h: slope * t, slope, axis: r.axis, dir: r.dir };
  }
  if (onRoadway(x, y) || inBox(city.river, x, y))
    return { h: 0, slope: 0, axis: "x", dir: 1 };
  return { h: C.CURB_H, slope: 0, axis: "x", dir: 1 }; // sidewalk, plaza, alley, grass
}

/** True if (x, y) is on asphalt (either road direction), not sidewalk. */
export function onRoadway(x: number, y: number): boolean {
  const kx = Math.round(x / C.P),
    ky = Math.round(y / C.P);
  const dx = Math.abs(x - kx * C.P),
    dy = Math.abs(y - ky * C.P);
  const lim = C.CITY_HALF + C.ROAD_HALF;
  const v =
    kx !== 0 &&
    Math.abs(kx) <= C.K &&
    dx <= C.ROADWAY_HALF &&
    Math.abs(y) <= lim;
  const hExists = Math.abs(x) >= C.P - C.ROAD_HALF || C.CROSSINGS.includes(ky);
  const h =
    Math.abs(ky) <= C.K &&
    dy <= C.ROADWAY_HALF &&
    hExists &&
    Math.abs(x) <= lim;
  return v || h;
}

/** The road straight on past this edge's end in the travel direction (the same row / column), or null at a T. */
export function straightOn(
  city: City,
  edge: Edge,
  dir: 1 | -1,
): { edge: Edge; dir: 1 | -1 } | null {
  const node = city.nodes[dir > 0 ? edge.b : edge.a];
  for (const id of node.edges) {
    const e = city.edges[id];
    if (e === edge || e.axis !== edge.axis) continue;
    return { edge: e, dir: e.a === node.id ? 1 : -1 };
  }
  return null;
}

/** Snap a pose to the nearest lane center on the nearest road, heading along the road. */
export function snapToLane(
  city: City,
  x: number,
  y: number,
  heading: number,
): { x: number; y: number; heading: number } {
  void city;
  let kx = Math.round(x / C.P);
  if (kx === 0) kx = x < 0 ? -1 : 1;
  kx = C.clamp(kx, -C.K, C.K);
  const ky = C.clamp(Math.round(y / C.P), -C.K, C.K);
  const dx = Math.abs(x - kx * C.P),
    dy = Math.abs(y - ky * C.P);
  const hExists = Math.abs(x) >= C.P - C.ROAD_HALF || C.CROSSINGS.includes(ky);
  if (hExists && dy <= dx) {
    const east = Math.cos(heading) >= 0;
    const yy = ky * C.P + (east ? -C.laneOffset(0) : C.laneOffset(0));
    return {
      x: C.clamp(x, -C.CITY_HALF, C.CITY_HALF),
      y: yy,
      heading: east ? 0 : Math.PI,
    };
  }
  const north = Math.sin(heading) >= 0;
  const xx = kx * C.P + (north ? C.laneOffset(0) : -C.laneOffset(0));
  return {
    x: xx,
    y: C.clamp(y, -C.CITY_HALF, C.CITY_HALF),
    heading: north ? Math.PI / 2 : -Math.PI / 2,
  };
}

/** Find the edge/direction/s for a position+heading on a road (for spawning events ahead of the player). */
/** Lane index 0 (inner) .. 3 (kerb) from a rightward offset off the centreline. */
function laneIndex(right: number): number {
  return Math.max(
    0,
    Math.min(3, Math.round((right - C.MEDIAN_HALF - C.LANE_W / 2) / C.LANE_W)),
  );
}

export function locateOnRoad(
  city: City,
  x: number,
  y: number,
  heading: number,
): { edge: Edge; dir: 1 | -1; s: number; lane: number } | null {
  const road = roadAt(x, y);
  if (!road) return null;
  if (road.axis === "x") {
    const j = Math.round(road.center / C.P);
    let i = Math.floor(x / C.P);
    if (i === 0) i = -1; // both halves of the crossing belong to the -1 -> 1 edge
    const aIdx = city.nodeIndex.get(i + "," + j);
    const bIdx = city.nodeIndex.get((i === -1 ? 1 : i + 1) + "," + j);
    if (aIdx === undefined || bIdx === undefined) return null;
    const edge = city.edges.find(
      (e) => (e.a === aIdx && e.b === bIdx) || (e.a === bIdx && e.b === aIdx),
    );
    if (!edge) return null;
    const dir: 1 | -1 = Math.cos(heading) >= 0 ? 1 : -1;
    const ax = city.nodes[edge.a].x;
    const s = dir > 0 ? x - ax : edge.len - (x - ax);
    const right = dir > 0 ? -road.lateral : road.lateral;
    return { edge, dir, s, lane: laneIndex(right) };
  }
  const i = Math.round(road.center / C.P);
  const j = Math.floor(y / C.P);
  const aIdx = city.nodeIndex.get(i + "," + j),
    bIdx = city.nodeIndex.get(i + "," + (j + 1));
  if (aIdx === undefined || bIdx === undefined) return null;
  const edge = city.edges.find(
    (e) => (e.a === aIdx && e.b === bIdx) || (e.a === bIdx && e.b === aIdx),
  );
  if (!edge) return null;
  const dir: 1 | -1 = Math.sin(heading) >= 0 ? 1 : -1;
  const ay = city.nodes[edge.a].y;
  const s = dir > 0 ? y - ay : edge.len - (y - ay);
  const right = dir > 0 ? road.lateral : -road.lateral;
  return { edge, dir, s, lane: laneIndex(right) };
}

/** World pose for a point on an edge in a lane, travelling in dir. */
export const PARKED_KINDS = [
  "sedan",
  "sedan2",
  "hatchback",
  "wagon",
  "suv",
  "van",
  "pickup",
  "taxi",
] as const;
/** Pose at distance s along an edge in direction dir, offset to the right by off (no City needed). */
function edgePoseRaw(
  edge: Edge,
  a: Node,
  b: Node,
  dir: 1 | -1,
  s: number,
  off: number,
): { x: number; y: number; heading: number } {
  const from = dir > 0 ? a : b,
    to = dir > 0 ? b : a;
  const ux = (to.x - from.x) / edge.len,
    uy = (to.y - from.y) / edge.len;
  return {
    x: from.x + ux * s + uy * off,
    y: from.y + uy * s - ux * off,
    heading: Math.atan2(uy, ux),
  };
}
export function edgePose(
  city: City,
  edge: Edge,
  dir: 1 | -1,
  s: number,
  lane: number,
): { x: number; y: number; heading: number } {
  const a = city.nodes[edge.a],
    b = city.nodes[edge.b];
  const from = dir > 0 ? a : b,
    to = dir > 0 ? b : a;
  const ux = (to.x - from.x) / edge.len,
    uy = (to.y - from.y) / edge.len;
  const off = C.laneOffset(lane);
  // right normal of (ux, uy) is (uy, -ux)
  return {
    x: from.x + ux * s + uy * off,
    y: from.y + uy * s - ux * off,
    heading: Math.atan2(uy, ux),
  };
}
