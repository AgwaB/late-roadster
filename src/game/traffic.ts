// Traffic NPCs driving the road graph: lanes, random turns at intersections, car-following, event behaviours.
import * as C from "./constants";
import { type City, type Edge, edgePose, straightOn } from "./city";
import { mulberry32 } from "./rng";
import { VEHICLE_DIMS, type VehicleDims } from "./dims";

export type NpcKind =
  | "sedan"
  | "sedan2"
  | "hatchback"
  | "wagon"
  | "suv"
  | "taxi"
  | "police"
  | "van"
  | "truck"
  | "pickup"
  | "sports"
  | "convertible"
  | "bus"
  | "camper"
  | "roadster";
export type Behavior =
  | "cruise"
  | "camper"
  | "suddenBus"
  | "merge"
  | "wrongWay"
  | "ambulance"
  | "bounce"
  | "spill"
  | "commuter";

/** Airborne / stunt animation shown by the renderer and ignored by collision while high. */
export interface NpcAnim {
  kind: "hop" | "flip" | "fail" | "knock" | "skip" | "soar";
  t: number;
  dur: number;
  /** flip over the car ahead: speed held through the stunt (set by a thruster kick at take-off) */
  vT?: number;
}

export interface Npc {
  id: number;
  kind: NpcKind;
  behavior: Behavior;
  edge: Edge;
  dir: 1 | -1;
  s: number;
  lane: number;
  v: number;
  vCruise: number;
  halfL: number;
  halfW: number;
  h: number;
  x: number;
  y: number;
  heading: number;
  turn: {
    p0: [number, number];
    p1: [number, number];
    p2: [number, number];
    len: number;
    t: number;
    next: Edge;
    nextDir: 1 | -1;
    /** lane on the next road (moved out of an inner lane closed there) */
    lane: number;
  } | null;
  braking: boolean;
  ttl: number;
  dead: boolean;
  stomped: boolean;
  /** render offsets from stunts (bouncing bus, commuter roadsters) */
  yOff: number;
  pitch: number;
  roll: number;
  anim: NpcAnim | null;
  /** behaviour scratch: merge target lane, stunt timer, resolved flags */
  laneTarget: number;
  timer: number;
  flag: 0 | 1 | 2;
}

/** What the NPC renderer needs: pose + stunt offsets (also satisfied by the session's ceiling cars). */
export type NpcPose = Pick<
  Npc,
  "kind" | "x" | "y" | "heading" | "yOff" | "pitch" | "roll" | "dead"
>;

/** Collision box per kind = the rendered model's body (src/game/dims.ts). */
export const NPC_DIMS: Record<NpcKind, VehicleDims> = VEHICLE_DIMS;

/** Vertical extent of an NPC's body for its current stunt pose (the model pivots on its bottom centre). */
export function npcSpan(n: {
  yOff: number;
  pitch: number;
  roll: number;
  halfL: number;
  halfW: number;
  h: number;
}): { bottom: number; top: number } {
  if (n.pitch === 0 && n.roll === 0)
    return { bottom: n.yOff, top: n.yOff + n.h };
  // world-up component of a body point (x fwd, y up, z side) after Rz(pitch) then Rx(roll): cr*(x sp + y cp) - z sr
  const cr = Math.cos(n.roll),
    sr = Math.sin(n.roll);
  const ax = Math.abs(cr * Math.sin(n.pitch)) * n.halfL,
    az = Math.abs(sr) * n.halfW,
    hy = cr * Math.cos(n.pitch) * n.h;
  return {
    bottom: n.yOff - ax - az + Math.min(0, hy),
    top: n.yOff + ax + az + Math.max(0, hy),
  };
}

/** Relative mass for collision impulses (the player's roadster = 1). */
export const NPC_MASS: Record<NpcKind, number> = {
  sedan: 1.1,
  sedan2: 1.1,
  hatchback: 1,
  wagon: 1.2,
  suv: 1.5,
  taxi: 1.1,
  police: 1.3,
  van: 1.8,
  truck: 3.5,
  pickup: 1.6,
  sports: 1,
  convertible: 1,
  bus: 5,
  camper: 1.8,
  roadster: 1,
};

