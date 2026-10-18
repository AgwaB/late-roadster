// Chase camera: follows behind (stays level, also on the ceiling), orbits during crash replay, shakes on boost.
import * as THREE from "three";
import type { Car } from "../game/physics";

const Y = new THREE.Vector3(0, 1, 0);
const smooth01 = (k: number) => {
  const q = Math.min(1, Math.max(0, k));
  return q * q * (3 - 2 * q);
};

export class ChaseCam {
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private side = new THREE.Vector3();
  private targetPos = new THREE.Vector3();
  private targetLook = new THREE.Vector3();
  private shake = new THREE.Vector3();
  private orbit = 0;
  private init = false;

  constructor(private camera: THREE.PerspectiveCamera) {}

  reset(): void {
    this.init = false;
  }

  update(
    dt: number,
    carPos: THREE.Vector3,
    heading: number,
    car: Car,
    maxY = Infinity,
    /** ground height under the car (road, skyway deck, toll canopy roof) */
    groundH = 0,
  ): void {
    const fwd = this.fwd.set(Math.cos(heading), 0, -Math.sin(heading));
    const targetPos = this.targetPos.copy(carPos);
    const targetLook = this.targetLook.copy(carPos);
    if (car.state === "crash") {
      this.orbit += dt * 1.1;
      targetPos.x += Math.cos(this.orbit) * 9;
      targetPos.y += 3.2;
      targetPos.z += Math.sin(this.orbit) * 9;
      targetLook.y += 0.8;
    } else if (car.wall) {
      // riding the event ramp: hang back low at the foot and look up the wall at the car
      this.orbit = Math.atan2(-fwd.z, -fwd.x);
      targetPos.addScaledVector(fwd, -9 - car.h * 0.35);
      targetPos.y = groundH + 2.6 + car.h * 0.35;
      targetLook.y += 0.5;
    } else {
      this.orbit = Math.atan2(-fwd.z, -fwd.x);
      const side = this.side.crossVectors(fwd, Y).normalize();
      const speedK = Math.min(1.6, Math.abs(car.v) / 40);
      // the ceiling view (below the car) eases in with the half roll, so the rise itself is filmed from above
      const over = car.ceiling ? Math.min(1, Math.abs(car.roll) / Math.PI) : 0;
      const lift = 3.1 - 4.9 * over;
      // on a hop the camera climbs only part of the way, so the car visibly soars up the frame (not during a skyway
      // climb: the camera rides up with the car, or the deck would block the view). In real flight, high above the
      // road, it rises over the car instead and tilts down, so the road and what is below stay in view.
      const air = !(car.grounded || car.ceiling || car.shift);
      const alt = air ? Math.max(0, car.h - groundH) : 0;
      const high = smooth01((alt - 3) / 6); // 0 up to 3 m, 1 from 9 m
      const airDrop = Math.min(alt, 2.5) * 0.55 * (1 - high);
      targetPos
        .addScaledVector(fwd, -8.5 - 0.4 * speedK - 3.5 * high) // bible: boost pullback ≤ 0.5 m, the car stays the anchor
        .addScaledVector(Y, lift - airDrop + 4.5 * high);
      // lead the look target into drifts so the car slides across the frame
      targetLook
        .addScaledVector(fwd, 8 + 6 * high)
        .addScaledVector(side, -car.yawVis * 3)
        .addScaledVector(Y, 0.8 - 1.3 * over - high * Math.min(alt, 14) * 0.75);
    }
    targetPos.y = Math.min(targetPos.y, maxY);
    const k = this.init
      ? 1 - Math.exp(-(car.state === "crash" ? 4 : 7) * dt)
      : 1;
    this.init = true;
    this.pos.lerp(targetPos, k);
    this.look.lerp(targetLook, k);
    this.camera.position.copy(this.pos);
    if (car.boosting)
      this.camera.position.add(
        this.shake.set(
          (Math.random() - 0.5) * 0.25,
          (Math.random() - 0.5) * 0.25,
          (Math.random() - 0.5) * 0.25,
        ),
      );
    this.camera.up.lerp(Y, k).normalize();
    this.camera.lookAt(this.look);
    const fov =
      car.state === "crash"
        ? 55
        : 53 +
          Math.min(4, Math.max(0, Math.abs(car.v) - 42) * 0.15) +
          (car.boosting ? 4 : 0); // punch capped at +8°
    this.camera.fov += (fov - this.camera.fov) * Math.min(1, 6 * dt);
    this.camera.updateProjectionMatrix();
  }
}
