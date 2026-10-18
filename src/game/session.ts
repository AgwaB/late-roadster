// One commute in the open city: home -> office, traffic, hazards, events, clock, result.
import * as C from "./constants";
import { mulberry32 } from "./rng";
import { landmarkLayout, type LandmarkLayout } from "./landmarks";
import {
  type Car,
  type Env,
  type Input,
  crashCar,
  carSpan,
  newCar,
  placeCar,
  stepCar,
  velocity,
} from "./physics";
import {
  NPC_DIMS,
  NPC_MASS,
  Traffic,
  npcSpan,
  type Npc,
  type NpcKind,
} from "./traffic";

/** Oriented box on the ground plane: centre, heading cos/sin, half length (along heading) and half width. */
interface Obb {
  x: number;
  y: number;
  c: number;
  s: number;
  hl: number;
  hw: number;
}
/** Separating-axis test of two oriented boxes: the shortest push for A (unit normal from B toward A) and its depth. */
function obbHit(
  a: Obb,
  b: Obb,
): { nx: number; ny: number; depth: number } | null {
  const dx = a.x - b.x,
    dy = a.y - b.y;
  let depth = Infinity,
    nx = 0,
    ny = 0;
  for (const [ux, uy] of [
    [a.c, a.s],
    [-a.s, a.c],
    [b.c, b.s],
    [-b.s, b.c],
  ]) {
    const ra =
      a.hl * Math.abs(a.c * ux + a.s * uy) +
      a.hw * Math.abs(-a.s * ux + a.c * uy);
    const rb =
      b.hl * Math.abs(b.c * ux + b.s * uy) +
      b.hw * Math.abs(-b.s * ux + b.c * uy);
    const d = dx * ux + dy * uy;
    const o = ra + rb - Math.abs(d);
    if (o <= 0) return null;
    if (o < depth) {
      depth = o;
      const sg = d < 0 ? -1 : 1;
      nx = ux * sg;
      ny = uy * sg;
    }
  }
  return { nx, ny, depth };
}
function boxObb(box: AABB): Obb {
  return {
    x: (box.x0 + box.x1) / 2,
    y: (box.y0 + box.y1) / 2,
    c: 1,
    s: 0,
    hl: (box.x1 - box.x0) / 2,
    hw: (box.y1 - box.y0) / 2,
  };
}

const RESTITUTION = 0.3;
const CONTACT_PASSES = 4;
const ROOF_TOLERANCE = 0.03;
const CAR_INERTIA = (4 * C.CAR_HALF_L ** 2 + 4 * C.CAR_HALF_W ** 2) / 12; // box moment of inertia per unit mass
import {
  type AABB,
  type City,
  type Commute,
  type Edge,
  type Prop,
  edgePose,
  groundAt,
  inBox,
  inRiver,
  onSkyway,
  underRoof,
  locateOnRoad,
  snapToLane,
} from "./city";
import { LATE_X, ON_TIME_X, Tracker } from "./score";
import { SKY_CAR, skyCarAt } from "./skylane";
import { PLAZA, tollCanopy } from "./toll";

export type Grade = "S" | "A" | "B" | "C" | "LATE";
/** SPEC §3.3: one persona per commute, 1-2 words, shown at the start and on the result card. */
const PERSONAS = [
  "STARTUP DEV",
  "FINANCE",
  "DELIVERY",
  "STUDENT",
  "NURSE",
  "MUSICIAN",
  "MANAGER",
  "DESIGNER",
  "COURIER",
  "BARISTA",
  "ENGINEER",
  "STREAMER",
];
export interface Result {
  grade: Grade;
  timeLeft: number;
  crashes: number;
  finished: boolean;
  crashTimes: number[];
  persona: string;
  /** VIEWS earned on the way, and after the on-time / late multiplier */
  views: number;
  finalViews: number;
  /** clips first filmed during this run */
  newClips: string[];
}

export interface SessionOptions {
  /** free roam: no clock, no finish (unlocked by filming every clip) */
  free?: boolean;
  /** clips already filmed (updated in place as new ones are filmed) */
  known?: Set<string>;
}

export function gradeOf(
  timeLeft: number,
  crashes: number,
  finished: boolean,
): Grade {
  if (!finished) return "LATE";
  if (crashes === 0 && timeLeft >= 15) return "S";
  if (timeLeft >= 10) return "A";
  if (timeLeft >= 5) return "B";
  return "C";
}

export function clockString(t: number): string {
  const total = C.CLOCK_START + Math.max(0, Math.min(C.RUN_TIME, t));
  const h = Math.floor(total / 3600),
    m = Math.floor((total % 3600) / 60),
    s = Math.floor(total % 60);
  return (
    h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0")
  );
}

export type EventKind =
  | "camper"
  | "suddenBus"
  | "taxi"
  | "scooters"
  | "spill"
  | "wrongWay"
  | "ambulance"
  | "rain"
  | "bounceBus"
  | "wire"
  | "wheel"
  | "peloton";
const EVENT_POOL: EventKind[] = [
  "camper",
  "suddenBus",
  "taxi",
  "scooters",
  "spill",
  "wrongWay",
  "ambulance",
  "rain",
  "bounceBus",
  "wire",
  "wheel",
  "peloton",
];

/** Moving hazard spawned by an event (scooters, crates, runaway wheel, wire poles). Collides like a prop. */
export interface Hazard {
  id: number;
  kind: "scooter" | "crate" | "wheel" | "wirepole" | "cyclist";
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  halfL: number;
  halfW: number;
  h: number;
  ttl: number;
  phase: number;
  variant: number;
  hit: boolean;
}
export interface Wire {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  h: number;
  ttl: number;
}

/** Upside-down traffic on the tunnel ceiling (the "roadster-only ceiling lane" meme). Same pose fields as an Npc. */
export interface CeilingCar {
  kind: NpcKind;
  x: number;
  y: number;
  heading: number;
  v: number;
  dir: 1 | -1;
  lane: number;
  halfL: number;
  halfW: number;
  h: number;
  yOff: number;
  pitch: number;
  roll: number;
  dead: boolean;
}
const CEIL_MARGIN = 6; // ceiling cars wrap this far inside the tunnel mouths

