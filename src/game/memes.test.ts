import { describe, expect, it } from "vitest";
import { buildCity, groundAt, inBox, shortestPath, stageAt } from "./city";
import * as C from "./constants";
import { martSite } from "./landmarks";
import { NO_INPUT, newCar, stepCar, type Env } from "./physics";
import { Session } from "./session";
import { skyCarAt } from "./skylane";
import { PLAZA, tollCanopy, tollQueue } from "./toll";
import {
  RAMP,
  RAMP_TOP,
  ROW,
  ROW_HALF,
  ROW_OFFSETS,
  rampLocal,
  rampWorld,
} from "./venue";

describe("visual-meme city data", () => {
  const city = buildCity(1);

  // strip coordinates: s along the run, lat to the left of the centre line
  const strip = (x: number, y: number) => {
    const st = city.stage!;
    const dx = x - st.ox,
      dy = y - st.oy;
    return { s: dx * st.ux + dy * st.uy, lat: -dx * st.uy + dy * st.ux };
  };
  const centre = (b: { x0: number; y0: number; x1: number; y1: number }) =>
    strip((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);

  it("lays the event out as on the reveal night: five side by side along the run-in, broadside to it, the ramp behind", () => {
    const st = city.stage!;
    expect(st).not.toBeNull();
    const pz = city.plazas.find((p) => inBox(p, st.ox, st.oy))!;
    expect(pz).toBeDefined();
    const row = city.props.filter((p) => p.kind === "stagecar");
    expect(row).toHaveLength(ROW.length);
    // side by side along the run-in (on its line, in order, not overlapping), each broadside to the run with its
    // nose to the road side, the truck the tallest in the middle; the jump has to clear the whole row
    row.forEach((p, i) => {
      expect(centre(p.box).lat).toBeCloseTo(0, 5);
      expect(centre(p.box).s).toBeCloseTo(st.rowS + ROW_OFFSETS[i], 5);
      expect(Math.sin(p.heading)).toBeCloseTo(1, 5);
      expect(
        inBox(pz, (p.box.x0 + p.box.x1) / 2, (p.box.y0 + p.box.y1) / 2),
      ).toBe(true);
      if (i > 0) expect(p.box.x0).toBeGreaterThan(row[i - 1].box.x1);
    });
    const tallest = row.reduce((a, b) => (b.h > a.h ? b : a));
    expect(Math.abs(centre(tallest.box).s - st.rowS)).toBeLessThan(0.5);
    expect(2 * ROW_HALF).toBeGreaterThan(12);
    // nothing else in the way of the run-in up to the row, no kicker ramp and no canopy any more
    expect(city.canopies).toHaveLength(0);
    for (const r of city.ramps)
      expect(
        inBox(pz, (r.box.x0 + r.box.x1) / 2, (r.box.y0 + r.box.y1) / 2),
      ).toBe(false);
    // the ramp stands on the event ground, its lip ~20 m up, solid where it is built
    const foot = rampWorld(st.ramp, 0, 0),
      wall = rampWorld(st.ramp, RAMP.R + 1, 0);
    expect(inBox(pz, foot.x, foot.y) && inBox(pz, wall.x, wall.y)).toBe(true);
    expect(RAMP_TOP).toBeGreaterThan(18);
    expect(
      city.solids.some(
        (s) =>
          s.what === "ramp" && inBox(s.box, wall.x, wall.y) && s.top > RAMP_TOP,
      ),
    ).toBe(true);
    // the run-in line and the ramp approach stay clear of the grandstands, poles and the row
    for (let s = 0; s < st.rowS - ROW_HALF - 1; s += 2) {
      const q = stageAt(st, s);
      expect(city.solids.some((o) => inBox(o.box, q.x, q.y))).toBe(false);
    }
    for (let u = -80; u < 1; u += 2) {
      const q = rampWorld(st.ramp, u, 0);
      expect(city.solids.some((o) => inBox(o.box, q.x, q.y))).toBe(false);
      expect(city.props.some((o) => inBox(o.box, q.x, q.y))).toBe(false);
    }
  });

  it("rides the hook ramp at speed: up the wall, over the lip, upright again and down in front of it", () => {
    const st = city.stage!;
    const env: Env = {
      rnd: () => 0.5,
      ground: (x, y, h) => groundAt(city, x, y, h),
      tunnel: () => false,
      wallRamp: st.ramp,
      respawn: () => {},
    };
    const run = (v0: number, from = -30) => {
      const start = rampWorld(st.ramp, from, 0);
      const c = newCar(start.x, start.y, Math.atan2(st.ramp.uy, st.ramp.ux));
      c.h = C.CURB_H;
      c.v = v0;
      const ev: string[] = [];
      let peak = 0,
        rode = false;
      for (let i = 0; i < 60 * 8; i++) {
        ev.push(...stepCar(c, { ...NO_INPUT, accel: v0 > 30 }, 1 / 60, env));
        peak = Math.max(peak, c.h);
        if (c.wall) rode = true;
        if (rode && !c.wall && c.grounded) break;
      }
      return { c, ev, peak, rode };
    };
    const fast = run(C.BASE_SPEED);
    expect(fast.rode).toBe(true);
    expect(fast.ev).toContain("wall");
    expect(fast.ev).toContain("flipStart");
    expect(fast.peak).toBeGreaterThan(RAMP_TOP - 1);
    expect(fast.ev.some((e) => e.startsWith("crash:"))).toBe(false);
    expect(fast.ev).toContain("flip:1");
    expect(fast.c.state).toBe("drive");
    // landed upright in front of the ramp, heading back over the run-in
    const back = rampLocal(st.ramp, fast.c.x, fast.c.y);
    expect(back.u).toBeLessThan(0);
    expect(back.u).toBeGreaterThan(-40);
    expect(
      Math.cos(fast.c.heading - Math.atan2(st.ramp.uy, st.ramp.ux)),
    ).toBeLessThan(-0.9);
    // too slow to reach the lip: it rolls back down the curve and off the foot, no crash
    const slow = run(22, -6);
    expect(slow.rode).toBe(true);
    expect(slow.peak).toBeLessThan(RAMP_TOP - 2);
    expect(slow.ev).not.toContain("flipStart");
    expect(slow.c.state).toBe("drive");
    expect(slow.c.v).toBeLessThanOrEqual(0);
  });

  it("jams every toll lane both ways, under a canopy you can land on and fly into", () => {
    const tl = city.toll!;
    const q = tollQueue(tl);
    const jam = city.props.filter(
      (p) =>
        p.kind === "jamcar" && Math.abs((p.box.x0 + p.box.x1) / 2 - tl.x) < 70,
    );
    expect(jam.length).toBe(q.length);
    for (const dir of [1, -1])
      for (let lane = 0; lane < C.LANES_PER_DIR; lane++)
        expect(q.filter((c) => c.dir === dir && c.lane === lane).length).toBe(
          PLAZA.cars,
        );
    // queue cars never overlap each other or the booths
    for (let i = 0; i < jam.length; i++)
      for (let j = i + 1; j < jam.length; j++) {
        const a = jam[i].box,
          b = jam[j].box;
        expect(
          a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0,
        ).toBe(true);
      }
    for (const p of jam)
      for (const s of city.solids.filter(
        (o) => o.what === "toll" && o.bottom === 0,
      )) {
        const a = p.box,
          b = s.box;
        expect(
          a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0,
        ).toBe(true);
      }
    // the canopy roof is a deck for a car already up there, not for one on the road under it
    const cv = tollCanopy(tl);
    const mid = { x: (cv.x0 + cv.x1) / 2, y: -6 };
    expect(groundAt(city, mid.x, mid.y, PLAZA.top + 0.5).h).toBe(PLAZA.top);
    expect(groundAt(city, mid.x, mid.y, 0).h).toBe(0);
    // no sinkholes hidden under the queue
    expect(city.potholes.some((p) => p.edge === tl.edge)).toBe(false);
    // flying into the canopy edge at speed is a crash; skimming over the roof is not
    const s = new Session(city, 1, 0, 0);
    const c = s.car;
    c.x = tl.x - PLAZA.canopyHalfX - 6;
    c.y = -6;
    c.heading = 0;
    c.v = 30;
    c.h = PLAZA.bottom + 0.2;
    c.grounded = false;
    c.invuln = 0;
    let crash: string | undefined;
    for (let i = 0; i < 60 && !crash; i++) {
      c.vH = 0;
      crash = s
        .step(1 / 60, { ...NO_INPUT, accel: true, jump: true })
        .find((e) => e.startsWith("crash:"));
    }
    expect(crash).toBe("crash:toll");
    const s2 = new Session(city, 1, 0, 0);
    const c2 = s2.car;
    Object.assign(c2, {
      x: tl.x - PLAZA.canopyHalfX - 6,
      y: -6,
      heading: 0,
      v: 30,
      h: PLAZA.top + 0.6,
      grounded: false,
      invuln: 0,
      vH: 0,
    });
    const ev2: string[] = [];
    for (let i = 0; i < 45; i++) {
      c2.vH = Math.max(c2.vH, 0);
      ev2.push(...s2.step(1 / 60, { ...NO_INPUT, accel: true }));
    }
    expect(ev2.some((e) => e.startsWith("crash:"))).toBe(false);
    expect(c2.x).toBeGreaterThan(tl.x + PLAZA.canopyHalfX);
  });

  it("drops the car into a sinkhole (an accident) and respawns it clear of the hole", () => {
    const s = new Session(city, 1, 0, 0);
    const p = city.potholes[0];
    const c = s.car;
    const e = city.edges[p.edge];
    const hd =
      e.axis === "x"
        ? p.dir > 0
          ? 0
          : Math.PI
        : p.dir > 0
          ? Math.PI / 2
          : -Math.PI / 2;
    Object.assign(c, {
      x: p.x - Math.cos(hd) * 12,
      y: p.y - Math.sin(hd) * 12,
      heading: hd,
      v: 25,
      h: 0,
      grounded: true,
      invuln: 0,
    });
    s.traffic.npcs.forEach((n) => (n.dead = true));
    const ev: string[] = [];
    for (let i = 0; i < 60 && c.state === "drive"; i++)
      ev.push(...s.step(1 / 60, { ...NO_INPUT, accel: true }));
    expect(ev).toContain("crash:sinkhole");
    expect(c.pit).not.toBeNull();
    // sinks nose-first into it
    for (let i = 0; i < 60; i++) s.step(1 / 60, NO_INPUT);
    expect(c.h).toBeLessThan(-0.5);
    expect(c.pitch).toBeLessThan(-0.3);
    for (let i = 0; i < 60 * 3 && c.state !== "drive"; i++)
      s.step(1 / 60, NO_INPUT);
    expect(c.state).toBe("drive");
    expect(c.pit).toBeNull();
    for (const q of city.potholes)
      expect(Math.hypot(q.x - c.x, q.y - c.y)).toBeGreaterThan(
        q.r + C.CAR_HALF_L,
      );
  });

  it("collides with the sky lane: flying into a roadster is a crash, coming down on its roof a bounce", () => {
    const hit = (fromAbove: boolean) => {
      const s = new Session(city, 1, 0, 0);
      s.traffic.npcs.forEach((n) => (n.dead = true));
      const c = s.car;
      const t = s.t + 1 / 60;
      const p = skyCarAt(city.sky[0], 0, t);
      Object.assign(c, {
        x: p.x - (fromAbove ? 0 : 6) * Math.cos(p.heading),
        y: p.y,
        heading: p.heading + (fromAbove ? 0 : 0),
        v: fromAbove ? 21 : 32,
        h: fromAbove ? p.hc + 0.65 : p.hc - 0.5,
        grounded: false,
        invuln: 0,
        vH: fromAbove ? -1 : 0,
        previousBottom: fromAbove ? p.hc + 0.7 : p.hc - 0.5,
      });
      const ev: string[] = [];
      for (let i = 0; i < 30 && c.state === "drive"; i++) {
        if (!fromAbove) c.vH = 0;
        ev.push(...s.step(1 / 60, { ...NO_INPUT, accel: true }));
        if (fromAbove && ev.includes("stomp:sky")) break;
      }
      return ev;
    };
    expect(hit(false)).toContain("crash:skycar");
    const above = hit(true);
    expect(above).toContain("stomp:sky");
    expect(above.some((e) => e.startsWith("crash:"))).toBe(false);
  });

  it("lines every commute up along the corridor: toll, launch stage, tunnel, skyway, ORBIT MART", () => {
    const st = city.stage!;
    const tl = city.toll!;
    expect(tl).not.toBeNull();
    const mart = martSite(city)!;
    expect(mart).not.toBeNull();
    for (const cm of city.commutes) {
      const p = shortestPath(city, cm.home.id, cm.office.id);
      // the stretch of y = 0 the route drives
      const row = p.filter((n) => n.j === 0).map((n) => n.x);
      const x0 = Math.min(...row),
        x1 = Math.max(...row);
      expect(x0).toBeLessThan(tl.x);
      expect(x0).toBeLessThan(st.ox);
      expect(x1).toBeGreaterThanOrEqual(C.CORRIDOR_X1);
      expect(x1).toBeGreaterThan(mart.cx);
      // within sight of the road: stage strip and store front no more than ~45 m off the corridor's centre line
      expect(Math.abs(st.oy)).toBeLessThan(45);
      expect(Math.abs(mart.south ? mart.box.y0 : mart.box.y1)).toBeLessThan(45);
    }
  });

  it("starts every commute facing down the route's first road", () => {
    for (let ci = 0; ci < city.commutes.length; ci++) {
      const s = new Session(city, 1, 0, ci);
      const p = shortestPath(city, s.commute.home.id, s.commute.office.id);
      const d = { x: p[1].x - p[0].x, y: p[1].y - p[0].y };
      const fwd = Math.cos(s.car.heading) * d.x + Math.sin(s.car.heading) * d.y;
      expect(fwd / Math.hypot(d.x, d.y)).toBeCloseTo(1, 5);
      // the start is on that road, past the home crossing
      const along =
        ((s.car.x - p[0].x) * d.x + (s.car.y - p[0].y) * d.y) /
        Math.hypot(d.x, d.y);
      expect(along).toBeGreaterThan(C.ROAD_HALF);
      // and the finish bay is within 60 m of the office crossing, on the arrival road
      expect(
        Math.hypot(
          s.office.x - s.commute.office.x,
          s.office.y - s.commute.office.y,
        ),
      ).toBeLessThan(60);
    }
  });

  it("puts potholes on commute roads only, never on the river bridges", () => {
    expect(city.potholes.length).toBeGreaterThan(10);
    for (const p of city.potholes) {
      const e = city.edges[p.edge];
      expect(e.crossing).toBeFalsy();
      expect(p.s).toBeGreaterThan(0);
      expect(p.s).toBeLessThan(e.len);
    }
  });
});