const CRUISE_KINDS: NpcKind[] = [
  "sedan",
  "sedan",
  "sedan2",
  "sedan2",
  "hatchback",
  "wagon",
  "suv",
  "suv",
  "taxi",
  "taxi",
  "taxi",
  "van",
  "truck",
  "pickup",
  "sports",
  "convertible",
  "police",
  "bus",
];

/** A lane on this road clear of an inner lane closed there (lane 1 instead of 0 beside the skyway's ramps). */
function laneOn(edge: Edge, lane: number): number {
  const m = edge.laneMin ?? 0;
  return lane >= 0 && lane < m ? m : lane;
}

/** Distance to back the rear body out of an overlapping OBB along its heading (SAT).
 * Vertical separation deliberately allows jets and backflips to pass over traffic.
 */
function contactBackoff(rear: Npc, front: Npc): number {
  const reach = rear.halfL + rear.halfW + front.halfL + front.halfW;
  const dx = front.x - rear.x,
    dy = front.y - rear.y;
  if (Math.abs(dx) > reach || Math.abs(dy) > reach) return 0;
  const a = npcSpan(rear),
    b = npcSpan(front);
  if (a.bottom >= b.top - 0.01 || b.bottom >= a.top - 0.01) return 0;
  const rx = Math.cos(rear.heading),
    ry = Math.sin(rear.heading);
  const fx = Math.cos(front.heading),
    fy = Math.sin(front.heading);
  let backoff = Infinity;
  for (const [ax, ay] of [
    [rx, ry],
    [-ry, rx],
    [fx, fy],
    [-fy, fx],
  ]) {
    const radius =
      rear.halfL * Math.abs(rx * ax + ry * ay) +
      rear.halfW * Math.abs(-ry * ax + rx * ay) +
      front.halfL * Math.abs(fx * ax + fy * ay) +
      front.halfW * Math.abs(-fy * ax + fx * ay);
    const d = dx * ax + dy * ay;
    if (Math.abs(d) >= radius - 1e-6) return 0;
    const along = rx * ax + ry * ay;
    if (Math.abs(along) > 1e-6)
      backoff = Math.min(
        backoff,
        (radius - Math.sign(along) * d) / Math.abs(along),
      );
  }
  return backoff + 0.001;
}

export class Traffic {
  npcs: Npc[] = [];
  private nextId = 1;
  /** own stream for ambient backflips, so the stunts never shift the traffic/event sequence */
  private flipRnd = mulberry32(0x5eedf11b);
  /** potholes by road edge, and the toll plaza's road (fellow roadsters fly over its queue) */
  private potholes = new Map<Edge, import("./city").Pothole[]>();
  private tollEdge: Edge | undefined;

  constructor(
    private city: City,
    private rnd: () => number,
    count = 220,
  ) {
    for (const p of city.potholes) {
      const e = city.edges[p.edge];
      (this.potholes.get(e) ?? this.potholes.set(e, []).get(e)!).push(p);
    }
    if (city.toll) this.tollEdge = city.edges[city.toll.edge];
    for (let i = 0; i < count; i++) {
      // (count scales with the bigger map)
      const edge = city.edges[Math.floor(rnd() * city.edges.length)];
      const kind = CRUISE_KINDS[Math.floor(rnd() * CRUISE_KINDS.length)];
      const heavy =
        kind === "truck" ||
        kind === "van" ||
        kind === "bus" ||
        kind === "pickup";
      const lane = heavy ? 1 + Math.floor(rnd() * 2) : Math.floor(rnd() * 3); // lane 3 is kerb parking
      const dir: 1 | -1 = rnd() < 0.5 ? 1 : -1;
      const vCruise = 30 - lane * 3.5 + rnd() * 4;
      const n = this.add(
        kind,
        "cruise",
        edge,
        dir,
        C.ROAD_HALF + rnd() * (edge.len - 2 * C.ROAD_HALF),
        lane,
        vCruise,
        1e9,
      );
      n.timer = 1 + this.flipRnd() * 8; // ordinary traffic backflips too (staggered start)
    }
  }

