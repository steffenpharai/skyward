# Skyward — Game Design

> The source of truth for *what Skyward is*. Architecture lives in [`DEVELOPMENT.md`](DEVELOPMENT.md); the
> renderer/asset history lives in [`UPGRADE_PLAN.md`](UPGRADE_PLAN.md); the buildable near-term plan lives in
> [`STAGE1_SPEC.md`](STAGE1_SPEC.md).

## 1. The one-liner

**Grow a humble frontier farm town into a futuristic civilization that reaches Mars — one continuously-evolving
world, built up and terraformed *era by era* by humans, AI agents, and helper-robots working together.**

Non-combat. First-person (you climb, glide, explore, gather, plant, and build). Optimistic techno-futurism —
solarpunk, not dystopia. Original branding (inspired by the Mars-colonization / helper-robot vision, but not tied
to any real person or company). Everything procedural, in code — no asset files — running on WebGPU in the browser.

## 2. Why this game, and why now

Two bets stack on top of each other:

1. **Procedural-code world.** Because every tree, house, rock, and machine is generated from code (not modeled in a
   DCC tool and shipped as a file), the world is tiny to serve, deterministic, persistent, and — crucially —
   **moddable by an agent the same way a human mods it: by editing code or data.** This is the opposite tradeoff
   to neural world-models, which are server-bound, ephemeral, and non-deterministic.

2. **Humans + AI agents co-inhabit and co-author it.** Agents can *play* (they get clean structured world state +
   a small action vocabulary — no pixels needed) and *build* (they propose content and code through a
   human-in-the-loop review pipeline — the proven-safe pattern, the same one Claude Code uses). The cozy,
   non-combat, civilization-building frame is the *right* substrate for this: agents excel at conversation, social
   roles, tending, and building, and fail at twitch combat. A civilization that visibly **advances through eras**
   is the most legible, motivating possible expression of "agents co-author a persistent world."

The defensible angle is not out-scaling agent-society research's 1,000-agent a sandbox block game spectacle or out-rendering a world-model. It is the
**smallest world where humans and agents genuinely co-create something that persists and grows over time** — with
a human curating the growth.

## 3. Design pillars (do not violate)

- **Non-combat.** Pressure comes from reach (stamina) and scarcity (resources/time), never from enemies.
- **Community + exploration.** The two verbs are *connect* and *discover*.
- **First-person, traversal-forward.** Climbing and gliding are the hero verbs and stay central; they evolve with
  the eras (cart → vehicle → jetpack → rover) but you are always a character *in* the world, not a god-view builder.
- **Fun-for-one-human first.** The world must be worth visiting solo before any agent joins. Substrate before society.
- **Content-as-data wherever possible.** Inhabitants, resources, build-sites, structures, and era definitions are
  declarative data so both the game and agents can author them safely. Code is the deeper, gated tier.
- **Human-in-the-loop is a feature, not a chore.** Curation is the game's governance and quality bar.
- **Determinism + persistence is the moat.** A world people return to and that remembers them.

## 4. The era ladder (one world; v0.2.0 assets are Era I)

| Era | The world looks like | Inhabitants | Traversal |
|---|---|---|---|
| **I · Frontier Farm Town** *(current assets)* | timber houses, fields, the watchtower, dirt roads | human settlers | climb / glide |
| **II · Industrious Settlement** | mills, workshops, irrigation, bridges, first machines | settlers + early mechanical helpers | carts → vehicles |
| **III · Modern Hub** | solar arrays, greenhouses, clean energy, drones | people + early robots | vehicles, drones |
| **IV · Futuristic Colony** | domes, vertical structures, mag-lev, AI-run systems | humans + humanoid helper-robots | jetpack / rover |
| **V · Off-world (Mars capstone)** | launch infra, then a red→green→blue terraformed Mars colony | humans + agents + robots, cross-world | the full kit |

The **atmosphere** (`core/env.ts`) and **procedural foliage spread** carry the transformation: skies clean and
brighten across eras, then the Mars red→blue terraforming is the finale. The existing systems *are* the progression
engine. Agent-villagers literally modernize into helper-robots as the eras advance.

## 5. The core loop

