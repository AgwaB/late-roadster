// game-qa adapter (https://github.com/tkymx/game-qa, docs/protocol.md): window.__qa lets a decision model (Jev)
// play the game through its own keyboard input. Code keeps the car on course (steering to a lane, holding the gas);
// the model picks lane changes and stunts among what is possible right now. Static jams that would stall the run are
// handled by a guard (logged as metrics.guard). The adapter also watches for anomalies: the car under the ground,
// NaN, stuck, a wipeout cause other than the three. Dev server only (main.ts imports it under import.meta.env.DEV).
import * as C from "./game/constants";
import { type City, groundAt, skywayAt, underRoof } from "./game/city";
import type { Session } from "./game/session";
import { rampLocal, rampWorld } from "./game/venue";

interface Lr {
  session: Session;
  city: City;
  start(): void;
  teleport(x: number, y: number, heading?: number): void;
}
// SAFETY: main.ts defines window.lr (and collects window.__ev) on the dev server, the only place this file loads
const lr = () => (window as unknown as { lr?: Lr }).lr;
const evLog = () => (window as unknown as { __ev?: string[] }).__ev ?? [];

// ---- the game's own keyboard input
const held = new Set<string>();
const timers = new Set<ReturnType<typeof setTimeout>>();
function key(code: string, down: boolean): void {
  if (down === held.has(code)) return;
  if (down) held.add(code);
  else held.delete(code);
  window.dispatchEvent(
    new KeyboardEvent(down ? "keydown" : "keyup", {
      code,
      key: code,
      bubbles: true,
    }),
  );
}
function later(ms: number, f: () => void): void {
  const t = setTimeout(() => {
    timers.delete(t);
    f();
  }, ms);
  timers.add(t);
}
function hold(code: string, ms: number): void {
  key(code, true);
  later(ms, () => key(code, false));
}
function releaseAll(): void {
  for (const t of timers) clearTimeout(t);
  timers.clear();
  for (const k of [...held]) key(k, false);
}

// ---- the course
type Course = "corridor" | "ramp";
let course: Course = "corridor";
let active = false;
let started = 0;
let lane = 1;
/** up on the skyway deck all four lanes are free to use (no traffic): index by y, left = up the index */
const DECK_Y = [-5.5, -2.05, 2.05, 5.5];
let deckLane = 1;
let guard = false;
let evFrom = 0;
let rode = false;
let wallSeen = false;
let landed: string | null = null;
let flips = 0;
let lastFrame = 0;
/** the session this run plays (the game builds the next one 120 ms after a result: that is the end of the run) */
let runSession: Session | null = null;
let fps = 60;
let stuckS = 0;
/** recent positions (time ms, x, y) for the no-progress check */
const progress: [number, number, number][] = [];
const anomalies: {
  kind: string;
  t: number;
  x: number;
  y: number;
  h: number;
  note?: string;
}[] = [];
const seen = new Set<string>();
function anomaly(kind: string, note?: string): void {
  const c = lr()!.session.car;
  const id = kind + ":" + Math.round(c.x / 20) + ":" + Math.round(c.y / 20);
  if (seen.has(id)) return;
  seen.add(id);
  anomalies.push({
    kind,
    t: +((performance.now() - started) / 1000).toFixed(1),
    x: Math.round(c.x),
    y: Math.round(c.y),
    h: +c.h.toFixed(2),
    note,
  });
}

/** the eastbound corridor's lanes (y < 0 on the y = 0 avenue); kerb lane 3 has parked cars, so 0..2 */
const laneY = (k: number) => -C.laneOffset(k);
function laneOf(y: number): number {
  return Math.max(
    0,
    Math.min(3, Math.round((-y - C.laneOffset(0)) / C.LANE_W)),
  );
}
function where(s: Session): string {
  const c = s.car,
    sw = s.city.skyway,
    k = skywayAt(sw, c.x);
  if (c.ceiling) return "tunnel ceiling";
  if (!c.grounded) return "air";
  if (k && Math.abs(c.y - sw.y) <= k.half && c.h > 0.4)
    return k.ramp ? "skyway ramp" : "skyway deck";
  if (underRoof(s.city, c.x, c.y)) return "tunnel";
  return "road";
}

