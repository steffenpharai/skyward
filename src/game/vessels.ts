/**
 * Stamina Vessels — the BOTW "reach the summit, get rewarded" loop. A handful of
 * glowing vessels sit on the world's highest peaks (deterministic, so everyone's
 * world has them in the same places), DELIBERATELY NOT shown on the minimap — you
 * find them by climbing and looking. Reaching one permanently raises your max
 * stamina, so traversal mastery compounds (taller climbs, longer glides). Persisted
 * via the same one-shot node store; the bonus is re-applied on load.
 */
import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { heightAt, WORLD } from "../core/noise";
import type { Store } from "./state";
import type { Player } from "../player/player";

const COUNT = 6;       // vessels in the world
const BONUS = 15;      // max-stamina per vessel
const REACH = 3.6;     // how close you must get

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

interface LiveVessel { uid: string; pos: THREE.Vector3; mesh: THREE.Group; baseY: number; }

export class StaminaVessels {
  group = new THREE.Group();
  private live: LiveVessel[] = [];
  private collected = 0;

  constructor(scene: THREE.Scene, private store: Store, private player: Player, private onCollect?: (bonus: number, found: number, total: number) => void) {
    this.group.name = "vessels";
    scene.add(this.group);

    // Deterministic summits: sample many candidates, keep the HIGHEST few, spaced apart.
    const rng = mulberry32(424242);
    const cands: { x: number; z: number; h: number }[] = [];
    for (let i = 0; i < 500; i++) {
      const a = rng() * Math.PI * 2, r = 55 + rng() * (WORLD.half - 65);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) > WORLD.half - 8 || Math.abs(z) > WORLD.half - 8) continue;
      cands.push({ x, z, h: heightAt(x, z) });
    }
    cands.sort((p, q) => q.h - p.h);
    const picked: { x: number; z: number }[] = [];
    for (const c of cands) {
      if (picked.length >= COUNT) break;
      if (picked.every((p) => Math.hypot(p.x - c.x, p.z - c.z) > 45)) picked.push(c);
    }

    picked.forEach((c, i) => {
      const uid = `vessel_${i}`;
      if (this.store.isNodeTaken(uid)) { this.collected++; return; }
      const y = heightAt(c.x, c.z) + 1.1;
      const mesh = buildVessel();
      mesh.position.set(c.x, y, c.z);
      this.group.add(mesh);
      this.live.push({ uid, pos: new THREE.Vector3(c.x, y, c.z), mesh, baseY: y });
    });

    // Re-apply persisted bonuses to the player's ceiling.
    this.player.maxStamina = 100 + this.collected * BONUS;
  }

  total() { return COUNT; }
  found() { return this.collected; }

  update(t: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const v = this.live[i];
      v.mesh.position.y = v.baseY + Math.sin(t * 1.5 + i) * 0.16;
      const crystal = v.mesh.userData.crystal as THREE.Mesh | undefined;
      if (crystal) crystal.rotation.y = t * 0.8;
      if (this.player.pos.distanceTo(v.pos) < REACH) {
        this.store.markNodeTaken(v.uid);
        this.group.remove(v.mesh);
        disposeTree(v.mesh);
        this.live.splice(i, 1);
        this.collected++;
        this.player.maxStamina += BONUS;
        this.player.stamina = this.player.maxStamina;   // top off as a reward
        this.onCollect?.(BONUS, this.collected, COUNT);
      }
    }
  }
}

function buildVessel(): THREE.Group {
  const g = new THREE.Group();
  const baseMat = new MeshStandardNodeMaterial({ color: 0x8b9197, roughness: 0.92 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 0.34, 8), baseMat);
  base.position.y = -0.85; base.castShadow = true; g.add(base);
  const crystalMat = new MeshStandardNodeMaterial({ color: 0xc4f6d8, roughness: 0.18, metalness: 0.1 });
  (crystalMat as any).emissive = new THREE.Color(0x5fe0a0); (crystalMat as any).emissiveIntensity = 2.8;
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.46, 0), crystalMat);
  crystal.castShadow = true; g.add(crystal);
  // a faint halo ring
  const ringMat = new MeshStandardNodeMaterial({ color: 0x8ff0c0, roughness: 0.4 });
  (ringMat as any).emissive = new THREE.Color(0x4fd89a); (ringMat as any).emissiveIntensity = 1.6;
  (ringMat as any).transparent = true; (ringMat as any).opacity = 0.7;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.03, 6, 20), ringMat);
  ring.rotation.x = Math.PI / 2; ring.position.y = -0.1; g.add(ring);
  g.userData.crystal = crystal;
  return g;
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as any).material;
    if (Array.isArray(mat)) mat.forEach((x) => x?.dispose?.()); else mat?.dispose?.();
  });
}
