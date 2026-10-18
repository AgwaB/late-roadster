// Shared, deterministic overhead-sign placement. World (x,y) maps to render (x,0,-y).
// No renderer or asset dependency: computed once, after the city routes and skyway exist.
import type { AABB, City } from "./city";
import { shortestPath } from "./graph";
import * as C from "./constants";

export interface SignSpot {
  x: number;
  y: number;
  rot: number;
  id: string;
}
export interface DirectionSign extends SignSpot {
  eid: number;
  board: number;
}
export interface SignWreck extends DirectionSign {
  localX: number;
  height: number;
  roll: number;
  yaw: number;
  pitch: number;
}
export interface LedSign extends SignSpot {
  eid: number;
  dx: number;
  dy: number;
}
export interface SignCollider {
  structure: string;
  kind:
    | "post"
    | "arm"
    | "board"
    | "wreck"
    | "led-post"
    | "led-board"
    | "tunnel-post"
    | "tunnel-board";
  box: AABB;
  bottom: number;
  top: number;
}
export interface CitySigns {
  direction: DirectionSign[];
  wrecks: SignWreck[];
  led: LedSign[];
  tunnel: { id: string; tx: number; W: number; H: number; bottom: number };
  colliders: SignCollider[];
}
export const DIRECTION = {
  postHeight: 7.6,
  postRadius: 0.2,
  armX: 4.5,
  armHeight: 7.5,
  armLength: 9.5,
  armRadius: 0.12,
  jointSize: 0.4,
  boardX: 6,
  boardHeight: 6.3,
  boardWidth: 4.2,
  boardSize: 2.1,
  boardDepth: 0.24,
} as const;
export const LED = { W: 34, H: 17, bottom: 10 } as const;

/** Bounds of a local box after the sign's cardinal yaw (local z points south at yaw=0). */
function signBox(
  p: SignSpot,
  x: number,
  z: number,
  w: number,
  d: number,
): AABB {
  const c = Math.cos(p.rot),
    s = Math.sin(p.rot);
  const cx = p.x + c * x + s * z,
    cy = p.y + s * x - c * z;
  const hx = (Math.abs(c) * w + Math.abs(s) * d) / 2;
  const hy = (Math.abs(s) * w + Math.abs(c) * d) / 2;
  return { x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy };
}