/** what stands in a lane ahead: nearest gap (m) to traffic, queued / parked cars and barriers, at the car's level */
function gapAhead(s: Session, y: number, range = 90): number | null {
  const c = s.car;
  let best = Infinity;
  const up = c.h > 5 && !c.ceiling;
  const consider = (x: number, oy: number, base: number) => {
    const dx = x - c.x;
    if (dx < 0 || dx > range || Math.abs(oy - y) > 1.8) return;
    if (Math.abs(base - (up ? C.SKY_H : 0)) > 4) return;
    best = Math.min(best, dx);
  };
  for (const n of s.traffic.npcs) if (!n.dead) consider(n.x, n.y, 0);
  if (c.ceiling)
    for (const n of s.ceilingCars) if (!n.dead) consider(n.x, n.y, 0);
  for (const p of s.props)
    if (p.kind === "jamcar" || p.kind === "parked" || p.kind === "barrier")
      consider((p.box.x0 + p.box.x1) / 2, (p.box.y0 + p.box.y1) / 2, p.z0 ?? 0);
  return best === Infinity ? null : Math.round(best);
}

function nextPiece(s: Session): string {
  const city = s.city,
    x = s.car.x,
    sw = city.skyway;
  const pieces: [number, string][] = [];
  if (city.toll)
    pieces.push([
      city.toll.x - 60,
      "toll plaza: every lane queued, fly over the canopy",
    ]);
  pieces.push([city.tunnel.x0, "river tunnel (E: drive on its ceiling)"]);
  pieces.push([-40, "tunnel jam: all lanes blocked (ceiling or hop)"]);
  pieces.push([sw.x0, "skyway on-ramp from lane 0"]);
  pieces.push([
    sw.x0 + sw.ramp + sw.taper + 45,
    "jam on the skyway deck (hop or weave)",
  ]);
  pieces.push([sw.x1 - sw.ramp, "skyway east ramp down"]);
  const p = pieces.find(([px]) => px > x);
  return p ? p[1] + " in " + Math.round(p[0] - x) + " m" : "finish";
}

function sinkholeAhead(s: Session): number | null {
  const c = s.car;
  if (!c.grounded || c.ceiling || c.h > 0.5) return null;
  let best = Infinity;
  for (const p of s.city.potholes) {
    const dx = p.x - c.x;
    if (dx > 0 && dx < 60 && Math.abs(p.y - c.y) < p.r + 1)
      best = Math.min(best, dx);
  }
  return best === Infinity ? null : Math.round(best);
}

