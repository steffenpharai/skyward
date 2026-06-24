/**
 * Era III — the Modern Hub. Clean energy, greenhouses, drones, the first robots.
 * Silicon is mined from the cliffs. PURE DATA.
 */
import type { ContentPack } from "./types";

export const era3: ContentPack = {
  era: {
    id: 3,
    name: "Modern Hub",
    introLine: "Solar panels catch the sun and drones hum overhead. The valley steps into a brighter age.",
    sunElevation: 56,
    advanceAt: 1.0,
  },
  items: [
    { id: "silicon", name: "Silicon", color: 0xd8c89a, era: 3 },
  ],
  nodes: [
    { id: "cliff_silicon", item: "silicon", amount: 2, model: "orePile", respawnSec: 140,
      place: { kind: "scatter", count: 14, ring: [95, 205], biome: "cliff" } },
  ],
  buildSites: [
    { id: "solar_a", name: "Solar Array", era: 3, pos: { x: 40, z: -22 },
      cost: { iron: 6, silicon: 4 }, structure: "solar" },
    { id: "greenhouse_a", name: "Greenhouse", era: 3, pos: { x: 6, z: 30 },
      cost: { wood: 6, silicon: 3, grain: 4 }, structure: "greenhouse" },
    { id: "drone_a", name: "Drone Hub", era: 3, pos: { x: 32, z: 12 },
      cost: { iron: 4, silicon: 6 }, structure: "drone_hub" },
    { id: "reactor_a", name: "Fusion Reactor", era: 3, pos: { x: -6, z: -22 },
      cost: { iron: 8, stone: 6, silicon: 6 }, structure: "reactor" },
  ],
  inhabitants: [
    { id: "rhea", name: "Rhea", home: { x: 30, z: -14 }, era: 3, kind: "human",
      request: { wants: "silicon", count: 4, line: "Four silicon and I'll wire the whole hub for clean power.",
                 thanks: "The lights will never go out now. We've come so far." } },
  ],
};
