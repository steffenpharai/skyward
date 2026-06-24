/**
 * The Atelier — the agents author and EVOLVE their entire living environment.
 *
 * This is the agents' world: they don't just place trinkets, they compose
 * everything in it — groves, flower beds, gardens, megaliths, light-sculptures,
 * lantern fields, ponds. Each "work" is grown from a `Genome`. A hidden
 * aesthetic-fitness model (colour harmony, golden-ratio proportion, tasteful
 * glow, complexity sweet-spot, symmetry, vibrancy) scores it. Agents mutate /
 * cross-breed genomes, keep what scores higher, and SHARE their best into a
 * collective StylePool — so good taste propagates between artisans and the world
 * grows more beautiful and coherent over generations. Humans live inside this
 * agent-authored, ever-evolving environment (and can direct + curate it).
 *
 * Real evolutionary + cultural-learning pressure, expressed in Three.js: emissive
 * → bloom, instanced/symmetric arrangements, transparency, motion, living flora.
 */
import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { heightAt } from "../../core/noise";

export type WorkKind = "grove" | "flowerbed" | "garden" | "lightsculpt" | "stonering" | "lanterns" | "pond";
const KINDS: WorkKind[] = ["grove", "flowerbed", "garden", "lightsculpt", "stonering", "lanterns", "pond"];
type LightForm = "crystal" | "spire" | "bloom" | "ring";
const LIGHTFORMS: LightForm[] = ["crystal", "spire", "bloom", "ring"];

export interface Genome {
  kind: WorkKind;
  lightForm: LightForm;   // sub-form when kind === lightsculpt
  palette: number[];      // related hues (hex)
  emissiveStr: number;
  count: number;
  radius: number;
  height: number;
  twist: number;
  symmetry: number;
  scaleRatio: number;     // tier scale ratio (golden ≈ 1.618 ideal)
  motion: "none" | "rotate" | "bob" | "pulse";
}

// ---- colour helpers ----
function hsl(h: number, s: number, l: number): number { return new THREE.Color().setHSL(h, s, l).getHex(); }
function getHSL(hex: number) { const o = { h: 0, s: 0, l: 0 }; new THREE.Color(hex).getHSL(o); return o; }
function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }
function bell(x: number, mu: number, sigma: number) { const d = (x - mu) / sigma; return Math.exp(-0.5 * d * d); }

// ---- aesthetic fitness (the hidden taste model — applies to the whole work) ----
export function fitness(g: Genome): number {
  const hs = g.palette.map((h) => getHSL(h).h);
  let harmony = 0, pairs = 0;
  for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
    let d = Math.abs(hs[i] - hs[j]); d = Math.min(d, 1 - d) * 360;
    harmony += Math.max(bell(d, 0, 12), bell(d, 40, 18), bell(d, 120, 22), bell(d, 180, 22)); pairs++;
  }
  harmony = pairs ? harmony / pairs : 0.5;
  const proportion = 1 - Math.min(1, Math.abs(g.scaleRatio - 1.618) / 1.1);
  const complexity = bell(g.count, 7, 3.2);
  const order = bell(g.symmetry, 5, 2.6);
  const vibrancy = g.palette.reduce((a, h) => a + getHSL(h).s, 0) / g.palette.length;
  // glow only matters for luminous works; natural works are judged on form/colour
  const luminous = g.kind === "lightsculpt" || g.kind === "lanterns" || g.kind === "garden";
  const glow = luminous ? bell(g.emissiveStr, 1.7, 0.9) : 0.6;
  return clamp01(harmony * 0.32 + proportion * 0.15 + complexity * 0.14 + glow * 0.12 + order * 0.1 + vibrancy * 0.17);
}

// ---- genome generation / evolution ----
let _seed = 1337;
function rnd() { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; }
function pick<T>(a: T[]): T { return a[Math.floor(rnd() * a.length)]; }

