import * as THREE from "three";
import { RenderPipeline, WebGPURenderer } from "three/webgpu";
import {
  pass, mrt, output, normalView, uniform, vec2, vec3, float, mix, smoothstep, clamp,
  abs, length, oneMinus, fract, dot, screenUV, screenSize,
  perspectiveDepthToViewZ, viewZToOrthographicDepth, cameraNear, cameraFar,
  toneMapping, saturation,
} from "../nodes/tsl";
import { env } from "../core/env";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";

/**
 * Native WebGPU/TSL post stack (replaces pmndrs postprocessing + n8ao):
 *   Render(MRT color+normal+depth)
 *     -> GTAO (gentle, half-res; thin grass mustn't crush)
 *     -> cel Outline (linearized-depth Sobel)
 *     -> Bloom (mipmap)
 *     -> ACES tonemap  ── BEFORE the grade (saturated colours crush to black otherwise)
 *     -> grade (saturation + contrast)
 *     -> vignette
 *     -> blue-noise (IGN) dither  ── kills sky/AO banding
 *     -> SMAA
 */
export function buildComposer(renderer: WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera) {
  renderer.toneMapping = THREE.NoToneMapping; // ACES is applied as a node, mid-graph

  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, normal: normalView }));

  const colorTex = scenePass.getTextureNode("output");
  const normalTex = scenePass.getTextureNode("normal");
  const depthTex = scenePass.getTextureNode("depth");

  // ---- GTAO (grounds terrain/structures; kept gentle so foliage stays lit) ----
  const aoPass = ao(depthTex, normalTex, camera as THREE.PerspectiveCamera);
  aoPass.resolutionScale = 0.5;
  aoPass.radius.value = 1.6;
  aoPass.distanceExponent.value = 1.4;
  aoPass.scale.value = 1.0;
  const aoT = aoPass.getTextureNode();
  // 30% strength: occluded -> 0.7, open -> 1.0 (never multiplies thin grass to black)
  let c = colorTex.mul(float(0.7).add(aoT.r.mul(0.3)));

  // ---- cel outline: second-derivative + gradient of linearized depth ----
  const texel = uniform(vec2(1 / innerWidth, 1 / innerHeight));
  const uThickness = 1.0;
  const uDepthEdge = 0.0016;
  const uStrength = 0.7;
  const outlineColor = vec3(0x1b2740 >> 16 & 255, 0x1b2740 >> 8 & 255, 0x1b2740 & 255).div(255);

  const linD = (uv: any) => {
    const raw = depthTex.sample(uv).r;
    const vz = perspectiveDepthToViewZ(raw, cameraNear, cameraFar);
    return viewZToOrthographicDepth(vz, cameraNear, cameraFar);
  };
  const t = texel.mul(uThickness);
  const dc = linD(screenUV);
  const dl = linD(screenUV.add(vec2(t.x.negate(), 0)));
  const dr = linD(screenUV.add(vec2(t.x, 0)));
  const du = linD(screenUV.add(vec2(0, t.y)));
  const dd = linD(screenUV.add(vec2(0, t.y.negate())));
  let edge = abs(dl.add(dr).add(du).add(dd).sub(dc.mul(4.0)));
  edge = edge.add(length(vec2(dr.sub(dl), du.sub(dd))).mul(0.5));
  let e = smoothstep(float(uDepthEdge), float(uDepthEdge).mul(3.0), edge);
  e = e.mul(oneMinus(smoothstep(0.6, 1.0, dc))); // fade outlines into the distance
  c = mix(c, outlineColor, e.mul(uStrength));

  // ---- volumetric god-rays (screen-space radial light scatter) ----
  // The Sky/BOTW "awe" cue, absent until now. March from each pixel toward the
  // sun's projected screen position, accumulating a bright-pass of the scene so
  // foreground geometry occludes the shafts. Fed into bloom below so the beams
  // glow. sunUV / sunVis are driven each frame from env.sunDir by main.ts.
  const sunUV = uniform(vec2(0.5, 0.5));
  const sunVis = uniform(0.0);          // 0 when the sun is behind/off-screen
  const uGodray = uniform(0.85);        // master strength (settings-tunable)
  const RAY_SAMPLES = 10;               // taps along the ray (bloom + dither hide banding)
  const rayStep = sunUV.sub(screenUV).mul(0.55 / RAY_SAMPLES);
  let rayAcc = vec3(0, 0, 0);
  let illum = float(1.0);
  let marchUV: any = screenUV;
  for (let i = 0; i < RAY_SAMPLES; i++) {
    marchUV = marchUV.add(rayStep);
    const s = colorTex.sample(marchUV).rgb;
    const lum = dot(s, vec3(0.299, 0.587, 0.114));
    rayAcc = rayAcc.add(s.mul(smoothstep(0.62, 1.15, lum)).mul(illum));
    illum = illum.mul(0.93);
  }
  const godray = rayAcc.mul(1 / RAY_SAMPLES).mul(vec3(env.u.sunColor)).mul(sunVis).mul(uGodray);
  c = c.add(godray);

  // ---- bloom (mipmap) ----
  const bloomPass = bloom(c, 0.5, 0.82, 0.8);
  c = c.add(bloomPass);

  // ---- ACES tonemap, THEN grade (order is the anti-black-crush fix) ----
  let g: any = toneMapping(THREE.ACESFilmicToneMapping, 1.0, c);
  g = saturation(g, 1.3);                  // +0.30 — bolder, stylized colour (Palia/BOTW confidence)
  g = g.sub(0.5).mul(1.08).add(0.5);       // +0.08 contrast (gentle — don't crush darks to black)

  // ---- filmic split-tone (LUT-equivalent signature grade) ----
  // Warm the shadows, cool the highlights — a cinematic identity instead of a
  // neutral tonemap. Subtle so it never looks tinted, just "graded".
  const lumG = dot(g, vec3(0.299, 0.587, 0.114));
  g = g.mul(mix(vec3(1.05, 1.005, 0.93), vec3(0.96, 1.0, 1.07), smoothstep(0.15, 0.85, lumG)));

  // ---- vignette (light — a heavy vignette reads as "black corners") ----
  const vig = smoothstep(0.34, 1.2, length(screenUV.sub(vec2(0.5, 0.5))).mul(1.4));
  g = g.mul(oneMinus(vig.mul(0.34)));

  // ---- blue-noise (interleaved gradient noise) dither ----
  const px = screenUV.mul(screenSize);
  const ign = fract(float(52.9829189).mul(fract(dot(px, vec2(0.06711056, 0.00583715)))));
  g = g.add(ign.sub(0.5).div(255.0));

  // ---- SMAA (final) ----
  const postProcessing = new RenderPipeline(renderer);
  postProcessing.outputNode = smaa(g);

  function setSize(w: number, h: number) {
    texel.value.set(1 / w, 1 / h);
  }

  return {
    postProcessing,
    setSize,
    effects: { aoPass, bloomPass },
    godrays: { sunUV, sunVis, strength: uGodray },
    ToneMappingMode: { ACES_FILMIC: THREE.ACESFilmicToneMapping },
  };
}
