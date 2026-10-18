// Visual memes from the reveal-week jokes, all fictional/unbranded: the launch-event venue as on the reveal night
// (hook ramp, kickflip vehicle row), sinkholes the commuters jet over, the toll plaza with its queue and a sky lane of
// roadsters above it ("THIS SIDE UP" on the underside), roof-parked roadsters, jet-assist shopping carts, a roadster
// drifting in orbit with a suited mannequin, and two boosters landing side by side beyond the east skyline.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type City, type Stage, expand, inBox, stageAt } from "../game/city";
import { CLIPS, clipSpots } from "../game/score";
import { skyCarAt } from "../game/skylane";
import { PLAZA, tollCanopy, tollIslands } from "../game/toll";
import {
  FLOOD_H,
  PLINTH,
  RAMP,
  RAMP_END,
  RAMP_TOP,
  LANE,
  ROW,
  ROW_HALF,
  ROW_OFFSETS,
  STANDS,
  floodlights,
  grandstands,
  powerPoles,
  rampLocal,
  rampPoint,
  rampWorld,
} from "../game/venue";
import { martSite } from "../game/landmarks";
import * as C from "../game/constants";
import type { Assets, Model } from "./assets";
import { KIND_MODEL, PLAYER_MODEL } from "./vehicles";
import { gasCloud, type Particles } from "./fx";
import * as MT from "./memeTex";

const smooth = (k: number) => {
  const q = Math.min(1, Math.max(0, k));
  return q * q * (3 - 2 * q);
};

/** Instanced copies of the roadster with a per-instance body colour (one draw call per model part). */
class Fleet {
  meshes: THREE.InstancedMesh[] = [];
  n = 0;
  readonly H: number;
  private m = new THREE.Matrix4();
  private r = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private col = new THREE.Color();
  constructor(model: Model, cap: number, parent: THREE.Object3D) {
    this.H = model.size.y;
    const body = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.15,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    });
    // largest part = body (same rule as the player rig)
    let bi = 0;
    model.parts.forEach((p, i) => {
      if (
        p.geometry.attributes.position.count >
        model.parts[bi].geometry.attributes.position.count
      )
        bi = i;
    });
    model.parts.forEach((p, i) => {
      const im = new THREE.InstancedMesh(
        p.geometry,
        i === bi ? body : p.material,
        cap,
      );
      im.count = 0;
      im.frustumCulled = false;
      if (i === bi) im.setColorAt(0, this.col.set(0xffffff));
      im.userData.body = i === bi;
      parent.add(im);
      this.meshes.push(im);
    });
  }
  begin(): void {
    this.n = 0;
  }
  /** add one car: game coords (x, y), centre height hc, heading/pitch/roll as in NpcRenderer (pivot at the centre) */
  add(
    x: number,
    y: number,
    hc: number,
    heading: number,
    color: number,
    pitch = 0,
    roll = 0,
  ): void {
    const i = this.n++;
    if (i >= this.meshes[0].instanceMatrix.count) return;
    this.e.set(roll, heading, pitch, "YXZ");
    this.q.setFromEuler(this.e);
    this.r.makeRotationFromQuaternion(this.q);
    this.m.makeTranslation(0, -this.H / 2, 0).premultiply(this.r);
    this.m.elements[12] += x;
    this.m.elements[13] += hc;
    this.m.elements[14] += -y;
    this.col.set(color);
    for (const im of this.meshes) {
      im.setMatrixAt(i, this.m);
      if (im.userData.body) im.setColorAt(i, this.col);
    }
  }
  end(): void {
    for (const im of this.meshes) {
      im.count = Math.min(this.n, im.instanceMatrix.count);
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
}

const W = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);
function boxAt(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  h0: number,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, h0 + h / 2, -y);
  return g;
}
function signPlane(
  map: THREE.Texture,
  w: number,
  h: number,
  emissive = 0.9,
): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({
      map,
      emissive: 0xffffff,
      emissiveMap: map,
      emissiveIntensity: emissive,
      roughness: 0.6,
    }),
  );
  return m;
}

/** shopping cart: open wire basket, handle, castors, a small jet nozzle underneath (one merged geometry) */
function cartGeometry(): THREE.BufferGeometry {
  const p: THREE.BufferGeometry[] = [];
  const L = 0.95,
    Wd = 0.58,
    H0 = 0.42,
    Hb = 0.5;
  p.push(boxAt(L, 0.03, Wd, 0, 0, H0)); // floor
  p.push(boxAt(L, Hb, 0.03, 0, Wd / 2, H0), boxAt(L, Hb, 0.03, 0, -Wd / 2, H0)); // sides
  p.push(
    boxAt(0.03, Hb, Wd, L / 2, 0, H0),
    boxAt(0.03, Hb * 0.8, Wd, -L / 2, 0, H0),
  ); // front / back
  p.push(boxAt(0.05, 0.05, Wd + 0.1, -L / 2 - 0.18, 0, H0 + Hb + 0.12)); // handle bar
  p.push(boxAt(0.2, 0.04, 0.04, -L / 2 - 0.08, Wd / 2, H0 + Hb + 0.05));
  p.push(boxAt(0.2, 0.04, 0.04, -L / 2 - 0.08, -Wd / 2, H0 + Hb + 0.05));
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      p.push(boxAt(0.03, H0 - 0.1, 0.03, (sx * L) / 2.4, (sy * Wd) / 2.4, 0.1));
      p.push(boxAt(0.12, 0.12, 0.05, (sx * L) / 2.4, (sy * Wd) / 2.4, 0));
    }
  const noz = new THREE.CylinderGeometry(0.1, 0.16, 0.18, 10);
  noz.translate(0, H0 - 0.09, 0);
  p.push(noz);
  return mergeGeometries(p.map((g) => g.toNonIndexed()))!;
}

/** a reusable landing booster: body, interstage band, grid fins, four legs, flame */
function booster(fogless: boolean): {
  root: THREE.Group;
  flame: THREE.Mesh;
  legs: THREE.Group;
} {
  const root = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({
    color: 0xe9edf0,
    roughness: 0.55,
    fog: !fogless,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x1a1c20,
    roughness: 0.7,
    fog: !fogless,
  });
  const R = 1.9,
    H = 44;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 20), white);
  body.position.y = H / 2 + 1.5;
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 1.01, R * 1.01, 4, 20),
    dark,
  );
  band.position.y = H - 1;
  const soot = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 1.01, R * 1.01, 9, 20),
    dark,
  );
  soot.position.y = 6;
  root.add(body, band, soot);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 0.25), dark);
    const a = (i / 4) * Math.PI * 2;
    fin.position.set(Math.cos(a) * (R + 1), H - 3, Math.sin(a) * (R + 1));
    fin.rotation.y = -a;
    root.add(fin);
  }
  const legs = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9, 0.5), dark);
    leg.geometry.translate(0, -4.5, 0);
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const piv = new THREE.Group();
    piv.position.set(Math.cos(a) * R, 8, Math.sin(a) * R);
    piv.rotation.y = -a;
    piv.add(leg);
    legs.add(piv);
  }
  root.add(legs);
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(1.6, 16, 14, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffb35a,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: !fogless,
    }),
  );
  flame.rotation.x = Math.PI; // tip down
  flame.position.y = -6.5;
  root.add(flame);
  return { root, flame, legs };
}

/** fog-free copies of a glTF scene's materials (the boosters stand far out beyond the fog) */
function fogless(
  src: THREE.Object3D,
  cache: Map<THREE.Material, THREE.Material>,
) {
  const o = src.clone(true);
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.Material;
    let c = cache.get(mat);
    if (!c) {
      c = mat.clone();
      (c as THREE.MeshStandardMaterial).fog = false;
      cache.set(mat, c);
    }
    m.material = c;
  });
  return o;
}

/** the round-4 Blender booster (tools/blender/r4/booster.py): body origin at the engine bells, four hinged legs at
 * 8 m (each leg hangs along -y from its hinge, outward face +x), same rig as booster() */
