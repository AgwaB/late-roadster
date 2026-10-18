// Event hazards (scooter swarm, cargo crates, runaway wheel, wire poles + cable), ambulance beacon, rain streaks.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Hazard, Wire } from "../game/session";
import type { Npc } from "../game/traffic";

const CAP = 48;
const CRATE_FLAT = [0xa8865a, 0x3f8f3a, 0xf2c744];

function scooterGeometry(): THREE.BufferGeometry {
  const deck = new THREE.BoxGeometry(1.1, 0.08, 0.28).translate(0.05, 0.22, 0);
  const post = new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6).translate(
    0.55,
    0.72,
    0,
  );
  const bar = new THREE.BoxGeometry(0.05, 0.05, 0.5).translate(0.55, 1.22, 0);
  const w1 = new THREE.CylinderGeometry(0.14, 0.14, 0.06, 10)
    .rotateX(Math.PI / 2)
    .translate(0.58, 0.14, 0);
  const w2 = w1.clone().translate(-1.1, 0, 0);
  // rider: legs, torso, head (no helmet, as the SPEC insists)
  const legs = new THREE.BoxGeometry(0.22, 0.6, 0.24).translate(-0.05, 0.56, 0);
  const torso = new THREE.BoxGeometry(0.26, 0.55, 0.36).translate(
    -0.02,
    1.14,
    0,
  );
  const arms = new THREE.BoxGeometry(0.55, 0.07, 0.07).translate(0.26, 1.28, 0);
  const head = new THREE.SphereGeometry(0.13, 8, 6).translate(0, 1.56, 0);
  return mergeGeometries(
    [deck, post, bar, w1, w2, legs, torso, arms, head],
    false,
  )!;
}

/** a road bike with its rider, forward +x, ground y = 0: the dark parts (bike, legs, helmet) and the jersey separately */
function cyclistGeometry(): {
  dark: THREE.BufferGeometry;
  jersey: THREE.BufferGeometry;
} {
  const tube = (x0: number, y0: number, x1: number, y1: number, t = 0.035) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    return new THREE.BoxGeometry(len, t, t)
      .rotateZ(Math.atan2(y1 - y0, x1 - x0))
      .translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
  };
  const wheel = (x: number) =>
    new THREE.TorusGeometry(0.34, 0.025, 6, 22).translate(x, 0.34, 0);
  const dark = mergeGeometries(
    [
      wheel(0.52),
      wheel(-0.52),
      tube(-0.32, 0.36, 0.1, 0.92), // seat tube
      tube(0.1, 0.92, 0.48, 0.86), // top tube
      tube(0.48, 0.86, 0.52, 0.34), // head tube / fork
      tube(0.1, 0.34, 0.48, 0.86), // down tube
      tube(-0.52, 0.34, 0.1, 0.34), // chain stay
      tube(-0.52, 0.34, -0.32, 0.92), // seat stay
      new THREE.BoxGeometry(0.04, 0.04, 0.42).translate(0.52, 0.98, 0), // bars
      new THREE.BoxGeometry(0.24, 0.05, 0.11).translate(-0.3, 1.0, 0), // saddle
      // legs (one down, one up) and helmet
      new THREE.BoxGeometry(0.1, 0.5, 0.1)
        .rotateZ(0.35)
        .translate(-0.05, 0.62, 0.11),
      new THREE.BoxGeometry(0.1, 0.5, 0.1)
        .rotateZ(-0.35)
        .translate(-0.12, 0.68, -0.11),
      new THREE.SphereGeometry(0.14, 10, 8).translate(0.42, 1.44, 0),
    ].map((g) => (g.index ? g.toNonIndexed() : g)),
    false,
  )!;
  const jersey = mergeGeometries(
    [
      // torso leaning onto the bars, two arms down to them
      new THREE.BoxGeometry(0.62, 0.26, 0.34)
        .rotateZ(-0.55)
        .translate(0.08, 1.22, 0),
      new THREE.BoxGeometry(0.4, 0.07, 0.07)
        .rotateZ(-0.9)
        .translate(0.4, 1.12, 0.17),
      new THREE.BoxGeometry(0.4, 0.07, 0.07)
        .rotateZ(-0.9)
        .translate(0.4, 1.12, -0.17),
    ].map((g) => (g.index ? g.toNonIndexed() : g)),
    false,
  )!;
  return { dark, jersey };
}
const JERSEYS = [0xe4572e, 0x2f6fde, 0xc8e23a, 0x8a3ffc, 0xf2f2f2];

