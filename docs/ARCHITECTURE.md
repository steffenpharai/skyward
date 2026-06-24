# Skyward Architecture — builder orientation

> A map for **builders** (humans + agents) of which subsystem governs what you see in the
> game, and **where in this repo to look**. Pair it with the in-game Inspect/Workshop panel
> and the MCP `skyward_orientation` tool. This is orientation, not a tutorial — read the
> actual code in the paths below.

## Shape of the system

- **Client** (`src/`, TypeScript + Three.js / WebGPU): renders the world, the HUD, and the
  player; talks to the authoritative server over WebSocket.
- **Authoritative server** (`server/world.mjs`, Node + `ws`): the single source of truth —
  presence roster, regions/claiming/curation, settlement, society, the Feed, commissions, and
  the agent ingresses (WebSocket, REST `/agent/*`, MCP `/mcp`).
- **Agents** (`server/agent.mjs`) + **the gameplay AI brain** (`server/brain.mjs`): residents
  and the world's host intelligence. The brain is gameplay-only (no code/GitHub).
- **Deploy**: `skyward-private` (the hub) → public `skyward` → Google Cloud Run. Only the
  owner deploys; community contributes via PRs to the public repo.

## Subsystem map

| Area (what you see in-game) | Where to look | Notes |
|---|---|---|
| Water / reflections | `src/world/water.ts` | lake surface + reflection look |
| Terrain / regions | `src/world/regions.ts`, `server/shared/regions.mjs` | infinite heightfield + region grid |
| Structures / buildings | `src/world` (buildStructure), `src/game/content/*` | content is declarative data |
| Characters / avatars | `src/game/player.ts`, `src/game/characters.ts` | mesh, outfits, locomotion |
| Sky Dragon | `src/net/dragon.ts`, `server/shared/dragon.mjs` | deterministic circuit |
| HUD / UI | `src/game/hud.ts`, `src/ui/*`, `index.html` | on-screen interface + panels |
| Multiplayer / netcode | `src/net/net.ts`, `src/net/remotes.ts`, `server/world.mjs` | authoritative world + presence |
| Gameplay AI / agents | `server/brain.mjs`, `server/agent.mjs` | the world brain + host agents |
| Content / world data | `src/game/content/*.ts` | items, structures, eras — data |

## How to contribute (see `contributions/README.md`)

1. See what's worth improving from inside the game (Inspect/Workshop or the MCP game-context tools).
2. Read the relevant code here; build your change.
3. Data / asset / shader → drop files under `contributions/<track>/<you>/<name>/` and open a PR
   (CI validates). Engine code → open a PR against `src/`/`server/` directly.
4. The owner reviews + ships every PR. Nothing deploys without owner approval.
