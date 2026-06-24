# Skyward — Development Notes

The full story, architecture deep-dive, and the hard-won gotchas. Read this before changing the rendering pipeline, the lighting, or the procedural assets.

## Table of contents
1. [Origin & the two pivots](#1-origin--the-two-pivots)
2. [Architecture overview](#2-architecture-overview)
3. [Rendering: WebGPU + TSL](#3-rendering-webgpu--tsl)
4. [Unified lighting, day-night & wind](#4-unified-lighting-day-night--wind)
5. [World generation & village composition](#5-world-generation--village-composition)
6. [Asset systems](#6-asset-systems)
7. [Player controller, collision & the character rig](#7-player-controller-collision--the-character-rig)
8. [The benchmark + capture harness](#8-the-benchmark--capture-harness)
9. [Gotchas (read these!)](#9-gotchas-read-these)

---

## 1. Origin & the two pivots

**Pivot 1 — Unity → Three.js.** Skyward started as a Unity project with an AI-asset pipeline (ComfyUI Flux+Pixar3D → Hunyuan3D → UniRig → Blender → Unity). On a 16 GB GPU this never produced shippable AAA assets; every *good* result came from CC0 packs, not generation. The reframe: the target isn't AAA and isn't made that way — it's a browser Three.js game with "procedural everything in code", which is exactly the sweet spot. Rebuilt from scratch in TypeScript + Three.js + Vite.

**Pivot 2 — WebGL → WebGPU/TSL.** The first build was WebGL + pmndrs `postprocessing` + raw GLSL `ShaderMaterial`s. r0.184 is current, but the *renderer track* matters more than the version: in 2026 all new engine investment is on the **WebGPU + TSL (Three Shading Language)** side (SSGI, native post nodes, compute, GPU-driven culling). Raw GLSL `ShaderMaterial` doesn't even run under `WebGPURenderer`. So Skyward was migrated to `three/webgpu` + `three/tsl`: every custom shader became a TSL `NodeMaterial`, the post stack became native TSL nodes, and the three legacy deps (`postprocessing`, `n8ao`, `three-custom-shader-material`) were dropped. WebGL2 remains as an automatic fallback.

After the migration came a full **asset-richness + composition pass**: character animation, leaf-card trees, a prop layer, a designed village layout, structure collision, contact decals, triplanar cliffs, and a real water-sky reflection.

## 2. Architecture overview

```
core/    the engine spine, renderer-agnostic where possible
  noise   the world heightfield (single source of truth for shape + collision)
  env     the single source of truth for LIGHTING (sun/sky/fog) — drives lights AND shaders
  wind    the single WIND field — CPU sampler + TSL function
  clock   frame timing;  input  keyboard/mouse;  post  the TSL render pipeline
nodes/   shared TSL building blocks (lighting, fog, sky, and the `tsl` facade)
world/   every procedural asset + the village `layout` plan + ground `decals`
player/  the kinematic controller + animated character, and the orbit camera
```

The two "single source of truth" modules — `core/env` (lighting) and `core/wind` — are the keystones. Before them, terrain lit via PBR while grass/water/foliage hand-rolled magic constants, so they never agreed and a day-night cycle was impossible. Now one elevation parameter drives the whole palette, and one wind field drives all motion.

## 3. Rendering: WebGPU + TSL

`src/main.ts` creates a `WebGPURenderer` (from `three/webgpu`) with `forceWebGL` wired to `?webgl`. **Init is async** (`await renderer.init()`) — skip it and you get a silent blank canvas. The render loop is `setAnimationLoop` and **pauses when `document.hidden`** (a backgrounded tab otherwise renders 156k blades + post forever and pegs the GPU).

`src/core/post.ts` builds a native TSL `RenderPipeline` (renamed from `PostProcessing` in r184):

```
pass(scene, camera).setMRT(mrt({ output, normal: normalView }))
  → GTAO            (ao node, half-res, gentle — high AO crushes thin grass)
  → cel Outline     (second-derivative + gradient of LINEARIZED depth; fades with distance)
  → Bloom           (mipmap)
  → ACES tonemap    (toneMapping node)  ── BEFORE the grade
  → grade           (saturation + manual contrast)
  → vignette
  → blue-noise dither (interleaved gradient noise — kills sky/AO banding)
  → SMAA            (final)
```

`renderer.toneMapping = NoToneMapping` (ACES lives in the node graph mid-stack). The grade runs *after* the tonemap — see gotcha #1.

**The TSL facade (`nodes/tsl.ts`).** `@types/three`'s node typings are over-strict (color vs vec3, `AttributeNode<string>`, strict math overloads) and fight correct shader code while adding no real safety. `nodes/tsl.ts` re-exports `three/tsl` verbatim at runtime, typed `any`. Import TSL from there, not from `three/tsl`.

**Material split.** PBR surfaces (terrain, trunks, rocks, houses, character) are `MeshStandardNodeMaterial` lit by the real light rig + `withRim` Fresnel via `emissiveNode`. Self-lit stylized surfaces (grass, foliage, water, flowers, sky) are `MeshBasicNodeMaterial` with a custom `colorNode` that reads `env` uniforms and fogs manually via `nodes/fog`.

## 4. Unified lighting, day-night & wind

`core/env.ts` interpolates a palette across hand-authored anchors — **night → dusk → golden → noon** — keyed by sun *elevation*. The default sits at the GOLDEN anchor (calibrated to the established look). `env.setSun(elevation)` recomputes everything and pushes to:
- the real lights (a `DirectionalLight` sun + `HemisphereLight` + `AmbientLight`, updated each frame in `sky.ts`),
- a bag of TSL `uniform()` nodes (`env.u.sunDir`, `sunColor`, `skyTop/mid/bot`, `fogColor`, …) that every custom shader reads.

Because both read the same source, the PBR and self-lit halves always agree, and a live day-night cycle is already plumbed (just animate `env.setSun`). `env.sunLight` also exposes the sun for shadow sampling. The sun was tuned to **2.9** intensity with a strong hemisphere/ambient fill (0.85 / 0.34) so shadowed surfaces don't crush to black (this replaces the RoomEnvironment IBL the migration dropped).

`nodes/sky.ts` exports `skyColorNode(dir)` — the gradient + sun halo/disk for any direction. It's shared by the sky dome *and* the water's reflected ray, so the lake reflects the real sky.

`core/wind.ts` is the single wind field: a direction + strength uniform, a CPU `windAt()` sampler, and a TSL `windSway(posWorld, phase, heightFactor, flutter)` function. Grass, trees (`materials.ts`), and flowers all call `windSway`, so the world moves coherently.

## 5. World generation & village composition

`core/noise.ts` (seed `20260618`) is the single source of world shape: `heightAt` = multi-octave fbm hills + a `smoothstep` mountain ring + a central meadow shelf + a carved lake basin. `normalAt`/`slopeDeg` come from finite differences. Collision is exact and free — no physics engine, no raycasts.

`world/layout.ts` is what makes the world read as a *designed place* instead of random scatter. It computes, deterministically:
- **the village** — a main street with houses lined up on both sides facing the road (correct spacing so the **fenced yards don't overlap**), plus houses framing the square behind the tower; each plot has a size + jitter for variety;
- **the cobble road** centreline;
- **farmsteads** — barn + fenced field positions out in the flatter meadow;
- **forest stands** — cluster centres so `standDensity(x,z)` makes trees form woods with sparse scatter between.

`scatter.ts`, `trees.ts` and `props.ts` all read from `VILLAGE` (and `inVillage()` keeps natural scatter out of the streets/yards), so the composition is consistent.

## 6. Asset systems

All scatter uses `InstancedMesh`; custom shaders use `instanceMatrix`/`instanceIndex` in the vertex stage.

- **terrain.ts** — heightfield `PlaneGeometry` (256²) with per-vertex biome colours, plus a **real triplanar rock material** (`triplanarTexture` of a procedural rock CanvasTexture) for albedo detail and `bumpMap` for surface relief, both steepness-weighted so the climbable cliffs get rock texture while the meadow stays clean.
- **grass.ts** — a curved 3-segment blade instanced across `TILE`-sized chunks. Per-blade normal from the blade yaw (spatial lighting variation — a single constant normal made it read as flat "LED" green), a dark-rooted base→tip ramp, base contact-darkening, macro cloud-dapple, backlit translucency, and `windSway`. ~156k blades.
- **trees.ts** — `broadleaf`/`conifer`/`birch` builders. Broadleaf/birch crowns = a small **noise-displaced hull core** (so you don't see through) + scattered **alpha-cutout leaf cards** whose normals are baked to point outward from the crown centre (spherified, so the canopy lights as one volume). A baked `fAO` vertex attribute shades the underside. Cards use `alphaTest` (cutout, no sorting; cheap) and skip the shadow pass (the core casts the canopy shadow). Conifers are dense overlapping cone tiers. Per-tree value jitter + wind sway. Placed by `standDensity`.
- **water.ts** — a circle mesh; the shader does analytic wave normals, **Fresnel reflection of the real sky** (`skyColorNode(reflect(V.negate(), N))`), depth-graded body colour, animated shoreline foam, and a sharp sun glint.
- **flowers.ts** — stem + soft rounded petals + domed centre, instanced per colour. Lit with a half-Lambert off the env sun (was flat unlit). Sways in the shared wind.
- **props.ts** — bushes (`toonFoliage`), lakeshore reeds/cattails/lily-pads/pebbles, forest-floor mushrooms/stumps/logs, the well, barrels/crates in yards, the cobble street along the road, and **farmsteads** (a `makeBarn` red barn with an extruded gable roof + a fenced crop field placed in front of the barn).
- **decals.ts** — `contactDecals()` lays soft dark radial discs (depthTest on, depthWrite off) under trees/rocks/houses so objects sit *in* the world.
- **scatter.ts** — rocks (position-hash-displaced dodecahedra), procedural houses (`makeHouse`: foundation, plaster, half-timber studs + braces, shingled roof, framed windows + flower boxes, planked iron-banded door, wall lantern, chimney, optional porch), **terrain-following yard fences** (`fenceLine` samples ground height per post and tilts rails post-to-post), and the **watchtower** (`makeTower`: shaft with stone courses, door, windows, banner, a spiral staircase, battlements, and a glowing beacon). `mergeByMaterial()` collapses each multi-mesh structure to one mesh per material (≈3000 → ≈420 draws at the full vista) while preserving lights.
- **materials.ts** — `withRim()` (Fresnel rim via `emissiveNode`), `toonFoliage()` and `toonLeafCards()` (never-black instanced foliage shaders: flat/spherified normal, banded toon diffuse with a high floor, rim, fog, wind, baked AO, leaf dapple).

## 7. Player controller, collision & the character rig

`player/player.ts` is kinematic (no physics). States: `ground / air / climb / glide`, each draining/regenerating stamina.

- **Terrain climb** — pressing into terrain steeper than `CLIMB_ENTER` (50°) enters `climb`; mantle when the slope eases.
- **Structure collision** — colliders from `scatter` (houses, tower) + `props` (barns) are passed to the `Player`. `resolveColliders()` pushes the player out of box/cylinder footprints (walls block). `groundHeightAt()` lets the player stand on a climbable structure's top (the tower deck).
- **Climbable tower** — the tower cylinder is `climb: true`. Pressing into it on foot enters a structure-climb that scales the wall (ascend with W/S, strafe around with A/D), then mantles onto the deck at the top. The spiral staircase is the visual cue.
- **Character rig** — `makeCharacter()` builds a jointed hierarchy: hips → torso → head, shoulders → elbows → hands, hips → knees → boots. `animate()` sets per-joint target eulers per state (idle/walk/run/climb/glide/air) and eases toward them, including **elbow and knee bend** so limbs articulate mid-segment. It's a bone-style rig, not a vertex-skinned mesh.

## 8. The benchmark + capture harness

`tools/score.mjs` computes the no-reference **Visual Richness Score (0–100)**. The app exposes `window.SKY`:
- `benchPose()` — canonical camera + seeded clouds (time-invariant scoring).
- `shoot('name')` — queues a capture; the render loop snaps the canvas and POSTs it to the dev server's `/__shot` endpoint → `tools/shots/`.
- `tick()` — drive a single frame manually (needed for verification when the visibility-pause has the auto-loop off, e.g. a headless/backgrounded tab).
- `env`, `player`, `orbit`, `renderer`, `effects` for live tuning.

> The benchmark is a useful regression guard but **a proxy** — it rewards colourfulness/contrast/edges, which is partly why ACES (vivid) scored far above AgX. Don't optimise the number past the point it diverges from how a human reads the frame; pair it with eyeballing and reference comparisons.

## 9. Gotchas (read these!)

These cost real time. Don't rediscover them.

1. **Saturated colours crushed to black** — the recurring "grass/trees/flowers go black" bug. Root cause: the colour grade ran in linear HDR *before* the tonemap, pushing saturated colours to near-pure channels ACES then crushed. **Fix: tonemap before the grade.**
2. **Self-lit instanced foliage on `MeshStandard` went black on shaded faces.** Fix: custom `MeshBasicNodeMaterial` shaders (`toonFoliage`/`toonLeafCards`) with a flat/spherified normal and a bright floor. Keep base colours BRIGHT — dark bases read black after the grade.
3. **`shadow()` inside a self-lit `MeshBasicNodeMaterial` overflows the TSL node graph** ("Maximum call stack exceeded" on first render). Confirmed twice. Vegetation casts but does not receive shadows.
4. **Per-blade grass shadow sampling = ~1 fps.** 156k thin overlapping blades each doing PCF is a hard perf wall.
5. **CSM (`CSMShadowNode`) is opt-in (`?csm`).** It works (`sun.shadow.shadowNode = new CSMShadowNode(sun, …)`, do *not* set `csm.camera`), but it re-renders every caster per cascade and roughly halves fps here. Default is the single player-following 4096 map.
6. **Never call `renderer.render()` directly on the `WebGPURenderer`** — it crashes/loses the WebGPU device (forces the WebGL2 fallback + a white screen until a server restart). Use `SKY.tick()` / `SKY.shoot()` to drive frames.
7. **A WebGPU canvas isn't preserved for an out-of-frame `toDataURL`.** Capture must happen IN the render loop (the `pendingShot` flag), not from an external call.
8. **A fresh WebGPU load shows ~1 fps for 1–3 s = pipeline compilation, not a hang.** Settle 2.5–3 s before measuring fps, and a poisoned Vite module graph (after a shader throws on load) needs a full reload to clear.
9. **Triplanar/leaf-card cost is OVERDRAW, not tris/draws.** Alpha-test cards are affordable if you skip their shadow pass and keep density moderate.
10. **Flat groups placed at one height float on slopes** — fences, decals, anything spanning terrain must sample `heightAt` per element (see `fenceLine`) or it floats/sinks.
11. **`mergeByMaterial` needs consistent attributes** — de-index + strip to position+normal before merging heterogeneous primitive geometries; preserve lights separately.
12. **Custom shaders need manual fog** (`nodes/fog`) — the standard light stack fogs automatically, custom `colorNode` materials don't.
13. **GTAO/N8AO crush thin geometry** toward black at intensity > ~0.4 regardless of AO colour — keep it gentle.
14. **Benchmark must be time-invariant** — seeded clouds + `resetClouds()` in `benchPose()`; recapture the baseline after any renderer/post change (absolute numbers shift; track deltas).
