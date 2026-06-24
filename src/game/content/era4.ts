/**
 * Era IV — the Futuristic Colony. Habitat domes, a mag-lev line, humanoid
 * helper-robots. Alloy from the cliffs, polymer from the forests. PURE DATA.
 */
import type { ContentPack } from "./types";

export const era4: ContentPack = {
  era: {
    id: 4,
    name: "Futuristic Colony",
    introLine: "Glass domes rise and mag-lev pods glide between them. Robots walk among the people now.",
    sunElevation: 60,
    advanceAt: 1.0,
  },
  items: [
    { id: "alloy", name: "Alloy", color: 0x9fb0c0, era: 4 },
    { id: "polymer", name: "Polymer", color: 0xb07ad0, era: 4 },
  ],
  nodes: [
    { id: "cliff_alloy", item: "alloy", amount: 2, model: "orePile", respawnSec: 150,
      place: { kind: "scatter", count: 14, ring: [95, 205], biome: "cliff" } },
    { id: "forest_polymer", item: "polymer", amount: 2, model: "reedCluster", respawnSec: 110,
      place: { kind: "scatter", count: 12, ring: [40, 120], biome: "forest" } },
  ],
  buildSites: [
    { id: "dome_a", name: "Habitat Dome", era: 4, pos: { x: -16, z: -16 },
      cost: { alloy: 6, silicon: 6, polymer: 4 }, structure: "dome" },
    { id: "maglev_a", name: "Mag-Lev Line", era: 4, pos: { x: 46, z: -2 },
      cost: { alloy: 8, iron: 6 }, structure: "maglev" },
    { id: "robot_a", name: "Robot Bay", era: 4, pos: { x: 22, z: 22 },
      cost: { alloy: 6, polymer: 6, silicon: 4 }, structure: "robot_bay" },
  ],
  inhabitants: [
    { id: "cyra", name: "CYRA-9", home: { x: 18, z: 18 }, era: 4, kind: "robot",
      request: { wants: "alloy", count: 5, line: "FIVE ALLOY UNITS REQUESTED. I WILL ASSEMBLE THE COLONY FRAME.",
                 thanks: "FABRICATION COMPLETE. THIS PLACE FEELS LIKE HOME TO ME TOO." } },
  ],
};
