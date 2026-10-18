import { describe, expect, it } from "vitest";
import { Box3, Matrix4, Vector3 } from "three";
import { buildCity, type AABB } from "./city";
import * as C from "./constants";
import { carSpan, newCar } from "./physics";
import { Session } from "./session";
import { DIRECTION as D, LED, type SignCollider, type SignSpot } from "./signs";

const city = buildCity(1);
const signs = city.signs;
const ofKind = (kind: SignCollider["kind"]) =>
  signs.colliders.filter((c) => c.kind === kind);

// Independently transform the render geometry's local bounds with Three's actual yaw convention.
function renderedBox(
  p: SignSpot,
  x: number,
  z: number,
  w: number,
  d: number,
): AABB {
  const matrix = new Matrix4().makeRotationY(p.rot);
  matrix.setPosition(p.x, 0, -p.y);
  const b = new Box3(
    new Vector3(x - w / 2, 0, z - d / 2),
    new Vector3(x + w / 2, 0, z + d / 2),
  ).applyMatrix4(matrix);
  return { x0: b.min.x, x1: b.max.x, y0: -b.max.z, y1: -b.min.z };
}
function expectBox(actual: AABB, expected: AABB) {
  for (const key of ["x0", "x1", "y0", "y1"] as const)
    expect(actual[key]).toBeCloseTo(expected[key], 8);
}
function sessionAt(c: SignCollider, h: number, v = 5) {
  const s = new Session(city, 7, 0);
  s.layout.buildings = [];
  s.props = [];
  const b = c.box;
  // Enter the thin side with the nose, so the minimum translation opposes velocity.
  const alongX = b.x1 - b.x0 < b.y1 - b.y0;
  s.car = newCar(
    alongX ? b.x0 - C.CAR_HALF_L + 0.2 : (b.x0 + b.x1) / 2,
    alongX ? (b.y0 + b.y1) / 2 : b.y0 - C.CAR_HALF_L + 0.2,
    alongX ? 0 : Math.PI / 2,
  );
  Object.assign(s.car, { h, v, invuln: 0, grounded: h === 0 });
  return s;
}

describe("shared overhead-sign placements", () => {
  it.each([1, 7, 42])(
    "keeps the toll gate clear of other gantries and keeps the gantry counts (seed %s)",
    (seed) => {
      const c = buildCity(seed);
      const p = c.signs;
      const tl = c.toll!;
      for (const g of p.direction)
        expect(
          Math.abs(g.x - tl.x) < 70 && Math.abs(g.y - tl.y) < C.ROAD_HALF,
        ).toBe(false);
      for (const g of p.led) expect(g.eid).not.toBe(tl.edge);
      expect([p.direction.length, p.wrecks.length, p.led.length]).toEqual([
        120, 16, 14,
      ]);
    },
  );

  it("bounds the rendered green boards, arms and posts using the same placement list", () => {
    for (const p of signs.direction) {
      const parts = signs.colliders.filter((c) => c.structure === p.id);
      expectBox(
        parts.find((c) => c.kind === "post")!.box,
        renderedBox(p, 0, 0, D.postRadius * 2, D.postRadius * 2),
      );
      expectBox(
        parts.find((c) => c.kind === "arm")!.box,
        renderedBox(p, D.armX, 0, D.armLength, D.armRadius * 2),
      );
      const board = parts.find((c) => c.kind === "board")!;
      expectBox(
        board.box,
        renderedBox(p, D.boardX, 0, D.boardWidth, D.boardDepth),
      );
      expect(board.bottom).toBe(D.boardHeight - D.boardSize / 2);
      expect(board.top).toBe(D.boardHeight + D.boardSize / 2);
    }
  });

  it("bounds both LED faces, frame/ticker and legs at their rendered coordinates", () => {
    for (const p of signs.led) {
      const parts = signs.colliders.filter((c) => c.structure === p.id);
      expectBox(
        parts.find((c) => c.kind === "led-board")!.box,
        renderedBox(p, 0, -0.35, LED.W + 1.2, 0.7),
      );
      const legs = parts.filter((c) => c.kind === "led-post");
      for (const side of [-1, 1]) {
        const x = p.x - p.dy * side * (LED.W / 2 + 0.6),
          y = p.y + p.dx * side * (LED.W / 2 + 0.6);
        const leg = legs.find(
          (c) =>
            Math.abs((c.box.x0 + c.box.x1) / 2 - x) < 0.01 &&
            Math.abs((c.box.y0 + c.box.y1) / 2 - y) < 0.01,
        )!;
        expect(leg).toBeDefined();
        expectBox(leg.box, {
          x0: x - 0.5,
          x1: x + 0.5,
          y0: y - 0.5,
          y1: y + 0.5,
        });
        expect([leg.bottom, leg.top]).toEqual([0, LED.bottom + LED.H + 1.2]);
      }
    }
    const { tx, W, H, bottom } = signs.tunnel;
    expectBox(ofKind("tunnel-board")[0].box, {
      x0: tx,
      x1: tx + 0.85,
      y0: -(W + 1.6) / 2,
      y1: (W + 1.6) / 2,
    });
    expect(ofKind("tunnel-board")[0].bottom).toBe(bottom - 2.6);
    expect(ofKind("tunnel-board")[0].top).toBe(bottom + H + 1.6);
    for (const leg of ofKind("tunnel-post")) {
      expect(leg.bottom).toBe(C.CEIL_H); // roof-mounted, not a phantom leg across the tunnel lane
      expect(leg.box.x0).toBeCloseTo(tx + 0.9);
    }
  });

  it("shares wreck transforms with rendering and keys wrecks to their parent board", () => {
    signs.wrecks.forEach((p, i) => {
      expect(signs.direction.find((g) => g.id === p.id)).toBeDefined();
      const c = ofKind("wreck").find((c) => c.structure === p.id)!;
      expectBox(c.box, renderedBox(p, p.localX, 0, 3, 5));
      const side = (i + 1) % 2 ? 1 : -1;
      expect([p.localX, p.height, p.roll, p.yaw, p.pitch]).toEqual([
        6 + 0.4 * side,
        6.25,
        0.18 * side,
        Math.PI / 2,
        -0.32,
      ]);
    });
    expect(signs.colliders.length).toBe(541);
  });
});

