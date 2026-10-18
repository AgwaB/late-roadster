// Free-driving arcade car physics, Raycity-style: hold to accelerate, Ctrl+dir drift, Shift boost, Space jump / 2nd Space thruster flip,
// the booster drains SP, double-tap sidestep (칼치기). No physics engine.
import * as C from "./constants";
import {
  RAMP,
  RAMP_END,
  rampLocal,
  rampPoint,
  rampWorld,
  type WallRamp,
} from "./venue";

export interface Input {
  steer: number; // + = left
  accel: boolean;
  brake: boolean;
  drift: boolean; // Shift held
  jump: boolean; // Space held (edge detected here)
  boost: boolean; // Ctrl/Alt held
  stick: boolean; // E held; each press toggles tunnel-ceiling driving (edge detected here)
  sidestep: number; // -1 | 0 | 1 one-shot (double tap)
}
export const NO_INPUT: Input = {
  steer: 0,
  accel: false,
  brake: false,
  drift: false,
  jump: false,
  boost: false,
  stick: false,
  sidestep: 0,
};

export interface Env {
  /** Session-owned random stream, including failed-landing wreck impulses. */
  rnd(): number;
  /** h: current height, so an elevated deck counts as ground only for something already up there */
  ground(x: number, y: number, h?: number): { h: number; slope: number };
  tunnel(x: number, y: number): boolean;
  /** Highest the car may fly here at height h (e.g. under the skyway deck); Infinity when open sky. */
  ceiling?(x: number, y: number, h: number): number;
  /** the event hook ramp: drive onto its foot square and fast enough and the car rides the wall */
  wallRamp?: WallRamp | null;
  respawn(c: Car): void;
  /** 0 dry .. 1 wet road: wider drift angles, slower lateral recovery */
  wet?(): number;
}

export type CarState = "drive" | "crash" | "done";

export interface Car {
  x: number;
  y: number;
  heading: number;
  px: number;
  py: number;
  v: number;
  vLat: number;
  yawRate: number;
  /** spin from car-to-car impacts (rad/s), decays on its own */
  kickYaw: number;
  steerS: number;
  h: number;
  /** Bottom of the rotated body before the current physics step (roof-crossing contacts). */
  previousBottom: number;
  vH: number;
  pitch: number;
  roll: number;
  yawVis: number;
  grounded: boolean;
  ceiling: boolean;
  drifting: boolean;
  boosting: boolean;
  flipRemaining: number;
  flips: number;
  bursts: number; // rotations started during this air phase (capped by FLIP_MAX)
  flipRate: number; // rad/s of the current rotation (fitted to the remaining airtime)
  /** Off-axis twist: angle rotated so far about spinAxis (body frame), 0 when level. */
  spin: number;
  /** Body-frame rotation axis of the twist (x forward, y up, z right); set when a rotation starts. */
  spinAxis: [number, number, number];
  lastSlope: number;
  stickLatch: boolean;
  /** this Space press may fly while held (the launch press, or an in-air press held past TAP_MAX) */
  flyHeld: boolean;
  /** s an in-air press has been held while undecided (tap = flip on release, hold = fly); -1 = none */
  airPress: number;
  /** ceiling attach progress 0..1 (a jet-powered rise, then the half roll onto the roof) and its start height */
  ceilT: number;
  ceilH0: number;
  /** s of jet flight used in this air phase (FLY_MAX, then a slow descent) */
  flyTime: number;
  /** s the current Space press has been held */
  holdT: number;
  /** hold-Space jets carrying the car this step (visuals) / already fired during this air phase (sound cue) */
  thrusting: boolean;
  thrustOn: boolean;
  /** coming down off the ramp's lip: the jets right the car and brake the fall until it lands */
  rampDrop: boolean;
  /** those jets are braking the fall this step (visuals) */
  retro: boolean;
  /** s left of the straight-up flip launch before the rotation starts */
  flipDelay: number;
  /** riding the event hook ramp: s = arc length up the surface, v = speed along it, w = offset across it */
  wall: { s: number; v: number; w: number } | null;
  /** s after leaving the ramp lip during which the ramp body does not collide (the car starts inside its box) */
  wallGrace: number;
  /** crashed into a sinkhole: the wreck sinks nose-first into it instead of tumbling */
  pit: { x: number; y: number } | null;
  sp: number;
  state: CarState;
  crashT: number;
  crashes: number;
  invuln: number;
  av: [number, number, number];
  vx: number;
  vy: number;
  /** flight fuel 0..1 (FUEL gauge): burned by hold-to-fly, refills on the ground */
  fuel: number;
  jumpLatch: boolean;
  t: number;
}

