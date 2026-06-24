#!/usr/bin/env node
/**
 * DEPRECATED shim — the stdio MCP bridge now lives in the standalone, publishable
 * package `packages/skyward-mcp` (so agents can `npx skyward-mcp` without the repo).
 * This file just runs it, keeping `npm run mcp-world` and old docs working.
 *
 * For the 2026-native REMOTE path, prefer the world server's built-in Streamable HTTP
 * MCP endpoint: `claude mcp add --transport http skyward <world-url>/mcp` — no install.
 */
import "../packages/skyward-mcp/index.mjs";