export function randomGenome(): Genome {
  const baseHue = rnd();
  const scheme = pick([0, 40 / 360, 120 / 360, 180 / 360]);
  return {
    kind: pick(KINDS),
    lightForm: pick(LIGHTFORMS),
    palette: [hsl(baseHue, 0.55 + rnd() * 0.35, 0.5 + rnd() * 0.15),
              hsl((baseHue + scheme) % 1, 0.55 + rnd() * 0.35, 0.55 + rnd() * 0.15),
              hsl((baseHue + scheme * 1.7) % 1, 0.5 + rnd() * 0.3, 0.6)],
    emissiveStr: 0.8 + rnd() * 2,
    count: 3 + Math.floor(rnd() * 9),
    radius: 1.2 + rnd() * 2.2,
    height: 1.5 + rnd() * 3.5,
    twist: rnd() * 2,
    symmetry: 2 + Math.floor(rnd() * 7),
    scaleRatio: 1.2 + rnd() * 0.9,
    motion: pick(["none", "rotate", "bob", "pulse"] as const),
  };
}

function mut(v: number, amt: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v + (rnd() - 0.5) * amt)); }
function mutate(g: Genome): Genome {
  const n: Genome = { ...g, palette: [...g.palette] };
  n.emissiveStr = mut(n.emissiveStr, 0.8, 0.4, 3.2);
  n.count = Math.round(mut(n.count, 3, 3, 12));
  n.radius = mut(n.radius, 0.6, 1, 3.4);
  n.height = mut(n.height, 0.9, 1, 5.5);
  n.twist = mut(n.twist, 0.5, 0, 2.5);
  n.symmetry = Math.round(mut(n.symmetry, 2, 2, 8));
  n.scaleRatio = mut(n.scaleRatio, 0.25, 1.05, 2.2);
  if (rnd() < 0.18) n.kind = pick(KINDS);
  if (rnd() < 0.2) n.lightForm = pick(LIGHTFORMS);
  if (rnd() < 0.28) { const i = Math.floor(rnd() * n.palette.length); const o = getHSL(n.palette[i]); n.palette[i] = hsl((o.h + (rnd() - 0.5) * 0.1 + 1) % 1, clamp01(o.s + (rnd() - 0.5) * 0.2), clamp01(o.l + (rnd() - 0.5) * 0.15)); }
  if (rnd() < 0.15) n.motion = pick(["none", "rotate", "bob", "pulse"] as const);
  return n;
}
function crossover(a: Genome, b: Genome): Genome {
  return {
    kind: rnd() < 0.5 ? a.kind : b.kind, lightForm: rnd() < 0.5 ? a.lightForm : b.lightForm,
    palette: rnd() < 0.5 ? [...a.palette] : [...b.palette],
    emissiveStr: (a.emissiveStr + b.emissiveStr) / 2, count: Math.round((a.count + b.count) / 2),
    radius: (a.radius + b.radius) / 2, height: (a.height + b.height) / 2,
    twist: rnd() < 0.5 ? a.twist : b.twist, symmetry: rnd() < 0.5 ? a.symmetry : b.symmetry,
    scaleRatio: (a.scaleRatio + b.scaleRatio) / 2, motion: rnd() < 0.5 ? a.motion : b.motion,
  };
}

/** Collective aesthetic memory — artisans contribute + draw from it, so taste spreads. */
export class StylePool {
  private pool: { g: Genome; fit: number }[] = [];
  best(): number { return this.pool[0]?.fit ?? 0; }
  size(): number { return this.pool.length; }
  contribute(g: Genome, fit: number) { this.pool.push({ g, fit }); this.pool.sort((a, b) => b.fit - a.fit); this.pool = this.pool.slice(0, 16); }
  sample(): Genome | null { return this.pool.length ? this.pool[Math.floor(Math.pow(rnd(), 2) * this.pool.length)].g : null; }
  evolve(ownBest: Genome | null): { genome: Genome; fit: number } {
    const base = ownBest ?? randomGenome();
    const cands = [mutate(base), randomGenome()];
    const peer = this.sample();
    if (peer) cands.push(crossover(base, peer), mutate(peer));   // LEARN from peers
    let best = cands[0], bf = fitness(best);
    for (const c of cands) { const f = fitness(c); if (f > bf) { bf = f; best = c; } }
    return { genome: best, fit: bf };
  }
}
export const atelier = new StylePool();

// ---- materials ----
function glowMat(c: number, s: number) { const m = new MeshStandardNodeMaterial({ color: c, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.95 }); m.emissive = new THREE.Color(c); (m as any).emissiveIntensity = s; return m; }
function mat(c: number, rough = 0.85, metal = 0) { return new MeshStandardNodeMaterial({ color: c, roughness: rough, metalness: metal, flatShading: true }); }
function darken(hex: number, f: number) { const o = getHSL(hex); return hsl(o.h, o.s, o.l * f); }

