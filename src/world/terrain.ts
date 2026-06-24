import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import {
  positionWorld, normalWorld, sin, mix, float, clamp, vec3, attribute,
  triplanarTexture, bumpMap, texture,
} from "../nodes/tsl";
import { heightAt, normalAt, WORLD, LAKE, fbm } from "../core/noise";
import { withRim } from "./materials";

/** Procedural rock detail texture (albedo; luminance doubles as a bump height). */
function makeRockTexture(): THREE.CanvasTexture {
  const N = 256;
  const c = document.createElement("canvas"); c.width = c.height = N;
  const ctx = c.getContext("2d")!;
  let seed = 4242;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  ctx.fillStyle = "#837a6d"; ctx.fillRect(0, 0, N, N);
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * N, y = rnd() * N, r = 2 + rnd() * 11, v = 95 + Math.floor(rnd() * 95);
    ctx.fillStyle = `rgba(${v},${v - 10},${v - 20},0.45)`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  }
  // cracks add high-frequency height detail for the bump
  ctx.strokeStyle = "rgba(38,34,28,0.55)"; ctx.lineWidth = 1.6;
  for (let i = 0; i < 55; i++) {
    ctx.beginPath(); let x = rnd() * N, y = rnd() * N; ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (rnd() - 0.5) * 46; y += (rnd() - 0.5) * 46; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// One shared rock texture for every terrain chunk (genesis + streamed regions).
// It's world-space triplanar + read-only, so all chunks safely reuse a single
// GPU texture instead of allocating one per region.
let _rockTex: THREE.CanvasTexture | null = null;
function sharedRockTexture(): THREE.CanvasTexture {
  return (_rockTex ??= makeRockTexture());
}

// Stylized palette — flat, slightly desaturated, WoW/BotW-ish hand-painted feel.
const C_GRASS = new THREE.Color("#6aa84f");
const C_GRASS_DRY = new THREE.Color("#8aa84a");
const C_ROCK = new THREE.Color("#8a857c");
const C_ROCK_DK = new THREE.Color("#736b5e");
const C_SAND = new THREE.Color("#d8c694");
const C_SNOW = new THREE.Color("#f4f7fb");
const C_DIRT = new THREE.Color("#7a6a4f");
const C_ROCK_HI = new THREE.Color("#a59a86"); // warmer light rock for upper slopes

const tmp = new THREE.Color();
const tmp2 = new THREE.Color();

function colorFor(x: number, z: number, h: number, slope: number): THREE.Color {
  // Beach / lakebed near water line
  if (h < LAKE.level + 0.8 && Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 6) {
    return tmp.copy(C_SAND);
  }
  // SNOW CAPS: accumulates on high terrain except near-vertical cliffs. Wavy snowline.
  const snowLine = 36 + Math.sin(x * 0.05) * 3 + Math.cos(z * 0.045) * 3;
  if (h > snowLine && slope < 60) {
    const snowAmt = THREE.MathUtils.clamp((h - snowLine) / 14, 0, 1) * THREE.MathUtils.clamp(1 - (slope - 30) / 35, 0, 1);
    // base rock under, snow on top
    const rock = (slope > 40 ? tmp2.copy(C_ROCK_DK).lerp(C_ROCK_HI, 0.4) : tmp2.copy(C_ROCK_HI));
    return tmp.copy(rock).lerp(C_SNOW, THREE.MathUtils.smoothstep(snowAmt, 0.15, 0.8));
  }
  // Steep faces -> two-tone rock (warmer up high)
  if (slope > 34) {
    const t = THREE.MathUtils.clamp((slope - 34) / 34, 0, 1);
    const hi = THREE.MathUtils.clamp((h - 14) / 26, 0, 1);
    return tmp.copy(C_ROCK).lerp(C_ROCK_HI, hi).lerp(C_ROCK_DK, t * 0.6);
  }
  // Low flats -> dirt/dry near edges, lush grass otherwise
  const lush = THREE.MathUtils.clamp(1 - h / 22, 0, 1);
  tmp.copy(C_GRASS_DRY).lerp(C_GRASS, lush);
  if (slope > 26) tmp.lerp(C_DIRT, (slope - 26) / 14);
  return tmp;
}

export interface TerrainMesh {
  mesh: THREE.Mesh;
}

/**
 * Build a terrain chunk for one region. `cx`/`cz` are the region's world-space
 * center (genesis = 0,0 → identical to the original full-world terrain). Vertices
 * are written in WORLD space (center offset baked in) so the world-space materials
 * (triplanar rock, bump, positionWorld) and the JS heightfield agree at any
 * region — adjacent chunks share grid-aligned edges on the same heightfield.
 */
export function buildTerrain(cx = 0, cz = 0): TerrainMesh {
  const SEG = 256; // grid resolution
  const size = WORLD.size;
  const geo = new THREE.PlaneGeometry(size, size, SEG, SEG);
  geo.rotateX(-Math.PI / 2); // make it XZ ground plane

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx;
    const z = pos.getZ(i) + cz;
    pos.setX(i, x);
    pos.setZ(i, z);
    const h = heightAt(x, z);
    pos.setY(i, h);

    const n = normalAt(x, z);
    const slope = Math.acos(Math.min(1, Math.max(-1, n[1]))) * (180 / Math.PI);
    const c = colorFor(x, z, h, slope);
    // macro patches (low-freq) — lighter/darker drifts + occasional dry-yellow patches
    const macro = fbm(x + 500, z - 700, 3, 0.018) * 0.5 + 0.5; // 0..1
    const dry = THREE.MathUtils.clamp((fbm(x - 300, z + 900, 2, 0.01) - 0.15) * 1.5, 0, 0.5);
    const val = 0.82 + macro * 0.34; // value drift
    tmp2.copy(c).multiplyScalar(val);
    if (slope < 26 && h < 24) tmp2.lerp(C_GRASS_DRY, dry * 0.5); // dry-grass patches on flats
    // tiny per-vertex sparkle to break banding
    const j = 0.03 * (Math.sin(x * 12.9 + z * 78.2) * 0.5);
    colors[i * 3] = THREE.MathUtils.clamp(tmp2.r + j, 0, 1);
    colors[i * 3 + 1] = THREE.MathUtils.clamp(tmp2.g + j, 0, 1);
    colors[i * 3 + 2] = THREE.MathUtils.clamp(tmp2.b + j, 0, 1);
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = withRim(
    new MeshStandardNodeMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.0,
      flatShading: false,
    }),
    { color: 0xfff0d0, power: 4.0, strength: 0.25 }
  );

  // REAL triplanar rock detail + bump-mapped normals on the cliffs. The biome
  // colour (vertex attribute) is the base; a world-space triplanar rock texture
  // adds albedo detail and (via bumpMap on its luminance) actual surface relief,
  // weighted by steepness so the climbable faces get genuine rock texture while
  // the flat meadow stays clean.
  mat.vertexColors = false;
  const rockTex = sharedRockTexture();
  const baseCol = vec3(attribute("color"));
  const wp = positionWorld;
  const steep = clamp(float(1.0).sub(normalWorld.y), 0.0, 1.0);          // 0 flat -> 1 vertical
  const rock = triplanarTexture(texture(rockTex), null, null, float(0.14), positionWorld, normalWorld);
  const rockL = rock.r.mul(0.5).add(rock.g.mul(0.5));                     // luminance-ish (height)
  // albedo: modulate the biome colour by the rock detail, strongly on cliffs
  const detailMix = steep.mul(0.85).add(0.12);
  let col = baseCol.mul(mix(float(1.0), rockL.mul(2.05), detailMix));
  const macro = sin(wp.x.mul(0.6)).mul(sin(wp.z.mul(0.55))).mul(0.5).add(0.5);
  mat.colorNode = col.mul(mix(float(0.94), float(1.06), macro));
  // bump: derive a perturbed normal from the triplanar rock height (cliffs only)
  const bumpHeight = triplanarTexture(texture(rockTex), null, null, float(0.14), positionWorld, normalWorld).r;
  mat.normalNode = bumpMap(bumpHeight, steep.mul(0.5).add(0.06));

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = "terrain";
  return { mesh };
}