function spawnCeilingCars(rnd: () => number): CeilingCar[] {
  const KINDS: NpcKind[] = [
    "roadster",
    "roadster",
    "roadster",
    "sedan",
    "suv",
    "hatchback",
    "taxi",
  ];
  const lim = C.TUNNEL_HALF_X - CEIL_MARGIN;
  const out: CeilingCar[] = [];
  for (const dir of [1, -1] as const)
    for (let lane = 0; lane < C.LANES_PER_DIR; lane++) {
      // one speed per lane, so cars in a lane never run into each other
      const v = 17 + lane * 2.5 + (dir > 0 ? 0 : 1.5);
      const off = rnd() * 2 * lim;
      for (let i = 0; i < 3; i++) {
        const kind = KINDS[Math.floor(rnd() * KINDS.length)];
        out.push({
          kind,
          x: -lim + ((off + (i * 2 * lim) / 3) % (2 * lim)),
          y: C.TUNNEL_ROW * C.P + (dir > 0 ? -1 : 1) * C.laneOffset(lane),
          heading: dir > 0 ? 0 : Math.PI,
          v,
          dir,
          lane,
          ...NPC_DIMS[kind],
          yOff: C.CEIL_H,
          pitch: 0,
          roll: Math.PI,
          dead: false,
        });
      }
    }
  return out;
}

export class Session {
  commute: Commute;
  persona: string;
  office: { x: number; y: number };
  /** the HQ / villa landmarks of this commute and the solid buildings around them */
  layout: LandmarkLayout;
  car: Car;
  traffic: Traffic;
  t = 0;
  state: "run" | "result" = "run";
  result: Result | null = null;
  crashTimes: number[] = [];
  nextEventT: number;
  eventCount = 0;
  lastEvent: EventKind | null = null;
  props: Prop[];
  hazards: Hazard[] = [];
  wires: Wire[] = [];
  ceilingCars: CeilingCar[];
  /** seconds of rain left (0 = dry); grip drops while > 0 */
  rainT = 0;
  bumpCd = 0;
  /** when the player last snapped a toll arm (one slowdown per pass) */
  private tollT = -10;
  private hazardId = 1;
  private rnd: () => number;
  private env: Env;
  private previousRoofs = new Map<Npc, number>();
  private contactEffects: Set<unknown> | null = null;

  readonly free: boolean;
  readonly tracker: Tracker;
  /** reason of the latest crash ("sinkhole", "land", "skycar", ...) */
  lastCrash = "";
  /** cyclist groups already jumped over (keyed by the group's first hazard id: variant i has id first + i) */
  private cleared = new Set<number>();
  private skipLatch = true;

  constructor(
    public city: City,
    seed: number,
    runIndex: number,
    commuteIndex?: number,
    opts: SessionOptions = {},
  ) {
    this.free = !!opts.free;
    this.tracker = new Tracker(city, opts.known ?? new Set());
    this.rnd = mulberry32((seed ^ (runIndex * 0x9e3779b9)) >>> 0);
    const ci = commuteIndex ?? Math.floor(this.rnd() * city.commutes.length);
    this.commute = city.commutes[ci];
    this.persona = PERSONAS[ci % PERSONAS.length];
    // start facing down the route's first road; the goal is the CLOCK IN bay at the HQ entrance
    this.layout = landmarkLayout(city, this.commute);
    const { start, finish } = this.layout;
    this.office = { x: finish.x, y: finish.y };
    this.car = newCar(start.x, start.y, start.heading);
    this.traffic = new Traffic(city, this.rnd);
    this.props = city.props.map((p) => ({ ...p, box: { ...p.box } }));
    this.nextEventT = 4 + this.rnd() * 3;
    const canopy = city.toll ? tollCanopy(city.toll) : null;
    this.env = {
      rnd: this.rnd,
      ground: (x, y, h) => groundAt(city, x, y, h),
      // the river tunnel and the stage canopy both have a drivable ceiling
      tunnel: (x, y) => underRoof(city, x, y),
      // flying under the skyway: the deck's underside is the roof; the same under the toll canopy
      ceiling: (x, y, h) => {
        if (h < city.skyway.h - 1.5 && onSkyway(city, x, y))
          return city.skyway.h - 1.4 - C.CAR_H;
        const under = PLAZA.bottom - C.CAR_ROOF - 0.05;
        if (canopy && h <= under + 0.3 && inBox(canopy, x, y)) return under;
        return Infinity;
      },
      wallRamp: city.stage?.ramp ?? null,
      skyway: (x, y, h) => {
        const s = city.skyway;
        if (x < s.x0 + 4 || x > s.x1 - 4) return null;
        const dy = y - s.y;
        // up on the deck: drop out over the parapet onto the outer lanes
        if (h >= s.h - 1.5)
          return Math.abs(dy) <= s.half
            ? { y1: s.y + (dy < 0 ? -1 : 1) * (s.half + 4), h1: 0 }
            : null;
        // anywhere on the roadway below or beside it: climb onto the deck
        if (Math.abs(dy) > C.ROADWAY_HALF) return null;
        const lim = s.half - 2.4;
        return { y1: s.y + C.clamp(dy, -lim, lim), h1: s.h };
      },
      respawn: (c) => this.respawn(c),
      wet: () => (this.rainT > 0 ? Math.min(1, this.rainT / 2) : 0),
    };
    this.traffic.spawnCommuters(C.COMMUTER_COUNT);
    // own RNG stream so the ceiling traffic never shifts the event/traffic sequence
    this.ceilingCars = spawnCeilingCars(
      mulberry32((seed ^ 0xc311f00d ^ runIndex) >>> 0),
    );
  }

  get timeLeft(): number {
    return this.free ? Infinity : Math.max(0, C.RUN_TIME - this.t);
  }
  get clock(): string {
    return this.free ? "FREE ROAM" : clockString(this.t);
  }
  get views(): number {
    return this.tracker.views;
  }
  get distanceToOffice(): number {
    return Math.hypot(this.car.x - this.office.x, this.car.y - this.office.y);
  }