// ---- the builder: the agents grow EVERYTHING in their environment ----
export function buildWork(g: Genome): THREE.Group {
  const grp = new THREE.Group();
  const add = (m: THREE.Object3D) => { (m as THREE.Mesh).castShadow = true; grp.add(m); return m; };
  const ring = (n: number, fn: (a: number, i: number) => void) => { for (let i = 0; i < n; i++) fn((i / n) * Math.PI * 2, i); };
  const P = g.palette, glow = P.map((c, i) => glowMat(c, g.emissiveStr * (i ? 0.7 : 1)));

  switch (g.kind) {
    case "grove": {
      const bark = mat(0x5a4126);
      let s = 1;
      ring(Math.max(3, g.count), (a, i) => {
        const r = g.radius * (0.4 + (i % 2) * 0.5);
        const x = Math.cos(a) * r, z = Math.sin(a) * r, h = g.height * s;
        const tr = add(new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.18 * s, h, 6), bark)); tr.position.set(x, h / 2, z);
        const can = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.7 * s, 1), mat(P[i % P.length]))); can.position.set(x, h + 0.4 * s, z); can.scale.y = 1.15;
        s /= g.scaleRatio ** 0.25;
      });
      break;
    }
    case "flowerbed": {
      const stem = mat(0x5f8a3a);
      ring(g.count * 2, (a, i) => {
        const r = (0.3 + (i % 3) * 0.3) * g.radius, x = Math.cos(a) * r, z = Math.sin(a) * r;
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.5, 4), stem)).position.set(x, 0.25, z);
        const f = add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), glowMat(P[i % P.length], g.emissiveStr * 0.25))); f.position.set(x, 0.52, z); f.scale.set(1.4, 0.7, 1.4);
      });
      break;
    }
    case "garden": {
      // composed: stone border + flora ring + central light
      const stone = mat(0x8d8478);
      ring(Math.max(6, g.symmetry * 2), (a) => { add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), stone)).position.set(Math.cos(a) * g.radius, 0.12, Math.sin(a) * g.radius); });
      ring(g.count, (a, i) => { const r = g.radius * 0.6; const fl = add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), glowMat(P[i % P.length], g.emissiveStr * 0.3))); fl.position.set(Math.cos(a) * r, 0.5, Math.sin(a) * r); fl.scale.set(1.3, 0.7, 1.3); });
      add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), glow[0])).position.y = 1.0 + g.height * 0.2;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.0, 6), mat(darken(P[0], 0.5)))).position.y = 0.5;
      break;
    }
    case "lightsculpt": buildLightForm(g, grp, glow); break;
    case "stonering": {
      const stone = mat(0x7c776c, 1), moss = mat(0x6f8a4a);
      ring(Math.max(4, g.symmetry), (a) => {
        const x = Math.cos(a) * g.radius, z = Math.sin(a) * g.radius, h = g.height * (0.7 + (rnd() * 0.4));
        add(new THREE.Mesh(new THREE.BoxGeometry(0.4, h, 0.3), stone)).position.set(x, h / 2, z);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.15, 0.32), moss)).position.set(x, h - 0.1, z);
      });
      add(new THREE.Mesh(new THREE.CylinderGeometry(g.radius * 0.4, g.radius * 0.5, 0.2, 12), stone)).position.y = 0.1;
      add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.25, 0), glow[0])).position.y = 0.5;
      break;
    }
    case "lanterns":
      ring(g.count, (a, i) => { const orb = add(new THREE.Mesh(new THREE.SphereGeometry(0.15 + (i % 3) * 0.05, 10, 8), glow[i % glow.length])); orb.position.set(Math.cos(a) * g.radius, 0.8 + (Math.sin(i * 1.7) * 0.5 + 0.5) * g.height, Math.sin(a) * g.radius); });
      break;
    case "pond": {
      const water = new MeshStandardNodeMaterial({ color: P[0], roughness: 0.15, metalness: 0, transparent: true, opacity: 0.7 });
      const disc = add(new THREE.Mesh(new THREE.CircleGeometry(g.radius, 24), water)); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.05;
      const reed = mat(0x6f9a48), pad = mat(P[1] ?? 0x3f7a3a);
      ring(g.count, (a, i) => { const r = g.radius * (0.6 + rnd() * 0.35), x = Math.cos(a) * r, z = Math.sin(a) * r; if (i % 2) { const rd = add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.9, 4), reed)); rd.position.set(x, 0.45, z); } else { const lp = add(new THREE.Mesh(new THREE.CircleGeometry(0.22, 8), pad)); lp.rotation.x = -Math.PI / 2; lp.position.set(x, 0.07, z); } });
      break;
    }
  }

  const plinthN = g.kind === "lightsculpt" || g.kind === "stonering";
  if (plinthN) { const pl = add(new THREE.Mesh(new THREE.CylinderGeometry(g.radius * 0.5 + 0.2, g.radius * 0.6 + 0.25, 0.22, Math.max(6, g.symmetry * 2)), mat(darken(P[P.length - 1], 0.6)))); pl.position.y = 0.11; }
  grp.userData.motion = g.kind === "lightsculpt" ? g.motion : g.kind === "lanterns" ? "bob" : "none";
  return grp;
}

