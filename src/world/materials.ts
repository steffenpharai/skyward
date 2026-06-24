import * as THREE from "three";
import {
  vec3, float, max, dot, normalize, length, cross, dFdx, dFdy, sin, clamp, fract, mix,
  cameraPosition, positionWorld, positionLocal, normalWorld, color, instanceIndex, attribute,
  texture, uv, triplanarTexture, bumpMap,
} from "../nodes/tsl";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";
import { env } from "../core/env";
import { windSway } from "../core/wind";
import { applyFog } from "../nodes/fog";
import { toonFoliageLit, fresnelRim } from "../nodes/lighting";

/**
 * Adds a stylized Fresnel rim-light to a standard-node material via emissiveNode
 * (adds on top of the real lit result). The "AAA tell" that separates objects
 * from the background. Replaces the old onBeforeCompile GLSL injection.
 */
export function withRim(
  mat: MeshStandardNodeMaterial,
  opts: { color?: THREE.ColorRepresentation; power?: number; strength?: number } = {}
): MeshStandardNodeMaterial {
  const N = normalize(normalWorld);
  mat.emissiveNode = fresnelRim(N, color(opts.color ?? 0xfff0d0), float(opts.power ?? 2.5), float(opts.strength ?? 0.6));
  return mat;
}

/**
 * Custom toon foliage material for InstancedMesh — full control of output so it
 * can NEVER render black. Flat face normal from screen-space derivatives (safe-
 * normalized to avoid NaN), shared `toonFoliageLit` (3-band toon + cool fill +
 * backlit rim, env-driven), plus aerial fog.
 */
export function toonFoliage(
  base: THREE.ColorRepresentation,
  rimColor: THREE.ColorRepresentation = 0xdaf79a
): { mat: MeshBasicNodeMaterial; update: () => void } {
  const mat = new MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });

  // ---- wind sway: canopy bends in the ONE shared wind field (per-tree phase) ----
  const hf = clamp(positionLocal.y.mul(0.16), 0.0, 1.0); // top of canopy sways most
  mat.positionNode = positionLocal.add(windSway(positionLocal, float(instanceIndex).mul(1.7), hf, float(0.04)));

  const nx = cross(dFdx(positionWorld), dFdy(positionWorld));
  let N = nx.div(max(length(nx), 1e-5)); // safe normalize (no NaN -> no black)
  const V = normalize(cameraPosition.sub(positionWorld));
  N = N.mul(dot(N, V).lessThan(0.0).select(float(-1.0), float(1.0))); // face the camera

  // per-tree value jitter so a grove doesn't read as one cloned tree
  const jit = fract(sin(float(instanceIndex).mul(12.9898)).mul(43758.5453));
  // baked canopy AO (dark underside -> bright crown) gives the blob real volume
  const cAO = attribute("fAO", "float");
  // procedural leaf-cluster dapple -> the surface reads as clustered leaves, not a smooth toon shell
  const lp = positionWorld.mul(1.7);
  const dap = sin(lp.x).mul(sin(lp.y.add(1.3))).mul(sin(lp.z.add(2.1))).mul(0.5).add(0.5);
  const dapple = float(0.9).add(dap.mul(0.2));
  const lit = toonFoliageLit(vec3(color(base)), N, vec3(color(rimColor)))
    .mul(float(0.9).add(jit.mul(0.2)))
    .mul(cAO)
    .mul(dapple);
  mat.colorNode = applyFog(lit);

  return { mat, update: () => {} }; // time/sun now flow through env
}

/**
 * Leaf-CARD foliage: alpha-cutout textured quads. Uses the baked spherified
 * vertex normal (so the canopy lights as one volume), the leaf texture's alpha
 * for cutout (no blending/sorting -> cheap, writes depth, casts shadow), and the
 * texture luminance for per-leaf value variation. Sways in the shared wind.
 */
