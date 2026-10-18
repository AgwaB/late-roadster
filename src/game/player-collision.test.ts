import { describe, expect, it, vi } from "vitest";
import { buildCity, type AABB, type Prop } from "./city";
import * as C from "./constants";
import { carSpan, newCar, NO_INPUT, placeCar, stepCar } from "./physics";
import { Session } from "./session";
import { NPC_DIMS, npcSpan } from "./traffic";

const city = buildCity(1);
const DT = 1 / 120;

function emptySession() {
  const s = new Session(city, 7, 0);
  s.props = [];
  s.layout.buildings = [];
  s.traffic.npcs = [];
  s.ceilingCars = [];
  s.car = newCar(-100, -C.laneOffset(0), 0);
  s.nextEventT = Infinity;
  return s;
}

function box(x: number, y: number, hl = 2.4, hw = 1): AABB {
  return { x0: x - hl, x1: x + hl, y0: y - hw, y1: y + hw };
}

function prop(kind: Prop["kind"], x: number, y: number, h = 1.6): Prop {
  return {
    id: 1,
    kind,
    box: box(x, y),
    h,
    heading: 0,
    hit: false,
    stomped: false,
  };
}

function npcAt(s: Session, h = 3.55) {
  const template = new Session(city, 7, 0).traffic.npcs[0];
  const n = {
    ...template,
    ...NPC_DIMS.bus,
    kind: "bus" as const,
    x: s.car.x,
    y: s.car.y,
    heading: 0,
    yOff: 0,
    pitch: 0,
    roll: 0,
    h,
    v: 10,
    vCruise: 10,
    dead: false,
    stomped: false,
    anim: null,
    turn: null,
  };
  s.traffic.npcs = [n];
  return n;
}

function falling(s: Session, previous: number, current: number) {
  Object.assign(s.car, {
    h: current,
    previousBottom: previous,
    vH: -2,
    grounded: false,
    sp: 20,
  });
}

describe("#4 actual ceiling-car vertical overlap", () => {
  function ceilingSession() {
    const s = emptySession();
    const n = new Session(city, 7, 0).ceilingCars[0];
    Object.assign(n, { x: s.car.x, y: s.car.y, v: 0 });
    s.ceilingCars = [n];
    return s;
  }

  it("E at road height directly below yOff=6.5 does not push the player", () => {
    const s = ceilingSession();
    const { x, y } = s.car;
    expect(s.step(DT, { ...NO_INPUT, stick: true })).toContain("ceil:on");
    expect(s.car.h).toBe(0);
    expect(s.car.x).toBe(x);
    expect(s.car.y).toBe(y);
  });

  it.each(["rising", "attached", "flying", "falling"])(
    "collides during %s when body spans overlap",
    (state) => {
      const s = ceilingSession();
      Object.assign(s.car, {
        h: 4.8,
        ceiling: state === "rising" || state === "attached",
        roll: state === "attached" ? Math.PI : 0,
        grounded: false,
        vH: state === "falling" ? -2 : 2,
      });
      const { x, y } = s.car;
      s["collideCeiling"](false);
      expect(Math.hypot(s.car.x - x, s.car.y - y)).toBeGreaterThan(0);
    },
  );

  it("uses rotated spans for player and NPC rather than fixed h + roof", () => {
    const s = ceilingSession();
    Object.assign(s.car, { h: 3.5, pitch: Math.PI / 2, grounded: false });
    expect(s.car.h + C.CAR_ROOF).toBeLessThan(npcSpan(s.ceilingCars[0]).bottom);
    expect(carSpan(s.car).top).toBeGreaterThan(
      npcSpan(s.ceilingCars[0]).bottom,
    );
    const x = s.car.x,
      y = s.car.y;
    s["collideCeiling"](false);
    expect(Math.hypot(s.car.x - x, s.car.y - y)).toBeGreaterThan(0);
  });
});

