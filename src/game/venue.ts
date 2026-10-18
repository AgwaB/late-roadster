// The launch-event venue on the open event ground beside the corridor, laid out after the real reveal night:
// "The Ramp" (a concrete quarter pipe that climbs past vertical and curls back over the run-in, held up by a steel
// truss tower) and "The Kickflip" (a row of vehicles parked side by side on a red-lit plinth, jumped from a straight
// run-in). Shared by the game (props, solids, the wall ride) and the renderer.
import type { AABB } from "./city";
import { CURB_H } from "./constants";

/** Hook ramp profile in its own frame: u along the run-in (toward the wall), z up. */
export const RAMP = {
  /** radius of the bottom curve, flat to vertical (tight, as on the night: a short foot under a tall wall) */
  R: 6,
  /** straight vertical section */
  VERT: 9,
  /** radius of the curl at the top that leans back over the run-in (the "C" seen from the side) */
  r: 6,
  HOOK: (55 * Math.PI) / 180,
  /** half width of the riding surface */
  HALF: 3,
  /** truss tower depth behind the wall */
  TOWER: 4.5,
} as const;
/** arc length from the foot of the curve to the lip */
export const RAMP_END = (RAMP.R * Math.PI) / 2 + RAMP.VERT + RAMP.r * RAMP.HOOK;

/** Surface point at arc length s from the foot: u along the run, z height, th the surface's climb angle. */
export function rampPoint(s: number): { u: number; z: number; th: number } {
  const { R, VERT, r, HOOK } = RAMP;
  const a1 = (R * Math.PI) / 2;
  if (s <= 0) return { u: s, z: 0, th: 0 };
  if (s <= a1) {
    const p = s / R;
    return { u: R * Math.sin(p), z: R * (1 - Math.cos(p)), th: p };
  }
  if (s <= a1 + VERT) return { u: R, z: R + (s - a1), th: Math.PI / 2 };
  const q = Math.min(HOOK, (s - a1 - VERT) / r);
  return {
    u: R - r + r * Math.cos(q),
    z: R + VERT + r * Math.sin(q),
    th: Math.PI / 2 + q,
  };
}
/** height of the lip (~20.3 m) */
export const RAMP_TOP = rampPoint(RAMP_END).z;

/** Foot of the ramp curve (u = 0) and the unit run direction toward the wall. */
export interface WallRamp {
  x: number;
  y: number;
  ux: number;
  uy: number;
}
export function rampLocal(
  r: WallRamp,
  x: number,
  y: number,
): { u: number; w: number } {
  const dx = x - r.x,
    dy = y - r.y;
  return { u: dx * r.ux + dy * r.uy, w: -dx * r.uy + dy * r.ux };
}
export function rampWorld(
  r: WallRamp,
  u: number,
  w: number,
): { x: number; y: number } {
  return { x: r.x + r.ux * u - r.uy * w, y: r.y + r.uy * u + r.ux * w };
}

/** Height-aware static solid (an axis-aligned box from bottom to top). */
export interface Solid {
  box: AABB;
  bottom: number;
  top: number;
  /** crash / contact reason */
  what: string;
  /** one contact effect per structure */
  key: string;
}

/** The ramp body as stepped boxes: the filled curve (only a wall ride gets onto it), the wall, the hook, the tower. */
export function rampSolids(r: WallRamp): Solid[] {
  const { R, VERT, r: hr, HOOK, HALF, TOWER } = RAMP;
  const curve = (u: number) => R - Math.sqrt(Math.max(0, R * R - u * u));
  const box = (u0: number, u1: number, w: number): AABB => {
    const a = rampWorld(r, u0, -w),
      b = rampWorld(r, u1, w);
    return {
      x0: Math.min(a.x, b.x),
      y0: Math.min(a.y, b.y),
      x1: Math.max(a.x, b.x),
      y1: Math.max(a.y, b.y),
    };
  };
  const out: Solid[] = [];
  const w = HALF + 0.4;
  for (const [u0, u1] of [
    [2.5, 4.5],
    [4.5, 6.5],
    [6.5, 8],
    [8, 9.2],
    [9.2, R],
  ])
    out.push({
      box: box(u0, u1, w),
      bottom: 0,
      top: CURB_H + curve(u1),
      what: "ramp",
      key: "ramp",
    });
  out.push({
    box: box(R, R + TOWER, w + 1),
    bottom: 0,
    top: RAMP_TOP + 2,
    what: "ramp",
    key: "ramp",
  });
  out.push({
    box: box(R - hr + hr * Math.cos(HOOK) - 0.3, R, w),
    bottom: CURB_H + R + VERT,
    top: CURB_H + RAMP_TOP + 0.6,
    what: "ramp",
    key: "ramp",
  });
  return out;
}

