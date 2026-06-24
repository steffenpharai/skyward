/**
 * Skyward gameplay AI — STANDALONE runner (local/dev), HTTP client against a deployed world.
 *
 * PRODUCTION runs the brain CO-LOCATED inside the world service (server/world.mjs, gated by
 * SKY_BRAIN_INPROCESS) — no HTTP, no token, keys on the world. This standalone process is for
 * running the brain against a remote world from your machine (dev/testing). Both share the
 * same reasoning: server/brain-core.mjs. GAMEPLAY ONLY — no code, no repo, no GitHub.
 *
 * Run:  SKY_WORLD_URL=http://localhost:8788 SKY_BRAIN_TOKEN=... node server/brain.mjs
 */
import { createBrain, loadBible } from "./brain-core.mjs";

const WORLD = (process.env.SKY_WORLD_URL || "http://localhost:8788").replace(/^ws/, "http").replace(/\/$/, "");
const TOKEN = process.env.SKY_BRAIN_TOKEN || "";
const AUTH = { Authorization: "Bearer " + TOKEN, "content-type": "application/json" };
const POLL_MS = Number(process.env.SKY_BRAIN_POLL_MS || 8000);
const log = (...a) => console.log("[brain]", ...a);

const io = {
  log,
  async getDigest() { const r = await fetch(`${WORLD}/brain/digest`, { headers: AUTH }); if (!r.ok) throw new Error("digest " + r.status); return r.json(); },
  async act(a) { try { const r = await fetch(`${WORLD}/brain/act`, { method: "POST", headers: AUTH, body: JSON.stringify(a) }); return (await r.json()).result; } catch (e) { return "act-failed: " + e.message; } },
  async reportStatus(s) { try { await fetch(`${WORLD}/brain/status`, { method: "POST", headers: AUTH, body: JSON.stringify(s) }); } catch {} },
};

async function main() {
  if (!TOKEN) { log("FATAL: SKY_BRAIN_TOKEN required (the world must run with the same token)."); process.exit(1); }
  const bible = await loadBible();
  const brain = createBrain(io, bible);
  log(`standalone gameplay AI — world=${WORLD} provider=${brain.cfg.provider} heartbeat=${brain.cfg.heartbeatModel} deep=${brain.cfg.deepModel}`);
  log("GAMEPLAY ONLY — no code, no repo, no GitHub. Knows the whole world; touches no source.");
  await brain.tick();
  setInterval(() => brain.tick(), POLL_MS);
}
main();
