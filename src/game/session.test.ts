import { describe, expect, it } from "vitest";
import { buildCity } from "./city";
import { NO_INPUT, type Input } from "./physics";
const GAS: Input = { ...NO_INPUT, accel: true };
import * as C from "./constants";
import { Session, clockString, gradeOf } from "./session";
import { NPC_DIMS, npcSpan } from "./traffic";
import { cartReturn, martSite } from "./landmarks";

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

  it("the skyway: up the west ramp from the inner lane, along the deck and down the east ramp; the parapets and the ramps' sides hold, a hop clears a parapet", () => {
    const s = new Session(city, 7, 0);
    for (let i = 0; i < 30; i++) s.step(DT, NO_INPUT);
    const clear = () => s.traffic.npcs.forEach((n) => (n.dead = true));
    s.props = s.props.filter((p) => !p.z0); // the deck's jam has its own test
    const sw = city.skyway;
    const car = s.car;
    const put = (o: Partial<typeof car>) =>
      Object.assign(car, { vLat: 0, vH: 0, invuln: 0, ...o });
    put({ x: sw.x0 - 15, y: -C.laneOffset(0), heading: 0, v: 30, h: 0 });
    const ev: string[] = [];
    let peak = 0,
      air = 0,
      onDeck = false;
    for (let k = 0; k < 1200 && car.x < sw.x1 + 15; k++) {
      clear();
      ev.push(...s.step(DT, GAS));
      peak = Math.max(peak, car.h);
      if (!car.grounded) air++;
      if (car.x > 480 && car.x < 520)
        onDeck ||= car.grounded && Math.abs(car.h - C.SKY_H) < 1e-6;
    }
    expect(car.x).toBeGreaterThan(sw.x1 + 15);
    expect(onDeck).toBe(true);
    expect(peak).toBeLessThan(C.SKY_H + 1e-6); // over both crests on its wheels, never launched
    expect(air).toBe(0);
    expect(car.h).toBeCloseTo(0, 3);
    expect(ev.some((e) => /^(crash|hit|launch|curb|scrape)/.test(e))).toBe(
      false,
    );
    // up on the deck, steering into a parapet: it scrapes along it and stays up there
    put({ x: 450, y: -3, heading: -0.25, v: 30, h: C.SKY_H, grounded: true });
    for (let k = 0; k < 90; k++) {
      clear();
      s.step(DT, GAS);
    }
    expect(car.h).toBeCloseTo(C.SKY_H, 3);
    expect(Math.abs(car.y)).toBeLessThan(sw.half);
    // a hop over it drops to the road below, still driving
    put({ x: 450, y: -3, heading: -0.4, v: 25, h: C.SKY_H, grounded: true });
    let left = false;
    for (let k = 0; k < 240 && !(left && car.grounded); k++) {
      clear();
      s.step(DT, { ...GAS, jump: k < 2 });
      left ||= Math.abs(car.y) > sw.half + C.CAR_HALF_W;
    }
    expect(left).toBe(true);
    expect(car.h).toBeLessThan(0.2);
    expect(car.state).toBe("drive");
    // on the road beside a ramp, steering into it: its side wall keeps the car off
    put({ x: sw.x0 + 70, y: -C.laneOffset(1) - 0.5, heading: 0.35, v: 25 });
    Object.assign(car, { h: 0, grounded: true });
    for (let k = 0; k < 60; k++) {
      clear();
      s.step(DT, GAS);
      expect(car.h).toBeLessThan(0.2);
      expect(Math.abs(car.y)).toBeGreaterThan(sw.rampHalf + 0.5);
    }
    // under the deck in the inner lane, heading west: the ramp's concrete end stops it
    put({
      x: sw.x0 + sw.ramp + 25,
      y: C.laneOffset(0),
      heading: Math.PI,
      v: 25,
    });
    Object.assign(car, { h: 0, grounded: true });
    for (let k = 0; k < 120; k++) {
      clear();
      s.step(DT, GAS);
      const inside =
        car.x < sw.x0 + sw.ramp - 1 && Math.abs(car.y) < sw.rampHalf;
      expect(inside && car.h < 1).toBe(false);
    }
  });

  it("the jam up on the skyway deck: a roof to stomp from above, solid on the deck, nothing to a car under the deck", () => {
    const s = new Session(city, 7, 0);
    for (let i = 0; i < 30; i++) s.step(DT, NO_INPUT);
    const jam = s.props.filter((p) => p.z0 === C.SKY_H);
    expect(jam.length).toBeGreaterThan(20);
    const p = jam[0];
    const cx = (p.box.x0 + p.box.x1) / 2,
      cy = (p.box.y0 + p.box.y1) / 2;
    const car = s.car;
    const clear = () => s.traffic.npcs.forEach((n) => (n.dead = true));
    // coming down on its roof: a stomp
    Object.assign(car, {
      x: cx,
      y: cy,
      heading: p.heading,
      h: C.SKY_H + p.h + 0.5,
      v: 5,
      vH: -4,
      vLat: 0,
      grounded: false,
      invuln: 0,
    });
    const ev: string[] = [];
    for (let k = 0; k < 30; k++) {
      clear();
      ev.push(...s.step(DT, NO_INPUT));
    }
    expect(ev).toContain("stomp");
    // driving into it along the deck: a bounce, never a wipe-out, and not through it
    const s2 = new Session(city, 7, 0);
    for (let i = 0; i < 30; i++) s2.step(DT, NO_INPUT);
    const p2 = s2.props.find((o) => o.id === p.id)!;
    Object.assign(s2.car, {
      x: p2.box.x0 - C.CAR_HALF_L - 6,
      y: (p2.box.y0 + p2.box.y1) / 2,
      heading: 0,
      h: C.SKY_H,
      v: 20,
      vLat: 0,
      grounded: true,
      invuln: 0,
    });
    const ev2: string[] = [];
    for (let k = 0; k < 60; k++) {
      s2.traffic.npcs.forEach((n) => (n.dead = true));
      ev2.push(...s2.step(DT, GAS));
    }
    expect(ev2.some((e) => e.startsWith("crash"))).toBe(false);
    expect(s2.car.x).toBeLessThan(p2.box.x0);
    // under the deck, right below it: nothing there
    const s3 = new Session(city, 7, 0);
    Object.assign(s3.car, { x: cx, y: cy, h: 0, heading: 0 });
    expect(s3["poseBlocked"](s3.car)).toBe(false);
  });

  it("CART RETURN at ORBIT MART fills the tank once a run", () => {
    const s = new Session(city, 7, 0);
    const site = martSite(city)!;
    const box = cartReturn(site);
    Object.assign(s.car, {
      x: (box.x0 + box.x1) / 2,
      y: (box.y0 + box.y1) / 2,
      h: C.CURB_H,
      v: 0,
      fuel: 0.1,
      grounded: true,
    });
    const ev = s.step(DT, NO_INPUT);
    expect(ev).toContain("cart");
    expect(s.car.fuel).toBeCloseTo(1, 5);
    s.car.fuel = 0.1;
    const ev2: string[] = [];
    for (let k = 0; k < 10; k++) ev2.push(...s.step(DT, NO_INPUT));
    expect(ev2).not.toContain("cart");
  });

  it("passing a ceiling car while driving the ceiling is an UPSIDE-DOWN OVERTAKE (VIEWS), and none loops round onto the player", () => {
    const s = new Session(city, 7, 0);
    for (let i = 0; i < 30; i++) s.step(DT, NO_INPUT);
    s.traffic.npcs.forEach((n) => (n.dead = true));
    // keep one eastbound car in lane 0, the player on the ceiling a lane over, 15 m behind it and faster
    const c = s.ceilingCars.find((o) => o.dir > 0 && o.lane === 0)!;
    s.ceilingCars = [c];
    c.x = -60;
    const car = s.car;
    Object.assign(car, {
      x: -75,
      y: c.y - C.LANE_W,
      heading: 0,
      v: 40,
      vLat: 0,
      h: C.CEIL_H - C.CAR_H,
      grounded: false,
      ceiling: true,
      ceilT: 1,
      ceilH0: 0,
      roll: Math.PI,
      invuln: 0,
    });
    const ev: string[] = [];
    for (let k = 0; k < 120; k++) ev.push(...s.step(DT, GAS));
    expect(ev.filter((e) => e === "overtake")).toHaveLength(1);
    expect(ev.some((e) => e.startsWith("views:8000"))).toBe(true);
    // a car looping round from the far mouth onto a player up there stays out of the way until they are clear
    const lim = C.TUNNEL_HALF_X - 6;
    Object.assign(car, { x: -lim + 5, y: c.y });
    c.x = lim - 0.01;
    c.dead = false;
    s["stepCeiling"](0.05);
    expect(c.dead).toBe(true);
    Object.assign(car, { x: 0 });
    s["stepCeiling"](0.05);
    expect(c.dead).toBe(false);
  });

  it("road events reach the player: vehicles spawned past the next junction are still there, the ambulance catches up", () => {
    // mid-block on a plain eastbound row (y = -400), where 150 m ahead is already the next block
    const fresh = () => {
      const s = new Session(city, 7, 0);
      for (let i = 0; i < 30; i++) s.step(DT, NO_INPUT);
      s.traffic.npcs.forEach((n) => (n.dead = true));
      Object.assign(s.car, {
        x: 300,
        y: -400 - C.laneOffset(1),
        heading: 0,
        v: 40,
        vLat: 0,
        invuln: 0,
      });
      return s;
    };
    for (const kind of ["suddenBus", "camper"] as const) {
      const s = fresh();
      expect(s.forceEvent(kind)).toBe(true);
      const n = s.traffic.npcs.find((o) => !o.dead && o.behavior === kind)!;
      expect(n).toBeDefined();
      let met = false;
      for (let k = 0; k < 8 * 120 && !met; k++) {
        s.step(DT, GAS);
        if (n.dead) break;
        met = Math.hypot(n.x - s.car.x, n.y - s.car.y) < 30;
      }
      expect(met).toBe(true); // alive when the player got to it
      if (kind === "suddenBus") expect(n.braking).toBe(true);
    }
    const s = fresh();
    expect(s.forceEvent("ambulance")).toBe(true);
    const amb = s.traffic.npcs.find(
      (o) => !o.dead && o.behavior === "ambulance",
    )!;
    let close = false;
    for (let k = 0; k < 8 * 120 && !close; k++) {
      s.step(DT, GAS);
      if (amb.dead) break;
      close = Math.hypot(amb.x - s.car.x, amb.y - s.car.y) < 15;
    }
    expect(close).toBe(true);
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