  /** Occupancy query shared by respawn and the solver's infeasible-gap escape. */
  private poseBlocked(c: Car): boolean {
    const body = this.playerObb(c),
      span = carSpan(c);
    const rx = Math.abs(body.c) * body.hl + Math.abs(body.s) * body.hw;
    const ry = Math.abs(body.s) * body.hl + Math.abs(body.c) * body.hw;
    const hits = (box: AABB) =>
      c.x + rx > box.x0 &&
      c.x - rx < box.x1 &&
      c.y + ry > box.y0 &&
      c.y - ry < box.y1 &&
      obbHit(body, boxObb(box)) !== null;
    if (inRiver(this.city, c.x, c.y) && c.h < 1.5) return true;
    for (const s of this.city.solids)
      if (span.bottom < s.top && span.top > s.bottom && hits(s.box))
        return true;
    for (const b of this.layout.buildings)
      if (span.bottom <= b.height && hits(b.box)) return true;
    for (const p of this.props)
      if (
        !(p.kind === "cone" && p.hit) &&
        (p.kind === "wall" || span.bottom < p.h - 1e-6) &&
        hits(p.box)
      )
        return true;
    const sw = this.city.skyway;
    if (!c.shift && c.x > sw.x0 - 3 && c.x < sw.x1 + 3) {
      const dy = Math.abs(c.y - sw.y);
      if (
        c.h >= sw.h - 0.5 &&
        dy <= sw.half &&
        dy > sw.half - 0.45 - C.CAR_HALF_W
      )
        return true;
      if (c.h < sw.h - 2 && sw.piers.some(hits)) return true;
    }
    for (const n of [...this.traffic.npcs, ...this.ceilingCars]) {
      if (n.dead) continue;
      const other = npcSpan(n);
      if (span.bottom >= other.top - 1e-6 || span.top <= other.bottom + 1e-6)
        continue;
      if (
        obbHit(body, {
          x: n.x,
          y: n.y,
          c: Math.cos(n.heading),
          s: Math.sin(n.heading),
          hl: n.halfL,
          hw: n.halfW,
        })
      )
        return true;
    }
    for (const hz of this.hazards)
      if (
        !hz.hit &&
        span.bottom < hz.h &&
        hits({
          x0: hz.x - hz.halfL,
          x1: hz.x + hz.halfL,
          y0: hz.y - hz.halfL,
          y1: hz.y + hz.halfL,
        })
      )
        return true;
    return false;
  }

  private respawn(c: Car): void {
    // Prefer a nearby lane, facing the office. Every candidate, including the fallback, is checked.
    const a = snapToLane(this.city, c.x, c.y, c.heading);
    const b = snapToLane(this.city, c.x, c.y, c.heading + Math.PI);
    const score = (p: { x: number; y: number; heading: number }) =>
      Math.hypot(
        p.x + Math.cos(p.heading) * 60 - this.office.x,
        p.y + Math.sin(p.heading) * 60 - this.office.y,
      );
    const bases = score(a) <= score(b) ? [a, b] : [b, a];
    const tryPose = (p: { x: number; y: number; heading: number }) => {
      const probe = newCar(p.x, p.y, p.heading);
      probe.h = groundAt(this.city, p.x, p.y).h;
      // never back into (or right on the edge of) a sinkhole
      for (const ph of this.city.potholes)
        if (Math.hypot(ph.x - p.x, ph.y - p.y) < ph.r + C.CAR_HALF_L + 1)
          return false;
      if (this.poseBlocked(probe)) return false;
      placeCar(c, p.x, p.y, p.heading, probe.h);
      return true;
    };
    for (const distance of [0, 8, -8, 16, -16, 32, -32, 64, -64])
      for (const p of bases)
        for (let lane = 0; lane < C.LANES_PER_DIR; lane++) {
          const fx = Math.cos(p.heading),
            fy = Math.sin(p.heading);
          const x = p.x + fx * distance + fy * lane * C.LANE_W;
          const y = p.y + fy * distance - fx * lane * C.LANE_W;
          if (
            Math.abs(x) <= C.CITY_HALF &&
            Math.abs(y) <= C.CITY_HALF &&
            tryPose({ x, y, heading: p.heading })
          )
            return;
        }
    // Fully blocked neighbourhood: deterministic scan of actual road edges, not an unchecked home pose.
    for (const edge of this.city.edges)
      for (const dir of [1, -1] as const)
        for (let lane = 0; lane < C.LANES_PER_DIR; lane++)
          for (let s = 12; s < edge.len - 12; s += 12)
            if (tryPose(edgePose(this.city, edge, dir, lane, s))) return;
    // Pathological fully occupied map: keep the wreck stopped and retry, never spawn inside an obstacle.
    c.state = "crash";
    c.vx = c.vy = c.vH = 0;
  }

  private firstContact(key: unknown): boolean {
    if (!this.contactEffects) return true;
    if (this.contactEffects.has(key)) return false;
    this.contactEffects.add(key);
    return true;
  }

  private resolveContacts(): string[] {
    const car = this.car,
      ev: string[] = [];
    this.contactEffects = new Set();
    try {
      for (
        let pass = 0;
        pass < CONTACT_PASSES && car.state === "drive";
        pass++
      ) {
        const x = car.x,
          y = car.y;
        const gate = () => car.invuln <= 0 && this.bumpCd <= 0;
        ev.push(...this.collideStatic(gate()));
        if (car.state === "drive") ev.push(...this.collideTraffic(gate()));
        if (car.state === "drive") ev.push(...this.collideCeiling(gate()));
        if (car.x === x && car.y === y) break;
      }
      // Sequential constraints can be infeasible (a car-width gap narrower than the body).
      // Restore the previous clear pose, or search a small deterministic ring to escape it.
      if (
        this.contactEffects.size > 0 &&
        car.state === "drive" &&
        this.poseBlocked(car)
      ) {
        const probe = { ...car, x: car.px, y: car.py };
        let clear = !this.poseBlocked(probe);
        for (let r = 1; r <= 16 && !clear; r++)
          for (let i = 0; i < 16 && !clear; i++) {
            probe.x = car.x + r * Math.cos((i * Math.PI) / 8);
            probe.y = car.y + r * Math.sin((i * Math.PI) / 8);
            clear = !this.poseBlocked(probe);
          }
        if (clear) {
          car.x = probe.x;
          car.y = probe.y;
          car.v = car.vLat = 0;
        } else this.respawn(car);
      }
    } finally {
      this.contactEffects = null;
    }
    return [...new Set(ev.filter(Boolean))];
  }

  /** Genuine descending bottom/roof crossing only; both stationary and moving cars use this reward. */
  private stomp(
    target: { stomped: boolean },
    roof: number,
    previousRoof = roof,
  ): boolean {
    const car = this.car;
    const bottom = carSpan(car).bottom;
    const before = car.previousBottom - previousRoof;
    const now = bottom - roof;
    if (
      target.stomped ||
      car.ceiling ||
      car.vH >= 0 ||
      before < -ROOF_TOLERANCE ||
      now > ROOF_TOLERANCE ||
      now > before
    )
      return false;
    target.stomped = true;
    car.h += roof - bottom;
    car.vH = 5;
    car.grounded = false;
    car.sp = Math.min(C.SP_MAX, car.sp + C.SP_STOMP);
    this.bumpCd = 0.4;
    return true;
  }

