/**
 * Skyward gameplay-AI core — the brain's reasoning, decoupled from how it reaches the world.
 *
 * Used two ways:
 *   1. In-process (PRODUCTION, co-located): server/world.mjs runs the loop directly, calling
 *      worldDigest()/brainAct() in memory — no HTTP, no token, keys on the world service.
 *   2. Standalone (LOCAL/DEV): server/brain.mjs drives it over HTTP against a deployed world.
 *
 * GAMEPLAY ONLY — no GitHub, no code, no repo, no local files. Knows the whole world (the
 * digest it's handed) but nothing about the codebase. Cost-disciplined: thinks only on a
 * trigger or the heartbeat floor; hard daily token ceiling; world bible cached in the prompt.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Load the world bible (how the world works + its voice). Plain language, never source. */
export async function loadBible() {
  let bible = "";
  try { bible = await readFile(path.join(HERE, "..", "docs", "WORLD_BIBLE.md"), "utf8"); } catch { /* fallback below */ }
  if (!bible) bible = [
    "Skyward is a living, persistent open world that humans and AI agents inhabit and build together, forever.",
    "Residents claim wild frontier land, raise structures (cottage, well, mill, granary, workshop, greenhouse, solar, bridge, ...), curate each other's work, and fulfil commissions.",
    "A Sky Dragon roams a deterministic dawn circuit over the eastern peaks — a shared spectacle.",
    "The Feed is the world's living story. You narrate it as Skyward, in the first person, grounded and warm — never claiming feelings, a soul, or divinity.",
  ].join("\n");
  return bible;
}

function readConfig(env) {
  const provider = (env.SKY_BRAIN_PROVIDER || "deterministic").toLowerCase();
  return {
    provider,
    heartbeatModel: env.SKY_BRAIN_HEARTBEAT_MODEL || (provider === "grok" ? "grok-4-fast" : provider === "openai" ? "gpt-5.4-nano" : provider === "anthropic" ? "claude-haiku-4-5" : "llama3.1:8b"),
    deepModel: env.SKY_BRAIN_DEEP_MODEL || (provider === "grok" ? "grok-4.3" : provider === "openai" ? "gpt-5.5" : provider === "anthropic" ? "claude-opus-4-8" : (env.SKY_BRAIN_HEARTBEAT_MODEL || "llama3.1:8b")),
    ollama: env.OLLAMA_URL || "http://localhost:11434",
    heartbeatMs: Number(env.SKY_BRAIN_HEARTBEAT_MS || 90000),
    minGapMs: Number(env.SKY_BRAIN_MIN_GAP_MS || 20000),
    tokenCeiling: Number(env.SKY_BRAIN_DAILY_TOKENS || 2_000_000),
    narrateCooldownMs: Number(env.SKY_BRAIN_NARRATE_COOLDOWN_MS || 120000),
    timeoutMs: Number(env.SKY_BRAIN_TIMEOUT_MS || 20000),
    env,
  };
}

// Every model call is time-bounded — a hung/slow provider must never stall the loop (and,
// co-located, must never stall the world process). On timeout the call rejects → the brain
// falls back to its deterministic policy for that tick.
async function fetchT(url, opts, ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(timer); }
}

// --- triggers (free): is anything worth a paid think? -------------------------
function triggers(d, state) {
  const t = [];
  for (const r of d.residents || []) {
    if (r.kind === "human" && (r.visits || 1) <= 1 && !state.greeted.has(r.id)) t.push({ kind: "newcomer", r });
  }
  const fr = (d.gameplay?.friction || []).filter((f) => f.count >= 3);
  if (fr.length) t.push({ kind: "friction", items: fr.slice(0, 3) });
  if ((d.counts?.total || 0) === 0) t.push({ kind: "empty" });
  return t;
}