export function newCar(x: number, y: number, heading: number): Car {
  return {
    x,
    y,
    heading,
    px: x,
    py: y,
    v: 0,
    vLat: 0,
    yawRate: 0,
    kickYaw: 0,
    steerS: 0,
    h: 0,
    previousBottom: 0,
    vH: 0,
    pitch: 0,
    roll: 0,
    yawVis: 0,
    grounded: true,
    ceiling: false,
    drifting: false,
    boosting: false,
    flipRemaining: 0,
    flips: 0,
    bursts: 0,
    flipRate: C.FLIP_RATE,
    spin: 0,
    spinAxis: [0, 0, 1],
    lastSlope: 0,
    stickLatch: false,
    flyHeld: false,
    airPress: -1,
    flyTime: 0,
    holdT: 0,
    ceilT: 1,
    ceilH0: 0,
    thrusting: false,
    thrustOn: false,
    rampDrop: false,
    retro: false,
    flipDelay: 0,
    wall: null,
    wallGrace: 0,
    pit: null,
    sp: C.SP_MAX,
    state: "drive",
    crashT: 0,
    crashes: 0,
    invuln: 0,
    av: [0, 0, 0],
    vx: 0,
    vy: 0,
    fuel: 1,
    jumpLatch: false,
    t: 0,
  };
}

export function velocity(c: Car): { vx: number; vy: number } {
  const fx = Math.cos(c.heading),
    fy = Math.sin(c.heading);
  return { vx: fx * c.v - fy * c.vLat, vy: fy * c.v + fx * c.vLat };
}

/** Vertical span of the rendered body: twist, then roll, then pitch about its raised pivot. */
export function carSpan(c: Car): { bottom: number; top: number } {
  const pitch = c.pitch + (c.grounded ? Math.atan(c.lastSlope) : 0);
  if (pitch === 0 && c.roll === 0 && c.spin === 0)
    return { bottom: c.h, top: c.h + C.CAR_ROOF };
  // World-up row of Rz(pitch) Rx(roll); yaw does not affect height.
  const x = Math.sin(pitch),
    y = Math.cos(pitch) * Math.cos(c.roll),
    z = -Math.cos(pitch) * Math.sin(c.roll);
  const [ax, ay, az] = c.spinAxis;
  const cs = Math.cos(c.spin),
    sn = Math.sin(c.spin),
    dot = ax * x + ay * y + az * z;
  // Multiply the row by the body-frame twist (inverse Rodrigues on the row vector).
  const ux = x * cs - (ay * z - az * y) * sn + ax * dot * (1 - cs);
  const uy = y * cs - (az * x - ax * z) * sn + ay * dot * (1 - cs);
  const uz = z * cs - (ax * y - ay * x) * sn + az * dot * (1 - cs);
  const center = c.h + C.CAR_H / 2 + (uy * (C.CAR_ROOF - C.CAR_H)) / 2;
  const radius =
    Math.abs(ux) * C.CAR_HALF_L +
    (Math.abs(uy) * C.CAR_ROOF) / 2 +
    Math.abs(uz) * C.CAR_HALF_W;
  return { bottom: center - radius, top: center + radius };
}

