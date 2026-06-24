/**
 * Stylized GPU cloud layer — the 2026 "dome-FBM" technique (replaces the old
 * cluster-of-icospheres puffs, which were the sky's weak link: hard silhouettes,
 * no translucency, CPU-drifted).
 *
 * An animated fractal-noise field is projected onto the upper hemisphere of a
 * back-side dome and shaded with a cheap stylized cloud model — coverage
 * threshold, a sun-direction lit/shadow gradient, Beer's-law translucency, and a
 * forward-scatter "silver lining" rim. Everything runs in the fragment shader and
 * animates from `env.u.time`, so there is ZERO per-frame CPU work and it reads as
 * soft Ghibli puffs rather than lumpy geometry. Pure TSL → compiles to WGSL
 * (WebGPU) and GLSL (WebGL2) alike.
 *
 * Colours are pulled from `env` (sun colour + sky bands) so the clouds warm at
 * golden hour and cool at dusk for free, agreeing with the dome and the water.
 */
import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  Fn, vec2, vec3, float, floor, fract, sin, dot, mix, smoothstep, clamp, max,
  pow, exp, oneMinus, normalize, positionLocal,
} from "./tsl";
import { env } from "../core/env";

// ---- value noise + fBm (self-contained; no texture, no MaterialX dependency) ----
const hash2 = Fn(([p]: any) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));

const vnoise = Fn(([p]: any) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));        // smootherstep weights
  const a = hash2(i);
  const b = hash2(i.add(vec2(1, 0)));
  const c = hash2(i.add(vec2(0, 1)));
  const d = hash2(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

/** 5-octave fractal Brownian motion (unrolled — TSL has no shader-side loops here). */
const fbm = Fn(([p0]: any) => {
  let v = float(0.0);
  let amp = float(0.5);
  let p = p0;
  for (let o = 0; o < 5; o++) {
    v = v.add(vnoise(p).mul(amp));
    p = p.mul(2.02).add(vec2(37.2, 17.7));   // lacunarity + offset to break axis alignment
    amp = amp.mul(0.5);
  }
  return v;
});

/**
 * A stylized cloud material for a back-side dome. Map onto a SphereGeometry shell
 * just inside the sky dome; the lower hemisphere fades to nothing so there is no
 * hard horizon ring.
 */
export function cloudLayerMaterial(opts: { coverage?: number; scale?: number; speed?: number } = {}): MeshBasicNodeMaterial {
  const coverage = float(opts.coverage ?? 0.46);   // higher → fewer/thinner clouds
  const scale = float(opts.scale ?? 1.9);          // pattern frequency
  const speed = opts.speed ?? 0.004;               // GPU wind speed

  const mat = new MeshBasicNodeMaterial({
    side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: true, fog: false,
  });

  const d = normalize(positionLocal);
  const sun = normalize(env.u.sunDir);

  // stable hemispherical projection: flatten the dome direction to a plane, denser
  // toward the horizon (the classic "look up at a cloud deck" foreshortening)
  const proj = d.xz.div(max(d.y.add(0.32), 0.12)).mul(scale);
  const wind = vec2(float(env.u.time).mul(speed), float(env.u.time).mul(speed * 0.4));
  const p = proj.add(wind);

  // density: fBm thresholded by coverage → soft-edged scattered clouds with gaps
  const raw = fbm(p);
  const dens = smoothstep(coverage, coverage.add(float(0.30)), raw);

  // cheap stylized lighting: sample the field offset toward the sun as a height
  // proxy → bright sunlit tops, darker shaded bases (no costly light-march)
  const lightSamp = fbm(p.add(sun.xz.mul(0.22)));
  const shade = clamp(dens.sub(lightSamp).add(0.55), 0.0, 1.0);

  // warm-white lit body, cool sky-tinted shadow — pulled from env so TOD drives it
  const litCol = mix(vec3(1.0, 0.98, 0.93), vec3(env.u.sunColor), 0.45);
  const shadowCol = mix(vec3(0.58, 0.63, 0.74), vec3(env.u.skyMid), 0.5);
  let col = mix(shadowCol, litCol, shade);

  // forward-scatter silver lining toward the sun
  const dd = max(dot(d, sun), 0.0);
  col = col.add(vec3(env.u.sunColor).mul(pow(dd, 6.0).mul(0.5)));
  mat.colorNode = col;

  // alpha: Beer's-law translucency × horizon fade (kills the dome seam + keeps the
  // zenith and the low sky clear)
  const horizonFade = smoothstep(0.04, 0.30, d.y);
  const alpha = oneMinus(exp(dens.mul(-3.2))).mul(horizonFade).mul(0.95);
  mat.opacityNode = alpha;

  return mat;
}