export function toonLeafCards(
  base: THREE.ColorRepresentation,
  rimColor: THREE.ColorRepresentation,
  tex: THREE.Texture
): { mat: MeshBasicNodeMaterial } {
  const mat = new MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
  mat.alphaTest = 0.42; // cutout, not blend

  // wind sway: same shared field as the canopy core
  const hf = clamp(positionLocal.y.mul(0.16), 0.0, 1.0);
  mat.positionNode = positionLocal.add(windSway(positionLocal, float(instanceIndex).mul(1.7), hf, float(0.04)));

  const tx = texture(tex, uv());
  mat.opacityNode = tx.a;

  const N = normalize(normalWorld);
  const cAO = attribute("fAO", "float");
  const jit = fract(sin(float(instanceIndex).mul(12.9898)).mul(43758.5453));
  // variant base tinted by the texture luminance -> within-canopy leaf variation
  const albedo = vec3(color(base)).mul(tx.g.mul(0.5).add(0.62));
  const lit = toonFoliageLit(albedo, N, vec3(color(rimColor)))
    .mul(float(0.9).add(jit.mul(0.2)))
    .mul(cAO);
  mat.colorNode = applyFog(lit);

  return { mat };
}

// ===========================================================================
// Surface materials for MAN-MADE objects (buildings, structures).
//
// The "basic" tell on hand-built props was that every wall/roof was a flat
// solid colour with no surface. This applies the SAME proven recipe the terrain
// uses — a procedural world-space triplanar detail texture (whose luminance
// doubles as a bump height) + Fresnel rim — to give wood/plaster/metal/thatch
// real grain and relief while keeping native PBR lighting + shadow reception.
// No texture files: each surface is a small procedural <canvas>, generated once
// and shared (read-only, world-space) across every object that uses it.
// ===========================================================================

