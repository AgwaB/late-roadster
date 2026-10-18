// Clips and VIEWS: the reveal week's stunts as things to film on the way to work. A clip is filmed the first time its
// stunt happens (the page keeps them across runs); every stunt also earns VIEWS, more when chained without a calm
// stretch on the road. Filming every clip opens free roam.
import { type City, inBox, stageAt } from "./city";
import * as C from "./constants";
import { carSpan, type Car } from "./physics";
import { PLAZA, tollCanopy } from "./toll";
import { PLINTH, rampWorld } from "./venue";

export interface Clip {
  id: string;
  title: string;
  /** what to do (shown while locked) */
  how: string;
  /** the clip's caption (shown once filmed) */
  caption: string;
  /** marker colour on the minimap and the beam in the world (clips tied to a place) */
  color?: string;
  /** shown when the car reaches the clip's beam: what to press, right there */
  hint?: string;
}
export const CLIPS: readonly Clip[] = [
  {
    id: "toll",
    title: "TOLL $0",
    how: "Fly over the toll plaza",
    caption: "Flyers don't pay. The queue is still at the booth.",
    color: "#ffd23f",
    hint: "Hold SPACE before the canopy and fly over it",
  },
  {
    id: "park",
    title: "CAN'T PARK THERE",
    how: "Land on the toll canopy roof",
    caption: "Parked on top of the toll plaza. Ticket pending.",
    color: "#ff8a3d",
    hint: "Hold SPACE to fly up, then come down on the canopy roof",
  },
  {
    id: "ramp",
    title: "THE RAMP",
    how: "Ride the event ramp over its lip",
    caption: "Up the wall, over the top, back down on four wheels.",
    color: "#ff4b5c",
    hint: "Drive at the ramp foot straight and fast (SHIFT helps)",
  },
  {
    id: "kickflip",
    title: "THE KICKFLIP",
    how: "Flip over the event's vehicle row",
    caption: "Five vehicles, one barrel roll, not a scratch.",
    color: "#ff5cd6",
    hint: "Jump the row along the run-in, tap SPACE again to flip, land past it",
  },
  {
    id: "ceiling",
    title: "THIS SIDE UP",
    how: "Drive the tunnel ceiling (E)",
    caption: "Upside down through the tunnel. Read the sticker.",
    color: "#3fd7ff",
    hint: "Press E in the tunnel to drive on the ceiling",
  },
  {
    id: "skyway",
    title: "SKYWAY",
    how: "Get up onto the elevated skyway",
    caption: "Up the on-ramp, over the jam.",
    color: "#6f8bff",
    hint: "Keep to the inner lane: the skyway's on-ramp starts by the median",
  },
  {
    id: "hop",
    title: "LEFT LANE HOP",
    how: "Land on another car's roof",
    caption: "Slow car in the fast lane? Went over it.",
  },
  {
    id: "sinkhole",
    title: "SINKHOLE HOP",
    how: "Jump over a sinkhole",
    caption: "The road had a hole. The roadster had jets.",
    color: "#b77cff",
  },
  {
    id: "peloton",
    title: "PELOTON",
    how: "Jump over the cycling club",
    caption: "Five cyclists, one lane, zero stopping.",
  },
  {
    id: "refill",
    title: "REFILL 7H",
    how: "Fly until the FUEL tank runs dry",
    caption: "Tank empty. Estimated refill: seven hours.",
  },
  {
    id: "reset",
    title: "FLIP RESET",
    how: "Land two flips in one jump",
    caption: "Two flips, one jump, wheels down.",
  },
  {
    // id kept as "news" so clips filmed before the rename stay filmed
    id: "news",
    title: "WIPEOUT",
    how: "Wipe out once (river, sinkhole or a flying car)",
    caption: "Three seconds and some dignity, gone.",
  },
];

/** The clips FREE ROAM asks for: every stunt clip (the WIPEOUT one is a souvenir, nobody should have to crash for it). */
export const FREE_ROAM_CLIPS = CLIPS.filter((c) => c.id !== "news");

