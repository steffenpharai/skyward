/**
 * Character toon material — the cel-shaded look that lifts the procedural figure
 * out of "basic shaded primitives" into a stylized BotW/Ghibli character.
 *
 * `MeshToonNodeMaterial` (the node/WebGPU twin of MeshToonMaterial) runs three's
 * real toon lighting model, so it keeps proper lights + RECEIVES shadows, while a
 * `gradientMap` quantises the diffuse into hard cel bands. The ramp is authored
 * with a COOL→WARM tint (cool desaturated shadow, warm bright light) so shaded and
 * lit areas read with painterly colour temperature, not just brightness. A Fresnel
 * rim is added through `emissiveNode` (on top of the lit result) for the silhouette
 * "pop". The scene's post depth-outline already inks the character's contour.
 *
 * Pure node material → compiles to WGSL (WebGPU) and GLSL (WebGL2). Drop-in for the
 * old `new MeshStandardNodeMaterial({ color, roughness }) + withRim`.
 */
import * as THREE from "three";
import { MeshToonNodeMaterial } from "three/webgpu";
import { normalize, normalWorld, normalView, color, float, vec3, smoothstep, oneMinus } from "../nodes/tsl";
import { fresnelRim } from "../nodes/lighting";

/**
 * Shared cool→warm cel ramp (4 hard steps). MeshToon samples this by the diffuse
 * light term and multiplies it into the lit colour, so a tinted ramp gives the
 * warm-light / cool-shadow split for free. NearestFilter = crisp bands.
 */
let _ramp: THREE.DataTexture | null = null;
function celRamp(): THREE.DataTexture {
  if (_ramp) return _ramp;
  // 4 steps: deep cool shadow → cool mid → warm light → hot rim-light
  const steps = [
    [0.40, 0.44, 0.54],   // shadow — cool, desaturated
    [0.66, 0.67, 0.70],   // terminator
    [0.93, 0.92, 0.88],   // lit
    [1.04, 1.01, 0.94],   // bright (slight over-1 warm push)
  ];
  const data = new Uint8Array(steps.length * 4);
  steps.forEach(([r, g, b], i) => {
    data[i * 4 + 0] = Math.min(255, Math.round(r * 255));
    data[i * 4 + 1] = Math.min(255, Math.round(g * 255));
    data[i * 4 + 2] = Math.min(255, Math.round(b * 255));
    data[i * 4 + 3] = 255;
  });
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;   // hard cel bands, no blur
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  _ramp = tex;
  return tex;
}

export interface CharToonOpts {
  rimColor?: THREE.ColorRepresentation;
  rimPower?: number;
  rimStrength?: number;
  flatShading?: boolean;
  emissive?: THREE.ColorRepresentation;   // for self-lit accents (eyes/visor)
  emissiveIntensity?: number;
}

/** A cel-shaded character material. Drop-in for the figure's body parts. */
export function charToon(col: THREE.ColorRepresentation, opts: CharToonOpts = {}): MeshToonNodeMaterial {
  // @types/three's node-material typings are incomplete (no flatShading / emissiveNode
  // on MeshToonNodeMaterial, though both exist at runtime) — set them via `any`.
  const m = new MeshToonNodeMaterial({ color: col }) as any;
  m.flatShading = opts.flatShading ?? false;
  m.gradientMap = celRamp();
  // Fresnel rim added on top of the lit toon result (the "AAA tell")
  m.emissiveNode = fresnelRim(
    normalize(normalWorld),
    color(opts.rimColor ?? 0xfff1d6),
    float(opts.rimPower ?? 2.8),
    float(opts.rimStrength ?? 0.4),
  );
  if (opts.emissive != null) {
    m.emissive = new THREE.Color(opts.emissive);
    (m as any).emissiveIntensity = opts.emissiveIntensity ?? 1;
  }
  return m;
}

/**
 * Hair material — `charToon` plus the anime "silky sheen" highlight band. The band
 * is computed in TSL (a bright stripe where the view-space normal points up-ish), so
 * it's the stylized hair-highlight look WITHOUT a MatCap texture and stays coherent
 * with the scene's day-night lighting. Added through `emissiveNode` with the rim.
 */
export function hairToon(
  col: THREE.ColorRepresentation,
  opts: { sheenColor?: THREE.ColorRepresentation; sheen?: number; rimColor?: THREE.ColorRepresentation; rimStrength?: number; flatShading?: boolean } = {},
): MeshToonNodeMaterial {
  const m = new MeshToonNodeMaterial({ color: col }) as any;
  m.flatShading = opts.flatShading ?? false;
  m.gradientMap = celRamp();
  const N = normalize(normalWorld);
  const rim = fresnelRim(N, color(opts.rimColor ?? 0xfff1d6), float(2.6), float(opts.rimStrength ?? 0.3));
  // silky sheen: a THIN bright band on the upper-facing parts (view-space normal.y).
  // Kept narrow + gentle so it reads as a highlight stripe, not a cream wash.
  const nvy = normalView.y;
  const band = smoothstep(float(0.62), float(0.72), nvy).mul(oneMinus(smoothstep(float(0.74), float(0.86), nvy)));
  const sheen = vec3(color(opts.sheenColor ?? 0xfff6e6)).mul(band).mul(opts.sheen ?? 0.22);
  m.emissiveNode = rim.add(sheen);
  return m;
}