export function crashCar(c: Car, reason: string, rnd: () => number): string {
  if (c.state !== "drive") return "";
  const vel = velocity(c);
  c.state = "crash";
  c.crashT = 0;
  c.thrusting = false;
  c.thrustOn = false;
  c.rampDrop = c.retro = false;
  c.flipDelay = 0;
  c.flyTime = 0;
  c.flyHeld = false;
  c.airPress = -1;
  c.crashes++;
  c.wall = null;
  c.pit = null;
  c.ceiling = false;
  c.grounded = false;
  c.drifting = false;
  c.boosting = false;
  c.flipRemaining = 0;
  c.spin = 0;
  c.vx = vel.vx * 0.6 + (rnd() - 0.5) * 4;
  c.vy = vel.vy * 0.6 + (rnd() - 0.5) * 4;
  c.vH = 5 + rnd() * 3;
  c.av = [(rnd() - 0.5) * 14, (rnd() - 0.5) * 6, (rnd() - 0.5) * 12];
  return "crash:" + reason;
}

/** Angle between the car's roof and world up, from pitch, roll and the off-axis twist (0 = level). */
export function uprightTilt(c: Car): number {
  // body up (0,1,0) rotated about spinAxis by spin (Rodrigues), then roll about x, then pitch about z
  const [ax, ay, az] = c.spinAxis;
  const cs = Math.cos(c.spin),
    sn = Math.sin(c.spin);
  // v = u cos + (k x u) sin + k (k.u)(1-cos), u = (0,1,0), k x u = (-az, 0, ax)
  const kdotu = ay;
  let x = -az * sn + ax * kdotu * (1 - cs);
  let y = cs + ay * kdotu * (1 - cs);
  let z = ax * sn + az * kdotu * (1 - cs);
  // roll about x
  const cr = Math.cos(c.roll),
    sr = Math.sin(c.roll);
  [y, z] = [y * cr - z * sr, y * sr + z * cr];
  // pitch about z
  const cp = Math.cos(c.pitch),
    sp = Math.sin(c.pitch);
  [x, y] = [x * cp - y * sp, x * sp + y * cp];
  void x;
  void z;
  return Math.acos(C.clamp(y, -1, 1));
}

export function placeCar(
  c: Car,
  x: number,
  y: number,
  heading: number,
  groundH: number,
): void {
  c.state = "drive";
  c.x = x;
  c.y = y;
  c.px = x;
  c.py = y;
  c.heading = heading;
  c.v = C.RESPAWN_SPEED;
  c.vLat = 0;
  c.yawRate = 0;
  c.kickYaw = 0;
  c.thrusting = false;
  c.thrustOn = false;
  c.rampDrop = c.retro = false;
  c.flipDelay = 0;
  c.flyTime = 0;
  c.flyHeld = false;
  c.airPress = -1;
  c.wall = null;
  c.wallGrace = 0;
  c.pit = null;
  c.steerS = 0;
  c.h = groundH;
  c.previousBottom = groundH;
  c.vH = 0;
  c.pitch = 0;
  c.roll = 0;
  c.yawVis = 0;
  c.grounded = true;
  c.ceiling = false;
  c.drifting = false;
  c.boosting = false;
  c.flipRemaining = 0;
  c.spin = 0;
  c.flips = 0;
  c.bursts = 0;
  c.lastSlope = 0;
  c.sp = Math.max(c.sp, 40);
  c.invuln = C.INVULN;
  c.av = [0, 0, 0];
  c.fuel = 1;
}

