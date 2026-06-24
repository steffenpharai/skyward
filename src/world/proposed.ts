/**
 * Renders agent-authored content packs (Phase 3, Tier-A) into the live world and
 * reconciles them against the authoritative region map.
 *
 * Each pack's build-sites are rendered with the same procedural `buildStructure`
 * the founding town uses, placed at region-local + region-center coordinates.
 * Experimental (un-promoted) packs get a soft glowing ground-ring — dropped on
 * promotion (Phase 4). When a region is released or decays back to the wild
 * (Phase 2), its content is removed here too, so the client never shows orphaned
 * structures the server has already cleared.
 */
import * as THREE from "three";
import { buildStructure } from "../game/structures";
import { parseRegionId, regionCenter } from "./regions";
import type { RegionInfo, RegionPack } from "../net/net";

interface RenderedPack { regionId: string; objects: THREE.Object3D[]; rings: THREE.Mesh[]; }

export class ProposedContent {
  private group = new THREE.Group();
  private packs = new Map<string, RenderedPack>();   // pack id -> what's in the scene

  constructor(scene: THREE.Scene) {
    this.group.name = "proposed";
    scene.add(this.group);
  }

  /** Render a pack, or react to a curation update (promotion drops the ring).
   *  Idempotent per pack id. */
  addPack(regionId: string, pack: RegionPack): void {
    if (!pack) return;
    const existing = this.packs.get(pack.id);
    if (existing) { if (pack.status === "published") this.clearRings(existing); return; }
    const rc = parseRegionId(regionId);
    if (!rc) return;
    const c = regionCenter(rc.rx, rc.rz);
    const experimental = pack.status !== "published";
    const objects: THREE.Object3D[] = [];
    const rings: THREE.Mesh[] = [];
    for (const s of pack.buildSites || []) {
      const wx = c.x + s.pos.x, wz = c.z + s.pos.z;
      const { group } = buildStructure(s.structure as any, pack.id + ":" + s.id, wx, wz, s.rot || 0);
      this.group.add(group); objects.push(group);
      if (experimental) { const m = this.marker(wx, group.position.y, wz); rings.push(m); this.group.add(m); }
    }
    this.packs.set(pack.id, { regionId, objects, rings });
  }

  /** Drop content for any region that is no longer developed (released / decayed). */
  reconcile(regions: Map<string, RegionInfo>): void {
    for (const [packId, rp] of [...this.packs]) {
      const r = regions.get(rp.regionId);
      if (!r || r.status === "wild") this.removePack(packId);
    }
  }

  private removePack(packId: string): void {
    const rp = this.packs.get(packId);
    if (!rp) return;
    for (const o of [...rp.objects, ...rp.rings]) { this.group.remove(o); disposeDeep(o); }
    this.packs.delete(packId);
  }

  private clearRings(rp: RenderedPack): void {
    for (const m of rp.rings) { this.group.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    rp.rings = [];
  }

  private marker(x: number, y: number, z: number): THREE.Mesh {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.3, 0.07, 6, 28),
      new THREE.MeshBasicMaterial({ color: 0x7fdca0, transparent: true, opacity: 0.5 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, y + 0.12, z);
    return ring;
  }
}

/** Dispose all geometries/materials under an object before dropping it. */
function disposeDeep(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose()); else mat?.dispose();
  });
}