  step(dt: number, input: Input): string[] {
    if (this.state === "result") return [];
    // No subsystem may advance beyond the deadline, even on the last partial tick.
    dt = Math.min(dt, this.timeLeft);
    const car = this.car;
    // Space during the crash replay skips the rest of it; the clock still loses the full replay
    const skip = input.jump && !this.skipLatch;
    this.skipLatch = input.jump;
    if (car.state === "crash" && skip && car.crashT > 0.5) {
      if (!this.free) this.t += Math.max(0, C.CRASH_REPLAY - car.crashT);
      car.crashT = C.CRASH_REPLAY;
    }
    this.previousRoofs.clear();
    for (const n of this.traffic.npcs)
      if (!n.dead) this.previousRoofs.set(n, npcSpan(n).top);
    const ev = stepCar(car, input, dt, this.env);
    this.t += dt;
    if (this.bumpCd > 0) this.bumpCd -= dt;
    // Integrate both bodies before resolving contacts; traffic must not re-embed the player afterwards.
    this.traffic.update(dt, {
      x: car.x,
      y: car.y,
      heading: car.heading,
      v: car.v,
    });
    this.stepCeiling(dt);

    if (car.state === "drive") {
      if (inRiver(this.city, car.x, car.y) && car.h < 1.5)
        ev.push(crashCar(car, "splash", this.rnd));
      else {
        ev.push(...this.resolveContacts());
      }
    } else if (car.state === "crash") {
      this.tumbleBounce();
    }
    for (const te of this.traffic.events.splice(0))
      ev.push(...this.onTrafficEvent(te));
    this.stepHazards(dt);
    if (car.state === "drive")
      ev.push(...this.collideHazards(car.invuln <= 0 && this.bumpCd <= 0));
    if (car.state === "drive") ev.push(...this.potholeThud());
    if (car.state === "drive")
      ev.push(...this.collideSky(car.invuln <= 0 && this.bumpCd <= 0));
    if (this.rainT > 0) this.rainT -= dt;

    if (this.t >= this.nextEventT && car.state === "drive") {
      const k = this.spawnEvent();
      if (k) ev.push("event:" + k);
      this.nextEventT =
        this.t +
        C.EVENT_GAP_MIN +
        this.rnd() * (C.EVENT_GAP_MAX - C.EVENT_GAP_MIN);
    }
    for (const e of ev)
      if (e.startsWith("crash:")) {
        this.crashTimes.push(this.t);
        this.lastCrash = e.slice(6);
      }
    ev.push(...this.tracker.step(dt, car, ev));

    if (this.free) return ev;
    // an arrival within the last (clipped) tick still counts; only a skipped crash replay can carry the clock
    // past 9:00, and that is late however close the office is
    const pastDeadline = this.t > C.RUN_TIME + 1e-6;
    if (
      !pastDeadline &&
      car.state === "drive" &&
      this.distanceToOffice < C.FINISH_RADIUS
    ) {
      car.state = "done";
      this.finish(true);
      ev.push("finish");
    } else if (this.t >= C.RUN_TIME) {
      car.state = "done";
      this.finish(false);
      ev.push("late");
    }
    return ev;
  }

  private finish(finished: boolean): void {
    this.state = "result";
    const timeLeft = finished ? this.timeLeft : 0;
    this.result = {
      grade: gradeOf(timeLeft, this.car.crashes, finished),
      timeLeft,
      crashes: this.car.crashes,
      finished,
      crashTimes: this.crashTimes.slice(),
      persona: this.persona,
      views: Math.round(this.views),
      finalViews: Math.round(this.views * (finished ? ON_TIME_X : LATE_X)),
      newClips: this.tracker.unlocked.slice(),
    };
  }

  private spawnEvent(): EventKind | null {
    const car = this.car;
    const loc = locateOnRoad(this.city, car.x, car.y, car.heading);
    if (!loc) return null;
    const room = loc.edge.len - C.ROAD_HALF - 10 - loc.s; // metres of straight road ahead
    // seeded pick, never the same event twice in a row, must fit on the road ahead
    for (let tries = 0; tries < 8; tries++) {
      const kind = EVENT_POOL[Math.floor(this.rnd() * EVENT_POOL.length)];
      if (kind === this.lastEvent) continue;
      const need: Record<EventKind, number> = {
        camper: 110,
        suddenBus: 150,
        taxi: 70,
        scooters: 90,
        spill: 90,
        wrongWay: 150,
        ambulance: 40,
        rain: 0,
        bounceBus: 120,
        wire: 90,
        wheel: 80,
        peloton: 100,
      };
      if (need[kind] > room) continue;
      if (kind === "ambulance" && loc.s < 70) continue; // needs space behind
      if (kind === "rain" && this.rainT > 0) continue;
      if (!this.startEvent(kind, loc)) continue;
      this.lastEvent = kind;
      this.eventCount++;
      return kind;
    }
    return null;
  }

  /** dev/test: trigger a specific event in front of the car now. */
  forceEvent(kind: EventKind): boolean {
    const loc = locateOnRoad(
      this.city,
      this.car.x,
      this.car.y,
      this.car.heading,
    );
    if (!loc) return false;
    this.lastEvent = kind;
    return this.startEvent(kind, loc);
  }