describe("height-aware sign contacts", () => {
  it.each([
    "board",
    "wreck",
    "led-board",
    "tunnel-board",
    "tunnel-post",
  ] as const)("drives below every %s without contact", (kind) => {
    for (const c of ofKind(kind)) {
      const s = sessionAt(c, 0, 30);
      const p = signs.direction.find((p) => p.id === c.structure);
      Object.assign(s.car, {
        x: (c.box.x0 + c.box.x1) / 2,
        y: (c.box.y0 + c.box.y1) / 2,
        heading: p ? p.rot - Math.PI / 2 : s.car.heading,
      });
      const before = { x: s.car.x, y: s.car.y };
      expect(s["collideStatic"](true)).toEqual([]);
      expect({ x: s.car.x, y: s.car.y }).toEqual(before);
    }
  });

  it.each(["board", "arm", "led-board", "tunnel-board"] as const)(
    "crashes when flying fast into a %s",
    (kind) => {
      const c = ofKind(kind)[0],
        s = sessionAt(c, c.bottom + 0.1, 30);
      expect(s["collideStatic"](true)).toEqual(["crash:sign"]);
      expect(s.car.state).toBe("crash");
    },
  );

  it.each(["post", "led-post"] as const)(
    "hits a %s at ground level",
    (kind) => {
      const s = sessionAt(ofKind(kind)[0], 0, 5);
      expect(s["collideStatic"](true)).toEqual(["wall"]);
      expect(s.car.state).toBe("drive");
    },
  );

  it("hits the speared car beyond the thin board plane", () => {
    const c = ofKind("wreck")[0],
      s = sessionAt(c, 5, 5);
    const p = signs.wrecks[0],
      z = -2.5 - C.CAR_HALF_L + 0.2;
    Object.assign(s.car, {
      x: p.x + Math.cos(p.rot) * p.localX + Math.sin(p.rot) * z,
      y: p.y + Math.sin(p.rot) * p.localX - Math.cos(p.rot) * z,
      heading: p.rot - Math.PI / 2,
    });
    const board = ofKind("board").find((b) => b.structure === c.structure)!;
    expect(s["penetration"](board.box)).toBeNull();
    expect(s["collideStatic"](true)).toEqual(["wall"]);
  });

  it("uses the rotated carSpan rather than a fixed roof height", () => {
    const c = ofKind("board")[0],
      s = sessionAt(c, c.bottom - 1.8);
    s.car.pitch = Math.PI / 2;
    expect(s.car.h + C.CAR_ROOF).toBeLessThan(c.bottom);
    expect(carSpan(s.car).top).toBeGreaterThan(c.bottom);
    expect(s["collideStatic"](true)).toEqual(["wall"]);
  });

  it("passes above the entire structure", () => {
    const c = ofKind("board")[0],
      s = sessionAt(c, 12, 30);
    expect(s["collideStatic"](true)).toEqual([]);
  });

  it("resolves contact but does not crash through a closed crash gate", () => {
    const c = ofKind("board")[0],
      s = sessionAt(c, 6, 30);
    expect(s["collideStatic"](false)).toEqual(["wall"]);
    expect(s.car.state).toBe("drive");
  });

  it("fires one effect per structure even across different parts in a frame", () => {
    const c = ofKind("board")[0],
      s = sessionAt(c, 6);
    s["contactEffects"] = new Set();
    expect(s["collideStatic"](true)).toEqual(["wall"]);
    const leg = ofKind("post").find((p) => p.structure === c.structure)!;
    s.car = sessionAt(leg, 0).car;
    const heading = s.car.heading,
      v = s.car.v;
    expect(s["collideStatic"](true)).toEqual([]);
    expect([s.car.heading, s.car.v]).toEqual([heading, v]);
    expect(s["penetration"](leg.box)).toBeNull();
  });

  it("keeps every skyway driving lane clear at deck height", () => {
    const s = sessionAt(ofKind("board")[0], city.skyway.h);
    for (let x = city.skyway.x0; x <= city.skyway.x1; x += 2) {
      for (const y of [-C.laneOffset(0), C.laneOffset(0)]) {
        Object.assign(s.car, { x, y, heading: 0 });
        expect(s["collideStatic"](true)).toEqual([]);
      }
    }
  });
});
