// Player car (third-party model, recoloured, with thruster nozzles + THIS SIDE UP sticker) and instanced NPC vehicles.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CAR_H } from "../game/constants";
import { NPC_DIMS, type NpcKind, type NpcPose } from "../game/traffic";
import type { Assets, Model } from "./assets";

let stickerTex: THREE.CanvasTexture | null = null;
function stickerTexture(): THREE.CanvasTexture {
  if (stickerTex) return stickerTex;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f2ede0";
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 244, 116);
  ctx.fillStyle = "#111";
  ctx.font = "bold 34px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("THIS SIDE UP", 128, 58);
  ctx.beginPath();
  ctx.moveTo(128, 70);
  ctx.lineTo(108, 100);
  ctx.lineTo(148, 100);
  ctx.closePath();
  ctx.fill();
  stickerTex = new THREE.CanvasTexture(c);
  stickerTex.colorSpace = THREE.SRGBColorSpace;
  return stickerTex;
}

let blobTex: THREE.CanvasTexture | null = null;
export function blobShadowTexture(): THREE.CanvasTexture {
  if (blobTex) return blobTex;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 32, 4, 64, 32, 30);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.6, "rgba(0,0,0,0.35)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.scale(1, 1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 64);
  ctx.restore();
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}
function blobShadowMesh(len = 4.8, wid = 2.4): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(len, wid),
    new THREE.MeshBasicMaterial({
      map: blobShadowTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

let jetTex: THREE.CanvasTexture | null = null;
/** Jet ribbon: bright white core along the axis, blue halo at the edges, fading to nothing at the tail (u = 1). */
function jetTexture(): THREE.CanvasTexture {
  if (jetTex) return jetTex;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(256, 64);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 256; x++) {
      const u = 1 - x / 255, // ribbon spans x in [-1, 0]: bright at the nozzle (x = 0), fading toward the tip
        v = Math.abs(y - 31.5) / 31.5;
      const tail = (1 - u) ** 1.6; // fade along the jet
      const core = Math.exp(-v * v * 18) * tail; // thin white core
      const halo = Math.exp(-v * v * 3.2) * tail * 0.75;
      const i = (y * 256 + x) * 4;
      img.data[i] = Math.min(255, (core + halo * 0.35) * 255);
      img.data[i + 1] = Math.min(255, (core + halo * 0.59) * 255);
      img.data[i + 2] = Math.min(255, (core + halo * 0.92) * 255);
      img.data[i + 3] = Math.min(255, (core + halo) * 255);
    }
  ctx.putImageData(img, 0, 0);
  jetTex = new THREE.CanvasTexture(c);
  jetTex.colorSpace = THREE.SRGBColorSpace;
  return jetTex;
}

export interface PlayerCar {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  rearNozzles: THREE.Vector3[];
  bottomNozzles: THREE.Vector3[];
  flame: THREE.Group;
  /** Downward cold-gas jets on the four bottom nozzles (jump launch / rotation burn). */
  downJets: THREE.Group;
  spin(dist: number): void;
  /** Front-wheel steer angle in radians (+ = left). */
  steer(angle: number): void;
}

export const PLAYER_MODEL = "roadster_r3";

export function buildPlayerCar(assets: Assets, color = 0xd62828): PlayerCar {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.y = -CAR_H / 2;
  root.add(inner);
  const model =
    assets.models.get(PLAYER_MODEL) ?? assets.models.get("1mkmFkAz5v");
  const L = model ? model.size.x : 4.6,
    W = model ? model.size.z : 2.0,
    H = model ? model.size.y : 1.3;
  const wheelPivots: {
    steer: THREE.Group;
    roll: THREE.Group;
    r: number;
    front: boolean;
  }[] = [];
  if (model) {
    // largest part = body: tint it; keep other materials (glass, lights, wheels)
    const sorted = (model.bodyParts ?? model.parts)
      .slice()
      .sort(
        (a, b) =>
          b.geometry.attributes.position.count -
          a.geometry.attributes.position.count,
      );
    sorted.forEach((p, i) => {
      let mat = (p.material as THREE.MeshStandardMaterial).clone();
      if (i === 0 && mat.isMeshStandardMaterial) {
        // hero paint: automotive clearcoat over a saturated base
        const paint = new THREE.MeshPhysicalMaterial({
          color,
          roughness: 0.32,
          metalness: 0.15,
          clearcoat: 1,
          clearcoatRoughness: 0.06,
          envMapIntensity: 1.4,
        });
        mat = paint as unknown as THREE.MeshStandardMaterial;
      }
      const m = new THREE.Mesh(p.geometry, mat);
      m.castShadow = true;
      inner.add(m);
    });
    // separate wheels: steer pivot (y) at the hub, roll pivot (z) inside it
    for (const w of model.wheels ?? []) {
      const steer = new THREE.Group();
      steer.position.copy(w.center);
      const roll = new THREE.Group();
      steer.add(roll);
      for (const p of w.parts) {
        const m = new THREE.Mesh(p.geometry, p.material);
        m.castShadow = true;
        roll.add(m);
      }
      inner.add(steer);
      wheelPivots.push({
        steer,
        roll,
        r: Math.max(0.2, w.radius),
        front: w.front,
      });
    }
  } else {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(4.4, 1.0, 2.0),
      new THREE.MeshStandardMaterial({ color }),
    );
    body.position.y = 0.8;
    inner.add(body);
  }
  // the round-3 roadster models its own underside sticker and bottom nozzles
  const ownUnder =
    !!model &&
    (model.bodyParts ?? model.parts).some((p) =>
      /^(sticker|under)/.test(p.material.name),
    );
  if (!ownUnder) {
    const sticker = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.1),
      new THREE.MeshStandardMaterial({ map: stickerTexture(), roughness: 0.9 }),
    );
    sticker.rotation.x = Math.PI / 2;
    sticker.rotation.z = Math.PI / 2;
    sticker.position.set(0, 0.22, 0);
    inner.add(sticker);
  }
  const nozzleMat = new THREE.MeshStandardMaterial({
    color: 0x2a2d33,
    metalness: 0.8,
    roughness: 0.35,
  });
  // round-3 roadster: two small nozzles flush in the rear plate recess under the light bar (R_07's hidden ring);
  // the older fallback car keeps its big exhaust cans
  const rearNozzles = ownUnder
    ? [
        new THREE.Vector3(-L / 2 + 0.03, H * 0.48, W * 0.09),
        new THREE.Vector3(-L / 2 + 0.03, H * 0.48, -W * 0.09),
      ]
    : [
        new THREE.Vector3(-L / 2 - 0.15, H * 0.42, W * 0.28),
        new THREE.Vector3(-L / 2 - 0.15, H * 0.42, -W * 0.28),
      ];
  for (const p of rearNozzles) {
    const n = new THREE.Mesh(
      ownUnder
        ? new THREE.CylinderGeometry(0.07, 0.1, 0.16, 12)
        : new THREE.CylinderGeometry(0.15, 0.22, 0.45, 10),
      nozzleMat,
    );
    n.rotation.z = Math.PI / 2;
    n.position.copy(p);
    inner.add(n);
  }
  const bottomNozzles = [
    new THREE.Vector3(L * 0.3, 0.25, W * 0.35),
    new THREE.Vector3(L * 0.3, 0.25, -W * 0.35),
    new THREE.Vector3(-L * 0.3, 0.25, W * 0.35),
    new THREE.Vector3(-L * 0.3, 0.25, -W * 0.35),
  ];
  for (const p of ownUnder ? [] : bottomNozzles) {
    const n = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.14, 0.2, 8),
      nozzleMat,
    );
    n.position.copy(p);
    inner.add(n);
  }
  // Boost jets (bible: white #FEFFFF core with a #5896EB halo, localised, not a magenta blob):
  // one crossed-plane ribbon per nozzle, textured with a core/halo gradient, stretched along -x while boosting.
  const flame = new THREE.Group();
  const jetMat = new THREE.MeshBasicMaterial({
    map: jetTexture(),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ribbon = mergeGeometries(
    [
      new THREE.PlaneGeometry(1, 0.55).translate(-0.5, 0, 0),
      new THREE.PlaneGeometry(1, 0.55)
        .rotateX(Math.PI / 2)
        .translate(-0.5, 0, 0),
    ],
    false,
  )!;
  for (const n of rearNozzles) {
    const j = new THREE.Mesh(ribbon, jetMat);
    j.position.copy(n).x -= 0.2;
    j.name = "jet";
    flame.add(j);
  }
  flame.visible = false;
  inner.add(flame);
  // downward jets: same ribbon, rotated to point along -y from each bottom nozzle
  const downJets = new THREE.Group();
  for (const n of bottomNozzles) {
    const j = new THREE.Mesh(ribbon, jetMat);
    j.position.copy(n).y -= 0.1;
    // spin about the ribbon's own axis (x) first, then point it down: -x of the ribbon -> -y
    j.rotation.order = "ZYX";
    j.rotation.z = Math.PI / 2;
    j.name = "downjet";
    downJets.add(j);
  }
  downJets.visible = false;
  inner.add(downJets);
  const blob = blobShadowMesh(L + 0.6, W + 0.6);
  blob.name = "blob";
  root.add(blob);
  // on root, not inner: the respawn blink hides inner, and a light that comes and goes changes every material's
  // point-light count, so each blink frame used to compile a second program per material (mid-drive hitches)
  const headlight = new THREE.PointLight(0xffe2b8, 22, 32, 2);
  headlight.position.set(L / 2 + 0.8, 1.0 - CAR_H / 2, 0);
  root.add(headlight);
  return {
    root,
    wheels: [],
    rearNozzles,
    bottomNozzles,
    flame,
    downJets,
    spin(dist: number) {
      for (const w of wheelPivots) w.roll.rotation.z -= dist / w.r;
    },
    steer(angle: number) {
      for (const w of wheelPivots) if (w.front) w.steer.rotation.y = angle;
    },
  };
}

export const KIND_MODEL: Record<NpcKind, string> = {
  sedan: "unqqkULtRU",
  sedan2: "Cz6yDaUcM9",
  hatchback: "BG0KAhmGDt",
  wagon: "vTTTjDoxhV",
  suv: "xsMtZhBkxL",
  taxi: "x43lOScTpN",
  police: "BwwnUrWGmV",
  van: "aT_24cDaW1a",
  truck: "cXw6oiFtZ8",
  pickup: "qn4grQgHm8",
  sports: "1mkmFkAz5v",
  convertible: "dggOiBLYyuR",
  bus: "4CPpvEmrMoF",
  camper: "aT_24cDaW1a",
  roadster: PLAYER_MODEL, // fellow commuters drive the same roadster (recoloured below)
};

/** One InstancedMesh per (kind, material part); matrices refreshed every frame from the NPC list. */
export class NpcRenderer {
  private groups = new Map<
    NpcKind,
    { meshes: THREE.InstancedMesh[]; cap: number; count: number }
  >();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private pos = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private euler = new THREE.Euler();

  constructor(
    private assets: Assets,
    private scene: THREE.Scene,
    private cap = 70,
  ) {}

  private ensure(kind: NpcKind): {
    meshes: THREE.InstancedMesh[];
    cap: number;
    count: number;
  } {
    const g = this.groups.get(kind);
    if (g) return g;
    const model: Model | undefined = this.assets.models.get(KIND_MODEL[kind]);
    const dims = NPC_DIMS[kind];
    const parts = model?.parts.length
      ? model.parts
      : [
          {
            geometry: new THREE.BoxGeometry(
              dims.halfL * 2,
              dims.h,
              dims.halfW * 2,
            ).translate(0, dims.h / 2, 0),
            material: new THREE.MeshStandardMaterial({
              color: 0xf0a52b,
              roughness: 0.7,
            }),
          },
        ];
    // the paint part is the one with the most vertices (as in the player rig)
    let paint = 0;
    parts.forEach((p, i) => {
      if (
        p.geometry.attributes.position.count >
        parts[paint].geometry.attributes.position.count
      )
        paint = i;
    });
    const meshes = parts.map((p, i) => {
      let mat = p.material;
      if (kind === "roadster" && i === paint)
        mat = new THREE.MeshPhysicalMaterial({
          color: 0x2f5fd0,
          roughness: 0.32,
          metalness: 0.15,
          clearcoat: 1,
          clearcoatRoughness: 0.06,
          envMapIntensity: 1.4,
        });
      const im = new THREE.InstancedMesh(p.geometry, mat, this.cap);
      im.castShadow = false;
      im.count = 0;
      im.frustumCulled = false;
      this.scene.add(im);
      return im;
    });
    const ng = { meshes, cap: this.cap, count: 0 };
    this.groups.set(kind, ng);
    return ng;
  }

  /**
   * Create every kind's instanced meshes up front and park one instance far below the ground, so the next render
   * uploads their buffers and compiles their shaders during loading instead of on first sight (100-200 ms hitch).
   * The next sync() resets the counts.
   */
  prewarm(): void {
    const below = new THREE.Matrix4().makeTranslation(0, -500, 0);
    for (const k of Object.keys(KIND_MODEL) as NpcKind[]) {
      const g = this.ensure(k);
      if (!g) continue;
      for (const im of g.meshes) {
        im.setMatrixAt(0, below);
        im.count = 1;
        im.visible = true;
        im.instanceMatrix.needsUpdate = true;
      }
    }
  }

  /**
   * Refill the instances from the NPC list. With a camera position (world x/z), cars farther than `far` metres are
   * left out: the city runs ~200 cars, most of them out of sight, and every copy is a full model.
   */
  sync(
    npcs: readonly NpcPose[],
    ceilingCars?: readonly NpcPose[],
    camX = 0,
    camZ = 0,
    far = Infinity,
  ): void {
    const far2 = far * far;
    for (const g of this.groups.values()) g.count = 0;
    // Read both lists directly; no per-frame concatenated array or counter Map.
    const total = npcs.length + (ceilingCars?.length ?? 0);
    for (let index = 0; index < total; index++) {
      const n =
        index < npcs.length ? npcs[index] : ceilingCars![index - npcs.length];
      if (n.dead) continue;
      const dx = n.x - camX,
        dz = -n.y - camZ;
      if (dx * dx + dz * dz > far2) continue;
      const g = this.ensure(n.kind);
      if (!g) continue;
      const i = g.count;
      if (i >= g.cap) continue;
      g.count++;
      this.pos.set(n.x, n.yOff, -n.y);
      if (n.pitch !== 0 || n.roll !== 0) {
        // model forward = +x in local space: pitch about local z (+ = nose up, so "flip" is a backflip like the
        // player's), roll about local x, then yaw
        this.euler.set(n.roll, n.heading, n.pitch, "YXZ");
        this.q.setFromEuler(this.euler);
      } else this.q.setFromAxisAngle(this.up, n.heading);
      this.m4.compose(this.pos, this.q, this.one);
      for (const im of g.meshes) im.setMatrixAt(i, this.m4);
    }
    for (const g of this.groups.values()) {
      const c = g.count;
      for (const im of g.meshes) {
        im.count = c;
        im.visible = c > 0; // an empty batch still costs a program switch per pass
        im.instanceMatrix.needsUpdate = true;
      }
    }
  }
}
