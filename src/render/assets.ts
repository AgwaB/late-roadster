// Kenney CC0 GLB assets: load, bake to single geometries for instancing, keep rigged copies for the player car.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import {
  mergeGeometries,
  toCreasedNormals,
} from "three/addons/utils/BufferGeometryUtils.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { MODELS, type ModelSpec } from "./manifest";
import { signAtlasTexture } from "./procTex";

const CAR_SCALE = 1.75; // Kenney car kit units -> meters
// only the traffic cone is still used from the Kenney car kit (vehicles are Poly Pizza models now); the other
// kit GLBs stay in public/assets/cars but are no longer downloaded at start-up
const CAR_MODELS = ["cone-flat"];
/** round-4 Blender models kept as raw glTF scenes (their origins are rig pivots: booster ground centre, leg hinge,
 * cart wheel-footprint centre), loaded from public/assets/gen */
const RAW_GEN = ["booster_r4", "booster_leg_r4", "cart_r4"];
const BUILDING_MODELS = [
  "building-a",
  "building-b",
  "building-c",
  "building-d",
  "building-e",
  "building-f",
  "building-g",
  "building-h",
  "building-i",
  "building-j",
  "building-k",
  "building-l",
  "building-m",
  "building-n",
  "building-skyscraper-a",
  "building-skyscraper-b",
  "building-skyscraper-c",
  "building-skyscraper-d",
  "building-skyscraper-e",
];

export interface Baked {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}
const FACADES = [
  "Facade001",
  "Facade002",
  "Facade003",
  "Facade005",
  "Facade006",
  "Facade009",
  "Facade010",
  "Facade012",
  "Facade018A",
  "Facade020A",
];
/** Generated photo textures (public/assets/photo): facades, upper-floor modules, shop strips, skyline, adverts, roofs, noise walls. */
const PHOTO_TEX = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => "A_0" + i),
  "B_01",
  "B_02",
  "B_03",
  "C_01",
  "C_02",
  "C_03",
  "C_04",
  ...[1, 2, 3, 4, 5, 6].map((i) => "E_0" + i),
  "F_01",
  "F_02",
  "G_01",
  "G_02",
  // round 2: varied facades, blank side walls, tower modules, barrier blocks, bus-shelter posters
  ...[1, 2, 3, 4, 5, 6].map((i) => "A2_0" + i),
  "H_01",
  "H_02",
  "H_03",
  ...[1, 2, 3, 4].map((i) => "I_0" + i),
  ...[1, 2, 3, 4].map((i) => "J_0" + i),
  "L_01",
  "L_02",
  "L_03",
  // round 3: HQ / villa facades (photo: materials), tileable bridge steel, embankment, road plates
  "O_01",
  "O_03",
  "O_04",
  "HM_01",
  "HM_02",
  "BR_02",
  "BR_04",
  "CZ_05",
];
/** webp with alpha: D skylines (sky keyed), K pedestrian cut-outs (background keyed); used on plain planes */
const PHOTO_ALPHA = [
  "D_01",
  "D_02",
  "D_03",
  ...[1, 2, 3, 4, 5, 6].map((i) => "K_0" + i),
  // round 3 (tools/r3_textures.py): meme road signs, tunnel portal (mouth keyed), underside sticker, wheel face
  ...[1, 2, 3, 4, 5, 6].map((i) => "MS_0" + i),
  "TN_01",
  "R08S",
  "R_06W",
  // scooter riders (S_02-04 from behind, S_05-07 from the front) and late office workers (tools/r3_cutouts.py)
  ...[2, 3, 4, 5, 6, 7].map((i) => "S_0" + i),
  "K2_01",
  "K2_02",
  "K2_03",
  // round 4: impact holes, pothole, landing pad (alpha; tools/r4_textures_alpha.py) and opaque plane textures for
  // the tunnel ceiling/walls, ORBIT MART front and cargo boxes (tools/r4_textures_tiles.py)
  "WR_01",
  "WR_02",
  "PH_01",
  "LP_01",
  "TC_01",
  "TW_01",
  "MT_01",
  "CR_01",
];