  private add(
    kind: NpcKind,
    behavior: Behavior,
    edge: Edge,
    dir: 1 | -1,
    s: number,
    lane: number,
    v: number,
    ttl: number,
  ): Npc {
    lane = laneOn(edge, lane);
    const p = edgePose(this.city, edge, dir, s, lane);
    const npc: Npc = {
      id: this.nextId++,
      kind,
      behavior,
      edge,
      dir,
      s,
      lane,
      v,
      vCruise: v,
      ...NPC_DIMS[kind],
      x: p.x,
      y: p.y,
      heading: p.heading,
      turn: null,
      braking: false,
      ttl,
      dead: false,
      stomped: false,
      yOff: 0,
      pitch: 0,
      roll: 0,
      anim: null,
      laneTarget: lane,
      timer: 0,
      flag: 0,
    };
    this.npcs.push(npc);
    return npc;
  }

  /** Events raised by NPC behaviours this frame (drained by the session). */
  events: string[] = [];

  spawnCamper(edge: Edge, dir: 1 | -1, s: number): Npc {
    return this.add("camper", "camper", edge, dir, s, 0, 15, 25);
  }
  spawnSuddenBus(edge: Edge, dir: 1 | -1, s: number, lane: number): Npc {
    return this.add("bus", "suddenBus", edge, dir, s, lane, 22, 25);
  }
  /** Kerb-lane taxi that pulls into the player's lane without indicating once the player is close behind. */
  spawnMergeTaxi(edge: Edge, dir: 1 | -1, s: number, playerLane: number): Npc {
    const n = this.add("taxi", "merge", edge, dir, s, 3, 4, 25);
    n.laneTarget = playerLane;
    return n;
  }
  /** Oncoming car in the player's own carriageway: lane offset mirrored across the median. */
  spawnWrongWay(edge: Edge, dir: 1 | -1, s: number, playerLane: number): Npc {
    const mirrored = -(1 + (2 * C.MEDIAN_HALF) / C.LANE_W) - playerLane;
    const n = this.add(
      "sedan2",
      "wrongWay",
      edge,
      -dir as 1 | -1,
      edge.len - s,
      mirrored,
      22,
      30,
    );
    return n;
  }
  /** Ambulance (white van) coming up fast behind in the player's lane. */
  spawnAmbulance(edge: Edge, dir: 1 | -1, s: number, lane: number): Npc {
    // faster than the player's 42 m/s cruise, so it actually catches up (it is 65 m behind)
    return this.add("van", "ambulance", edge, dir, s, lane, 58, 30);
  }
  /** Bus that somersaults at every stop. */
  spawnBounceBus(edge: Edge, dir: 1 | -1, s: number, lane: number): Npc {
    const n = this.add("bus", "bounce", edge, dir, s, lane, 20, 40);
    n.timer = 1.5;
    return n;
  }
  /** Truck whose load slides off when the player gets close (the session spawns the crates). */
  spawnSpillTruck(edge: Edge, dir: 1 | -1, s: number, lane: number): Npc {
    return this.add("truck", "spill", edge, dir, s, lane, 16, 30);
  }
  /** Fellow commuters in roadsters: fast, show-offs, occasionally botch a flip. */
  spawnCommuters(count: number): void {
    for (let i = 0; i < count; i++) {
      const edge =
        this.city.edges[Math.floor(this.rnd() * this.city.edges.length)];
      const dir: 1 | -1 = this.rnd() < 0.5 ? 1 : -1;
      const n = this.add(
        "roadster",
        "commuter",
        edge,
        dir,
        C.ROAD_HALF + this.rnd() * (edge.len - 2 * C.ROAD_HALF),
        Math.floor(this.rnd() * 3),
        32 + this.rnd() * 6,
        1e9,
      );
      n.timer = 0.5 + this.rnd() * 1.5; // fellow roadsters start showing off almost at once
    }
  }

