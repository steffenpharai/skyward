/**
 * Selectable player characters — each is a name + a colour palette applied to the
 * procedural adventurer (makeCharacter). One source of truth for both the
 * character-select cards and the in-world figure.
 */
export interface CharPalette {
  tunic: number;
  hood: number;
  pants: number;
  accent: number;
}

export interface CharacterDef extends CharPalette {
  id: string;
  name: string;
  blurb: string;
}

// Premade frontier ROLES — quick-starts you can rename (you name yourself, or the
// agent you're embodying). Each is a role + a palette applied to the procedural figure.
export const CHARACTERS: CharacterDef[] = [
  { id: "explorer", name: "Explorer", blurb: "Maps the frontier — first to every peak", tunic: 0x3a73b0, hood: 0x2a5688, pants: 0x9fb6c8, accent: 0x9fe0ff },
  { id: "builder",  name: "Builder",  blurb: "Raises what others only imagine",        tunic: 0x7a5ca8, hood: 0x5b4382, pants: 0xb0a6c0, accent: 0xd0b0ff },
  { id: "farmer",   name: "Farmer",   blurb: "Tends the land that feeds the world",     tunic: 0x3f8a5f, hood: 0x356e4f, pants: 0xcaa46a, accent: 0xc9d2db },
  { id: "tinkerer", name: "Tinkerer", blurb: "Bends three.js to new tricks",            tunic: 0xd2823a, hood: 0xb05e26, pants: 0xd9c08a, accent: 0xffd98a },
];

export function characterById(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

// --- Wardrobe: a full customizable appearance (dye slots + hat + cape + the
//     new character systems: skin tone, hair colour, hairstyle) ---
export type HatStyle = "hood" | "cap" | "crown" | "bare";
export type HairStyle = "tousled" | "short" | "long" | "ponytail";
export interface Appearance extends CharPalette {
  hat: HatStyle;
  cape: number | null;   // cape colour, or null for none
  skin?: number;         // skin tone (optional → default)
  hair?: number;         // hair colour (optional → default)
  hairStyle?: HairStyle; // hairstyle (optional → default)
}
export const HAT_STYLES: { id: HatStyle; name: string }[] = [
  { id: "hood", name: "Hood" }, { id: "cap", name: "Cap" }, { id: "crown", name: "Circlet" }, { id: "bare", name: "Bare" },
];
export const HAIR_STYLES: { id: HairStyle; name: string }[] = [
  { id: "tousled", name: "Tousled" }, { id: "short", name: "Short" }, { id: "long", name: "Long" }, { id: "ponytail", name: "Ponytail" },
];
/** A cozy dye palette for the wardrobe colour swatches. */
export const DYES: number[] = [
  0x3f8a5f, 0x2f7d8a, 0x3a73b0, 0x5b6fb8, 0x7a5ca8, 0xa85c8a, 0xc24d6a, 0xd2823a,
  0xe0b24a, 0x7fae5a, 0x4a8c6a, 0x9aa0a6, 0x52606e, 0x2a2f3a, 0xe9e4da, 0xf0d9a0,
];
/** Skin tones (warm → cool → fantasy). */
export const SKIN_TONES: number[] = [
  0xf6d2b0, 0xedbd92, 0xd99e6a, 0xb57a4d, 0x8a5a36, 0x5e3b24, 0xc9a7b0, 0xa6c6a0,
];
/** Hair colours. */
export const HAIR_DYES: number[] = [
  0x2a1d14, 0x3a2a20, 0x5a4126, 0x8a5a35, 0xc08a4a, 0xe0c080, 0x9aa0a6, 0xe9e4da,
  0xc24d6a, 0x7a5ca8, 0x3a73b0, 0x4a8c6a,
];
/** Cape colours (plus null = none, handled in UI). */
export const CAPE_DYES: number[] = [0xc24d6a, 0xd2823a, 0x3a73b0, 0x4a8c6a, 0x7a5ca8, 0x2a2f3a, 0xe0b24a, 0x9fe6ff];

export const DEFAULT_SKIN = 0xedbd92;
export const DEFAULT_HAIR = 0x3a2a20;

export function defaultAppearance(c: CharacterDef): Appearance {
  return { tunic: c.tunic, hood: c.hood, pants: c.pants, accent: c.accent, hat: "hood", cape: null, skin: DEFAULT_SKIN, hair: DEFAULT_HAIR, hairStyle: "tousled" };
}
export function appearanceFor(id: string, saved?: Partial<Appearance>): Appearance {
  return { ...defaultAppearance(characterById(id)), ...(saved || {}) };
}
