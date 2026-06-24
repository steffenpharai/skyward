import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  positionLocal, instanceIndex, length, sin, smoothstep, vec3, float, color,
  normalWorld, normalize, max, dot,
} from "../nodes/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { heightAt, slopeDeg, LAKE } from "../core/noise";
import { env } from "../core/env";
import { windSway } from "../core/wind";
import { applyFog } from "../nodes/fog";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A flower: thin stem + 5 soft rounded petals tilted into a bowl + a domed center. */
function flowerGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const stem = new THREE.CylinderGeometry(0.012, 0.018, 0.34, 4);
  stem.translate(0, 0.17, 0);
  parts.push(stem);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const petal = new THREE.SphereGeometry(0.075, 7, 4); // flattened, elongated -> soft petal
    petal.scale(0.5, 0.16, 1.0);
    petal.translate(0, 0, 0.085);
    petal.rotateX(-0.5);   // tilt the outer tip up into a bowl
    petal.rotateY(a);
    petal.translate(0, 0.35, 0);
    parts.push(petal);
  }
  const center = new THREE.SphereGeometry(0.035, 7, 5);
  center.scale(1, 0.7, 1);
  center.translate(0, 0.37, 0);
  parts.push(center);
  return mergeGeometries(parts)!;
}

const PALETTE: [number, number][] = [
  [0xef4f68, 0xffd23a], [0xf3a52c, 0xfff0a0], [0xfbf6ee, 0xffcf3a],
  [0x9a55ea, 0xffe07a], [0x3f9fec, 0xfff0a0], [0xff7a3a, 0xffe07a],
];

export function buildFlowers(scene: THREE.Scene): { update: (t: number) => void } {
  const rng = mulberry32(31337);
  const base = flowerGeo();

  const vY = positionLocal.y;
  const vR = length(positionLocal.xz);

  const mats: MeshBasicNodeMaterial[] = PALETTE.map(([petalHex, ctrHex]) => {
    const mat = new MeshBasicNodeMaterial({ side: THREE.DoubleSide, fog: false });
    // gentle wobble from the ONE shared wind field (height-weighted to the stem)
    const hf = smoothstep(0.0, 0.4, positionLocal.y);
    mat.positionNode = positionLocal.add(windSway(positionLocal, float(instanceIndex).mul(0.9), hf, float(0.12)).mul(0.06));

    const uPetal = color(petalHex), uCenter = color(ctrHex), uStem = color(0x6fa048);
    const albedo = vY.lessThan(0.3).select(
      uStem,
      vR.lessThan(0.03).select(vY.greaterThan(0.34).select(uCenter, uPetal), uPetal)
    );
    // real lighting: half-Lambert off the env sun with a bright floor (form, never black)
    const N = normalize(normalWorld);
    const ndl = max(dot(N, normalize(env.u.sunDir)), 0.0).mul(0.5).add(0.62);
    const lit = vec3(albedo).mul(ndl);
    mat.colorNode = applyFog(lit);
    return mat;
  });

  const buckets: THREE.Matrix4[][] = PALETTE.map(() => []);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const TARGET = 2200;
  let tries = 0, placed = 0;
  while (placed < TARGET && tries < TARGET * 8) {
    tries++;
    const x = (rng() - 0.5) * 230;
    const z = (rng() - 0.5) * 230;
    const h = heightAt(x, z);
    if (h < LAKE.level + 1.2 || h > 24 || slopeDeg(x, z) > 22) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 2) continue;
    const clump = Math.sin(x * 0.6) * Math.cos(z * 0.5) * 0.5 + 0.5;
    if (rng() > 0.12 + clump * 0.8) continue;
    const sc = 0.8 + rng() * 0.8;
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    s.set(sc, sc, sc);
    p.set(x, h, z);
    buckets[Math.floor(rng() * PALETTE.length)].push(m.clone().compose(p, q, s));
    placed++;
  }

  buckets.forEach((arr, i) => {
    if (!arr.length) return;
    const inst = new THREE.InstancedMesh(base, mats[i], arr.length);
    arr.forEach((mm, k) => inst.setMatrixAt(k, mm));
    inst.frustumCulled = false;
    inst.castShadow = false;
    scene.add(inst);
  });
  console.log(`[flowers] ${placed}`);
  return { update: (_t: number) => {} };
}
