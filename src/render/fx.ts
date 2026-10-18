// Particle FX: cold-gas thruster puffs, boost exhaust, drift smoke, crash sparks. One Points draw call.
import * as THREE from "three";

const MAX = 2400; // smoke, confetti and the rocket's exhaust share the pool

function spriteTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Particles {
  points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private size = new Float32Array(MAX);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private baseSize = new Float32Array(MAX);
  private drag = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private head = 0;
  private geo: THREE.BufferGeometry;

  constructor() {
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute("size", new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: spriteTexture() } },
      vertexShader: /* glsl */ `attribute float size; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `uniform sampler2D uTex; varying vec3 vC; void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vC, 1.0) * t; }`,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }

  emit(
    p: THREE.Vector3,
    v: THREE.Vector3,
    life: number,
    size: number,
    color: THREE.Color,
    opts: { spread?: number; drag?: number; grav?: number } = {},
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % MAX;
    const sp = opts.spread ?? 0.6;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x + (Math.random() - 0.5) * sp;
    this.vel[i * 3 + 1] = v.y + (Math.random() - 0.5) * sp;
    this.vel[i * 3 + 2] = v.z + (Math.random() - 0.5) * sp;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.baseSize[i] = size;
    this.col[i * 3] = color.r;
    this.col[i * 3 + 1] = color.g;
    this.col[i * 3 + 2] = color.b;
    this.drag[i] = opts.drag ?? 2;
    this.grav[i] = opts.grav ?? 0;
  }

  update(dt: number): void {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) {
        this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.size[i] =
        this.baseSize[i] * (0.6 + 0.8 * (1 - f)) * Math.min(1, f * 4);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

const WHITE = new THREE.Color(0.9, 0.95, 1.0);
// bible: bright jet #FEFFFF core, #5896EB halo — blue-white against the matte warm daylight
const HOT = new THREE.Color(0.98, 1.0, 1.0);
const HOT2 = new THREE.Color(0.35, 0.59, 0.92);
const SMOKE = new THREE.Color(0.5, 0.5, 0.55);
const SPARK = new THREE.Color(1.0, 0.8, 0.3);
// emit() copies components synchronously; these scratch objects never escape a call.
const position = new THREE.Vector3();
const direction = new THREE.Vector3();
const velocity = new THREE.Vector3();
const rotation = new THREE.Matrix4();
const PUFF_OPTS = { spread: 3, drag: 3 };
const GAS_OPTS = { spread: 2, drag: 2.2, grav: -0.4 };
const STREAM_OPTS = { spread: 2.5, drag: 2.2 };
const EXHAUST_OPTS = { spread: 1.2, drag: 1.0 };
const SMOKE_OPTS = { spread: 1.5, drag: 1.5 };
const SPARK_OPTS = { spread: 0, drag: 0.5, grav: 20 };

/** Helper: cold-gas puff burst from a local nozzle position in a given local direction. */
export function puff(
  fx: Particles,
  carMatrix: THREE.Matrix4,
  local: THREE.Vector3,
  dirLocal: THREE.Vector3,
  count = 14,
  speed = 9,
): void {
  const p = position.copy(local).applyMatrix4(carMatrix);
  const rot = rotation.extractRotation(carMatrix);
  const d = direction.copy(dirLocal).applyMatrix4(rot).normalize();
  for (let i = 0; i < count; i++)
    fx.emit(
      p,
      velocity.copy(d).multiplyScalar(speed * (0.6 + Math.random() * 0.6)),
      0.3 + Math.random() * 0.25,
      0.5 + Math.random() * 0.4,
      WHITE,
      PUFF_OPTS,
    );
}

const GAS = new THREE.Color(0.55, 0.6, 0.68);

/** Cold-gas cloud at ground level under the car (launch / touchdown): big slow puffs rolling outward. */
export function gasCloud(
  fx: Particles,
  center: THREE.Vector3,
  count = 60,
  radius = 2.2,
  strength = 1,
): void {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = radius * (0.3 + Math.random() * 0.7);
    const p = position.set(
      center.x + Math.cos(a) * r,
      center.y + 0.3 + Math.random() * 0.5,
      center.z + Math.sin(a) * r,
    );
    const v = velocity.set(
      Math.cos(a) * (5 + Math.random() * 7) * strength,
      1.5 + Math.random() * 2.5,
      Math.sin(a) * (5 + Math.random() * 7) * strength,
    );
    fx.emit(
      p,
      v,
      1.1 + Math.random() * 1.2,
      1.6 + Math.random() * 2.2,
      GAS,
      GAS_OPTS,
    );
  }
}

/** Continuous thruster stream from local nozzles along a local direction (the fan-shaped plumes of the demo). */
export function thrusterStream(
  fx: Particles,
  carMatrix: THREE.Matrix4,
  nozzles: THREE.Vector3[],
  dirLocal: THREE.Vector3,
  intensity: number,
): void {
  const rot = rotation.extractRotation(carMatrix);
  const d = direction.copy(dirLocal).applyMatrix4(rot).normalize();
  for (const n of nozzles) {
    const p = position.copy(n).applyMatrix4(carMatrix);
    for (let i = 0; i < intensity; i++)
      fx.emit(
        p,
        velocity.copy(d).multiplyScalar(16 + Math.random() * 10),
        0.35 + Math.random() * 0.3,
        0.45 + Math.random() * 0.5,
        Math.random() < 0.5 ? HOT : WHITE,
        STREAM_OPTS,
      );
  }
}

export function exhaust(
  fx: Particles,
  carMatrix: THREE.Matrix4,
  nozzles: THREE.Vector3[],
  intensity: number,
): void {
  const rot = rotation.extractRotation(carMatrix);
  const back = direction.set(-1, 0, 0).applyMatrix4(rot);
  for (const n of nozzles) {
    const p = position.copy(n).applyMatrix4(carMatrix);
    for (let i = 0; i < intensity; i++)
      fx.emit(
        p,
        velocity.copy(back).multiplyScalar(26 + Math.random() * 14),
        0.08 + Math.random() * 0.08,
        0.25 + Math.random() * 0.2,
        Math.random() < 0.4 ? HOT : HOT2,
        EXHAUST_OPTS,
      );
  }
}

export function driftSmoke(fx: Particles, carMatrix: THREE.Matrix4): void {
  const rot = rotation.extractRotation(carMatrix);
  for (let side = -1; side <= 1; side += 2) {
    const p = position.set(-1.4, 0.2, side * 0.9).applyMatrix4(carMatrix);
    const up = velocity.set(-0.5, 1, 0).applyMatrix4(rot);
    fx.emit(
      p,
      up.multiplyScalar(2),
      0.7 + Math.random() * 0.4,
      1.0 + Math.random() * 0.6,
      SMOKE,
      SMOKE_OPTS,
    );
  }
}

export function sparks(fx: Particles, p: THREE.Vector3, count = 40): void {
  for (let i = 0; i < count; i++)
    fx.emit(
      p,
      velocity.set(
        (Math.random() - 0.5) * 16,
        Math.random() * 10,
        (Math.random() - 0.5) * 16,
      ),
      0.5 + Math.random() * 0.6,
      0.3,
      SPARK,
      SPARK_OPTS,
    );
}
