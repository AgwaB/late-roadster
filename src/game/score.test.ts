import { describe, expect, it } from "vitest";
import { buildCity, stageAt } from "./city";
import * as C from "./constants";
import { NO_INPUT, crashCar, newCar } from "./physics";
import { CLIPS, ON_TIME_X, Tracker, VIEWS, viewsText } from "./score";
import { Session } from "./session";
import { PLAZA } from "./toll";

const city = buildCity(1);
const quiet = (s: Session) => s.traffic.npcs.forEach((n) => (n.dead = true));

describe("clips and VIEWS", () => {
  it("has twelve distinct clips, each with a how-to and a caption", () => {
    expect(CLIPS).toHaveLength(12);
    expect(new Set(CLIPS.map((c) => c.id)).size).toBe(12);
    for (const c of CLIPS) {
      expect(c.how.length).toBeGreaterThan(5);
      expect(c.caption.length).toBeGreaterThan(10);
    }
  });

  it("pays a flip, unlocks FLIP RESET for two, and chains the multiplier", () => {
    const tr = new Tracker(city, new Set());
    const c = newCar(0, 0, 0);
    const ev1 = tr.step(1 / 60, c, ["flip:2", "land:clean"]);
    expect(ev1).toContain("clip:reset");
    expect(tr.views).toBe(VIEWS.flip * 2 + VIEWS.reset);
    const before = tr.views;
    const ev2 = tr.step(1 / 60, c, ["stomp"]);
    expect(ev2).toContain("clip:hop");
    // second stunt in the chain: x1.25, rounded to 100 views
    const paid = Math.round((VIEWS.stomp * 1.25) / 100) * 100;
    expect(ev2.find((e) => e.startsWith("views:"))).toBe(
      "views:" + paid + ":1.25",
    );
    expect(tr.views - before).toBe(paid);
    // a calm stretch on the road ends the chain
    for (let i = 0; i < 60 * 3; i++) tr.step(1 / 60, c, []);
    expect(tr.multiplier).toBe(1);
    // clips already filmed are not announced again
    expect(tr.step(1 / 60, c, ["stomp"])).not.toContain("clip:hop");
  });

  it("makes the news on a crash (once per card), and SPACE skips the replay but not the time lost", () => {
    const known = new Set<string>();
    const s = new Session(city, 1, 0, 0, { known });
    quiet(s);
    s.step(1 / 60, NO_INPUT);
    const t0 = s.t;
    crashCar(s.car, "land", () => 0.5);
    const ev = s.step(1 / 60, NO_INPUT);
    // the tracker sees the crash state the step after crashCar ran outside step()
    expect(s.car.state).toBe("crash");
    for (let i = 0; i < 40; i++) ev.push(...s.step(1 / 60, NO_INPUT));
    ev.push(...s.step(1 / 60, { ...NO_INPUT, jump: true }));
    ev.push(...s.step(1 / 60, { ...NO_INPUT, jump: true }));
    expect(s.car.state).toBe("drive");
    expect(ev).toContain("respawn");
    expect(s.t - t0).toBeGreaterThan(C.CRASH_REPLAY - 0.05);
    expect(s.t - t0).toBeLessThan(C.CRASH_REPLAY + 0.2);
    // holding SPACE through the skip does not fire a jump on the road
    expect(s.car.grounded).toBe(true);
  });

  it("unlocks BREAKING NEWS from a real crash event and keeps it in the known set", () => {
    const known = new Set<string>();
    const s = new Session(city, 1, 0, 0, { known });
    quiet(s);
    const tl = city.toll!;
    Object.assign(s.car, {
      x: tl.x - PLAZA.canopyHalfX - 4,
      y: -6,
      heading: 0,
      v: 30,
      h: PLAZA.bottom + 0.3,
      grounded: false,
      invuln: 0,
    });
    const ev: string[] = [];
    for (let i = 0; i < 40 && s.car.state === "drive"; i++) {
      s.car.vH = 0;
      ev.push(...s.step(1 / 60, { ...NO_INPUT, accel: true }));
    }
    ev.push(...s.step(1 / 60, NO_INPUT));
    expect(ev).toContain("crash:toll");
    expect(ev).toContain("clip:news");
    expect(s.lastCrash).toBe("toll");
    expect(known.has("news")).toBe(true);
  });

  it("unlocks TOLL $0 flying over the canopy and CAN'T PARK THERE landing on it", () => {
    const known = new Set<string>();
    const s = new Session(city, 1, 0, 0, { known });
    quiet(s);
    const tl = city.toll!;
    Object.assign(s.car, {
      x: tl.x - PLAZA.canopyHalfX - 3,
      y: -6,
      heading: 0,
      v: 12,
      h: PLAZA.top + 1.5,
      grounded: false,
      invuln: 0,
      vH: 0,
    });
    const ev: string[] = [];
    for (let i = 0; i < 90; i++) ev.push(...s.step(1 / 60, NO_INPUT));
    expect(ev.some((e) => e.startsWith("crash:"))).toBe(false);
    expect(ev).toContain("clip:toll");
    expect(ev).toContain("clip:park");
    expect(s.views).toBeGreaterThan(VIEWS.toll);
  });

  it("doubles the VIEWS when on time; free roam has no clock and no end", () => {
    const s = new Session(city, 1, 0, 0);
    quiet(s);
    s.tracker.views = 100_000;
    s.car.x = s.office.x;
    s.car.y = s.office.y;
    s.step(1 / 60, NO_INPUT);
    expect(s.result?.finished).toBe(true);
    expect(s.result?.finalViews).toBe(100_000 * ON_TIME_X);
    const f = new Session(city, 1, 0, 0, { free: true });
    quiet(f);
    expect(f.clock).toBe("FREE ROAM");
    expect(f.timeLeft).toBe(Infinity);
    f.t = C.RUN_TIME + 5;
    f.car.x = f.office.x;
    f.car.y = f.office.y;
    const ev = f.step(1 / 60, NO_INPUT);
    expect(ev).not.toContain("late");
    expect(ev).not.toContain("finish");
    expect(f.state).toBe("run");
  });

  it("a skipped crash replay that crosses 9:00 is LATE, not a finish", () => {
    const s = new Session(city, 1, 0, 0);
    quiet(s);
    Object.assign(s.car, {
      x: s.office.x,
      y: s.office.y,
      h: 0,
      grounded: true,
      invuln: 0,
    });
    s.t = C.RUN_TIME - 1;
    crashCar(s.car, "land", () => 0.5);
    s.step(1 / 60, NO_INPUT); // Space must be a fresh press, not held from before the crash
    s.car.crashT = 0.6;
    s.t = C.RUN_TIME - 1;
    const ev = s.step(1 / 60, { ...NO_INPUT, jump: true });
    expect(ev).toContain("late");
    expect(ev).not.toContain("finish");
    expect(s.result?.finished).toBe(false);
  });

  it("runaway wheels roll from the kerb across the road, not away from it", () => {
    const s = new Session(city, 1, 0, 0);
    quiet(s);
    const car = s.car;
    const loc = {
      edge: city.edges[car.x === undefined ? 0 : 0],
      dir: 1 as const,
      s: 60,
      lane: 1,
    };
    // pick an eastbound x road for a known frame: the car's own road
    const e = city.edges.find((q) => q.axis === "x" && !q.crossing)!;
    (s as unknown as { startEvent(k: string, l: unknown): boolean }).startEvent(
      "wheel",
      { ...loc, edge: e },
    );
    const w = s.hazards.find((h) => h.kind === "wheel")!;
    expect(w).toBeDefined();
    // eastbound: the kerb is on -y, so the wheel must head +y (towards the median)
    expect(w.vy).toBeGreaterThan(5);
  });

  it("THE KICKFLIP needs the whole row cleared, and a chain breaks only after 2.5 s of unbroken road time", () => {
    const tr = new Tracker(city, new Set());
    const st = city.stage!;
    const c = newCar(0, 0, 0);
    // over the row in the air, then back down on the approach side with a flip: no clip
    const over = stageAt(st, st.rowS);
    Object.assign(c, { x: over.x, y: over.y, h: 6, grounded: false });
    tr.step(1 / 60, c, []);
    const back = stageAt(st, st.rowS - 20);
    Object.assign(c, { x: back.x, y: back.y, h: C.CURB_H, grounded: true });
    expect(tr.step(1 / 60, c, ["flip:1", "land:clean"])).not.toContain(
      "clip:kickflip",
    );
    // the same, landing past the row: the clip
    Object.assign(c, { x: over.x, y: over.y, h: 6, grounded: false });
    tr.step(1 / 60, c, []);
    const past = stageAt(st, st.rowS + 20);
    Object.assign(c, { x: past.x, y: past.y, h: C.CURB_H, grounded: true });
    expect(tr.step(1 / 60, c, ["flip:1", "land:clean"])).toContain(
      "clip:kickflip",
    );
    // chain: 2 s on the road, a hop, 1 s on the road keeps the chain; 2.6 s straight ends it
    const d = newCar(0, 0, 0);
    tr.step(1 / 60, d, ["stomp"]);
    expect(tr.chain).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) tr.step(1 / 60, d, []);
    d.grounded = false;
    d.h = 3;
    for (let i = 0; i < 60; i++) tr.step(1 / 60, d, []);
    d.grounded = true;
    d.h = 0;
    for (let i = 0; i < 60; i++) tr.step(1 / 60, d, []);
    expect(tr.chain).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) tr.step(1 / 60, d, []);
    expect(tr.chain).toBe(0);
  });

  it("the cycling club: ride into it and you crash, hop it and you film PELOTON", () => {
    const run = (hop: boolean) => {
      const s = new Session(city, 1, 0, 0);
      quiet(s);
      expect(s.forceEvent("peloton")).toBe(true);
      const pack = s.hazards.filter((h) => h.kind === "cyclist");
      expect(pack).toHaveLength(5);
      const c = s.car;
      // ahead of the car, head-high
      for (const h of pack) {
        const ahead =
          (h.x - c.x) * Math.cos(c.heading) + (h.y - c.y) * Math.sin(c.heading);
        expect(ahead).toBeGreaterThan(70);
        expect(ahead).toBeLessThan(100);
        expect(h.h).toBeGreaterThan(C.CAR_ROOF);
      }
      // close in fast, and (hop) jump just before reaching them
      c.v = 30;
      c.invuln = 0;
      const ev: string[] = [];
      for (let i = 0; i < 60 * 6 && c.state === "drive"; i++) {
        const lead = Math.min(
          ...pack.map(
            (h) =>
              (h.x - c.x) * Math.cos(c.heading) +
              (h.y - c.y) * Math.sin(c.heading),
          ),
        );
        const jump = hop && lead < 11 && lead > 9 && c.grounded;
        ev.push(...s.step(1 / 60, { ...NO_INPUT, accel: true, jump }));
      }
      return ev;
    };
    const crashEv = run(false);
    expect(crashEv).toContain("crash:cyclist");
    expect(crashEv).not.toContain("clip:peloton");
    const hopEv = run(true);
    expect(hopEv.some((e) => e.startsWith("crash:"))).toBe(false);
    expect(hopEv).toContain("over:peloton");
    expect(hopEv.filter((e) => e === "over:peloton")).toHaveLength(1);
    expect(hopEv).toContain("clip:peloton");
  });

  it("formats view counts", () => {
    expect(viewsText(950)).toBe("950");
    expect(viewsText(30_000)).toBe("30K");
    expect(viewsText(12_400)).toBe("12.4K");
    expect(viewsText(245_000)).toBe("245K");
    expect(viewsText(1_230_000)).toBe("1.2M");
  });
});