const SURFACES = [
  "Asphalt033",
  "PavingStones138",
  "Concrete034",
  "Grass004",
  // building cladding for the Blender commercial buildings (ambientCG, pre-tiled 3x)
  "Tiles143",
  "Bricks059",
  "Tiles140",
];
/** A third-party model baked to material groups, normalized: forward = +x, centred on x/z, min y = 0, scaled to spec. */
export interface Model {
  parts: Baked[];
  size: THREE.Vector3;
  spec: ModelSpec;
  body?: { w: number; d: number; h: number };
  /** Cars with named wheel meshes: the body without wheels, and each wheel centred on its own hub. */
  bodyParts?: Baked[];
  wheels?: {
    parts: Baked[];
    center: THREE.Vector3;
    radius: number;
    front: boolean;
  }[];
}

export interface Assets {
  models: Map<string, Model>;
  scenes: Map<string, THREE.Group>;
  baked: Map<string, Baked>;
  tex: Map<string, THREE.Texture>;
  sky: THREE.DataTexture | null;
  /** display-referred 4k equirect of the same HDRI, used as the visible sky */
  skyBg: THREE.Texture | null;
}

const texLoader = new THREE.TextureLoader();
function loadTex(url: string, srgb: boolean): Promise<THREE.Texture> {
  return new Promise((res, rej) =>
    texLoader.load(
      url,
      (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 8;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        res(t);
      },
      undefined,
      rej,
    ),
  );
}

// shipped GLBs are meshopt-compressed + quantised (tools/optimize_assets.sh)
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const base = import.meta.env.BASE_URL + "assets/";

function load(url: string): Promise<THREE.Group> {
  return new Promise((res, rej) =>
    loader.load(url, (g) => res(g.scene), undefined, rej),
  );
}

/** Merge every mesh of a scene into one geometry in the scene's local frame (keeps only position/normal/uv). */
function bake(scene: THREE.Group, scale = 1, rotY = 0): Baked {
  scene.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  let material: THREE.Material | null = null;
  const pre = new THREE.Matrix4()
    .makeRotationY(rotY)
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale));
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone();
    for (const k of Object.keys(g.attributes))
      if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(pre, m.matrixWorld));
    if (g.index) parts.push(g.toNonIndexed());
    else parts.push(g);
    material ??= (
      Array.isArray(m.material) ? m.material[0] : m.material
    ) as THREE.Material;
  });
  const geometry = mergeGeometries(parts, false)!;
  geometry.computeBoundingBox();
  const mat: THREE.Material =
    material ?? new THREE.MeshStandardMaterial({ color: 0x888888 });
  const std = mat as THREE.MeshStandardMaterial;
  if (std.isMeshStandardMaterial) {
    std.roughness = 0.45;
    std.metalness = 0.35;
    std.envMapIntensity = 1.0;
  }
  return { geometry, material: mat };
}

