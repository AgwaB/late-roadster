declare module "n8ao" {
  import type { Camera, Color, Scene } from "three";
  import { Pass } from "three/addons/postprocessing/Pass.js";
  export class N8AOPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      color: Color;
      halfRes: boolean;
      gammaCorrection: boolean;
      screenSpaceRadius: boolean;
      aoSamples: number;
      denoiseSamples: number;
      denoiseRadius: number;
      depthAwareUpsampling: boolean;
    };
    setQualityMode(
      mode: "Performance" | "Low" | "Medium" | "High" | "Ultra",
    ): void;
    setSize(width: number, height: number): void;
  }
}
