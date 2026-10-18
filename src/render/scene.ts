// Renderer, bright-morning lighting (HDRI sky + sun shadows), light bloom post-processing.
import * as THREE from "three";
import { skyTexture } from "./procTex";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { N8AOPass } from "n8ao";

export interface SceneKit {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  render(): void;
  /** feed the frame delta each frame; steps quality down when the frame time stays high */
  adapt(dt: number): void;
  readonly level: number;
  follow(x: number, z: number): void;
  setInterior(k: number, dt: number): void;
  setSky(hdr: THREE.DataTexture | null, bg: THREE.Texture | null): void;
  quality: "high" | "low";
}

export function createScene(canvas: HTMLCanvasElement): SceneKit {
  const quality: "high" | "low" = matchMedia("(pointer: coarse)").matches
    ? "low"
    : "high";
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: quality === "low",
    powerPreference: "high-performance",
  });
  // 1.25 on desktop: the 2000s-racer look does not need retina crispness and bloom/shadows scale with pixels
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, quality === "high" ? 1.25 : 1.0),
  );
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = quality === "high";
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = skyTexture();
  scene.backgroundIntensity = 1.0;
  scene.fog = new THREE.Fog("#D9E3DF", 220, 800);
  const camera = new THREE.PerspectiveCamera(53, 1, 0.5, 2600); // far enough for the rim skyline panels

  const hemi = new THREE.HemisphereLight("#CCDDF1", "#786E50", 1.3);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#FFF2D7", 2.6);
  // matches the sun in the HDRI (u 0.595, v 0.766): azimuth 34° from +x toward +z, elevation 48°
  const SUN_DIR = new THREE.Vector3(0.553, 0.743, 0.376).normalize();
  sun.position.copy(SUN_DIR).multiplyScalar(300);
  sun.castShadow = quality === "high";
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 700;
  const S = 70;
  sun.shadow.camera.left = -S;
  sun.shadow.camera.right = S;
  sun.shadow.camera.top = S;
  sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.08;
  scene.add(sun, sun.target);

  let interior = 0;
  const composer = new EffectComposer(renderer);
  // Beauty: N8AO (screen-space AO, half-res) renders the scene itself; the plain RenderPass is the fallback
  // when AO is switched off by the adaptive quality ladder.
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const ao = new N8AOPass(scene, camera, 1, 1);
  ao.configuration.halfRes = true;
  ao.configuration.aoRadius = 2.2;
  ao.configuration.distanceFalloff = 0.6;
  ao.configuration.intensity = 2.6;
  ao.configuration.gammaCorrection = false;
  ao.configuration.color = new THREE.Color(0x1c1a16);
  ao.setQualityMode("Low");
  composer.addPass(ao);
  renderPass.enabled = quality !== "high";
  ao.enabled = quality === "high";
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.18, 0.2, 0.995); // only clipped highlights (jet core, sun glints) bloom; sky/clouds stay matte
  // half-resolution bloom targets: a soft glow does not need full-res blur chains
  const bloomSetSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w: number, h: number) =>
    bloomSetSize(Math.ceil(w / 2), Math.ceil(h / 2));
  if (quality === "high") composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // post-AA (the composer target has no MSAA): SMAA in display space
  const smaa = new SMAAPass(1, 1);
  composer.addPass(smaa);

  let level = 0;
  let displayDpr = window.devicePixelRatio;
  const resize = () => {
    displayDpr = window.devicePixelRatio;
    const maxDpr = quality === "high" && level === 0 ? 1.25 : 1;
    const dpr = Math.min(displayDpr, maxDpr);
    if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
    composer.setPixelRatio(renderer.getPixelRatio());
    const w = canvas.clientWidth || window.innerWidth,
      h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();

  // Adaptive quality: if frames stay slow, step down (pixel ratio -> bloom -> shadows) instead of lagging.
  let ema = 16.7,
    slowFor = 0,
    fastFor = 0,
    age = 0;
  const applyLevel = () => {
    bloom.enabled = quality === "high" && level < 2;
    const aoOn = quality === "high" && level < 2;
    ao.enabled = aoOn;
    renderPass.enabled = !aoOn;
    const sh = quality === "high" && level < 3;
    if (renderer.shadowMap.enabled !== sh) {
      renderer.shadowMap.enabled = sh;
      sun.castShadow = sh;
      scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m) m.needsUpdate = true;
      });
    }
    resize();
  };
  const adapt = (dt: number) => {
    if (displayDpr !== window.devicePixelRatio) resize();
    age += dt;
    if (age < 8) return; // load-time compile/upload hitches must not trigger a downgrade
    const ms = Math.min(40, dt * 1000); // single hitches are capped; only sustained slowness moves the EMA
    ema += (ms - ema) * 0.1;
    if (ema > 22) {
      slowFor += dt;
      fastFor = 0;
    } else if (ema < 13) {
      fastFor += dt;
      slowFor = 0;
    } else {
      slowFor = 0;
      fastFor = 0;
    }
    if (slowFor > 2.5 && level < 3) {
      level++;
      slowFor = 0;
      applyLevel();
    } else if (fastFor > 20 && level > 0) {
      level--;
      fastFor = 0;
      applyLevel();
    }
  };

  const pmrem = new THREE.PMREMGenerator(renderer);
  return {
    renderer,
    scene,
    camera,
    sun,
    quality,
    adapt,
    get level() {
      return level;
    },
    render() {
      composer.render();
    },
    follow(x, z) {
      sun.target.position.set(x, 0, z);
      sun.position.set(x, 0, z).addScaledVector(SUN_DIR, 300);
    },
    /** 0 = outdoors, 1 = inside the tunnel: fill drops to ~30 % over a few frames (bible: 20-35 %, 0.3-0.6 s). */
    setInterior(k, dt) {
      interior += (k - interior) * Math.min(1, dt * 5);
      hemi.intensity = 1.3 * (1 - 0.68 * interior);
      sun.intensity = 2.6 * (1 - 0.5 * interior);
    },
    setSky(hdr, bg) {
      if (bg) {
        // photo sky (Poly Haven kloofendal_48d_partly_cloudy, CC0): the single biggest realism cue in the frame
        scene.background = bg;
        scene.backgroundIntensity = 1.0;
      }
      if (!hdr) return;
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const env = pmrem.fromEquirectangular(hdr).texture;
      scene.environment = env;
      scene.environmentIntensity = 0.75; // IBL now supplies most of the ambient; the hemisphere light is only a fill
      hemi.intensity = 0.45;
    },
  };
}
