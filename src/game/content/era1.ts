/**
 * Era I — the Frontier Farm Town. PURE DATA. No logic here.
 *
 * Resources are placed to reward the traversal: grain in the near meadow,
 * logs out in the forest stands, fiber down at the lakeshore, and stone up on
 * the climbable cliffs (so gathering it means using the climb verb).
 */
import type { ContentPack } from "./types";

export const era1: ContentPack = {
  era: {
    id: 1,
    name: "Frontier",
    introLine: "A handful of settlers, a few timber roofs, and a whole valley to grow into.",
    sunElevation: 32,     // GOLDEN — the established look
    advanceAt: 1.0,       // build everything in Era I to advance
  },

  items: [
    { id: "grain", name: "Grain", color: 0xe6c34a, era: 1 },
    { id: "wood",  name: "Wood",  color: 0x9c6b3f, era: 1 },
    { id: "fiber", name: "Fiber", color: 0x7fae5a, era: 1 },
    { id: "stone", name: "Stone", color: 0x9aa0a6, era: 1 },
    { id: "fish",  name: "Fish",  color: 0x6fb0d0, era: 1 },
    { id: "lightmote", name: "Light-mote", color: 0x9fe6ff, era: 1 },
  ],

  nodes: [
    { id: "grain_field", item: "grain", amount: 2, model: "grainTuft", respawnSec: 75,
      place: { kind: "scatter", count: 16, ring: [16, 70], biome: "meadow", maxSlope: 16 } },
    { id: "wood_stand", item: "wood", amount: 2, model: "logPile", respawnSec: 110,
      place: { kind: "scatter", count: 14, ring: [40, 120], biome: "forest" } },
    { id: "lakeshore_reeds", item: "fiber", amount: 2, model: "reedCluster", respawnSec: 95,
      place: { kind: "scatter", count: 8, ring: [55, 100], biome: "lakeshore" } },
    { id: "cliff_stone", item: "stone", amount: 2, model: "rock", respawnSec: 140,
      place: { kind: "scatter", count: 12, ring: [90, 200], biome: "cliff" } },
  ],

  // Build-sites + inhabitants are authored now (data) and consumed in S1.1 / S1.2.
  buildSites: [
    { id: "cottage_a", name: "New Cottage", era: 1, pos: { x: 6, z: 20 },
      cost: { wood: 8, stone: 3 }, structure: "cottage" },
    { id: "well_a", name: "Village Well", era: 1, pos: { x: 24, z: 2 },
      cost: { stone: 6 }, structure: "well" },
    { id: "granary_a", name: "Granary", era: 1, pos: { x: 34, z: -14 },
      cost: { wood: 6, grain: 6 }, structure: "granary" },
    { id: "mill_a", name: "Water Mill", era: 1, pos: { x: -10, z: 34 },
      cost: { wood: 10, stone: 4, fiber: 4 }, structure: "mill" },
  ],

  inhabitants: [
    { id: "mara", name: "Mara", home: { x: 20, z: -2 }, era: 1,
      request: { wants: "grain", count: 4, line: "If you bring me 4 grain, I can get the granary started.",
                 thanks: "Bless you — that'll feed us through the season." } },
    { id: "tomas", name: "Tomas", home: { x: 12, z: 8 }, era: 1,
      request: { wants: "wood", count: 6, line: "Six good logs and I'll raise that new cottage frame.",
                 thanks: "Now we're building. Welcome to the valley." } },
  ],
};