  /** Stunt timeline: hop = jump, flip = jump + 360°, fail = flip that lands on the roof and spins out. */
  private stepAnim(n: Npc, dt: number): void {
    const a = n.anim;
    if (!a) return;
    a.t += dt;
    const u = Math.min(1, a.t / a.dur);
    const arc = Math.sin(Math.PI * u);
    if (a.kind === "hop") {
      n.yOff = 3.5 * arc;
      n.pitch = 0.25 * Math.sin(2 * Math.PI * u);
    } else if (a.kind === "flip") {
      // a jump first: shoot up for the first 15 %, turn over through the top, finish before touchdown
      const k = C.clamp((u - 0.15) / 0.7, 0, 1);
      n.yOff = 6 * arc;
      n.pitch = 2 * Math.PI * k * k * (3 - 2 * k);
      // turn about mid-height, not about the wheels
      n.yOff += (n.h / 2) * (1 - Math.cos(n.pitch));
    } else if (a.kind === "skip") {
      // a jet hop over a sinkhole
      n.yOff = 3.2 * arc;
      n.pitch = 0.12 * Math.sin(2 * Math.PI * u);
    } else if (a.kind === "soar") {
      // a fellow roadster flying the whole toll queue: up, level just over the canopy roof, down past the arms
      const sm = (k: number) => {
        const q = C.clamp(k, 0, 1);
        return q * q * (3 - 2 * q);
      };
      n.yOff = 8.2 * sm(u / 0.22) * (1 - sm((u - 0.8) / 0.2));
      n.pitch =
        u < 0.22
          ? 0.18 * Math.sin((Math.PI * u) / 0.22)
          : u > 0.8
            ? -0.12 * Math.sin((Math.PI * (u - 0.8)) / 0.2)
            : 0;
    } else if (a.kind === "knock") {
      // shoved by the player: a short jolt and a sideways rock
      n.yOff = 0.5 * arc;
      n.pitch = 0;
      n.roll = 0.35 * Math.sin(3 * Math.PI * u) * (1 - u);
    } else {
      // fail (a botched flip, or flattened by a backflipper): a full barrel roll that slams back down on its wheels,
      // then a hard bounce and a wobble while it bleeds speed. It never ends on its roof: a car left driving upside
      // down read as a bug. A roll (not a pitch) keeps the nose pointing ahead.
      if (u < 0.45) {
        const k = C.clamp((u / 0.45 - 0.1) / 0.9, 0, 1);
        n.yOff = 4.5 * Math.sin((Math.PI * u) / 0.45);
        n.roll = 2 * Math.PI * k * k * (3 - 2 * k);
      } else {
        const w = (u - 0.45) / 0.55; // 0 -> 1 after touchdown
        const fade = 1 - w;
        n.yOff = 0.7 * Math.abs(Math.sin(w * Math.PI * 3)) * fade * fade;
        n.roll = 0.35 * Math.sin(w * 18) * fade;
      }
      n.pitch = 0;
      n.yOff += (n.h / 2) * (1 - Math.cos(n.roll)); // roll about mid-height
    }
    // the model pivots on its bottom centre: lift it so no rotated corner dips into the road
    n.yOff -= Math.min(0, npcSpan(n).bottom);
    if (u >= 1) {
      n.anim = null;
      n.yOff = 0;
      n.pitch = 0;
      n.roll = 0;
    }
  }

  private beginTurn(n: Npc, straight?: { edge: Edge; dir: 1 | -1 }): void {
    const city = this.city;
    const node = city.nodes[n.dir > 0 ? n.edge.b : n.edge.a];
    const options = node.edges
      .filter((id) => id !== n.edge.id)
      .map((id) => city.edges[id]);
    let next: Edge;
    if (straight) next = straight.edge;
    else if (options.length === 0)
      next = n.edge; // dead end: U-turn
    else {
      const straight = options.filter((e) => e.axis === n.edge.axis);
      next =
        straight.length && this.rnd() < 0.6
          ? straight[0]
          : options[Math.floor(this.rnd() * options.length)];
    }
    const nextDir: 1 | -1 = next.a === node.id ? 1 : -1;
    const lane = laneOn(next, n.lane);
    const p0 = edgePose(city, n.edge, n.dir, n.edge.len - C.ROAD_HALF, n.lane);
    const p2 = edgePose(city, next, nextDir, C.ROAD_HALF, lane);
    const u0 = [Math.cos(p0.heading), Math.sin(p0.heading)];
    const d = [p2.x - p0.x, p2.y - p0.y];
    const proj = d[0] * u0[0] + d[1] * u0[1];
    const straightOn = next.axis === n.edge.axis && next !== n.edge;
    const p1: [number, number] = straightOn
      ? [(p0.x + p2.x) / 2, (p0.y + p2.y) / 2]
      : [p0.x + u0[0] * Math.max(2, proj), p0.y + u0[1] * Math.max(2, proj)];
    const l01 = Math.hypot(p1[0] - p0.x, p1[1] - p0.y),
      l12 = Math.hypot(p2.x - p1[0], p2.y - p1[1]),
      l02 = Math.hypot(d[0], d[1]);
    n.turn = {
      p0: [p0.x, p0.y],
      p1,
      p2: [p2.x, p2.y],
      len: Math.max(1, (l01 + l12 + l02) / 2),
      t: 0,
      next,
      nextDir,
      lane,
    };
  }