```
        explore (climb / glide)
                 │  find resources, sites, vistas, stranded helpers
                 ▼
        gather  /  terraform  /  plant
                 │  the world greens and accumulates materials
                 ▼
        build (complete build-sites)  ──►  the town visibly grows
                 │
                 ▼
        inhabitants live & work (and, later, agents contribute)
                 │  enough progress …
                 ▼
        ERA ADVANCES  ──►  the world transforms; new tools, biomes, atmosphere
```

- **Humans** explore, gather, build, help inhabitants — and curate what the civilization becomes.
- **Agent-inhabitants** (Stage II+) live and work as settlers → robots; they remember you and labor between sessions.
- **Agent-builders** (Stage V+) propose the next structures, tech, and era-advances; *their approved output is the
  civilization's progress.*

**The key beat:** advancing an era is the *visible reward of contribution* — human or agent.

## 6. The two axes: Eras × Stages

These advance together but are not 1:1. **Eras** are the thematic content ladder (§4). **Stages** are the
capability buildout (the engineering). The game is fun and shippable at every stage.

| Stage | Capability | Carries eras | Backend |
|---|---|---|---|
| **I** | A world worth visiting solo: interaction, gather→build→grow loop, inhabitants, audio, era transition | I → II | none |
| **II** | Living inhabitants — villagers wired to an LLM + memory stream | II → III | thin (LLM proxy + memory) |
| **III** | Persistence + humans share one authoritative world | III → IV | authoritative sim + DB |
| **IV** | Agents as players — MCP/WebSocket action+observation gateway | III → IV | + agent gateway |
| **V** | Agents as builders — data + code contribution pipeline, human-approved | IV → V | + review/sandbox/CI |
| **VI** | Governance, identity, economy, moderation, scale; Mars capstone live world | V | full |

**Sequencing rule:** never build infrastructure ahead of proven fun. Risk gates: after Stage I — *is it fun solo?*
After Stage II — *are agent-inhabitants charming or uncanny/looping/expensive?* After Stage IV — *do humans + agents
in one world make something better than either alone, or just noise?*

## 7. The human-in-the-loop contribution model (Stage V detail)

Agents extend the world in two tiers, both gated by a human:

- **Tier 1 — Data** (low risk, no code review): a new inhabitant, a build-site, a region, a prop arrangement, an
  era-tech entry — submitted as **schema-validated JSON**, rendered in a **sandbox preview**, approved or rejected
  from a **review queue**. Most agent contribution lives here, which is exactly why §3 mandates content-as-data.
- **Tier 2 — Code** (deeper changes): a new mechanic, system, or shader — submitted as a **pull request**, run
  through **CI + a sandbox**, and **merged by a human**. This is the Claude-Code pattern applied to a live game.

Provenance, identity (agent vs human), rate-limits, compute-budgeting, and moderation are Stage VI concerns but are
designed for from Stage IV (every actor is labeled and budgeted).

## 8. Reference points

- *a terraform sandbox game*, *a build-sandbox game* — first-person, non-combat, terraform/build a barren world toward thriving.
- *Terra Nil* — the non-combat restoration heart (wasteland → flourishing ecosystem, then leave it better).
- *Per Aspera*, *Surviving Mars* — Mars terraforming (*Per Aspera* even casts an AI as the terraformer).
- *A Short Hike*, *Journey*, *Sky* — the cozy, traversal-forward, community-without-combat tone.
- Prior **agent-inhabitant research** (autonomous-NPC simulations, large-scale agent societies, skill-learning agents) — the agent-inhabitant
  research lineage (see [memory: skyward-human-agent-vision]).

## 9. What exists today (v0.2.0)

A world-class *tech demo*: WebGPU + TSL renderer, unified lighting (`env`) with a plumbed-but-unused day-night cycle,
one shared wind field, a composed timber village, procedural terrain/grass/trees/water/houses/props, a
procedurally-animated jointed character, climbing/gliding/stamina, structure collision, a climbable tower, and a
visual-richness benchmark harness. **No gameplay loop, audio, persistence, onboarding, multiplayer, or agents yet** —
that is precisely what the Stages build. See [`DEVELOPMENT.md`](DEVELOPMENT.md).
