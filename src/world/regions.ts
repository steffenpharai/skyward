/**
 * Region grid — the spatial backbone of the endless world.
 *
 * The world is an unbounded grid of square parcels ("regions") laid over the
 * infinite procedural heightfield (core/noise.ts). Region (0,0) is GENESIS: the
 * founding settlement, i.e. the world that exists today. Its center is the world
 * origin, so genesis content keeps its current absolute coordinates unchanged —
 * the pivot adds an outward frontier without disturbing the founding town.
 *
 * REGION_SIZE matches WORLD.size so genesis exactly fills region (0,0); every
 * other region tiles the same heightfield at its own center. The RegionManager
 * streams raw terrain for neighbouring regions on demand, so the player can walk
 * outward forever — wild land that agents later claim and build on (Phase 2+).
 *
 * This module is the client mirror of server/shared/regions.mjs; the two MUST
 * agree on REGION_SIZE and the id scheme so humans and agents resolve the same
 * parcels.
 */
import * as THREE from "three";
import { WORLD } from "../core/noise";
import { buildTerrain } from "./terrain";

export const REGION_SIZE = WORLD.size; // 460 — genesis region == today's realized world

export interface RegionCoords { rx: number; rz: number; }

/** Stable id for a region cell, e.g. "r_0_0", "r_-1_2". */
export function regionId(rx: number, rz: number): string { return `r_${rx}_${rz}`; }

/** Which region cell a world point falls in (centered grid: cell N spans N±SIZE/2). */
export function regionCoordsAt(x: number, z: number): RegionCoords {
  return { rx: Math.round(x / REGION_SIZE), rz: Math.round(z / REGION_SIZE) };
}
export function regionIdAt(x: number, z: number): string {
  const { rx, rz } = regionCoordsAt(x, z);
  return regionId(rx, rz);
}

/** World-space center of a region cell. Genesis (0,0) -> world origin. */
export function regionCenter(rx: number, rz: number): { x: number; z: number } {
  return { x: rx * REGION_SIZE, z: rz * REGION_SIZE };
}

/** Parse "r_<rx>_<rz>" back to coords (null if malformed). */
export function parseRegionId(id: string): RegionCoords | null {
  const m = /^r_(-?\d+)_(-?\d+)$/.exec(id);
  return m ? { rx: +m[1], rz: +m[2] } : null;
}

/** The four edge-adjacent neighbours of a cell (frontier growth is 4-connected). */
export function neighbors(rx: number, rz: number): RegionCoords[] {
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ rx: rx + dx, rz: rz + dz }));
}

export const GENESIS: RegionCoords = { rx: 0, rz: 0 };
export const GENESIS_ID = regionId(0, 0);

/**
 * Streams raw terrain for regions around the player so the world is genuinely
 * endless. Genesis (0,0) is realized by main.ts's full world build (terrain +
 * grass + trees + village), so the manager treats it as already present and only
 * fills in WILD neighbour land — bare, beautiful terrain on the same heightfield,
 * ready to be claimed and developed. Realized chunks are kept (no churn); the set
 * a player can reach in a session is small.
 */
export class RegionManager {
  // Streamed neighbour chunks, by id. Genesis (0,0) is NOT here — it's the full
  // world build owned by main.ts and is never unloaded (it's the hub).
  private chunks = new Map<string, THREE.Mesh>();
  private group = new THREE.Group();

  constructor(private scene: THREE.Scene) {
    this.group.name = "regions";
    scene.add(this.group);
  }

  /**
   * Ensure the player's region + the 3×3 ring around it have terrain, and unload
   * chunks that drift out of range so memory stays bounded as the player roams.
   * Cheap when warm (no work if nothing entered/left the ring).
   */
  update(playerX: number, playerZ: number): void {
    const { rx, rz } = regionCoordsAt(playerX, playerZ);
    const keep = new Set<string>();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const id = regionId(rx + dx, rz + dz);
        keep.add(id);
        this.ensure(rx + dx, rz + dz);
      }
    }
    for (const id of [...this.chunks.keys()]) if (!keep.has(id)) this.unload(id);
  }

  /** Region ids with realized terrain right now (genesis + streamed chunks). */
  realizedIds(): string[] { return [GENESIS_ID, ...this.chunks.keys()]; }

  private ensure(rx: number, rz: number): void {
    const id = regionId(rx, rz);
    if (id === GENESIS_ID || this.chunks.has(id)) return;   // genesis is the full build; never re-make
    const c = regionCenter(rx, rz);
    const { mesh } = buildTerrain(c.x, c.z);
    mesh.name = `terrain-${id}`;
    this.group.add(mesh);
    this.chunks.set(id, mesh);
  }

  private unload(id: string): void {
    const mesh = this.chunks.get(id);
    if (!mesh) return;
    this.group.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();   // shared rock texture is NOT disposed
    this.chunks.delete(id);
  }
}
