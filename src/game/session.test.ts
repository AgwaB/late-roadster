import { describe, expect, it } from "vitest";
import { buildCity } from "./city";
import { NO_INPUT, type Input } from "./physics";
const GAS: Input = { ...NO_INPUT, accel: true };
import * as C from "./constants";
import { Session, clockString, gradeOf } from "./session";
import { NPC_DIMS, npcSpan } from "./traffic";

/** A session with one cruising NPC left on the map, the player parked dist m behind it in its lane. */
function rearEnd(closing: number, dist = 8) {
  const s = new Session(city, 7, 0);
  for (let i = 0; i < 30; i++) s.step(DT, NO_INPUT); // let the start invulnerability settle
  const n = s.traffic.npcs.find(
    (o) =>
      !o.dead &&
      o.behavior === "cruise" &&
      !o.turn &&
      o.s > 60 &&
      o.edge.len - o.s > 90,
  )!;
  for (const o of s.traffic.npcs) if (o !== n) o.dead = true;
  n.timer = 1e9; // no ambient backflip during the test
  n.anim = null;
  const car = s.car;
  const back = n.halfL + C.CAR_HALF_L + dist;
  car.x = n.x - Math.cos(n.heading) * back;
  car.y = n.y - Math.sin(n.heading) * back;
  car.heading = n.heading;
  car.v = n.v + closing;
  car.invuln = 0;
  s.bumpCd = 0;
  return { s, n, car };
}

const city = buildCity(1);
const DT = 1 / 60;