/** Bake a scene into one geometry per material (world transforms applied), keeping position/normal/uv. */
function bakeMulti(
  scene: THREE.Group,
  pre: THREE.Matrix4,
  spec?: ModelSpec,
  keep: (m: THREE.Mesh) => boolean = () => true,
): Baked[] {
  scene.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !keep(m)) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const src = m.geometry.index
      ? m.geometry.toNonIndexed()
      : m.geometry.clone();
    for (const k of Object.keys(src.attributes))
      if (!["position", "normal", "uv"].includes(k)) src.deleteAttribute(k);
    // meshopt/quantised GLBs store normalised int attributes: expand to plain floats before copying arrays
    for (const k of Object.keys(src.attributes)) {
      const at = src.attributes[k] as THREE.BufferAttribute;
      if (
        at.normalized ||
        !(at.array instanceof Float32Array) ||
        (at as unknown as { isInterleavedBufferAttribute?: boolean })
          .isInterleavedBufferAttribute
      ) {
        const f = new Float32Array(at.count * at.itemSize);
        for (let i = 0; i < at.count; i++)
          for (let c = 0; c < at.itemSize; c++)
            f[i * at.itemSize + c] = at.getComponent(i, c);
        src.setAttribute(k, new THREE.BufferAttribute(f, at.itemSize));
      }
    }
    if (!src.attributes.uv)
      src.setAttribute(
        "uv",
        new THREE.BufferAttribute(
          new Float32Array(src.attributes.position.count * 2),
          2,
        ),
      );
    if (!src.attributes.normal) src.computeVertexNormals();
    const groups = src.groups.length
      ? src.groups
      : [{ start: 0, count: src.attributes.position.count, materialIndex: 0 }];
    for (const g of groups) {
      const mat = mats[g.materialIndex ?? 0] ?? mats[0];
      const part = new THREE.BufferGeometry();
      for (const name of ["position", "normal", "uv"]) {
        const at = src.attributes[name] as THREE.BufferAttribute;
        const arr = (at.array as Float32Array).slice(
          g.start * at.itemSize,
          (g.start + g.count) * at.itemSize,
        );
        part.setAttribute(name, new THREE.BufferAttribute(arr, at.itemSize));
      }
      part.applyMatrix4(
        new THREE.Matrix4().multiplyMatrices(pre, m.matrixWorld),
      );
      (byMat.get(mat) ?? byMat.set(mat, []).get(mat)!).push(part);
    }
  });
  const out: Baked[] = [];
  for (const [mat, parts] of byMat) {
    let geometry = mergeGeometries(parts, false)!;
    // low-poly cars: smooth normals across shallow angles so flat facets stop reading as polygons
    if (spec?.cat === "car")
      geometry = toCreasedNormals(geometry, Math.PI / 4.5);
    let material: THREE.Material = mat;
    const std = mat as THREE.MeshStandardMaterial;
    if (std.isMeshStandardMaterial) {
      if (spec?.cat === "car" && !std.map) {
        // flat-coloured low-poly car parts -> automotive clearcoat paint / dark glossy glass / matte rubber
        const hsl = { h: 0, s: 0, l: 0 };
        std.color.getHSL(hsl);
        const phys = new THREE.MeshPhysicalMaterial({
          color: std.color,
          name: std.name,
          // keep light strips lit (round-3 roadster light_front / light_rear)
          emissive: std.emissive,
          emissiveIntensity: std.emissiveIntensity,
        });
        if (/^glass/i.test(std.name)) {
          // named glazing (round-3 roadster): dark, glossy, reflects the sky
          phys.roughness = 0.08;
          phys.metalness = 0.3;
          phys.clearcoat = 1.0;
          phys.envMapIntensity = 1.5;
        } else if (hsl.l < 0.12) {
          phys.roughness = 0.75;
          phys.metalness = 0.0; // tyres / trim
        } else if (hsl.s < 0.12 && hsl.l > 0.45 && hsl.l < 0.8) {
          phys.roughness = 0.35;
          phys.metalness = 0.9; // chrome-ish greys
        } else {
          phys.roughness = 0.38;
          phys.metalness = 0.1;
          phys.clearcoat = 1.0;
          phys.clearcoatRoughness = 0.08;
          phys.envMapIntensity = 1.2;
        }
        material = phys;
      } else {
        std.roughness = Math.min(std.roughness, 0.6);
        std.metalness = Math.max(std.metalness, 0.25);
        std.envMapIntensity = 1.0;
      }
    }
    out.push({ geometry, material });
  }
  return out;
}

