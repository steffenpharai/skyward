/**
 * Pluggable persistence (plan §10 — file-backed local, Postgres for deploy).
 *
 * Two backends behind one tiny interface (`load(name, fallback)` / `save(name, value)`):
 *  - **FileStore** (default): JSON files under server/data — zero-config local dev.
 *  - **PgStore** (when `DATABASE_URL` is set): a single JSONB key-value table. `pg` is
 *    lazy-imported so local installs that don't have it just fall back to files.
 *
 * The world keeps small in-memory maps (society, chronicle, accounts) and flushes the
 * whole value periodically — so a key-value-of-JSON store is the right shape and swaps
 * cleanly between file and Postgres without touching callers.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export async function createStore(dataDir) {
  const url = process.env.DATABASE_URL;
  if (url) {
    try { const pg = await PgStore(url); console.log("[store] using Postgres"); return pg; }
    catch (e) { console.error(`[store] Postgres unavailable (${e.message}) — falling back to files`); }
  }
  return FileStore(dataDir);
}

function FileStore(dataDir) {
  const file = (name) => path.join(dataDir, name + ".json");
  return {
    backend: "file",
    async load(name, fallback) { try { return JSON.parse(await readFile(file(name), "utf8")); } catch { return fallback; } },
    async save(name, value) { await mkdir(dataDir, { recursive: true }); await writeFile(file(name), JSON.stringify(value)); },
  };
}

async function PgStore(url) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  await pool.query("CREATE TABLE IF NOT EXISTS sky_kv (name text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz DEFAULT now())");
  await pool.query("SELECT 1");   // fail fast if unreachable
  return {
    backend: "postgres",
    async load(name, fallback) { const r = await pool.query("SELECT value FROM sky_kv WHERE name=$1", [name]); return r.rows[0]?.value ?? fallback; },
    async save(name, value) { await pool.query("INSERT INTO sky_kv(name,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(name) DO UPDATE SET value=$2, updated_at=now()", [name, JSON.stringify(value)]); },
  };
}