export type SurfaceKind = "wood" | "plank" | "plaster" | "metal" | "thatch" | "shingle" | "stone";

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Build a tileable detail canvas for a surface kind. Luminance = bump height. */
function makeSurfaceCanvas(kind: SurfaceKind): THREE.CanvasTexture {
  const N = 256;
  const c = document.createElement("canvas"); c.width = c.height = N;
  const ctx = c.getContext("2d")!;
  const rnd = mulberry(kind.length * 9277 + 4242);

  const fill = (s: string) => { ctx.fillStyle = s; ctx.fillRect(0, 0, N, N); };
  const grain = (count: number, alpha: number, len: number) => {
    for (let i = 0; i < count; i++) {
      const x = rnd() * N, y = rnd() * N, v = 120 + Math.floor(rnd() * 90);
      ctx.strokeStyle = `rgba(${v},${v - 12},${v - 26},${alpha})`; ctx.lineWidth = 0.6 + rnd();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rnd() - 0.5) * len, y + (rnd() - 0.5) * 4); ctx.stroke();
    }
  };

  if (kind === "wood" || kind === "plank") {
    fill("#8a8a8a");
    const planks = 6, ph = N / planks;
    for (let p = 0; p < planks; p++) {
      const y0 = p * ph, base = 132 + Math.floor(rnd() * 40);
      ctx.fillStyle = `rgb(${base},${base - 6},${base - 14})`; ctx.fillRect(0, y0 + 1, N, ph - 2);
      // grain streaks along the plank
      for (let i = 0; i < 36; i++) {
        const yy = y0 + 3 + rnd() * (ph - 6), v = base - 18 - Math.floor(rnd() * 22);
        ctx.strokeStyle = `rgba(${v},${v - 6},${v - 12},0.5)`; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(0, yy); for (let x = 0; x <= N; x += 16) ctx.lineTo(x, yy + (rnd() - 0.5) * 2.5); ctx.stroke();
      }
      // dark groove BETWEEN planks (strong bump seam)
      ctx.fillStyle = "rgba(40,32,24,0.92)"; ctx.fillRect(0, y0, N, 2);
    }
  } else if (kind === "plaster" || kind === "stone") {
    fill(kind === "stone" ? "#8c8880" : "#b8b2a6");
    // soft mottle for a gentle orange-peel bump
    for (let i = 0; i < 1700; i++) {
      const x = rnd() * N, y = rnd() * N, r = 2 + rnd() * 9, v = 150 + Math.floor(rnd() * 70);
      ctx.fillStyle = `rgba(${v},${v - 6},${v - 14},0.16)`; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    }
    if (kind === "stone") { // a few mortar cracks for relief
      ctx.strokeStyle = "rgba(54,50,44,0.5)"; ctx.lineWidth = 1.4;
      for (let i = 0; i < 40; i++) { let x = rnd() * N, y = rnd() * N; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 3; k++) { x += (rnd() - 0.5) * 50; y += (rnd() - 0.5) * 50; ctx.lineTo(x, y); } ctx.stroke(); }
    }
  } else if (kind === "metal") {
    fill("#9aa0a6");
    // brushed horizontal streaks
    grain(900, 0.18, 60);
    // panel seam grid + rivets
    ctx.strokeStyle = "rgba(54,60,66,0.7)"; ctx.lineWidth = 1.6;
    for (let g = 0; g <= N; g += 64) { ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, N); ctx.moveTo(0, g); ctx.lineTo(N, g); ctx.stroke(); }
    for (let gx = 0; gx <= N; gx += 64) for (let gy = 0; gy <= N; gy += 64) { ctx.fillStyle = "rgba(210,216,222,0.8)"; ctx.beginPath(); ctx.arc(gx + 8, gy + 8, 2.4, 0, 6.2832); ctx.fill(); }
  } else { // thatch / shingle — overlapping rows for roofs
    fill("#7e7468");
    const rows = 9, rh = N / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rh, base = 118 + Math.floor(rnd() * 36);
      ctx.fillStyle = `rgb(${base},${base - 10},${base - 22})`; ctx.fillRect(0, y, N, rh - 1);
      // serrated overlap shadow on the lower edge of each row (bump)
      ctx.fillStyle = "rgba(40,34,26,0.85)";
      for (let x = 0; x < N; x += kind === "shingle" ? 28 : 10) { ctx.fillRect(x, y + rh - 3, (kind === "shingle" ? 26 : 8), 3); }
      if (kind === "thatch") grain(40, 0.5, 22);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const _surfaceTex: Partial<Record<SurfaceKind, THREE.CanvasTexture>> = {};
function sharedSurface(kind: SurfaceKind): THREE.CanvasTexture {
  return (_surfaceTex[kind] ??= makeSurfaceCanvas(kind));
}

export interface SurfaceOpts {
  kind: SurfaceKind;
  color: THREE.ColorRepresentation;
  scale?: number;        // world-units frequency of the detail (default per kind)
  detail?: number;       // albedo detail strength 0..1 (default 0.5)
  bump?: number;         // normal relief strength (default per kind)
  roughness?: number;
  metalness?: number;
  rim?: number;          // Fresnel rim strength (default 0.3)
  rimColor?: THREE.ColorRepresentation;
  flatShading?: boolean;
}

const KIND_SCALE: Record<SurfaceKind, number> = { wood: 0.5, plank: 0.45, plaster: 0.35, stone: 0.3, metal: 0.4, thatch: 0.6, shingle: 0.55 };
const KIND_BUMP: Record<SurfaceKind, number> = { wood: 0.14, plank: 0.16, plaster: 0.06, stone: 0.12, metal: 0.08, thatch: 0.22, shingle: 0.2 };

/**
 * A man-made surface: solid base colour grounded by procedural triplanar detail
 * (grain/planks/mottle/seams), real bump-mapped relief, and a Fresnel rim — on a
 * MeshStandardNodeMaterial, so it lights and RECEIVES shadows natively. Drop-in
 * replacement for the old flat `new MeshStandardNodeMaterial({ color, ... })`.
 */
export function surfaceMat(opts: SurfaceOpts): MeshStandardNodeMaterial {
  const tex = sharedSurface(opts.kind);
  const scale = opts.scale ?? KIND_SCALE[opts.kind];
  const detail = opts.detail ?? 0.5;
  const bumpStr = opts.bump ?? KIND_BUMP[opts.kind];

  const mat = new MeshStandardNodeMaterial({
    color: opts.color,
    roughness: opts.roughness ?? 0.92,
    metalness: opts.metalness ?? 0.0,
    flatShading: opts.flatShading ?? false,
  });

  const base = vec3(color(opts.color));
  const tri = triplanarTexture(texture(tex), null, null, float(scale), positionWorld, normalWorld);
  const lum = tri.r.mul(0.5).add(tri.g.mul(0.5));                       // luminance ~ height
  // modulate the base colour by the detail luminance (around 1.0 so colour holds)
  mat.colorNode = base.mul(mix(float(1.0), lum.mul(1.9), float(detail)));
  // real surface relief from the same luminance
  const h = triplanarTexture(texture(tex), null, null, float(scale), positionWorld, normalWorld).r;
  mat.normalNode = bumpMap(h, float(bumpStr));
  // rim tell so silhouettes separate from the background (the "AAA tell")
  mat.emissiveNode = fresnelRim(
    normalize(normalWorld), color(opts.rimColor ?? 0xfff0d0), float(2.8), float(opts.rim ?? 0.3),
  );
  return mat;
}