  /** Keep path coordinates and world pose in sync when a contact backs up a turning car. */
  private pose(n: Npc): void {
    const tr = n.turn;
    if (!tr) {
      Object.assign(n, edgePose(this.city, n.edge, n.dir, n.s, n.lane));
      return;
    }
    const t = tr.t,
      u = 1 - t;
    n.x = u * u * tr.p0[0] + 2 * u * t * tr.p1[0] + t * t * tr.p2[0];
    n.y = u * u * tr.p0[1] + 2 * u * t * tr.p1[1] + t * t * tr.p2[1];
    const tx = 2 * u * (tr.p1[0] - tr.p0[0]) + 2 * t * (tr.p2[0] - tr.p1[0]);
    const ty = 2 * u * (tr.p1[1] - tr.p0[1]) + 2 * t * (tr.p2[1] - tr.p1[1]);
    if (Math.abs(tx) + Math.abs(ty) > 1e-6) n.heading = Math.atan2(ty, tx);
  }

  private retreat(n: Npc, distance: number): void {
    if (n.turn) {
      n.turn.t -= distance / n.turn.len;
      if (n.turn.t < 0) {
        n.s = n.edge.len - C.ROAD_HALF + n.turn.t * n.turn.len;
        n.turn = null;
      }
    } else n.s -= distance;
    this.pose(n);
  }

  private separate(): void {
    // Front-to-back handles a whole queue in one pass, independently of spawn order.
    // Recheck current bodies after corrections: merges/turns can touch another queue.
    const cars = this.npcs
      .filter((n) => !n.dead)
      .sort((a, b) => b.s - a.s || a.id - b.id);
    const impacted = new Set<string>();
    for (let pass = 0; pass < cars.length; pass++) {
      let moved = false;
      // Sweep the current world-space bounds, not every pair in the city. Rebuild
      // each pass because a correction can introduce a new neighbouring contact.
      const sweep = cars
        .map((n, i) => ({ n, i, r: n.halfL + n.halfW }))
        .sort((a, b) => a.n.x - a.r - (b.n.x - b.r));
      const pairs: [number, number][] = [];
      for (let i = 0; i < sweep.length; i++) {
        const a = sweep[i];
        for (let j = i + 1; j < sweep.length; j++) {
          const b = sweep[j];
          if (b.n.x - b.r > a.n.x + a.r) break;
          if (Math.abs(a.n.y - b.n.y) > a.r + b.r) continue;
          pairs.push(a.i < b.i ? [a.i, b.i] : [b.i, a.i]);
        }
      }
      pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (const [i, j] of pairs) {
        const a = cars[i],
          b = cars[j];
        if (!contactBackoff(a, b)) continue;
        // Same route: greater progress wins. At crossings, yield to the car ahead
        // along the mean heading; opposing streams use stable ID priority.
        const alignment = Math.cos(a.heading - b.heading);
        const ahead =
          (b.x - a.x) * (Math.cos(a.heading) + Math.cos(b.heading)) +
          (b.y - a.y) * (Math.sin(a.heading) + Math.sin(b.heading));
        const aRear =
          a.edge === b.edge && a.dir === b.dir
            ? a.s + (a.turn?.t ?? 0) * (a.turn?.len ?? 0) <
              b.s + (b.turn?.t ?? 0) * (b.turn?.len ?? 0)
            : alignment > -0.5
              ? ahead > 0
              : a.id > b.id;
        const [rear, front] = aRear ? [a, b] : [b, a];
        const key = `${a.id}:${b.id}`;
        if (!impacted.has(key)) {
          impacted.add(key);
          const stunt = (n: Npc) =>
            n.anim &&
            (n.anim.kind === "flip" || n.anim.kind === "fail") &&
            n.yOff > 0.3;
          if (stunt(a) || stunt(b)) {
            const hit = stunt(a) ? b : a;
            if (
              !hit.anim ||
              hit.anim.kind === "hop" ||
              hit.anim.kind === "knock"
            ) {
              hit.anim = { kind: "fail", t: 0, dur: 2.6 };
              this.events.push("npccrash:" + hit.id);
            }
            a.v *= 0.6;
            b.v *= 0.6;
          }
        }
        // Small path steps on curves avoid treating a curved turn as a straight ray.
        for (let k = 0; k < 32; k++) {
          const distance = contactBackoff(rear, front);
          if (!distance) break;
          this.retreat(rear, rear.turn ? Math.min(1, distance) : distance);
          moved = true;
        }
        rear.v = Math.min(
          rear.v,
          Math.max(0, front.v * Math.cos(front.heading - rear.heading)),
        );
      }
      if (!moved) break;
    }
  }