/** The kickflip row, side by side across the run-in (lat: metres to the left of the run-in line), facing the run-in. */
export const ROW = [
  // in the order the jumper meets them along the run-in: a gold coupe, a boxy steel-grey SUV, the white cab-over
  // truck in the middle, a silver and a dark sedan; parked side by side, every one broadside to the run (nose to
  // the audience on the road side), so the jump clears all of their widths. (All flat-coloured models: the paint
  // part is recoloured; the textured pickup could not be, it stayed blue.)
  { kind: "sedan2", halfL: 2.25, halfW: 0.9, h: 1.25, color: 0xc8a96a },
  { kind: "suv", halfL: 2.35, halfW: 1.1, h: 1.7, color: 0x9aa0a8 },
  { kind: "semi", halfL: 3.3, halfW: 1.3, h: 3.9, color: 0xf2f2f2 },
  { kind: "sports", halfL: 2.25, halfW: 1.0, h: 1.4, color: 0xc9ced6 },
  { kind: "sedan", halfL: 2.2, halfW: 1.0, h: 1.5, color: 0x1d2128 },
] as const;
/** the row's centre distance along the run-in, and the gap between neighbours */
export const ROW_S = 92;
const ROW_GAP = 0.8;
/** each vehicle's centre along the run, relative to ROW_S */
export const ROW_OFFSETS: readonly number[] = (() => {
  const total =
    ROW.reduce((a, v) => a + 2 * v.halfW, 0) + ROW_GAP * (ROW.length - 1);
  let s = -total / 2;
  return ROW.map((v) => {
    const c = s + v.halfW;
    s += 2 * v.halfW + ROW_GAP;
    return c;
  });
})();
/** half length of the row along the run */
export const ROW_HALF = ROW_OFFSETS[ROW.length - 1] + ROW[ROW.length - 1].halfW;
/** the low plinth under the row: half length along the run, half width across, height */
export const PLINTH = { halfS: ROW_HALF + 1.4, halfLat: 4.2, h: 0.14 } as const;
/** run-in dressing: black crowd barriers either side (lat), from s0 to s1, with light bars every LIGHT_STEP */
export const LANE = { lat: 7.5, s0: 14, s1: ROW_S - ROW_HALF - 12, h: 1.1 };
/** Grandstand banks (stepped, N rows of D deep and R high) along the south and west edges of the event ground. */
export const STANDS = { N: 7, D: 1.1, R: 0.55 } as const;
export function grandstands(
  fl: AABB,
): { box: AABB; facing: "north" | "east" }[] {
  const d = STANDS.N * STANDS.D;
  return [
    {
      box: {
        x0: fl.x0 + 14,
        x1: fl.x0 + 126,
        y0: fl.y0 + 4,
        y1: fl.y0 + 4 + d,
      },
      facing: "north",
    },
    {
      box: { x0: fl.x0 + 4, x1: fl.x0 + 4 + d, y0: fl.y0 + 25, y1: fl.y0 + 95 },
      facing: "east",
    },
  ];
}
/** Floodlight towers (poles FLOOD_H tall) around the floor. */
export const FLOOD_H = 19;
export function floodlights(fl: AABB): { x: number; y: number }[] {
  return [
    { x: fl.x0 + 8, y: fl.y1 - 40 },
    { x: fl.x1 - 4, y: fl.y1 - 12 },
    { x: fl.x0 + 8, y: fl.y0 + 4 },
    { x: fl.x1 - 4, y: fl.y0 + 4 },
  ];
}
/** The two power-line poles behind the vehicle row, the wires running along it (run-in start ox/oy, run along +x). */
export function powerPoles(ox: number, oy: number): { x: number; y: number }[] {
  const y = oy - 13;
  return [
    { x: ox + ROW_S - ROW_HALF - 14, y },
    { x: ox + ROW_S + ROW_HALF + 14, y },
  ];
}

/** Everything solid on the event ground besides the ramp and the row: grandstands, poles, run-in barriers. */
export function venueSolids(fl: AABB, ox: number, oy: number): Solid[] {
  const lane: Solid[] = [-1, 1].map((side) => ({
    box: {
      x0: ox + LANE.s0,
      x1: ox + LANE.s1,
      y0: oy + side * LANE.lat - 0.15,
      y1: oy + side * LANE.lat + 0.15,
    },
    bottom: 0,
    top: LANE.h,
    what: "wall",
    key: "barrier:" + side,
  }));
  const out: Solid[] = grandstands(fl).map((s) => ({
    box: s.box,
    bottom: 0,
    top: STANDS.N * STANDS.R,
    what: "wall",
    key: "stands",
  }));
  out.push(...lane);
  const pole = (p: { x: number; y: number }, r: number, top: number) =>
    out.push({
      box: { x0: p.x - r, x1: p.x + r, y0: p.y - r, y1: p.y + r },
      bottom: 0,
      top,
      what: "pole",
      key: "pole:" + p.x + "," + p.y,
    });
  for (const p of floodlights(fl)) pole(p, 0.3, FLOOD_H + 2.5);
  for (const p of powerPoles(ox, oy)) pole(p, 0.25, 10);
  return out;
}
