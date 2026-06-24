import {
  Fn, vec3, float, max, dot, normalize, pow, mix, clamp, cameraPosition, positionWorld,
} from "./tsl";
import { env } from "../core/env";

/**
 * Stylized toon lighting for self-lit instanced foliage/grass — the "never
 * goes black" model. A 3-band toon diffuse with a lifted floor, a cool
 * hemisphere fill, and a warm backlit rim, all sourced from `env` (so the sun
 * direction/colour and a future day-night cycle drive it for free).
 *
 *  base    : albedo (keep it BRIGHT — dark bases read black after the grade)
 *  N       : world normal (face/flat normal is fine)
 *  rimCol  : backlit rim colour
 */
export const toonFoliageLit = Fn(([base, N, rimCol]: any) => {
  const L = normalize(env.u.sunDir);
  const V = normalize(cameraPosition.sub(positionWorld));
  const ndl = max(dot(N, L), 0.0);
  // 3 bands with a bright floor (0.78) so shaded canopy never crushes to black
  const band = ndl.greaterThan(0.55).select(
    float(1.22),
    ndl.greaterThan(0.22).select(float(1.0), float(0.78))
  );
  // NOTE: foliage does NOT receive shadows. `shadow(sun)` inside this self-lit
  // MeshBasicNodeMaterial overflows the node-graph build ("Maximum call stack
  // exceeded" on first render — confirmed twice). Vegetation casts but doesn't
  // receive shadows; grass per-blade PCF is a separate perf wall.
  const fill = vec3(env.u.hemiSky).mul(0.35);
  let col = base.mul(band).add(base.mul(fill));
  // warm backlit rim
  const rim = pow(clamp(float(1.0).sub(max(dot(N, V), 0.0)), 0.0, 1.0), 2.5).mul(0.3);
  col = col.add(vec3(rimCol).mul(rim));
  return col;
});

/**
 * Fresnel rim term for PBR (standard-node) surfaces — fed into emissiveNode so
 * it adds on top of the real lit result. Separates silhouettes from the
 * background (the "AAA tell"), replacing the old onBeforeCompile withRim.
 */
export const fresnelRim = Fn(([N, rimCol, power, strength]: any) => {
  const V = normalize(cameraPosition.sub(positionWorld));
  const rim = pow(clamp(float(1.0).sub(max(dot(N, V), 0.0)), 0.0, 1.0), power).mul(strength);
  return vec3(rimCol).mul(rim);
});