const boosterMats = new Map<THREE.Material, THREE.Material>();
function photoBooster(
  body: THREE.Object3D,
  leg: THREE.Object3D,
): ReturnType<typeof booster> {
  const root = new THREE.Group();
  root.add(fogless(body, boosterMats));
  const legs = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const piv = new THREE.Group();
    piv.position.set(Math.cos(a) * 1.9, 8, Math.sin(a) * 1.9);
    piv.rotation.y = -a;
    piv.add(fogless(leg, boosterMats));
    legs.add(piv);
  }
  root.add(legs);
  // anchored at the engine bells (tip 16 m down) so it can shorten instead of sinking into the ground near touchdown
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(1.6, 16, 14, 1, true)
      .rotateX(Math.PI)
      .translate(0, -8, 0),
    new THREE.MeshBasicMaterial({
      color: 0xffb35a,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  flame.userData.anchored = true;
  root.add(flame);
  return { root, flame, legs };
}

/** A generic white cab-over semi tractor (no trailer), ~6.6 m long and 3.9 m tall; forward +x, origin on the ground. */
function semiTractor(): THREE.Group {
  const g = new THREE.Group();
  const white: THREE.BufferGeometry[] = [],
    dark: THREE.BufferGeometry[] = [],
    glass: THREE.BufferGeometry[] = [],
    lamp: THREE.BufferGeometry[] = [],
    tyre: THREE.BufferGeometry[] = [];
  const box = (
    arr: THREE.BufferGeometry[],
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z: number,
  ) =>
    arr.push(
      new THREE.BoxGeometry(x1 - x0, y1 - y0, 2 * z).translate(
        (x0 + x1) / 2,
        (y0 + y1) / 2,
        0,
      ),
    );
  box(dark, -3.3, 3.0, 0.55, 0.95, 0.5); // frame rails
  box(dark, -3.1, -0.2, 0.95, 1.12, 1.15); // fifth-wheel deck
  box(white, 0.6, 3.25, 1.0, 3.55, 1.25); // cab
  box(white, 0.9, 3.0, 3.55, 3.85, 1.15); // roof fairing
  box(white, -0.9, 0.6, 1.0, 3.3, 1.2); // sleeper back
  box(white, -1.2, 0.5, 0.45, 1.05, 1.27); // side skirts / tanks
  box(dark, 3.22, 3.3, 0.8, 1.9, 1.15); // grille
  box(glass, 3.24, 3.3, 2.25, 3.35, 1.18); // windscreen
  for (const z of [-1, 1]) {
    glass.push(
      new THREE.BoxGeometry(1.3, 0.9, 0.04).translate(2.3, 2.75, z * 1.26),
    ); // side windows
    lamp.push(
      new THREE.BoxGeometry(0.06, 0.18, 0.55).translate(3.29, 1.35, z * 0.85),
    ); // headlamps
  }
  lamp.push(new THREE.BoxGeometry(0.06, 0.06, 2.1).translate(3.27, 3.45, 0)); // light bar
  for (const x of [2.3, -1.4, -2.65])
    for (const z of [-1, 1])
      tyre.push(
        new THREE.CylinderGeometry(0.52, 0.52, 0.4, 18)
          .rotateX(Math.PI / 2)
          .translate(x, 0.52, z * 1.0),
      );
  const add = (arr: THREE.BufferGeometry[], m: THREE.Material) => {
    const mesh = new THREE.Mesh(mergeGeometries(arr)!, m);
    mesh.castShadow = true;
    g.add(mesh);
  };
  add(
    white,
    new THREE.MeshPhysicalMaterial({
      color: 0xf2f3f4,
      roughness: 0.3,
      clearcoat: 1,
    }),
  );
  add(
    dark,
    new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.6 }),
  );
  add(
    glass,
    new THREE.MeshStandardMaterial({
      color: 0x0c1016,
      roughness: 0.1,
      metalness: 0.6,
    }),
  );
  add(
    lamp,
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.4, 2.4, 2.3),
      toneMapped: false,
    }),
  );
  add(
    tyre,
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }),
  );
  return g;
}

const PALETTE = [0xd62828, 0x2f5fd0, 0xf2f2f2, 0x15171a, 0xc9ced6, 0x2a9d8f];

const JET = new THREE.Color(0xdfe8ee);

export class MemeView {
  group = new THREE.Group();
  private fleet: Fleet | null = null;
  private statics: {
    x: number;
    y: number;
    hc: number;
    heading: number;
    color: number;
    sign?: THREE.Mesh;
  }[] = [];
  private roofsPlaced = false;
  private under: THREE.InstancedMesh | null = null;
  /** cart instances: one InstancedMesh per model part, each with the part's local transform inside the model */
  private carts: { im: THREE.InstancedMesh; local: THREE.Matrix4 }[] = [];
  private cartM = new THREE.Matrix4();
  private cartSpots: {
    x: number;
    y: number;
    heading: number;
    ph: number;
    up: boolean;
  }[] = [];
  private boosters: ReturnType<typeof booster>[] = [];
  private boosterXY: { x: number; y: number }[] = [];
  private boosterDown = false;
  private orbit: THREE.Group | null = null;
  private demoS = -99;
  private rampPhase = 0;
  /** smoke cannons at the kickflip row's ends (dir: the way they blow along the run) */
  private cannons: { x: number; y: number; dir: number }[] = [];
  private e = new THREE.Euler();
  /** last update time (dev: lets screenshots sync with the demo loop) */
  t = 0;
  private puffT = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(
    private city: City,
    private assets: Assets,
  ) {
    const model = assets.models.get(PLAYER_MODEL);
    if (model) this.fleet = new Fleet(model, 80, this.group);
    this.buildStage();
    this.buildPotholes();
    this.buildToll();
    this.buildParking();
    this.buildCarts();
    this.buildBoosters();
    if (model) this.buildOrbit(model);
    this.buildSigns();
    this.buildClipBeams();
  }

