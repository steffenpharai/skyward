/**
 * Era II — the Industrious Settlement. The town has roots; now it learns to
 * work materials. Introduces iron (mined from ore up on the cliffs), a workshop
 * and a bridge, and a smith who wants it. PURE DATA.
 */
import type { ContentPack } from "./types";

export const era2: ContentPack = {
  era: {
    id: 2,
    name: "Industry",
    introLine: "Smoke from the first workshop. The valley is learning to build in earnest.",
    sunElevation: 46,     // a touch higher/brighter than golden Era I
    advanceAt: 1.0,
  },

  items: [
    { id: "iron", name: "Iron", color: 0x8a8f98, era: 2 },
  ],

  nodes: [
    { id: "cliff_ore", item: "iron", amount: 2, model: "orePile", respawnSec: 130,
      place: { kind: "scatter", count: 12, ring: [95, 205], biome: "cliff" } },
  ],

  buildSites: [
    { id: "workshop_a", name: "Workshop", era: 2, pos: { x: 28, z: -16 },
      cost: { wood: 10, iron: 6 }, structure: "workshop" },
    { id: "bridge_a", name: "Footbridge", era: 2, pos: { x: -18, z: 40 },
      cost: { wood: 8, stone: 6 }, structure: "bridge" },
    { id: "signpost_a", name: "Waystone", era: 2, pos: { x: 40, z: 4 },
      cost: { wood: 3, stone: 2 }, structure: "signpost" },
  ],

  inhabitants: [
    { id: "joran", name: "Joran", home: { x: 26, z: -12 }, era: 2,
      request: { wants: "iron", count: 4, line: "Four iron and I'll forge the tools this valley needs.",
                 thanks: "Now we can make things that last. The future's looking bright." } },
  ],
};
