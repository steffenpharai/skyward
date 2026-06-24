/**
 * Content registry + the deterministic placement resolver.
 *
 * Systems read content ONLY through here. `resolveNodes()` turns each
 * declarative PlaceRule into concrete, seed-stable world positions (sampling the
 * heightfield and respecting biome / slope / lake / village rules), so the same
 * seed always yields the same world — the property persistence and agents rely on.
 */
import { heightAt, slopeDeg, LAKE, WORLD } from "../../core/noise";
import { TOWN, standDensity, inVillage } from "../../world/layout";
import type { ContentPack, EraId, ItemDef, ItemId, ResourceNodeDef } from "./types";
import { era1 } from "./era1";
import { era2 } from "./era2";
import { era3 } from "./era3";
import { era4 } from "./era4";

const PACKS: ContentPack[] = [era1, era2, era3, era4];

export function getPack(era: EraId): ContentPack {
  return PACKS.find((p) => p.era.id === era) ?? PACKS[0];
}

/** All packs from Era 1 up to and including `era` (for loading a saved game). */
export function packsThrough(era: EraId): ContentPack[] {
  return PACKS.filter((p) => p.era.id <= era);
}

/** The next era's pack, if one exists. */
export function nextPack(era: EraId): ContentPack | null {
  return PACKS.find((p) => p.era.id === era + 1) ?? null;
}

/**
 * Validate an agent-proposed content pack against the schema (Stage V Tier-1).
 * Returns a list of human-readable errors ([] = valid). This is the gate that
 * lets an agent contribute world content as data without touching code.
 */
export function validateContentPack(obj: any): string[] {
  const errs: string[] = [];
  const need = (cond: boolean, msg: string) => { if (!cond) errs.push(msg); };
  need(!!obj && typeof obj === "object", "pack must be an object");
  if (!obj) return errs;

  const e = obj.era;
  need(!!e && typeof e === "object", "missing era{}");
  if (e) {
    need(typeof e.id === "number" && e.id >= 1 && e.id <= 4, "era.id must be 1..4");
    need(typeof e.name === "string" && e.name.length > 0, "era.name required");
    need(typeof e.sunElevation === "number", "era.sunElevation must be a number");
    need(typeof e.advanceAt === "number" && e.advanceAt >= 0 && e.advanceAt <= 1, "era.advanceAt must be 0..1");
  }
  for (const key of ["items", "nodes", "buildSites", "inhabitants"] as const) {
    need(Array.isArray(obj[key]), `${key} must be an array`);
  }
  if (Array.isArray(obj.buildSites)) {
    obj.buildSites.forEach((b: any, i: number) => {
      need(typeof b?.id === "string", `buildSites[${i}].id required`);
      need(b?.pos && typeof b.pos.x === "number" && typeof b.pos.z === "number", `buildSites[${i}].pos{x,z} required`);
      need(b?.cost && typeof b.cost === "object", `buildSites[${i}].cost required`);
      need(typeof b?.structure === "string", `buildSites[${i}].structure required`);
    });
  }
  if (Array.isArray(obj.inhabitants)) {
    obj.inhabitants.forEach((h: any, i: number) => {
      need(typeof h?.id === "string", `inhabitants[${i}].id required`);
      need(h?.home && typeof h.home.x === "number" && typeof h.home.z === "number", `inhabitants[${i}].home{x,z} required`);
    });
  }
  return errs;
}

/** Every item known across all loaded eras (for the HUD). */
export function allItems(): ItemDef[] {
  return PACKS.flatMap((p) => p.items);
}

const ITEMS = new Map<ItemId, ItemDef>(allItems().map((it) => [it.id, it]));
export function item(id: ItemId): ItemDef {
  return ITEMS.get(id) ?? { id, name: id, color: 0xffffff, era: 1 };
}

// ---- deterministic resolver -------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function biomeOk(
  x: number, z: number,
  biome: "meadow" | "forest" | "cliff" | "lakeshore" | undefined,
  maxSlope: number | undefined,
): boolean {
  const s = slopeDeg(x, z);
  if (maxSlope != null && s > maxSlope) return false;
  if (inVillage(x, z, 2)) return false;          // keep raw resources out of yards/road
  const h = heightAt(x, z);
  const lakeDist = Math.hypot(x - LAKE.x, z - LAKE.z);
  switch (biome) {
    case "meadow":    return s < 18 && h > LAKE.level + 1 && standDensity(x, z) < 0.3 && lakeDist > LAKE.r + 2;
    case "forest":    return s < 30 && h > LAKE.level + 1 && standDensity(x, z) > 0.4;
    case "cliff":     return s > 28 && s < 82;
    case "lakeshore": return s < 24 && lakeDist > LAKE.r - 3 && lakeDist < LAKE.r + 9 && h > LAKE.level + 0.2;
    default:          return s < 35 && h > LAKE.level + 1;
  }
}

export interface ResolvedNode {
  uid: string;             // stable id for persistence (which nodes are gathered)
  def: ResourceNodeDef;
  x: number; y: number; z: number;
}

export function resolveNodes(pack: ContentPack): ResolvedNode[] {
  const out: ResolvedNode[] = [];
  for (const def of pack.nodes) {
    if (def.place.kind === "at") {
      const { x, z } = def.place.pos;
      out.push({ uid: `${def.id}#0`, def, x, y: heightAt(x, z), z });
      continue;
    }
    const p = def.place;
    const rng = mulberry32(strHash(def.id));
    let placed = 0, tries = 0;
    const maxTries = p.count * 80;
    while (placed < p.count && tries < maxTries) {
      tries++;
      const a = rng() * Math.PI * 2;
      const r = p.ring[0] + rng() * (p.ring[1] - p.ring[0]);
      const x = TOWN.x + Math.cos(a) * r;
      const z = TOWN.z + Math.sin(a) * r;
      if (Math.abs(x) > WORLD.half - 6 || Math.abs(z) > WORLD.half - 6) continue;
      if (!biomeOk(x, z, p.biome, p.maxSlope)) continue;
      out.push({ uid: `${def.id}#${placed}`, def, x, y: heightAt(x, z), z });
      placed++;
    }
  }
  return out;
}
