/**
 * Build-sites — the gather → build → grow loop. Each site shows a translucent
 * footprint + a hovering marker and a cost prompt; when you have the materials,
 * press E to spend them and raise the structure (with a little pop). Completed
 * structures persist and push their colliders so you can't walk through walls.
 */
import * as THREE from "three";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";
import { heightAt } from "../core/noise";
import type { Interact } from "./interact";
import type { Store } from "./state";
import type { BuildSiteDef, ContentPack } from "./content/types";
import type { Structure } from "../world/scatter";
import { item } from "./content";
import { buildStructure } from "./structures";

interface LiveSite {
  def: BuildSiteDef;
  ghost?: THREE.Group;
  marker?: THREE.Mesh;
  baseY?: number;
  phase: number;
  built: boolean;
}

export class BuildSites {
  group = new THREE.Group();
  private sites: LiveSite[] = [];
  private wheels: THREE.Group[] = [];
  private phase = 0;

  constructor(
    scene: THREE.Scene,
    private store: Store,
    private interact: Interact,
    private colliders: Structure[],
    private onBuilt?: (def: BuildSiteDef) => void,
  ) {
    this.group.name = "buildsites";
    scene.add(this.group);
  }

  /** Spawn one content pack's build-sites (already-built ones come back finished). */
  addPack(pack: ContentPack) {
    for (const def of pack.buildSites) {
      const live: LiveSite = { def, phase: (this.phase += 1.3), built: false };
      this.sites.push(live);

      if (this.store.state.builtSites.includes(def.id)) {
        live.built = true;
        this.spawnFinished(def, true);
        continue;
      }

      const ghost = this.makeGhost(def);
      live.ghost = ghost;
      live.marker = ghost.userData.marker as THREE.Mesh;
      live.baseY = live.marker.position.y;
      this.group.add(ghost);

      this.interact.add({
        pos: new THREE.Vector3(def.pos.x, heightAt(def.pos.x, def.pos.z) + 0.6, def.pos.z),
        radius: 4.2,
        enabled: () => !live.built,
        label: () => this.label(def),
        act: () => this.tryBuild(live),
      });
    }
  }

  /** Build a site by id if affordable (used by agent players). Returns true if built. */
  buildById(id: string): boolean {
    const live = this.sites.find((s) => s.def.id === id && !s.built);
    if (!live) return false;
    this.tryBuild(live);
    return live.built;
  }

  /** Force-construct a site because the authoritative server says it's built (another
   *  player raised it). No inventory spend, no affordability check. Idempotent. */
  forceBuild(id: string): boolean {
    const live = this.sites.find((s) => s.def.id === id && !s.built);
    if (!live) return false;
    live.built = true;
    if (!this.store.state.builtSites.includes(id)) this.store.state.builtSites.push(id);
    if (live.ghost) { this.group.remove(live.ghost); disposeTree(live.ghost); live.ghost = undefined; }
    this.spawnFinished(live.def, false);
    return true;
  }
  hasSite(id: string): boolean { return this.sites.some((s) => s.def.id === id); }

  /** World position of an unbuilt site by id (for agent navigation). */
  sitePos(id: string): { x: number; z: number } | null {
    const live = this.sites.find((s) => s.def.id === id && !s.built);
    return live ? live.def.pos : null;
  }

  /** Site markers for the minimap (current era's sites). */
  minimapSites(): { x: number; z: number; built: boolean; name: string }[] {
    return this.sites.map((s) => ({ x: s.def.pos.x, z: s.def.pos.z, built: s.built, name: s.def.name }));
  }

  /** The nearest unbuilt site to a point (for the objective hint). */
  nextSite(from: { x: number; z: number }): { name: string; x: number; z: number; dist: number } | null {
    let best: LiveSite | null = null, bd = Infinity;
    for (const s of this.sites) {
      if (s.built) continue;
      const d = Math.hypot(s.def.pos.x - from.x, s.def.pos.z - from.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best ? { name: best.def.name, x: best.def.pos.x, z: best.def.pos.z, dist: Math.round(bd) } : null;
  }

  private affordable(def: BuildSiteDef): boolean {
    for (const k in def.cost) if (this.store.count(k) < (def.cost[k] ?? 0)) return false;
    return true;
  }

  private label(def: BuildSiteDef): string {
    const parts = Object.keys(def.cost).map((k) => `${item(k).name} ${this.store.count(k)}/${def.cost[k]}`);
    return `${def.name} — ${parts.join("  ")} · ${this.affordable(def) ? "Build (E)" : "gather materials"}`;
  }

  private tryBuild(live: LiveSite) {
    if (live.built || !this.affordable(live.def)) return;
    if (!this.store.spend(live.def.cost)) return;
    live.built = true;
    this.store.state.builtSites.push(live.def.id);
    this.store.save();
    if (live.ghost) { this.group.remove(live.ghost); disposeTree(live.ghost); live.ghost = undefined; }
    this.spawnFinished(live.def, false);
    this.onBuilt?.(live.def);
  }

  private spawnFinished(def: BuildSiteDef, instant: boolean) {
    const built = buildStructure(def.structure, def.id, def.pos.x, def.pos.z, def.rot ?? 0);
    if (built.collider) this.colliders.push(built.collider);
    const wheel = (built.group.userData as any).wheel as THREE.Group | undefined;
    if (wheel) this.wheels.push(wheel);
    if (!instant) { built.group.scale.setScalar(0.01); (built.group.userData as any).pop = 0; }
    this.group.add(built.group);
  }

  private makeGhost(def: BuildSiteDef): THREE.Group {
    const g = new THREE.Group();
    const y = heightAt(def.pos.x, def.pos.z);
    g.position.set(def.pos.x, y, def.pos.z);

    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 0.08, 24),
      new MeshBasicNodeMaterial({ color: 0xffc266, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    pad.position.y = 0.05;
    g.add(pad);

    const markMat = new MeshStandardNodeMaterial({ color: 0xffd9a0, roughness: 0.4 });
    markMat.emissive = new THREE.Color(0xffb347); (markMat as any).emissiveIntensity = 1.6;
    const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), markMat);
    marker.position.y = 1.6;
    g.add(marker);
    g.userData.marker = marker;
    return g;
  }

  update(dt: number, t: number) {
    for (const s of this.sites) {
      if (s.built || !s.marker || s.baseY === undefined) continue;
      s.marker.position.y = s.baseY + Math.sin(t * 2 + s.phase) * 0.18;
      s.marker.rotation.y = t * 1.2 + s.phase;
    }
    for (const g of this.group.children) {
      const ud = g.userData as any;
      if (ud.pop !== undefined && ud.pop < 1) { ud.pop = Math.min(1, ud.pop + dt * 2.2); g.scale.setScalar(easeOut(ud.pop)); }
    }
    for (const w of this.wheels) w.rotation.z += dt * 0.7;
  }
}

function easeOut(p: number): number { return 1 - (1 - p) * (1 - p); }

function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as any).material;
    if (Array.isArray(mat)) mat.forEach((x) => x?.dispose?.());
    else mat?.dispose?.();
  });
}
