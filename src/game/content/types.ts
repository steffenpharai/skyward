/**
 * Content-as-data schema — the keystone of the whole project.
 *
 * Every gameplay value (resources, build-sites, inhabitants, structures, eras)
 * is DECLARATIVE DATA, not hardcoded in a system file. The game's systems are
 * interpreters of this data. This is the contract the agent stages build on: a
 * Stage-V agent contributes a new BuildSiteDef / InhabitantDef as JSON, it is
 * schema-validated + sandbox-previewed, a human approves it, and it drops into
 * the same registry the game already reads — no code change required.
 */

export type ItemId = string;            // 'wood' | 'stone' | 'grain' | 'fiber' | ...
export type EraId = 1 | 2 | 3 | 4;

export interface Vec2 { x: number; z: number }

export interface ItemDef {
  id: ItemId;
  name: string;
  color: number;        // mote / HUD-chip tint
  era: EraId;           // first era it appears
}

/** How a resource node (or scatter of them) is placed in the world. Resolved
 *  deterministically from the world seed so the world is identical every load. */
export type PlaceRule =
  | { kind: "at"; pos: Vec2 }
  | {
      kind: "scatter";
      count: number;
      ring: [number, number];                 // radius range from the town centre
      biome?: "meadow" | "forest" | "cliff" | "lakeshore";
      maxSlope?: number;
    };

export type ResourceModel = "logPile" | "rock" | "grainTuft" | "reedCluster" | "orePile";

export interface ResourceNodeDef {
  id: string;
  item: ItemId;
  amount: number;           // yield per node
  model: ResourceModel;
  place: PlaceRule;
  respawnSec?: number;      // undefined = one-shot
}

export type StructureKind =
  // Era I–II — frontier & industry
  | "cottage" | "mill" | "well" | "bridge" | "granary" | "workshop" | "signpost"
  // Era III — modern hub
  | "solar" | "greenhouse" | "drone_hub" | "reactor"
  // Era IV — futuristic colony
  | "dome" | "maglev" | "robot_bay";

/** Optional atmosphere repaint for an era or region (palette + sun tint). */
export interface SkyOverride {
  top: number; mid: number; bot: number; fog: number;
  hemiSky: number; hemiGround: number; amb: number;
  sun: number; sunI?: number;
}

export interface BuildSiteDef {
  id: string;
  name: string;
  era: EraId;
  pos: Vec2;
  rot?: number;
  cost: Partial<Record<ItemId, number>>;       // { wood: 8, stone: 4 }
  structure: StructureKind;
  unlocks?: string[];                          // site ids revealed when complete
  progressWeight?: number;                     // era-progress contribution (default 1)
}

export interface InhabitantDef {
  id: string;
  name: string;
  home: Vec2;
  era: EraId;
  kind?: "human" | "robot";   // robots appear in the later eras
  // Stage I: a scripted request. Stage II: an agent brain reads/writes this SAME
  // shape — the human↔agent seam is deliberately placed right here.
  request?: {
    wants: ItemId;
    count: number;
    line: string;        // what they ask
    thanks: string;      // what they say on delivery
    rewardLine?: string; // optional flavor reward text
  };
}

export interface EraDef {
  id: EraId;
  name: string;
  introLine: string;
  sunElevation: number;   // env atmosphere anchor for this era
  advanceAt: number;      // fraction of this era's build-sites completed to advance (e.g. 1.0)
  sky?: SkyOverride;            // repaint the atmosphere on entering this era
}

/** One era's worth of authored content. */
export interface ContentPack {
  era: EraDef;
  items: ItemDef[];
  nodes: ResourceNodeDef[];
  buildSites: BuildSiteDef[];
  inhabitants: InhabitantDef[];
}
