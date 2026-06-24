import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { heightAt, slopeDeg, WORLD, LAKE } from "../core/noise";
import { standDensity, inVillage } from "./layout";
import { contactDecals } from "./decals";
import { toonFoliage, toonLeafCards } from "./materials";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
const TOWN = { x: 18, z: -6 };

type Parts = { trunk: THREE.BufferGeometry; foliage: THREE.BufferGeometry; cards?: THREE.BufferGeometry; height: number };

/**
 * An organic, NON-spherical canopy lump: an icosphere whose radius is pushed in
 * and out by smooth directional noise, so several of them merge into one leafy
 * mass instead of reading as a stack of clean balloons (the "bubbly" look).
 */
export function noiseHull(rng: () => number, r: number, squash = 0.92): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(r, 2);
  const p1 = rng() * 10, p2 = rng() * 10;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const len = v.length();
    v.normalize();
    const n = 0.22 * Math.sin(v.x * 3.1 + p1)
      + 0.15 * Math.cos(v.y * 4.0 + p2)
      + 0.12 * Math.sin(v.z * 5.0 + v.x * 2.0 + p1)
      + 0.08 * Math.cos((v.x + v.y + v.z) * 6.5 + p2);
    const s = len * (1 + n);
    pos.setXYZ(i, v.x * s, v.y * s * squash, v.z * s);
  }
  g.computeVertexNormals();
  return g;
}

/** Procedural leaf-cluster alpha texture (drawn once on a canvas). */
let _leafTex: THREE.CanvasTexture | null = null;
function leafTexture(): THREE.CanvasTexture {
  if (_leafTex) return _leafTex;
  const N = 128;
  const c = document.createElement("canvas"); c.width = c.height = N;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, N, N);
  let seed = 9173;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  // overlapping leaf ellipses radiating from the centre -> a soft leafy clump
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, dist = rnd() * 38;
    const x = N / 2 + Math.cos(a) * dist, y = N / 2 + Math.sin(a) * dist;
    const rl = 9 + rnd() * 14;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a + (rnd() - 0.5));
    const g = Math.floor(120 + rnd() * 90);
    ctx.fillStyle = `rgba(${40 + Math.floor(rnd() * 45)},${g},${40 + Math.floor(rnd() * 40)},1)`;
    ctx.beginPath(); ctx.ellipse(0, 0, rl * 0.42, rl, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _leafTex = tex;
  return tex;
}

function randUnit(rng: () => number): THREE.Vector3 {
  const u = rng() * 2 - 1, th = rng() * Math.PI * 2, r = Math.sqrt(Math.max(0, 1 - u * u));
  return new THREE.Vector3(r * Math.cos(th), u, r * Math.sin(th));
}

/**
 * Leaf-card canopy: scattered textured quads over the crown volume. Each card's
 * normal is baked to point OUTWARD from the crown centre (spherified) so the
 * whole canopy lights as one coherent volume instead of per-card facets. Alpha
 * comes from the leaf texture (cutout, no sorting). Far less "bubbly" than hulls.
 */
function leafCardCanopy(rng: () => number, crownR: number, crownY: number, count: number, cardSize: number): THREE.BufferGeometry {
  const cards: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const dir = randUnit(rng);
    const rad = crownR * (0.5 + 0.5 * rng());
    const px = dir.x * rad, py = crownY + dir.y * rad * 0.82, pz = dir.z * rad;
    const sz = cardSize * (0.7 + rng() * 0.7);
    const card = new THREE.PlaneGeometry(sz, sz);
    card.rotateZ(rng() * Math.PI);
    card.rotateY(rng() * Math.PI * 2);
    card.rotateX((rng() - 0.5) * 1.3);
    card.translate(px, py, pz);
    // bake outward (spherified) normal
    const out = new THREE.Vector3(px, (py - crownY) * 1.2, pz).normalize();
    const nrm = card.attributes.normal as THREE.BufferAttribute;
    for (let k = 0; k < nrm.count; k++) nrm.setXYZ(k, out.x, out.y, out.z);
    cards.push(card);
  }
  return bakeCanopyAO(mergeGeometries(cards)!);
}