describe("#5 / #14 genuine stomps and capped SP", () => {
  it.each(["npc", "jamcar", "parked"] as const)(
    "%s: h=6 over roof=3.55 is not a remote stomp",
    (kind) => {
      const s = emptySession();
      const target =
        kind === "npc" ? npcAt(s) : prop(kind, s.car.x, s.car.y, 3.55);
      if (kind !== "npc") s.props = [target as Prop];
      falling(s, 6.1, 6);
      const ev =
        kind === "npc" ? s["collideTraffic"](true) : s["collideStatic"](true);
      expect(ev).not.toContain("stomp");
      expect(target.stomped).toBe(false);
      expect(s.car.vH).toBe(-2);
      expect(s.car.sp).toBe(20);
    },
  );

  it.each(["npc", "jamcar", "parked"] as const)(
    "%s: downward roof crossing bounces and awards SP once",
    (kind) => {
      const s = emptySession();
      const target =
        kind === "npc" ? npcAt(s) : prop(kind, s.car.x, s.car.y, 3.55);
      if (kind !== "npc") s.props = [target as Prop];
      falling(s, 3.6, 3.5);
      const collide = () =>
        kind === "npc" ? s["collideTraffic"](true) : s["collideStatic"](true);
      expect(collide()).toContain("stomp");
      expect(carSpan(s.car).bottom).toBeCloseTo(3.55);
      expect(s.car.vH).toBe(5);
      expect(s.car.grounded).toBe(false);
      expect(s.car.sp).toBe(35);
      s.car.vH = -2;
      expect(collide()).not.toContain("stomp");
      expect(s.car.sp).toBe(35);
    },
  );

  it("caps the reward at SP_MAX and rejects ascent or entry from below the roof", () => {
    const s = emptySession();
    const p = prop("jamcar", s.car.x, s.car.y, 3.55);
    s.props = [p];
    falling(s, 3.6, 3.55);
    s.car.vH = 2;
    expect(s["collideStatic"](true)).not.toContain("stomp");
    falling(s, 3.1, 3.0);
    expect(s["stomp"](p, p.h)).toBe(false);
    falling(s, 3.6, 3.55);
    s.car.sp = 95;
    expect(s["stomp"](p, p.h)).toBe(true);
    expect(s.car.sp).toBe(C.SP_MAX);
  });

  it("tracks a moving NPC's previous roof, not just its current height", () => {
    const s = emptySession();
    const n = npcAt(s);
    falling(s, 3.5, 3.45);
    s["previousRoofs"].set(n, 3.4);
    expect(s["collideTraffic"](true)).toContain("stomp");
    expect(carSpan(s.car).bottom).toBeCloseTo(3.55);
  });

  it("captures both previous spans before moving traffic in a real step", () => {
    const s = emptySession();
    const n = npcAt(s, 3.4);
    falling(s, 99, 3.5);
    vi.spyOn(s.traffic, "update").mockImplementation(() => {
      n.h = 3.55;
    });
    expect(s.step(DT, NO_INPUT)).toContain("stomp");
    expect(s["previousRoofs"].get(n)).toBe(3.4);
    expect(s.car.previousBottom).toBe(3.5);
    expect(carSpan(s.car).bottom).toBeCloseTo(3.55);
  });

  it("captures previous player bottom in a real step and rewards only on contact", () => {
    const s = emptySession();
    s.props = [prop("parked", s.car.x, s.car.y, 3.55)];
    falling(s, 99, 3.56);
    expect(s.step(DT, NO_INPUT)).toContain("stomp");
    expect(s.car.previousBottom).toBeCloseTo(3.56);
    expect(s.car.sp).toBeCloseTo(20 + C.SP_REGEN * DT + C.SP_STOMP);
  });
});

