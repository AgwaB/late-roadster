import { describe, expect, it } from "vitest";
import { buildCity, inBox } from "./city";
import * as C from "./constants";
import { Session } from "./session";

const overlap = (
  a: { x0: number; y0: number; x1: number; y1: number },
  b: { x0: number; y0: number; x1: number; y1: number },
) => a.x1 > b.x0 && a.x0 < b.x1 && a.y1 > b.y0 && a.y0 < b.y1;

describe("commute landmarks", () => {
  const city = buildCity(1);
  for (let run = 0; run < 6; run++) {
    const s = new Session(city, 1, run);
    const { landmarks, skip, buildings } = s.layout;

    it(`run ${run}: replaced lots are not solid, the landmark footprints are`, () => {
      expect(landmarks.map((l) => l.id).sort()).toEqual(["hq_r3", "villa_r3"]);
      for (const b of skip) expect(buildings).not.toContain(b);
      for (const l of landmarks)
        for (const sol of l.solids) expect(buildings).toContain(sol);
      expect(buildings.length).toBe(
        city.buildings.length -
          skip.size +
          landmarks.reduce((n, l) => n + l.solids.length, 0) +
          1, // ORBIT MART
      );
    });

    it(`run ${run}: landmarks stay off the roadway and leave the start clear`, () => {
      // never reaches into the carriageway of either road through the office or home crossing
      const big = 1e6;
      for (const n of [s.commute.office, s.commute.home]) {
        const ew = {
          x0: -big,
          x1: big,
          y0: n.y - C.ROADWAY_HALF,
          y1: n.y + C.ROADWAY_HALF,
        };
        const ns = {
          y0: -big,
          y1: big,
          x0: n.x - C.ROADWAY_HALF,
          x1: n.x + C.ROADWAY_HALF,
        };
        for (const l of landmarks)
          for (const sol of l.solids) {
            expect(overlap(sol.box, ew)).toBe(false);
            expect(overlap(sol.box, ns)).toBe(false);
          }
      }
      for (const b of buildings)
        expect(inBox(b.box, s.car.x, s.car.y)).toBe(false);
    });
  }
});