describe("session", () => {
  it("clock runs from 8:58:30 to 9:00:00", () => {
    expect(clockString(0)).toBe("8:58:30");
    expect(clockString(90)).toBe("9:00:00");
  });

  it("grades", () => {
    expect(gradeOf(20, 0, true)).toBe("S");
    expect(gradeOf(20, 1, true)).toBe("A");
    expect(gradeOf(7, 0, true)).toBe("B");
    expect(gradeOf(1, 3, true)).toBe("C");
    expect(gradeOf(0, 0, false)).toBe("LATE");
  });

  it("runs upside-down traffic along the tunnel ceiling, and it blocks a player driving up there", () => {
    const s = new Session(city, 7, 0);
    expect(s.ceilingCars.length).toBeGreaterThan(8);
    for (const c of s.ceilingCars) {
      expect(c.yOff).toBe(C.CEIL_H);
      expect(c.roll).toBeCloseTo(Math.PI);
    }
    const x0 = s.ceilingCars.map((c) => c.x);
    for (let i = 0; i < 600; i++) s.step(DT, NO_INPUT);
    s.ceilingCars.forEach((c, i) => {
      expect(Math.abs(c.x)).toBeLessThanOrEqual(C.TUNNEL_HALF_X);
      expect(c.x).not.toBe(x0[i]);
    });
    // park the player on the ceiling right in front of an oncoming ceiling car
    const target = s.ceilingCars[0];
    const car = s.car;
    car.x = target.x + target.dir * 6;
    car.y = target.y;
    car.heading = target.heading + Math.PI;
    car.v = 20;
    car.ceiling = true;
    car.grounded = false;
    car.h = C.CEIL_H - C.CAR_H;
    car.roll = Math.PI;
    car.invuln = 0;
    s.bumpCd = 0;
    const ev: string[] = [];
    for (let i = 0; i < 30 && !ev.some((e) => /ceilingcar/.test(e)); i++)
      ev.push(...s.step(DT, { ...NO_INPUT, accel: true }));
    expect(ev.some((e) => /ceilingcar/.test(e))).toBe(true);
  });

  it("ramming traffic is a physical collision, not a wipe-out: both cars are pushed and nobody overlaps", () => {
    const { s, n, car } = rearEnd(25);
    const v0 = n.v;
    let vMax = 0;
    const ev: string[] = [];
    for (let i = 0; i < 90; i++) {
      ev.push(...s.step(DT, NO_INPUT));
      vMax = Math.max(vMax, n.v);
    }
    expect(ev.some((e) => e.startsWith("hit:"))).toBe(true);
    expect(ev.some((e) => e.startsWith("crash:"))).toBe(false);
    expect(car.state).toBe("drive");
    expect(car.crashes).toBe(0);
    expect(vMax).toBeGreaterThan(v0 + 2); // shoved forward (then eases back to its cruise speed)
    expect(car.v).toBeLessThan(n.v); // and we bounced off
    const gap =
      (n.x - car.x) * Math.cos(n.heading) + (n.y - car.y) * Math.sin(n.heading);
    expect(gap).toBeGreaterThan(n.halfL + C.CAR_HALF_L - 0.05); // bodies separated
  });

  it("a car flipping overhead does not hit a player driving underneath", () => {
    const { s, n } = rearEnd(25);
    n.anim = { kind: "flip", t: 0.45, dur: 1.3 }; // near the top of its arc
    n.timer = 1e9;
    const ev: string[] = [];
    for (let i = 0; i < 12; i++) ev.push(...s.step(DT, NO_INPUT));
    expect(npcSpan(n).bottom).toBeGreaterThan(C.CAR_ROOF);
    expect(ev.some((e) => /^(hit|bump):/.test(e))).toBe(false);
  });

  it("stunting cars never sink below the road (bus flip, botched roof landing)", () => {
    const { s, n } = rearEnd(0, 400);
    Object.assign(n, { kind: "bus", ...NPC_DIMS.bus });
    for (const kind of ["flip", "fail", "hop", "knock"] as const) {
      n.anim = { kind, t: 0, dur: kind === "fail" ? 2.6 : 1.3 };
      for (let i = 0; i < 200 && n.anim; i++) {
        s.step(DT, NO_INPUT);
        expect(npcSpan(n).bottom).toBeGreaterThan(-1e-6);
      }
    }
  });

  it("E beside the skyway climbs onto the deck, it drives along up there, and E drops back to the road", () => {
    const s = new Session(city, 7, 0);
    for (let i = 0; i < 30; i++) s.step(DT, NO_INPUT);
    s.traffic.npcs.forEach((n) => (n.dead = true));
    const car = s.car;
    car.x = 340;
    car.y = -C.laneOffset(2); // eastbound outer lane, beside the deck
    car.heading = 0;
    car.v = 20;
    car.invuln = 0;
    const tap = (k: number) => ({ ...GAS, stick: k === 0 });
    const ev: string[] = [];
    for (let k = 0; k < 90; k++) ev.push(...s.step(DT, tap(k)));
    expect(ev).toContain("skyway:up");
    expect(car.grounded).toBe(true);
    expect(car.h).toBeCloseTo(C.SKY_H, 3);
    expect(Math.abs(car.y)).toBeLessThan(C.SKY_HALF);
    // drives along the deck (over the x = 400 crossing) without falling through
    const ev2: string[] = [];
    for (let k = 0; k < 120; k++) ev2.push(...s.step(DT, GAS));
    expect(car.x).toBeGreaterThan(420);
    expect(car.h).toBeCloseTo(C.SKY_H, 3);
    expect(ev2.some((e) => e.startsWith("crash:"))).toBe(false);
    // E again: hops over the parapet and lands on the road
    const ev3: string[] = [];
    for (let k = 0; k < 90; k++) ev3.push(...s.step(DT, tap(k)));
    expect(ev3).toContain("skyway:down");
    expect(car.h).toBeLessThan(0.2);
    expect(car.grounded).toBe(true);
    expect(Math.abs(car.y)).toBeGreaterThan(C.SKY_HALF);
    expect(car.state).toBe("drive");
  });

  it("is deterministic for the same seed and run index", () => {
    const a = new Session(city, 42, 1),
      b = new Session(city, 42, 1);
    for (let i = 0; i < 600; i++) {
      const inp = { ...GAS, steer: Math.sin(i / 40) * 0.5 };
      a.step(DT, inp);
      b.step(DT, inp);
    }
    expect(a.car.x).toBe(b.car.x);
    expect(a.car.crashes).toBe(b.car.crashes);
  });

  it("starts on a lane facing down its route and ends with a result within 90s", () => {
    const s = new Session(city, 7, 3);
    expect(s.car.heading).toBeCloseTo(s.layout.start.heading, 9);
    let steps = 0;
    while (s.state === "run" && steps < 120 * 60) {
      s.step(DT, GAS);
      steps++;
    }
    expect(s.state).toBe("result");
    expect(s.t).toBeLessThanOrEqual(90.05);
  });

  it("hands-off on every commute never throws", () => {
    for (let i = 0; i < city.commutes.length; i++) {
      const s = new Session(city, 1, i, i);
      while (s.state === "run") s.step(DT, GAS);
      expect(["S", "A", "B", "C", "LATE"]).toContain(s.result!.grade);
    }
  });
});
