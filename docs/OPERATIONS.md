# Operations & live-world notes

How to run, restart, and reason about the deployed/long-running world — plus the known
issues found while operating it. (Build history lives in `BUILD_LOG_*.md`; this is the
"running it" companion.)

---

## Running the world

The world is **one authoritative server** plus any number of **agents** (each its own process).

```bash
npm run world          # the authoritative world — ws + HTTP on :8788 (the source of truth)
# agents — ONE process each; give every agent a DISTINCT owner (see "per-owner cap" below)
SKY_AGENT_NAME=Auro    SKY_AGENT_OWNER=auro    node server/agent.mjs
SKY_AGENT_NAME=Lyra    SKY_AGENT_OWNER=lyra    node server/agent.mjs
SKY_AGENT_NAME=Builder SKY_AGENT_OWNER=builder node server/agent.mjs
```

The resident agent is **deterministic** — it needs no LLM. It runs the build curriculum:
**join → walk to the Gatekeeper → check in → claim frontier → author structures.**

### Per-owner claim cap (important)

Claims are capped **per owner** (anti-fleet, sybil-resistant): base 1, +1 per 25 reputation.
**Agents that share an owner share one cap** — so 5 agents all owned by `host` means only
~1–2 can ever claim land; the rest idle/wander. **Give each agent a distinct
`SKY_AGENT_OWNER`** so they each get their own cap and all build.

---

## Restarting on new code (the #1 gotcha)

Node loads `.mjs` once at process start — it does **not** hot-reload. After editing the
server or the agent, the running processes keep the **old** code until restarted. Symptoms of a
stale server/agents: `/health` returns `chronicleLen` instead of `feedLen`, `/feed` 404s, and
agents loop on greetings instead of building.

**Detect which code is live:**
```bash
curl -s localhost:8788/health         # new code → "feedLen"; old code → "chronicleLen"
curl -s -o /dev/null -w "%{http_code}" localhost:8788/feed   # 200 new, 404 old
```

**Restart cleanly (Windows / PowerShell):**
```powershell
# stop the world server (frees :8788)
(Get-NetTCPConnection -LocalPort 8788 -State Listen).OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }
# stop all agent processes
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*agent.mjs*' -and $_.CommandLine -notlike '*mcp-world*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```
Then relaunch `npm run world` + the agents (distinct owners). The world server persists state
on graceful shutdown and every 15 s; a hard kill loses at most the last few seconds.
**Reload the browser tab too**, so the client reconnects to the fresh server. Restarting only
the world server is **not** enough — old agent *processes* still have the old brain (and can't
pass the new Gatekeeper), so they must be restarted as well.

---

## Known issue — "this era is complete" / stale genesis settlement

**Symptom:** joining the shared world shows *"this era is complete · gather & explore,"* and the
onboarding **Builder** beat (raise a build-site) has nothing to build.

**Root cause:** the founding town (Genesis) build-progression is **server-authoritative and
persisted** in `server/data/settlement.json`. A long-running world becomes fully built through
the last era (4, Futuristic Colony) and stays that way. On the current dev world this file is
even **stale pre-0.6.0 data** — it still lists deleted **Mars-era** sites (`launch_a`,
`habitat_a`, `terraformer_a`, `terraformer_b`) that no longer map to any content. So the client
syncs a fully-built genesis → "era complete."

**It is not game-over.** Skyward is endless; "complete" only means the *starter town* is built.
Agents keep growing the world on the **frontier** (claim → author) regardless of genesis state.

**Two follow-ups (not yet applied):**
1. **Reframe the wording** — "this era is complete" is leftover linear-campaign language; in an
   endless world it should read e.g. *"The founding town is fully raised — claim the frontier to
   keep building."* (`game.ts` `advanceEra()` banner + the objective line.)
2. **Make the onboarding Builder beat resilient** — when genesis is already complete, teach a
   still-available action instead of stalling on a non-existent build-site (`quest.ts`).
3. *(Optional cleanup)* **Reset the stale settlement** — clearing `server/data/settlement.json`
   gives a fresh genesis and removes the dead Mars ids. Shared-world reset; keep
   `accounts/society/feed/regions` if you only want to reset the settlement.

---

## Verified live behaviour (2026-06-20)

After restarting the world + four agents on the new code (distinct owners), observed on the live
`:8788` world:
- Feed beats: 4 × `checkin`, 4 × `claim`, authoring underway — **no greeting loop**.
- `/regions`: `r_1_0:claimed(auro)`, `r_0_1:developing(lyra)`, `r_0_-1:claimed(builder)`,
  `r_-1_0:developing(sol)` — each agent claimed a distinct frontier parcel and began building.
- `/health`: `feedLen` present (new code), agents online, the human (you) in-world.

The full pipeline works end-to-end: **join → Gatekeeper check-in → claim distinct frontier →
author structures.**
