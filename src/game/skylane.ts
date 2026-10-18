// The sky lane: two dense streams of roadsters flying over the corridor from the home junctions to the tunnel, both
// directions, above the toll plaza and past the launch venue. Positions are a pure function of session time, so the
// game collides with exactly what the renderer draws.
import * as C from "./constants";

export interface SkyCar {
  x0: number;
  len: number;
  y: number;
  /** body centre height */
  h: number;
  dir: 1 | -1;
  ph: number;
}
const SKY_V = 21;
export const SKY_CAR = { halfL: 2.35, halfW: 1.0, H: 1.2 } as const;

export function buildSkyLane(): SkyCar[] {
  const x0 = -C.P * 4.5,
    len = -C.P - 30 - x0;
  const N = 28;
  const out: SkyCar[] = [];
  for (let i = 0; i < N; i++) {
    const dir: 1 | -1 = i % 2 ? 1 : -1;
    out.push({
      x0,
      len,
      // keeping right like the road below (eastbound over the -y lanes): you catch them up, not meet them head-on
      y: -dir * (4 + ((i * 7) % 3) * 1.6),
      // 10.6-13.8 m: above a car skimming the toll canopy roof (7.4 m), within reach of full jet flight
      h: 10.6 + ((i * 5) % 4) * 1.05,
      dir,
      ph: ((Math.floor(i / 2) * len) / (N / 2) + (i % 2) * 11) % len,
    });
  }
  return out;
}

export function skyCarAt(
  s: SkyCar,
  i: number,
  t: number,
): { x: number; y: number; hc: number; heading: number } {
  const u = (((s.ph + t * SKY_V * s.dir) % s.len) + s.len) % s.len;
  return {
    x: s.x0 + u,
    y: s.y,
    hc: s.h + 0.25 * Math.sin(t * 1.7 + i),
    heading: s.dir > 0 ? 0 : Math.PI,
  };
}
