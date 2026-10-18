import { describe, expect, it, vi } from "vitest";
import { buildCity, edgePose, locateOnRoad } from "./city";
import * as C from "./constants";
import { NO_INPUT } from "./physics";
import { Session } from "./session";

const city = buildCity(1);
const DT = 1 / 120;
function isolatedSession(seed = 42): Session {
  const s = new Session(city, seed, 0);
  s.traffic.npcs = [];
  s.props = [];
  s.ceilingCars = [];
  s.nextEventT = Infinity;
  Object.assign(s.car, { x: -650, y: -402.75, heading: 0, v: 42 });
  return s;
}

describe("audit logic regressions", () => {
  it("#7 failed landing, wreck replay and respawn use only the session seed", () => {
    const run = (globalRandom: number) => {
      const random = vi.spyOn(Math, "random").mockReturnValue(globalRandom);
      try {
        const s = isolatedSession();
        Object.assign(s.car, {
          h: 0.001,
          vH: -2,
          grounded: false,
          spin: Math.PI,
        });
        const events = s.step(DT, NO_INPUT);
        expect(events).toContain("crash:land");
        const states = [structuredClone(s.car)];
        for (let i = 0; i < (C.CRASH_REPLAY + 0.2) / DT; i++) {
          events.push(...s.step(DT, NO_INPUT));
          states.push(structuredClone(s.car));
        }
        expect(events).toContain("respawn");
        expect(s.car.state).toBe("drive");
        expect(random).not.toHaveBeenCalled();
        return { states, events, result: s.result };
      } finally {
        random.mockRestore();
      }
    };
    expect(run(0.1)).toEqual(run(0.9));
  });

  it("#13 round-trips both halves of every river crossing, in both directions", () => {
    for (const edge of city.edges.filter((e) => e.crossing)) {
      for (const dir of [1, -1] as const) {
        for (const x of [-C.P + 5, -50, -0.001, 0, 0.001, 50, C.P - 5]) {
          const s = dir === 1 ? x + C.P : C.P - x;
          const pose = edgePose(city, edge, dir, s, 0);
          const found = locateOnRoad(city, pose.x, pose.y, pose.heading)!;
          expect(found).not.toBeNull();
          expect(found.edge.id).toBe(edge.id);
          expect(found.dir).toBe(dir);
          expect(found.s).toBeCloseTo(s);
          expect(found.s).toBeGreaterThanOrEqual(0);
          expect(found.s).toBeLessThanOrEqual(edge.len);
          expect(found.lane).toBe(0);
        }
      }
    }
    expect(locateOnRoad(city, 50, C.P, 0)).toBeNull();
  });

  it("#17 rejects the audit's finish 0.1 m away at t=89.9999 and v=42", () => {
    const s = isolatedSession();
    s.office = { x: s.car.x + C.FINISH_RADIUS + 0.1, y: s.car.y };
    s.t = C.RUN_TIME - 0.0001;
    const x = s.car.x;
    const ev = s.step(DT, { ...NO_INPUT, accel: true });
    expect(ev).toContain("late");
    expect(ev).not.toContain("finish");
    expect(s.result!.finished).toBe(false);
    expect(s.t).toBe(C.RUN_TIME);
    expect(s.car.x - x).toBeCloseTo(42 * 0.0001);
    expect(s.step(DT, NO_INPUT)).toEqual([]);
  });

  it("#17 still accepts an arrival within the on-time portion of the last tick", () => {
    const s = isolatedSession();
    s.office = { x: s.car.x + C.FINISH_RADIUS + 0.1, y: s.car.y };
    s.t = C.RUN_TIME - 0.005;
    const ev = s.step(DT, { ...NO_INPUT, accel: true });
    expect(ev).toContain("finish");
    expect(ev).not.toContain("late");
    expect(s.result!.finished).toBe(true);
    expect(s.t).toBe(C.RUN_TIME);
  });
});
