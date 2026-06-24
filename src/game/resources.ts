/**
 * Resource nodes — the gatherable layer. Spawns small procedural meshes from the
 * resolved content data, each with a soft glowing marker (reads as "collect me",
 * blooms via the post stack) and an Interactable. Press E in range to gather.
 */
import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import type { Interact } from "./interact";
import type { Store } from "./state";
import type { ContentPack, ResourceModel } from "./content/types";
import { resolveNodes, item } from "./content";
import { itemSkill } from "./skills";

interface LiveNode {
  uid: string;
  item: string;
  amount: number;
  group: THREE.Group;
  marker: THREE.Mesh;
  baseY: number;
  phase: number;
  taken: boolean;
  respawnSec?: number;   // undefined = one-shot (permanent); set = renewable
  respawnAt?: number;    // performance.now() ms when a renewable node regrows
}

export class Resources {
  group = new THREE.Group();
  private nodes: LiveNode[] = [];
  private phase = 0;

  constructor(
    scene: THREE.Scene,
    private store: Store,
    private interact: Interact,
    private onGather?: (itemId: string, amount: number) => void,
  ) {
    this.group.name = "resources";
    scene.add(this.group);
  }

  /** Spawn one content pack's resource nodes (called per loaded era). */
  addPack(pack: ContentPack) {
    for (const rn of resolveNodes(pack)) {
      // One-shot nodes that were already gathered stay gone (persisted). Renewable
      // nodes (respawnSec set) always spawn — they regrow, so a returning player
      // finds a living, replenished valley rather than a depleted checklist.
      if (!rn.def.respawnSec && this.store.isNodeTaken(rn.uid)) continue;
      const def = rn.def;
      const it = item(def.item);

      const g = buildModel(def.model, it.color);
      g.position.set(rn.x, rn.y, rn.z);
      g.rotation.y = (rn.x * 12.9898 + rn.z * 78.233) % (Math.PI * 2);

      const marker = makeMarker(it.color);
      marker.position.y = modelHeight(def.model) + 0.5;
      g.add(marker);
      this.group.add(g);

      const live: LiveNode = { uid: rn.uid, item: def.item, amount: def.amount, group: g, marker, baseY: marker.position.y, phase: (this.phase += 1.7), taken: false, respawnSec: def.respawnSec };
      this.nodes.push(live);

      const worldPos = new THREE.Vector3(rn.x, rn.y + 0.5, rn.z);
      this.interact.add({
        pos: worldPos,
        radius: 3.2,
        enabled: () => !live.taken,
        label: () => `Gather ${it.name} (E)`,
        act: () => this.gather(live, def.item, def.amount),
      });
    }
  }

  private gather(live: LiveNode, itemId: string, amount: number) {
    if (live.taken) return;
    live.taken = true;
    // Skill-scaled yield: every 2 levels of the relevant skill adds +1 to the haul,
    // so leveling up MEANS something (mastery → better returns), not just a toast.
    const got = amount + Math.floor(this.store.skillLevel(itemSkill(itemId)) / 2);
    this.store.addItem(itemId, got);
    if (live.respawnSec) {
      // renewable: hide + schedule regrowth; the interactable auto-disables via !taken
      live.group.visible = false;
      live.respawnAt = performance.now() + live.respawnSec * 1000;
    } else {
      this.store.markNodeTaken(live.uid);   // one-shot: permanently gathered (persisted)
      this.group.remove(live.group);
      disposeTree(live.group);
    }
    this.onGather?.(itemId, got);
  }

  /** Live node positions + colours for the minimap. */
  minimapPoints(): { x: number; z: number; color: number }[] {
    const out: { x: number; z: number; color: number }[] = [];
    for (const n of this.nodes) if (!n.taken) out.push({ x: n.group.position.x, z: n.group.position.z, color: item(n.item).color });
    return out;
  }

