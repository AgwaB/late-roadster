// Round-3 landmarks for one commute: MAPLE VILLA on the corner right beside the start, and the ONTIME HOLDINGS tower
// on the right-hand corner just before the office crossing, with the CLOCK IN bay (the finish) at its entrance. Both
// follow the commute's guidance route, so the car starts facing down its first road and the HQ is on the arrival
// side. The city is packed with ~10 m buildings, so a landmark takes over a corner rectangle: the city buildings it
// overlaps are neither drawn nor solid, and the landmark's own footprint collides.
import * as C from "./constants";
import {
  type AABB,
  type Building,
  type City,
  type Commute,
  type Node,
  shortestPath,
} from "./city";

export interface Landmark {
  id: "hq_r3" | "villa_r3";
  /** model origin (game coords) and yaw */
  x: number;
  y: number;
  rot: number;
  /** solid parts, game coords */
  solids: Building[];
}

type Pose = { x: number; y: number; heading: number };

export interface LandmarkLayout {
  landmarks: Landmark[];
  /** city buildings replaced by a landmark (not drawn, not solid) */
  skip: Set<Building>;
  /** the solid buildings for this commute: city buildings minus the replaced ones, plus the landmark solids */
  buildings: Building[];
  /** the car's start: lane 0 of the route's first road, just past the home crossing, heading down that road */
  start: Pose;
  /** the finish: the kerb lane in front of the HQ entrance, heading = the direction the route arrives in */
  finish: Pose;
}

// model-local parts (Blender metres, model front = -y): [x0, y0, x1, y1, height]
const PARTS: Record<
  Landmark["id"],
  [number, number, number, number, number][]
> = {
  // tower + entrance canopy/steps (research/raycity/r3-assets/buildings/hq_verification.json)
  hq_r3: [
    [-19, -7.95, 5, 10.05, 43.4],
    [-16, -10.05, 2, -7.95, 10],
  ],
  villa_r3: [[-6, -5, 6, 5, 15.1]],
};

/** ORBIT MART: a 30 x 16 m store in the corridor plaza east of the tunnel, facing the y = 0 avenue; the jet carts
 * wait in its forecourt */
export function martSite(city: City): {
  cx: number;
  /** plaza edge line toward the avenue */
  ey: number;
  /** the avenue is to the south (-y) of the plaza */
  south: boolean;
  box: AABB;
  height: number;
} | null {
  const pz = city.plazas.find(
    (p) =>
      p.x0 > C.MART_BLOCK_I * C.P &&
      p.x1 < (C.MART_BLOCK_I + 1) * C.P &&
      Math.abs(p.y1 + C.ROAD_HALF) < 1,
  );
  if (!pz) return null;
  const cx = (pz.x0 + pz.x1) / 2;
  const south = (pz.y0 + pz.y1) / 2 > 0;
  const ey = south ? pz.y0 + 2 : pz.y1 - 2;
  const front = south ? ey + 10 : ey - 10; // carts in the 8 m forecourt, store close to the road
  return {
    cx,
    ey,
    south,
    box: {
      x0: cx - 15,
      x1: cx + 15,
      y0: south ? front : front - 16,
      y1: south ? front + 16 : front,
    },
    height: 12.3, // MT_01 is 2.44 : 1
  };
}

function commuteRoute(city: City, commute: Commute): Node[] {
  return shortestPath(city, commute.home.id, commute.office.id);
}