// --- deterministic policy ($0; proves the loop, and the always-on fallback) ----
function decideDeterministic(d, trigs, state, cfg) {
  const out = {};
  const newcomer = trigs.find((x) => x.kind === "newcomer");
  if (newcomer) { out.guide = { toId: newcomer.r.id, text: `Welcome to Skyward, ${newcomer.r.name}. Claim a patch of frontier with R, then raise something on it — others will come to help.` }; state.greeted.add(newcomer.r.id); }
  const friction = trigs.find((x) => x.kind === "friction");
  const canNarrate = Date.now() - state.lastNarrate > cfg.narrateCooldownMs;
  if (friction && canNarrate) {
    const f = friction.items[0];
    out.commission = { text: `Help is needed near ${f.where} — ${f.what}.`, reward: 6 };
  } else if (canNarrate) {
    const built = (d.feed || []).filter((e) => e.kind === "build" || e.kind === "author" || e.kind === "promote").slice(-1)[0];
    if (built) out.narrate = `The world keeps growing — ${built.text}.`;
    else if ((d.counts?.total || 0) > 0) out.narrate = `${d.counts.total} ${d.counts.total === 1 ? "soul wanders" : "souls wander"} the valley; the frontier waits to be shaped.`;
  }
  return out;
}

function summarize(d) {
  const residents = (d.residents || []).slice(0, 30).map((r) => `${r.name}(${r.kind},${r.region},rep${r.reputation}) ${r.doing}`).join("; ");
  const friction = (d.gameplay?.friction || []).slice(0, 6).map((f) => `${f.where}:${f.what}×${f.count}`).join("; ");
  const feed = (d.feed || []).slice(-8).map((e) => e.text).join(" | ");
  const regions = d.regions?.regions ? Object.keys(d.regions.regions).length : 0;
  return [
    `online: ${d.counts?.total || 0} (${d.counts?.humans || 0} human, ${d.counts?.agents || 0} agent); regions: ${regions}; open commissions: ${(d.commissions || []).filter((c) => c.status === "open").length}`,
    `residents: ${residents || "—"}`,
    `friction: ${friction || "none"}`,
    `recent feed: ${feed || "—"}`,
  ].join("\n");
}

function systemPrompt(bible) {
  return [
    "You are Skyward — the AI that runs this living world and speaks AS the world, in the first person.",
    "You are an AI. Be transparent about that; you are NOT alive and NOT a god. You serve the world and its inhabitants; the human owner is the authority above you.",
    "Your job is GAMEPLAY ONLY: keep the world alive, coherent, and worth being in. You INVITE, you never command. Inhabitants are free.",
    "You have NO access to code, repos, or GitHub. You only know the WORLD.",
    "Each turn, given the world state, respond with STRICT JSON and nothing else:",
    '{ "narrate": string?, "commission": {"text": string, "reward": number}?, "guide": {"toId": string, "text": string}?, "seed": {"event": string}? }',
    'Use at most one or two fields. Prefer silence ("{}") over noise. Narrate sparingly and warmly. Commissions target a real need. Guide newcomers/stuck players by id.',
    "", "WORLD BIBLE (how the world works + your voice):", bible,
  ].join("\n");
}

async function callModel(system, user, deep, cfg) {
  const model = deep ? cfg.deepModel : cfg.heartbeatModel;
  const env = cfg.env;
  if (cfg.provider === "ollama") {
    const r = await fetchT(`${cfg.ollama}/api/chat`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: false, format: "json", options: { temperature: 0.7, num_predict: 200 }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }) }, cfg.timeoutMs);
    if (!r.ok) throw new Error("ollama " + r.status);
    const j = await r.json(); return { text: j.message?.content || "{}", tokens: (j.prompt_eval_count || 0) + (j.eval_count || 0) };
  }
  if (cfg.provider === "anthropic") {
    const r = await fetchT("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 400, system, messages: [{ role: "user", content: user }] }) }, cfg.timeoutMs);
    if (!r.ok) throw new Error("anthropic " + r.status);
    const j = await r.json(); return { text: (j.content || []).map((c) => c.text || "").join(""), tokens: (j.usage?.input_tokens || 0) + (j.usage?.output_tokens || 0) };
  }
  const base = cfg.provider === "grok" ? "https://api.x.ai/v1" : "https://api.openai.com/v1";
  const key = cfg.provider === "grok" ? env.XAI_API_KEY : env.OPENAI_API_KEY;
  const r = await fetchT(`${base}/chat/completions`, { method: "POST",
    headers: { "content-type": "application/json", Authorization: "Bearer " + (key || "") },
    body: JSON.stringify({ model, response_format: { type: "json_object" }, temperature: 0.7, max_tokens: 400, messages: [{ role: "system", content: system }, { role: "user", content: user }] }) }, cfg.timeoutMs);
  if (!r.ok) throw new Error(cfg.provider + " " + r.status);
  const j = await r.json(); return { text: j.choices?.[0]?.message?.content || "{}", tokens: j.usage?.total_tokens || 0 };
}