  update(
    dt: number,
    player: { x: number; y: number; heading: number; v?: number } | null,
  ): void {
    for (const n of this.npcs) {
      if (n.dead) continue;
      n.ttl -= dt;
      if (n.ttl <= 0) {
        n.dead = true;
        continue;
      }
      // persistent NPCs keep driving through intersections; the short-lived ones die at the edge end / behind the player
      const persistent =
        n.behavior === "cruise" ||
        n.behavior === "commuter" ||
        n.behavior === "bounce" ||
        n.behavior === "spill" ||
        n.behavior === "merge";
      if (!persistent && player) {
        const dx = n.x - player.x,
          dy = n.y - player.y;
        const ahead =
          dx * Math.cos(player.heading) + dy * Math.sin(player.heading);
        if (ahead < -80 || Math.hypot(dx, dy) > 400) {
          n.dead = true;
          continue;
        }
      }
      // speed target
      let target = n.vCruise;
      let hardBrake = false;
      this.stepAnim(n, dt);
      // ambient traffic: a backflip every 5-11 s per car (meme city: everyone flips)
      if (n.behavior === "cruise") {
        n.timer -= dt;
        if (n.timer <= 0 && !n.anim && !n.turn) {
          const r = this.flipRnd();
          n.anim = {
            kind: r < 0.12 ? "hop" : r < 0.94 ? "flip" : "fail",
            t: 0,
            dur: r < 0.94 ? 1.3 : 2.6,
          };
          n.timer = 5 + this.flipRnd() * 6;
        }
      }
      if (player) {
        const dxp = player.x - n.x,
          dyp = player.y - n.y;
        const cosH = Math.cos(n.heading),
          sinH = Math.sin(n.heading);
        const pAhead = dxp * cosH + dyp * sinH; // player ahead of this NPC (+) / behind (-)
        const pSide = -dxp * sinH + dyp * cosH;
        // ordinary drivers do not rear-end the player: follow / brake when the player sits in their lane ahead
        const gap = pAhead - n.halfL - 2.5; // bumper-to-bumper
        const look = Math.max(30, n.v * 1.5 + 8); // faster cars look further ahead
        if (
          n.behavior !== "wrongWay" &&
          n.behavior !== "ambulance" &&
          gap > -2 &&
          gap < look &&
          Math.abs(pSide) < 3.0
        ) {
          const pv = Math.max(
            0,
            (player.v ?? 0) * Math.cos(player.heading - n.heading),
          ); // player speed along our direction
          // speed that still lets us stop 3 m short at 10 m/s^2 (the actual brake rate is 18)
          const allowed = Math.sqrt(Math.max(0, pv * pv + 2 * 10 * (gap - 3)));
          target = Math.min(target, allowed);
          hardBrake = true;
        }
        if (n.behavior === "merge") {
          if (n.flag === 0 && pAhead < 0 && pAhead > -45) {
            n.flag = 1;
            this.events.push("taxi");
          }
          if (n.flag === 1) {
            target = 14;
            if (n.lane !== n.laneTarget) {
              const step = Math.min(Math.abs(n.lane - n.laneTarget), 0.9 * dt);
              n.lane += Math.sign(n.laneTarget - n.lane) * step;
            }
          } else target = 4;
        } else if (n.behavior === "ambulance") {
          if (n.flag === 0) {
            if (pAhead > 0 && pAhead < 16 && Math.abs(pSide) < 2.3) {
              // blocked by the player: tailgate, wail
              target = pAhead < 9 ? 0 : 12;
              n.timer += dt;
              if (n.timer > 2.5) {
                n.flag = 2;
                this.events.push("ambulance:siren");
              }
            } else if (pAhead < -4) {
              n.flag = 1;
              this.events.push("ambulance:thanks");
            } else if (
              pAhead < 60 &&
              pAhead > 0 &&
              n.timer === 0 &&
              n.flag === 0 &&
              !n.braking
            ) {
              n.braking = true; // first contact: announce
              this.events.push("ambulance");
            }
          }
        } else if (n.behavior === "spill") {
          if (n.flag === 0 && pAhead < 0 && pAhead > -50) {
            n.flag = 1;
            this.events.push("spill:" + n.id);
            target = 10;
          }
        } else if (n.behavior === "bounce") {
          n.timer -= dt;
          if (n.timer <= 0 && !n.anim) {
            n.anim = { kind: "flip", t: 0, dur: 1.6 };
            n.timer = 3.5 + this.rnd() * 1.5;
          }
        } else if (n.behavior === "commuter") {
          n.timer -= dt;
          if (n.timer <= 0 && !n.anim && !n.turn) {
            const r = this.rnd();
            // nearly always a backflip (hop 8 %, backflip 80 %, botched flip 12 %)
            n.anim = {
              kind: r < 0.08 ? "hop" : r < 0.88 ? "flip" : "fail",
              t: 0,
              dur: r < 0.88 ? 1.3 : 2.6,
            };
            if (n.anim.kind === "fail") this.events.push("npcfail:" + n.id);
            n.timer = 0.4 + this.rnd() * 1.2; // back-to-back flips
          }
          if (n.anim?.kind === "fail" && n.anim.t > n.anim.dur * 0.5)
            target = 4;
        }
      }
      if (n.behavior === "suddenBus" && player) {
        const dx = n.x - player.x,
          dy = n.y - player.y;
        const ahead =
          dx * Math.cos(player.heading) + dy * Math.sin(player.heading);
        const side = Math.abs(
          -dx * Math.sin(player.heading) + dy * Math.cos(player.heading),
        );
        if (!n.braking && ahead > 0 && ahead < 45 && side < 6) n.braking = true;
        if (n.braking) target = 0;
      }
      // a car that botched its landing crawls while it shakes it off
      if (n.anim?.kind === "fail" && n.anim.t > n.anim.dur * 0.5)
        target = Math.min(target, 4);
      if (!n.turn) {
        // Bumper clearance, including fractional-lane merges and cars entering a turn.
        let gap = Infinity,
          aheadV = 0,
          ahead: Npc | null = null;
        for (const o of this.npcs) {
          if (
            o === n ||
            o.dead ||
            o.edge !== n.edge ||
            o.dir !== n.dir ||
            Math.abs(o.lane - n.lane) * C.LANE_W >= n.halfW + o.halfW ||
            npcSpan(o).bottom >= npcSpan(n).top
          )
            continue;
          const ds =
            (o.x - n.x) * Math.cos(n.heading) +
            (o.y - n.y) * Math.sin(n.heading);
          if (ds > 0 && ds < gap) {
            gap = ds;
            aheadV = o.v;
            ahead = o;
          }
        }
        // mid-backflip there is no braking for the car ahead: the stunt carries on (a little faster) and may
        // come down right on top of it
        const stunting = n.anim?.kind === "flip" && n.yOff > 1;
        if (stunting) target = n.anim!.vT ?? Math.max(target, n.vCruise + 6);
        else if (ahead) {
          const clearance = gap - n.halfL - ahead.halfL;
          // Plan at 10 m/s², with 3 m slack; actual emergency braking is 18 m/s².
          const allowed = Math.sqrt(
            Math.max(0, aheadV * aheadV + 2 * 10 * (clearance - 3)),
          );
          target = Math.min(target, allowed);
          if (target < n.v) hardBrake = true;
        }
        // jets over the road's obstacles: a pothole in the lane just ahead, the toll arms on the south bridge
        if (!n.anim) {
          for (const p of this.potholes.get(n.edge) ?? []) {
            const ahd = p.s - n.s;
            const side = Math.abs(C.laneOffset(p.lane) - C.laneOffset(n.lane));
            if (
              p.dir === n.dir &&
              side < p.r + n.halfW &&
              ahd > p.r + 1 &&
              ahd < p.r + 9
            ) {
              n.anim = { kind: "skip", t: 0, dur: 1.0 };
              this.events.push("npcjet:" + n.id);
              break;
            }
          }
          if (!n.anim && n.behavior === "commuter" && n.edge === this.tollEdge)
            for (const z of n.edge.noNpc) {
              const ahd = z.s0 - n.s;
              if (z.dir === n.dir && ahd > -4 && ahd < 14) {
                n.anim = {
                  kind: "soar",
                  t: 0,
                  dur: (z.s1 - n.s + 8) / Math.max(n.v, 14),
                };
                this.events.push("npcjet:" + n.id);
                break;
              }
            }
        }
        // a backflip that just took off with a car up ahead in the lane aims for it: half clear it, half land on it
        if (
          n.anim?.kind === "flip" &&
          n.anim.vT === undefined &&
          n.anim.t <= dt * 1.5 &&
          ahead &&
          gap < n.halfL + ahead.halfL + 25
        ) {
          const bumper = gap - n.halfL - ahead.halfL;
          const onTop = this.flipRnd() < 0.5;
          n.anim.vT =
            aheadV +
            (onTop ? bumper + 1.5 : bumper + 2 * ahead.halfL + 4) / 1.1;
          n.v = n.anim.vT;
        }
        // closing in on a slower car: fellow roadsters (and now and then an ordinary driver) backflip over it,
        // and sometimes come down right on top of it
        if (
          !n.anim &&
          ahead &&
          gap < n.halfL + ahead.halfL + 9 &&
          aheadV < n.v - 2 &&
          (n.behavior === "commuter" ||
            (n.behavior === "cruise" && this.flipRnd() < dt * 0.8))
        ) {
          // half of them clear it, half come down right on it (speed matched to land on its roof)
          const bumper = gap - n.halfL - ahead.halfL;
          const onTop = this.flipRnd() < 0.5;
          const vT =
            aheadV +
            (onTop ? bumper + 1.5 : bumper + 2 * ahead.halfL + 4) / 1.1;
          n.anim = { kind: "flip", t: 0, dur: 1.3, vT };
          n.v = vT; // thruster kick
        }
        // skip NPC-free zones (construction / static jam): "took a detour". To the edge end at most, so a
        // zone that runs to the end hands the car straight to the next road instead of pinning it there
        if (
          (n.behavior === "cruise" || n.behavior === "commuter") &&
          n.anim?.kind !== "soar"
        )
          for (const z of n.edge.noNpc)
            if (z.dir === n.dir && n.s >= z.s0 && n.s <= z.s1)
              n.s = Math.min(n.edge.len - C.ROAD_HALF, z.s1 + 5);
      }
      const rate = target < n.v ? (n.braking || hardBrake ? 18 : 8) : 4;
      n.v += Math.max(-rate * dt, Math.min(rate * dt, target - n.v));

      if (n.turn) {
        const tr = n.turn;
        tr.t += (n.v * dt) / tr.len;
        if (tr.t >= 1) {
          n.edge = tr.next;
          n.dir = tr.nextDir;
          n.lane = tr.lane;
          n.laneTarget = laneOn(n.edge, n.laneTarget);
          n.s = C.ROAD_HALF;
          n.turn = null;
          const p = edgePose(this.city, n.edge, n.dir, n.s, n.lane);
          n.x = p.x;
          n.y = p.y;
          n.heading = p.heading;
        } else this.pose(n);
      } else {
        n.s += n.v * dt;
        if (n.s >= n.edge.len - C.ROAD_HALF) {
          n.s = n.edge.len - C.ROAD_HALF;
          // the event vehicles (camper, sudden bus, ambulance, wrong-way car...) go straight on into the next
          // block, so they are still there when the player gets to them (unless that is a bridge / the tunnel
          // jam / a skyway-ramp block, or no road goes on); they go once well behind the player
          const on = persistent ? null : straightOn(this.city, n.edge, n.dir);
          if (persistent) this.beginTurn(n);
          else if (
            on &&
            !on.edge.crossing &&
            !on.edge.laneMin &&
            !on.edge.noNpc.some((z) => z.dir === on.dir)
          )
            this.beginTurn(n, on);
          else {
            n.dead = true;
            continue;
          }
        }
        const p = edgePose(this.city, n.edge, n.dir, n.s, n.lane);
        n.x = p.x;
        n.y = p.y;
        n.heading = p.heading;
      }
    }
    this.separate();
    if (this.npcs.length > 120) this.npcs = this.npcs.filter((n) => !n.dead);
  }
}
