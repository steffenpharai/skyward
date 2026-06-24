/**
 * Which brain drives the villagers. Real local-Ollama agents by default; append
 * `?local` to force the offline LocalBrain (e.g. when the backend isn't running),
 * or `?model=NAME` to try a different Ollama model. The LLMBrain falls back to
 * LocalBrain on any error, so the town is robust either way.
 */
import type { AgentBrain } from "./brain";
import { LocalBrain } from "./localBrain";
import { LLMBrain } from "./llmBrain";

const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();

export const USE_LLM = !params.has("local");
export const BRAIN_MODEL = params.get("model") || "llama3.1:8b";

export function makeBrain(): AgentBrain {
  return USE_LLM ? new LLMBrain({ endpoint: "/api/brain", model: BRAIN_MODEL }) : new LocalBrain();
}