export function stepCar(c: Car, inp: Input, dt: number, env: Env): string[] {
  const ev: string[] = [];
  c.previousBottom = carSpan(c).bottom;
  c.t += dt;
  if (c.invuln > 0) c.invuln -= dt;
  if (c.state === "done") return ev;

  if (c.state === "crash") {
    c.crashT += dt;
    // a Space held through the replay must not fire a jump the moment the car is back on the road
    c.jumpLatch = inp.jump;
    c.stickLatch = inp.stick;
    const m = dt * C.SLOWMO;
    c.px = c.x;
    c.py = c.y;
    if (c.pit) {
      // into the sinkhole nose-first: slide over the hole, drop, and stay stuck with the tail in the air
      const k = Math.min(1, m * 5);
      const tx = c.pit.x - Math.cos(c.heading) * 0.9,
        ty = c.pit.y - Math.sin(c.heading) * 0.9;
      c.x += (tx - c.x) * k;
      c.y += (ty - c.y) * k;
      c.h += (-1.3 - c.h) * k;
      c.pitch += (-0.62 - c.pitch) * k;
      c.roll += (0.12 - c.roll) * k;
      c.vH = 0;
      if (c.crashT >= C.CRASH_REPLAY) {
        env.respawn(c);
        if ((c.state as CarState) === "drive") ev.push("respawn");
      }
      return ev;
    }
    c.x += c.vx * m;
    c.y += c.vy * m;
    c.vx *= Math.max(0, 1 - 1.2 * m);
    c.vy *= Math.max(0, 1 - 1.2 * m);
    c.pitch += c.av[0] * m;
    c.heading += c.av[1] * m;
    c.roll += c.av[2] * m;
    c.vH -= C.GRAVITY * m;
    c.h += c.vH * m;
    const g = env.ground(c.x, c.y).h;
    if (c.h < g) {
      c.h = g;
      c.vH = Math.abs(c.vH) * 0.35;
      c.av = [c.av[0] * 0.5, c.av[1] * 0.6, c.av[2] * 0.5];
    }
    if (c.crashT >= C.CRASH_REPLAY) {
      env.respawn(c);
      if ((c.state as CarState) === "drive") ev.push("respawn");
    }
    return ev;
  }

  if (c.wallGrace > 0) c.wallGrace -= dt;
  if (c.wall && env.wallRamp) return stepWall(c, inp, dt, env.wallRamp, ev);

  // ---- steering (snappy)
  const target = C.clamp(inp.steer, -1, 1);
  if (Math.abs(target) > 0.05)
    c.steerS += C.clamp(
      target - c.steerS,
      -dt / C.STEER_RAMP,
      dt / C.STEER_RAMP,
    );
  else
    c.steerS += C.clamp(-c.steerS, -dt / C.STEER_RELEASE, dt / C.STEER_RELEASE);

  // ---- drift (Shift + direction), also in the air (공중 드리프트)
  const wasDrifting = c.drifting;
  c.drifting =
    inp.drift && Math.abs(c.steerS) > 0.3 && !c.ceiling && Math.abs(c.v) > 6;
  if (c.drifting && !wasDrifting) ev.push("drift");
  if (c.drifting && c.grounded)
    c.sp = Math.min(C.SP_MAX, c.sp + C.SP_DRIFT * dt);

  // ---- booster (hold with the accelerator)
  // on the road or driving the ceiling lane upside down
  const wantBoost = inp.boost && inp.accel && (c.grounded || c.ceiling);
  if (!c.boosting && wantBoost && c.sp >= C.SP_BOOST_MIN) {
    c.boosting = true;
    ev.push(c.sp >= 90 ? "boost:3" : "boost:1");
  }
  if (c.boosting) c.sp = Math.max(0, c.sp - C.SP_BOOST_DRAIN * dt);
  else c.sp = Math.min(C.SP_MAX, c.sp + C.SP_REGEN * dt);
  // the flight tank refills on the road (and on the ceiling lane)
  if (c.grounded || c.ceiling)
    c.fuel = Math.min(1, c.fuel + C.FUEL_REFILL * dt);
  if (c.boosting && (!wantBoost || c.sp <= 0)) {
    c.boosting = false;
    ev.push("boost:off");
  }

  // ---- longitudinal
  if (c.grounded || c.ceiling) {
    if (inp.brake) {
      if (c.v > 0) c.v = Math.max(0, c.v - C.BRAKE_DECEL * dt);
      else c.v = Math.max(-C.REVERSE_MAX, c.v - 8 * dt);
    } else if (inp.accel) {
      const tgt = c.boosting
        ? C.BOOST_SPEED
        : c.drifting
          ? C.BASE_SPEED * C.DRIFT_SPEED_K
          : C.BASE_SPEED;
      const a = c.boosting ? C.BOOST_ACCEL : C.ACCEL;
      c.v += C.clamp(tgt - c.v, -C.COAST_DECEL * dt, a * dt);
    } else {
      c.v += C.clamp(0 - c.v, -C.COAST_DECEL * dt, C.COAST_DECEL * dt);
    }
  } else if (c.thrusting && inp.accel && c.fuel > 0 && c.v < C.FLY_SPEED) {
    // flying on the jets with the gas held: they push forward too (never slowing a faster car)
    c.v = Math.min(C.FLY_SPEED, c.v + C.FLY_ACCEL * dt);
  }

  // ---- yaw
  const authority = c.grounded || c.ceiling ? 1 : inp.drift ? 1 : 0.45;
  const k = C.clamp(Math.abs(c.v) / C.BASE_SPEED, 0, 1);
  const rate =
    (C.TURN_RATE_LOW + (C.TURN_RATE_HIGH - C.TURN_RATE_LOW) * k) *
    (c.drifting ? C.DRIFT_TURN_MULT : 1) *
    authority;
  const speedK = C.clamp(Math.abs(c.v) / 4, 0, 1) * (c.v < 0 ? -1 : 1); // no turning when stopped, inverted in reverse
  const yawTarget = c.steerS * rate * (c.grounded || c.ceiling ? speedK : 1);
  c.yawRate += (yawTarget - c.yawRate) * Math.min(1, C.YAW_RESPONSE * dt);
  c.heading += c.yawRate * dt;
  c.heading += c.kickYaw * dt;
  c.kickYaw *= Math.exp(-2.5 * dt);
  // lateral: drift slide + sidestep impulse
  if (inp.sidestep !== 0 && c.sp >= C.SP_SIDESTEP && c.grounded) {
    c.vLat += inp.sidestep * C.SIDESTEP_V;
    c.sp -= C.SP_SIDESTEP;
    ev.push("sidestep");
  }
  const wet = env.wet?.() ?? 0;
  const slideTarget =
    c.drifting && c.grounded
      ? -Math.sign(c.steerS) * C.DRIFT_SLIDE * k * (1 + 0.8 * wet)
      : c.grounded
        ? -c.yawRate * 2.2 * wet * k // wet: the tail follows the steering input
        : 0;
  c.vLat +=
    (slideTarget - c.vLat) *
    Math.min(1, (c.drifting ? 4 : 6) * (1 - 0.55 * wet) * dt);
  const yawVisTarget = c.drifting ? Math.sign(c.steerS) * 0.5 : 0;
  c.yawVis += (yawVisTarget - c.yawVis) * Math.min(1, 8 * dt);

  // ---- move
  c.px = c.x;
  c.py = c.y;
  const vel = velocity(c);
  c.x += vel.vx * dt;
  c.y += vel.vy * dt;

  // ---- vertical
  // the event hook ramp: rolling onto its foot square to the wall and fast enough, the suction takes over
  if (c.grounded && !c.ceiling && env.wallRamp && c.v > 12) {
    const r = env.wallRamp;
    const q = rampLocal(r, c.x, c.y);
    const along = Math.cos(c.heading) * r.ux + Math.sin(c.heading) * r.uy;
    if (
      q.u > -0.5 &&
      q.u < 2 &&
      Math.abs(q.w) < RAMP.HALF - 0.6 &&
      along > Math.cos((30 * Math.PI) / 180)
    ) {
      c.wall = { s: Math.max(0, q.u), v: c.v, w: q.w };
      if (c.boosting) ev.push("boost:off");
      c.boosting = false;
      c.drifting = false;
      c.vLat = 0;
      ev.push("wall");
      return stepWall(c, inp, 0, r, ev);
    }
  }
  const g = env.ground(c.x, c.y, c.h);
  const inT = env.tunnel(c.x, c.y);
  const ceilY = C.CEIL_H - C.CAR_H;
  const jumpEdge = inp.jump && !c.jumpLatch;
  const stickEdge = inp.stick && !c.stickLatch;
  c.holdT = inp.jump ? (jumpEdge ? 0 : c.holdT + dt) : 0;
  c.thrusting = false;
  let jumpedNow = false;

  // E toggles the tunnel ceiling: snap up (a quick rise + half roll), stay until E again or the tunnel ends
  if (c.ceiling) {
    if (stickEdge || !inT) {
      c.ceiling = false;
      c.grounded = false;
      c.vH = -2;
      ev.push("ceil:off");
    } else {
      // the jets push the car straight up first; the half roll onto the ceiling happens near the top
      c.ceilT = Math.min(1, c.ceilT + dt / C.CEIL_RISE);
      const sm = (q: number) => {
        const k = C.clamp(q, 0, 1);
        return k * k * (3 - 2 * k);
      };
      c.h = c.ceilH0 + (ceilY - c.ceilH0) * sm(c.ceilT);
      c.roll = Math.PI * sm((c.ceilT - 0.45) / 0.55);
      c.vH = 0;
      c.pitch = 0;
    }
  } else if (stickEdge && inT) {
    c.ceiling = true;
    c.ceilT = 0;
    c.ceilH0 = c.h;
    c.grounded = false;
    c.vH = 0;
    c.pitch = 0;
    c.spin = 0;
    c.flipRemaining = 0;
    c.flips = 0;
    c.bursts = 0;
    ev.push("ceil:on");
  }

  if (!c.ceiling) {
    if (c.grounded) {
      if (jumpEdge && c.sp >= C.SP_JUMP) {
        c.grounded = false;
        c.vH = C.JUMP_V;
        c.h = g.h;
        c.flips = 0;
        c.bursts = 0;
        jumpedNow = true;
        c.sp -= C.SP_JUMP;
        // keep holding: the launch turns straight into flight, no second press needed
        c.flyHeld = true;
        c.flyTime = 0;
        c.airPress = -1;
        ev.push("jump");
      } else if (g.h < c.h - 0.25) {
        c.grounded = false;
        c.vH = Math.abs(c.v) * c.lastSlope;
        ev.push("launch");
      } else {
        if (g.h > c.h + 0.05 && c.lastSlope === 0 && g.slope === 0) {
          c.v *= 0.96;
          ev.push("curb");
        }
        c.h = g.h;
        c.lastSlope = g.slope;
        c.pitch = 0;
        c.roll += (0 - c.roll) * Math.min(1, 10 * dt);
      }
    }
    if (!c.grounded) {
      // Space again in the air = backflip right away (a light hop then a press flips at once); keep that press
      // held and the jets carry on flying
      let flipNow = false;
      if (jumpEdge && !jumpedNow) {
        flipNow = true;
        c.airPress = 0;
      }
      if (c.airPress >= 0) {
        if (inp.jump) {
          c.airPress += dt;
          if (c.airPress >= C.TAP_MAX) {
            c.airPress = -1;
            c.flyHeld = true;
          }
        } else c.airPress = -1;
      }
      if (!inp.jump) c.flyHeld = false;
      // flip = rotation thrusters, like the demo: a launch burst up plus one full off-axis twist
      // (nose up and over while rolling toward the steered side) fitted into the airtime
      if (flipNow && c.flipRemaining < 0.5 && c.bursts < C.FLIP_MAX) {
        const above = Math.max(0, c.h - g.h);
        // the launch burst always adds its ~2.5 m, also from a hover at the hold-to-fly ceiling: a backflip at the
        // top of a flight goes higher than flight alone can
        const vLift = Math.max(
          Math.max(c.vH, 0),
          Math.min(Math.max(c.vH, 0) + C.FLIP_LIFT, C.FLIP_LIFT_CAP),
        );
        const tLand =
          (vLift + Math.sqrt(vLift * vLift + 2 * C.GRAVITY * above)) /
          C.GRAVITY;
        if (tLand >= C.FLIP_MIN_AIR) {
          if (c.bursts === 0) {
            const side = inp.steer === 0 ? -1 : -Math.sign(inp.steer); // A -> roll left (belly to the right)
            const a = C.TWIST_ANGLE;
            c.spinAxis = [side * Math.sin(a), 0, Math.cos(a)];
            c.spin = 0;
          }
          c.bursts++;
          c.vH = vLift;
          c.flipRemaining += Math.PI * 2;
          // shoot straight up for a beat first, then turn: the rotation is fitted into the airtime after that
          c.flipDelay = C.FLIP_LAUNCH;
          c.flipRate = C.clamp(
            c.flipRemaining /
              Math.max(0.05, tLand - C.FLIP_LAUNCH - C.FLIP_MARGIN),
            C.FLIP_RATE,
            C.FLIP_RATE_MAX,
          );
          if (c.v >= 0) c.v = Math.min(C.BOOST_SPEED, c.v + C.FLIP_FORWARD);
          ev.push("flipStart");
        }
      }
      // flying: Iron Man jets carry the car toward THRUST_MAX_H and hover there while held, burning fuel; with
      // the tank empty they only sputter into a slow descent
      if (inp.jump && c.flyHeld && c.holdT >= C.LAUNCH_HOLD) {
        c.flyTime += dt;
        const room = C.THRUST_MAX_H - Math.max(0, c.h - g.h);
        const vt =
          c.fuel > 0 ? C.clamp(room * 3, -1, C.THRUST_VMAX) : -C.FLY_SINK;
        c.fuel = Math.max(0, c.fuel - dt / C.FUEL_FLY_S);
        // the jets only push when the car is slower than the target climb (or sinking faster than allowed);
        // above it gravity works as usual, so a quick tap is exactly the ballistic launch hop
        if (c.vH < vt) {
          c.vH = Math.min(vt, c.vH + C.THRUST_ACC * dt);
          c.vH += C.GRAVITY * dt; // the jets carry the weight this step
        }
        c.thrusting = true;
        if (!c.thrustOn) {
          c.thrustOn = true;
          ev.push("thrust");
        }
      }
      // down off the ramp's lip: the jets brake the fall (unless the player flies it on the jets), as in the reveal
      c.retro = false;
      if (c.rampDrop && !c.thrusting) {
        const limit = -(C.DROP_TOUCH_V + C.DROP_K * Math.max(0, c.h - g.h));
        if (c.vH < limit) {
          c.vH = Math.min(limit, c.vH + C.DROP_ACC * dt);
          c.vH += C.GRAVITY * dt; // the jets carry the weight this step
          c.v *= 1 - C.DROP_DRAG * dt;
          if (!c.thrustOn) {
            c.thrustOn = true;
            ev.push("retro");
          }
          c.retro = true;
        }
      }
      c.vH -= C.GRAVITY * dt;
      c.h += c.vH * dt;
      if (c.flipDelay > 0) c.flipDelay -= dt;
      else if (c.flipRemaining > 0) {
        const dp = Math.min(c.flipRemaining, c.flipRate * dt);
        c.spin += dp;
        c.flipRemaining -= dp;
        if (c.flipRemaining <= 1e-6) {
          c.flipRemaining = 0;
          c.flips++;
        }
      }
      if (c.roll !== 0) {
        // (off the ramp the side jets roll it upright steadily, a balance rather than a flick)
        const step = (Math.PI / (c.rampDrop ? C.DROP_ROLL_S : 0.45)) * dt;
        if (Math.abs(c.roll) <= step) c.roll = 0;
        else c.roll -= Math.sign(c.roll) * step;
      }
      const roofH = inT ? ceilY : (env.ceiling?.(c.x, c.y, c.h) ?? Infinity);
      if (c.h > roofH) {
        c.h = roofH;
        c.vH = Math.min(0, c.vH);
      } else if (c.h <= g.h) {
        c.h = g.h;
        c.grounded = true;
        c.vH = 0;
        c.lastSlope = g.slope;
        c.thrustOn = false;
        c.rampDrop = c.retro = false;
        c.flipDelay = 0;
        c.flyTime = 0;
        c.flyHeld = false;
        c.airPress = -1;
        const tilt = uprightTilt(c);
        const completed =
          c.flips +
          (c.flipRemaining > 0 && c.flipRemaining < C.LAND_TOL ? 1 : 0);
        c.flips = 0;
        c.bursts = 0;
        c.flipRemaining = 0;
        if (tilt < C.LAND_TOL) {
          c.pitch = 0;
          c.roll = 0;
          c.spin = 0;
          if (completed > 0) {
            c.sp = Math.min(C.SP_MAX, c.sp + C.SP_FLIP * completed);
            ev.push("flip:" + completed);
          }
          ev.push(tilt < 0.17 ? "land:clean" : "land:ok");
        } else {
          // a botched landing is never a wipe-out: it slams back onto its wheels and loses most of its speed
          c.pitch = 0;
          c.roll = 0;
          c.spin = 0;
          c.v *= 0.35;
          c.vLat = 0;
          ev.push("land:rough");
        }
      }
    }
  }
  c.jumpLatch = inp.jump;
  c.stickLatch = inp.stick;
  return ev;
}

