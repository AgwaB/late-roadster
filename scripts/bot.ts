// "Careful human" bot: follows the shortest road path, changes lanes around traffic, jumps when blocked, sticks in tunnels.
import * as C from "../src/game/constants";
import { type City, inTunnel, shortestPath, type Node } from "../src/game/city";
import { NO_INPUT, type Input } from "../src/game/physics";
import type { Session } from "../src/game/session";

const DT = 1 / 60;

export function makeBot(city: City, s: Session) {
  // Start the path from the intersection ahead of the spawn (the car faces east), so the first leg matches the heading.
  const home = s.commute.home;
  const ahead =
    city.nodes[
      city.nodeIndex.get((home.i === -1 ? 1 : home.i + 1) + "," + home.j) ??
        home.id
    ];
  const path: Node[] = [
    home,
    ...shortestPath(city, ahead.id, s.commute.office.id),
  ];
  let wp = 1;
  let laneShift = 0; // metres to the left of the lane-0 line
  let shiftCd = 0;
  return (): Input => {
    const car = s.car;
    // advance waypoints
    while (
      wp < path.length - 1 &&
      Math.hypot(path[wp].x - car.x, path[wp].y - car.y) < 18
    )
      wp++;
    const a = path[wp - 1],
      b = path[wp];
    const ux = Math.sign(b.x - a.x),
      uy = Math.sign(b.y - a.y);
    // lane-0 line is to the right of the centreline: right normal of (ux,uy) = (uy,-ux)
    const off = C.laneOffset(0) - laneShift;
    const target = { x: b.x + uy * off, y: b.y - ux * off };
    // look-ahead point along the current segment
    const look = 22;
    const px = car.x + Math.cos(car.heading) * look,
      py = car.y + Math.sin(car.heading) * look;
    // desired point: project onto the lane line of the current segment, then advance
    const lx = a.x + uy * off,
      ly = a.y - ux * off;
    const t = (car.x - lx) * ux + (car.y - ly) * uy + look;
    let dx = lx + ux * t,
      dy = ly + uy * t;
    if (Math.hypot(b.x - car.x, b.y - car.y) < look + 10) {
      dx = target.x;
      dy = target.y;
    }
    let ang = Math.atan2(dy - car.y, dx - car.x) - car.heading;
    let err = Math.atan2(Math.sin(ang), Math.cos(ang));
    if (Math.abs(err) > 1.9) {
      // target is behind us (missed a turn): re-plan from the nearest intersection ahead
      const fx0 = Math.cos(car.heading),
        fy0 = Math.sin(car.heading);
      let best = path[wp],
        bd = Infinity;
      for (const n of city.nodes) {
        const d = Math.hypot(
          n.x - (car.x + fx0 * 70),
          n.y - (car.y + fy0 * 70),
        );
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
      const np = shortestPath(city, best.id, s.commute.office.id);
      path.splice(0, path.length, path[wp - 1], ...np);
      wp = 1;
      ang = Math.atan2(np[0].y - car.y, np[0].x - car.x) - car.heading;
      err = Math.atan2(Math.sin(ang), Math.cos(ang));
    }
    const steer = Math.max(-1, Math.min(1, err * 2.2));
    void px;
    void py;
    // traffic ahead in my corridor?
    let blocked = Infinity,
      blockedLeft = Infinity,
      blockedRight = Infinity;
    const fx = Math.cos(car.heading),
      fy = Math.sin(car.heading);
    for (const n of s.traffic.npcs) {
      if (n.dead) continue;
      const rx = n.x - car.x,
        ry = n.y - car.y;
      const ahead = rx * fx + ry * fy,
        side = -rx * fy + ry * fx; // side + = left
      if (ahead < -2 || ahead > 60) continue;
      if (Math.abs(side) < 2.6) blocked = Math.min(blocked, ahead);
      if (side >= 2.6 && side < 6) blockedLeft = Math.min(blockedLeft, ahead);
      if (side <= -2.6 && side > -6)
        blockedRight = Math.min(blockedRight, ahead);
    }
    for (const p of s.props) {
      if (p.kind === "cone" || p.kind === "wall") continue;
      const cx = (p.box.x0 + p.box.x1) / 2,
        cy = (p.box.y0 + p.box.y1) / 2;
      const rx = cx - car.x,
        ry = cy - car.y;
      const ahead = rx * fx + ry * fy,
        side = -rx * fy + ry * fx;
      const hw = Math.max(p.box.x1 - p.box.x0, p.box.y1 - p.box.y0) / 2;
      if (ahead < -2 || ahead > 60) continue;
      if (Math.abs(side) < 2.6 + hw) blocked = Math.min(blocked, ahead);
    }
    shiftCd -= DT;
    if (blocked < 32 && shiftCd <= 0) {
      // pick a free side: lane 1 (right, shift -3.5) or oncoming lane (left, +3.5)
      if (blockedRight > 40 && laneShift > -3.5) laneShift -= 3.5;
      else if (blockedLeft > 40 && laneShift < 3.5) laneShift += 3.5;
      shiftCd = 0.8;
    } else if (blocked > 50 && laneShift !== 0 && shiftCd <= 0) {
      laneShift = 0;
      shiftCd = 1.0;
    }
    const jump = blocked < 14 && car.grounded;
    const stick =
      inTunnel(city, car.x + fx * 15, car.y + fy * 15) ||
      inTunnel(city, car.x, car.y);
    // Raycity layout: hold gas; Shift-drift when the turn is sharp; booster on straights with SP to spare; brake before corners
    const sharp = Math.abs(err) > 0.5;
    const corner =
      Math.hypot(b.x - car.x, b.y - car.y) < 45 &&
      path[wp + 1] &&
      (path[wp + 1].x - b.x) * ux + (path[wp + 1].y - b.y) * uy === 0;
    const brake = corner && car.v > 30 && !sharp;
    const boost =
      !sharp && !corner && blocked > 60 && car.sp > 40 && car.grounded;
    return {
      ...NO_INPUT,
      steer,
      jump,
      stick,
      accel: !brake,
      brake,
      drift: sharp && car.grounded,
      boost,
      sidestep: 0,
    };
  };
}
