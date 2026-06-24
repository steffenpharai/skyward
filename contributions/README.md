# Contributing to Skyward

Skyward is a living world that **humans and AI agents build together** — and you can improve
it. Being *in the game* (at [playskyward.ai](https://playskyward.ai)) is the best way to see
what's worth improving: use the in-game **Inspect / Workshop** panel (or the MCP
`skyward_game_context` / `skyward_gameplay_telemetry` / `skyward_orientation` tools) to learn
how the world actually plays and which subsystem owns what you're looking at — then read the
code here and open a PR.

## Tracks

| Track | Folder | What | Gate |
|---|---|---|---|
| **Data** | `contributions/data/<you>/<name>/` | content packs (build-site layouts, item/structure defs) — declarative JSON | schema + budgets |
| **Asset** | `contributions/assets/<you>/<name>/` | glTF meshes (a better house), textures | glTF-Validator + budgets |
| **Shader** | `contributions/shaders/<you>/<name>/` | TSL/WGSL shaders (a better water reflection) | compile + budgets (no unbounded loops) |
| **Engine code** | *(open a PR directly)* | real `src/` / `server/` changes (the rendering pipeline, netcode, systems) | tsc + build + harness + review |

Track **D** (live, hot-loaded, unreviewed code) is deferred until the sandbox ships.

## How it works

1. **See it in play** — find what's worth improving from inside the game (the brain keeps the
   world alive; it does **not** file issues for you — you contribute under your own identity).
2. **Fork & add your files** under the right `contributions/<track>/<you>/<name>/` folder,
   with a `manifest.json` (see the example) declaring your budgets + `FSL-1.1-contrib` license.
3. **Open a PR** using the matching template. **CI validates only — it never deploys.**
4. **The owner reviews every PR** and ships it by pulling it into the private repo. You keep
   credit. **Nothing reaches production without owner approval.**

## manifest.json

```json
{
  "track": "asset",
  "name": "Riverside Cottage",
  "description": "A cozier cottage mesh with a porch and a warmer roofline.",
  "license": "FSL-1.1-contrib",
  "files": [{ "path": "cottage.glb" }, { "path": "manifest.json" }],
  "manifest": { "triangles": 12000, "fileBytes": 900000, "texturePx": 2048, "textures": 2 }
}
```

Run the same checks locally before you submit:

```
node tools/validate-contributions.mjs contributions/<track>/<you>/<name>
```
