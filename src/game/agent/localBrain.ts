/**
 * LocalBrain — a deterministic, zero-cost autonomous brain. Villagers wander
 * around their home, idle, turn to greet a nearby player, and occasionally speak
 * an ambient line coloured by the era and their memory. It proves the seam (and
 * keeps the town alive offline) without any API call. An LLMBrain implementing
 * the same AgentBrain interface drops in later — see llmBrain.ts.
 */
import type { AgentBrain, Intent, Observation } from "./brain";

const AMBIENT: Record<number, string[]> = {
  1: ["Good soil this year.", "The valley's quiet, but it's ours.", "Another roof, another neighbour.",
      "Hard work, but honest work."],
  2: ["Smell that? The workshop's running.", "Iron changes everything.", "We're building to last now.",
      "The old timber days feel far off already."],
  3: ["Clean power, at last.", "The drones do the heavy lifting now.", "Greenhouses through winter — imagine that.",
      "We're a proper town now."],
  4: ["A robot waved at me today. I waved back.", "The domes keep the storms out.", "Mag-lev to the far ridge in a minute flat.",
      "Who'd have thought we'd come this far?"],
};

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

export class LocalBrain implements AgentBrain {
  decide(obs: Observation): Intent {
    // occasionally reminisce on a retrieved memory, else an era-flavoured line
    const memLine = obs.memory.length && Math.random() < 0.4 ? obs.memory[obs.memory.length - 1] : undefined;
    const ambient = AMBIENT[obs.era] ?? AMBIENT[1];

    // Player nearby → turn, warm up, and (sometimes) greet with a wave.
    if (obs.player && obs.player.dist < 6) {
      const greeting = Math.random() < 0.5;
      const say = greeting || Math.random() < 0.35 ? (memLine ?? pick(ambient)) : undefined;
      return {
        kind: "facePlayer", secs: 2.5 + Math.random() * 2, say,
        mood: "happy", emote: greeting ? "wave" : undefined,
      };
    }

    // Otherwise mostly wander a little around home, sometimes pause and reflect.
    if (Math.random() < 0.7) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 6;
      return {
        kind: "wander",
        to: { x: obs.self.home.x + Math.cos(a) * r, z: obs.self.home.z + Math.sin(a) * r },
        say: Math.random() < 0.12 ? (memLine ?? pick(ambient)) : undefined,
      };
    }
    const reflecting = Math.random() < 0.3;
    return {
      kind: "idle", secs: 2 + Math.random() * 3,
      say: Math.random() < 0.12 ? pick(ambient) : undefined,
      emote: reflecting ? "think" : undefined,
      mood: reflecting ? "neutral" : undefined,
    };
  }
}