export class HazardRenderer {
  private bikes: THREE.InstancedMesh;
  private jerseys: THREE.InstancedMesh;
  private scooters: THREE.InstancedMesh;
  private crates: THREE.InstancedMesh;
  private wheels: THREE.InstancedMesh;
  private poles: THREE.InstancedMesh;
  private wireLines: THREE.LineSegments;
  private wirePos: Float32Array;
  private beacons: THREE.InstancedMesh;
  private beaconMat: THREE.MeshBasicMaterial;
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private rainVis = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private col = new THREE.Color();

  /** round-3 scooter riders S_02..S_07 (first three seen from behind, last three from the front) */
  private riders: THREE.InstancedMesh[] = [];
  /** round-5 cyclists: BK_R1..5 from behind, then BK_F1..5 from the front (one per jersey colour) */
  private cyclers: THREE.InstancedMesh[] = [];
  private cyclerN = new Array(10).fill(0);
  /** per-variant crate colour (a tint over the cardboard photo, or flat colours without it) */
  private crateTints: number[] = CRATE_FLAT;
  private riderN = [0, 0, 0, 0, 0, 0];

  constructor(
    scene: THREE.Scene,
    tex?: (name: string) => THREE.Texture | undefined,
  ) {
    const wheelFace = tex?.("R_06W");
    const mk = (g: THREE.BufferGeometry, m: THREE.Material) => {
      const im = new THREE.InstancedMesh(g, m, CAP);
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = true;
      scene.add(im);
      return im;
    };
    this.scooters = mk(
      scooterGeometry(),
      new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.2 }),
    );
    const cg = cyclistGeometry();
    this.bikes = mk(
      cg.dark,
      new THREE.MeshStandardMaterial({
        color: 0x1c1e24,
        roughness: 0.55,
        metalness: 0.4,
      }),
    );
    this.jerseys = mk(
      cg.jersey,
      new THREE.MeshStandardMaterial({ roughness: 0.8 }),
    );
    // camera-facing photo cut-outs of riders on their scooters (fallback: the box riders above)
    const sTex = [2, 3, 4, 5, 6, 7].map((i) => tex?.("S_0" + i));
    if (sTex.every((t) => t && (t.image as { width?: number })?.width))
      for (const t of sTex as THREE.Texture[]) {
        const img = t.image as { width: number; height: number };
        const h = 1.85,
          w = (h * img.width) / img.height;
        const im = new THREE.InstancedMesh(
          new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0),
          new THREE.MeshStandardMaterial({
            map: t,
            alphaTest: 0.5,
            side: THREE.DoubleSide,
            roughness: 0.8,
          }),
          CAP,
        );
        im.count = 0;
        im.frustumCulled = false;
        scene.add(im);
        this.riders.push(im);
      }
    // camera-facing photo cut-outs of the cycling club (fallback: the low-poly bikes above)
    const bTex = ["R", "F"].flatMap((v) =>
      [1, 2, 3, 4, 5].map((i) => tex?.("BK_" + v + i)),
    );
    if (bTex.every((t) => t && (t.image as { width?: number })?.width))
      for (const t of bTex as THREE.Texture[]) {
        const img = t.image as { width: number; height: number };
        const h = 1.78,
          w = (h * img.width) / img.height;
        const im = new THREE.InstancedMesh(
          new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0),
          new THREE.MeshStandardMaterial({
            map: t,
            alphaTest: 0.5,
            side: THREE.DoubleSide,
            roughness: 0.8,
          }),
          CAP,
        );
        im.count = 0;
        im.frustumCulled = false;
        scene.add(im);
        this.cyclers.push(im);
      }
    // spilled cargo: cardboard boxes (round-4 CR_01 face on every side)
    const box = tex?.("CR_01");
    this.crates = mk(
      new THREE.BoxGeometry(1, 0.95, 1).translate(0, 0.475, 0),
      new THREE.MeshStandardMaterial({ map: box ?? null, roughness: 0.9 }),
    );
    this.crateTints = box ? [0xffffff, 0xe6dccb, 0xf4ead2] : CRATE_FLAT;
    // runaway wheel: tyre on the side, the roadster's 5-spoke rim (R_06) on both faces
    const tyre = new THREE.MeshStandardMaterial({
      color: 0x15161a,
      roughness: 0.85,
    });
    const rim = wheelFace
      ? new THREE.MeshStandardMaterial({
          map: wheelFace,
          roughness: 0.45,
          metalness: 0.3,
        })
      : tyre;
    this.wheels = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.36, 0.36, 0.26, 20).rotateX(Math.PI / 2),
      [tyre, rim, rim],
      CAP,
    );
    this.wheels.count = 0;
    this.wheels.frustumCulled = false;
    this.wheels.castShadow = true;
    scene.add(this.wheels);
    this.poles = mk(
      mergeGeometries(
        [
          new THREE.CylinderGeometry(0.09, 0.11, 6, 8).translate(0, 3, 0),
          new THREE.CylinderGeometry(0.45, 0.5, 0.25, 10).translate(0, 0.12, 0),
        ],
        false,
      )!,
      new THREE.MeshStandardMaterial({
        color: 0xd8c24a,
        roughness: 0.6,
        metalness: 0.3,
      }),
    );
    this.wirePos = new Float32Array(8 * 12 * 2 * 3);
    const wg = new THREE.BufferGeometry();
    wg.setAttribute("position", new THREE.BufferAttribute(this.wirePos, 3));
    wg.setDrawRange(0, 0);
    this.wireLines = new THREE.LineSegments(
      wg,
      new THREE.LineBasicMaterial({ color: 0x1a1a1e }),
    );
    this.wireLines.frustumCulled = false;
    scene.add(this.wireLines);
    this.beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    this.beacons = mk(
      new THREE.BoxGeometry(0.9, 0.22, 0.5).translate(-0.3, 2.42, 0),
      this.beaconMat,
    );
    this.beacons.castShadow = false;
    // rain: 600 short streaks in a box around the camera, recycled downward
    const N = 1600;
    this.rainPos = new Float32Array(N * 2 * 3);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 60,
        y = Math.random() * 25,
        z = (Math.random() - 0.5) * 60;
      this.rainPos.set([x, y, z, x + 0.2, y + 2.2, z], i * 6);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(
      rg,
      new THREE.LineBasicMaterial({
        color: 0xdfe8f0,
        transparent: true,
        opacity: 0,
      }),
    );
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
  }

  update(
    hazards: Hazard[],
    wires: Wire[],
    npcs: Npc[],
    rain01: number,
    camX: number,
    camZ: number,
    t: number,
    dt: number,
  ): void {
    let ns = 0,
      nc = 0,
      nw = 0,
      np = 0,
      nk = 0;
    for (const h of hazards) {
      this.p.set(h.x, 0, -h.y);
      if (h.kind === "cyclist" && this.cyclers.length) {
        // billboard about the vertical axis, a gentle bob with the pedal stroke; the back of the rider when the
        // pack rides away from the camera (as it does in front of the player), the front when it comes towards it
        const dx = camX - this.p.x,
          dz = camZ - this.p.z;
        const toward = Math.cos(h.heading) * dx - Math.sin(h.heading) * dz > 0;
        const k = (Math.abs(h.variant) % 5) + (toward ? 5 : 0);
        if (this.cyclerN[k] < CAP) {
          this.q.setFromAxisAngle(UP, Math.atan2(dx, dz));
          if (h.hit) {
            // knocked flying: tumble about the view axis around the rider's middle, then lie on its side
            const roll = h.roll ?? 0;
            this.q.multiply(this.q2.setFromAxisAngle(FWD, roll));
            const mid =
              (h.z ?? 0) +
              0.89 * Math.abs(Math.cos(roll)) +
              0.3 * Math.abs(Math.sin(roll));
            this.v.set(0, 0.89, 0).applyQuaternion(this.q);
            this.p.set(h.x - this.v.x, mid - this.v.y, -h.y - this.v.z);
          } else this.p.y = 0.025 * Math.abs(Math.sin(h.phase * 5));
          this.m4.compose(this.p, this.q, this.s);
          this.cyclers[k].setMatrixAt(this.cyclerN[k]++, this.m4);
        }
      } else if (h.kind === "cyclist") {
        if (nk >= CAP) continue;
        // a little bob and lean with the pedal stroke (knocked: flying and rolling over)
        this.p.y = h.hit ? (h.z ?? 0) : 0.02 * Math.sin(h.phase * 6);
        this.e.set(
          h.hit ? (h.roll ?? 0) : 0.06 * Math.sin(h.phase * 3),
          h.heading,
          0,
          "YXZ",
        );
        this.q.setFromEuler(this.e);
        this.m4.compose(this.p, this.q, this.s);
        this.bikes.setMatrixAt(nk, this.m4);
        this.jerseys.setMatrixAt(nk, this.m4);
        this.jerseys.setColorAt(
          nk,
          this.col.set(JERSEYS[h.variant % JERSEYS.length]),
        );
        nk++;
      } else if (h.kind === "scooter" && this.riders.length) {
        // billboard about the vertical axis; front view when riding towards the camera; the photos ride
        // towards screen-left, so mirror when the scooter moves screen-right
        const dx = camX - this.p.x,
          dz = camZ - this.p.z;
        const yaw = Math.atan2(dx, dz);
        const vx = Math.cos(h.heading),
          vz = -Math.sin(h.heading);
        const toward = vx * dx + vz * dz > 0;
        const right = vx * Math.cos(yaw) - vz * Math.sin(yaw) > 0;
        const k = (Math.abs(h.variant) % 3) + (toward ? 3 : 0);
        if (this.riderN[k] < CAP) {
          this.q.setFromAxisAngle(UP, yaw);
          if (h.hit) {
            // knocked flying, as the cyclists: tumble about the view axis around the middle, then lie down
            const roll = h.roll ?? 0;
            this.q.multiply(this.q2.setFromAxisAngle(FWD, roll));
            const mid =
              (h.z ?? 0) +
              0.92 * Math.abs(Math.cos(roll)) +
              0.3 * Math.abs(Math.sin(roll));
            this.v.set(0, 0.92, 0).applyQuaternion(this.q);
            this.p.set(h.x - this.v.x, mid - this.v.y, -h.y - this.v.z);
          }
          this.s.set(right ? -1 : 1, 1, 1);
          this.m4.compose(this.p, this.q, this.s);
          this.s.set(1, 1, 1);
          this.riders[k].setMatrixAt(this.riderN[k]++, this.m4);
        }
      } else if (h.kind === "scooter" && ns < CAP) {
        if (h.hit) this.p.y = h.z ?? 0;
        this.e.set(h.hit ? (h.roll ?? 0) : 0, h.heading, 0, "YXZ");
        this.q.setFromEuler(this.e);
        this.m4.compose(this.p, this.q, this.s);
        this.scooters.setMatrixAt(ns, this.m4);
        this.scooters.setColorAt(
          ns,
          this.col.setHSL((h.variant * 0.21) % 1, 0.6, 0.5),
        );
        ns++;
      } else if (h.kind === "crate" && nc < CAP) {
        this.q.setFromAxisAngle(UP, h.heading);
        this.s.setScalar(h.h > 0 ? 1 : 0.85);
        this.m4.compose(this.p, this.q, this.s);
        this.s.setScalar(1);
        this.crates.setMatrixAt(nc, this.m4);
        this.crates.setColorAt(
          nc,
          this.col.set(this.crateTints[h.variant % 3]),
        );
        nc++;
      } else if (h.kind === "wheel" && nw < CAP) {
        this.p.y = 0.35;
        this.e.set(0, h.heading, -h.phase, "YXZ");
        this.q.setFromEuler(this.e);
        this.m4.compose(this.p, this.q, this.s);
        this.wheels.setMatrixAt(nw, this.m4);
        nw++;
      } else if (h.kind === "wirepole" && np < CAP) {
        this.q.identity();
        this.m4.compose(this.p, this.q, this.s);
        this.poles.setMatrixAt(np, this.m4);
        np++;
      }
    }
    const fin = (im: THREE.InstancedMesh, n: number, colour: boolean) => {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (colour && im.instanceColor) im.instanceColor.needsUpdate = true;
    };
    fin(this.scooters, ns, true);
    this.riders.forEach((im, k) => {
      fin(im, this.riderN[k], false);
      this.riderN[k] = 0;
    });
    this.cyclers.forEach((im, k) => {
      fin(im, this.cyclerN[k], false);
      this.cyclerN[k] = 0;
    });
    fin(this.crates, nc, true);
    fin(this.bikes, nk, false);
    fin(this.jerseys, nk, true);
    fin(this.wheels, nw, false);
    fin(this.poles, np, false);
    // cables: 12 sagging segments per wire
    let k = 0;
    for (const w of wires.slice(0, 8)) {
      for (let i = 0; i < 12; i++) {
        const t0 = i / 12,
          t1 = (i + 1) / 12;
        const sag = (u: number) => w.h + 0.2 - 0.5 * 4 * u * (1 - u);
        this.wirePos.set(
          [
            w.ax + (w.bx - w.ax) * t0,
            sag(t0),
            -(w.ay + (w.by - w.ay) * t0),
            w.ax + (w.bx - w.ax) * t1,
            sag(t1),
            -(w.ay + (w.by - w.ay) * t1),
          ],
          k,
        );
        k += 6;
      }
    }
    this.wireLines.geometry.setDrawRange(0, k / 3);
    (
      this.wireLines.geometry.attributes.position as THREE.BufferAttribute
    ).needsUpdate = true;
    // ambulance beacons (flashing)
    let nb = 0;
    for (const n of npcs) {
      if (n.dead || n.behavior !== "ambulance" || nb >= CAP) continue;
      this.p.set(n.x, n.yOff, -n.y);
      this.q.setFromAxisAngle(UP, n.heading);
      this.m4.compose(this.p, this.q, this.s);
      this.beacons.setMatrixAt(nb++, this.m4);
    }
    this.beacons.count = nb;
    this.beacons.instanceMatrix.needsUpdate = true;
    if (nb)
      this.beaconMat.color.set(Math.floor(t * 6) % 2 ? 0xff2020 : 0x2060ff);
    // rain
    this.rainVis += (rain01 - this.rainVis) * Math.min(1, dt * 2);
    this.rain.visible = this.rainVis > 0.02;
    if (this.rain.visible) {
      (this.rain.material as THREE.LineBasicMaterial).opacity =
        0.7 * this.rainVis;
      const fall = 26 * dt;
      for (let i = 0; i < this.rainPos.length; i += 6) {
        let y = this.rainPos[i + 1] - fall;
        if (y < -1) {
          y += 25;
          this.rainPos[i] = camX + (Math.random() - 0.5) * 60;
          this.rainPos[i + 2] = camZ + (Math.random() - 0.5) * 60;
          this.rainPos[i + 3] = this.rainPos[i] + 0.2;
          this.rainPos[i + 5] = this.rainPos[i + 2];
        }
        this.rainPos[i + 1] = y;
        this.rainPos[i + 4] = y + 2.2;
      }
      (
        this.rain.geometry.attributes.position as THREE.BufferAttribute
      ).needsUpdate = true;
    }
  }
}
const UP = new THREE.Vector3(0, 1, 0);
/** a billboard's own facing axis (its roll axis) */
const FWD = new THREE.Vector3(0, 0, 1);