export function buildSigns(city: City): CitySigns {
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
  // Green direction-sign gantries on arterial approaches.
  const direction: DirectionSign[] = [];
  let bi = 0;
  for (const e of city.edges) {
    if (e.crossing) continue;
    const na = city.nodes[e.a];
    const arterial =
      (e.axis === "x" && C.CROSSINGS.includes(na.j)) ||
      (e.axis === "y" && (Math.abs(na.i) === 1 || Math.abs(na.i) === 4));
    if (!arterial || e.len < 120) continue;
    for (const end of [0, 1] as const) {
      const sideSign = (end === 1 ? 1 : -1) * (e.axis === "x" ? -1 : 1);
      const s = end === 1 ? e.len - C.ROAD_HALF - 32 : C.ROAD_HALF + 32;
      const off = sideSign * (C.ROADWAY_HALF + 0.9);
      const p =
        e.axis === "x"
          ? { x: na.x + s, y: na.y + off }
          : { x: na.x + off, y: na.y + s };
      if (inBoxAny(city, p.x, p.y)) continue;
      // keep the toll gate on its own: no direction gantry stacked up with it
      if (
        city.toll &&
        Math.abs(p.x - city.toll.x) < 70 &&
        Math.abs(p.y - city.toll.y) < C.ROAD_HALF
      )
        continue;
      // no sign gantries under the skyway deck
      if (
        Math.abs(p.y - city.skyway.y) < C.ROAD_HALF &&
        p.x > city.skyway.x0 - 10 &&
        p.x < city.skyway.x1 + 10
      )
        continue;
      // rotation: arm must point from the post toward the median (i.e. -sideSign across the road)
      const across =
        e.axis === "x"
          ? sideSign > 0
            ? -Math.PI / 2
            : Math.PI / 2
          : sideSign > 0
            ? Math.PI
            : 0;
      // boards face oncoming traffic (travel direction is +s for end 1): yaw so the board normal points against travel
      const rot = across;
      direction.push({
        x: p.x,
        y: p.y,
        rot,
        eid: city.edges.indexOf(e),
        id: `sign:direction:${bi}`,
        board: bi % 6,
      });
      bi++;
    }
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
  const wreckGantries = [
    ...direction
      .filter((g) => use(g.eid) > 0)
      .sort((a, b) => use(b.eid) - use(a.eid))
      .slice(0, 12),
    ...spread(
      direction.filter((g) => use(g.eid) === 0),
      4,
    ),
  ];

  const wrecks: SignWreck[] = wreckGantries.map((p, i) => {
    const side = (i + 1) % 2 ? 1 : -1;
    return {
      ...p,
      localX: 6 + 0.4 * side,
      height: 6.25,
      roll: 0.18 * side,
      yaw: Math.PI / 2,
      pitch: -0.32,
    };
  });
  // which way the commutes drive each edge (+1 = from node a to node b)
  const dirUse = new Map<number, number>();
  for (const cm of city.commutes) {
    const p = shortestPath(city, cm.home.id, cm.office.id);
    for (let i = 1; i < p.length; i++) {
      const eid = p[i - 1].edges.find((id) => {
        const e = city.edges[id];
        return e.a === p[i].id || e.b === p[i].id;
      });
      if (eid === undefined) continue;
      const e = city.edges[eid];
      dirUse.set(eid, (dirUse.get(eid) ?? 0) + (e.a === p[i - 1].id ? 1 : -1));
    }
  }
  // keep the run-up to the tunnel clear so its giant board stays in full view
  const tunnelRunUp = (id: number) => {
    const e = city.edges[id],
      a = city.nodes[e.a],
      b = city.nodes[e.b];
    return e.axis === "x" && a.y === 0 && Math.max(a.x, b.x) === -C.P;
  };
  const picks = [...routeUse.keys()]
    .filter(
      (id) =>
        !city.edges[id].crossing &&
        !underSkyway(id) &&
        !tunnelRunUp(id) &&
        id !== city.toll?.edge, // the toll gate's road: its own gantries only
    )
    .sort((a, b) => use(b) - use(a))
    .slice(0, 14);

  const led: LedSign[] = picks.map((id) => {
    const e = city.edges[id],
      a = city.nodes[e.a],
      b = city.nodes[e.b];
    const sgn = (dirUse.get(id) ?? 1) >= 0 ? 1 : -1;
    const dx = (e.axis === "x" ? Math.sign(b.x - a.x) : 0) * sgn,
      dy = (e.axis === "y" ? Math.sign(b.y - a.y) : 0) * sgn; // commute travel direction
    const mx = (a.x + b.x) / 2,
      my = (a.y + b.y) / 2;
    const psi = Math.atan2(-dx, dy); // plane normal faces the incoming commuters

    return { id: `sign:led:${id}`, eid: id, x: mx, y: my, rot: psi, dx, dy };
  });
  const tunnel = {
    id: "sign:tunnel",
    tx: city.tunnel.x0 - 1.5,
    W: 48,
    H: 24,
    bottom: 14.8,
  };
  const colliders: SignCollider[] = [];
  const add = (
    p: SignSpot,
    kind: SignCollider["kind"],
    x: number,
    z: number,
    w: number,
    d: number,
    bottom: number,
    top: number,
  ) =>
    colliders.push({
      structure: p.id,
      kind,
      box: signBox(p, x, z, w, d),
      bottom,
      top,
    });
  const D = DIRECTION;
  for (const p of direction) {
    add(p, "post", 0, 0, D.postRadius * 2, D.postRadius * 2, 0, D.postHeight);
    add(
      p,
      "arm",
      D.armX,
      0,
      D.armLength,
      D.armRadius * 2,
      D.armHeight - D.armRadius,
      D.armHeight + D.armRadius,
    );
    add(
      p,
      "arm",
      0,
      0,
      D.jointSize,
      D.jointSize,
      D.armHeight - D.jointSize / 2,
      D.armHeight + D.jointSize / 2,
    );
    add(
      p,
      "board",
      D.boardX,
      0,
      D.boardWidth,
      D.boardDepth,
      D.boardHeight - D.boardSize / 2,
      D.boardHeight + D.boardSize / 2,
    );
  }
  // Conservative envelope of the tilted wrecks and peeled metal, not the harmless road debris.
  // Loaded model bounds span 4.515–7.985m high, at most 2.874m across and 4.999m through the board.
  // Same structure key as its board, so touching both cannot double-fire crash/scrape effects.
  for (const p of wrecks) add(p, "wreck", p.localX, 0, 3, 5, 4.4, 8.1);
  for (const p of led) {
    const { W, H, bottom } = LED;
    // Includes both screen faces (local z=0 and -0.7), frame and ticker underneath.
    add(p, "led-board", 0, -0.35, W + 1.2, 0.7, bottom - 1.8, bottom + H + 0.8);
    for (const side of [-1, 1])
      add(p, "led-post", side * (W / 2 + 0.6), 0, 1, 1, 0, bottom + H + 1.2);
  }
  const tp: SignSpot = { id: tunnel.id, x: tunnel.tx, y: 0, rot: 0 };
  const { W, H, bottom } = tunnel;
  add(
    tp,
    "tunnel-board",
    0.425,
    0,
    0.85,
    W + 1.6,
    bottom - 2.6,
    bottom + H + 1.6,
  );
  // These two legs stand on the tunnel roof, not on the road beneath it.
  for (const side of [-1, 1])
    add(tp, "tunnel-post", 1.5, side * 12, 1.2, 1.2, C.CEIL_H, bottom - 2.5);
  return { direction, wrecks, led, tunnel, colliders };
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
