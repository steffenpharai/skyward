import { createNoise2D } from "simplex-noise";

// Deterministic PRNG so the whole world is reproducible from one seed.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEED = 20260618;
const rng = mulberry32(SEED);

const noiseA = createNoise2D(rng);
const noiseB = createNoise2D(rng);

/** World extents. The play area is a square centered on the origin. */
export const WORLD = {
  size: 460, // total width/depth in world units
  half: 230,
};

/** Fractal value in [-1,1] from a few octaves of simplex noise. */
function fbm(x: number, z: number, octaves: number, freq: number, lacunarity = 2.0, gain = 0.5): number {
  let amp = 1;
  let f = freq;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = i % 2 === 0 ? noiseA(x * f, z * f) : noiseB(x * f, z * f);
    sum += n * amp;
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Terrain height (world Y) at a world (x,z).
 * Shape: a sheltered valley basin in the center, ringed by steep climbable
 * mountains rising at the edges — the classic "go to the horizon" bowl.
 */
export function heightAt(x: number, z: number): number {
  const r = Math.sqrt(x * x + z * z) / WORLD.half; // 0 center -> ~1 edge

  // Rolling hills across the whole map.
  const hills = fbm(x, z, 5, 0.0065) * 9.0;

  // Mountain ring: terrain ramps up hard toward the edges.
  const ringMask = smoothstep(0.45, 1.0, r);
  const ridges = (fbm(x + 1000, z - 1000, 4, 0.011) * 0.5 + 0.5); // 0..1, craggy
  const mountains = ringMask * (26 + ridges * 46);

  // A flat-ish meadow/town shelf near the center so the player has somewhere to stand.
  const meadow = (1 - smoothstep(0.0, 0.28, r)) * 2.0;

  // Gentle bowl so the very center sits a touch lower (lake-friendly).
  const bowl = -smoothstep(0.0, 0.5, 1 - r) * 1.5;

  let h = hills + mountains + meadow + bowl;

  // Carve a small lake bed near a fixed offset from center.
  const lake = lakeDepth(x, z);
  h -= lake;

  return h;
}

/** Bowl-shaped depression for the lake, returns how much to subtract. */
export function lakeDepth(x: number, z: number): number {
  const lx = -38, lz = 46, lr = 30;
  const d = Math.sqrt((x - lx) * (x - lx) + (z - lz) * (z - lz));
  return (1 - smoothstep(0, lr, d)) * 4.5;
}

export const LAKE = { x: -38, z: 46, r: 26, level: -1.2 };

/** Surface normal via finite differences of the height field. */
export function normalAt(x: number, z: number, eps = 0.6): [number, number, number] {
  const hL = heightAt(x - eps, z);
  const hR = heightAt(x + eps, z);
  const hD = heightAt(x, z - eps);
  const hU = heightAt(x, z + eps);
  // gradient
  const nx = hL - hR;
  const nz = hD - hU;
  const ny = 2 * eps;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/** Slope angle in degrees (0 = flat ground, 90 = vertical wall). */
export function slopeDeg(x: number, z: number): number {
  const n = normalAt(x, z);
  return Math.acos(Math.min(1, Math.max(-1, n[1]))) * (180 / Math.PI);
}

/**
 * Terrain heights under a rotated rectangular footprint (samples corners, edge
 * midpoints, and centre). `baseY` is the HIGHEST ground beneath the footprint —
 * seat the building there so no corner floats; `minY` is the lowest, so a
 * foundation skirt of height `drop` fills the downhill gap on a slope.
 */
export function footprintBase(x: number, z: number, rot: number, halfW: number, halfD: number): { baseY: number; minY: number; drop: number } {
  const c = Math.cos(rot), s = Math.sin(rot);
  let minY = Infinity, maxY = -Infinity;
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) {
    const lx = sx * halfW, lz = sz * halfD;
    const wx = x + lx * c - lz * s;
    const wz = z + lx * s + lz * c;
    const h = heightAt(wx, wz);
    if (h < minY) minY = h;
    if (h > maxY) maxY = h;
  }
  return { baseY: maxY, minY, drop: maxY - minY };
}

export { fbm, smoothstep };