/** Broadleaf: tapered trunk + 2-3 real branches + an irregular multi-lobe canopy. */
function broadleaf(rng: () => number): Parts {
  const h = 2.2 + rng() * 1.4;
  const trunkParts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.14, 0.3, h, 7);
  trunk.translate(0, h / 2, 0);
  trunkParts.push(trunk);

  const branchTops: THREE.Vector3[] = [];
  const nb = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < nb; i++) {
    const bl = 1.0 + rng() * 0.9;
    const ang = rng() * Math.PI * 2;
    const tilt = 0.5 + rng() * 0.5;
    const br = new THREE.CylinderGeometry(0.05, 0.11, bl, 5);
    br.translate(0, bl / 2, 0);
    br.rotateZ(tilt);
    br.rotateY(ang);
    const baseY = h * (0.55 + rng() * 0.3);
    br.translate(0, baseY, 0);
    trunkParts.push(br);
    branchTops.push(new THREE.Vector3(
      Math.cos(ang) * Math.sin(tilt) * bl,
      baseY + Math.cos(tilt) * bl,
      Math.sin(ang) * Math.sin(tilt) * bl
    ));
  }

  // Crown = small solid inner core (blocks see-through) + scattered leaf cards.
  const crownY = h + 0.9;
  const crownR = 1.85 + rng() * 0.3;
  const core = noiseHull(rng, crownR * 0.66, 0.92); core.translate(0, crownY, 0);
  bakeCanopyAO(core);
  const cards = leafCardCanopy(rng, crownR, crownY, 26, 1.25); // fewer, larger cards = leafy w/ less overdraw
  return { trunk: mergeGeometries(trunkParts)!, foliage: core, cards, height: h + 2 };
}

/**
 * Bake a soft top-to-bottom ambient-occlusion gradient into the canopy as a
 * per-vertex "fAO" attribute. The toon-foliage shader multiplies by it so the
 * underside of the crown is shaded and the top catches light — the difference
 * between a flat green blob and a canopy with real volume.
 */
export function bakeCanopyAO(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const minY = bb.min.y, range = Math.max(0.001, bb.max.y - bb.min.y);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const ao = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minY) / range;          // 0 bottom -> 1 top
    ao[i] = 0.5 + 0.55 * (t * t * (3 - 2 * t));        // smoothstep: dark base, bright crown
  }
  geo.setAttribute("fAO", new THREE.BufferAttribute(ao, 1));
  return geo;
}

/** Conifer: tall trunk + many overlapping cone tiers (a full, layered fir). */
function conifer(rng: () => number): Parts {
  const h = 4.5 + rng() * 2.5;
  const trunk = new THREE.CylinderGeometry(0.1, 0.26, h, 6);
  trunk.translate(0, h / 2, 0);
  const tiers: THREE.BufferGeometry[] = [];
  const nt = 8 + Math.floor(rng() * 3); // denser, more overlap -> reads as foliage not stacked cones
  for (let i = 0; i < nt; i++) {
    const t = i / (nt - 1);
    const cr = 2.2 * (1 - t * 0.82) * (0.92 + rng() * 0.16);
    const ch = 1.7 - t * 0.5;
    const seg = 9;
    const cone = new THREE.ConeGeometry(cr, ch, seg);
    // tiny per-tier wobble so tiers aren't a perfect cone-stack
    cone.rotateY(rng() * Math.PI);
    cone.translate((rng() - 0.5) * 0.12, h * 0.2 + t * h * 0.74, (rng() - 0.5) * 0.12);
    tiers.push(cone);
  }
  return { trunk, foliage: mergeGeometries(tiers)!, height: h };
}

/** Birch: slim pale trunk + an airy, taller cohesive canopy. */
function birch(rng: () => number): Parts {
  const h = 3.2 + rng() * 1.6;
  const trunk = new THREE.CylinderGeometry(0.09, 0.15, h, 6);
  trunk.translate(0, h / 2, 0);
  const cY = h + 0.7;
  const crownR = 1.2 + rng() * 0.25;
  const core = noiseHull(rng, crownR * 0.66, 1.1); core.translate(0, cY, 0);
  bakeCanopyAO(core);
  const cards = leafCardCanopy(rng, crownR, cY, 16, 1.0);
  return { trunk, foliage: core, cards, height: h + 1.5 };
}

