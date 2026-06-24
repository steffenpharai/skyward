import * as THREE from "three";
import {
  attribute, positionLocal, cameraPosition, positionWorld, vec3, float, sin, cos,
  clamp, mix, smoothstep, max, dot, normalize, pow, color, length,
} from "../nodes/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { heightAt, slopeDeg, normalAt, LAKE } from "../core/noise";
import { env } from "../core/env";
import { windSway, windParams } from "../core/wind";
import { applyFog } from "../nodes/fog";

// Deterministic RNG
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A single curved, tapered blade (3 segments, ~7 verts), base at origin, +Y up, faces +Z. */
function bladeGeometry(): THREE.BufferGeometry {
  const lvls = [0.0, 0.34, 0.64, 0.86, 1.0];
  const wid = [0.055, 0.046, 0.034, 0.02, 0.0];
  const verts: number[] = [];
  const tris: number[] = [];
  for (let i = 0; i < lvls.length; i++) {
    const y = lvls[i], w = wid[i];
    if (w > 0) { verts.push(-w, y, 0, w, y, 0); }
    else { verts.push(0, y, 0); }
  }
  for (let i = 0; i < 3; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    tris.push(a, c, b, b, c, d);
  }
  tris.push(6, 8, 7);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(tris);
  g.computeVertexNormals();
  return g;
}

