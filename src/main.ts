import * as THREE from "three";
import { CAR_H, CEIL_H, CEIL_RISE } from "./game/constants";
import { buildCity, groundAt, inBox, skywayAt, underRoof } from "./game/city";
import { PLAZA } from "./game/toll";
import { dailySeed } from "./game/rng";
import { Session } from "./game/session";
import { InputState } from "./input";
import { loadAssets } from "./render/assets";
import { ChaseCam } from "./render/camera";
import { buildCityView, type CityView } from "./render/cityMesh";
import { HazardRenderer } from "./render/hazards";
import { MemeView } from "./render/memes";
import { ClipRecorder } from "./share";
import { Sfx } from "./audio";
import { NO_INPUT, type Input } from "./game/physics";
import {
  Particles,
  driftSmoke,
  exhaust,
  gasCloud,
  puff,
  sparks,
  thrusterStream,
} from "./render/fx";
import { createScene } from "./render/scene";
import { NpcRenderer, buildPlayerCar } from "./render/vehicles";
import { Hud, crashCause } from "./ui/hud";
import { Lobby } from "./ui/lobby";
import { CLIPS } from "./game/score";
import { rampWorld } from "./game/venue";
import {
  bestGradeOf,
  finiteOr,
  load as loadP,
  parseSet,
  save as saveP,
  saveBest,
  saveSetMerged,
  type Store,
} from "./progress";

const STEP = 1 / 120;
const MAX_STEPS = 8;
let acc = 0;
let last = performance.now();
let lastCrashMediaTime: number | null = null;
// Hidden tabs pause simulation; no elapsed wall time is replayed on return.
document.addEventListener("visibilitychange", () => {
  acc = 0;
  last = performance.now();
});
const canvas = document.getElementById("c") as HTMLCanvasElement;
const kit = createScene(canvas);
const isTouch =
  matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
const input = new InputState();
const hud = new Hud(document.getElementById("hud")!, input, isTouch);
const cam = new ChaseCam(kit.camera);
const fx = new Particles();
kit.scene.add(fx.points);

// progress kept across visits (src/progress.ts): filmed clips (key lr.cards, kept from when they were cards), which
// crash tips were shown, best grade and VIEWS; saves merge with what another tab may have stored meanwhile
const store: Store | null = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
const load = (k: string) => loadP(store, k);
const save = (k: string, v: string) => saveP(store, k, v);
const readSet = (k: string) => parseSet(load(k));
const saveSet = (k: string, s: Set<string>) => saveSetMerged(store, k, s);
const known = readSet("lr.cards");
const tipsShown = readSet("lr.tips");
let bestViews = finiteOr(load("lr.bestViews"), 0);
let bestGrade = bestGradeOf(load("lr.bestGrade"), null);
// another tab filmed a clip or set a best: take it in (its next save merges with ours anyway)
window.addEventListener("storage", (e) => {
  if (e.key === "lr.cards") for (const v of parseSet(e.newValue)) known.add(v);
  else if (e.key === "lr.bestViews")
    bestViews = Math.max(bestViews, finiteOr(e.newValue, 0));
  else if (e.key === "lr.bestGrade")
    bestGrade = bestGradeOf(bestGrade, e.newValue);
});

const lobby = new Lobby(
  document.getElementById("hud")!,
  {
    start: () => begin(false),
    free: () => begin(true),
  },
  isTouch,
);
hud.onLobby = () => {
  if (!lobby.isOpen && session.state === "run") openLobby();
};
// the whole lobby is laid out while loading (the clips and bests are already known; today's commute is a
// placeholder until the city is built), so it does not grow and jump when the loading is done
lobby.show({
  persona: "",
  distance: 0,
  bestGrade,
  bestViews,
  known,
  thumb: (id: string) => load("lr.thumb." + id),
});
const assets = await loadAssets((d, t) => lobby.setLoading(d / t));
kit.setSky(assets.sky, assets.skyBg);
const city = buildCity(dailySeed());
hud.prepareMini(city);

let runIndex = Math.floor(finiteOr(load("lr.run"), 0));
let resultShown = false;
/** the lobby is up (or the run has not been started from it yet): the simulation does not step */
let paused = true;
/** the current session has been driven (leaving it moves on to the next commute) */
let started = false;
let lastInput: Input = NO_INPUT;
let cityView: CityView | null = null;
/** 4x4 target the shaders are compiled against (see newSession) */
let warmRT: THREE.WebGLRenderTarget | undefined;
// approved round-3 design master (R_00_v2) is silver
const player = buildPlayerCar(assets, 0xc9cdd2);
kit.scene.add(player.root);
const npcs = new NpcRenderer(assets, kit.scene);
// TICKET PENDING: park on the toll canopy roof and a ticket lands under the wiper; it blows away on the next take-off
const ticket = (() => {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 80;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fbf8ee";
  g.fillRect(0, 0, 128, 80);
  g.fillStyle = "#d62b2b";
  g.fillRect(0, 0, 128, 20);
  g.fillStyle = "#fff";
  g.font = "800 15px system-ui, sans-serif";
  g.textAlign = "center";
  g.fillText("NOTICE", 64, 15);
  g.fillStyle = "#333";
  g.font = "700 12px system-ui, sans-serif";
  g.fillText("ROOF PARKING", 64, 42);
  g.fillText("NOT PERMITTED", 64, 60);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    // flat, then turned so it reads across the car from the front, then laid on the glass's slope
    new THREE.PlaneGeometry(0.36, 0.23)
      .rotateX(-Math.PI / 2)
      .rotateY(Math.PI / 2)
      .rotateZ(-0.28),
    new THREE.MeshStandardMaterial({
      map: t,
      roughness: 0.9,
      side: THREE.DoubleSide,
    }),
  );
  // on the windscreen, driver's side (body frame: x forward, y up, z right; the glass is ~1.07 m up there, at 16°)
  m.position.set(0.9, 1.1, 0.3);
  m.visible = false;
  (player.root.children[0] as THREE.Group).add(m);
  return m;
})();
const PAPER = new THREE.Color(0.97, 0.96, 0.9);
// side balance jets (body frame: x forward, y up, z right), each pair blowing straight out of its side
const SIDE_JETS_R = [
    new THREE.Vector3(0.6, 0.6, 1.0),
    new THREE.Vector3(-1.0, 0.6, 1.0),
  ],
  SIDE_JETS_L = [
    new THREE.Vector3(0.6, 0.6, -1.0),
    new THREE.Vector3(-1.0, 0.6, -1.0),
  ];