export function buildTrees(scene: THREE.Scene) {
  const rng = mulberry32(20260618);

  // Distinct species/variants — each gets a bark material + a toon-foliage material.
  const barkBrown = new MeshStandardNodeMaterial({ color: "#6b4a30", roughness: 1, flatShading: true });
  const barkBirch = new MeshStandardNodeMaterial({ color: "#d9d2c4", roughness: 1, flatShading: true });

  const leafTex = leafTexture();
  const mk = (parts: Parts, bark: MeshStandardNodeMaterial, base: string, rim: number, weight: number) => ({
    parts, bark, fol: toonFoliage(base, rim),
    leaf: parts.cards ? toonLeafCards(base, rim, leafTex) : null,
    weight,
  });
  const variants = [
    mk(broadleaf(rng), barkBrown, "#7cba4e", 0xd2f08a, 3),
    mk(broadleaf(rng), barkBrown, "#92cb5c", 0xe0f79c, 3),
    mk(broadleaf(rng), barkBrown, "#6cab4c", 0xc4ec84, 2),
    mk(conifer(rng), barkBrown, "#5c9c54", 0xa9da7a, 3),
    mk(conifer(rng), barkBrown, "#52924a", 0x9fd070, 2),
    mk(birch(rng), barkBirch, "#9bce63", 0xe6faa4, 1),
  ];
  variants.forEach((v) => bakeCanopyAO(v.parts.foliage)); // top-lit / shaded-underside volume
  const totalW = variants.reduce((s, v) => s + v.weight, 0);
  const pickVariant = () => {
    let r = rng() * totalW;
    for (const v of variants) { r -= v.weight; if (r <= 0) return v; }
    return variants[0];
  };

  // Placement
  const trunkMats: THREE.Matrix4[][] = variants.map(() => []);
  const folMats: THREE.Matrix4[][] = variants.map(() => []);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  const decals: { x: number; y: number; z: number; r: number }[] = [];
  let placed = 0, tries = 0;
  const TARGET = 420;
  while (placed < TARGET && tries < TARGET * 12) {
    tries++;
    const x = (rng() - 0.5) * WORLD.size * 0.94;
    const z = (rng() - 0.5) * WORLD.size * 0.94;
    const h = heightAt(x, z);
    if (h < LAKE.level + 1.2 || h > 44) continue;
    if (slopeDeg(x, z) > 26) continue;
    if (dist(x, z, LAKE.x, LAKE.z) < LAKE.r + 3) continue;
    if (inVillage(x, z, 4)) continue;
    // cluster into forest stands (dense woods) with sparse scatter between
    if (rng() > standDensity(x, z)) continue;

    const vi = variants.indexOf(pickVariant());
    const sc = 0.8 + rng() * 0.6;
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    s.set(sc, sc * (0.95 + rng() * 0.2), sc);
    p.set(x, h, z);
    const mat = m.clone().compose(p, q, s);
    trunkMats[vi].push(mat);
    folMats[vi].push(mat);
    decals.push({ x, y: h, z, r: 1.1 + sc });
    placed++;
  }
  contactDecals(scene, decals);

  const updates: (() => void)[] = [];
  variants.forEach((v, i) => {
    if (!trunkMats[i].length) return;
    const tInst = new THREE.InstancedMesh(v.parts.trunk, v.bark, trunkMats[i].length);
    trunkMats[i].forEach((mm, k) => tInst.setMatrixAt(k, mm));
    tInst.castShadow = true; tInst.receiveShadow = true;
    scene.add(tInst);

    const fInst = new THREE.InstancedMesh(v.parts.foliage, v.fol.mat, folMats[i].length);
    folMats[i].forEach((mm, k) => fInst.setMatrixAt(k, mm));
    fInst.castShadow = true;
    scene.add(fInst);
    updates.push(v.fol.update);

    // leaf cards (alpha-cutout) over the core. The solid core already casts the
    // canopy shadow, so cards skip shadow-casting (the alpha-test shadow pass is
    // the costly part) — recovers most of the frame budget for a leafier look.
    if (v.parts.cards && v.leaf) {
      const cInst = new THREE.InstancedMesh(v.parts.cards, v.leaf.mat, folMats[i].length);
      folMats[i].forEach((mm, k) => cInst.setMatrixAt(k, mm));
      cInst.castShadow = false;
      scene.add(cInst);
    }
  });

  console.log(`[trees] ${placed} trees across ${variants.length} variants`);
  return { update: () => updates.forEach((u) => u()) };
}
