/**
 * Gameplay telemetry capture (experiential, never code).
 *
 * Samples how the world PLAYS — frame-feel per region — and POSTs an aggregate, no-PII beat
 * to the world's /telemetry endpoint every ~30s. The world folds it into the digest, which
 * feeds the gameplay AI's tending AND the builder game-context layer (so devs/agents know
 * what's worth improving). Never sends file:line, errors, or anything code-level.
 */
export interface TelemetrySample {
  region?: string;
  fps?: number;
  jank?: number;                 // count of long frames (>33ms) in the window
  friction?: { where: string; what: string }[];
  flow?: "newcomerStuck" | "shortSession";
}

export function startTelemetry(base: string, sample: () => TelemetrySample | null, periodMs = 30000): () => void {
  const post = () => {
    let s: TelemetrySample | null = null;
    try { s = sample(); } catch { s = null; }
    if (!s) return;
    try {
      fetch(`${base}/telemetry`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(s), keepalive: true,
      }).catch(() => {});
    } catch { /* offline / no world — telemetry is best-effort */ }
  };
  const id = setInterval(post, periodMs);
  return () => clearInterval(id);
}