  private startEvent(
    kind: EventKind,
    loc: { edge: Edge; dir: 1 | -1; s: number; lane: number },
  ): boolean {
    const { edge, dir, s, lane } = loc;
    const pose = (ds: number, ln: number) =>
      edgePose(this.city, edge, dir, s + ds, ln);
    switch (kind) {
      case "camper":
        this.traffic.spawnCamper(edge, dir, s + 110);
        return true;
      case "suddenBus":
        this.traffic.spawnSuddenBus(edge, dir, s + 150, lane);
        return true;
      case "taxi":
        this.traffic.spawnMergeTaxi(edge, dir, s + 65, lane);
        return true;
      case "wrongWay":
        this.traffic.spawnWrongWay(edge, dir, s + 150, lane);
        return true;
      case "ambulance":
        this.traffic.spawnAmbulance(edge, dir, s - 65, lane);
        return true;
      case "bounceBus":
        this.traffic.spawnBounceBus(edge, dir, s + 110, Math.min(2, lane + 1));
        return true;
      case "spill":
        this.traffic.spawnSpillTruck(edge, dir, s + 85, lane);
        return true;
      case "rain":
        this.rainT = 14;
        return true;
      case "scooters": {
        // five e-scooters weaving across the player's and the next lane, 8 m/s
        for (let i = 0; i < 5; i++) {
          const p = pose(80 + i * 7, lane + (i % 2 ? 0.5 : -0.3));
          this.hazards.push({
            id: this.hazardId++,
            kind: "scooter",
            x: p.x,
            y: p.y,
            heading: p.heading,
            vx: Math.cos(p.heading) * 8,
            vy: Math.sin(p.heading) * 8,
            halfL: 0.8,
            halfW: 0.3,
            h: 1.6,
            ttl: 30,
            phase: i * 1.3,
            variant: i,
            hit: false,
          });
        }
        return true;
      }
      case "peloton": {
        // the weekend cycling club, five abreast across the player's lane and its neighbours at 8 m/s: head-high,
        // so a hop clears them (the "roadster vs the bike pack" joke); ride into them and you go over the bars
        const spread = [-0.7, -0.35, 0, 0.35, 0.7];
        const stagger = [0.6, 1.8, 0, 2.2, 1.1];
        for (let i = 0; i < 5; i++) {
          const q = pose(84 + stagger[i], lane + spread[i]);
          this.hazards.push({
            id: this.hazardId++,
            kind: "cyclist",
            x: q.x,
            y: q.y,
            heading: q.heading,
            vx: Math.cos(q.heading) * 8,
            vy: Math.sin(q.heading) * 8,
            halfL: 0.9,
            halfW: 0.3,
            h: 1.8,
            ttl: 35,
            phase: i * 0.9,
            variant: i,
            hit: false,
          });
        }
        return true;
      }
      case "wheel": {
        // a lone wheel rolling across the road from the kerb side
        const p = pose(80, 3.6);
        const cross = p.heading + Math.PI / 2; // from the kerb side across the road, towards the median
        this.hazards.push({
          id: this.hazardId++,
          kind: "wheel",
          x: p.x,
          y: p.y,
          heading: cross,
          vx: Math.cos(cross) * 11,
          vy: Math.sin(cross) * 11,
          halfL: 0.35,
          halfW: 0.15,
          h: 0.7,
          ttl: 6,
          phase: 0,
          variant: 0,
          hit: false,
        });
        return true;
      }
      case "wire": {
        // low cable strung across this carriageway between two temporary poles (median edge <-> kerb):
        // jump high under it and you snag it
        const left = pose(90, -0.5); // lane offset -0.5 = median edge
        const right = pose(90, 3.76); // just past the kerb lane
        for (const p of [left, right])
          this.hazards.push({
            id: this.hazardId++,
            kind: "wirepole",
            x: p.x,
            y: p.y,
            heading: p.heading,
            vx: 0,
            vy: 0,
            halfL: 0.15,
            halfW: 0.15,
            h: 6,
            ttl: 40,
            phase: 0,
            variant: 0,
            hit: false,
          });
        this.wires.push({
          ax: left.x,
          ay: left.y,
          bx: right.x,
          by: right.y,
          h: C.WIRE_H,
          ttl: 40,
        });
        return true;
      }
    }
    return false;
  }

  /** Reactions to NPC behaviour events (ambulance etiquette, cargo spill). */
  private onTrafficEvent(e: string): string[] {
    const [k, v] = e.split(":");
    if (k === "ambulance" && v === "thanks") {
      this.car.sp = Math.min(C.SP_MAX, this.car.sp + 25);
      return ["thanks"];
    }
    if (k === "ambulance" && v === "siren") {
      return ["siren"];
    }
    if (k === "spill") {
      const truck = this.traffic.npcs.find((n) => n.id === Number(v));
      if (!truck) return [];
      const c = Math.cos(truck.heading),
        sn = Math.sin(truck.heading);
      for (let i = 0; i < 8; i++) {
        const back = -truck.halfL - 1 - this.rnd() * 3,
          side = (this.rnd() - 0.5) * 5;
        this.hazards.push({
          id: this.hazardId++,
          kind: "crate",
          x: truck.x + c * back - sn * side,
          y: truck.y + sn * back + c * side,
          heading: truck.heading + (this.rnd() - 0.5),
          vx: c * truck.v * 0.5 - sn * side * 0.8,
          vy: sn * truck.v * 0.5 + c * side * 0.8,
          halfL: 0.5,
          halfW: 0.5,
          h: 0.95,
          ttl: 25,
          phase: 0,
          variant: Math.floor(this.rnd() * 3),
          hit: false,
        });
      }
      return ["cargo"];
    }
    return [e];
  }

  private stepHazards(dt: number): void {
    for (const hz of this.hazards) {
      hz.ttl -= dt;
      if (hz.kind === "scooter") {
        hz.phase += dt;
        // weave: lateral sine around the lane line
        const c = Math.cos(hz.heading),
          sn = Math.sin(hz.heading);
        const lat = Math.cos(hz.phase * 1.6) * 1.1 * dt * 1.6;
        hz.x += hz.vx * dt - sn * lat;
        hz.y += hz.vy * dt + c * lat;
      } else if (hz.kind === "cyclist") {
        // steady pace, a gentle sway
        hz.phase += dt;
        const c = Math.cos(hz.heading),
          sn = Math.sin(hz.heading);
        const lat = Math.cos(hz.phase * 1.3) * 0.25 * dt * 1.3;
        hz.x += hz.vx * dt - sn * lat;
        hz.y += hz.vy * dt + c * lat;
      } else if (hz.kind === "crate") {
        hz.x += hz.vx * dt;
        hz.y += hz.vy * dt;
        hz.vx *= Math.max(0, 1 - 1.8 * dt);
        hz.vy *= Math.max(0, 1 - 1.8 * dt);
        hz.heading += (hz.vx + hz.vy) * 0.08 * dt;
      } else if (hz.kind === "wheel") {
        hz.x += hz.vx * dt;
        hz.y += hz.vy * dt;
        hz.phase += (dt * 11) / 0.35; // roll angle
      }
    }
    this.hazards = this.hazards.filter((h) => h.ttl > 0);
    for (const w of this.wires) w.ttl -= dt;
    this.wires = this.wires.filter((w) => w.ttl > 0);
  }