const SIDE_R = new THREE.Vector3(0, 0, 1),
  SIDE_L = new THREE.Vector3(0, 0, -1);
// the visual memes are built once for the whole page (not per commute)
const memes = new MemeView(city, assets);
kit.scene.add(memes.group);
const clip = new ClipRecorder(canvas);
const sfx = new Sfx();
for (const evName of ["keydown", "pointerdown", "touchstart"] as const)
  window.addEventListener(evName, () => sfx.unlock(), { passive: true });
window.addEventListener("keydown", (e) => {
  hud.handleResultKey(e);
  // ESC or Q: give up this run and go back to the lobby (Q too: some browsers keep ESC for themselves);
  // not while the credits are up (their ESC closes them, and it arrives here as already handled)
  if (
    (e.code === "Escape" || e.code === "KeyQ") &&
    !e.repeat &&
    !e.defaultPrevented &&
    !hud.paused &&
    !hud.resultShowing &&
    !lobby.isOpen &&
    session.state === "run"
  ) {
    e.preventDefault();
    openLobby();
  }
});
const hazardsView = new HazardRenderer(kit.scene, (n) => assets.tex.get(n));
let devCam: { pos: number[]; look: number[] } | null = null;
// per-run presentation (declared before the first newSession(), which clears it)
/** real seconds of slow motion left (set over the ramp's lip) */
let slowT = 0;
/** the rocket's liftoff shot is on (the world runs slowed around it) */
let rocketShot = false;
/** JUMP / STICK pressed to skip the liftoff shot: not passed on to the car until released */
let swallowKeys = false;
/** a parking ticket is stuck on the windscreen */
let ticketed = false;
/** the run's best stunt so far, by recording time (SAVE <label> on the result card films around it) */
let bestStunt: { t: number; label: string; rank: number } | null = null;
/** a stunt worth a clip: kept if it ranks at least as high as the best so far (later wins a tie) */
function stunt(label: string, rank: number): void {
  if (!bestStunt || rank >= bestStunt.rank)
    bestStunt = { t: clip.elapsed, label, rank };
}
/** PHOTO FINISH: caption of the arrival photo taken from the next frame drawn */
let pendingPhoto: { caption: string; late: boolean } | null = null;
/** clips just filmed for the first time: their lobby thumbnail is taken from the next frame drawn */
const pendingThumbs: string[] = [];
/** the car left the ramp's lip and has not touched down yet: its landing is the big moment */
let rampFlight = false;
/** Seconds of downward thruster burn left to draw (jump launch, rotation burn). */
let burnT = 0,
  burnMax = 1;
/** s until the next ground gas cloud under the hold-to-fly jets */
let thrustCloudT = 0;
let session = newSession(false);

/**
 * A new session: nothing of the last run's show carries over (a ramp flight abandoned mid-air would otherwise film
 * the next commute's first jump from the venue and cheer its landing; a liftoff shot or slow motion would run on).
 */
function resetRunPresentation(): void {
  slowT = 0;
  rocketShot = false;
  ticketed = ticket.visible = false;
  bestStunt = null;
  pendingPhoto = null;
  pendingThumbs.length = 0;
  hud.setCutaway(false);
  swallowKeys = false;
  rampFlight = false;
  burnT = 0;
  burnMax = 1;
  thrustCloudT = 0;
  memes.resetRun();
}
lobby.show(lobbyInfo());
lobby.setReady();

function lobbyInfo() {
  return {
    persona: session.persona,
    distance: session.commute.dist,
    bestGrade,
    bestViews,
    known,
    thumb: (id: string) => load("lr.thumb." + id),
  };
}

/** Leave the current run (abandoned or finished): the next session is the next commute. */
function moveOn(): void {
  if (!started) return;
  started = false;
  runIndex++;
  save("lr.run", String(runIndex));
}

/** Back to the lobby, with the next commute already set up behind it. */
function openLobby(): void {
  paused = true;
  clip.discard();
  if (started || session.free) {
    moveOn();
    session = newSession(false);
  }
  input.setGameplayEnabled(false);
  lobby.show(lobbyInfo());
}

