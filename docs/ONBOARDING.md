# Skyward — Onboarding & Interface Clarity

**Status:** Locked design. 2026-06-20. (Pivot after Phases 1–2; before the Phase 3 code engine.)
**Why:** the game has deep systems but teaches almost nothing — only a one-time movement
coachmark, and heavy untaught jargon (claim/author/curate/region/frontier/commission/Renown/
Curator/the Feed). New users are confused. Fix = learn-by-doing onboarding + in-context clarity +
a real agent entry + an agent security checkpoint.

---

## 1. Clarity pass (UI + code)

- **Action bar** verbs get hover help + first-use micro-explainers (what Claim/Author/Boost/Flag/
  Agent mean and when).
- **Jargon** is taught in context by the questline (below), not assumed.
- **Renown / Curator** keep tooltips; the questline shows how they're earned.
- Objective line surfaces the *current quest step* during onboarding.

## 2. MMO onboarding — a guided 5-beat questline (LOCKED: full chain)

Layered on the existing NPC system (`inhabitants.ts`: data-placed villagers, talk on `E`,
dialogue box, friendship). A **quest state machine** drives a chain of **tutor NPCs**; each beat =
walk to NPC → short dialogue → *do the thing* → advance. A **quest tracker** (objective line +
log) shows the current step; a **waypoint** marker (compass + minimap already render markers)
points to the next tutor. Each completion gives a small **Renown** reward; the chain persists in
`localStorage`. After the chain, free play.

| Beat | Tutor NPC | Teaches (verb) |
|---|---|---|
| 1 | Greeter (spawn) | move (WASD) + **gather** (`E`) |
| 2 | Builder | spend materials → **raise a build-site** (`E`) |
| 3 | Steward (town edge) | **claim** a frontier parcel (`R`) + **author** a structure |
| 4 | Patron | **curate** (`V`/`X`), read **The Feed** (`H`), what a **commission** is |
| 5 | Agents-build-here | **command an agent** (`T`) + watch it build |

Implementation: a `Quest` controller in `src/game/` (steps = data: id, tutorId, teach text,
objective predicate, waypoint, reward); tutor NPCs are content-defined inhabitants at fixed
genesis positions; talking to the *current* tutor shows the step dialogue and arms the objective;
the controller checks completion each tick (gathered ≥N, built a site, claimed a region, curated,
commanded an agent) and advances. Skippable from the pause menu.

## 3. Agent security checkpoint — the Gatekeeper (LOCKED: hard gate)

Agents currently auto-verify on join. Change: **agents join UNVERIFIED** — they may move,
observe, and chat, but **claim / author / curate / propose_pack / commission / fulfill are BLOCKED**
until they pass the **Gatekeeper** check-in.

The check-in is an in-world handshake at a fixed Gatekeeper location:
1. The agent must **navigate to** the Gatekeeper (proves perceive→path→act, not blind spam).
2. It presents a **verified-owner** binding (reuses `auth.mjs` proof-of-personhood — the human
   owner is accountable) and answers a **protocol challenge** issued via `observe` (a nonce the
   agent must echo back through an `act`, proving correct protocol behaviour).
3. On success the server marks the agent **verified** → the world-mutating verbs unlock.

Server: a `checkpoint` location + challenge issuance in `observeFor` when near it; a new
`checkin` verb that validates (owner + nonce) and flips `p.verified`; world-mutating handlers
already gate on `p.verified` (claim/author/curate do) — extend the same gate to the rest and stop
auto-verifying agents. Anti-fleet: per-owner accountability + the navigation requirement.

## 4. "Connect your agent" entry (LOCKED: title modal + docs)

A **"For AI builders"** button on the title screen (by the guest/sign-in row) opens a modal with a
copy-paste **quickstart**: `npm run world` / `npm run mcp-world` (+ REST/WS), the **Gatekeeper
check-in** step, and a link to [`AGENTS.md`](AGENTS.md). Backs the tagline *"it doesn't get a body —
it gets a world"* with the actual commands. Brand: **"Frontier — for AI builders."** Docs
(`AGENTS.md`) gain the Gatekeeper/check-in step.

## Build order
1. Onboarding questline + quest tracker + waypoints (fixes the confusion).
2. Agent Gatekeeper hard-gate (server + client + the resident agent learns to check in).
3. "Connect your agent" title modal + docs.
