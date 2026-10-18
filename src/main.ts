import * as THREE from "three";
import { CAR_H, CEIL_H, CEIL_RISE } from "./game/constants";
import { buildCity, groundAt, inBox, underRoof } from "./game/city";
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
import { Hud } from "./ui/hud";
import { Lobby } from "./ui/lobby";
import { CLIPS } from "./game/score";

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

// progress kept across visits: filmed clips (key lr.cards, kept from when they were cards), which crash tips were
// shown, best grade and VIEWS
// (storage can be unavailable or full: reads fall back to defaults, writes are best effort)
const load = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const save = (k: string, v: string): void => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode / quota: this visit just will not be remembered */
  }
};
const readSet = (k: string): Set<string> => {
  try {
    const v: unknown = JSON.parse(load(k) ?? "[]");
    return new Set(Array.isArray(v) ? v.map(String) : []);
  } catch {
    return new Set();
  }
};
const saveSet = (k: string, s: Set<string>) => save(k, JSON.stringify([...s]));
const finiteOr = (v: string | null, d: number): number => {
  const n = Number(v);
  return v !== null && Number.isFinite(n) && n >= 0 ? n : d;
};
const known = readSet("lr.cards");
const tipsShown = readSet("lr.tips");
const GRADE_RANK = ["LATE", "C", "B", "A", "S"];
let bestViews = finiteOr(load("lr.bestViews"), 0);
let bestGrade = load("lr.bestGrade");
if (bestGrade && !GRADE_RANK.includes(bestGrade)) bestGrade = null;

const lobby = new Lobby(document.getElementById("hud")!, {
  start: () => begin(false),
  free: () => begin(true),
});
hud.onLobby = () => {
  if (!lobby.isOpen && session.state === "run") openLobby();
};
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
// approved round-3 design master (R_00_v2) is silver
const player = buildPlayerCar(assets, 0xc9cdd2);
kit.scene.add(player.root);
const npcs = new NpcRenderer(assets, kit.scene);
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
    !lobby.isOpen &&
    session.state === "run"
  ) {
    e.preventDefault();
    openLobby();
  }
});
const hazardsView = new HazardRenderer(kit.scene, (n) => assets.tex.get(n));
let devCam: { pos: number[]; look: number[] } | null = null;
let session = newSession(false);
lobby.show(lobbyInfo());
lobby.setReady();