/** START / FREE ROAM from the lobby, or NEXT COMMUTE from the result card. */
function begin(free: boolean): void {
  if (session.free !== free || started) {
    moveOn();
    session = newSession(free);
  }
  lobby.hide();
  input.setGameplayEnabled(true);
  started = true;
  paused = false;
  acc = 0;
  last = performance.now();
  // free roam has no result card and no SAVE CLIP, so nothing to record (an open-ended recording only grows)
  if (!free) clip.start();
}

function newSession(free: boolean): Session {
  acc = 0;
  lastCrashMediaTime = null;
  resetRunPresentation();
  npcs.sync([]);
  resultShown = false;
  // the city's own seed: a tab left open past midnight keeps playing the day it built
  const s = new Session(city, city.seed, runIndex, undefined, {
    free,
    known,
  });
  if (cityView) {
    kit.scene.remove(cityView.group);
    cityView.dispose();
  }
  cityView = buildCityView(city, assets, s.office, s.layout);
  kit.scene.add(cityView.group);
  memes.placeOnRoofs(cityView.heroes);
  // compile every material and upload every texture up front: otherwise shaders compile and 2k textures upload
  // mid-drive as they first enter the frustum (100-300 ms hitches on the first pass through each district)
  npcs.prewarm();
  // Warm draw: every object once, into an offscreen target (the composer's variant: linear output, no tone mapping),
  // with frustum culling off, hidden things shown and empty instanced batches given one copy, so every shader (shadow
  // passes and two-pass transparent ones included) compiles and every buffer uploads now, behind the lobby or the
  // result card. A plain compile() missed variants: streamed buildings, boosters, sparks and jets then compiled
  // mid-drive on first sight (50-300 ms hitches).
  {
    warmRT ??= new THREE.WebGLRenderTarget(8, 8, { type: THREE.HalfFloatType });
    const restore: (() => void)[] = [];
    kit.scene.traverse((o) => {
      if (o.frustumCulled) {
        o.frustumCulled = false;
        restore.push(() => (o.frustumCulled = true));
      }
      // (never a light: the light count is part of every program, it must stay as in play)
      if (!o.visible && !(o as THREE.Light).isLight) {
        o.visible = true;
        restore.push(() => (o.visible = false));
      }
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh && im.count === 0) {
        im.count = 1;
        restore.push(() => (im.count = 0));
      }
    });
    kit.renderer.setRenderTarget(warmRT);
    kit.renderer.render(kit.scene, kit.camera);
    kit.renderer.setRenderTarget(null);
    for (const f of restore) f();
  }
  {
    const seen = new Set<THREE.Texture>();
    const keys = [
      "map",
      "normalMap",
      "roughnessMap",
      "metalnessMap",
      "aoMap",
      "emissiveMap",
      "alphaMap",
    ] as const;
    kit.scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material;
      if (!mat) return;
      for (const mt of Array.isArray(mat) ? mat : [mat]) {
        for (const k of keys) {
          const t = (mt as unknown as Record<string, THREE.Texture | null>)[k];
          if (t && !seen.has(t)) {
            seen.add(t);
            kit.renderer.initTexture(t);
          }
        }
      }
    });
    for (const t of assets.tex.values())
      if (!seen.has(t)) kit.renderer.initTexture(t);
  }
  cam.reset();
  last = performance.now();
  return s;
}

function syncNpcs(): void {
  // traffic beyond 330 m is not drawn (fog has it 20 % gone there; ~200 cars city-wide)
  npcs.sync(
    session.traffic.npcs,
    session.ceilingCars,
    kit.camera.position.x,
    kit.camera.position.z,
    330,
  );
}

const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
const DOWN = new THREE.Vector3(0, -1, 0),
  UP = new THREE.Vector3(0, 1, 0);
let wheelSteer = 0;
// BREAKING NEWS cards (top right): the city's other roadsters make the news now and then (a nearby wipeout or flip
// pile-up, or a story every 35-60 s); the player's own wipeout never does. Pictures: the round-5 clip images.
const NEWS: { img: string; lines: string[] }[] = [
  {
    img: "hop", // CL_07: a roadster come down on a sedan's roof in the fast lane
    lines: [
      "FLIP PILE-UP: ROADSTER LANDS ON THE CAR AHEAD",
      "COMMUTER PARKS ON A SEDAN, MID-TRAFFIC",
      "SEDAN DRIVER: 'IT JUST CAME DOWN ON ME'",
    ],
  },
  {
    img: "news", // CL_12: a roadster on its roof, commuters filming
    lines: [
      "MORNING FLIP ENDS UPSIDE DOWN",
      "ROADSTER ON ITS ROOF, COMMUTERS FILM",
      "INSURER STOPS WATCHING HALFWAY THROUGH",
    ],
  },
  {
    img: "sinkhole", // CL_08: a roadster jumping a sinkhole
    lines: [
      "SINKHOLE OPENS ON THE BOULEVARD",
      "CITY: SINKHOLES 'NOT A SHORTCUT'",
    ],
  },
];
const NEWS_PILEUP = 0,
  NEWS_WIPEOUT = 1;