describe("#16 whole-body walls and hazards", () => {
  it.each([0, Math.PI / 4, Math.PI / 2])(
    "detects and separates a 0.3m middle pole at heading %s",
    (heading) => {
      const s = emptySession();
      s.car.heading = heading;
      const pole = box(s.car.x, s.car.y, 0.15, 0.15);
      expect(s["hitsBox"](pole, 0.8)).toBe(true);
      const mtv = s["penetration"](pole)!;
      expect(mtv).not.toBeNull();
      s.car.x += mtv.x;
      s.car.y += mtv.y;
      expect(s["penetration"](pole)).toBeNull();
    },
  );

  it("wirepole hazard at the player's middle now impacts, and the car is pushed out of it (not driven through)", () => {
    const s = emptySession();
    s.hazards = [
      {
        id: 1,
        kind: "wirepole",
        x: s.car.x,
        y: s.car.y,
        halfL: 0.15,
        halfW: 0.15,
        h: 6,
        heading: 0,
        vx: 0,
        vy: 0,
        ttl: 10,
        phase: 0,
        variant: 0,
        hit: false,
      },
    ];
    const ev = s["collideHazards"](true);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatch(/^(scrape|hit:pole)$/);
    expect(s["collideHazards"](true)).toEqual([]); // clear of it now
  });
});

describe("N1 building heights", () => {
  it("h=1000 above a landmark does not push either a driving or tumbling car", () => {
    const s = new Session(city, 7, 0);
    s.props = [];
    const b = s.layout.buildings[0];
    Object.assign(s.car, { x: b.cx, y: b.cy, h: 1000, grounded: false });
    expect(s["collideStatic"](true)).toEqual([]);
    expect([s.car.x, s.car.y]).toEqual([b.cx, b.cy]);
    s.car.state = "crash";
    s["tumbleBounce"]();
    expect([s.car.x, s.car.y]).toEqual([b.cx, b.cy]);
    s.car.h = 0;
    s["tumbleBounce"]();
    expect([s.car.x, s.car.y]).not.toEqual([b.cx, b.cy]);
  });

  it("driving flat out into a building is a bounce, never a wipe-out", () => {
    const s = emptySession();
    s.layout.buildings = [
      {
        box: box(s.car.x + 12, s.car.y, 3, 6),
        cx: s.car.x + 12,
        cy: s.car.y,
        height: 20,
        kind: "test",
        scale: 1,
        rotY: 0,
      },
    ];
    Object.assign(s.car, { v: 45, invuln: 0 });
    const ev: string[] = [];
    for (let i = 0; i < 120; i++)
      ev.push(...s.step(DT, { ...NO_INPUT, accel: true }));
    expect(ev).toContain("hit:building");
    expect(ev.some((e) => e.startsWith("crash:"))).toBe(false);
    expect(s.car.state).toBe("drive");
    expect(s.car.v).toBeLessThan(10);
  });

  it("a rotated body extending below a roof still collides, using layout buildings", () => {
    const s = emptySession();
    s.layout.buildings = [
      {
        box: box(s.car.x, s.car.y, 5, 5),
        cx: s.car.x,
        cy: s.car.y,
        height: 3,
        kind: "test",
        scale: 1,
        rotY: 0,
      },
    ];
    Object.assign(s.car, { h: 3.2, pitch: Math.PI / 2, grounded: false });
    expect(carSpan(s.car).bottom).toBeLessThan(3);
    expect(s["collideStatic"](false)).toContain("scrape");
  });
});

describe("#6 bounded multi-contact resolution", () => {
  it("clears the generated jam probe at (-28,-4.8), including jam car #68", () => {
    const s = new Session(city, 7, 0);
    s.traffic.npcs = [];
    s.ceilingCars = [];
    placeCar(s.car, -28, -4.8, 0, 0);
    s["resolveContacts"]();
    expect(s["poseBlocked"](s.car)).toBe(false);
    const p = s.props.find((p) => p.id === 68)!;
    expect(s["penetration"](p.box)).toBeNull();
  });

  it("rechecks a wall after traffic pushes the player into it, without repeating impacts", () => {
    const s = emptySession();
    const x = s.car.x,
      y = s.car.y;
    const wall = prop("wall", x, y + 2.3, 10);
    wall.box = box(x, y + 2.3, 15, 0.2);
    s.props = [wall];
    const n = npcAt(s, 1.6);
    n.y = y - 0.7;
    n.halfW = 1;
    n.halfL = 2.4;
    n.v = 0;
    s.car.vLat = -10;
    const staticPass = vi.spyOn(
      s as unknown as { collideStatic(gate: boolean): string[] },
      "collideStatic",
    );
    const events = s["resolveContacts"]();
    expect(staticPass.mock.calls.length).toBeGreaterThan(1);
    expect(staticPass.mock.calls.length).toBeLessThanOrEqual(4);
    expect(events.filter((e) => /^(hit|bump):/.test(e))).toHaveLength(1);
    expect(events.filter((e) => e === "scrape").length).toBeLessThanOrEqual(1);
    expect(s["poseBlocked"](s.car)).toBe(false);
  });

  it("resolves current traffic poses, not positions before the NPC update", () => {
    const s = emptySession();
    const n = npcAt(s, 1.6);
    n.x += 20;
    vi.spyOn(s.traffic, "update").mockImplementation(() => {
      n.x = s.car.x;
    });
    s.step(DT, NO_INPUT);
    expect(s["poseBlocked"](s.car)).toBe(false);
  });

  it("applies the wall scrape once while resolving the same wall", () => {
    const s = emptySession();
    const p = prop("wall", s.car.x, s.car.y);
    s["contactEffects"] = new Set();
    const heading = s.car.heading;
    for (let i = 0; i < 4; i++)
      s["wallContact"]({ x: 0, y: 0.1 }, "wall", p, false);
    expect(Math.abs(s.car.heading - heading)).toBeCloseTo(0.04);
  });
});