  private collideHazards(gate: boolean): string[] {
    const ev: string[] = [];
    const car = this.car;
    for (const hz of this.hazards) {
      const dx = hz.x - car.x,
        dy = hz.y - car.y;
      if (dx * dx + dy * dy > 36) continue;
      const box: AABB = {
        x0: hz.x - hz.halfL,
        y0: hz.y - hz.halfL,
        x1: hz.x + hz.halfL,
        y1: hz.y + hz.halfL,
      };
      if (!this.hitsBox(box, C.CAR_HALF_W * 0.8)) continue;
      if (carSpan(car).bottom > hz.h - 0.2) {
        // cleared it; going over the cycling club is the stunt (once per group)
        if (hz.kind === "cyclist" && !this.cleared.has(hz.variant - hz.id)) {
          this.cleared.add(hz.variant - hz.id);
          ev.push("over:peloton");
        }
        continue;
      }
      if (hz.kind === "wirepole") {
        if (gate) ev.push(this.impact(car.v, "pole"));
        return ev;
      }
      if (hz.hit) continue;
      hz.hit = true;
      hz.ttl = Math.min(hz.ttl, 1.5);
      if (hz.kind === "scooter" || hz.kind === "cyclist") {
        // SPEC: hit a scooter (or a cyclist) and you roll
        if (gate) ev.push(crashCar(car, hz.kind, this.rnd));
        return ev;
      }
      // crate / wheel: a bump at any speed, a crash when fast
      const vel = velocity(car);
      hz.vx = vel.vx * 0.9;
      hz.vy = vel.vy * 0.9;
      hz.h = 0; // knocked away, no longer blocks
      if (gate) ev.push(this.impact(car.v > 24 ? car.v : 4, hz.kind));
      return ev;
    }
    // wire snag: airborne through the cable height within 1.2 m of the span
    if (!car.grounded && !car.ceiling)
      for (const w of this.wires) {
        const lx = w.bx - w.ax,
          ly = w.by - w.ay,
          L2 = lx * lx + ly * ly;
        const t = ((car.x - w.ax) * lx + (car.y - w.ay) * ly) / L2;
        if (t < -0.05 || t > 1.05) continue;
        const px = w.ax + lx * t,
          py = w.ay + ly * t;
        const dist = Math.hypot(car.x - px, car.y - py);
        if (
          dist < 1.3 &&
          car.h + C.CAR_H > w.h - 0.3 &&
          car.h < w.h + 0.6 &&
          w.ttl > 1
        ) {
          // SPEC: dangle from the wire; here the car hangs for a beat then drops, losing its SP
          car.v *= 0.15;
          car.vLat = 0;
          car.vH = -1.5;
          car.sp = Math.max(0, car.sp - 30);
          w.ttl = 0.9; // the cable snaps
          ev.push("wire");
        }
      }
    return ev;
  }

  /** Full body OBB, with the existing inset for small forgiving hazard/cone contacts. */
  private hitsBox(box: AABB, r: number): boolean {
    const body = this.playerObb();
    body.hl += r - C.CAR_HALF_W;
    body.hw = r;
    return obbHit(body, boxObb(box)) !== null;
  }

  /** Low relative speed = bump (lose speed). High = crash. */
  private impact(rel: number, what: string, otherVx = 0, otherVy = 0): string {
    const car = this.car;
    if (rel < C.BUMP_MAX_REL) {
      const fx = Math.cos(car.heading),
        fy = Math.sin(car.heading);
      const otherFwd = otherVx * fx + otherVy * fy;
      car.v = Math.min(car.v, Math.max(2, otherFwd * 0.9));
      this.bumpCd = 0.5;
      return "bump:" + what;
    }
    return crashCar(car, what, this.rnd);
  }

  /** Full OBB-vs-box minimum translation, including thin obstacles at the body centre. */
  private penetration(box: AABB): { x: number; y: number } | null {
    const hit = obbHit(this.playerObb(), boxObb(box));
    return hit
      ? { x: hit.nx * (hit.depth + 0.01), y: hit.ny * (hit.depth + 0.01) }
      : null;
  }

  private pushOut(mtv: { x: number; y: number }): string {
    this.car.x += mtv.x;
    this.car.y += mtv.y;
    return "wall";
  }

  /** Wall/building contact: push out; crash only if the velocity into the wall is high, otherwise scrape. */
  private wallContact(
    mtv: { x: number; y: number },
    what: string,
    key: unknown = what,
    gate = true,
  ): string {
    const car = this.car;
    car.x += mtv.x;
    car.y += mtv.y;
    if (!this.firstContact(key)) return "";
    const len = Math.hypot(mtv.x, mtv.y) || 1;
    const nx = mtv.x / len,
      ny = mtv.y / len;
    const vel = velocity(car);
    const vn = -(vel.vx * nx + vel.vy * ny); // speed into the wall
    if (vn > C.WALL_CRASH_V && car.invuln <= 0 && gate)
      return crashCar(car, what, this.rnd);
    // remove the normal component (slight bounce), keep tangential
    const k = Math.max(0, vn) * 1.15;
    const tvx = vel.vx + nx * k,
      tvy = vel.vy + ny * k;
    const fx = Math.cos(car.heading),
      fy = Math.sin(car.heading);
    car.v = Math.max(3, (tvx * fx + tvy * fy) * 0.9);
    car.vLat = (-tvx * fy + tvy * fx) * 0.5;
    // nudge heading away from the wall
    const side = -nx * fy + ny * fx; // + = wall normal points left -> wall is on the right
    car.heading += Math.sign(side) * 0.04;
    return "wall";
  }

  /** During the crash replay the wreck bounces off buildings instead of flying through them. */
  private tumbleBounce(): void {
    const car = this.car;
    const bottom = carSpan(car).bottom;
    for (const b of this.layout.buildings) {
      if (bottom > b.height) continue;
      const m = this.penetration(b.box);
      if (!m) continue;
      car.x += m.x;
      car.y += m.y;
      const len = Math.hypot(m.x, m.y) || 1,
        nx = m.x / len,
        ny = m.y / len;
      const vn = car.vx * nx + car.vy * ny;
      if (vn < 0) {
        car.vx -= 1.6 * vn * nx;
        car.vy -= 1.6 * vn * ny;
      }
      return;
    }
  }

