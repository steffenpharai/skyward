/**
 * Skills & progression — the cozy life-sim spine (Palia-style). Doing activities
 * trains skills; skills level up on an accelerating curve and unlock yield/recipes.
 */
export interface SkillDef { id: string; name: string; icon: string; }

export const SKILLS: SkillDef[] = [
  { id: "foraging",   name: "Foraging",   icon: "🌿" },
  { id: "woodcutting", name: "Woodcutting", icon: "🪓" },
  { id: "mining",     name: "Mining",     icon: "⛏️" },
  { id: "farming",    name: "Farming",    icon: "🌾" },
  { id: "fishing",    name: "Fishing",    icon: "🎣" },
  { id: "building",   name: "Building",   icon: "🔨" },
];
export function skillName(id: string): string { return SKILLS.find((s) => s.id === id)?.name ?? id; }

/** Which skill gathering a given item trains. */
const ITEM_SKILL: Record<string, string> = {
  wood: "woodcutting",
  stone: "mining", iron: "mining", silicon: "mining", alloy: "mining",
  grain: "foraging", fiber: "foraging", polymer: "foraging",
  fish: "fishing",
};
export function itemSkill(item: string): string { return ITEM_SKILL[item] ?? "foraging"; }

// Level L is reached at L²·60 total xp (accelerating).
export function levelFor(xp: number): number { return Math.floor(Math.sqrt(Math.max(0, xp) / 60)); }
export function xpForLevel(l: number): number { return l * l * 60; }

export function skillProgress(xp: number): { level: number; into: number; span: number; frac: number } {
  const level = levelFor(xp);
  const cur = xpForLevel(level), next = xpForLevel(level + 1);
  const into = xp - cur, span = next - cur || 1;
  return { level, into, span, frac: into / span };
}
