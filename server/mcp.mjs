#!/usr/bin/env node
/**
 * Skyward MCP server — lets an MCP client (Claude, etc.) PLAY the live world.
 * Speaks the Model Context Protocol over stdio (newline-delimited JSON-RPC 2.0,
 * no SDK dependency) and exposes two tools that bridge to the gateway relay
 * (server/index.mjs): `skyward_observe` reads the world, `skyward_act` issues an
 * action the running browser game executes. Start the game + `npm run server`
 * first, then point an MCP client at `node server/mcp.mjs`.
 */
import readline from "node:readline";

const BASE = process.env.SKY_BASE || "http://localhost:8787";

const TOOLS = [
  {
    name: "skyward_observe",
    description: "Get the current Skyward world state as JSON: era, inventory, build sites (with cost/built/affordable), inhabitants, and live AI agents.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "skyward_act",
    description: "Act on the LIVE Skyward world. `type` is one of: 'spawn_agent' (with name) — drop in an autonomous AI builder; 'build' (with siteId) — construct an affordable site; 'say' (with name, text) — speak into the world; 'gather_at' (with x, z) — gather resources at a point; 'contribute' (with pack) — submit a content pack (validated + applied).",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["spawn_agent", "build", "say", "gather_at", "contribute"] },
        name: { type: "string" }, siteId: { type: "string" }, text: { type: "string" },
        x: { type: "number" }, z: { type: "number" }, pack: { type: "object" },
      },
      required: ["type"],
    },
  },
];

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
function ok(id, result) { send({ jsonrpc: "2.0", id, result }); }
function fail(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }

async function callTool(name, args) {
  if (name === "skyward_observe") {
    const r = await fetch(`${BASE}/api/observe`);
    return JSON.stringify(await r.json());
  }
  if (name === "skyward_act") {
    const r = await fetch(`${BASE}/api/act`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args || {}) });
    return JSON.stringify(await r.json());
  }
  throw new Error("unknown tool: " + name);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  try {
    if (method === "initialize") {
      ok(id, { protocolVersion: params?.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "skyward", version: "0.3.0" } });
    } else if (method === "notifications/initialized" || method === "initialized") {
      // notification — no response
    } else if (method === "ping") {
      ok(id, {});
    } else if (method === "tools/list") {
      ok(id, { tools: TOOLS });
    } else if (method === "tools/call") {
      const text = await callTool(params.name, params.arguments || {});
      ok(id, { content: [{ type: "text", text }] });
    } else if (id !== undefined) {
      fail(id, -32601, "method not found: " + method);
    }
  } catch (e) {
    if (id !== undefined) fail(id, -32603, String(e));
  }
});
