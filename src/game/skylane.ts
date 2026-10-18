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

/**
 * Over the toll plaza the lane arches up out of jet reach: a car flying over the canopy (the TOLL $0 clip) can climb
 * to ~21 m off its roof, so the flying cars hop the plaza at 23+ m instead of waiting there to wipe it out.
 */
export const SKY_ARCH = { x: C.TOLL_X, flat: 30, ramp: 40, h: 13 } as const;

/** the arch at x: height added, and its gradient dh/dx */
function arch(x: number): { dh: number; slope: number } {
  const d = Math.abs(x - SKY_ARCH.x);
  if (d >= SKY_ARCH.flat + SKY_ARCH.ramp) return { dh: 0, slope: 0 };
  if (d <= SKY_ARCH.flat) return { dh: SKY_ARCH.h, slope: 0 };
  const q = 1 - (d - SKY_ARCH.flat) / SKY_ARCH.ramp; // 0 at the foot .. 1 at the top
  const g = (6 * q * (1 - q) * SKY_ARCH.h) / SKY_ARCH.ramp;
  return {
    dh: SKY_ARCH.h * q * q * (3 - 2 * q),
    slope: x < SKY_ARCH.x ? g : -g,
  };
}

export function skyCarAt(
  s: SkyCar,
  i: number,
  t: number,
): { x: number; y: number; hc: number; heading: number; pitch: number } {
  const u = (((s.ph + t * SKY_V * s.dir) % s.len) + s.len) % s.len;
  const x = s.x0 + u;
  const a = arch(x);
  return {
    x,
    y: s.y,
    hc: s.h + a.dh + 0.25 * Math.sin(t * 1.7 + i),
    heading: s.dir > 0 ? 0 : Math.PI,
    // nose up climbing the arch, down coming off it
    pitch: Math.atan(a.slope * s.dir),
  };
}
