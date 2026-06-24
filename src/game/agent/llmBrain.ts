/**
 * LLMBrain — the drop-in adapter that makes a villager a real AI agent. It
 * implements the SAME AgentBrain interface as LocalBrain, so swapping it in is a
 * one-line change in Inhabitants (gated by config). It is intentionally NOT wired
 * by default: it needs an endpoint (and budget) the operator supplies. The thin
 * server that proxies the model + holds the durable memory stream is Stage III;
 * until then this calls a configurable endpoint and falls back to LocalBrain on
 * any error so the town never freezes.
 *
 * Cadence note: decide() is async and only runs on the slow tick (every few
 * seconds), so one cheap call per villager per few seconds — the budget the
 * research says agent-inhabitants must respect.
 */
import type { AgentBrain, Intent, Observation } from "./brain";
import { LocalBrain } from "./localBrain";

export interface LLMBrainConfig {
  endpoint: string;            // POST {system, user} -> { intent }
  apiKey?: string;             // supplied by the operator, never hardcoded
  model?: string;
}

const SYSTEM = `You play a single villager in a cozy, non-combat frontier-town-to-future game.
Given your situation, reply with ONE compact JSON intent and nothing else:
{"kind":"idle","secs":3,"say":"..."} | {"kind":"wander","to":{"x":..,"z":..},"say":"..."} | {"kind":"facePlayer","secs":3,"say":"..."}
Stay near home. Keep "say" short, warm, in-character, and referencing your memory/era when natural. "say" is optional.`;

export class LLMBrain implements AgentBrain {
  private fallback = new LocalBrain();
  constructor(private cfg: LLMBrainConfig) {}

  async decide(obs: Observation): Promise<Intent> {
    try {
      const res = await fetch(this.cfg.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: this.cfg.model, system: SYSTEM, user: JSON.stringify(obs) }),
      });
      if (!res.ok) throw new Error(`brain endpoint ${res.status}`);
      const data = await res.json();
      const intent = (data.intent ?? data) as Intent;
      if (!intent || typeof (intent as any).kind !== "string") throw new Error("bad intent");
      return intent;
    } catch {
      // Never freeze the town — fall back to the local autonomous behaviour.
      return this.fallback.decide(obs);
    }
  }
}