  private collideStatic(gate: boolean): string[] {
    const ev: string[] = [];
    const car = this.car;
    const near = (box: AABB) =>
      Math.abs((box.x0 + box.x1) / 2 - car.x) < (box.x1 - box.x0) / 2 + 8 &&
      Math.abs((box.y0 + box.y1) / 2 - car.y) < (box.y1 - box.y0) / 2 + 8;
    const span = carSpan(car);
    const bottom = span.bottom;
    for (const b of this.layout.buildings) {
      if (bottom > b.height || !near(b.box)) continue;
      const m = this.penetration(b.box);
      if (!m) continue;
      ev.push(this.wallContact(m, "building", b, gate));
      return ev;
    }
    // skyway: parapets keep you on the deck while up there; piers block the median underneath
    const sw = this.city.skyway;
    if (!car.shift && car.x > sw.x0 - 3 && car.x < sw.x1 + 3) {
      const dy = car.y - sw.y;
      if (car.h >= sw.h - 0.5 && Math.abs(dy) <= sw.half) {
        const lim = sw.half - 0.45 - C.CAR_HALF_W; // inner face of the parapet
        if (Math.abs(dy) > lim) {
          ev.push(
            this.wallContact(
              { x: 0, y: Math.sign(dy) * lim - dy },
              "parapet",
              "parapet",
              gate,
            ),
          );
          return ev;
        }
      } else if (car.h < sw.h - 2)
        for (const p of sw.piers) {
          const m = this.penetration(p);
          if (m) {
            ev.push(this.wallContact(m, "pier", p, gate));
            return ev;
          }
        }
    }
    // Solid overhead signs: only test nearby parts that overlap the full rotated body vertically.
    // All parts (including a speared wreck) share a structure key for one contact effect.
    for (const sign of this.city.signs.colliders) {
      if (span.top <= sign.bottom || span.bottom >= sign.top || !near(sign.box))
        continue;
      const m = this.penetration(sign.box);
      if (!m) continue;
      const event = this.wallContact(m, "sign", sign.structure, gate);
      if (event) ev.push(event);
      return ev;
    }
    // toll plaza and event ramp (the ramp lets a wall ride, and the car just leaving its lip, through)
    for (const s of this.city.solids) {
      if (span.top <= s.bottom || span.bottom >= s.top || !near(s.box))
        continue;
      if (s.what === "ramp" && (car.wall || car.wallGrace > 0)) continue;
      const m = this.penetration(s.box);
      if (!m) continue;
      const event = this.wallContact(m, s.what, s.key, gate);
      if (event) ev.push(event);
      return ev;
    }
    for (const o of this.props) {
      if (!near(o.box)) continue;
      if (o.kind === "wall") {
        const m = this.penetration(o.box);
        if (m) {
          ev.push(this.wallContact(m, "wall", o, gate));
          return ev;
        }
        continue;
      }
      if (!this.hitsBox(o.box, o.kind === "cone" ? 0.6 : C.CAR_HALF_W))
        continue;
      if (o.kind === "cone") {
        if (!o.hit) {
          o.hit = true;
          car.v *= 0.85;
          ev.push("cone");
        }
        continue;
      }
      const standingCar =
        o.kind === "jamcar" || o.kind === "parked" || o.kind === "stagecar";
      if (standingCar && this.stomp(o, o.h)) {
        ev.push("stomp");
        continue;
      }
      if (carSpan(car).bottom >= o.h) continue;
      if (o.kind === "toll") {
        // FLYERS TOLL $0: drivers who stay on the ground snap the arm and lose their momentum (no wipe-out)
        if (this.t - this.tollT > 1.5) {
          this.tollT = this.t;
          car.v *= 0.55;
          ev.push("toll");
        }
        continue;
      }
      if (standingCar) {
        // standing cars: a solid, immovable car body to bounce off (no wipe-out)
        const hit = obbHit(this.playerObb(), {
          x: (o.box.x0 + o.box.x1) / 2,
          y: (o.box.y0 + o.box.y1) / 2,
          c: 1,
          s: 0,
          hl: (o.box.x1 - o.box.x0) / 2,
          hw: (o.box.y1 - o.box.y0) / 2,
        });
        const e =
          hit &&
          this.vehicleContact(
            hit,
            (o.box.x0 + o.box.x1) / 2,
            (o.box.y0 + o.box.y1) / 2,
            0,
            0,
            Infinity,
            o.kind,
            gate,
            o,
          );
        if (e) ev.push(e);
        continue;
      }
      const mtv = this.penetration(o.box);
      if (mtv) this.pushOut(mtv);
      if (this.firstContact(o)) {
        if (gate && this.bumpCd <= 0) ev.push(this.impact(car.v, o.kind));
        else car.v = Math.min(car.v, 2);
      }
      return ev;
    }
    return ev;
  }

  private playerObb(c = this.car): Obb {
    return {
      x: c.x,
      y: c.y,
      c: Math.cos(c.heading),
      s: Math.sin(c.heading),
      hl: C.CAR_HALF_L,
      hw: C.CAR_HALF_W,
    };
  }

