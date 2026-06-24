/**
 * Farming — plant crops on open meadow, they grow in real time (so you return to
 * a grown field, Palia-style), harvest for produce + Farming XP. Persisted to the
 * save by world position + plant time, so growth survives reloads. Both the human
 * and AI agents plant/harvest through the same calls.
 */
import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { heightAt, slopeDeg, LAKE } from "../core/noise";
import { inVillage } from "../world/layout";
import type { Interact } from "./interact";
import type { Store } from "./state";

export const GROW_MS = 75_000;   // ~75s to mature (tweakable; tests backdate plantedAt)
const KINDS = ["wheat", "corn", "pumpkin"];

interface LiveCrop { x: number; z: number; plantedAt: number; kind: string; group: THREE.Group; harvested: boolean; }

function now() { return Date.now(); }
export function cropStage(plantedAt: number): number { return Math.max(0, Math.min(1, (now() - plantedAt) / GROW_MS)); }

export class Farm {
  group = new THREE.Group();
  private crops: LiveCrop[] = [];

  constructor(
    private scene: THREE.Scene,
    private store: Store,
    private interact: Interact,
    private onHarvest: (kind: string) => void,
  ) {
    this.group.name = "farm";
    scene.add(this.group);
    for (const c of this.store.state.crops) this.spawn(c.x, c.z, c.plantedAt, c.kind);
  }

  /** Is this open ground a valid place to sow? */
  plantableAt(x: number, z: number): boolean {
    if (slopeDeg(x, z) > 12) return false;
    if (inVillage(x, z, 2)) return false;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 3) return false;
    if (heightAt(x, z) < LAKE.level + 1) return false;
    for (const c of this.crops) if (!c.harvested && Math.hypot(c.x - x, c.z - z) < 1.6) return false;
    return true;
  }

  /** Sow a crop (free — wild seeds). Returns the kind, or null if not plantable. */
  plant(x: number, z: number, kind = KINDS[Math.floor((x * 7 + z * 13) % KINDS.length + KINDS.length) % KINDS.length]): string | null {
    if (!this.plantableAt(x, z)) return null;
    const plantedAt = now();
    this.store.state.crops.push({ x, z, plantedAt, kind });
    this.store.save();
    this.spawn(x, z, plantedAt, kind);
    return kind;
  }

  private spawn(x: number, z: number, plantedAt: number, kind: string) {
    const g = new THREE.Group();
    g.position.set(x, heightAt(x, z), z);
    const stemMat = new MeshStandardNodeMaterial({ color: 0x5f8a3a, roughness: 1 });
    const headMat = new MeshStandardNodeMaterial({ color: cropColor(kind, 0), roughness: 1, flatShading: true });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.6, 4), stemMat);
      stem.position.set(Math.cos(a) * 0.18, 0.3, Math.sin(a) * 0.18); stem.castShadow = true; g.add(stem);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), headMat);
      head.position.set(Math.cos(a) * 0.18, 0.62, Math.sin(a) * 0.18); head.scale.set(0.8, 1.4, 0.8); g.add(head);
    }
    this.group.add(g);
    const crop: LiveCrop = { x, z, plantedAt, kind, group: g, harvested: false };
    this.crops.push(crop);

    this.interact.add({
      pos: new THREE.Vector3(x, heightAt(x, z) + 0.5, z),
      radius: 2.6,
      enabled: () => !crop.harvested && cropStage(crop.plantedAt) >= 1,
      label: () => `Harvest ${kind} (E)`,
      act: () => this.harvest(crop),
    });
  }

  private harvest(crop: LiveCrop) {
    if (crop.harvested || cropStage(crop.plantedAt) < 1) return;
    crop.harvested = true;
    this.group.remove(crop.group);
    const i = this.store.state.crops.findIndex((c) => c.x === crop.x && c.z === crop.z && c.plantedAt === crop.plantedAt);
    if (i >= 0) this.store.state.crops.splice(i, 1);
    this.store.save();
    this.onHarvest(crop.kind);
  }

  /** Harvest the nearest mature crop within range (agents). Returns the kind or null. */
  harvestNearest(pos: THREE.Vector3, radius = 2.6): string | null {
    let best: LiveCrop | null = null, bd = radius;
    for (const c of this.crops) { if (c.harvested || cropStage(c.plantedAt) < 1) continue; const d = Math.hypot(c.x - pos.x, c.z - pos.z); if (d < bd) { bd = d; best = c; } }
    if (!best) return null; const k = best.kind; this.harvest(best); return k;
  }

  /** Advance growth visuals: scale up + ripen the heads toward harvest colour. */
  update() {
    for (const c of this.crops) {
      if (c.harvested) continue;
      const s = cropStage(c.plantedAt);
      c.group.scale.set(1, 0.35 + s * 0.65, 1);
      const ripe = cropColor(c.kind, s);
      c.group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry?.type === "SphereGeometry") ((m.material as any).color as THREE.Color).setHex(ripe); });
    }
  }
}

function cropColor(kind: string, stage: number): number {
  const young = new THREE.Color(0x7aa84a);
  const ripeC = new THREE.Color(kind === "pumpkin" ? 0xe07a2a : kind === "corn" ? 0xf2c23a : 0xe6c34a);
  return young.clone().lerp(ripeC, stage).getHex();
}