/** per frame: steer to the lane, hold the gas, guards, anomaly checks */
function frame(now: number): void {
  if (!active) return;
  requestAnimationFrame(frame);
  const dtF = Math.min(0.2, (now - (lastFrame || now)) / 1000);
  lastFrame = now;
  if (dtF > 0) fps += (1 / dtF - fps) * 0.05;
  const L = lr();
  if (!L) return;
  const s = L.session,
    c = s.car;
  // anomalies
  if (![c.x, c.y, c.h, c.v, c.heading].every(Number.isFinite)) anomaly("nan");
  if (c.state === "drive" && !c.wall) {
    const g = groundAt(s.city, c.x, c.y, c.h).h;
    if (c.h < g - 0.3) anomaly("below_ground", "ground " + g.toFixed(2));
  }
  if (s.lastCrash && !["splash", "sinkhole", "skycar"].includes(s.lastCrash))
    anomaly("bad_wipeout_cause", s.lastCrash);
  if (s.state !== "run" || c.state !== "drive") {
    key("KeyA", false);
    key("KeyD", false);
    return;
  }
  // no progress: under 3 m in 6 s of driving (whatever the speedometer says) is an anomaly, with the car's full state
  progress.push([now, c.x, c.y]);
  while (progress.length && now - progress[0][0] > 6000) progress.shift();
  if (progress.length > 30 && now - progress[0][0] > 5500 && !c.wall) {
    const [, x0, y0] = progress[0];
    if (Math.hypot(c.x - x0, c.y - y0) < 3)
      anomaly(
        "no_progress",
        JSON.stringify({
          h: +c.h.toFixed(2),
          v: +c.v.toFixed(2),
          vH: +c.vH.toFixed(2),
          heading: +c.heading.toFixed(2),
          grounded: c.grounded,
          ceiling: c.ceiling,
          fuel: +c.fuel.toFixed(2),
          sp: Math.round(c.sp),
          ground: +groundAt(s.city, c.x, c.y, c.h).h.toFixed(2),
          y: +c.y.toFixed(2),
        }),
      );
  }
  if (held.has("KeyW") && Math.abs(c.v) < 2 && !c.wall) {
    stuckS += dtF;
    // a player would back out and try again: reverse for a second (logged as a guard)
    if (stuckS > 2.5 && !held.has("KeyS")) {
      guard = true;
      key("KeyW", false);
      hold("KeyS", 1000);
      later(1000, () => (stuckS = 0));
    }
  } else if (!held.has("KeyS")) stuckS = 0;
  // steering
  let ty: number, heading0: number;
  if (course === "ramp") {
    const r = s.city.stage!.ramp;
    heading0 = Math.atan2(r.uy, r.ux);
    const q = rampLocal(r, c.x, c.y);
    ty = -q.w; // back onto the run-in's centre line (w is to its left)
    if (c.wall || rode) {
      key("KeyA", false);
      key("KeyD", false);
      return;
    }
    key("KeyW", true);
    steer(c.heading, heading0, ty, Math.max(14, c.v * 0.6));
    return;
  }
  heading0 = 0;
  const sw = s.city.skyway,
    k = skywayAt(sw, c.x);
  const here = where(s);
  if (here === "skyway deck") ty = DECK_Y[deckLane];
  else if (here === "skyway ramp") {
    ty = -2.3;
    deckLane = 1; // onto the deck in its inner eastbound lane
  } else {
    // under the deck lane 0 runs into the east ramp's concrete end: keep out of it there
    if (k && c.h < 5 && lane === 0 && c.x > sw.x0 + sw.ramp) lane = 1;
    ty = laneY(lane);
  }
  if (!held.has("KeyS")) key("KeyW", true);
  // guards: the static jams would stall the run (toll queue, tunnel jam, deck jam): get over them
  guard = false;
  const gap = gapAhead(s, c.y, 18);
  if (
    gap !== null &&
    gap < 14 &&
    c.grounded &&
    !c.ceiling &&
    !held.has("Space")
  ) {
    guard = true;
    if (underRoof(s.city, c.x, c.y)) hold("KeyE", 80);
    else if (c.sp >= C.SP_JUMP) hold("Space", c.fuel > 0.3 ? 900 : 60);
  }
  steer(c.heading, heading0, ty, Math.max(18, c.v * 0.7));
}

function steer(heading: number, along: number, ty: number, look: number): void {
  const c = lr()!.session.car;
  const lateral = course === "ramp" ? ty : ty - c.y; // + = to the left of the direction of travel
  let e = along + Math.atan2(lateral, look) - heading;
  e = Math.atan2(Math.sin(e), Math.cos(e));
  key("KeyA", e > 0.025);
  key("KeyD", e < -0.025);
}

