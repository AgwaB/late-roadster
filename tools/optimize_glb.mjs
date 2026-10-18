// GLB payload shrink that keeps UVs exact (the game rebinds its own textures, so a KHR_texture_transform
// left behind by TEXCOORD quantisation would be lost): positions/normals quantised, UVs stay float,
// everything meshopt-compressed; embedded textures -> WebP <= 1024 px. Names, extras and materials kept.
// usage: node tools/optimize_glb.mjs in.glb out.glb   (needs @gltf-transform/{core,extensions,functions}, meshoptimizer, sharp)
import { NodeIO } from "@gltf-transform/core";
import {
  ALL_EXTENSIONS,
  EXTMeshoptCompression,
} from "@gltf-transform/extensions";
import {
  dedup,
  prune,
  quantize,
  reorder,
  textureCompress,
} from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";

const [, , src, dst] = process.argv;
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "meshopt.encoder": MeshoptEncoder,
    "meshopt.decoder": MeshoptDecoder,
  });
const doc = await io.read(src);
await doc.transform(
  // material names carry the game's texture binding (photo:/wall:/roof:, facade kit) -> never merge by value
  dedup({ keepUniqueNames: true }),
  // keepAttributes: our materials have no embedded maps, but the game binds textures onto these UVs
  prune({ keepExtras: true, keepAttributes: true }),
  textureCompress({
    encoder: sharp,
    targetFormat: "webp",
    resize: [1024, 1024],
    quality: 82,
  }),
  reorder({ encoder: MeshoptEncoder, target: "size" }),
  quantize({
    pattern: /^(POSITION|NORMAL)$/,
    quantizePosition: 14,
    quantizeNormal: 10,
  }),
);
doc
  .createExtension(EXTMeshoptCompression)
  .setRequired(true)
  .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(dst, doc);