  /** a tall soft light beam and a ground ring, in its clip's colour, where each place-bound clip is filmed */
  private clipBeams = new Map<string, THREE.Group>();
  private buildClipBeams(): void {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.7, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,1)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 128);
    const fade = new THREE.CanvasTexture(c);
    const beamGeo = new THREE.CylinderGeometry(
      1.7,
      1.7,
      70,
      16,
      1,
      true,
    ).translate(0, 35, 0);
    const ringGeo = new THREE.RingGeometry(2.4, 3.1, 40).rotateX(-Math.PI / 2);
    for (const s of clipSpots(this.city)) {
      const color = CLIPS.find((q) => q.id === s.id)?.color;
      if (!color) continue;
      const grp = new THREE.Group();
      grp.add(
        new THREE.Mesh(
          beamGeo,
          new THREE.MeshBasicMaterial({
            color,
            map: fade,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            fog: false,
          }),
        ),
      );
      const ring = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      ring.position.y = 0.06;
      ring.name = "ring";
      grp.add(ring);
      grp.position.copy(W(s.x, s.y, s.h));
      this.group.add(grp);
      this.clipBeams.set(s.id, grp);
    }
  }

  /** clips already filmed lose their beam */
  markClips(filmed: ReadonlySet<string>): void {
    for (const [id, g] of this.clipBeams) g.visible = !filmed.has(id);
  }

  /**
   * Round-3 meme road signs (MS_01..MS_06) on posts or wall brackets: LOW CLEARANCE / CEILING LANE / NO KICKFLIPS at
   * the stage, CEILING LANE in the river tunnel facing each direction, OVER IT before the toll gate, FAST CHARGE
   * WAIT 7H at the mart. One draw call per sign image plus one for all posts and backs.
   */
  private buildSigns(): void {
    const tex = (id: string) => this.assets.tex.get(id);
    if (!tex("MS_01")) return;
    type Spot = {
      id: string;
      x: number;
      y: number;
      hc: number;
      size: number;
      rot: number;
      wallY?: number;
    };
    const spots: Spot[] = [];
    // river tunnel: on brackets off the wall on the drivers' right, facing oncoming traffic
    const t = this.city.tunnel;
    for (const x of [-120, -40, 40, 120]) {
      spots.push(
        {
          id: "MS_01",
          x,
          y: t.y0 + 1.4,
          hc: 3.4,
          size: 1.5,
          rot: -Math.PI / 2,
          wallY: t.y0 - 0.2,
        },
        {
          id: "MS_01",
          x: -x,
          y: t.y1 - 1.4,
          hc: 3.4,
          size: 1.5,
          rot: Math.PI / 2,
          wallY: t.y1 + 0.2,
        },
      );
    }
    // OVER IT on both toll approaches (right-hand traffic: eastbound on the -y half)
    const tl = this.city.toll;
    if (tl)
      spots.push(
        {
          id: "MS_04",
          x: tl.x - 80,
          y: tl.y - 16,
          hc: 2.6,
          size: 1.6,
          rot: -Math.PI / 2,
        },
        {
          id: "MS_04",
          x: tl.x + 80,
          y: tl.y + 16,
          hc: 2.6,
          size: 1.6,
          rot: Math.PI / 2,
        },
      );
    // the mart forecourt: an EV-charger joke next to the jet carts
    const cs = this.cartSpots;
    if (cs.length) {
      const c = cs[cs.length - 1];
      spots.push({
        id: "MS_05",
        x: c.x + 4,
        y: c.y,
        hc: 2.4,
        size: 1.3,
        rot: 0,
      });
    }
    const byId = new Map<string, THREE.BufferGeometry[]>();
    const metal: THREE.BufferGeometry[] = [];
    for (const s of spots) {
      const nx = Math.sin(s.rot),
        nz = Math.cos(s.rot); // world normal of the sign face
      const face = new THREE.PlaneGeometry(s.size, s.size)
        .rotateY(s.rot)
        .translate(s.x, s.hc, -s.y);
      (byId.get(s.id) ?? byId.set(s.id, []).get(s.id)!).push(face);
      metal.push(
        new THREE.BoxGeometry(s.size + 0.08, s.size + 0.08, 0.04)
          .rotateY(s.rot)
          .translate(s.x - nx * 0.03, s.hc, -s.y - nz * 0.03),
      );
      const top = s.hc + s.size / 2;
      if (s.wallY === undefined) {
        const ph = top + 0.1;
        metal.push(
          new THREE.CylinderGeometry(0.05, 0.05, ph, 8).translate(
            s.x - nx * 0.08,
            ph / 2,
            -s.y - nz * 0.08,
          ),
        );
      } else {
        // bracket: a bar from the wall to the sign's top edge
        const len = Math.abs(s.wallY - s.y);
        metal.push(
          new THREE.BoxGeometry(0.08, 0.08, len).translate(
            s.x,
            top + 0.05,
            -(s.wallY + s.y) / 2,
          ),
        );
      }
    }
    for (const [id, geos] of byId) {
      const map = tex(id)!;
      this.group.add(
        new THREE.Mesh(
          mergeGeometries(geos)!,
          new THREE.MeshStandardMaterial({
            map,
            emissive: 0xffffff,
            emissiveMap: map,
            emissiveIntensity: 0.18, // retroreflective: readable in the tunnel and at dusk
            roughness: 0.6,
          }),
        ),
      );
    }
    this.group.add(
      new THREE.Mesh(
        mergeGeometries(metal.map((g) => (g.index ? g.toNonIndexed() : g)))!,
        new THREE.MeshStandardMaterial({
          color: 0x8a9099,
          roughness: 0.5,
          metalness: 0.6,
        }),
      ),
    );
  }

  /**
   * The launch-event venue, after the reveal night: a dark arena floor crossed by two long white lines, "The Ramp" (a
   * concrete hook ramp with red LED edges and a white centre line on a steel truss tower) and "The Kickflip" (five
   * vehicles side by side on a red-lit plinth across a straight run-in), red-lit grandstands, floodlight towers and a
   * power line behind the row. No text anywhere, as on the night.
   */
  private buildStage(): void {
    const st = this.city.stage;
    if (!st) return;
    const fl = st.floor;
    const z0 = C.CURB_H;
    const steel = new THREE.MeshStandardMaterial({
      color: 0x5d636b,
      roughness: 0.45,
      metalness: 0.65,
    });
    const darkSteel = new THREE.MeshStandardMaterial({
      color: 0x1c1f24,
      roughness: 0.6,
      metalness: 0.4,
    });
    const red = new THREE.MeshStandardMaterial({
      color: 0x400000,
      emissive: 0xff2222,
      emissiveIntensity: 2.4,
    });
    const white = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
    const decal = (m: THREE.Material, k: number) => {
      m.polygonOffset = true;
      m.polygonOffsetFactor = -k;
      m.polygonOffsetUnits = -k;
      return m;
    };
    // ---- floor and the two long crossing lines
    {
      const w = fl.x1 - fl.x0,
        d = fl.y1 - fl.y0;
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d)
          .rotateX(-Math.PI / 2)
          .translate((fl.x0 + fl.x1) / 2, z0 + 0.01, -(fl.y0 + fl.y1) / 2),
        decal(
          new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.93 }),
          2,
        ),
      );
      floor.receiveShadow = true;
      this.group.add(floor);
      const lines: THREE.BufferGeometry[] = [];
      const line = (
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        wd: number,
      ) =>
        lines.push(
          new THREE.PlaneGeometry(Math.hypot(x1 - x0, y1 - y0), wd)
            .rotateX(-Math.PI / 2)
            .rotateY(Math.atan2(y1 - y0, x1 - x0))
            .translate((x0 + x1) / 2, z0 + 0.02, -(y0 + y1) / 2),
        );
      line(fl.x0 + 6, fl.y1 - 6, fl.x1 - 6, fl.y0 + 6, 0.35);
      line(fl.x0 + 6, fl.y0 + 6, fl.x1 - 6, fl.y1 - 6, 0.35);
      // the run-in centre lines: kickflip straight and the ramp approach
      const a = stageAt(st, 2),
        b = stageAt(st, st.rowS - PLINTH.halfS - 3);
      line(a.x, a.y, b.x, b.y, 0.25);
      const r0 = rampWorld(st.ramp, -88, 0),
        r1 = rampWorld(st.ramp, -1, 0);
      line(r0.x, r0.y, r1.x, r1.y, 0.25);
      this.group.add(
        new THREE.Mesh(mergeGeometries(lines)!, decal(white.clone(), 4)),
      );
    }
    this.buildKickflipRow(st, z0, darkSteel, red);
    this.buildRamp(st, z0, steel, darkSteel, red);
    // ---- grandstands: stepped banks with a red light strip on every riser, along the south and west edges
    {
      const parts: THREE.BufferGeometry[] = [],
        leds: THREE.BufferGeometry[] = [];
      const { N, D, R } = STANDS;
      for (const gs of grandstands(fl)) {
        const b = gs.box;
        for (let k = 0; k < N; k++) {
          const h = (k + 1) * R;
          if (gs.facing === "north") {
            // row 0 at the front (north edge), each row further back one step higher
            const y1 = b.y1 - k * D;
            parts.push(
              boxAt(b.x1 - b.x0, h, D, (b.x0 + b.x1) / 2, y1 - D / 2, z0),
            );
            leds.push(
              boxAt(
                b.x1 - b.x0,
                0.07,
                0.06,
                (b.x0 + b.x1) / 2,
                y1 + 0.03,
                z0 + h - 0.12,
              ),
            );
          } else {
            const x1 = b.x1 - k * D;
            parts.push(
              boxAt(D, h, b.y1 - b.y0, x1 - D / 2, (b.y0 + b.y1) / 2, z0),
            );
            leds.push(
              boxAt(
                0.06,
                0.07,
                b.y1 - b.y0,
                x1 + 0.03,
                (b.y0 + b.y1) / 2,
                z0 + h - 0.12,
              ),
            );
          }
        }
      }
      // as on the night: a long red strip on the floor in front of each bank, bright lamps on short posts along it
      const lamps: THREE.BufferGeometry[] = [];
      for (const gs of grandstands(fl)) {
        const b = gs.box;
        if (gs.facing === "north") {
          leds.push(
            boxAt(
              b.x1 - b.x0 + 16,
              0.08,
              0.14,
              (b.x0 + b.x1) / 2,
              b.y1 + 2.2,
              z0,
            ),
          );
          for (let k = 0; k < 4; k++) {
            const x = b.x0 + ((k + 0.5) * (b.x1 - b.x0)) / 4;
            parts.push(boxAt(0.18, 3.2, 0.18, x, b.y1 + 3.2, z0));
            lamps.push(boxAt(1.0, 0.7, 0.2, x, b.y1 + 3.35, z0 + 3.0));
          }
        } else {
          leds.push(
            boxAt(
              0.14,
              0.08,
              b.y1 - b.y0 + 16,
              b.x1 + 2.2,
              (b.y0 + b.y1) / 2,
              z0,
            ),
          );
          for (let k = 0; k < 3; k++) {
            const y = b.y0 + ((k + 0.5) * (b.y1 - b.y0)) / 3;
            parts.push(boxAt(0.18, 3.2, 0.18, b.x1 + 3.2, y, z0));
            lamps.push(boxAt(0.2, 0.7, 1.0, b.x1 + 3.35, y, z0 + 3.0));
          }
        }
      }
      const m = new THREE.Mesh(
        mergeGeometries(parts)!,
        new THREE.MeshStandardMaterial({ color: 0x2b2e34, roughness: 0.8 }),
      );
      m.castShadow = m.receiveShadow = true;
      this.group.add(
        m,
        new THREE.Mesh(mergeGeometries(leds)!, red),
        new THREE.Mesh(
          mergeGeometries(lamps)!,
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(3.2, 3.2, 3.0),
            toneMapped: false,
          }),
        ),
      );
    }
    // ---- floodlight towers, heads turned to the middle of the floor
    {
      const poles: THREE.BufferGeometry[] = [],
        lamps: THREE.BufferGeometry[] = [];
      const cx = (fl.x0 + fl.x1) / 2,
        cy = (fl.y0 + fl.y1) / 2;
      for (const { x, y } of floodlights(fl)) {
        poles.push(boxAt(0.55, FLOOD_H, 0.55, x, y, z0));
        // head: local +x faces the middle of the floor, tilted down
        const m = new THREE.Matrix4()
          .makeRotationY(Math.atan2(cy - y, cx - x))
          .multiply(new THREE.Matrix4().makeRotationZ(-0.45))
          .setPosition(x, z0 + FLOOD_H + 1.2, -y);
        poles.push(new THREE.BoxGeometry(0.4, 2.4, 4).applyMatrix4(m));
        for (let i = 0; i < 3; i++)
          for (let j = 0; j < 2; j++)
            lamps.push(
              new THREE.BoxGeometry(0.15, 0.85, 1.05)
                .translate(0.25, -0.6 + j * 1.15, -1.25 + i * 1.25)
                .applyMatrix4(m),
            );
      }
      this.group.add(
        new THREE.Mesh(mergeGeometries(poles)!, darkSteel),
        new THREE.Mesh(
          mergeGeometries(lamps)!,
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(3.2, 3.2, 3.0),
            toneMapped: false,
          }),
        ),
      );
    }
    // ---- a power line behind the vehicle row, as in the kickflip shot
    {
      const pp = powerPoles(st.ox, st.oy);
      const parts: THREE.BufferGeometry[] = [];
      for (const { x, y } of pp) {
        parts.push(
          new THREE.CylinderGeometry(0.16, 0.2, 10, 8).translate(x, z0 + 5, -y),
        );
        parts.push(boxAt(2.4, 0.14, 0.14, x, y, z0 + 9.4));
      }
      for (const k of [-1, 0, 1]) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 16; i++) {
          const u = i / 16;
          const x = pp[0].x + (pp[1].x - pp[0].x) * u,
            y = pp[0].y + (pp[1].y - pp[0].y) * u;
          pts.push(
            new THREE.Vector3(x + k * 0.9, z0 + 9.55 - 4.4 * u * (1 - u), -y),
          );
        }
        parts.push(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.03, 4),
        );
      }
      this.group.add(
        new THREE.Mesh(
          mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))!,
          new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.9 }),
        ),
      );
    }
  }

  /**
   * The kickflip, as on the night: five vehicles parked side by side along the run-in, each broadside to it (noses to
   * the audience on the road), on a low plinth with long red light strips; light rigs and smoke cannons at both ends,
   * a floodlight behind; the straight run-in lined with black crowd barriers and tall red/white light bars.
   */
  private buildKickflipRow(
    st: Stage,
    z0: number,
    darkSteel: THREE.Material,
    red: THREE.Material,
  ): void {
    const c = stageAt(st, st.rowS);
    const yaw = Math.atan2(st.uy, st.ux);
    const plinth = new THREE.Mesh(
      boxAt(2 * PLINTH.halfS, PLINTH.h, 2 * PLINTH.halfLat, c.x, c.y, z0),
      darkSteel,
    );
    plinth.receiveShadow = true;
    this.group.add(plinth);
    const lit = new THREE.MeshBasicMaterial({
      color: new THREE.Color(3.2, 3.2, 3.0),
      toneMapped: false,
    });
    const leds: THREE.BufferGeometry[] = [],
      whites: THREE.BufferGeometry[] = [],
      frames: THREE.BufferGeometry[] = [];
    // long red strips along the plinth's front and back edges, running far out along the floor
    for (const sy of [-1, 1])
      leds.push(
        boxAt(
          2 * PLINTH.halfS + 26,
          0.08,
          0.12,
          c.x,
          c.y + sy * (PLINTH.halfLat + 0.1),
          z0,
        ),
      );
    // the run-in: black crowd barriers either side, tall light bars just outside them
    for (const side of [-1, 1]) {
      const a = stageAt(st, LANE.s0, side * LANE.lat),
        b = stageAt(st, LANE.s1, side * LANE.lat);
      const len = b.x - a.x;
      frames.push(boxAt(len, 0.9, 0.05, (a.x + b.x) / 2, a.y, z0 + 0.12));
      frames.push(
        boxAt(len, 0.06, 0.08, (a.x + b.x) / 2, a.y, z0 + LANE.h - 0.06),
      );
      for (let s = LANE.s0; s <= LANE.s1; s += 2.4) {
        const q = stageAt(st, s, side * LANE.lat);
        frames.push(boxAt(0.06, LANE.h, 0.06, q.x, q.y, z0));
        frames.push(boxAt(0.08, 0.05, 0.7, q.x, q.y, z0));
      }
      for (let s = LANE.s0 + 2, k = 0; s < LANE.s1 + 8; s += 6, k++) {
        const q = stageAt(st, s, side * (LANE.lat + 1.2));
        frames.push(boxAt(0.3, 0.3, 0.3, q.x, q.y, z0));
        (k % 3 === 2 ? whites : leds).push(
          boxAt(0.12, 4.2, 0.12, q.x, q.y, z0 + 0.3),
        );
      }
    }
    // light rigs and smoke cannons at both ends of the row, a floodlight behind it
    this.cannons = [];
    for (const sx of [-1, 1]) {
      const x = c.x + sx * (PLINTH.halfS + 3);
      for (const dy of [-1.3, 1.3])
        frames.push(boxAt(0.12, 2.4, 0.12, x, c.y + dy, z0));
      frames.push(boxAt(0.14, 0.14, 2.8, x, c.y, z0 + 2.3));
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 2; j++)
          whites.push(
            boxAt(
              0.35,
              0.35,
              0.12,
              x - 0.0,
              c.y - 1.05 + i * 0.7,
              z0 + 1.35 + j * 0.55,
            ).translate(0, 0, -0.1),
          );
      const cy = c.y - PLINTH.halfLat - 1.5;
      frames.push(
        new THREE.CylinderGeometry(0.28, 0.32, 1.1, 10)
          .rotateZ(Math.PI / 2 - sx * 0.6)
          .translate(x - sx * 1.5, z0 + 1.1, -cy),
      );
      frames.push(boxAt(0.1, 0.8, 0.1, x - sx * 1.5, cy, z0));
      this.cannons.push({ x: x - sx * 1.5, y: cy, dir: -sx });
    }
    {
      const x = c.x + 7,
        y = c.y - 10;
      frames.push(boxAt(0.4, 13, 0.4, x, y, z0));
      frames.push(boxAt(0.3, 1.8, 3.2, x, y, z0 + 13));
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 2; j++)
          whites.push(
            boxAt(0.12, 0.7, 0.85, x, y + 0.2, z0 + 13.2 + j * 0.85).translate(
              0,
              0,
              (i - 1) * 1.0,
            ),
          );
    }
    this.group.add(
      new THREE.Mesh(mergeGeometries(leds)!, red),
      new THREE.Mesh(mergeGeometries(whites)!, lit),
      new THREE.Mesh(
        mergeGeometries(frames.map((g) => (g.index ? g.toNonIndexed() : g)))!,
        darkSteel,
      ),
    );
    const top = z0 + PLINTH.h;
    ROW.forEach((v, i) => {
      const q = stageAt(st, st.rowS + ROW_OFFSETS[i]);
      const g = new THREE.Group();
      g.position.copy(W(q.x, q.y, top));
      g.rotation.y = yaw + Math.PI / 2; // broadside to the run-in, nose to the road
      if (v.kind === "semi") g.add(semiTractor());
      else {
        const model = this.assets.models.get(KIND_MODEL[v.kind]);
        if (!model) return;
        // these models list their paint first; a textured (atlas) model keeps its own colours
        model.parts.forEach((p, k) => {
          const src = p.material as THREE.MeshStandardMaterial;
          let mat: THREE.Material = src;
          if (k === 0 && !src.map)
            mat = new THREE.MeshPhysicalMaterial({
              color: v.color,
              roughness: v.kind === "sedan2" ? 0.28 : 0.35,
              metalness: v.kind === "sedan2" ? 0.85 : 0.3,
              clearcoat: 1,
              clearcoatRoughness: 0.08,
            });
          const m = new THREE.Mesh(p.geometry, mat);
          m.castShadow = true;
          g.add(m);
        });
      }
      this.group.add(g);
    });
  }

  /**
   * The hook ramp: a concrete ribbon along the profile in src/game/venue.ts (flat apron, quarter pipe, vertical, the
   * curl over the run-in) with red LED strips on both edges and a white centre line, posts under the curve, a truss
   * tower behind the wall and a truss boom out over the curl.
   */
  private buildRamp(
    st: Stage,
    z0: number,
    steel: THREE.Material,
    darkSteel: THREE.Material,
    red: THREE.Material,
  ): void {
    const r = st.ramp;
    const { R, HALF, TOWER } = RAMP;
    const P = (u: number, w: number, z: number) => {
      const q = rampWorld(r, u, w);
      return new THREE.Vector3(q.x, z0 + z, -q.y);
    };
    const ss: number[] = [];
    for (let s = -6; s < RAMP_END; s += 0.4) ss.push(s);
    ss.push(RAMP_END);
    /** a ribbon between lateral offsets w0..w1 (or a side wall at w0 when depth is set), lifted off the surface */
    const ribbon = (
      w0: number,
      w1: number,
      lift: number,
      flip: boolean,
      depth = 0,
    ) => {
      const pos: number[] = [],
        uv: number[] = [],
        idx: number[] = [];
      ss.forEach((s, i) => {
        const p = rampPoint(s);
        const nu = -Math.sin(p.th),
          nz = Math.cos(p.th);
        const pair = depth
          ? [P(p.u, w0, p.z), P(p.u - nu * depth, w0, p.z - nz * depth)]
          : [
              P(p.u + nu * lift, w0, p.z + nz * lift),
              P(p.u + nu * lift, w1, p.z + nz * lift),
            ];
        pair.forEach((v, k) => {
          pos.push(v.x, v.y, v.z);
          uv.push(k * ((w1 - w0) / 6), (s + 6) / 6);
        });
        if (i > 0) {
          const a = 2 * (i - 1);
          if (flip) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const conc = this.assets.tex.get("Concrete034")?.clone();
    if (conc) {
      conc.wrapS = conc.wrapT = THREE.RepeatWrapping;
      conc.needsUpdate = true;
    }
    const surface = new THREE.Mesh(
      ribbon(-HALF, HALF, 0, false),
      new THREE.MeshStandardMaterial({
        color: 0xd6d6d2,
        map: conc ?? null,
        roughness: 0.85,
        side: THREE.DoubleSide,
      }),
    );
    surface.castShadow = surface.receiveShadow = true;
    const back = new THREE.Mesh(
      mergeGeometries([
        ribbon(-HALF, HALF, -0.55, true),
        ribbon(-HALF, -HALF, 0, true, 0.55),
        ribbon(HALF, HALF, 0, false, 0.55),
      ])!,
      new THREE.MeshStandardMaterial({
        color: 0x9a9a96,
        roughness: 0.9,
        side: THREE.DoubleSide,
      }),
    );
    back.castShadow = true;
    const centre = new THREE.Mesh(
      ribbon(-0.1, 0.1, 0.02, false),
      new THREE.MeshBasicMaterial({ color: 0xf4f4f4, side: THREE.DoubleSide }),
    );
    const edges = new THREE.Mesh(
      mergeGeometries([
        ribbon(-HALF, -HALF + 0.14, 0.04, false),
        ribbon(HALF - 0.14, HALF, 0.04, false),
      ])!,
      red,
    );
    this.group.add(surface, back, centre, edges);
    // ---- steel: posts under the curve, the truss tower behind the wall, a truss boom out over the curl
    const parts: THREE.BufferGeometry[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    const bar = (a: THREE.Vector3, b: THREE.Vector3, t = 0.22) => {
      const g = new THREE.BoxGeometry(t, a.distanceTo(b), t);
      g.applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(
          up,
          b.clone().sub(a).normalize(),
        ),
      ).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      parts.push(g);
    };
    const curve = (u: number) => R - Math.sqrt(R * R - u * u);
    for (const u of [3.5, 5, 6.5, 7.8, 8.8, 9.5])
      for (const w of [-HALF + 0.3, HALF - 0.3])
        bar(P(u + 0.35, w, 0), P(u + 0.35, w, curve(u) - 0.4), 0.25);
    const top = RAMP_TOP + 2;
    const u0 = R + 0.6,
      u1 = R + TOWER,
      wt = HALF + 1;
    for (const u of [u0, u1])
      for (const w of [-wt, wt]) bar(P(u, w, 0), P(u, w, top), 0.4);
    for (let z = 0; z < top - 0.5; z += 2.6) {
      const z1 = Math.min(top, z + 2.6);
      for (const w of [-wt, wt]) {
        bar(P(u0, w, z), P(u1, w, z));
        bar(P(u0, w, z), P(u1, w, z1), 0.14);
      }
      for (const u of [u0, u1]) {
        bar(P(u, -wt, z), P(u, wt, z));
        bar(P(u, -wt, z), P(u, wt, z1), 0.14);
      }
    }
    // the boom: two chords each side from the tower top out over the curl, verticals and diagonals between
    const b0 = u1,
      b1 = R - RAMP.r - 3;
    for (const w of [-wt, wt]) {
      bar(P(b0, w, top), P(b1, w, top), 0.3);
      bar(P(b0, w, top + 1.8), P(b1, w, top + 1.8), 0.3);
      for (let u = b1; u <= b0 + 0.01; u += 2.4) {
        bar(P(u, w, top), P(u, w, top + 1.8), 0.16);
        if (u + 2.4 <= b0 + 0.01)
          bar(P(u, w, top), P(u + 2.4, w, top + 1.8), 0.12);
      }
    }
    for (let u = b1; u <= b0 + 0.01; u += 4.8)
      bar(P(u, -wt, top + 1.8), P(u, wt, top + 1.8), 0.16);
    const steelMesh = new THREE.Mesh(mergeGeometries(parts)!, steel);
    steelMesh.castShadow = true;
    this.group.add(steelMesh);
    // a red accent strip along the boom's front chords, and a footing slab under the tower
    const accent: THREE.BufferGeometry[] = [];
    const strip = (a: THREE.Vector3, b: THREE.Vector3) => {
      const g = new THREE.BoxGeometry(0.1, a.distanceTo(b), 0.1);
      g.applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(
          up,
          b.clone().sub(a).normalize(),
        ),
      ).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      accent.push(g);
    };
    for (const w of [-wt - 0.2, wt + 0.2])
      strip(P(b0, w, top - 0.2), P(b1, w, top - 0.2));
    this.group.add(new THREE.Mesh(mergeGeometries(accent)!, red));
    const foot = P(R + TOWER / 2, 0, 0);
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(TOWER + 1.5, 0.6, 2 * wt + 2)
        .rotateY(Math.atan2(r.uy, r.ux))
        .translate(foot.x, z0 + 0.3, foot.z),
      darkSteel,
    );
    this.group.add(slab);
  }

  /**
   * Sinkholes: a flat disc on the road whose shader looks down into a ragged pit ~one radius deep (interior mapping:
   * each pixel traces the view ray into a cylinder and shades the earth wall or the muddy bottom it hits), inside a
   * broken-asphalt apron taken from the round-4 PH_01 photo. Nothing is cut out of the road, so cars and the player
   * still draw over it correctly.
   */
  private buildPotholes(): void {
    const ps = this.city.potholes;
    if (!ps.length) return;
    const OUT = 1.4; // apron radius, in hole radii
    const g = new THREE.CircleGeometry(OUT, 64).rotateX(-Math.PI / 2);
    const photo = this.assets.tex.get("PH_01") ?? MT.potholeTexture();
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uPh: { value: photo },
        uDepth: { value: 1.1 },
        uTint: { value: new THREE.Color(0xe6d6b6) },
        uOut: { value: OUT },
      },
      vertexShader: /* glsl */ `
        varying vec3 vW; varying vec3 vC; varying float vR;
        void main() {
          mat4 m = modelMatrix * instanceMatrix;
          vec4 w = m * vec4(position, 1.0);
          vW = w.xyz;
          vC = (m * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vR = length((m * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uPh; uniform float uDepth; uniform vec3 uTint; uniform float uOut;
        varying vec3 vW; varying vec3 vC; varying float vR;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        void main() {
          vec2 q = (vW.xz - vC.xz) / vR; // hole radius = 1
          float rr = length(q);
          float ang = atan(q.y, q.x);
          // ragged lip: the opening wobbles with the angle
          float lip = 1.0 + 0.07 * sin(ang * 5.0 + 1.3) + 0.05 * sin(ang * 11.0 + 0.4) + 0.06 * (noise(vec2(ang * 4.0, 3.1)) - 0.5);
          vec4 col;
          if (rr > lip) {
            // apron: the broken asphalt ring of the pothole photo, stretched out from the lip and faded
            float k = clamp((rr - lip) / (uOut - lip), 0.0, 1.0);
            vec2 uv = 0.5 + (q / max(rr, 1e-4)) * (0.31 + 0.19 * k);
            vec4 ph = texture2D(uPh, uv);
            float crack = smoothstep(0.62, 0.7, noise(vec2(ang * 9.0, rr * 6.0))) * (1.0 - k);
            col = vec4(ph.rgb * uTint * (0.8 - 0.35 * crack), ph.a * (1.0 - smoothstep(0.75, 1.0, k)));
          } else {
            // pit: trace the view ray into a cylinder (radius just past the lip) and a bottom uDepth radii down
            vec3 d = normalize(vW - cameraPosition);
            vec2 dh = d.xz;
            float a = max(dot(dh, dh), 1e-6), b = 2.0 * dot(q, dh), c = dot(q, q) - 1.16 * 1.16;
            float tW = (-b + sqrt(max(b * b - 4.0 * a * c, 0.0))) / (2.0 * a);
            float tB = uDepth / max(-d.y, 1e-4);
            if (tB < tW) {
              vec2 p = q + dh * tB;
              float n = noise(p * 5.0) * 0.6 + noise(p * 17.0) * 0.4;
              vec3 mud = mix(vec3(0.10, 0.08, 0.06), vec3(0.22, 0.18, 0.13), n);
              col = vec4(mud * 0.45, 1.0);
            } else {
              vec2 p = q + dh * tW;
              float z = -d.y * tW / uDepth; // 0 at the lip .. 1 at the bottom
              float wa = atan(p.y, p.x);
              float strata = noise(vec2(wa * 7.0, z * 9.0)) * 0.7 + noise(vec2(wa * 23.0, z * 30.0)) * 0.3;
              vec3 earth = mix(vec3(0.33, 0.25, 0.17), vec3(0.52, 0.41, 0.29), strata);
              vec3 slab = vec3(0.38, 0.37, 0.35); // the road slab, top 12 %
              vec3 wall = z < 0.12 ? slab * (0.8 + 0.4 * strata) : earth;
              float shade = mix(0.85, 0.05, pow(clamp(z, 0.0, 1.0), 0.55));
              col = vec4(wall * shade, 1.0);
            }
            // a dark ring right under the lip
            col.rgb *= mix(0.55, 1.0, smoothstep(lip - 0.06, lip - 0.18, rr));
          }
          gl_FragColor = col;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const im = new THREE.InstancedMesh(g, mat, ps.length);
    ps.forEach((p, i) => {
      this.q.setFromAxisAngle(this.up, i * 1.7);
      this.m.compose(W(p.x, p.y, 0.04), this.q, this.sc.set(p.r, p.r, p.r));
      im.setMatrixAt(i, this.m);
    });
    im.renderOrder = 2;
    im.frustumCulled = false;
    this.group.add(im);
  }

  /**
   * The toll plaza (src/game/toll.ts): concrete islands with booths on every lane line, columns, a white canopy over
   * all lanes with a lane-signal fascia toward each approach and "FLYERS $0" painted on its roof (read from above),
   * plus the sky lane of roadsters over the corridor. The queueing cars are city props (drawn with the parked cars).
   */
  private buildToll(): void {
    const tl = this.city.toll;
    if (tl) {
      const P = PLAZA;
      const conc: THREE.BufferGeometry[] = [],
        caps: THREE.BufferGeometry[] = [],
        cols: THREE.BufferGeometry[] = [];
      const islands = tollIslands(tl);
      for (const is of islands) {
        conc.push(
          boxAt(2 * P.islandHalfX, 0.25, 2 * P.islandHalfW, is.x, is.y, 0),
        );
        // yellow-and-black noses at both ends
        for (const sx of [-1, 1])
          caps.push(
            boxAt(
              0.5,
              1.0,
              2 * P.islandHalfW + 0.02,
              is.x + sx * (P.islandHalfX - 0.25),
              is.y,
              0,
            ),
          );
      }
      for (const y of [...islands.map((i) => i.y), tl.y])
        for (const sx of [-1, 1])
          cols.push(
            boxAt(0.5, P.bottom, 0.5, tl.x + sx * (P.islandHalfX - 0.4), y, 0),
          );
      const cv = tollCanopy(tl);
      const cw = cv.y1 - cv.y0,
        cd = cv.x1 - cv.x0;
      cols.push(boxAt(cd, P.top - P.bottom, cw, tl.x, tl.y, P.bottom));
      const white = new THREE.MeshStandardMaterial({
        color: 0xe8ebee,
        roughness: 0.55,
      });
      const cm = new THREE.Mesh(mergeGeometries(cols)!, white);
      cm.castShadow = true;
      this.group.add(
        new THREE.Mesh(
          mergeGeometries(conc)!,
          new THREE.MeshStandardMaterial({ color: 0xa9a9a4, roughness: 0.9 }),
        ),
        new THREE.Mesh(
          mergeGeometries(caps)!,
          new THREE.MeshStandardMaterial({
            map: MT.hazardStripeTexture(),
            roughness: 0.7,
          }),
        ),
        cm,
      );
      // booths: the round-3 booth model squeezed onto the islands (fallback: a glazed box)
      const booth = this.assets.models.get("toll_booth_r3");
      for (const is of islands) {
        if (booth) {
          const g = new THREE.Group();
          for (const p of booth.parts)
            g.add(new THREE.Mesh(p.geometry, p.material));
          g.scale.set(
            (2 * P.boothHalfX) / booth.size.x,
            P.boothH / booth.size.y,
            (2 * P.boothHalfW) / booth.size.z,
          );
          g.position.copy(W(is.x, is.y, 0.25));
          this.group.add(g);
        } else
          this.group.add(
            new THREE.Mesh(
              boxAt(
                2 * P.boothHalfX,
                P.boothH,
                2 * P.boothHalfW,
                is.x,
                is.y,
                0.25,
              ),
              new THREE.MeshStandardMaterial({
                color: 0x9fb4c4,
                roughness: 0.3,
                metalness: 0.2,
              }),
            ),
          );
      }
      // fascia toward each approach: lane signals (green arrows over the lanes coming in, red crosses over the
      // other direction's) either side of a TOLL panel
      const fascia = MT.tollFasciaTexture(
        Array.from({ length: C.LANES_PER_DIR }, (_, k) => C.laneOffset(k) / cw),
      );
      for (const sx of [-1, 1]) {
        const f = new THREE.Mesh(
          new THREE.PlaneGeometry(cw, P.top - P.bottom),
          new THREE.MeshStandardMaterial({
            map: fascia,
            emissive: 0xffffff,
            emissiveMap: fascia,
            emissiveIntensity: 0.6,
            roughness: 0.5,
          }),
        );
        f.rotation.y = (sx * Math.PI) / 2; // sx = -1: the west face, toward eastbound traffic
        f.position.copy(
          W(tl.x + sx * (cd / 2 + 0.02), tl.y, (P.bottom + P.top) / 2),
        );
        this.group.add(f);
      }
      // FLYERS $0 painted on the roof, one half for each direction, letters upright for whoever flies in over it
      const roofTex = MT.flyersRoofTexture();
      for (const sx of [-1, 1]) {
        const g = new THREE.PlaneGeometry(cw - 3, cd / 2 - 1)
          .rotateX(-Math.PI / 2)
          .rotateY((-sx * Math.PI) / 2)
          .translate(tl.x + (sx * cd) / 4, P.top + 0.02, -tl.y);
        this.group.add(
          new THREE.Mesh(
            g,
            new THREE.MeshStandardMaterial({
              map: roofTex,
              transparent: true,
              depthWrite: false,
              roughness: 0.7,
              polygonOffset: true,
              polygonOffsetFactor: -2,
              polygonOffsetUnits: -2,
            }),
          ),
        );
      }
    }
    // the sky lane (src/game/skylane.ts): THIS SIDE UP undersides read from the street
    const g = new THREE.PlaneGeometry(3.9, 1.7);
    g.rotateX(Math.PI / 2); // faces down
    this.under = new THREE.InstancedMesh(
      g,
      // the R_08 underside panel with its THIS SIDE UP sticker (fallback: the drawn hazard sticker)
      new THREE.MeshBasicMaterial({
        map: this.assets.tex.get("R08S") ?? MT.undersideTexture(),
      }),
      this.city.sky.length,
    );
    this.under.frustumCulled = false;
    this.group.add(this.under);
  }

  /** a roadster on top of a few parked cars along the commute (the roof-parked ones come in placeOnRoofs) */
  private buildParking(): void {
    const H = this.fleet?.H ?? 1.3;
    const st = this.city.stage;
    const stacked: { x: number; y: number }[] = [];
    for (const p of this.city.props) {
      if (p.kind !== "parked" || stacked.length >= 5) continue;
      const x = (p.box.x0 + p.box.x1) / 2,
        y = (p.box.y0 + p.box.y1) / 2;
      if (st && inBox(expand(st.floor, 20), x, y)) continue;
      if (
        Math.abs(y) > 90 ||
        Math.abs(x) < 200 ||
        stacked.some((s) => Math.hypot(s.x - x, s.y - y) < 160)
      )
        continue;
      stacked.push({ x, y });
      this.statics.push({
        x,
        y,
        hc: p.h + H / 2 + 0.05,
        heading: p.heading + 0.12,
        color: PALETTE[stacked.length % 6],
      });
    }
  }

  private buildCarts(): void {
    const site = martSite(this.city); // shared with the collision layout (src/game/landmarks.ts)
    if (!site) return;
    const { cx, ey, south } = site;
    const front = this.assets.tex.get("MT_01");
    if (front) {
      // round-4 MT_01 store front on a 30 x 16 x 12.3 m box (solid in game), facing the avenue
      const b = site.box;
      const wall = new THREE.MeshStandardMaterial({
        color: 0xd9dcdf,
        roughness: 0.85,
      });
      const face = new THREE.MeshStandardMaterial({
        map: front,
        roughness: 0.6,
        emissiveMap: front, // lit shop windows
        emissive: 0x262626,
      });
      // BoxGeometry faces: +x, -x, +y, -y, +z (game -y), -z (game +y)
      const mats = [wall, wall, wall, wall, wall, wall];
      mats[south ? 4 : 5] = face;
      const store = new THREE.Mesh(
        new THREE.BoxGeometry(b.x1 - b.x0, site.height, b.y1 - b.y0),
        mats,
      );
      store.position.copy(
        W((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, C.CURB_H + site.height / 2),
      );
      store.castShadow = store.receiveShadow = true;
      this.group.add(store);
      // a tall ORBIT MART pylon on the corner by the road, facing the eastbound traffic: the store front itself only
      // shows once you are past the block before it
      const px = b.x0 - 14,
        py = ey + (south ? -1 : 1);
      const pylonTex = MT.martSignTexture();
      for (const side of [-1, 1]) {
        const s = signPlane(pylonTex, 12, 3, 0.8);
        s.position.copy(W(px + side * 0.25, py, 15));
        s.rotation.y = (side * Math.PI) / 2; // west face (-1) toward approaching traffic, east face back
        this.group.add(s);
      }
      this.group.add(
        new THREE.Mesh(
          mergeGeometries([
            boxAt(0.6, 13.5, 0.6, px, py, 0),
            boxAt(0.4, 3.4, 12.4, px, py, 13.3),
          ])!,
          new THREE.MeshStandardMaterial({ color: 0x444a52, roughness: 0.6 }),
        ),
      );
    } else {
      const sign = signPlane(MT.martSignTexture(), 14, 3.5, 0.7);
      sign.position.copy(W(cx, ey, 5.2));
      if (!south) sign.rotation.y = Math.PI;
      const posts = new THREE.Mesh(
        mergeGeometries([
          boxAt(0.3, 7, 0.3, cx - 6.5, ey + (south ? 0.3 : -0.3), 0),
          boxAt(0.3, 7, 0.3, cx + 6.5, ey + (south ? 0.3 : -0.3), 0),
        ])!,
        new THREE.MeshStandardMaterial({ color: 0x444a52, roughness: 0.6 }),
      );
      this.group.add(sign, posts);
    }
    for (let i = 0; i < 5; i++)
      this.cartSpots.push({
        x: cx - 8 + i * 4,
        y: ey + (south ? 4.5 : -4.5),
        heading: i * 1.3,
        ph: i * 0.9,
        up: false,
      });
    // round-4 Blender cart (tools/blender/r4/cart.py: wire basket, ORBIT MART handle, jet pod); else the box cart.
    // Part transforms go into the instance matrices, not the (quantised) geometry.
    const scene = this.assets.scenes.get("cart_r4");
    const n = this.cartSpots.length;
    if (scene) {
      scene.updateMatrixWorld(true);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const im = new THREE.InstancedMesh(m.geometry, m.material, n);
        im.frustumCulled = false;
        im.castShadow = true;
        this.carts.push({ im, local: m.matrixWorld.clone() });
      });
    } else
      this.carts.push({
        im: new THREE.InstancedMesh(
          cartGeometry(),
          new THREE.MeshStandardMaterial({
            color: 0xb8bec6,
            roughness: 0.35,
            metalness: 0.8,
          }),
          n,
        ),
        local: new THREE.Matrix4(),
      });
    for (const c of this.carts) {
      c.im.frustumCulled = false;
      this.group.add(c.im);
    }
  }

  private buildBoosters(): void {
    let xMax = 0;
    for (const n of this.city.nodes) xMax = Math.max(xMax, n.x);
    const body = this.assets.scenes.get("booster_r4"),
      leg = this.assets.scenes.get("booster_leg_r4");
    for (const y of [-34, 34]) {
      const b = body && leg ? photoBooster(body, leg) : booster(true);
      this.boosters.push(b);
      this.boosterXY.push({ x: xMax + 260, y });
      this.group.add(b.root);
    }
  }

  private buildOrbit(model: Model): void {
    const g = new THREE.Group();
    let bi = 0;
    model.parts.forEach((p, i) => {
      if (
        p.geometry.attributes.position.count >
        model.parts[bi].geometry.attributes.position.count
      )
        bi = i;
    });
    model.parts.forEach((p, i) => {
      const mat =
        i === bi
          ? new THREE.MeshStandardMaterial({
              color: 0xc8141c,
              roughness: 0.35,
              metalness: 0.2,
              fog: false,
            })
          : (p.material.clone() as THREE.MeshStandardMaterial);
      mat.fog = false;
      g.add(new THREE.Mesh(p.geometry, mat));
    });
    // suited mannequin in the driver's seat, one arm on the door
    const suit = new THREE.MeshStandardMaterial({
      color: 0xf1f1f1,
      roughness: 0.6,
      fog: false,
    });
    const H = model.size.y;
    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.24, 0.42, 4, 10),
      suit,
    );
    torso.position.set(-0.35, H * 0.62 + 0.25, 0.32);
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 14, 10),
      new THREE.MeshStandardMaterial({
        color: 0x20242c,
        roughness: 0.1,
        metalness: 0.5,
        fog: false,
      }),
    );
    helmet.position.set(-0.32, H * 0.62 + 0.82, 0.32);
    const arm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.08, 0.5, 3, 8),
      suit,
    );
    arm.rotation.x = Math.PI / 2.4;
    arm.position.set(-0.25, H * 0.62 + 0.38, 0.72);
    g.add(torso, helmet, arm);
    g.scale.setScalar(13);
    this.orbit = g;
    this.group.add(g);
  }

  /**
   * Roadsters parked on hero-building roofs next to the commute, with a "ROOF PARKING" sign. Probes the one hero
   * model under each candidate with downward rays over the car's footprint and keeps only flat spots (no AC units).
   * Runs once, after the first city view exists.
   */
  placeOnRoofs(
    heroes: {
      id: string;
      x: number;
      y: number;
      rot: number;
      s: number;
      lodTop: number;
    }[],
  ): void {
    if (this.roofsPlaced) return;
    this.roofsPlaced = true;
    const H = this.fleet?.H ?? 1.3;
    // round-3 MS_06 "CAN'T PARK THERE" right behind the parked car (fallback: the drawn ROOF PARKING sign)
    const ms6 = this.assets.tex.get("MS_06");
    const roofTex = ms6 ?? MT.roofSignTexture();
    const [sw, sh] = ms6 ? [2.2, 2.2] : [4.2, 2.1];
    const picked: { x: number; y: number }[] = [];
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const probe = new THREE.Mesh();
    const hits: THREE.Intersection[] = [];
    const cands = heroes
      .filter(
        (h) =>
          Math.abs(h.y) > 18 &&
          Math.abs(h.y) < 150 &&
          Math.abs(h.x) > 200 &&
          Math.abs(h.x) < 950,
      )
      .sort((a, b) => Math.abs(a.y) - Math.abs(b.y));
    for (const h of cands) {
      if (picked.length >= 6) break;
      if (!picked.every((p) => Math.hypot(p.x - h.x, p.y - h.y) > 140))
        continue;
      const model = this.assets.models.get(h.id);
      if (!model) continue;
      const parts = model.parts.map((p) => {
        const m = new THREE.Mesh(p.geometry, probe.material);
        m.position.set(h.x, 0, -h.y);
        m.rotation.y = h.rot;
        m.scale.setScalar(h.s);
        m.updateMatrixWorld(true);
        return m;
      });
      const topAt = (x: number, y: number) => {
        ray.set(this.v.set(x, 400, -y), down);
        hits.length = 0;
        ray.intersectObjects(parts, false, hits);
        return hits.length ? hits[0].point.y : -Infinity;
      };
      // park as close to the street edge as the roof allows (so it reads from the road), parallel to the street;
      // the car's footprint must be flat (all five rays within 0.2 m)
      const toward = h.y > 0 ? -1 : 1; // the road at y = 0
      for (const d of [11, 10, 9, 8, 7, 6, 5, 4, 3]) {
        const heading = picked.length % 2 ? 0.12 : Math.PI - 0.12;
        const c = Math.cos(heading),
          sn = Math.sin(heading);
        const x = h.x,
          y = h.y + toward * d;
        // the outermost ray row must land on this roof, not on the street below
        if (topAt(x, y + toward * 1.6) < 6) continue;
        const ys = [
          [0, 0],
          [2.2, 0.9],
          [-2.2, 0.9],
          [2.2, -0.9],
          [-2.2, -0.9],
        ].map(([dx, dy]) => topAt(x + dx * c - dy * sn, y + dx * sn + dy * c));
        const top = Math.max(...ys);
        // low flat roofs only (taller ones hide the car behind the parapet), and the always-drawn LOD box must not
        // stick up through the spot
        if (
          !Number.isFinite(top) ||
          top - Math.min(...ys) > 0.2 ||
          top < 6 ||
          top > 13
        )
          continue;
        if (h.lodTop > top + 0.3) break;
        picked.push({ x: h.x, y: h.y });
        const sign = signPlane(roofTex, sw, sh, 0.35);
        this.statics.push({
          x,
          y,
          hc: top + H / 2 + 0.02,
          heading,
          color: PALETTE[picked.length % 6],
          sign,
        });
        // behind the car as seen from the street, so the car reads in front of it
        sign.position.copy(W(x + 0.5, y - toward * 3.4, top + sh / 2 + 0.6));
        if (toward > 0) sign.rotation.y = Math.PI;
        this.group.add(sign);
        break;
      }
    }
  }

  /**
   * per frame: t = wall seconds, cam = camera position, (px, py) = player position in game coords, simT = session
   * seconds (the sky lane runs on it, so it is exactly where the game collides with it)
   */
  update(
    t: number,
    cam: THREE.Vector3,
    px: number,
    py: number,
    fx: Particles,
    simT = t,
  ): void {
    this.t = t;
    const emit = t - this.puffT > 0.07;
    if (emit) this.puffT = t;
    const f = this.fleet;
    if (f) {
      f.begin();
      for (const s of this.statics) f.add(s.x, s.y, s.hc, s.heading, s.color);
      this.updateSky(f, simT, cam, fx, emit);
      this.updateDemo(f, t, cam, px, py, fx);
      f.end();
    }
    this.updateCarts(t, cam, fx);
    this.updateBoosters(t, cam, fx);
    const pulse = 1 + 0.18 * Math.sin(t * 3.2);
    for (const g of this.clipBeams.values())
      g.getObjectByName("ring")?.scale.setScalar(pulse);
    if (this.orbit) {
      const a = 0.9 + t * 0.004,
        el = 0.4;
      this.orbit.position.set(
        cam.x + Math.cos(a) * Math.cos(el) * 1150,
        cam.y + Math.sin(el) * 1150,
        cam.z - Math.sin(a) * Math.cos(el) * 1150,
      );
      this.orbit.rotation.set(t * 0.05, t * 0.08, 0.35);
    }
  }

  private updateSky(
    f: Fleet,
    t: number,
    cam: THREE.Vector3,
    fx: Particles,
    emit: boolean,
  ): void {
    if (!this.under) return;
    this.city.sky.forEach((s, i) => {
      const p = skyCarAt(s, i, t);
      f.add(
        p.x,
        p.y,
        p.hc,
        p.heading,
        PALETTE[i % PALETTE.length],
        0.04,
        0.03 * Math.sin(t * 1.3 + i),
      );
      this.q.setFromAxisAngle(this.up, p.heading);
      this.m.compose(
        W(p.x, p.y, p.hc - f.H / 2 - 0.03),
        this.q,
        this.sc.set(1, 1, 1),
      );
      this.under!.setMatrixAt(i, this.m);
      if (emit && this.v.copy(W(p.x, p.y, p.hc)).distanceTo(cam) < 260)
        for (const k of [-1, 1])
          fx.emit(
            W(p.x - s.dir * 1.4 * k, p.y + k * 0.6, p.hc - f.H / 2),
            new THREE.Vector3(
              (Math.random() - 0.5) * 1.5,
              -7,
              (Math.random() - 0.5) * 1.5,
            ),
            0.55,
            1.3,
            JET,
            { drag: 1.5, grav: 0.5 },
          );
    });
    this.under.count = this.city.sky.length;
    this.under.instanceMatrix.needsUpdate = true;
  }

  /** a jet plume: the four bottom jets of a demo car (centre at hc), pointing down its body axis */
  private plume(
    fx: Particles,
    x: number,
    y: number,
    hc: number,
    heading: number,
    pitch: number,
    roll: number,
    n: number,
  ): void {
    this.e.set(roll, heading, pitch, "YXZ");
    this.q.setFromEuler(this.e);
    const down = this.v.set(0, -1, 0).applyQuaternion(this.q);
    for (const [ax, az] of [
      [1.4, 0.7],
      [1.4, -0.7],
      [-1.4, 0.7],
      [-1.4, -0.7],
    ]) {
      const o = new THREE.Vector3(ax, -0.4, az).applyQuaternion(this.q);
      for (let k = 0; k < n; k++)
        fx.emit(
          new THREE.Vector3(x + o.x, hc + o.y, -y + o.z),
          down
            .clone()
            .multiplyScalar(16 + Math.random() * 6)
            .add(
              new THREE.Vector3(
                (Math.random() - 0.5) * 2,
                0,
                (Math.random() - 0.5) * 2,
              ),
            ),
          0.7,
          0.9,
          JET,
          { drag: 2.2, grav: 0 },
        );
    }
  }

  /**
   * The reveal on loop, two demo cars: the kickflip (run in, jets fire, a barrel roll over the vehicle row, down in a
   * gas cloud) and the ramp (run in, up the curve and the wall, over the lip upside down, roll upright, drop in front
   * of it in a gas cloud). Each steps aside while the player is on its line.
   */
  private updateDemo(
    f: Fleet,
    t: number,
    cam: THREE.Vector3,
    px: number,
    py: number,
    fx: Particles,
  ): void {
    const st = this.city.stage;
    if (!st) return;
    const H = f.H,
      g = C.CURB_H + H / 2;
    const near = (x: number, y: number) =>
      this.v.copy(W(x, y, 0)).distanceTo(cam) < 360;
    // ---- the kickflip
    {
      const pl = this.toStrip(st, px, py);
      if (!(Math.abs(pl.lat) < 16 && pl.s > -10 && pl.s < st.rowS + 40)) {
        const V = 27,
          s0 = 4,
          sJ = st.rowS - ROW_HALF - 15,
          sL = st.rowS + ROW_HALF + 15;
        const runT = (sL - s0) / V,
          per = runT + 2.6,
          tau = (t + 3.1) % per;
        let s = s0 + V * tau,
          hc = g,
          roll = 0,
          pitch = 0;
        if (s > sL) {
          const k = Math.min(1, (tau - runT) / 1.6);
          s = sL + 22 * (1 - (1 - k) * (1 - k));
        } else if (s > sJ) {
          const u = (s - sJ) / (sL - sJ);
          hc = g + 8.5 * 4 * u * (1 - u); // well over the truck in the middle
          roll = -2 * Math.PI * smooth((u - 0.12) / 0.72);
          pitch = 0.12 * Math.sin(Math.PI * u);
        }
        const q = stageAt(st, s);
        const yaw = Math.atan2(st.uy, st.ux);
        f.add(q.x, q.y, hc, yaw, 0xe9ecef, pitch, roll);
        const prev = this.demoS;
        this.demoS = s;
        if (s >= prev && near(q.x, q.y)) {
          const at = (k: number) => prev < k && s >= k;
          if (at(sJ)) {
            gasCloud(fx, W(q.x, q.y, C.CURB_H), 90, 2.6, 1.1);
            this.cannonBlast(fx);
          }
          // two downward jets carry it up and through the roll
          if (s > sJ && s < sJ + (sL - sJ) * 0.75)
            this.plume(fx, q.x, q.y, hc, yaw, pitch, roll, 1);
          if (at(sL)) {
            gasCloud(fx, W(q.x, q.y, C.CURB_H), 150, 3.0, 1.6);
            this.cannonBlast(fx);
          }
        }
      }
    }
    // ---- the ramp
    {
      const r = st.ramp;
      const pl = rampLocal(r, px, py);
      if (pl.u > -100 && pl.u < 20 && Math.abs(pl.w) < 14) return;
      const yaw = Math.atan2(r.uy, r.ux);
      const V = 36,
        u0 = -90;
      const tRun = -u0 / V,
        tWall = 1.15,
        vL = 13;
      const lip = rampPoint(RAMP_END);
      // ballistic leg after the lip: back over the run-in (-u), up then down to the floor
      const vu = vL * Math.cos(lip.th),
        vz = vL * Math.sin(lip.th);
      const zc0 = lip.z + Math.cos(lip.th) * (H / 2),
        uc0 = lip.u - Math.sin(lip.th) * (H / 2);
      const tAir = (vz + Math.sqrt(vz * vz + 2 * 20 * (zc0 - H / 2))) / 20;
      const per = tRun + tWall + tAir + 2.4;
      const tau = (t + 1.3) % per;
      let u = 0,
        zc = g,
        heading = yaw,
        pitch = 0,
        roll = 0,
        phase = 0;
      if (tau < tRun) u = u0 + V * tau;
      else if (tau < tRun + tWall) {
        phase = 1;
        const k = (tau - tRun) / tWall;
        const p = rampPoint(
          RAMP_END * (1 - (1 - k) * (1 - k) * (1 - 0.35 * k)),
        );
        u = p.u - Math.sin(p.th) * (H / 2);
        zc = C.CURB_H + p.z + Math.cos(p.th) * (H / 2);
        pitch = p.th;
      } else if (tau < tRun + tWall + tAir) {
        phase = 2;
        const ta = tau - tRun - tWall;
        u = uc0 + vu * ta;
        zc = C.CURB_H + zc0 + vz * ta - 10 * ta * ta;
        heading = yaw + Math.PI;
        roll = Math.PI * (1 - smooth(ta / 0.55));
      } else {
        phase = 3;
        const ta = tau - tRun - tWall - tAir;
        const k = Math.min(1, ta / 1.6);
        u = uc0 + vu * tAir + vu * 1.6 * 0.5 * (1 - (1 - k) * (1 - k));
        heading = yaw + Math.PI;
      }
      const q = rampWorld(r, u, 0);
      f.add(q.x, q.y, zc, heading, 0xe9ecef, pitch, roll);
      const prev = this.rampPhase;
      this.rampPhase = phase;
      if (near(q.x, q.y)) {
        if (phase === 1 && prev === 0)
          gasCloud(fx, W(q.x, q.y, C.CURB_H), 30, 1.8, 0.7);
        if (phase === 2) this.plume(fx, q.x, q.y, zc, heading, pitch, roll, 1);
        if (phase === 3 && prev === 2)
          gasCloud(fx, W(q.x, q.y, C.CURB_H), 120, 2.8, 1.5);
      }
    }
  }

  /** the smoke cannons at the row's ends blow a white jet along the floor */
  private cannonBlast(fx: Particles): void {
    for (const c of this.cannons)
      for (let i = 0; i < 40; i++)
        fx.emit(
          W(c.x, c.y, C.CURB_H + 1.1),
          new THREE.Vector3(
            c.dir * (10 + Math.random() * 8),
            1 + Math.random() * 2.5,
            (Math.random() - 0.5) * 4,
          ),
          1.6,
          2.4,
          JET,
          { drag: 1.6, grav: -0.3 },
        );
  }

  /** strip coordinates on the kickflip run-in: s along it, lat to its left */
  private toStrip(st: Stage, x: number, y: number): { s: number; lat: number } {
    const dx = x - st.ox,
      dy = y - st.oy;
    return { s: dx * st.ux + dy * st.uy, lat: -dx * st.uy + dy * st.ux };
  }

  private updateCarts(t: number, cam: THREE.Vector3, fx: Particles): void {
    if (!this.carts.length) return;
    this.cartSpots.forEach((c, i) => {
      const tau = (t + c.ph) % 4.5;
      const air = tau < 1.3;
      const h = air ? 6 * Math.sin((Math.PI * tau) / 1.3) : 0;
      const spin = air ? tau * 2.4 : 0;
      this.q.setFromAxisAngle(this.up, c.heading + spin);
      this.m.compose(W(c.x, c.y, h), this.q, this.sc.set(1.3, 1.3, 1.3));
      for (const p of this.carts)
        p.im.setMatrixAt(i, this.cartM.multiplyMatrices(this.m, p.local));
      if (air !== c.up && W(c.x, c.y, 0).distanceTo(cam) < 220)
        gasCloud(fx, W(c.x, c.y, 0), air ? 18 : 10, 1, 0.5);
      c.up = air;
    });
    for (const p of this.carts) p.im.instanceMatrix.needsUpdate = true;
  }

  /** two boosters on one clock: descend on a landing burn, legs out, touch down together, sit, relaunch */
  private updateBoosters(t: number, cam: THREE.Vector3, fx: Particles): void {
    const tau = t % 28;
    let alt = 0,
      fire = false,
      legs = 1;
    if (tau < 10) {
      const u = tau / 10;
      alt = 300 * (1 - u) ** 2.2;
      fire = true;
      legs = smooth((u - 0.7) / 0.3);
    } else if (tau >= 17) {
      const u = (tau - 17) / 11;
      alt = 300 * u ** 2.2;
      fire = true;
      legs = 1 - smooth(u / 0.15);
    }
    const down = tau >= 10 && tau < 17;
    this.boosters.forEach((b, i) => {
      const p = this.boosterXY[i];
      b.root.position.copy(W(p.x, p.y, alt));
      b.flame.visible = fire;
      if (fire)
        b.flame.scale.set(
          1,
          (0.85 + 0.3 * Math.random()) *
            (b.flame.userData.anchored ? Math.min(1, (alt + 0.5) / 16) : 1),
          1,
        );
      for (const piv of b.legs.children)
        piv.rotation.z = Math.PI - legs * (Math.PI - 0.5);
      if (down && !this.boosterDown && b.root.position.distanceTo(cam) < 900)
        gasCloud(fx, W(p.x, p.y, 0), 80, 8, 2.2);
    });
    this.boosterDown = down;
  }
}
