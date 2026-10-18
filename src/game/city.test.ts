import { describe, expect, it } from "vitest";
import * as C from "./constants";
import {
  buildCity,
  groundAt,
  inRiver,
  inTunnel,
  locateOnRoad,
  onRoadway,
  roadAt,
  shortestPath,
  snapToLane,
  straightOn,
  PARKED_KINDS,
} from "./city";
import { VEHICLE_DIMS } from "./dims";

const city = buildCity(1);

describe("city", () => {
  it("has a connected road graph with river crossings only on crossing rows", () => {
    expect(city.nodes.length).toBe(2 * C.K * (2 * C.K + 1));
    const crossings = city.edges.filter((e) => e.crossing);
    expect(crossings.length).toBe(3);
    const west = city.nodes.find((n) => n.i === -C.K && n.j === -C.K)!;
    const east = city.nodes.find((n) => n.i === C.K && n.j === C.K)!;
    const path = shortestPath(city, west.id, east.id);
    expect(path[path.length - 1].id).toBe(east.id);
    expect(path.some((n) => n.i === -1) && path.some((n) => n.i === 1)).toBe(
      true,
    );
  });

  it("offers commutes in the target distance range", () => {
    expect(city.commutes.length).toBeGreaterThan(5);
    for (const c of city.commutes) {
      expect(c.dist).toBeGreaterThanOrEqual(C.COMMUTE_MIN);
      expect(c.dist).toBeLessThanOrEqual(C.COMMUTE_MAX);
    }
  });

  it("buildings never overlap roads", () => {
    for (const b of city.buildings) {
      for (const [x, y] of [
        [b.box.x0, b.box.y0],
        [b.box.x1, b.box.y1],
        [b.box.x0, b.box.y1],
        [b.box.x1, b.box.y0],
      ])
        expect(onRoadway(x, y)).toBe(false);
    }
    expect(city.buildings.length).toBeGreaterThan(200);
  });

  it("classifies ground: roadway 0, sidewalk/alley curb, river water, tunnel covered", () => {
    expect(groundAt(city, 2 * C.P, 50).h).toBe(0); // on vertical road at x=260
    expect(groundAt(city, 2 * C.P + C.ROADWAY_HALF + 3, 50).h).toBe(C.CURB_H); // sidewalk
    expect(groundAt(city, 2 * C.P + 80, 50).h).toBe(C.CURB_H); // inside block
    expect(inRiver(city, 0, 150)).toBe(true);
    expect(inRiver(city, 0, 3 * C.P)).toBe(false); // north bridge
    expect(inRiver(city, 0, 0)).toBe(false); // tunnel deck
    expect(inTunnel(city, 50, 2)).toBe(true);
    expect(inTunnel(city, 50, C.ROADWAY_HALF + 2)).toBe(false);
    expect(roadAt(-20, C.P)).toBeNull(); // no horizontal road over the river on non-crossing rows
    expect(roadAt(-20, 3 * C.P)?.axis).toBe("x");
  });

  it("snapToLane puts the car back on a lane heading along the road", () => {
    const p = snapToLane(city, 2 * C.P + 3, 50, Math.PI / 2 + 0.3);
    expect(p.x).toBeCloseTo(2 * C.P + C.laneOffset(0));
    expect(p.heading).toBeCloseTo(Math.PI / 2);
    const q = snapToLane(city, 0, 150, 0); // in the river -> bank road
    expect(Math.abs(q.x)).toBeCloseTo(
      C.P + (Math.sin(q.heading) >= 0 ? C.laneOffset(0) : -C.laneOffset(0)),
      0,
    );
  });

  it("locateOnRoad finds the edge ahead of the player", () => {
    const loc = locateOnRoad(
      city,
      -4 * C.P + 30,
      -2 * C.P - C.laneOffset(0),
      0,
    )!;
    expect(loc).not.toBeNull();
    expect(loc.edge.axis).toBe("x");
    expect(loc.dir).toBe(1);
    expect(loc.s).toBeCloseTo(30);
    expect(loc.lane).toBe(0);
  });

  it("parked and queueing cars are as big as the model drawn for them (a van's roof is a van's roof)", () => {
    const cars = city.props.filter(
      (p) => p.kind === "parked" || p.kind === "jamcar",
    );
    expect(cars.length).toBeGreaterThan(50);
    const kinds = new Set<string>();
    for (const p of cars) {
      const kind = PARKED_KINDS[p.variant ?? -1];
      expect(kind).toBeDefined();
      kinds.add(kind);
      const d = VEHICLE_DIMS[kind];
      const w = p.box.x1 - p.box.x0,
        l = p.box.y1 - p.box.y0;
      const [long, short] = w >= l ? [w, l] : [l, w];
      expect(long).toBeCloseTo(2 * d.halfL, 5);
      expect(short).toBeCloseTo(2 * d.halfW, 5);
      expect(p.h).toBe(d.h);
    }
    expect(kinds.size).toBeGreaterThan(4);
  });

  it("goes straight on across a junction along a row, and stops at the map's edge", () => {
    const e = city.edges.find(
      (q) =>
        q.axis === "x" &&
        city.nodes[q.a].x === 200 &&
        city.nodes[q.a].y === -400,
    )!;
    const on = straightOn(city, e, 1)!;
    expect(city.nodes[on.edge.a].x).toBe(400);
    expect(on.edge.axis).toBe("x");
    expect(on.dir).toBe(1);
    const last = city.edges.find(
      (q) =>
        q.axis === "x" &&
        Math.max(city.nodes[q.a].x, city.nodes[q.b].x) === C.CITY_HALF &&
        city.nodes[q.a].y === -400,
    )!;
    expect(straightOn(city, last, 1)).toBeNull();
  });
});