/** Normalize a model: forward axis -> +x (cars: longest horizontal axis, front = side away from the cabin), centre x/z, min y = 0, scale to spec. */
function normalizeModel(scene: THREE.Group, spec: ModelSpec): Model {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  let rotY = 0;
  if (spec.cat === "car") {
    const alongZ = size.z >= size.x;
    // cabin heuristic: sample vertices above 60% height, find their centroid along the long axis
    let sum = 0,
      n = 0;
    const v = new THREE.Vector3();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 3) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        if (v.y - box.min.y > size.y * 0.6) {
          sum += alongZ ? v.z - center.z : v.x - center.x;
          n++;
        }
      }
    });
    const cabinOff = n ? sum / n : 0;
    const frontSign = spec.fwd ?? (cabinOff > 0 ? -1 : 1); // front is opposite the cabin
    // rotate so that the front direction maps to +x
    rotY = alongZ
      ? frontSign > 0
        ? Math.PI / 2
        : -Math.PI / 2
      : frontSign > 0
        ? 0
        : Math.PI;
  }
  // Blender-generated buildings carry their body footprint in extras; keep their origin (body centre) instead of the bbox centre
  let body: { w: number; d: number; h: number } | undefined;
  scene.traverse((o) => {
    const u = o.userData;
    if (!body && u && typeof u.bodyW === "number")
      body = { w: u.bodyW, d: u.bodyD, h: u.bodyH };
  });
  const longest = Math.max(size.x, size.z);
  const scale = spec.len
    ? spec.len / longest
    : spec.height
      ? spec.height / size.y
      : 1;
  const pre = new THREE.Matrix4()
    .makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeRotationY(rotY))
    .multiply(
      body
        ? new THREE.Matrix4().makeTranslation(0, -box.min.y, 0)
        : new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z),
    );
  // multi-material nodes load as a group of "<name>_N" meshes: test the parent's name too
  const parts = bakeMulti(
    scene,
    pre,
    spec,
    (m) =>
      !spec.omit ||
      !(
        spec.omit.test(m.name) ||
        (!!m.parent && spec.omit.test(m.parent.name))
      ),
  );
  const nb = new THREE.Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    nb.union(p.geometry.boundingBox!);
  }
  // cars whose wheels are separate named meshes: keep them apart so the player car can roll and steer them
  let bodyParts: Model["bodyParts"], wheels: Model["wheels"];
  if (spec.cat === "car") {
    const isWheel = (m: THREE.Object3D) =>
      /wheel|tire|tyre/i.test(m.name) && !/steer/i.test(m.name);
    const wheelMeshes: THREE.Mesh[] = [];
    scene.traverse((o) => {
      if (
        (o as THREE.Mesh).isMesh &&
        (isWheel(o) || (o.parent && isWheel(o.parent)))
      )
        wheelMeshes.push(o as THREE.Mesh);
    });
    if (wheelMeshes.length >= 4) {
      bodyParts = bakeMulti(scene, pre, spec, (m) => !wheelMeshes.includes(m));
      wheels = wheelMeshes.map((wm) => {
        const wp = bakeMulti(scene, pre, spec, (m) => m === wm);
        const bb = new THREE.Box3();
        for (const p of wp) {
          p.geometry.computeBoundingBox();
          bb.union(p.geometry.boundingBox!);
        }
        const center = bb.getCenter(new THREE.Vector3());
        for (const p of wp)
          p.geometry.translate(-center.x, -center.y, -center.z);
        return {
          parts: wp,
          center,
          radius: (bb.max.y - bb.min.y) / 2,
          front: center.x > 0,
        };
      });
    }
  }
  return {
    parts,
    size: nb.getSize(new THREE.Vector3()),
    spec,
    body,
    bodyParts,
    wheels,
  };
}

// dev: regenerated GLBs must not be served from the browser cache
const BUST = import.meta.env.DEV ? "?t=" + Date.now() : "";

