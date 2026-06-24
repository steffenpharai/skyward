/**
 * ⚠️  DEV-ONLY — DO NOT DEPLOY OR EXPOSE PUBLICLY.  ⚠️
 *
 * This is the legacy single-process relay used behind the Vite dev proxy
 * (`npm run server`). It is INTENTIONALLY UNAUTHENTICATED and sets
 * `access-control-allow-origin: *` — anyone who can reach it can read/write world
 * state, queue actions, and approve contributions. It has been SUPERSEDED in
 * production by `server/world.mjs` (the authoritative, authenticated server that
 * the Dockerfile actually runs). Keep this for local development only; never bind
 * it to a public interface.
 *
 * Skyward backend — the unified server that grows across the agent stages.
 *
 *  Stage II  POST /api/brain   → proxies a villager's decision to local Ollama
 *  Stage III GET/PUT /api/state → durable world/player save (file-backed now)
 *  Stage IV  POST /api/observe, /api/act  → the agent-as-player gateway (humans
 *            and AI agents act on the same world over HTTP; WS upgrade later)
 *  Stage V   POST /api/contribute (queued), GET /api/contributions, POST
 *            /api/contributions/:id/approve → the human-in-the-loop review queue
 *
 * Runs on Node 24 (global fetch). No external deps. Same-origin from the browser
 * via the Vite dev proxy (vite.config.ts → /api).
 */
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "data");
const SAVE = path.join(DATA, "save.json");
const QUEUE = path.join(DATA, "contributions.json");

const OLLAMA = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = process.env.SKY_MODEL || "llama3.1:8b";
const PORT = Number(process.env.SKY_PORT || 8787);

// Stage VI agent budget: cap brain calls across all agents per rolling window.
const brainHits = [];
const BRAIN_WINDOW_MS = 10000;
const BRAIN_MAX = 40;

// Stage IV gateway relay: the browser is the world authority. It PUTs a world
// snapshot and drains a command queue; external agents (or the MCP server) GET
// the snapshot and POST actions. This lets a remote agent play the LIVE world.
let worldSnapshot = null;
const commandQueue = [];
let actSeq = 0;

function send(res, code, body, type = "application/json") {
  res.writeHead(code, {
    "content-type": type,
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-allow-methods": "GET,PUT,POST,OPTIONS",
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}
async function readJSON(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; }
}
async function writeJSON(file, obj) {
  await mkdir(DATA, { recursive: true });
  await writeFile(file, JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, "");
  const url = new URL(req.url || "/", "http://x");
  const p = url.pathname;
  try {
    if (p === "/health" || p === "/api/health") return send(res, 200, { ok: true, model: MODEL, ollama: OLLAMA });

    // --- Stage II: villager brain → Ollama ---
    if (p === "/api/brain" && req.method === "POST") {
      // Stage VI: budget/rate-limit agents so they can't overrun the model.
      const now = Date.now();
      while (brainHits.length && now - brainHits[0] > BRAIN_WINDOW_MS) brainHits.shift();
      if (brainHits.length >= BRAIN_MAX) return send(res, 429, { error: "rate limited", intent: null });
      brainHits.push(now);

      const { system, user, model } = JSON.parse((await readBody(req)) || "{}");
      const r = await fetch(`${OLLAMA}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: model || MODEL, stream: false, format: "json", keep_alive: "10m",
          options: { temperature: 0.85, num_predict: 120 },
          messages: [{ role: "system", content: system || "" }, { role: "user", content: user || "" }],
        }),
      });
      if (!r.ok) return send(res, 502, { error: `ollama ${r.status}` });
      const data = await r.json();
      let intent = null;
      try { intent = JSON.parse(data.message?.content || "null"); } catch { /* model returned non-JSON */ }
      return send(res, 200, { intent });
    }

    // --- Stage II memory: text embedding → Ollama (nomic-embed-text) ---
    if (p === "/api/embed" && req.method === "POST") {
      const { text, model } = JSON.parse((await readBody(req)) || "{}");
      const r = await fetch(`${OLLAMA}/api/embed`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: model || "nomic-embed-text", input: text || "" }),
      });
      if (!r.ok) return send(res, 502, { error: `ollama embed ${r.status}` });
      const data = await r.json();
      const vec = data.embeddings?.[0] ?? data.embedding ?? null;
      return send(res, 200, { vec });
    }

    // --- Stage III: durable world/player save ---
    if (p === "/api/state") {
      if (req.method === "GET") return send(res, 200, (await readFile(SAVE, "utf8").catch(() => "null")));
      if (req.method === "PUT") { await writeJSON(SAVE, JSON.parse((await readBody(req)) || "null")); return send(res, 200, { ok: true }); }
    }

    // --- Stage IV gateway: world snapshot + action relay ---
    // browser PUTs the snapshot; external agents GET it via /api/observe
    if (p === "/api/world" || p === "/api/observe") {
      if (req.method === "PUT") { worldSnapshot = JSON.parse((await readBody(req)) || "null"); return send(res, 200, { ok: true }); }
      if (req.method === "GET") return send(res, 200, worldSnapshot ?? null);
    }
    // browser drains queued commands
    if (p === "/api/commands" && req.method === "GET") return send(res, 200, commandQueue.splice(0));
    // external agent (or MCP server) queues an action on the live world
    if (p === "/api/act" && req.method === "POST") {
      const cmd = JSON.parse((await readBody(req)) || "{}");
      if (!cmd || typeof cmd.type !== "string") return send(res, 400, { error: "need { type, ... }" });
      commandQueue.push({ id: "a" + (++actSeq), ...cmd });
      return send(res, 200, { ok: true, id: actSeq, queued: commandQueue.length });
    }

    // --- Stage V: human-in-the-loop contribution queue ---
    if (p === "/api/contribute" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const queue = await readJSON(QUEUE, []);
      const id = "c" + (queue.length + 1) + "_" + Math.random().toString(36).slice(2, 7);
      queue.push({ id, status: "pending", pack: body.pack, by: body.by || "agent", note: body.note || "" });
      await writeJSON(QUEUE, queue);
      return send(res, 200, { ok: true, id });
    }
    if (p === "/api/contributions" && req.method === "GET") {
      return send(res, 200, await readJSON(QUEUE, []));
    }
    const m = p.match(/^\/api\/contributions\/([^/]+)\/(approve|reject)$/);
    if (m && req.method === "POST") {
      const queue = await readJSON(QUEUE, []);
      const c = queue.find((x) => x.id === m[1]);
      if (!c) return send(res, 404, { error: "no such contribution" });
      c.status = m[2] === "approve" ? "approved" : "rejected";
      await writeJSON(QUEUE, queue);
      return send(res, 200, { ok: true, status: c.status });
    }

    send(res, 404, { error: "not found", path: p });
  } catch (e) {
    send(res, 500, { error: String(e) });
  }
});

server.listen(PORT, () => console.log(`[skyward-server] listening :${PORT} → Ollama ${OLLAMA} (model ${MODEL})`));