// ---- the protocol
const QA = {
  configure(options: { course?: Course }) {
    course = options.course === "ramp" ? "ramp" : "corridor";
    const L = lr()!;
    L.start();
    releaseAll();
    anomalies.length = 0;
    progress.length = 0;
    seen.clear();
    rode = wallSeen = false;
    landed = null;
    flips = 0;
    started = performance.now();
    later(400, () => {
      const city = L.city;
      if (course === "ramp") {
        const r = city.stage!.ramp,
          p = rampWorld(r, -70, 0);
        L.teleport(p.x, p.y, Math.atan2(r.uy, r.ux));
      } else {
        lane = 1;
        L.teleport((city.toll?.x ?? -520) - 240, laneY(lane), 0);
      }
      evFrom = evLog().length;
      runSession = L.session;
      L.session.car.invuln = 0;
      if (!active) {
        active = true;
        requestAnimationFrame(frame);
      }
    });
  },

  observe() {
    const L = lr();
    if (!L || !active) return null;
    const s = L.session,
      c = s.car;
    // events since the last look (landings, flips)
    const ev = evLog();
    for (let i = evFrom; i < ev.length; i++) {
      const e = ev[i];
      if (e === "walltop") rode = true;
      if (e === "wall") wallSeen = true;
      if (e.startsWith("flip:")) flips = Math.max(flips, Number(e.slice(5)));
      if (rode && e.startsWith("land:")) landed = e.slice(5);
    }
    evFrom = ev.length;
    const metrics = {
      scene: course,
      x: Math.round(c.x),
      kmh: Math.round(Math.abs(c.v) * 3.6),
      views: Math.round(s.views),
      wipeouts: c.crashes,
      clips: s.tracker.unlocked.join(" ") || "-",
      anomalies: anomalies.length,
      fps: Math.round(fps),
      guard,
    };
    const finish = (success: boolean, reason: string) => {
      active = false;
      releaseAll();
      const rs = runSession ?? s; // (the run's own session, also once the game has moved on to the next one)
      return {
        done: {
          success,
          reason,
          anomalies,
          clips: rs.tracker.unlocked,
          views: Math.round(rs.views),
          wipeouts: rs.car.crashes,
          flips,
          landed,
        },
        metrics,
      };
    };
    if (runSession && s !== runSession) {
      const res = runSession.result;
      return finish(!!res?.finished, "session " + (res?.grade ?? "replaced"));
    }
    if (s.state !== "run")
      return finish(
        !!s.result?.finished,
        "session " + (s.result?.grade ?? "over"),
      );
    if (course === "corridor" && c.x >= s.city.skyway.x1 + 40)
      return finish(anomalies.length === 0, "reached the end of the corridor");
    if (course === "ramp") {
      if (landed)
        return finish(
          landed !== "rough",
          "landed " + landed + (flips >= 2 ? " with one more flip" : ""),
        );
      if (!rode && wallSeen && !c.wall && c.v <= 0)
        return finish(false, "rolled back off the foot");
    }
    if (c.state !== "drive") return null; // wipeout replay: nothing to decide
    // put back somewhere else (a respawn, a hard bounce): follow the lane it is in now
    if (
      course === "corridor" &&
      where(s) === "road" &&
      Math.abs(c.y - laneY(lane)) > 5
    )
      lane = Math.min(2, laneOf(c.y));
    return course === "ramp"
      ? rampQuestion(s, metrics)
      : corridorQuestion(s, metrics);
  },

  act(answers: { action?: { choice?: string } }) {
    const L = lr();
    if (!L || !active) return;
    const c = L.session.car;
    switch (answers.action?.choice) {
      case "left":
        if (where(L.session) === "skyway deck")
          deckLane = Math.min(3, deckLane + 1);
        else lane = Math.max(0, lane - 1);
        break;
      case "right":
        if (where(L.session) === "skyway deck")
          deckLane = Math.max(0, deckLane - 1);
        else lane = Math.min(2, lane + 1);
        break;
      case "hop":
        hold("Space", 60);
        break;
      case "flip":
        hold("Space", 60);
        later(260, () => hold("Space", 60));
        break;
      case "fly":
        hold("Space", 1400);
        break;
      case "boost":
        hold("ShiftLeft", 1200);
        break;
      case "ceiling":
      case "drop":
        hold("KeyE", 80);
        break;
      case "one_more_flip":
        if (c.rampDrop) hold("Space", 60);
        break;
      case "brake":
        key("KeyW", false);
        hold("KeyS", 500);
        break;
    }
  },

  /** for the record: what the adapter has seen so far */
  get anomalies() {
    return anomalies.slice();
  },
};