describe("#15 safe deterministic respawn", () => {
  it("rejects the occupied jam pose (6,-2.75)", () => {
    const s = new Session(city, 7, 0);
    Object.assign(s.car, { x: 6, y: -2.75, heading: 0, state: "crash" });
    s["respawn"](s.car);
    expect(s.car.state).toBe("drive");
    expect([s.car.x, s.car.y]).not.toEqual([6, -2.75]);
    expect(s["poseBlocked"](s.car)).toBe(false);
  });

  it("rejects props, landmark buildings and traffic in candidate lanes", () => {
    const s = emptySession();
    s.props = [prop("parked", s.car.x, s.car.y)];
    npcAt(s, 1.6).y -= C.LANE_W;
    s.layout.buildings = [
      {
        box: box(s.car.x, s.car.y - 2 * C.LANE_W),
        cx: s.car.x,
        cy: s.car.y - 2 * C.LANE_W,
        height: 10,
        kind: "test",
        scale: 1,
        rotY: 0,
      },
    ];
    s["respawn"](s.car);
    expect(s["poseBlocked"](s.car)).toBe(false);
  });

  it("uses a checked road fallback when all nearby offsets and lanes are blocked", () => {
    const run = () => {
      const s = emptySession();
      const p = prop("wall", s.car.x, 0);
      p.box = box(s.car.x, 0, 100, 30);
      s.props = [p];
      s["respawn"](s.car);
      expect(s.car.state).toBe("drive");
      expect(s["poseBlocked"](s.car)).toBe(false);
      return [s.car.x, s.car.y, s.car.heading];
    };
    expect(run()).toEqual(run());
  });

  it("never announces or places a respawn if the map has no free pose", () => {
    const s = emptySession();
    const p = prop("wall", 0, 0);
    p.box = box(0, 0, 10000, 10000);
    s.props = [p];
    s.car.state = "crash";
    s.car.crashT = C.CRASH_REPLAY;
    const ev = stepCar(s.car, NO_INPUT, DT, s["env"]);
    expect(s.car.state).toBe("crash");
    expect(ev).not.toContain("respawn");
  });
});

it("carSpan includes roll, pitch and body-frame twist about the rendering pivot", () => {
  const c = newCar(0, 0, 0);
  expect(carSpan(c).bottom).toBeCloseTo(0);
  expect(carSpan(c).top).toBeCloseTo(C.CAR_ROOF);
  c.roll = Math.PI;
  expect(carSpan(c).bottom).toBeCloseTo(C.CAR_H - C.CAR_ROOF);
  expect(carSpan(c).top).toBeCloseTo(C.CAR_H);
  c.roll = 0;
  c.spin = Math.PI / 2;
  expect(carSpan(c).bottom).toBeCloseTo(C.CAR_H / 2 - C.CAR_HALF_L);
  expect(carSpan(c).top).toBeCloseTo(C.CAR_H / 2 + C.CAR_HALF_L);
});
