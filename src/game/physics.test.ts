import { describe, expect, it } from "vitest";
import * as C from "./constants";
import {
  type Env,
  type Input,
  NO_INPUT,
  crashCar,
  newCar,
  uprightTilt,
  placeCar,
  stepCar,
} from "./physics";

const mk = (
  tunnel: boolean,
  ground?: (x: number, y: number) => { h: number; slope: number },
): Env => ({
  rnd: () => 0.5,
  ground: ground ?? (() => ({ h: 0, slope: 0 })),
  tunnel: () => tunnel,
  respawn: (c) => placeCar(c, c.x, c.y, 0, 0),
});
const flat = mk(false);
const tunnel = mk(true);
const DT = 1 / 120;
const GAS: Partial<Input> = { accel: true };

function run(
  car: ReturnType<typeof newCar>,
  env: Env,
  seconds: number,
  inp: (t: number) => Partial<Input>,
): string[] {
  const ev: string[] = [];
  for (let t = 0; t < seconds; t += DT)
    ev.push(...stepCar(car, { ...NO_INPUT, ...inp(t) }, DT, env));
  return ev;
}

describe("car physics (Raycity layout)", () => {
  it("only moves while the accelerator is held, coasts down when released, brakes and reverses", () => {
    const c = newCar(0, 0, 0);
    run(c, flat, 1, () => ({}));
    expect(c.v).toBe(0);
    run(c, flat, 4, () => GAS);
    expect(c.v).toBeCloseTo(C.BASE_SPEED, 0);
    run(c, flat, 2, () => ({}));
    expect(c.v).toBeLessThan(C.BASE_SPEED - 8);
    run(c, flat, 4, () => ({ brake: true }));
    expect(c.v).toBeLessThan(0);
    expect(c.v).toBeGreaterThanOrEqual(-C.REVERSE_MAX);
  });

  it("steering is snappy; Shift+steer drifts and earns SP", () => {
    const a = newCar(0, 0, 0);
    run(a, flat, 3, () => GAS);
    run(a, flat, 0.3, () => ({ ...GAS, steer: 1 }));
    expect(a.heading).toBeGreaterThan(0.25);
    const b = newCar(0, 0, 0);
    run(b, flat, 3, () => GAS);
    b.sp = 20;
    const ev = run(b, flat, 1, () => ({ ...GAS, steer: 1, drift: true }));
    expect(ev).toContain("drift");
    expect(b.heading).toBeGreaterThan(1.5);
    expect(b.sp).toBeGreaterThan(30);
  });

  it("booster needs the accelerator and drains SP, then switches off when empty", () => {
    const c = newCar(0, 0, 0);
    run(c, flat, 3, () => GAS);
    const ev = run(c, flat, 1, () => ({ ...GAS, boost: true }));
    expect(ev).toContain("boost:3");
    expect(c.v).toBeGreaterThan(C.BASE_SPEED + 5);
    expect(c.sp).toBeLessThan(80);
    c.sp = 1;
    const ev2 = run(c, flat, 0.5, () => ({ ...GAS, boost: true }));
    expect(ev2).toContain("boost:off");
  });

  it("jumps high and far; the rotation thrusters fit one full turn into the remaining airtime", () => {
    const c = newCar(0, 0, 0);
    run(c, flat, 3, () => GAS);
    let peak = 0,
      maxTilt = 0,
      hPress = -1,
      riseBeforeTurn = -1,
      x0 = c.x;
    const ev = run(c, flat, 2.5, (t) => {
      peak = Math.max(peak, c.h);
      maxTilt = Math.max(maxTilt, uprightTilt(c));
      if (hPress < 0 && c.bursts > 0) hPress = c.h;
      if (riseBeforeTurn < 0 && c.spin > 0.01) riseBeforeTurn = c.h - hPress;
      return { ...GAS, jump: t < DT || (t > 0.2 && t < 0.25) }; // tap, then 2nd tap
    });
    expect(ev).toContain("jump");
    expect(ev).toContain("flipStart");
    expect(peak).toBeGreaterThan(3.8); // the flip is a launch: shoots up ~2.5 m above the hop, not a spin in place
    expect(peak).toBeLessThan(5);
    expect(riseBeforeTurn).toBeGreaterThan(0.8); // climbs before the rotation starts
    expect(c.x - x0).toBeGreaterThan(45); // soars forward, not a hop in place
    expect(maxTilt).toBeGreaterThan(2.5); // went through upside down on the off-axis twist
    expect(c.spinAxis[0]).not.toBe(0); // twisted (roll component), not a plain backflip
    expect(ev.some((e) => e === "flip:1")).toBe(true);
    expect(c.state).toBe("drive");
    expect(c.spin).toBe(0);
    expect(uprightTilt(c)).toBeLessThan(1e-6);
    // the launch press held down turns straight into flight: climbs to ~6x the hop (~13.8 m), hovers while held
    // burning flight fuel (not SP); with the tank empty after FUEL_FLY_S s it sinks slowly to a clean landing,
    // and the tank refills on the road
    const h = newCar(0, 0, 0);
    run(h, flat, 3, () => GAS);
    let peakH = 0,
      thrustTime = 0,
      minSp = h.sp,
      hHover = 0,
      hSink = 0,
      emptyAt = -1;
    const tHover = C.FUEL_FLY_S - 0.6,
      tSink = C.FUEL_FLY_S + 2.4;
    const evH = run(h, flat, 18, (t) => {
      peakH = Math.max(peakH, h.h);
      minSp = Math.min(minSp, h.sp);
      if (h.thrusting) thrustTime += DT;
      if (emptyAt < 0 && h.fuel <= 0) emptyAt = t;
      if (Math.abs(t - tHover) < DT / 2) hHover = h.h;
      if (Math.abs(t - tSink) < DT / 2) hSink = h.h;
      return { ...GAS, jump: t < 13 };
    });
    expect(evH).toContain("thrust");
    expect(peakH).toBeGreaterThan(C.THRUST_MAX_H - 0.3);
    expect(peakH).toBeLessThan(C.THRUST_MAX_H + 0.4); // 6x the 2.3 m hop, no higher
    expect(C.THRUST_MAX_H).toBeGreaterThan(C.SKY_H + 2); // high enough to land on the skyway deck
    expect(hHover).toBeGreaterThan(C.THRUST_MAX_H - 0.5); // still hovering just before the tank runs dry
    expect(emptyAt).toBeGreaterThan(C.FUEL_FLY_S - 0.5);
    expect(emptyAt).toBeLessThan(C.FUEL_FLY_S + 0.5);
    expect(hSink).toBeLessThan(hHover - 3); // then sinking slowly although Space is still held
    expect(hSink).toBeGreaterThan(0.5);
    expect(thrustTime).toBeGreaterThan(9);
    expect(minSp).toBeGreaterThan(C.SP_MAX - C.SP_JUMP - 1); // only the launch costs SP; flight burns fuel
    expect(evH.some((e) => e.startsWith("crash:"))).toBe(false);
    expect(evH).not.toContain("flipStart");
    expect(h.state).toBe("drive");
    expect(h.grounded).toBe(true);
    const f0 = h.fuel;
    run(h, flat, 3, () => GAS);
    expect(h.fuel).toBeCloseTo(f0 + 3 * C.FUEL_REFILL, 2);
    // a light hop, then Space again early on the way up: backflip at once (not only after reaching the top),
    // and holding that second press keeps the jets flying
    const a2 = newCar(0, 0, 0);
    run(a2, flat, 3, () => GAS);
    let peakA = 0,
      flipAt = -1;
    const evA = run(a2, flat, 6, (t) => {
      peakA = Math.max(peakA, a2.h);
      if (flipAt < 0 && a2.bursts > 0) flipAt = t;
      return { ...GAS, jump: t < 0.05 || (t > 0.2 && t < 2.6) };
    });
    expect(evA).toContain("flipStart");
    expect(flipAt).toBeLessThan(0.22); // flips on the press, ~1 m up
    expect(evA).toContain("thrust");
    expect(peakA).toBeGreaterThan(C.THRUST_MAX_H - 0.6);
    expect(evA.some((e) => e.startsWith("crash:"))).toBe(false);
    // a bare tap is a low hop (~2.3 m): clears a sedan roof, not a bus
    const tap = newCar(0, 0, 0);
    run(tap, flat, 3, () => GAS);
    let peakT = 0;
    run(tap, flat, 2, (t) => {
      peakT = Math.max(peakT, tap.h);
      return { ...GAS, jump: t < DT };
    });
    expect(peakT).toBeGreaterThan(2);
    expect(peakT).toBeLessThan(2.5);
    // rotation pressed at the apex still climbs a little (thruster burst)
    const r1 = newCar(0, 0, 0);
    run(r1, flat, 3, () => GAS);
    let apexH = 0,
      peakR = 0,
      fired = false;
    const evR = run(r1, flat, 4, (t) => {
      peakR = Math.max(peakR, r1.h);
      const now = !fired && t > 0.3 && !r1.grounded && r1.vH < 0;
      if (now) {
        fired = true;
        apexH = r1.h;
      }
      return { ...GAS, jump: t < DT || now };
    });
    expect(evR).toContain("flipStart");
    expect(peakR).toBeGreaterThan(apexH + 2); // the launch lifts it ~2.5 m above the apex
    // max combo: fly up to the hold-to-fly ceiling, let go, flip: the flip burst still climbs ~2.5 m above it
    const m = newCar(0, 0, 0);
    run(m, flat, 3, () => GAS);
    let peakM = 0,
      hoverH = 0;
    const evM = run(m, flat, 7, (t) => {
      peakM = Math.max(peakM, m.h);
      if (t < 2.8) hoverH = m.h;
      return { ...GAS, jump: t < 2.8 || (t > 2.85 && t < 2.9) };
    });
    expect(hoverH).toBeGreaterThan(C.THRUST_MAX_H - 0.5);
    expect(evM).toContain("flipStart");
    expect(peakM).toBeGreaterThan(hoverH + 1.8);
    expect(peakM).toBeLessThan(hoverH + 3.5);
    expect(m.state).toBe("drive");
    expect(evR.some((e) => e === "flip:1")).toBe(true);
    expect(r1.state).toBe("drive");
    // press near the apex: the burst buys airtime and the turn is fitted into it, lands clean
    const d = newCar(0, 0, 0);
    run(d, flat, 3, () => GAS);
    let apex = false;
    const ev2 = run(d, flat, 3.5, (t) => {
      const now = !apex && t > 0.3 && !d.grounded && d.vH < 0;
      if (now) apex = true;
      return { ...GAS, jump: t < DT || now };
    });
    expect(apex).toBe(true);
    expect(ev2).toContain("flipStart");
    expect(ev2.some((e) => e.startsWith("crash:"))).toBe(false);
    expect(ev2.some((e) => e === "flip:1")).toBe(true);
    // very late (about to land): the burst lifts it back up and the turn still completes
    const e = newCar(0, 0, 0);
    run(e, flat, 3, () => GAS);
    let late = false;
    const ev4 = run(e, flat, 3.5, (t) => {
      const now = !late && t > 0.5 && !e.grounded && e.vH < 0 && e.h < 0.45;
      if (now) late = true;
      return { ...GAS, jump: t < DT || now };
    });
    expect(late).toBe(true);
    expect(ev4.filter((x) => x === "flipStart").length).toBe(1);
    expect(ev4.some((x) => x.startsWith("crash:"))).toBe(false);
    expect(ev4.some((x) => x === "flip:1")).toBe(true);
    // flips per jump are capped
    const f = newCar(0, 0, 0);
    run(f, flat, 3, () => GAS);
    let presses = 0,
      lastPress = -1;
    const ev3 = run(f, flat, 5, (t) => {
      const press =
        t < 0.05 ||
        (!f.grounded && f.flipRemaining < 0.5 && t - lastPress > 0.3);
      if (press && t - lastPress > 0.3) {
        lastPress = t;
        presses++;
      }
      return { ...GAS, jump: press };
    });
    expect(presses).toBeGreaterThanOrEqual(C.FLIP_MAX + 1);
    expect(ev3.filter((e) => e === "flipStart").length).toBeLessThanOrEqual(
      C.FLIP_MAX,
    );
    expect(ev3.filter((e) => e === "flipStart").length).toBeGreaterThan(0);
  });

  it("respawns after the crash replay", () => {
    const c = newCar(0, 0, 0);
    run(c, flat, 3, () => GAS);
    expect(crashCar(c, "wall", flat.rnd)).toBe("crash:wall");
    run(c, flat, C.CRASH_REPLAY + 0.5, () => GAS);
    expect(c.crashes).toBe(1);
    expect(c.state).toBe("drive");
    expect(c.grounded).toBe(true);
  });

  it("E toggles the tunnel ceiling: one tap sticks, it holds without E, the next tap drops and rights it", () => {
    const c = newCar(0, 0, 0);
    run(c, tunnel, 2, () => GAS);
    const tap = (t: number) => ({ ...GAS, stick: t < 0.05 });
    const ev = run(c, tunnel, 0.6, tap);
    expect(ev).toContain("ceil:on");
    expect(c.ceiling).toBe(true);
    expect(c.h).toBeCloseTo(C.CEIL_H - C.CAR_H, 1); // up there within a fraction of a second
    const evHold = run(c, tunnel, 6, () => GAS); // E released: stays on the ceiling
    expect(evHold).not.toContain("ceil:off");
    expect(c.ceiling).toBe(true);
    const ev2 = run(c, tunnel, 1.5, tap);
    expect(ev2).toContain("ceil:off");
    expect(ev2.some((e) => e.startsWith("land:"))).toBe(true);
    expect(ev2.some((e) => e.startsWith("crash:"))).toBe(false);
    expect(c.state).toBe("drive");
    // outside a tunnel E does nothing
    const c2 = newCar(0, 0, 0);
    expect(run(c2, flat, 0.5, tap)).not.toContain("ceil:on");
  });

  it("sidestep (double tap) hops sideways and costs SP", () => {
    const c = newCar(0, 0, 0);
    run(c, flat, 3, () => GAS);
    const sp0 = c.sp;
    const ev = run(c, flat, 0.6, (t) => ({
      ...GAS,
      sidestep: t < 0.01 ? 1 : 0,
    }));
    expect(ev).toContain("sidestep");
    expect(c.y).toBeGreaterThan(1.5);
    expect(c.sp).toBeLessThan(sp0);
  });

  it("ramp launches the car", () => {
    const ramp = mk(false, (x) =>
      x >= 80 && x <= 92
        ? { h: ((x - 80) / 12) * 2.2, slope: 2.2 / 12 }
        : { h: 0, slope: 0 },
    );
    const c = newCar(0, 0, 0);
    const ev = run(c, ramp, 6, () => GAS);
    expect(ev).toContain("launch");
    expect(ev.some((e) => e.startsWith("land:"))).toBe(true);
  });
});
