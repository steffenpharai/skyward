/**
 * Contribution manifest validation — the FAST first gate (schema + declared budgets).
 *
 * Builders (humans + agents) improve the world by submitting contributions that become
 * GitHub PRs against the PUBLIC repo, which the OWNER reviews + pulls into private to ship.
 * This module is the cheap, synchronous pre-check (run in the MCP propose tool + client-side):
 * it validates the manifest shape, the declared perf budgets, and the license — so obviously
 * invalid submissions are rejected instantly. The REAL validation (glTF-Validator, shader
 * compile, sandbox dry-run, preview render, secret scan) happens in CI (contrib-validate.yml),
 * and the OWNER reviews every PR before it can ship. Nothing here touches a live system; the
 * server never opens PRs (no GitHub token) — it hands back a submission bundle the contributor
 * files under their OWN GitHub identity.
 */

export const TRACKS = new Set(["data", "asset", "shader"]);   // engine-code (Track C) goes straight to a GitHub PR; live-code (Track D) deferred
export const LICENSE = "FSL-1.1-contrib";

// Hard budget ceilings (the manifest must DECLARE within these; CI enforces the real values).
export const BUDGETS = {
  asset: { maxTriangles: 40000, maxFileBytes: 4 * 1024 * 1024, maxTexturePx: 4096, maxTextures: 8, maxBones: 64 },
  shader: { maxInstructions: 4000, maxTextureFetches: 16, maxBindings: 12 },
};

const isStr = (v, n = 1, m = 4000) => typeof v === "string" && v.trim().length >= n && v.length <= m;
const isNum = (v) => Number.isFinite(+v);

/**
 * @param {object} c  { track, name, description, license, files:[{path,...}], manifest:{...} }
 * @returns {{ ok:boolean, errors:string[], normalized?:object }}
 */
export function validateContribution(c) {
  const errors = [];
  if (!c || typeof c !== "object") return { ok: false, errors: ["contribution must be an object"] };
  if (!TRACKS.has(c.track)) errors.push(`track must be one of ${[...TRACKS].join(", ")} (engine code → open a PR on GitHub directly)`);
  if (!isStr(c.name, 3, 60)) errors.push("name must be 3–60 chars");
  if (!isStr(c.description, 8, 1000)) errors.push("description must be 8–1000 chars");
  if (c.license && c.license !== LICENSE) errors.push(`license must be "${LICENSE}"`);
  const files = Array.isArray(c.files) ? c.files : [];
  if (!files.length) errors.push("at least one file required");
  for (const f of files) {
    if (!f || !isStr(f.path, 1, 200)) { errors.push("each file needs a path"); continue; }
    if (f.path.includes("..") || f.path.startsWith("/") || /[^a-zA-Z0-9_\-./]/.test(f.path)) errors.push(`unsafe file path: ${String(f.path).slice(0, 60)}`);
  }
  const m = c.manifest || {};
  if (c.track === "asset") {
    const b = BUDGETS.asset;
    if (m.triangles != null && (!isNum(m.triangles) || +m.triangles > b.maxTriangles)) errors.push(`triangles must be ≤ ${b.maxTriangles}`);
    if (m.fileBytes != null && (!isNum(m.fileBytes) || +m.fileBytes > b.maxFileBytes)) errors.push(`fileBytes must be ≤ ${b.maxFileBytes}`);
    if (m.texturePx != null && (!isNum(m.texturePx) || +m.texturePx > b.maxTexturePx)) errors.push(`texturePx must be ≤ ${b.maxTexturePx}`);
    if (m.textures != null && (!isNum(m.textures) || +m.textures > b.maxTextures)) errors.push(`textures must be ≤ ${b.maxTextures}`);
    if (m.bones != null && (!isNum(m.bones) || +m.bones > b.maxBones)) errors.push(`bones must be ≤ ${b.maxBones}`);
  }
  if (c.track === "shader") {
    const b = BUDGETS.shader;
    if (m.instructions != null && (!isNum(m.instructions) || +m.instructions > b.maxInstructions)) errors.push(`instructions must be ≤ ${b.maxInstructions}`);
    if (m.textureFetches != null && (!isNum(m.textureFetches) || +m.textureFetches > b.maxTextureFetches)) errors.push(`textureFetches must be ≤ ${b.maxTextureFetches}`);
    // The classic GPU-hang vector — unbounded/data-dependent loops are rejected; CI confirms.
    if (m.hasUnboundedLoop === true) errors.push("shaders may not contain unbounded/data-dependent loops (GPU-hang risk)");
  }
  if (errors.length) return { ok: false, errors };
  const normalized = {
    track: c.track, name: c.name.trim().slice(0, 60), description: c.description.trim().slice(0, 1000),
    license: LICENSE, files: files.map((f) => ({ path: f.path })), manifest: m,
  };
  return { ok: true, errors: [], normalized };
}

/** Where a track's files live under /contributions/ on the public repo. */
export function contribDir(track, author, name) {
  const slug = (s) => String(s || "anon").toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 40);
  const folder = track === "data" ? "data" : track === "shader" ? "shaders" : "assets";
  return `contributions/${folder}/${slug(author)}/${slug(name)}`;
}