  /** Count of remaining (ungathered) nodes per item — for the agent observation. */
  remaining(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const n of this.nodes) if (!n.taken) out[n.item] = (out[n.item] ?? 0) + 1;
    return out;
  }

  /** World position of the nearest ungathered node of an item (for agent navigation).
   *  Horizontal distance — terrain height varies wildly (cliff nodes), so 3D would mislead. */
  nearestNodePos(item: string, from: THREE.Vector3): THREE.Vector3 | null {
    let best: LiveNode | null = null, bd = Infinity;
    for (const n of this.nodes) {
      if (n.taken || n.item !== item) continue;
      const d = Math.hypot(n.group.position.x - from.x, n.group.position.z - from.z);
      if (d < bd) { bd = d; best = n; }
    }
    return best ? best.group.position.clone() : null;
  }

  /** Gather the nearest ungathered node within (horizontal) radius — used by agent players. */
  gatherNearest(pos: THREE.Vector3, radius = 3.5): { item: string; amount: number } | null {
    let best: LiveNode | null = null, bd = radius;
    for (const n of this.nodes) {
      if (n.taken) continue;
      const d = Math.hypot(n.group.position.x - pos.x, n.group.position.z - pos.z);
      if (d < bd) { bd = d; best = n; }
    }
    if (!best) return null;
    const out = { item: best.item, amount: best.amount };
    this.gather(best, best.item, best.amount);
    return out;
  }

  /** Gentle bob + spin on the glow markers so nodes read as alive; regrow renewables. */
  update(t: number) {
    const now = performance.now();
    for (const n of this.nodes) {
      if (n.taken) {
        if (n.respawnAt !== undefined && now >= n.respawnAt) { n.taken = false; n.respawnAt = undefined; n.group.visible = true; }
        continue;
      }
      n.marker.position.y = n.baseY + Math.sin(t * 2 + n.phase) * 0.12;
      n.marker.rotation.y = t * 0.8 + n.phase;
    }
  }
}

// ---- procedural models ------------------------------------------------------

function mat(color: number, rough: number, metal: number, emissive = 0) {
  const m = new MeshStandardNodeMaterial({ color, roughness: rough, metalness: metal });
  if (emissive) { m.emissive = new THREE.Color(color); (m as any).emissiveIntensity = emissive; }
  return m;
}

function makeMarker(color: number): THREE.Mesh {
  const c = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5);
  const m = new MeshStandardNodeMaterial({ color: c, roughness: 0.4, metalness: 0 });
  m.emissive = c; (m as any).emissiveIntensity = 1.4;
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), m);
  mesh.castShadow = false; mesh.receiveShadow = false;
  return mesh;
}

function modelHeight(model: ResourceModel): number {
  switch (model) {
    case "logPile": return 0.6;
    case "rock": return 0.7;
    case "grainTuft": return 0.9;
    case "reedCluster": return 1.4;
    case "orePile": return 0.7;
  }
}

function buildModel(model: ResourceModel, color: number): THREE.Group {
  const g = new THREE.Group();
  switch (model) {
    case "logPile": {
      const m = mat(0x8a5a33, 0.9, 0);
      const end = mat(0xb98a5e, 0.85, 0);
      const geo = new THREE.CylinderGeometry(0.16, 0.16, 1.2, 8);
      for (let i = 0; i < 4; i++) {
        const log = new THREE.Mesh(geo, [m, end, end] as any);
        log.rotation.z = Math.PI / 2;
        log.position.set((i % 2) * 0.18 - 0.09, 0.16 + (i > 1 ? 0.3 : 0), (i < 2 ? -0.18 : 0.18));
        log.castShadow = true; g.add(log);
      }
      break;
    }
    case "rock": {
      const m = mat(0x8b9197, 0.95, 0);
      for (let i = 0; i < 3; i++) {
        const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35 + i * 0.12, 0), m);
        r.position.set((i - 1) * 0.3, 0.2 + i * 0.08, (i % 2) * 0.2);
        r.rotation.set(i, i * 1.7, i * 0.5);
        r.castShadow = true; g.add(r);
      }
      break;
    }
    case "grainTuft": {
      const stalk = mat(0xd8b24a, 0.8, 0);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const s = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.8, 5), stalk);
        s.position.set(Math.cos(a) * 0.14, 0.45, Math.sin(a) * 0.14);
        s.rotation.z = Math.cos(a) * 0.25; s.rotation.x = Math.sin(a) * 0.25;
        s.castShadow = true; g.add(s);
      }
      void color;
      break;
    }
    case "reedCluster": {
      const reed = mat(0x6f9a48, 0.85, 0);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 1.3, 5), reed);
        r.position.set(Math.cos(a) * 0.16, 0.65, Math.sin(a) * 0.16);
        r.rotation.z = Math.cos(a) * 0.18; r.rotation.x = Math.sin(a) * 0.18;
        r.castShadow = true; g.add(r);
      }
      break;
    }
    case "orePile": {
      const m = mat(0x6b7079, 0.5, 0.7);
      for (let i = 0; i < 4; i++) {
        const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28 + i * 0.06, 0), m);
        r.position.set((i - 1.5) * 0.22, 0.18 + (i % 2) * 0.12, (i % 2) * 0.18);
        r.rotation.set(i, i * 1.3, i); r.castShadow = true; g.add(r);
      }
      break;
    }
  }
  return g;
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as any).material;
    if (Array.isArray(mat)) mat.forEach((x) => x?.dispose?.());
    else mat?.dispose?.();
  });
}
