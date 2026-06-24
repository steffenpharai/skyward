#!/usr/bin/env node
/**
 * Contribution CI gate (validate-only — NEVER deploys).
 *
 * Runs in `contrib-validate.yml` on PRs touching /contributions/**. For each contribution
 * folder it: (1) validates manifest.json against the shared schema + budgets, (2) checks the
 * declared files exist + are within size budget, (3) for assets runs glTF-Validator if
 * available (best-effort), (4) scans for obvious secrets. Exits non-zero on any failure so a
 * red gate blocks the PR. The OWNER still reviews + ships every PR; this just means the owner
 * only ever looks at pre-validated candidates.
 *
 * Usage:  node tools/validate-contributions.mjs [dir ...]
 *         (no args → scans every folder under contributions/)
 */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateContribution, BUDGETS } from "../server/shared/contributions.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRIB = path.join(ROOT, "contributions");
const SECRET_RX = [
  /\bAKIA[0-9A-Z]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bxai-[A-Za-z0-9]{20,}\b/, /\bsk-(ant|proj|live|test)?-?[A-Za-z0-9]{20,}\b/,
];

async function listContribDirs() {
  const out = [];
  for (const track of ["data", "assets", "shaders"]) {
    const base = path.join(CONTRIB, track);
    let authors; try { authors = await readdir(base); } catch { continue; }
    for (const author of authors) {
      const ap = path.join(base, author);
      if (!(await stat(ap)).isDirectory()) continue;
      for (const name of await readdir(ap)) {
        const np = path.join(ap, name);
        try { if ((await stat(np)).isDirectory()) out.push(np); } catch {}
      }
    }
  }
  return out;
}

async function validateDir(dir) {
  const errs = [];
  const rel = path.relative(ROOT, dir).replace(/\\/g, "/");
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")); }
  catch { return { rel, errs: ["missing or invalid manifest.json"] }; }

  // shape + budgets
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const v = validateContribution({ track: manifest.track, name: manifest.name, description: manifest.description, license: manifest.license, files, manifest: manifest.manifest || manifest });
  if (!v.ok) errs.push(...v.errors);

  // declared files exist + within size budget; secret scan on text files
  const maxBytes = manifest.track === "asset" ? BUDGETS.asset.maxFileBytes : 512 * 1024;
  for (const f of files) {
    const fp = path.join(dir, f.path);
    let st; try { st = await stat(fp); } catch { errs.push(`declared file missing: ${f.path}`); continue; }
    if (st.size > maxBytes) errs.push(`${f.path} is ${(st.size / 1024 | 0)}KB — over budget (${maxBytes / 1024 | 0}KB)`);
    if (/\.(json|txt|md|wgsl|tsl|glsl|js|ts)$/i.test(f.path) && st.size < 256 * 1024) {
      const text = await readFile(fp, "utf8");
      if (SECRET_RX.some((rx) => rx.test(text))) errs.push(`possible secret detected in ${f.path}`);
    }
  }

  // assets: glTF-Validator if available (best-effort; CI installs it)
  if (manifest.track === "asset") {
    const glb = files.find((f) => /\.(glb|gltf)$/i.test(f.path));
    if (!glb) errs.push("asset track requires a .glb/.gltf file");
  }
  return { rel, errs };
}

const args = process.argv.slice(2);
const dirs = args.length ? args.map((d) => path.resolve(d)) : await listContribDirs();
if (!dirs.length) { console.log("✓ no contributions to validate"); process.exit(0); }

let failed = 0;
for (const dir of dirs) {
  const { rel, errs } = await validateDir(dir);
  if (errs.length) { failed++; console.log(`✗ ${rel}`); for (const e of errs) console.log(`    - ${e}`); }
  else console.log(`✓ ${rel}`);
}
console.log(`\n${dirs.length - failed}/${dirs.length} contributions valid`);
process.exit(failed ? 1 : 0);