/**
 * Riding the event hook ramp, as in the reveal: the car sticks to the concrete up the curve, the vertical and the curl
 * past vertical, losing speed to gravity (the motor still pushes while the accelerator is held). Too slow and it rolls
 * back down to the foot; over the lip the thrusters kill the climb and it leaves upside down heading back over the
 * run-in, rolls upright and comes down in front of the ramp (a counted flip).
 */
function stepWall(
  c: Car,
  inp: Input,
  dt: number,
  r: WallRamp,
  ev: string[],
): string[] {
  const wr = c.wall!;
  const before = rampPoint(wr.s);
  wr.v +=
    ((inp.accel ? C.ACCEL : 0) - C.GRAVITY * Math.sin(before.th) * 1.1) * dt;
  wr.s += wr.v * dt;
  wr.w = C.clamp(
    wr.w + C.clamp(inp.steer, -1, 1) * 3 * dt,
    -(RAMP.HALF - 0.9),
    RAMP.HALF - 0.9,
  );
  const heading = Math.atan2(r.uy, r.ux);
  c.px = c.x;
  c.py = c.y;
  c.jumpLatch = inp.jump;
  c.stickLatch = inp.stick;
  if (wr.s <= 0 && wr.v <= 0) {
    // rolled back down: off the foot backwards
    const q = rampWorld(r, 0, wr.w);
    c.wall = null;
    c.x = q.x;
    c.y = q.y;
    c.h = C.CURB_H;
    c.heading = heading;
    c.v = wr.v;
    c.pitch = 0;
    c.grounded = true;
    c.lastSlope = 0;
    c.wallGrace = 0.3;
    return ev;
  }
  const s = Math.min(wr.s, RAMP_END);
  const p = rampPoint(s);
  // the body's centre sits half a body height off the surface, along the surface normal
  const half = C.CAR_H / 2;
  const q = rampWorld(r, p.u - Math.sin(p.th) * half, wr.w);
  c.x = q.x;
  c.y = q.y;
  c.h = C.CURB_H + p.z + (Math.cos(p.th) - 1) * half; // the event ground is paved at kerb height
  c.heading = heading;
  c.pitch = p.th;
  c.roll = 0;
  c.spin = 0;
  c.yawVis = 0;
  c.vLat = 0;
  c.vH = 0;
  c.v = wr.v;
  c.grounded = false;
  c.ceiling = false;
  if (wr.s >= RAMP_END) {
    // over the lip: leave along the surface, thrusters capping the speed, upside down and heading back over the run-in
    const vL = Math.min(wr.v, 15);
    c.wall = null;
    c.wallGrace = 0.9;
    c.heading = heading + Math.PI;
    c.v = -vL * Math.cos(p.th);
    c.vH = vL * Math.sin(p.th);
    c.pitch = 0;
    c.roll = Math.PI; // rights itself in the air (the roll recovery in stepCar)
    c.spin = 0;
    c.flips = 1;
    c.rampDrop = true;
    // one more flip is allowed on the way down (Space again): two in one jump, if it is all the way round by the floor
    c.bursts = C.FLIP_MAX - 1;
    c.spinAxis = [0, 0, 1];
    c.flipRemaining = 0;
    c.flyHeld = false;
    c.airPress = -1;
    c.thrustOn = false;
    ev.push("flipStart", "walltop");
  }
  return ev;
}