function corridorQuestion(s: Session, metrics: Record<string, unknown>) {
  const c = s.car,
    sw = s.city.skyway;
  const here = where(s);
  const grounded = c.grounded && !c.ceiling;
  const deck = here === "skyway deck";
  const onRamp = here === "skyway ramp";
  const k = skywayAt(sw, c.x);
  const underDeck = !!k && c.h < 5 && c.x > sw.x0 + sw.ramp && c.x < sw.x1;
  const minLane = underDeck ? 1 : 0;
  const canLeft = deck ? deckLane < 3 : !onRamp && lane > minLane;
  const canRight = deck ? deckLane > 0 : !onRamp && lane < 2;
  const tunnel = underRoof(s.city, c.x, c.y);
  const criteria: Record<string, string> = {
    keep: "keep this lane at full speed",
  };
  if (canLeft) criteria.left = "move one lane left";
  if (canRight) criteria.right = "move one lane right";
  if (grounded && c.sp >= C.SP_JUMP) {
    criteria.hop = "tap Space: a short hop (over a car or a sinkhole)";
    criteria.flip = "jump and flip (stunt VIEWS)";
  }
  if (!tunnel && !c.ceiling && c.fuel > 0.3)
    criteria.fly = "hold Space: fly on the jets for ~1.4 s";
  if (grounded && c.sp >= C.SP_BOOST_MIN && !c.boosting)
    criteria.boost = "boost for ~1.2 s (uses SP)";
  if (tunnel && grounded)
    criteria.ceiling = "E: up onto the tunnel ceiling (avoids the tunnel jam)";
  if (c.ceiling) criteria.drop = "E: drop back down to the road";
  const yL = deck
    ? DECK_Y[Math.min(3, deckLane + 1)]
    : laneY(Math.max(0, lane - 1));
  const yR = deck
    ? DECK_Y[Math.max(0, deckLane - 1)]
    : laneY(Math.min(2, lane + 1));
  const state = {
    where: here,
    kmh: Math.round(Math.abs(c.v) * 3.6),
    lane: deck ? "deck lane " + deckLane + " of 0-3" : lane,
    heightM: +c.h.toFixed(1),
    fuel: Math.round(c.fuel * 100) + "%",
    sp: Math.round(c.sp),
    carAheadM: {
      thisLane: gapAhead(s, c.y),
      left: canLeft ? gapAhead(s, yL) : null,
      right: canRight ? gapAhead(s, yR) : null,
    },
    sinkholeAheadM: sinkholeAhead(s),
    next: nextPiece(s),
    toFinishM: Math.round(sw.x1 + 40 - c.x),
    secondsLeft: Math.round(s.timeLeft),
    views: Math.round(s.views),
  };
  return {
    state,
    questions: {
      action: {
        type: "choice",
        instructions:
          "You drive a jet roadster east along the avenue to the finish before the clock runs out, earning VIEWS with stunts. " +
          "Get over sinkholes and jams (hop / fly / tunnel ceiling), take the skyway on-ramp from lane 0 if you like. " +
          "Sinkholes, the river and flying cars higher than ~8 m are the only wipeouts. Pick the next action.",
        criteria,
      },
    },
    metrics,
    display: Object.entries(state).map(
      ([k2, v]) => k2 + ": " + (typeof v === "string" ? v : JSON.stringify(v)),
    ),
  };
}

function rampQuestion(s: Session, metrics: Record<string, unknown>) {
  const c = s.car;
  const r = s.city.stage!.ramp;
  const q = rampLocal(r, c.x, c.y);
  if (c.wall) return null; // riding the wall: nothing to decide
  const criteria: Record<string, string> = {};
  if (!rode) {
    criteria.gas = "keep the gas on";
    if (c.grounded && c.sp >= C.SP_BOOST_MIN && !c.boosting)
      criteria.boost = "boost for ~1.2 s";
    criteria.brake = "brake for half a second";
  } else if (c.rampDrop && !c.grounded) {
    criteria.settle = "let the jets bring it down";
    if (flips < 2)
      criteria.one_more_flip = "tap Space: one more flip on the way down";
  } else return null;
  const state = {
    phase: rode ? "coming down off the ramp's lip" : "run-in toward the ramp",
    toRampFootM: Math.round(-q.u),
    kmh: Math.round(Math.abs(c.v) * 3.6),
    heightM: +c.h.toFixed(1),
    sp: Math.round(c.sp),
    needKmh: "about 120+ at the foot to make it over the top",
  };
  return {
    state,
    questions: {
      action: {
        type: "choice",
        instructions:
          "Ride the event ramp: reach its foot fast enough to go up the wall and over the lip, then land. Pick the next action.",
        criteria,
      },
    },
    metrics: { ...metrics, rampU: Math.round(q.u) },
    display: Object.entries(state).map(([k2, v]) => k2 + ": " + v),
  };
}

export function installQa(): void {
  // SAFETY: the hook game-qa looks up (qa/qa.config.json "hook", default __qa)
  (window as unknown as { __qa: typeof QA }).__qa = QA;
}