  /**
   * Car-vs-car contact: push the player out along the contact normal and exchange momentum (restitution 0.3,
   * mass-weighted); an off-centre hit spins the player. Never a wipe-out: a light touch is a "bump", a hard one a
   * "hit". Contact is always resolved; events only outside the grace period.
   */
  private vehicleContact(
    hit: { nx: number; ny: number; depth: number },
    ox: number,
    oy: number,
    ovx: number,
    ovy: number,
    mass: number,
    what: string,
    gate: boolean,
    target: unknown,
    npc?: Npc,
  ): string | null {
    const car = this.car;
    car.x += hit.nx * (hit.depth + 0.01);
    car.y += hit.ny * (hit.depth + 0.01);
    if (!this.firstContact(target)) return null;
    const pv = velocity(car);
    const vrel = (pv.vx - ovx) * hit.nx + (pv.vy - ovy) * hit.ny;
    if (vrel >= 0) return null; // already separating
    const inv2 = mass === Infinity ? 0 : 1 / mass;
    const j = (-(1 + RESTITUTION) * vrel) / (1 + inv2);
    const vx = pv.vx + j * hit.nx,
      vy = pv.vy + j * hit.ny;
    const fx = Math.cos(car.heading),
      fy = Math.sin(car.heading);
    car.v = vx * fx + vy * fy;
    car.vLat = -vx * fy + vy * fx;
    // spin from the lever arm: contact ~ the point of our box nearest the other body's centre
    const lx = ox - car.x,
      ly = oy - car.y;
    const ax = C.clamp(lx * fx + ly * fy, -C.CAR_HALF_L, C.CAR_HALF_L),
      az = C.clamp(-lx * fy + ly * fx, -C.CAR_HALF_W, C.CAR_HALF_W);
    const rx = ax * fx - az * fy,
      ry = ax * fy + az * fx;
    // a nudge, not a spin-out: x3 inertia (tyres resist) and capped, so a hard hit turns the car ~18 degrees at most
    // (kickYaw decays at 2.5/s)
    car.kickYaw = C.clamp(
      car.kickYaw + (rx * j * hit.ny - ry * j * hit.nx) / (3 * CAR_INERTIA),
      -0.8,
      0.8,
    );
    const sev = -vrel;
    if (npc) {
      // the other car takes the opposite impulse along its own lane (it stays on its rails)
      const dv = -j * inv2;
      const along =
        dv * (hit.nx * Math.cos(npc.heading) + hit.ny * Math.sin(npc.heading));
      npc.v = C.clamp(npc.v + along, 0, npc.vCruise * 1.5);
      if (sev > 6 && !npc.anim) npc.anim = { kind: "knock", t: 0, dur: 0.7 };
    }
    if (!gate || this.bumpCd > 0 || sev < 1.5) return null;
    this.bumpCd = 0.3;
    const hard = sev >= C.BUMP_MAX_REL;
    return (hard ? "hit:" : "bump:") + what;
  }

  private collideTraffic(gate: boolean): string[] {
    const ev: string[] = [];
    const car = this.car;
    for (const n of this.traffic.npcs) {
      if (n.dead) continue;
      const dx = n.x - car.x,
        dy = n.y - car.y,
        r = n.halfL + C.CAR_HALF_L + 1;
      if (dx * dx + dy * dy > r * r) continue;
      const span = npcSpan(n);
      const hit = obbHit(this.playerObb(), {
        x: n.x,
        y: n.y,
        c: Math.cos(n.heading),
        s: Math.sin(n.heading),
        hl: n.halfL,
        hw: n.halfW,
      });
      if (!hit) continue;
      if (this.stomp(n, span.top, this.previousRoofs.get(n) ?? span.top)) {
        n.v *= 0.7;
        ev.push("stomp");
        continue;
      }
      const player = carSpan(car);
      if (player.bottom >= span.top || player.top <= span.bottom) continue;
      const e = this.vehicleContact(
        hit,
        n.x,
        n.y,
        Math.cos(n.heading) * n.v,
        Math.sin(n.heading) * n.v,
        NPC_MASS[n.kind],
        n.kind,
        gate,
        n,
        n,
      );
      if (e) ev.push(e);
    }
    return ev;
  }

  private stepCeiling(dt: number): void {
    const lim = C.TUNNEL_HALF_X - CEIL_MARGIN;
    for (const c of this.ceilingCars) {
      c.x += c.dir * c.v * dt;
      if (c.dir > 0 && c.x > lim) c.x -= 2 * lim;
      else if (c.dir < 0 && c.x < -lim) c.x += 2 * lim;
    }
  }

  /** Ceiling lanes block any overlapping body, regardless of attachment or flight state. */
  private collideCeiling(gate: boolean): string[] {
    const car = this.car;
    const span = carSpan(car);
    const ev: string[] = [];
    for (const n of this.ceilingCars) {
      if (n.dead) continue;
      const other = npcSpan(n);
      if (span.top <= other.bottom || span.bottom >= other.top) continue;
      if (Math.abs(n.x - car.x) > n.halfL + 4 || Math.abs(n.y - car.y) > 4)
        continue;
      const hit = obbHit(this.playerObb(), {
        x: n.x,
        y: n.y,
        c: Math.cos(n.heading),
        s: Math.sin(n.heading),
        hl: n.halfL,
        hw: n.halfW,
      });
      const e =
        hit &&
        this.vehicleContact(
          hit,
          n.x,
          n.y,
          n.dir * n.v,
          0,
          Infinity,
          "ceilingcar",
          gate,
          n,
        );
      if (e) ev.push(e);
    }
    return ev;
  }

  /** Driving into a sinkhole is an accident: the car drops in nose-first and is stuck (respawn past the hole). */
  private potholeThud(): string[] {
    const car = this.car;
    if (!car.grounded || car.ceiling || car.h > 0.5) return [];
    for (const p of this.city.potholes) {
      if (Math.hypot(p.x - car.x, p.y - car.y) >= p.r * 0.8) continue;
      const e = crashCar(car, "sinkhole", this.rnd);
      if (!e) return [];
      car.pit = { x: p.x, y: p.y };
      car.vx = car.vy = car.vH = 0;
      car.av = [0, 0, 0];
      return ["pothole", e];
    }
    return [];
  }

  /** The sky lane: mid-air, a flying roadster is a crash; coming down on its roof is a bounce off it. */
  private collideSky(gate: boolean): string[] {
    const car = this.car;
    if (car.h < 7 || car.wall) return [];
    const span = carSpan(car);
    const hb = SKY_CAR.H / 2;
    for (let i = 0; i < this.city.sky.length; i++) {
      const p = skyCarAt(this.city.sky[i], i, this.t);
      if (Math.abs(p.x - car.x) > 6 || Math.abs(p.y - car.y) > 4) continue;
      if (span.top <= p.hc - hb || span.bottom >= p.hc + hb) continue;
      const hit = obbHit(this.playerObb(), {
        x: p.x,
        y: p.y,
        c: Math.cos(p.heading),
        s: Math.sin(p.heading),
        hl: SKY_CAR.halfL,
        hw: SKY_CAR.halfW,
      });
      if (!hit) continue;
      if (car.previousBottom >= p.hc + hb - 0.3 && car.vH <= 0) {
        car.h = p.hc + hb;
        car.vH = 6;
        car.sp = Math.min(C.SP_MAX, car.sp + C.SP_STOMP);
        return ["stomp:sky"];
      }
      if (!gate) {
        car.x += hit.nx * (hit.depth + 0.01);
        car.y += hit.ny * (hit.depth + 0.01);
        continue;
      }
      return [crashCar(car, "skycar", this.rnd)];
    }
    return [];
  }
}
