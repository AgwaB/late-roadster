// The toll plaza across the commute corridor: a booth island on every lane line, a canopy over all lanes, and every
// lane jammed with drivers queueing to pay. Driving through means waiting; the roadster goes over the top (the
// "flying over the toll gate" meme). Shared by the game (props, solids, the canopy roof deck) and the renderer.
import type { AABB, Toll } from "./city";
import * as C from "./constants";
import type { Solid } from "./venue";

export const PLAZA = {
  canopyHalfX: 7,
  canopyHalfY: C.ROADWAY_HALF + 2.5,
  /** canopy underside / roof (you can land on the roof) */
  bottom: 6.4,
  top: 7.4,
  islandHalfX: 4.5,
  islandHalfW: 0.7,
  boothHalfX: 1.0,
  boothHalfW: 0.6,
  boothH: 2.7,
  /** the closed arm sits this far past the booth line, on each direction's exit side */
  armOff: 3.6,
  /** queue: first car alongside the booth window, then one every carGap metres back */
  firstCar: 1.0,
  carGap: 6.6,
  cars: 8,
} as const;

/** Island centres: on the three lane lines of each direction (the median is the fourth line). */
export function tollIslands(tl: Toll): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const sy of [-1, 1])
    for (let k = 1; k < C.LANES_PER_DIR; k++)
      out.push({ x: tl.x, y: tl.y + sy * (C.MEDIAN_HALF + k * C.LANE_W) });
  return out;
}

export function tollCanopy(tl: Toll): AABB {
  return {
    x0: tl.x - PLAZA.canopyHalfX,
    x1: tl.x + PLAZA.canopyHalfX,
    y0: tl.y - PLAZA.canopyHalfY,
    y1: tl.y + PLAZA.canopyHalfY,
  };
}

/** Queueing cars, both directions (right-hand traffic: eastbound, dir 1, on the -y half). */
export function tollQueue(
  tl: Toll,
): { x: number; y: number; dir: 1 | -1; lane: number; k: number }[] {
  const out: { x: number; y: number; dir: 1 | -1; lane: number; k: number }[] =
    [];
  for (const dir of [1, -1] as const)
    for (let lane = 0; lane < C.LANES_PER_DIR; lane++)
      for (let k = 0; k < PLAZA.cars; k++) {
        // a little ragged, like a real queue
        const jit = (((k * 7 + lane * 13 + (dir > 0 ? 0 : 5)) % 5) - 2) * 0.18;
        out.push({
          x: tl.x - dir * (PLAZA.firstCar + k * PLAZA.carGap + jit),
          y: tl.y - dir * C.laneOffset(lane),
          dir,
          lane,
          k,
        });
      }
  return out;
}

/** Islands with their booths, the canopy columns and the canopy itself. */
export function tollSolids(tl: Toll): Solid[] {
  const out: Solid[] = [];
  const P = PLAZA;
  for (const is of tollIslands(tl)) {
    out.push({
      box: {
        x0: is.x - P.islandHalfX,
        x1: is.x + P.islandHalfX,
        y0: is.y - P.islandHalfW,
        y1: is.y + P.islandHalfW,
      },
      bottom: 0,
      top: P.boothH,
      what: "toll",
      key: "toll:" + is.y,
    });
  }
  // columns at both ends of every island and in the median
  for (const y of [...tollIslands(tl).map((i) => i.y), tl.y])
    for (const sx of [-1, 1]) {
      const x = tl.x + sx * (P.islandHalfX - 0.4);
      out.push({
        box: { x0: x - 0.25, x1: x + 0.25, y0: y - 0.25, y1: y + 0.25 },
        bottom: 0,
        top: P.bottom,
        what: "toll",
        key: "toll:col",
      });
    }
  out.push({
    box: tollCanopy(tl),
    bottom: P.bottom,
    top: P.top,
    what: "toll",
    key: "toll:canopy",
  });
  return out;
}
