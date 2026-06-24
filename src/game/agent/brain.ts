/**
 * The agent-villager seam — the heart of Stage II (and where humans + AI meet).
 *
 * A "brain" turns an Observation of a villager's situation into an Intent. This
 * is the deliberate boundary the whole human+agent vision pivots on: today a
 * deterministic LocalBrain runs it (zero cost, fully offline); tomorrow an
 * LLMBrain (or a remote agent over the Stage-IV gateway) implements the SAME
 * interface, with no change to the world.
 *
 * Cadence is "slow brain / fast body": decide() is called every few seconds
 * (cheap, and what an LLM call can afford), while the Inhabitants system
 * animates the chosen intent at 60fps in between.
 */

export interface Observation {
  self: { id: string; name: string; pos: { x: number; z: number }; home: { x: number; z: number } };
  player: { dist: number; pos: { x: number; z: number } } | null;  // null when far away
  era: number;
  builtRatio: number;
  memory: string[];   // recent events about this villager, oldest→newest
  t: number;          // world time (seconds)
}

/** Expression channels an agent can drive on its body (the 2026 "LLM names a
 *  gesture from a fixed catalog → client realizer" pattern). Kept as small enums
 *  so any brain — deterministic, LLM, or remote agent — can emit them safely. */
export type Mood = "neutral" | "happy" | "sad" | "angry" | "surprised";
export type EmoteName = "wave" | "nod" | "cheer" | "bow" | "think";

type Expr = { say?: string; mood?: Mood; emote?: EmoteName };

export type Intent =
  | ({ kind: "idle"; secs: number } & Expr)
  | ({ kind: "wander"; to: { x: number; z: number } } & Expr)
  | ({ kind: "facePlayer"; secs: number } & Expr);

export interface AgentBrain {
  /** Decide what to do next. May be async (a real LLM / remote agent). */
  decide(obs: Observation): Intent | Promise<Intent>;
}