export function landmarkLayout(city: City, commute: Commute): LandmarkLayout {
  const skip = new Set<Building>();
  const landmarks: Landmark[] = [];
  const R = C.ROAD_HALF;
  const path = commuteRoute(city, commute);
  const unit = (a: Node, b: Node) => {
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  };
  const d0 = path.length > 1 ? unit(path[0], path[1]) : { x: 1, y: 0 };
  const n = path.length;
  const d1 = n > 1 ? unit(path[n - 2], path[n - 1]) : { x: 1, y: 0 };
  /** the point u metres along d and v metres to its right (right-hand normal (d.y, -d.x)) from node p */
  const at = (p: Node, d: { x: number; y: number }, u: number, v: number) => ({
    x: p.x + d.x * u + d.y * v,
    y: p.y + d.y * u - d.x * v,
  });
  /**
   * A landmark on the lot u0..u1 along d, v0..v1 to its right, front (model -y) facing back toward the road;
   * local = model-local position of the lot centre. Model x runs against d, model y away from the road.
   */
  const place = (
    id: Landmark["id"],
    p: Node,
    d: { x: number; y: number },
    u0: number,
    u1: number,
    v0: number,
    v1: number,
    local: [number, number],
  ) => {
    const rot = Math.atan2(-d.y, -d.x); // model +x -> -d, model +y -> right of d
    const c = Math.cos(rot),
      s = Math.sin(rot);
    const ctr = at(p, d, (u0 + u1) / 2, (v0 + v1) / 2);
    const x = ctr.x - (local[0] * c - local[1] * s),
      y = ctr.y - (local[0] * s + local[1] * c);
    const lot = [at(p, d, u0, v0), at(p, d, u1, v1)];
    const lx0 = Math.min(lot[0].x, lot[1].x),
      lx1 = Math.max(lot[0].x, lot[1].x),
      ly0 = Math.min(lot[0].y, lot[1].y),
      ly1 = Math.max(lot[0].y, lot[1].y);
    for (const b of city.buildings)
      if (
        b.box.x1 > lx0 + 0.5 &&
        b.box.x0 < lx1 - 0.5 &&
        b.box.y1 > ly0 + 0.5 &&
        b.box.y0 < ly1 - 0.5
      )
        skip.add(b);
    const solids = PARTS[id].map(([a0, b0, a1, b1, h]): Building => {
      // the route runs along the grid: the rotated rectangle stays axis-aligned
      const xs = [a0 * c - b0 * s, a1 * c - b1 * s].map((q) => x + q),
        ys = [a0 * s + b0 * c, a1 * s + b1 * c].map((q) => y + q);
      const box: AABB = {
        x0: Math.min(...xs),
        y0: Math.min(...ys),
        x1: Math.max(...xs),
        y1: Math.max(...ys),
      };
      return {
        box,
        kind: "landmark:" + id,
        cx: (box.x0 + box.x1) / 2,
        cy: (box.y0 + box.y1) / 2,
        scale: 1,
        rotY: rot,
        height: h,
      };
    });
    landmarks.push({ id, x, y, rot, solids });
  };
  const office = path[n - 1] ?? commute.office,
    home = path[0] ?? commute.home;
  // tower (24 x 18 m) on the right-hand corner just before the office crossing; its origin sits at (+7, -1.05)
  // from the tower centre
  place("hq_r3", office, d1, -R - 24, -R, R, R + 18, [-7, 1.05]);
  // villa (12 x 10 m) on the right-hand corner just past the home crossing, beside the start
  place("villa_r3", home, d0, R + 4, R + 16, R, R + 10, [0, 0]);
  const buildings = city.buildings.filter((b) => !skip.has(b));
  for (const l of landmarks) buildings.push(...l.solids);
  const mart = martSite(city);
  if (mart)
    buildings.push({
      box: mart.box,
      kind: "landmark:mart",
      cx: (mart.box.x0 + mart.box.x1) / 2,
      cy: (mart.box.y0 + mart.box.y1) / 2,
      scale: 1,
      rotY: 0,
      height: mart.height,
    });
  const s0 = at(home, d0, R + 6, C.laneOffset(0));
  const f = at(office, d1, -R - 12, C.laneOffset(3));
  return {
    landmarks,
    skip,
    buildings,
    start: { ...s0, heading: Math.atan2(d0.y, d0.x) },
    finish: { ...f, heading: Math.atan2(d1.y, d1.x) },
  };
}