export async function loadAssets(
  onProgress?: (done: number, total: number) => void,
): Promise<Assets> {
  const names = [
    ...CAR_MODELS.map((n) => ["cars/" + n, n] as const),
    ...RAW_GEN.map((n) => ["gen/" + n, n] as const),
  ];
  const FACADE_KIT = ["plaster", "trim_01", "trim_02", "objects"];
  const texNames = [
    ...FACADES.map((n) => [n, true] as const),
    ...SURFACES.map((n) => [n, true] as const),
    ...SURFACES.filter((n) => n !== "Grass004").map(
      (n) => [n + "_n", false] as const,
    ),
    ...FACADE_KIT.flatMap(
      (k) =>
        [
          ["ph/facade/modular_urban_apartments_facade_" + k + "_diff", true],
          ["ph/facade/modular_urban_apartments_facade_" + k + "_nor_gl", false],
          ["ph/facade/modular_urban_apartments_facade_" + k + "_arm", false],
        ] as const,
    ),
  ];
  const scenes = new Map<string, THREE.Group>();
  const models = new Map<string, Model>();
  const tex = new Map<string, THREE.Texture>();
  let sky: THREE.DataTexture | null = null;
  let skyBg: THREE.Texture | null = null;
  let done = 0;
  const total = names.length + texNames.length + 1 + MODELS.length;
  await Promise.all([
    ...MODELS.map(async (spec) => {
      try {
        models.set(
          spec.id,
          normalizeModel(
            await load(
              base + (spec.dir ?? "pp") + "/" + spec.id + ".glb" + BUST,
            ),
            spec,
          ),
        );
      } catch (e) {
        console.warn("model failed", spec.id, e);
      }
      onProgress?.(++done, total);
    }),
    ...names.map(async ([path, name]) => {
      try {
        scenes.set(name, await load(base + path + ".glb"));
      } catch (e) {
        console.warn("asset failed", name, e);
      }
      onProgress?.(++done, total);
    }),
    ...texNames.map(async ([n, srgb]) => {
      try {
        tex.set(
          n.replace(/^.*\//, ""),
          await loadTex(
            base + (n.includes("/") ? n : "tex/" + n) + ".webp",
            srgb,
          ),
        );
      } catch (e) {
        console.warn("texture failed", n, e);
      }
      onProgress?.(++done, total);
    }),
    (async () => {
      try {
        await Promise.all([
          ...PHOTO_TEX.map(async (n) => {
            try {
              const t = await loadTex(base + "photo/" + n + ".webp", true);
              t.flipY = false; // bound onto glTF UVs (v down) for photo:/roof: slabs; planes built in-game account for it
              tex.set(n, t);
            } catch (e) {
              console.warn("photo texture failed", n, e);
            }
          }),
          ...PHOTO_ALPHA.map(async (n) => {
            try {
              const t = await loadTex(base + "photo/" + n + ".webp", true);
              t.wrapT = THREE.ClampToEdgeWrapping;
              tex.set(n, t);
            } catch (e) {
              console.warn("photo texture failed", n, e);
            }
          }),
        ]);
        for (const n of ["tree_big", "tree_small"]) {
          try {
            const t = await loadTex(base + "gen/" + n + ".webp", true);
            t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
            tex.set(n, t);
          } catch (e) {
            console.warn("tree billboard failed", n, e);
          }
        }
        skyBg = await loadTex(base + "tex/sky_bg.webp", true);
        skyBg.mapping = THREE.EquirectangularReflectionMapping;
        skyBg.wrapS = THREE.RepeatWrapping;
        skyBg.minFilter = THREE.LinearMipmapLinearFilter;
        skyBg.generateMipmaps = true;
        sky = await new Promise<THREE.DataTexture>((res, rej) =>
          new RGBELoader().load(base + "tex/sky.hdr", res, undefined, rej),
        );
      } catch (e) {
        console.warn("sky failed", e);
      }
      onProgress?.(++done, total);
    })(),
  ]);
  // generated (Blender) buildings ship without textures: apply the shared concrete texture to wall/roof materials
  const concrete = tex.get("Concrete034");
  // cladding tiles/bricks: the building UVs are 3 m per repeat; 2.5x brings bricks/tiles to real size
  for (const n of ["Tiles143", "Bricks059", "Tiles140"])
    for (const s of ["", "_n"]) tex.get(n + s)?.repeat.set(2.5, 2.5);
  const atlas = signAtlasTexture();
  for (const m of models.values())
    if (m.spec.dir === "gen")
      for (const p of m.parts) {
        const mt = p.material as THREE.MeshStandardMaterial;
        if (
          mt.isMeshStandardMaterial &&
          mt.name.startsWith("modular_urban_apartments_facade_")
        ) {
          const key = mt.name.slice("modular_urban_apartments_facade_".length);
          if (key === "glass") {
            mt.color.set(0x8fb4d0);
            mt.metalness = 0.9;
            mt.roughness = 0.1;
            mt.envMapIntensity = 1.3;
          } else {
            const d = tex.get(
                "modular_urban_apartments_facade_" + key + "_diff",
              ),
              n = tex.get("modular_urban_apartments_facade_" + key + "_nor_gl"),
              arm = tex.get("modular_urban_apartments_facade_" + key + "_arm");
            if (d) {
              mt.map = d;
              mt.color.set(0xffffff);
            }
            if (n) mt.normalMap = n;
            if (arm) {
              mt.aoMap = arm;
              mt.roughnessMap = arm;
              mt.metalnessMap = arm;
              mt.roughness = 1;
              mt.metalness = 1;
            }
            mt.needsUpdate = true;
          }
        }
        if (mt.isMeshStandardMaterial && /^signatlas/.test(mt.name)) {
          mt.map = atlas;
          mt.color.set(0xffffff);
          mt.roughness = 0.5;
          mt.metalness = 0;
          mt.emissive.set(0x222222);
          mt.emissiveMap = atlas;
          mt.needsUpdate = true;
        }
        // photo-facade slabs: full-UV generated elevation (photo:X) and roof (roof:X) images
        const photoTex = mt.isMeshStandardMaterial
          ? /^(photo|roof):(\w+)$/.exec(mt.name)
          : null;
        const photoMap = photoTex ? tex.get(photoTex[2]) : undefined;
        if (mt.isMeshStandardMaterial && photoMap) {
          mt.map = photoMap;
          mt.color.set(0xffffff);
          mt.roughness = 0.82;
          mt.metalness = 0;
          mt.needsUpdate = true;
        }
        const wallTex =
          mt.isMeshStandardMaterial && /^(wall|roof)/.test(mt.name)
            ? /^wall:(\w+)/.exec(mt.name)?.[1]
            : null;
        if (
          mt.isMeshStandardMaterial &&
          !photoMap &&
          /^(wall|roof)/.test(mt.name) &&
          concrete
        ) {
          mt.map = (wallTex && tex.get(wallTex)) || concrete;
          const n = wallTex ? tex.get(wallTex + "_n") : undefined;
          if (n) {
            mt.normalMap = n;
            mt.normalScale.set(0.6, 0.6);
          }
          mt.needsUpdate = true;
        }
        if (mt.isMeshStandardMaterial && /^glass/.test(mt.name)) {
          // daylight glazing reads as a dark mirror of the sky, not a painted blue panel
          mt.color.set(0x34485a);
          mt.metalness = 0.95;
          mt.roughness = 0.1;
          mt.envMapIntensity = 1.6;
        }
      }
  const baked = new Map<string, Baked>();
  for (const [name, scene] of scenes)
    if (CAR_MODELS.includes(name))
      baked.set(name, bake(scene, CAR_SCALE, Math.PI / 2));
  return { models, scenes, baked, tex, sky, skyBg };
}