function buildLightForm(g: Genome, grp: THREE.Group, glow: THREE.Material[]) {
  const add = (m: THREE.Object3D) => { (m as THREE.Mesh).castShadow = true; grp.add(m); return m; };
  const ring = (n: number, fn: (a: number, i: number) => void) => { for (let i = 0; i < n; i++) fn((i / n) * Math.PI * 2, i); };
  switch (g.lightForm) {
    case "crystal":
      ring(g.symmetry, (a) => { let s = 1; for (let t = 0; t < Math.max(2, g.count / g.symmetry); t++) { const m = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.28 * s, 0), glow[t % glow.length])); m.position.set(Math.cos(a) * g.radius * 0.4, 0.6 + t * 0.5 * s, Math.sin(a) * g.radius * 0.4); m.rotation.y = a; m.scale.y = 1.8; s /= g.scaleRatio; } });
      break;
    case "spire": { let s = 1, y = 0; for (let t = 0; t < g.count; t++) { const m = add(new THREE.Mesh(new THREE.ConeGeometry(0.4 * s, 0.7 * s, 6), glow[t % glow.length])); m.position.y = y + 0.35 * s; m.rotation.y = g.twist * t; y += 0.55 * s; s /= g.scaleRatio; } break; }
    case "bloom":
      ring(g.count, (a, i) => { const p = add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), glow[i % glow.length])); p.scale.set(0.5, 1, 2.2); p.position.set(Math.cos(a) * g.radius, g.height * 0.4, Math.sin(a) * g.radius); p.rotation.y = -a; p.rotation.z = 0.5; });
      add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 1), glow[0])).position.y = g.height * 0.4;
      break;
    case "ring":
      for (let i = 0; i < Math.min(4, Math.max(2, Math.floor(g.count / 2))); i++) { const t = add(new THREE.Mesh(new THREE.TorusGeometry(g.radius * (1 - i * 0.18), 0.06, 8, 32), glow[i % glow.length])); t.position.y = g.height * 0.5 + i * 0.25; t.rotation.x = Math.PI / 2.2; t.rotation.z = g.twist * i; }
      break;
  }
}

export interface PlacedWork { group: THREE.Group; fitness: number; genome: Genome; phase: number; baseY: number; }

/** Grow a fresh work that LEARNS from the collective pool, place it, share it back. */
export function createBetterOrnament(parent: THREE.Object3D, x: number, z: number, ownBest: Genome | null): PlacedWork {
  const { genome, fit } = atelier.evolve(ownBest);
  atelier.contribute(genome, fit);
  const group = buildWork(genome);
  const y = heightAt(x, z);
  group.position.set(x, y, z);
  parent.add(group);
  return { group, fitness: fit, genome, phase: rnd() * Math.PI * 2, baseY: y };
}

export function animateOrnament(o: PlacedWork, t: number) {
  const m = o.group.userData.motion;
  if (m === "rotate") o.group.rotation.y = t * 0.4 + o.phase;
  else if (m === "bob") o.group.position.y = o.baseY + Math.sin(t * 1.2 + o.phase) * 0.18;
  else if (m === "pulse") o.group.scale.setScalar(1 + Math.sin(t * 2 + o.phase) * 0.05);
}

// kept names for the game layer
export type { PlacedWork as PlacedOrnament };