/** Where the clips tied to a place are filmed: the minimap dots and the light beams in the world (h: ground there). */
export function clipSpots(
  city: City,
): { id: string; x: number; y: number; h: number }[] {
  const out: { id: string; x: number; y: number; h: number }[] = [];
  const tl = city.toll;
  if (tl) {
    out.push({ id: "toll", x: tl.x - 18, y: tl.y - 8, h: 0 });
    out.push({ id: "park", x: tl.x, y: tl.y, h: PLAZA.top });
  }
  const st = city.stage;
  if (st) {
    const f = rampWorld(st.ramp, -24, 0); // on the approach, clear of the upper arm overhead
    out.push({ id: "ramp", x: f.x, y: f.y, h: C.CURB_H });
    const r = stageAt(st, st.rowS);
    out.push({ id: "kickflip", x: r.x, y: r.y, h: C.CURB_H });
  }
  // the tunnel's west mouth, the skyway's first stretch, the middle of the sky lane
  out.push({
    id: "ceiling",
    x: city.tunnel.x0 + 12,
    y: -C.laneOffset(1),
    h: 0,
  });
  out.push({
    id: "skyway",
    x: city.skyway.x0 + city.skyway.ramp + 50, // just past the top of the west ramp
    y: city.skyway.y,
    h: city.skyway.h,
  });
  return out;
}

/**
 * Where the HUD tells you how to film a clip (src/ui/hud.ts, within its hint radius): the clip spots, plus the
 * approaches to the skyway's two on-ramps (the beam on the deck is only seen once you are past them, so its hint is
 * up there only; under the deck it would send you the wrong way). minH: lowest car height the hint shows at.
 */
export function hintSpots(
  city: City,
): { id: string; x: number; y: number; minH: number }[] {
  const sw = city.skyway;
  return [
    ...clipSpots(city).map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      minH: p.id === "skyway" ? p.h - 2 : -Infinity,
    })),
    { id: "skyway", x: sw.x0 - 45, y: sw.y, minH: -Infinity },
    { id: "skyway", x: sw.x1 + 45, y: sw.y, minH: -Infinity },
  ];
}

/** VIEWS per stunt (before the chain multiplier) and per second of air / ceiling time. */
export const VIEWS = {
  flip: 25_000,
  reset: 40_000,
  stomp: 15_000,
  sky: 40_000,
  peloton: 35_000,
  toll: 50_000,
  park: 30_000,
  ramp: 80_000,
  kickflip: 60_000,
  ceilingOn: 10_000,
  /** passing a ceiling-lane car while driving the ceiling yourself */
  overtake: 8_000,
  skyway: 20_000,
  sinkhole: 15_000,
  refill: 10_000,
  crash: 5_000,
  airPerS: 2_000,
  ceilingPerS: 3_000,
} as const;
/** multiplier on the run's VIEWS at the end: on time doubles them, late halves them */
export const ON_TIME_X = 2;
export const LATE_X = 0.5;
/** each chained stunt adds this to the multiplier (capped); CHAIN_RESET s of plain driving ends the chain */
const CHAIN_STEP = 0.25;
const CHAIN_MAX = 3;
const CHAIN_RESET = 2.5;

/** Watches the car and the step's events; returns extra events: "clip:<id>" and "views:<amount>:<multiplier>". */
export class Tracker {
  views = 0;
  chain = 0;
  /** clips first filmed during this run */
  readonly unlocked: string[] = [];
  private calm = 0;
  private latch = new Set<string>();
  private overRow = false;
  private ceilT = 0;
  private out: string[] = [];
  private canopy;
  private row: { x0: number; y0: number; x1: number; y1: number } | null = null;

  constructor(
    private city: City,
    /** every card unlocked so far (this set is updated in place) */
    readonly known: Set<string>,
  ) {
    this.canopy = city.toll ? tollCanopy(city.toll) : null;
    const st = city.stage;
    if (st) {
      const a = stageAt(st, st.rowS - PLINTH.halfS, -PLINTH.halfLat),
        b = stageAt(st, st.rowS + PLINTH.halfS, PLINTH.halfLat);
      this.row = {
        x0: Math.min(a.x, b.x),
        y0: Math.min(a.y, b.y),
        x1: Math.max(a.x, b.x),
        y1: Math.max(a.y, b.y),
      };
    }
  }

  get multiplier(): number {
    return Math.min(CHAIN_MAX, 1 + CHAIN_STEP * this.chain);
  }

  private clip(id: string): void {
    if (this.known.has(id)) return;
    this.known.add(id);
    this.unlocked.push(id);
    this.out.push("clip:" + id);
  }

  private award(base: number): void {
    const mult = this.multiplier;
    const n = Math.round((base * mult) / 100) * 100;
    this.views += n;
    this.chain++;
    this.calm = 0;
    this.out.push("views:" + n + ":" + mult);
  }

  /** a stunt that pays out once per pass: true the first step it holds, again only after it stopped holding */
  private once(key: string, holds: boolean): boolean {
    if (!holds) {
      this.latch.delete(key);
      return false;
    }
    if (this.latch.has(key)) return false;
    this.latch.add(key);
    return true;
  }

