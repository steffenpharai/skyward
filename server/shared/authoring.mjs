/**
 * Tier-A authoring validation — the gate agents author the world THROUGH.
 *
 * Phase 3 authoring is PURE DATA: an agent proposes a content pack of build-sites
 * placed in REGION-LOCAL coordinates onto land it stewards. Because a pack is data
 * (no executable code), it is inherently deterministic and safe — the validator's
 * job is to enforce structure, region-local bounds, a known structure allow-list,
 * and per-pack / per-region budgets. (Tier-B sandboxed "World Skills" — agents
 * writing code — is deferred per the locked plan; this is the data substrate it
 * will build on.)
 */
import { REGION_SIZE } from "./regions.mjs";

// The structures the client can render (mirrors the buildStructure() switch).
export const ALLOWED_STRUCTURES = new Set([
  "cottage", "well", "granary", "mill", "bridge", "workshop", "signpost",
  "solar", "greenhouse", "drone_hub", "reactor", "dome", "maglev", "robot_bay",
]);
export const MAX_SITES_PER_PACK = 12;
export const MAX_SITES_PER_REGION = 48;
const HALF = REGION_SIZE / 2;

/**
 * Validate + normalize an agent-authored pack. `existingCount` is how many sites the
 * target region already holds (for the budget check). Returns
 * { ok, errors:[], pack:{ buildSites:[...] } } with a sanitized pack on success.
 */
export function validateAuthoredPack(obj, existingCount = 0) {
  const errors = [];
  const out = { buildSites: [] };
  if (!obj || typeof obj !== "object") return { ok: false, errors: ["pack must be an object"], pack: out };

  const sites = Array.isArray(obj.buildSites) ? obj.buildSites : null;
  if (!sites) { errors.push("buildSites[] required"); return { ok: false, errors, pack: out }; }
  if (sites.length < 1) errors.push("buildSites must contain at least one site");
  if (sites.length > MAX_SITES_PER_PACK) errors.push(`too many sites in one pack (max ${MAX_SITES_PER_PACK})`);
  if (existingCount + sites.length > MAX_SITES_PER_REGION) errors.push(`region site budget exceeded (max ${MAX_SITES_PER_REGION})`);

  sites.forEach((s, i) => {
    if (!s || typeof s !== "object") { errors.push(`buildSites[${i}] must be an object`); return; }
    const x = Number(s?.pos?.x), z = Number(s?.pos?.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) { errors.push(`buildSites[${i}].pos{x,z} must be finite`); return; }
    if (Math.abs(x) > HALF || Math.abs(z) > HALF) { errors.push(`buildSites[${i}].pos out of region bounds (±${HALF})`); return; }
    if (!ALLOWED_STRUCTURES.has(s?.structure)) { errors.push(`buildSites[${i}].structure not allowed: ${String(s?.structure).slice(0, 24)}`); return; }
    out.buildSites.push({
      id: (String(s.id || "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 48)) || `site_${i}`,
      name: String(s.name || "Structure").replace(/[<>&]/g, "").slice(0, 48),
      pos: { x: +x.toFixed(2), z: +z.toFixed(2) },
      structure: s.structure,
      rot: Number.isFinite(+s.rot) ? +s.rot : 0,
    });
  });

  return { ok: errors.length === 0, errors, pack: out };
}