export function buildGrass(scene: THREE.Scene) {
  const rng = mulberry32(7777);
  const base = bladeGeometry();

  const RADIUS = 135;
  const TILE = 18;
  const PER_TILE = 2600;
  const tiles: THREE.Mesh[] = [];

  const mat = new MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });

  // ---- TSL: per-blade attributes ----
  const aOffset = attribute("aOffset", "vec3");
  const aRot = attribute("aRot", "float");
  const aScale = attribute("aScale", "float");
  const aBend = attribute("aBend", "float");
  const aTint = attribute("aTint", "vec3");

  // ---- vertex: rotate + scale + shared wind ----
  const cR = cos(aRot), sR = sin(aRot);
  const sx = positionLocal.x.mul(aScale);
  const sy = positionLocal.y.mul(aScale);
  const rx = sx.mul(cR).sub(positionLocal.z.mul(sR));
  const rz = sx.mul(sR).add(positionLocal.z.mul(cR));
  const hf = clamp(positionLocal.y, 0.0, 1.0);
  const hh = hf.mul(hf);
  const sway = windSway(aOffset, aRot, hh, float(0.12));
  const bendOff = vec3(windParams.dir.x, 0.0, windParams.dir.y).mul(aBend.mul(hh));
  const worldPos = aOffset.add(vec3(rx, sy, rz)).add(sway).add(bendOff);
  const dip = length(sway).mul(0.15).mul(aScale);
  mat.positionNode = worldPos.sub(vec3(0.0, dip, 0.0)); // mesh is at origin -> local == world

  // ---- fragment: grounded, non-LED grass ----
  // albedo: DARK grounded root -> bright tip (a baked AO/value ramp grounds the blade)
  const uRoot = color(0x46632e), uMid = color(0x77a546), uTip = color(0xc2e577), uDry = color(0xbbb35c);
  const vH = clamp(positionLocal.y, 0.0, 1.0);
  let albedo = mix(uRoot, uMid, smoothstep(0.0, 0.5, vH));
  albedo = mix(albedo, uTip, smoothstep(0.45, 1.0, vH));
  albedo = mix(albedo, uDry, aTint.x.mul(0.45));
  albedo = albedo.mul(float(0.9).add(aTint.y.mul(0.18))); // per-clump value jitter

  // PER-BLADE normal from the blade's yaw -> blades at different rotations catch the
  // sun differently. This spatial variation is what kills the flat "LED" look (a
  // single constant normal made every blade the same brightness).
  const bn = normalize(vec3(sin(aRot).mul(0.55), 0.74, cos(aRot).mul(0.55)));
  const L = normalize(env.u.sunDir);
  const ndl = max(dot(bn, L), 0.0);

  // Ambient tied to the scene (hemisphere + ambient from env) so grass sits in the
  // SAME light as everything else instead of self-glowing. Modest floor (not 0.75).
  const up = clamp(bn.y.mul(0.5).add(0.5), 0.0, 1.0);
  const amb = mix(vec3(env.u.hemiGround), vec3(env.u.hemiSky), up)
    .mul(env.u.hemiIntensity.mul(0.42))
    .add(vec3(env.u.ambient).mul(env.u.ambientIntensity));
  const sun = vec3(env.u.sunColor).mul(env.u.sunIntensity.mul(0.14)).mul(ndl);
  let lit = albedo.mul(amb.add(sun));

  // extra occlusion right at the base (contact darkening where blades meet ground)
  lit = lit.mul(mix(float(0.62), float(1.0), smoothstep(0.0, 0.5, vH)));

  // large-scale cloud-dapple value variation -> breaks the uniform field (cheap, no PCF)
  const macro = sin(positionWorld.x.mul(0.035)).mul(sin(positionWorld.z.mul(0.03))).mul(0.5).add(0.5);
  lit = lit.mul(mix(float(0.8), float(1.0), macro));

  // backlit translucency ONLY when looking toward the sun through the blade (rim accent)
  const viewDir = normalize(cameraPosition.sub(positionWorld));
  const back = pow(clamp(dot(viewDir, L), 0.0, 1.0), 4.0).mul(vH).mul(0.3);
  lit = lit.add(vec3(env.u.sunColor).mul(back).mul(vec3(1.0, 0.92, 0.6)));

  mat.colorNode = applyFog(lit);

  const grassable = (x: number, z: number) => {
    const h = heightAt(x, z);
    if (h < LAKE.level + 1.0 || h > 30) return false;
    if (slopeDeg(x, z) > 26) return false;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 2) return false;
    return true;
  };

  const nTiles = Math.ceil((RADIUS * 2) / TILE);
  for (let ti = 0; ti < nTiles; ti++) {
    for (let tj = 0; tj < nTiles; tj++) {
      const cx = -RADIUS + (ti + 0.5) * TILE;
      const cz = -RADIUS + (tj + 0.5) * TILE;
      if (Math.hypot(cx, cz) > RADIUS) continue;

      const offsets: number[] = [], rots: number[] = [], scales: number[] = [];
      const bends: number[] = [], tints: number[] = [];
      let count = 0;
      for (let k = 0; k < PER_TILE; k++) {
        const x = cx + (rng() - 0.5) * TILE;
        const z = cz + (rng() - 0.5) * TILE;
        const clump = Math.sin(x * 0.5) * Math.cos(z * 0.45) * 0.5 + 0.5;
        if (rng() > 0.35 + clump * 0.6) continue;
        if (!grassable(x, z)) continue;
        const y = heightAt(x, z);
        offsets.push(x, y, z);
        rots.push(rng() * Math.PI * 2);
        scales.push(0.5 + rng() * 0.7);
        bends.push((rng() - 0.5) * 0.3);
        const dry = clump > 0.7 ? rng() * 0.5 : rng() * 0.12;
        tints.push(dry, rng(), 0);
        count++;
      }
      if (count === 0) continue;

      const geo = new THREE.InstancedBufferGeometry();
      geo.index = base.index;
      geo.attributes.position = base.attributes.position;
      geo.setAttribute("aOffset", new THREE.InstancedBufferAttribute(new Float32Array(offsets), 3));
      geo.setAttribute("aRot", new THREE.InstancedBufferAttribute(new Float32Array(rots), 1));
      geo.setAttribute("aScale", new THREE.InstancedBufferAttribute(new Float32Array(scales), 1));
      geo.setAttribute("aBend", new THREE.InstancedBufferAttribute(new Float32Array(bends), 1));
      geo.setAttribute("aTint", new THREE.InstancedBufferAttribute(new Float32Array(tints), 3));
      geo.instanceCount = count;

      const mesh = new THREE.Mesh(geo, mat);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, heightAt(cx, cz) + 1, cz), TILE * 0.9 + 2);
      mesh.frustumCulled = true;
      scene.add(mesh);
      tiles.push(mesh);
    }
  }

  let total = 0;
  tiles.forEach((t) => (total += (t.geometry as THREE.InstancedBufferGeometry).instanceCount));
  console.log(`[grass] ${tiles.length} tiles, ${total} blades`);

  return { update: (_t: number) => {} }; // wind/time now flow through env.u.time
}