let lastNewsT = -1e9;
let nextNewsT = 20;
function newsFlash(i: number): void {
  const n = NEWS[i];
  hud.news(
    import.meta.env.BASE_URL + "assets/clips/" + n.img + ".webp",
    n.lines[Math.floor(Math.random() * n.lines.length)],
  );
  sfx.event("news");
  lastNewsT = session.t;
  nextNewsT = session.t + 35 + Math.random() * 25;
}
const cinePos = new THREE.Vector3(),
  cineLook = new THREE.Vector3();
const spinAxisV = new THREE.Vector3(),
  spinQ = new THREE.Quaternion();
function handleEvents(ev: string[]): void {
  if (import.meta.env.DEV && ev.length)
    ((window as unknown as { __ev: string[] }).__ev ??= []).push(...ev);
  const flipped = ev.some((e) => e.startsWith("flip:"));
  const inner = player.root.children[0] as THREE.Group;
  inner.updateMatrixWorld(true);
  const M = inner.matrixWorld;
  // any take-off (or a wipe-out) blows the parking ticket off the windscreen
  if (
    ticketed &&
    ev.some(
      (e) =>
        e === "jump" ||
        e === "launch" ||
        e === "flipStart" ||
        e === "wall" ||
        e.startsWith("crash"),
    )
  ) {
    ticketed = ticket.visible = false;
    const p = ticket.position.clone().applyMatrix4(M);
    for (let i = 0; i < 8; i++)
      fx.emit(
        p,
        new THREE.Vector3(
          (Math.random() - 0.5) * 3,
          3 + Math.random() * 3,
          (Math.random() - 0.5) * 3,
        ),
        2.2,
        0.3,
        PAPER,
        { drag: 1.5, grav: 2, spread: 0.6 },
      );
    hud.notice("TICKET", "PENDING");
  }
  for (const e of ev) {
    const [k, v] = e.split(":");
    // NPC-vs-NPC wrecks are heard (and reported) only when they happen near the player
    let near = true;
    if (k === "npccrash" || k === "npcfail" || k === "npcjet") {
      const n = session.traffic.npcs.find((o) => o.id === Number(v));
      near = !!n && Math.hypot(n.x - session.car.x, n.y - session.car.y) < 120;
    }
    if (near) sfx.event(k, v);
    // on-screen captions: the WIPEOUT band on a crash and the BREAKING NEWS cards about other roadsters
    if (k === "land") {
      // touchdown in a cloud of cold gas, as in the demo
      const c = session.car;
      gasCloud(
        fx,
        new THREE.Vector3(c.x, groundAt(city, c.x, c.y, c.h).h, -c.y),
        flipped ? 90 : 45,
        2.4,
        flipped ? 1.3 : 0.9,
      );
      for (const n of player.bottomNozzles) puff(fx, M, n, DOWN, 8, 8);
      // a botched landing slams back onto the wheels: sparks instead of a wipe-out
      if (v === "rough") sparks(fx, player.root.position.clone(), 35);
      // parked on the toll canopy roof: a ticket under the wiper
      if (
        !ticketed &&
        Math.abs(c.h - PLAZA.top) < 0.1 &&
        city.decks.some((d) => inBox(d.box, c.x, c.y))
      ) {
        ticketed = ticket.visible = true;
        hud.notice("PARKING TICKET", "NO PERMIT FOR THE ROOF");
      }
      if (rampFlight) {
        // down off the ramp: the stands erupt, the beams find the car, confetti, a camera jolt, and the rocket by
        // the run-in lifts off
        rampFlight = false;
        const big = v !== "rough";
        const fl = ev.find((e) => e.startsWith("flip:"));
        const extra = big && !!fl && Number(fl.split(":")[1]) >= 2;
        stunt(extra ? "RAMP EXTRA FLIP" : "THE RAMP", extra ? 4 : 3);
        if (memes.celebrate(c.x, c.y, wall, big, fx, extra))
          sfx.event("liftoff");
        sfx.event("applause", big ? "big" : "small");
        cam.kick(big ? 0.9 : 0.5);
      }
    } else if (k === "scrape") {
      sparks(fx, player.root.position.clone(), 6);
    } else if (k === "toll") {
      sparks(fx, player.root.position.clone(), 18);
    } else if (k === "pothole") {
      const c = session.car;
      gasCloud(fx, new THREE.Vector3(c.x, 0.1, -c.y), 60, 2.2, 1.0);
      sparks(fx, player.root.position.clone(), 30);
    } else if (k === "npcjet") {
      // a commuter jets over a pothole or the toll arm
      const n = session.traffic.npcs.find((o) => o.id === Number(v));
      if (n && near)
        gasCloud(fx, new THREE.Vector3(n.x, 0.1, -n.y), 24, 1.6, 0.7);
    } else if (k === "stomp") {
      for (const n of player.bottomNozzles) puff(fx, M, n, DOWN, 6, 6);
    } else if (k === "bump") {
      sparks(fx, player.root.position.clone(), 12);
    } else if (k === "hit") {
      sparks(fx, player.root.position.clone(), 40);
    } else if (k === "boost") {
      if (v === "off") {
        /* flame handled by state */
      } else exhaust(fx, M, player.rearNozzles, 12);
    } else if (k === "sidestep") {
      for (const n of player.bottomNozzles) puff(fx, M, n, DOWN, 5, 6);
    } else if (k === "ceil" && v === "on") {
      // jet-powered rise to the ceiling: all four bottom jets fire for the climb (dropping off uses no jets)
      for (const n of player.bottomNozzles) puff(fx, M, n, DOWN, 16, 16);
      burnT = burnMax = CEIL_RISE;
    } else if (k === "jump") {
      // launch: four downward jets + a gas cloud rolling out from under the car
      for (const n of player.bottomNozzles) puff(fx, M, n, DOWN, 16, 16);
      const c = session.car;
      gasCloud(
        fx,
        new THREE.Vector3(c.x, groundAt(city, c.x, c.y, c.h).h, -c.y),
        70,
        2.2,
        1.1,
      );
      burnT = burnMax = 0.4;
    } else if (k === "flipStart") {
      // flip launch: a blast of gas under the car as it shoots up, then the jets stay lit through the turn
      for (const n of player.bottomNozzles) puff(fx, M, n, DOWN, 16, 16);
      {
        const c = session.car;
        const gh = groundAt(city, c.x, c.y, c.h).h;
        if (c.h - gh < 5)
          gasCloud(fx, new THREE.Vector3(c.x, gh, -c.y), 60, 2.4, 1.0);
      }
      for (const n of player.rearNozzles) puff(fx, M, n, UP, 8, 10);
      burnT = burnMax = Math.max(0.35, (Math.PI * 2) / session.car.flipRate);
    } else if (k === "cart") {
      // CART RETURN at ORBIT MART: the carts top up the tank
      const c = session.car;
      gasCloud(
        fx,
        new THREE.Vector3(c.x, groundAt(city, c.x, c.y, c.h).h, -c.y),
        50,
        2.4,
        0.8,
      );
      hud.notice("CART RETURN", "TANK FULL");
    } else if (k === "retro") {
      // the jets catch the car falling off the ramp: a burst out of all four, then they hold it (frame loop)
      for (const n of player.bottomNozzles) puff(fx, M, n, DOWN, 18, 18);
    } else if (k === "walltop") {
      slowT = 0.9;
      rampFlight = true;
      // over the lip: the side jets fire to start the roll upright (they keep at it in the frame loop)
      for (const n of SIDE_JETS_R) puff(fx, M, n, SIDE_R, 14, 16);
    } else if (k === "crash") {
      rampFlight = false;
      lastCrashMediaTime = clip.elapsed;
      sparks(fx, player.root.position.clone(), 60);
      // the cause as a headline; the tip only the first time this cause happens
      hud.crash(v, !tipsShown.has(v), session.free);
      if (!tipsShown.has(v)) {
        tipsShown.add(v);
        saveSet("lr.tips", tipsShown);
      }
    } else if (k === "clip") {
      hud.clipToast(v);
      saveSet("lr.cards", known);
      pendingThumbs.push(v);
      if (v === "kickflip") stunt("THE KICKFLIP", 3);
      else if (v !== "news")
        stunt(CLIPS.find((c) => c.id === v)?.title ?? "STUNT", 1);
    } else if (k === "flip" && Number(v) >= 2) {
      stunt("FLIP RESET", 2);
    } else if (k === "views") {
      const [, n, mult] = e.split(":");
      hud.viewsPop(Number(n), Number(mult));
    } else if (k === "npcfail") {
      // a fellow roadster commuter botched its flip near us: the news, at most one card per 25 s
      if (near && session.t - lastNewsT > 25) newsFlash(NEWS_WIPEOUT);
    } else if (k === "npccrash") {
      // a backflipping NPC came down on the car ahead and rolled it over
      if (near && session.t - lastNewsT > 25) newsFlash(NEWS_PILEUP);
    } else if (k === "wire") {
      sparks(fx, player.root.position.clone(), 25);
    } else if (k === "cone" && cityView) {
      for (const o of session.props) {
        if (o.kind !== "cone" || !o.hit) continue;
        const i = cityView.coneIndex.get(o.id);
        if (i !== undefined) {
          cityView.cones.setMatrixAt(i, hidden);
          cityView.cones.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }
}

/**
 * Highest the chase camera may go: under a roof the car is under (the tunnel, the skyway deck, the toll canopy) it
 * stays below it, or a high flight camera ends up above the deck looking at concrete instead of the car.
 */
function cameraRoof(tunnel: boolean): number {
  const car = session.car;
  if (tunnel) return CEIL_H - 0.7;
  const sw = city.skyway,
    k = skywayAt(sw, car.x);
  if (k && !k.ramp && Math.abs(car.y - sw.y) <= k.half && car.h < sw.h - 1.5)
    return sw.h - 1.4 - 0.6;
  if (
    city.decks.some((d) => inBox(d.box, car.x, car.y) && car.h < PLAZA.bottom)
  )
    return PLAZA.bottom - 0.6;
  return Infinity;
}

/** The frame just drawn, w px wide, as a JPEG data URL ("" if the canvas cannot be read). */
function snapshot(w: number, q: number): string {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = Math.max(2, Math.round((w * canvas.height) / canvas.width));
  const g = c.getContext("2d");
  if (!g) return "";
  try {
    g.drawImage(canvas, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", q);
  } catch {
    return "";
  }
}

/** If the camera ended up inside a building, look down at the car from above instead. */
function keepCameraOutOfBuildings(): void {
  const cx = kit.camera.position.x,
    cy = -kit.camera.position.z,
    ch = kit.camera.position.y;
  for (const b of session.layout.buildings) {
    if (Math.abs(b.cx - cx) > 40 || Math.abs(b.cy - cy) > 40) continue;
    if (ch < b.height && inBox(b.box, cx, cy)) {
      const p = player.root.position;
      kit.camera.position.set(
        p.x + (cx - p.x) * 0.25,
        Math.max(ch, 9),
        p.z + (-cy - p.z) * 0.25,
      );
      kit.camera.lookAt(p);
      return;
    }
  }
}

let wall = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  if (document.hidden) {
    acc = 0;
    last = now;
    return;
  }
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  wall += dt;
  const car = session.car;
  if (session.state === "run" && !paused && !hud.paused) {
    // Drop excess debt rather than accumulating an unbounded catch-up backlog.
    // over the ramp's lip the world slows down for a moment (the car hangs upside down at the top), then snaps back;
    // through the rocket's liftoff shot it all but stops (the rocket and the crowd go on in real time)
    const simDt = slowT > 0 ? dt * 0.3 : rocketShot ? dt * 0.2 : dt;
    slowT = Math.max(0, slowT - dt);
    acc = Math.min(acc + simDt, STEP * MAX_STEPS);
    let n = 0;
    while (acc >= STEP && n++ < MAX_STEPS && session.state === "run") {
      const prev = lastInput;
      lastInput = input.read();
      if (rocketShot) {
        // the liftoff shot: hands off the wheel while the car is off screen (it coasts); a fresh JUMP / STICK press
        // cuts back to it (and does not also hop: held keys are ignored until let go)
        if (
          (lastInput.jump && !prev.jump) ||
          (lastInput.stick && !prev.stick)
        ) {
          memes.skipShot();
          swallowKeys = true;
        }
        handleEvents(session.step(STEP, NO_INPUT));
      } else {
        if (swallowKeys && !lastInput.jump && !lastInput.stick)
          swallowKeys = false;
        handleEvents(
          session.step(
            STEP,
            swallowKeys
              ? { ...lastInput, jump: false, stick: false }
              : lastInput,
          ),
        );
      }
      acc -= STEP;
    }
    if (session.result && !resultShown) {
      resultShown = true;
      const res = session.result;
      acc = 0;
      void clip.stop();
      // Use the recording timeline, not simulation time (slow frames/hidden tabs can diverge).
      const total = clip.elapsed;
      const moment =
        lastCrashMediaTime === null
          ? total
          : Math.min(total, lastCrashMediaTime + 0.3);
      hud.setSaveClip(
        clip.supported
          ? (setLabel) =>
              clip.exportClip(
                moment,
                total,
                res.grade === "LATE" ? "LATE" : "GRADE " + res.grade,
                setLabel,
              )
          : null,
        // what that clip shows: the last wipeout, else the arrival (or the bell at 9:00)
        lastCrashMediaTime === null
          ? res.finished
            ? "ARRIVAL"
            : "FINAL SECONDS"
          : "LAST WIPEOUT",
        lastCrashMediaTime === null
          ? res.finished
            ? "CLOCKED IN " + session.clock
            : "BEFORE 9:00"
          : crashCause(session.lastCrash),
      );
      // the best stunt of the run, as its own clip
      const best = bestStunt;
      hud.setSaveBest(
        clip.supported && best
          ? (setLabel) => clip.exportClip(best.t, total, best.label, setLabel)
          : null,
        best?.label,
      );
      // PHOTO FINISH: the arrival frame, captioned like a punched time card (taken after this frame is drawn)
      pendingPhoto = res.finished
        ? { caption: "CLOCKED IN  " + session.clock, late: false }
        : { caption: "LATE  9:00:00", late: true };
      ({ grade: bestGrade, views: bestViews } = saveBest(
        store,
        bestGradeOf(bestGrade, res.grade) ?? res.grade,
        Math.max(res.finalViews, bestViews),
      ));
      hud.showResult(
        session.result,
        () => begin(false),
        () => openLobby(),
      );
      // build the next commute now, behind the result card, so NEXT COMMUTE / LOBBY do not stall on the city rebuild
      const finished = session;
      setTimeout(() => {
        if (session !== finished || !started) return;
        moveOn();
        session = newSession(false);
        paused = true; // it waits behind the card until NEXT COMMUTE / START
      }, 120);
    }
  }
  // player transform
  const g = groundAt(city, car.x, car.y, car.h);
  // nose up climbing a ramp, down coming back down it (the slope is up toward dir along its axis)
  const slope = car.grounded
    ? g.slope *
      g.dir *
      (g.axis === "x" ? Math.cos(car.heading) : Math.sin(car.heading))
    : 0;
  player.root.position.set(car.x, car.h + CAR_H / 2, -car.y);
  player.root.rotation.set(
    car.roll,
    car.heading + car.yawVis,
    car.pitch + Math.atan(slope),
    "YZX",
  );
  if (car.spin !== 0) {
    // off-axis twist: rotate in the body frame about the tilted axis (x forward, y up, z right)
    spinAxisV.set(car.spinAxis[0], car.spinAxis[1], car.spinAxis[2]);
    spinQ.setFromAxisAngle(spinAxisV, car.spin);
    player.root.quaternion.multiply(spinQ);
  }
  player.spin(car.grounded || car.ceiling ? car.v * dt : car.v * dt * 0.6);
  // front wheels follow the stick (smoothed), with extra lock while drifting
  wheelSteer +=
    (car.steerS * (car.drifting ? 0.6 : 0.42) - wheelSteer) *
    Math.min(1, 14 * dt);
  player.steer(wheelSteer);
  {
    const blob = player.root.getObjectByName("blob");
    if (blob) {
      blob.position.set(0, -(car.h + CAR_H / 2) + g.h + 0.04, 0);
      blob.rotation.set(
        -Math.PI / 2 - car.roll,
        0,
        -(car.pitch + Math.atan(slope)),
      );
      const k = Math.max(0.25, 1 - car.h * 0.25);
      blob.scale.set(k, k, 1);
      (blob as THREE.Mesh).visible = car.state !== "crash" && !car.wall;
    }
  }
  // back on the road after a crash: the car blinks while it cannot be hit (the body only: the headlight stays on, so
  // the scene's light count, and with it every material's program, does not flip each blink)
  const inner = player.root.children[0] as THREE.Group;
  inner.visible = !(
    car.state === "drive" &&
    car.invuln > 0 &&
    started &&
    Math.floor(wall * 10) % 2 === 1
  );
  // continuous FX
  inner.updateMatrixWorld(true);
  if (car.state === "drive") {
    if (car.drifting && car.grounded) driftSmoke(fx, inner.matrixWorld);
    if (car.boosting) exhaust(fx, inner.matrixWorld, player.rearNozzles, 2);
    if (car.thrusting) {
      // hold-to-fly: the four bottom jets roar continuously; near the ground they kick up a gas cloud
      for (const n of player.bottomNozzles)
        puff(fx, inner.matrixWorld, n, DOWN, 1, 14);
      const gh = groundAt(city, car.x, car.y, car.h).h;
      thrustCloudT -= dt;
      if (car.h - gh < 4 && thrustCloudT <= 0) {
        thrustCloudT = 0.12;
        gasCloud(fx, new THREE.Vector3(car.x, gh, -car.y), 14, 2.6, 0.7);
      }
    }
    if (car.rampDrop && !car.grounded) {
      // down off the ramp's lip, as in the reveal: side jets roll it upright (on the side coming up), then the
      // bottom jets hold it up on long white plumes, blasting a cloud off the floor as it settles
      if (Math.abs(car.roll) > 0.02)
        thrusterStream(
          fx,
          inner.matrixWorld,
          car.roll > 0 ? SIDE_JETS_R : SIDE_JETS_L,
          car.roll > 0 ? SIDE_R : SIDE_L,
          4,
        );
      if (car.retro) {
        const gh = groundAt(city, car.x, car.y, car.h).h;
        thrustCloudT -= dt;
        if (car.h - gh < 8 && thrustCloudT <= 0) {
          thrustCloudT = 0.08;
          gasCloud(
            fx,
            new THREE.Vector3(car.x, gh, -car.y),
            22,
            3.4,
            1 + (8 - (car.h - gh)) * 0.08,
          );
        }
      }
    }
  }
  // downward thruster jets: launch burn and rotation burn, fading toward the end
  burnT = Math.max(0, burnT - dt);
  const burn =
    car.state === "drive" && !car.grounded
      ? car.retro
        ? 1.5 // braking the drop off the ramp: long plumes
        : car.thrusting
          ? car.fuel <= 0
            ? 0.35 + Math.random() * 0.3 // tank empty: the jets sputter as the car sinks
            : 1
          : burnT > 0
            ? Math.min(1, (burnT / burnMax) * 2.5)
            : 0
      : 0;
  player.downJets.visible = burn > 0;
  if (burn > 0) {
    for (const j of player.downJets.children) {
      const len = (3.6 + Math.random() * 1.6) * burn,
        w = (1.4 + Math.random() * 0.4) * burn;
      j.scale.set(len, w, w);
      j.rotation.x += 0.9;
    }
    thrusterStream(
      fx,
      inner.matrixWorld,
      player.bottomNozzles,
      DOWN,
      car.flipRemaining > 0 || car.retro ? 2 : 1,
    );
    if (car.flipRemaining > 0)
      thrusterStream(
        fx,
        inner.matrixWorld,
        player.rearNozzles,
        new THREE.Vector3(-1, 0.3, 0),
        1,
      );
  }
  player.flame.visible = car.boosting || (burn > 0 && car.flipRemaining > 0);
  if (player.flame.visible && !car.boosting) {
    for (const j of player.flame.children) {
      const len = (2.5 + Math.random() * 1.0) * burn,
        w = (1.0 + Math.random() * 0.3) * burn;
      j.scale.set(len, w, w);
      j.rotation.x += 0.9;
    }
  }
  if (car.boosting) {
    for (const j of player.flame.children) {
      const len = 4.5 + Math.random() * 2.0,
        w = 1.4 + Math.random() * 0.4;
      j.scale.set(len, w, w);
      j.rotation.x += 0.9; // spin the cross so the ribbon never reads as two flat cards
    }
  }
  fx.update(dt);
  sfx.update(
    car,
    lastInput.accel,
    session.rainT > 0 ? Math.min(1, session.rainT / 2) : 0,
    dt,
  );
  syncNpcs();
  hazardsView.update(
    session.hazards,
    session.wires,
    session.traffic.npcs,
    session.rainT > 0 ? Math.min(1, session.rainT / 2) : 0,
    kit.camera.position.x,
    kit.camera.position.z,
    wall,
    dt,
  );
  cityView?.setWet(session.rainT > 0 ? Math.min(1, session.rainT / 2) : 0);
  // the camera, not the car: pedestrian cut-outs turn square to it, and the detailed buildings stream around it
  cityView?.update(wall, kit.camera.position.x, -kit.camera.position.z);
  memes.markClips(known);
  memes.update(wall, kit.camera.position, car.x, car.y, fx, session.t);
  const tunnel = underRoof(city, car.x, car.y);
  // off the ramp's lip until touchdown: a set shot from beside the ramp (north of it, low, in front of the foot),
  // the C in profile and the stands behind, following the car as it drops (the chase camera would sit up behind
  // the car on top of the ramp's upper arm, looking at concrete)
  // just after a landing that set the rocket off: cut to its liftoff, from low on the floor beside the pad, and cut
  // back once it is well up
  const shot = memes.rocketShot(wall, cinePos, cineLook);
  if (shot !== rocketShot) {
    rocketShot = shot;
    cam.reset();
    hud.setCutaway(shot);
  }
  let cine: { pos: THREE.Vector3; look: THREE.Vector3 } | null = shot
    ? { pos: cinePos, look: cineLook }
    : null;
  const st = city.stage;
  if (!cine && rampFlight && st && car.state === "drive" && !car.grounded) {
    const q = rampWorld(st.ramp, -14, 28);
    cine = {
      pos: cinePos.set(q.x, 9, -q.y),
      look: cineLook.copy(player.root.position),
    };
  }
  cam.update(
    dt,
    player.root.position.clone(),
    car.heading,
    car,
    cameraRoof(tunnel),
    g.h,
    cine,
  );
  keepCameraOutOfBuildings();
  if (import.meta.env.DEV && devCam) {
    // dev: pin the camera for screenshots (game coords: x, y, height)
    kit.camera.position.set(devCam.pos[0], devCam.pos[2], -devCam.pos[1]);
    kit.camera.lookAt(devCam.look[0], devCam.look[2], -devCam.look[1]);
  }
  kit.follow(car.x, -car.y);
  // rain reads as overcast: borrow the tunnel fill reduction at half strength
  kit.setInterior(
    Math.max(
      tunnel ? 1 : 0,
      session.rainT > 0 ? 0.45 * Math.min(1, session.rainT / 2) : 0,
    ),
    dt,
  );
  kit.adapt(dt);
  hud.update(session, dt);
  // now and then a news story, while actually driving (a new commute restarts the news clock)
  if (session.t < lastNewsT) {
    lastNewsT = -1e9;
    nextNewsT = 20;
  }
  if (
    started &&
    !lobby.isOpen &&
    !paused &&
    session.state === "run" &&
    car.state === "drive" &&
    session.t >= nextNewsT
  )
    newsFlash(Math.floor(Math.random() * NEWS.length));
  sfx.heartbeat(session.timeLeft, car.state === "drive");
  kit.render();
  // pictures of the frame just drawn (the canvas can be read until the browser presents it)
  if (pendingPhoto) {
    const url = snapshot(480, 0.85);
    if (url) hud.showPhoto(url, pendingPhoto.caption, pendingPhoto.late);
    if (!pendingPhoto.late) sfx.event("punch");
    pendingPhoto = null;
  }
  while (pendingThumbs.length) {
    const id = pendingThumbs.pop()!;
    const url = snapshot(320, 0.75);
    if (url) save("lr.thumb." + id, url); // the lobby shows your own shot of it
  }
  clip.setPaused(hud.paused);
  clip.capture();
}
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  (window as unknown as { lr: unknown }).lr = {
    get session() {
      return session;
    },
    assets,
    kit,
    hud,
    city,
    get cityView() {
      return cityView;
    },
    memes,
    clip,
    sfx,
    event(kind: string) {
      return session.forceEvent(kind as import("./game/session").EventKind);
    },
    teleport(x: number, y: number, heading = 0) {
      const c = session.car;
      c.x = x;
      c.y = y;
      c.px = x;
      c.py = y;
      c.heading = heading;
      c.state = "drive";
      c.h = groundAt(city, x, y).h;
      c.vH = 0;
      c.v = 0;
      c.vLat = 0;
      c.pitch = 0;
      c.roll = 0;
      c.grounded = true;
      c.invuln = 1;
    },
    /** pin the camera: pos/look as [x, y, height] game coords; null releases it */
    pinCam(pos: number[] | null, look?: number[]) {
      devCam = pos && look ? { pos, look } : null;
    },
    clearTraffic() {
      session.traffic.npcs.forEach((n) => {
        n.dead = true;
      });
    },
    commute(i: number) {
      runIndex = i;
      started = false;
      session = newSession(false);
      begin(false);
    },
    /** START from the lobby */
    start() {
      begin(false);
    },
    lobby() {
      openLobby();
    },
    unlockAll(on = true) {
      known.clear();
      if (on) for (const c of CLIPS) known.add(c.id);
      save("lr.cards", JSON.stringify([...known])); // a reset, not a merge
      if (lobby.isOpen) lobby.show(lobbyInfo());
    },
  };
  // game-qa's hook (window.__qa) so a decision model can play: scripts/qa.sh, qa/
  void import("./qa").then((m) => m.installQa());
}