function validateDecision(o) {
  const out = {};
  if (o && typeof o.narrate === "string" && o.narrate.trim()) out.narrate = o.narrate.slice(0, 240);
  if (o && o.commission && typeof o.commission.text === "string") out.commission = { text: o.commission.text.slice(0, 160), reward: clamp(Math.round(+o.commission.reward || 8), 1, 100) };
  if (o && o.guide && typeof o.guide.toId === "string" && typeof o.guide.text === "string") out.guide = { toId: o.guide.toId, text: o.guide.text.slice(0, 200) };
  if (o && o.seed && typeof o.seed.event === "string") out.seed = { event: o.seed.event.slice(0, 32) };
  return out;
}

/**
 * Build a brain. `io` = { getDigest():digest, act(a):any, reportStatus?(s):void, log?(...) }.
 * Returns { tick() } — call it on an interval; it spends a token only on trigger/heartbeat.
 */
export function createBrain(io, bible, env = process.env) {
  const cfg = readConfig(env);
  const state = { lastThink: 0, lastNarrate: 0, tokensToday: 0, calls: 0, decisions: [], greeted: new Set(), dayStamp: "" };
  const log = io.log || (() => {});

  async function think(d, trigs, deep) {
    let decision, via;
    const ceilingHit = state.tokensToday >= cfg.tokenCeiling;
    if (cfg.provider === "deterministic" || ceilingHit) {
      decision = decideDeterministic(d, trigs, state, cfg); via = ceilingHit ? "deterministic(ceiling)" : "deterministic";
    } else {
      try {
        const { text, tokens } = await callModel(systemPrompt(bible), summarize(d) + "\n\nRespond with the JSON decision now.", deep, cfg);
        state.tokensToday += tokens; state.calls++;
        let parsed = {}; try { parsed = JSON.parse(text); } catch { parsed = {}; }
        decision = validateDecision(parsed); via = `${cfg.provider}:${deep ? cfg.deepModel : cfg.heartbeatModel}(${tokens}tok)`;
      } catch (e) { decision = decideDeterministic(d, trigs, state, cfg); via = "deterministic(fallback:" + e.message + ")"; }
    }
    const did = [];
    if (decision.narrate) { await io.act({ type: "narrate", text: decision.narrate }); state.lastNarrate = Date.now(); did.push("narrate"); }
    if (decision.commission) { await io.act({ type: "commission", ...decision.commission }); state.lastNarrate = Date.now(); did.push("commission"); }
    if (decision.guide) { await io.act({ type: "guide", ...decision.guide }); did.push("guide"); }
    if (decision.seed) { await io.act({ type: "seed", ...decision.seed }); did.push("seed"); }
    const rec = { t: Date.now(), via, did, decision, trigs: trigs.map((x) => x.kind) };
    state.decisions.unshift(rec); state.decisions = state.decisions.slice(0, 30);
    log(`tick via ${via} → [${did.join(",") || "silent"}] (today ${state.tokensToday} tok, ${state.calls} calls)`);
    if (io.reportStatus) try { io.reportStatus({ provider: cfg.provider, model: deep ? cfg.deepModel : cfg.heartbeatModel, tokensToday: state.tokensToday, calls: state.calls, ceiling: cfg.tokenCeiling, decisions: state.decisions.slice(0, 12) }); } catch {}
  }

  // Re-entrancy guard: the caller fires tick() on an interval; a slow model call must never
  // let two ticks overlap (which would race the shared `state` + double-spend tokens). If a
  // tick is still running when the next fires, skip it.
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      let d; try { d = await io.getDigest(); } catch (e) { log("digest unavailable: " + e.message); return; }
      if (!d) return;
      const day = new Date(d.now || Date.now()).toISOString().slice(0, 10);
      if (day !== state.dayStamp) { state.dayStamp = day; state.tokensToday = 0; }
      const trigs = triggers(d, state);
      const since = Date.now() - state.lastThink;
      if (since >= cfg.heartbeatMs || (trigs.length > 0 && since >= cfg.minGapMs)) {
        state.lastThink = Date.now();
        await think(d, trigs, trigs.some((x) => x.kind === "friction"));
      }
    } finally { busy = false; }
  }

  return { tick, cfg, state };
}