  step(dt: number, car: Car, ev: readonly string[]): string[] {
    this.out = [];
    if (car.state === "crash") {
      for (const e of ev)
        if (e.startsWith("crash:")) {
          // a small consolation (less than any stunt), never multiplied by the chain it just broke
          this.clip("news");
          this.chain = 0;
          this.award(VIEWS.crash);
          this.chain = 0;
        }
      this.overRow = false;
      return this.out;
    }
    if (car.state !== "drive") return this.out;
    const span = carSpan(car);
    let flips = 0,
      landed = false;
    for (const e of ev) {
      const [k, v] = e.split(":");
      if (k === "flip") flips = Number(v) || 0;
      else if (k === "land") landed = true;
      else if (k === "stomp") {
        if (v === "sky") this.award(VIEWS.sky);
        else {
          this.clip("hop");
          this.award(VIEWS.stomp);
        }
      } else if (k === "walltop") {
        this.clip("ramp");
        this.award(VIEWS.ramp);
      } else if (k === "over" && v === "peloton") {
        this.clip("peloton");
        this.award(VIEWS.peloton);
      } else if (k === "ceil" && v === "on") this.award(VIEWS.ceilingOn);
      else if (k === "overtake") this.award(VIEWS.overtake);
    }
    if (flips > 0) {
      if (flips >= 2) this.clip("reset");
      this.award(VIEWS.flip * flips + (flips >= 2 ? VIEWS.reset : 0));
    }
    // over the kickflip row in the air, then down with a completed flip
    const air = !car.grounded && !car.ceiling && !car.wall;
    if (air && this.row && inBox(this.row, car.x, car.y) && span.bottom > 1.6)
      this.overRow = true;
    if (landed || car.grounded) {
      // ... and come down past the far end of the row (not back on the approach side)
      const st = this.city.stage;
      const past =
        !!st &&
        (car.x - st.ox) * st.ux + (car.y - st.oy) * st.uy >
          st.rowS + PLINTH.halfS - 1;
      if (this.overRow && flips > 0 && past) {
        this.clip("kickflip");
        this.award(VIEWS.kickflip);
      }
      this.overRow = false;
    }
    const cv = this.canopy;
    if (
      cv &&
      this.once(
        "toll",
        air && inBox(cv, car.x, car.y) && span.bottom > PLAZA.top - 0.05,
      )
    ) {
      this.clip("toll");
      this.award(VIEWS.toll);
    }
    if (
      cv &&
      this.once(
        "park",
        car.grounded && inBox(cv, car.x, car.y) && car.h >= PLAZA.top - 0.05,
      )
    ) {
      this.clip("park");
      this.award(VIEWS.park);
    }
    if (this.once("skyway", car.grounded && car.h >= C.SKY_H - 0.5)) {
      this.clip("skyway");
      this.award(VIEWS.skyway);
    }
    this.city.potholes.forEach((p, i) => {
      const over =
        air &&
        span.bottom > 0.3 &&
        Math.abs(p.x - car.x) < p.r &&
        Math.hypot(p.x - car.x, p.y - car.y) < p.r;
      if (this.once("sink" + i, over)) {
        this.clip("sinkhole");
        this.award(VIEWS.sinkhole);
      }
    });
    if (car.ceiling && car.ceilT >= 1) {
      this.ceilT += dt;
      this.views += VIEWS.ceilingPerS * dt;
      if (this.ceilT >= 1.5) this.clip("ceiling");
    } else this.ceilT = 0;
    if (this.once("refill", car.thrusting && car.fuel <= 0)) {
      this.clip("refill");
      this.award(VIEWS.refill);
    }
    // airtime pays a little all the way up; a calm stretch on the road ends the chain
    if (air && car.h > 2) this.views += VIEWS.airPerS * dt;
    // CHAIN_RESET s of uninterrupted plain driving ends the chain (any air time restarts the count)
    if (car.grounded) {
      this.calm += dt;
      if (this.calm > CHAIN_RESET) this.chain = 0;
    } else this.calm = 0;
    return this.out;
  }
}

/** Human-readable count: 950, 12.4K, 1.2M. */
export function viewsText(n: number): string {
  const short = (v: number, big: boolean) =>
    v.toFixed(big ? 0 : 1).replace(/\.0$/, "");
  if (n >= 1e6) return short(n / 1e6, n >= 1e7) + "M";
  if (n >= 1e3) return short(n / 1e3, n >= 1e5) + "K";
  return String(Math.round(n));
}