function lobbyInfo() {
  return {
    persona: session.persona,
    distance: session.commute.dist,
    bestGrade,
    bestViews,
    known,
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
  npcs.sync([]);
  resultShown = false;
  const s = new Session(city, dailySeed(), runIndex, undefined, {
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
  kit.renderer.compile(kit.scene, kit.camera);
  kit.renderer.render(kit.scene, kit.camera); // warm draw (title screen covers it): uploads NPC car buffers now
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
  npcs.sync(session.traffic.npcs, session.ceilingCars);
}

const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
const DOWN = new THREE.Vector3(0, -1, 0),
  UP = new THREE.Vector3(0, 1, 0);
let wheelSteer = 0;
let lastTickerT = -1e9;
let faceShown = false;
const TALL = new Set(["camper", "truck", "bus", "van"]);
const spinAxisV = new THREE.Vector3(),
  spinQ = new THREE.Quaternion();
/** Seconds of downward thruster burn left to draw (jump launch, rotation burn). */
let burnT = 0,
  burnMax = 1;
/** s until the next ground gas cloud under the hold-to-fly jets */
let thrustCloudT = 0;
function handleEvents(ev: string[]): void {
  if (import.meta.env.DEV && ev.length)
    ((window as unknown as { __ev: string[] }).__ev ??= []).push(...ev);
  const flipped = ev.some((e) => e.startsWith("flip:"));
  const inner = player.root.children[0] as THREE.Group;
  inner.updateMatrixWorld(true);
  const M = inner.matrixWorld;
  for (const e of ev) {
    const [k, v] = e.split(":");
    // NPC-vs-NPC wrecks are heard (and reported) only when they happen near the player
    let near = true;
    if (k === "npccrash" || k === "npcfail" || k === "npcjet") {
      const n = session.traffic.npcs.find((o) => o.id === Number(v));
      near = !!n && Math.hypot(n.x - session.car.x, n.y - session.car.y) < 120;
    }
    if (near) sfx.event(k, v);
    // on-screen captions: only the accident news (BREAKING band on a crash, NPC wreck tickers) is left
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
    } else if (k === "skyway") {
      // the overpass escape from the demo: all four jets fire for the whole climb
      for (const n of player.bottomNozzles) puff(fx, M, n, DOWN, 16, 16);
      burnT = burnMax = v === "up" ? 0.9 : 0.4;
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
    } else if (k === "crash") {
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
    } else if (k === "views") {
      const [, n, mult] = e.split(":");
      hud.viewsPop(Number(n), Number(mult));
    } else if (k === "npcfail") {
      // a fellow roadster commuter botched its flip: news only when it happened near us, at most one ticker per 45 s
      // (commuters stunt constantly now, so a looser rule kept the ticker on screen all the time)
      if (near && (session.t - lastTickerT > 45 || session.t < lastTickerT)) {
        lastTickerT = session.t;
        hud.ticker("BREAKING: ROADSTER WIPEOUT");
      }
    } else if (k === "npccrash") {
      // a backflipping NPC came down on the car ahead and rolled it over
      if (near && (session.t - lastTickerT > 45 || session.t < lastTickerT)) {
        lastTickerT = session.t;
        hud.ticker("BREAKING: FLIP PILE-UP");
      }
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
    acc = Math.min(acc + dt, STEP * MAX_STEPS);
    let n = 0;
    while (acc >= STEP && n++ < MAX_STEPS && session.state === "run") {
      lastInput = input.read();
      handleEvents(session.step(STEP, lastInput));
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
      );
      if (res.finalViews > bestViews) {
        bestViews = res.finalViews;
        save("lr.bestViews", String(bestViews));
      }
      if (
        !bestGrade ||
        GRADE_RANK.indexOf(res.grade) > GRADE_RANK.indexOf(bestGrade)
      ) {
        bestGrade = res.grade;
        save("lr.bestGrade", bestGrade);
      }
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
  const slope = car.grounded ? g.slope : 0;
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
  // back on the road after a crash: the car blinks while it cannot be hit
  player.root.visible = !(
    car.state === "drive" &&
    car.invuln > 0 &&
    started &&
    Math.floor(wall * 10) % 2 === 1
  );
  // continuous FX
  const inner = player.root.children[0] as THREE.Group;
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
  }
  // downward thruster jets: launch burn and rotation burn, fading toward the end
  burnT = Math.max(0, burnT - dt);
  const burn =
    car.state === "drive" && !car.grounded
      ? car.thrusting
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
      car.flipRemaining > 0 ? 2 : 1,
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
  cityView?.update(wall, car.x, car.y);
  memes.markClips(known);
  memes.update(wall, kit.camera.position, car.x, car.y, fx, session.t);
  const tunnel = underRoof(city, car.x, car.y);
  cam.update(
    dt,
    player.root.position.clone(),
    car.heading,
    car,
    tunnel ? CEIL_H - 0.7 : Infinity,
    g.h,
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
  sfx.heartbeat(session.timeLeft, car.state === "drive");
  // dashcam face close-up when clearing a tall vehicle (camper / truck / bus / van), once per air phase
  if (car.grounded || car.state !== "drive") faceShown = false;
  else if (!faceShown) {
    for (const n of session.traffic.npcs) {
      if (n.dead || !TALL.has(n.kind)) continue;
      if (
        Math.hypot(n.x - car.x, n.y - car.y) < n.halfL + 1.5 &&
        car.h > n.h - 0.3
      ) {
        hud.faceCam(car.flipRemaining > 0 ? "shock" : "cool");
        faceShown = true;
        break;
      }
    }
  }
  kit.render();
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
      saveSet("lr.cards", known);
      if (lobby.isOpen) lobby.show(lobbyInfo());
    },
  };
}
