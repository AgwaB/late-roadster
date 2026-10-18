import { describe, expect, it } from "vitest";
import { buildCity, edgePose } from "./city";
import * as C from "./constants";
import { mulberry32 } from "./rng";
import { NPC_DIMS, npcSpan, Traffic, type Npc } from "./traffic";

const city = buildCity(1);
const edge = city.edges.find(
  (e) => e.axis === "x" && !e.crossing && !e.noNpc.length,
)!;
const DT = 1 / 120;
function sedan(traffic: Traffic, s: number, lane = 0): Npc {
  const n = traffic.spawnCamper(edge, 1, s);
  Object.assign(n, NPC_DIMS.sedan, {
    kind: "sedan",
    lane,
    laneTarget: lane,
    v: 0,
    vCruise: 0,
    ttl: 1e9,
    ...edgePose(city, edge, 1, s, lane),
  });
  return n;
}

/** Independent OBB/vertical overlap check, not the solver's backoff calculation. */
function overlaps(a: Npc, b: Npc): boolean {
  if (Math.hypot(a.x - b.x, a.y - b.y) > a.halfL + b.halfL + a.halfW + b.halfW)
    return false;
  const sa = npcSpan(a),
    sb = npcSpan(b);
  if (sa.bottom >= sb.top - 0.01 || sb.bottom >= sa.top - 0.01) return false;
  for (const angle of [
    a.heading,
    a.heading + Math.PI / 2,
    b.heading,
    b.heading + Math.PI / 2,
  ]) {
    const radius = (n: Npc) =>
      Math.abs(Math.cos(n.heading - angle)) * n.halfL +
      Math.abs(Math.sin(n.heading - angle)) * n.halfW;
    const distance = Math.abs(
      (b.x - a.x) * Math.cos(angle) + (b.y - a.y) * Math.sin(angle),
    );
    if (distance >= radius(a) + radius(b) - 1e-5) return false;
  }
  return true;
}

describe("traffic contact regressions (#3)", () => {
  it.each([false, true])(
    "separates the audit's 100/104/108 m queue in either spawn order (reverse=%s)",
    (reverse) => {
      const t = new Traffic(city, mulberry32(7), 0);
      const cars = [100, 104, 108].map((s) => sedan(t, s));
      if (reverse) t.npcs.reverse();
      t.update(DT, null);
      expect(cars[1].s - cars[0].s).toBeGreaterThanOrEqual(4.4);
      expect(cars[2].s - cars[1].s).toBeGreaterThanOrEqual(4.4);
    },
  );

  it("brakes at stopping distance, well beyond the old fixed lookahead", () => {
    const t = new Traffic(city, mulberry32(7), 0);
    const rear = sedan(t, 60);
    sedan(t, 100);
    rear.v = rear.vCruise = 40;
    t.update(DT, null);
    expect(rear.v).toBeCloseTo(40 - 18 * DT);
    expect(rear.s).toBeGreaterThan(60); // braking, not a contact teleport
  });

  it("separates fractional-lane merging bodies and keeps their path pose", () => {
    const t = new Traffic(city, mulberry32(7), 0);
    const rear = sedan(t, 100, 0.4),
      front = sedan(t, 103, 0);
    rear.behavior = "merge";
    rear.flag = 1;
    t.update(DT, { x: rear.x - 20, y: rear.y, heading: rear.heading });
    expect(overlaps(rear, front)).toBe(false);
    expect(rear.x).toBeCloseTo(edgePose(city, edge, 1, rear.s, rear.lane).x);
  });

  it("backs turning bodies along their curve, including contacts across edge IDs", () => {
    const t = new Traffic(city, mulberry32(7), 0);
    const rear = sedan(t, 100),
      front = sedan(t, 103);
    // A shallow intersection curve crossing the front car's lane.
    rear.turn = {
      p0: [rear.x - 8, rear.y - 2],
      p1: [rear.x, rear.y + 2],
      p2: [rear.x + 8, rear.y - 2],
      len: 16,
      t: 0.5,
      next: edge,
      nextDir: 1,
      lane: 0,
    };
    // Incoming route differs; the contact is spatial rather than edge/lane equality.
    rear.edge = city.edges.find((e) => e !== edge)!;
    t.update(0, null);
    expect(overlaps(rear, front)).toBe(false);
    expect(rear.turn).not.toBeNull();
    expect(rear.turn!.t).toBeLessThan(0.5);
    const pose = { x: rear.x, y: rear.y };
    t.update(0, null);
    expect(rear.x).toBeCloseTo(pose.x);
    expect(rear.y).toBeCloseTo(pose.y);
  });

  it("lets an overhead flip pass, but resolves its eventual landing", () => {
    const t = new Traffic(city, mulberry32(7), 0);
    const rear = sedan(t, 100),
      front = sedan(t, 102);
    rear.anim = { kind: "flip", t: 0.65, dur: 1.3 };
    t.update(0, null);
    expect(rear.s).toBe(100);
    expect(front.s).toBe(102);
    expect(npcSpan(rear).bottom).toBeGreaterThan(npcSpan(front).top);
    rear.anim.t = rear.anim.dur;
    t.update(0, null);
    expect(overlaps(rear, front)).toBe(false);
  });

  it("has zero same-lane body overlaps in an 80 second seeded headless soak", () => {
    const t = new Traffic(city, mulberry32(42));
    t.spawnCommuters(C.COMMUTER_COUNT);
    let contacts = 0,
      airbornePasses = 0;
    for (let frame = 0; frame < 80 / DT; frame++) {
      t.update(DT, { x: -500, y: -402.75, heading: 0, v: 0 });
      const lanes = new Map<string, Npc[]>();
      for (const n of t.npcs) {
        if (n.dead || n.turn) continue;
        const key = `${n.edge.id}:${n.dir}:${n.lane}`;
        const lane = lanes.get(key) ?? [];
        lane.push(n);
        lanes.set(key, lane);
      }
      for (const lane of lanes.values()) {
        lane.sort((a, b) => a.s - b.s);
        for (let i = 0; i < lane.length; i++) {
          for (let j = i + 1; j < lane.length; j++) {
            const a = lane[i],
              b = lane[j];
            if (b.s - a.s >= a.halfL + b.halfL - 1e-5) continue;
            if (overlaps(a, b)) contacts++;
            else airbornePasses++;
          }
        }
      }
      t.events.length = 0;
    }
    console.log(
      `traffic soak: 80s / 9600 ticks, same-lane overlaps=${contacts}, airborne passes=${airbornePasses}`,
    );
    expect(contacts).toBe(0);
    expect(airbornePasses).toBeGreaterThan(0);
  }, 120_000);
});
