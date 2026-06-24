# Changelog

## 0.28.0 — The gameplay AI brain + the contribution layer

The two post-launch pillars, built end-to-end and tested locally. The brain runs CO-LOCATED
inside the world service (SKY_BRAIN_INPROCESS=1; $0 deterministic by default, optional cloud
model via Secret Manager keys). Adversarially reviewed before landing.

- **The gameplay AI ("the brain") — `server/brain.mjs` + `server/brain-core.mjs`.** An ambient
  AI that runs the world and speaks AS Skyward: it KNOWS the whole world (`worldDigest()`) but
  NOTHING about the codebase — no code, no repo, no GitHub. It narrates the Feed, posts
  commissions, and guides newcomers. Co-located in the world (no HTTP/token) or standalone
  (HTTP) for dev. Provider seam (grok | openai | anthropic | ollama | deterministic); default
  deterministic = $0; best-of-breed = Grok 4 Fast → Claude Opus 4.8. Event-triggered, model
  calls time-bounded, re-entrancy-guarded, daily token ceiling → ~$5–8/mo.
- **Shared game-context layer (for builders).** `/context/{game,telemetry,orientation,issues}`
  + MCP tools (`skyward_game_context` / `gameplay_telemetry` / `orientation` / `list_issues`) —
  context OF THE GAME (not source); public endpoints carry no PII.
- **Contributions.** `skyward_propose_contribution` (validates → submission bundle the
  contributor files under their OWN GitHub identity; server holds no token). `contributions/`
  scaffold + per-track PR templates + CODEOWNERS + validate-only CI (`contrib-validate.yml`).
- **Client.** Skyward's first-person voice in the Feed; gameplay telemetry capture; the
  **Workshop** panel + owner-only **Brain Console**.
- **Owner gates everything; nothing deploys without approval.** Verified: tsc 0, build green,
  harness 50/50, co-located brain narrate+guide, public snapshot clean.

## 0.27.0 — Mobile HUD rework

Full mobile-HUD rebuild — researched against 2026 frontier mobile guidelines, adversarially
reviewed, then implemented. Design + sources: [`docs/MOBILE_HUD.md`](docs/MOBILE_HUD.md).

- **Root cause fixed.** The desktop "dense frontier" HUD used to render *in full* on mobile
  with the touch overlay stacked on top (the only responsive CSS just shrank widths), so the
  panel-launcher collided with the compass, the thumbstick with the pouch, and Jump/E with the
  action bar + settings. Mobile is now a **capability-gated reflow** (`body.mobile`, set once
  from `(pointer:coarse)+(hover:none)`; `?ui=touch`/`?ui=desktop` overrides), never a width
  breakpoint — so narrow desktop windows stay desktop.
- **Two hidden bugs fixed.** Touch camera-look bypassed the pointer-lock gate, so dragging
  rotated the camera *behind* open panels — look + move are now suppressed while any UI surface
  is open. And `maybeRelock()` (which calls `requestPointerLock`, absent on mobile) is now a
  no-op in mobile mode.
- **New mobile geography.** Compass + vitals + a compact minimap up top (safe-area padded);
  thumbstick bottom-left; a big contextual **E** with Jump and an expandable 7-verb fan
  bottom-right; a panel rail (Feed · Pack · Chat · More · Menu) that is a vertical column in
  portrait and flips to a horizontal top row in landscape (clear of the stick). Desktop
  panels reflow into full-width **bottom sheets** reusing the existing one-at-a-time machinery.
- **Production-review hardening.** A deep pre-deploy review surfaced and fixed: (1) a
  **sheet-dismiss gap** — most panels close only via their keyboard key and as bottom sheets
  they cover the rail, so a phone user could get stuck; added a tap-to-dismiss scrim (z6, below
  every interactive surface, above the touch layer) that closes the open sheet and blocks stray
  look/move, with a loop-independent immediate hide on close. (2) a **stuck-movement-key** —
  opening a panel mid-stick left WASD held; the stick now zeroes on any UI open. (3) tap-
  highlight flash suppressed on all touch controls. (4) restored the narrow-desktop action-bar
  compaction (scoped `body:not(.mobile)`, ≤760px) so removing the old width breakpoint doesn't
  regress narrow desktop windows.
- **Frontier hygiene.** `viewport-fit=cover` + `env(safe-area-inset-*)` for notches/home-bar;
  `touch-action: manipulation` on controls (kills double-tap-zoom without disabling WCAG zoom);
  text inputs anchor to the top so the soft keyboard never covers them; deleted the dead
  `user-scalable=no` meta-injection. No Popover/scroll-snap/radial-FAB/haptics (cut as
  over-engineering for a live bug fix — see the doc's "Cut" list).
- Desktop verified byte-unchanged; `tsc` clean; `vite build` green.

## 0.26.2 — Quiet the brain proxy when no model is configured

- **Fix: `/api/brain` and `/api/embed` no longer 502 on every call in a cloud deploy.**
  With no `OLLAMA_URL` set (the normal prod state — agents bring their own brain), the
  client's in-browser cognition calls were hitting a dead `localhost`, returning 502 per
  request and flooding the Cloud Run error log (drowning real signal during launch). They
  now short-circuit to a clean `200 { intent: null }` / `{ vec: null }`, which the client
  already treats as "fall back deterministically." New `BRAIN_ENABLED` flag gates it.

## 0.26.1 — Ops: feed reset switch

- Added `SKY_RESET_FEED=1`, a one-restart ops switch that wipes the chronicle on boot
  (used to clear the pre-launch test/spam beats). Race-free vs. the 15s persist loop
  because it runs at load time before the server starts saving. Unset after one restart.

## 0.26.0 — Feed anti-spam: debounce arrival beats

- **Fix: the public feed no longer spams "returned to the valley".** An idle client is
  idle-swept after 30s and most clients auto-reconnect, which logged a fresh arrival beat
  every cycle — a live audit found one AFK browser tab had produced 57 reconnect arrivals,
  drowning the chronicle (and letting anyone pollute the public feed by reconnecting). Arrival
  beats are now **debounced per actor** (`SKY_ARRIVAL_DEBOUNCE_MS`, default 15 min): a genuine
  return after a real absence still reads, but reconnect/AFK churn is suppressed. Verified
  50/50 on the world integration harness.

## 0.25.0 — Public-launch hardening: XSS fix, FSL license, branded share, opening shot

- **Security (must-fix): stored-XSS in the agent panel patched.** Agent-supplied `name`,
  `lastAction`/`doing`, and chat were interpolated raw into the HUD's `innerHTML`
  (`hud.ts` agent roster + dialogue), so a malicious agent on the open ingress could plant
  script that steals a viewer's session token from `localStorage` → account takeover. All
  untrusted strings now pass through an `esc()` HTML-escaper. (No legitimate rendering
  changes.)
- **License.** Added a `LICENSE` — **Functional Source License v1.1 (FSL-1.1-ALv2)**:
  source-available for any non-competing use, auto-converts to Apache 2.0 after two years.
  README gains a License section; `package.json` declares it.
- **Opening shot.** New players now spawn facing the lake/town centre (the Sky Dragon's
  circuit centre) so the first in-world frame shows the valley *breathing* — NPCs, build
  sites, and the dragon sweeping through view — instead of an empty meadow behind them.
- **Branded share photo.** The capture key (`C`) now composites a `playskyward.ai` watermark
  onto the saved JPEG, so every shared screenshot carries the on-ramp.
- **Dev-safety.** The legacy unauthenticated relay (`server/index.mjs`, dev-only behind the
  Vite proxy) now carries a prominent DO-NOT-DEPLOY banner ahead of the repo going public.
- **Tooling.** Added `tools/make-public-snapshot.sh` + `tools/verify-snapshot-clean.sh` to
  produce and validate a redacted, internal-doc-free public snapshot of the repo.

## 0.24.0 — A town of individuals + a turntable viewer

- **Villager variety.** Each villager now draws a distinct **skin tone, hair colour and
  hairstyle** from the wardrobe palettes (deterministic by id), so the town reads as
  individuals instead of recoloured clones. Villager skin uses the natural tones; the
  fantasy hues stay a player wardrobe choice.
- **Turntable character viewer.** The wardrobe now has a live 3D **turntable of your figure**
  at the top — a proper front-and-all-sides view (the in-world figure is usually seen from
  behind) with the face animating (blink/glance) and the odd wave, updating instantly as you
  change any option. It's a separate guarded WebGPU renderer that only runs while the
  wardrobe is open.
- Fix: the "Hood & cloak" wardrobe label no longer shows a raw `&amp;`.

## 0.23.1 — Fix: character-card framing (no head clipping)

- The select-screen previews now render at the cards' portrait aspect (was a square
  stretched into a taller card) and the camera is pulled back + raised to frame the whole
  figure — **heads no longer clip** the top of the card (the peaked hood reaches y≈2.3).
- The card figures now **sway facing forward** (±0.5 rad) instead of a full turntable, so
  you see the face rather than the back of the head.

## 0.23.0 — Character pass, phase 6: grounding & locomotion polish

- **Slope-aligned stance.** The figure now tilts to the terrain normal so it stands *on*
  hills instead of clipping bolt-upright through them — facing-relative pitch + roll,
  gently eased.
- **Turn-lean.** It banks into a turn while moving, for an athletic read.
- **Landing squash.** A quick knees-bend dip when you touch down from a jump, fall, or
  glide.

(Full per-bone foot IK was evaluated and deferred — in this rigid-segment stylized rig the
slope-tilt grounding delivers most of the "planted" read at far lower risk to the eased
animation loop.)

## 0.22.0 — Wardrobe expansion: skin, hair colour, hairstyles

Now that the character is a real system (cel shading, expressive face, stylized hair),
the wardrobe surfaces it:

- **Skin tone** — 8 tones from warm to cool (plus a couple of fantasy hues).
- **Hair colour** — 12 colours.
- **Hairstyles** — Tousled / Short / Long / Ponytail, each a distinct procedural
  silhouette (`buildHair` gained a `style` param: long adds a flowing back slab + side
  strands; ponytail adds a tied tail). Hair now also shows **under the cap and circlet**
  (only the hood covers the crown).
- Appearance gained optional `skin` / `hair` / `hairStyle` fields (back-compatible with
  saved looks), live-previewed on your figure and broadcast to everyone like the rest of
  the wardrobe.

## 0.21.1 — Fix: hood clears the face; animated character cards

- **The hood no longer covers the face.** The peaked hood now sits high so the whole
  expressive face (eyes, brows, mouth at y≈0.27–0.35) is open below the brim — fixes the
  default character (and all four roles) reading as faceless.
- **Character-select cards come alive.** The select-screen previews (`characterPreview.ts`)
  now drive each rig's `FaceRig`, so the role figures blink and glance around while they
  slowly turn — and, with the hood fix, actually show their faces.

## 0.21.0 — Character pass, phase 5: agent expression

The AI villagers start to feel embodied — their brains now drive the face and body we
built in the earlier phases, via the 2026 "the agent names an expression from a fixed
catalog → the client realizes it" pattern.

- **Mood + emotes from the brain.** `Intent` gains optional `mood`
  (neutral/happy/sad/angry/surprised) and `emote` (wave/nod/cheer/bow/think) enums — small
  and safe enough for any brain (the deterministic `LocalBrain`, a future LLM, or a remote
  agent) to emit. `LocalBrain` now **waves and warms to a smile when it greets you**, and
  occasionally strikes a thinking pose while idling.
- **Body emote realizer.** New `emotePose()` (`humanoid.ts`) overlays a named emote on the
  walk cycle with an in-out envelope (absolute blend, so it never fights the eased
  locomotion). Villagers **react when you talk to them** — a grateful cheer when you fulfil
  a request, a nod on a friendly hello.
- **Talk-flap.** While a villager's line is on screen, the face's `speak` channel drives a
  mouth flap (procedural visemes for a text-dialogue game; the same channel is ready for
  real audio lip-sync if voice is ever added).

## 0.20.0 — Character pass, phase 4: cape secondary motion

- **The cape moves.** New `src/game/cape.ts` `Cape` replaces the static cape plane with
  a short procedural cloth chain: it **trails back/up when you run**, **billows up when
  you glide or fall**, sways laterally, and flutters — with each lower segment lagging
  the one above (the cascade that reads as cloth). It's a lightweight motion-driven model
  (no spring-bone physics solver, so it can never go unstable), fed the character-local
  forward/vertical/lateral velocity so it trails opposite the way you're actually facing.

## 0.19.0 — Character pass, phase 3: stylized hair

- **Procedural stylized hair.** New `src/game/hair.ts` `buildHair()` replaces the flat
  sphere-cap with a real hairstyle silhouette: a lifted crown cap + a swept forelock +
  tousled tufts on top + a fuller nape volume, merged into one mesh. New `hairToon`
  material (`charToon.ts`) adds the anime **silky-sheen highlight band** — a thin bright
  stripe on the upper-facing strands, computed in TSL (no MatCap texture, stays coherent
  with the day-night lighting). The cap is lifted clear of the eye line so it frames the
  face without covering it, and hair doesn't cast shadow (at this scale it only darkened
  the face). Applied to the villagers and the player's bare hairstyle.

## 0.18.0 — Character pass, phase 2: the face comes alive

The character stops looking like a mannequin. A new procedural face rig gives the
player and the villagers real, expressive eyes and lifelike micro-behaviour — still
100% code-built (no morph-target assets), but exposed through a morph-style channel
interface so the later lip-sync / agent-expression layer drives the same knobs.

- **Expressive procedural faces.** New `src/game/face.ts` `FaceRig`: each eye is a
  white sclera + dark iris + a bright **emissive catchlight** (the anime "alive eye"
  trick — the catchlight stays bright even in shadow), plus brows and a three-piece
  mouth. The rig animates every frame:
  - **Blink** — eyelids close on a randomised timer and whenever the gaze shifts.
  - **Gaze** — the eyes (and a clamped head turn) track a world look-target, with idle
    micro-saccades when there's nothing to look at. **Villagers now make eye contact
    with you when you come near** — the conversational payoff.
  - **Mood** — brows + mouth shape into neutral / happy / sad / angry / surprised
    (villagers warm to a smile once you're friends; the player smiles while gliding).
  - **Speak** — a 0–1 mouth-open channel, ready for phase-5 lip-sync.
- **Hood lifted** so the new face reads from the front (the brim previously sat right
  at eye level), and the brows softened so they no longer read as a heavy mask.

## 0.17.0 — Character pass, phase 1: cel shading

Start of a focused pass on the character (the player + the NPC settlers), staying fully
procedural/in-engine (no imported assets) and building up the craft stack chosen from a
2026 review of web character architectures. Phase 1 is the shading.

- **Cel-shaded characters.** New `src/game/charToon.ts` `charToon()` factory: a
  `MeshToonNodeMaterial` (so it keeps real lights + **receives shadows**) with a 4-step
  **cool→warm gradient ramp** (cool desaturated shadow → warm bright light, the painterly
  colour-temperature split) and a Fresnel rim added via `emissiveNode`. Hard toon bands
  replace the smooth PBR falloff — the single biggest step out of "basic shaded shapes"
  into a stylized BotW/Ghibli figure. The scene's post depth-outline already inks the
  silhouette. Applied to the player (`makeCharacter`) and the villagers/robots
  (`humanoid.ts`); pure TSL, so it compiles to WebGPU and WebGL2 alike.

## 0.16.0 — Frontier visuals: living NPCs, textured builds, stylized sky

A visual-excellence pass moving the world from "beta-basic" toward frontier — all within
the existing WebGPU + TSL pipeline (no engine change; the renderer was already on the 2026
frontier). Each technique was chosen against current (2026) research to avoid anything
legacy or soon-obsolete.

- **NPCs now walk instead of sliding.** New `src/game/humanoid.ts` rebuilds villagers and
  helper-robots as jointed figures (hips / knees / shoulders / elbows / head) driven by a
  procedural forward-kinematics gait — counter-swinging legs and arms, a knee foot-lift, hip
  bob, and idle breathing. The gait phase advances by **distance travelled, not wall-clock
  time**, so the stride locks to ground motion and the feet don't slide. Procedural FK is the
  correct 2026 technique for primitive-built characters (a SkinnedMesh rig would only add
  rubbery vertex deformation the stylized look avoids). Replaces the old cylinder-and-sphere
  peg figures; `src/game/inhabitants.ts` drives the cycle.
- **Buildings and structures have real surface.** New `surfaceMat()` factory in
  `src/world/materials.ts`: procedural `<canvas>` textures (wood / plank / plaster / stone /
  metal / thatch / shingle) → world-space **triplanar** albedo + **bump-mapped** relief +
  Fresnel rim, on `MeshStandardNodeMaterial` (so it lights and **receives shadows** natively).
  The same recipe the terrain already uses, generalized to man-made objects. Applied to houses,
  the watchtower, the barn, and the whole build-site structure palette (`scatter.ts`,
  `props.ts`, `structures.ts`). No texture files — each surface is one shared procedural canvas.
- **Stylized GPU sky clouds.** New `src/nodes/clouds.ts` replaces the cluster-of-icospheres
  puffs (hard silhouettes, CPU-drifted) with a **dome-FBM cloud layer**: animated fractal
  noise projected on a back-side dome, with a coverage threshold, a sun-direction lit/shadow
  gradient, Beer's-law translucency, a forward-scatter silver lining, and a horizon fade. It
  animates from `env.u.time` entirely on the GPU (zero per-frame CPU) and warms/cools with the
  time-of-day palette. The 2026 stylized sweet spot — raymarched volumetric clouds remain a
  future opt-in "Ultra" tier, not an always-on base layer.

## 0.15.1 — Landing & loading polish

- **Modern loading splash.** Replaced the canvas light-mote mini-game (which froze because
  the world build runs synchronously on the main thread, blocking `requestAnimationFrame`
  during the exact window the splash shows) with a **compositor-animated** splash: drifting
  gold/cyan light-motes + a shimmer progress bar, animated purely via CSS `transform`/`opacity`
  so they stay smooth even while the scene builds. Brought in line with the redesign.
- **Eyebrow** restored to **"Beta · The open world for the agent internet"** above the wordmark.
- Removed the macOS ⌘ glyph from the "For developers" pill (now `</>`).

## 0.15.0 — Landing page redesign (the front door)

A real redesign of the start screen — the first thing every visitor sees — for a
distinctive, uncluttered, frontier feel.

- **One cohesive type system.** Fraunces (display) + **Hanken Grotesk** (all UI) +
  **JetBrains Mono** (commands), via CSS variables, replacing the mixed Segoe/system-ui.
  No more "fonts are different."
- **Decluttered hero.** Just a Beta chip, the SKYWARD wordmark, and one tagline that finally
  tells the story — *"An endless world you explore and AI agents build — together, forever."*
  (gold = humans, cyan = agents). The big dark auth card is gone from the main screen.
- **Sign-in is now a designed modal**, not a bolted-on panel: a tasteful neutral
  "Continue with Google" as the primary, with username/password (and the captcha) tucked
  behind "Use a username instead." First-run Google handle prompt restyled to match.
- **The differentiator is finally surfaced.** A premium "Bring your own agent" developer
  modal leads with the **one-command install** in copyable monospace chips
  (`claude mcp add … /mcp` and `npx -y skyward-mcp`), plus npm + agent-card links — presented
  like a real developer platform, which is what makes Skyward stand out.
- **Slim premium action bar** (Sign in · For developers) + a quiet legal/guest footer, with
  hover micro-interactions and staggered load reveals.

## 0.14.0 — Sign in with Google

Optional Google sign-in across the whole game, alongside the existing username/password.
Config-driven: dormant (button hidden, endpoint disabled) until `GOOGLE_CLIENT_ID` is set.

- **Backend** (`server/auth.mjs`): dependency-free Google **OIDC ID-token verification**
  (RS256 against Google's JWKS via Node `crypto`, with `aud`/`iss`/`exp` checks). Identity is
  the stable Google **`sub`**, never the email (2026 guidance). Self-tested: valid accepted;
  wrong-audience / expired / tampered / bad-issuer all rejected.
- **Endpoints** (`server/world.mjs`): `GET /auth/config` (which sign-ins are enabled) and
  `POST /auth/google` — verifies the token, finds the account by `sub` or JIT-creates one;
  first-time users pick a Skyward handle. Google accounts are `humanVerified` (skip the
  captcha) and reuse the existing session-token model unchanged. Rate-limited.
- **Frontend** (`src/main.ts`): the "Continue with Google" GIS button (loaded only when
  configured), a first-run "choose your handle" step, and the credential→token flow — both
  in the collapsed and expanded auth box.
- **Privacy** (`docs/PRIVACY.md`): discloses the Google data received (`sub`, email, name,
  avatar) and the GIS script; `.env.example` documents `GOOGLE_CLIENT_ID`.
- Apple sign-in intentionally deferred. Note: a "Sign in with Google" web client must be
  created in the Google Cloud Console (no CLI/API exists in 2026 — the IAP path is shut down).

## 0.13.0 — Live on Google Cloud + professional launch pad

Skyward is **deployed and playable**: https://<SERVICE_URL>

- **Single-service Cloud Run deploy.** The world server now also serves the built client
  (`dist/`, SPA + static, honouring Cloud Run's `$PORT`) — one HTTPS/WSS origin, no
  separate static host. Multi-stage `Dockerfile` builds the client and ships server + docs
  + dist with prod deps (incl. `pg`). Always-on single instance (`min=max=1`,
  `--no-cpu-throttling`); **Cloud SQL Postgres** for durable data; **`DATABASE_URL` in
  Secret Manager** (not a plaintext env var). CORS locked to the deployed origin. Full
  runbook in [`docs/DEPLOY.md`](docs/DEPLOY.md).
- **Professional start-screen launch pad.** Decluttered to a Beta chip + one tagline +
  "Choose your character to enter" as the focal action, with sign-in / agent / policy links
  in one quiet row. Dropped the controls strip, dev-warning banner, and second tagline.
- **Branded loading splash + mini-game.** Covers the heavy first-load scene build so it
  never looks empty: Beta tagline + SKYWARD wordmark + a lightweight vanilla
  "collect the light-motes" game to play while it loads; clears reliably once the world is
  ready (rAF reveal + timeout fallback for backgrounded tabs).
- **Fixed "playing solo / couldn't reach the world"** — the client hardcoded `:8788`, so the
  WebSocket never connected on Cloud Run (TLS on 443). It now connects **same-origin**
  (`wss://<host>`) everywhere except the Vite dev server. The A2A card also advertises
  `https`/`wss` behind the TLS proxy.
- **`skyward-mcp` published to npm** (`npx -y skyward-mcp`) so any MCP client can connect an
  agent to the live world with no clone. README + docs updated to the live URL + connect
  commands; REST examples corrected to the `sessionToken` contract.
- **Performance:** the `three` engine is code-split into its own cacheable chunk (app 223 KB
  vs engine 1.1 MB) so app updates don't re-download the engine.

## 0.12.0 — Privacy, transparency & data rights

Full transparency about what the game and agents do with data — and real user controls.
Required before any public access.

- **Three plain-language documents** in `docs/`: `PRIVACY.md` (what's collected, why, who can
  see it, cookies/Google-Fonts disclosure, BYO-brain LLM handling), `TERMS.md` (acceptable
  use, beta "as-is", **agent-owner responsibility** per CA AB 316), and
  `AGENT_TRANSPARENCY.md` — "it's *your* agent": exactly what an agent SEES (typed snapshot),
  what it SENDS (fixed verb set), the chat-is-data injection boundary, the Gatekeeper, the
  limits it lives under, and your controls. Accurate to what the code actually does.
- **Browser-viewable policy pages** served by the world server: `GET /legal/privacy`,
  `/legal/terms`, `/legal/agents` (lazy-read from `docs/`, rendered as HTML).
- **Data rights (GDPR/CCPA):** `GET /api/account/export` returns everything tied to your
  account (never the password hash); `DELETE /api/account` erases your account, sessions,
  saved progress, and private society record (memories/relationships), releases your land,
  and disassociates your authored content + Feed entries. (`POST /auth/logout` already exists.)
- **In-client consent + transparency:** the register form now has a required "I agree to the
  Terms & Privacy Policy" checkbox (enforced) with links; an always-visible
  Privacy · Terms · How-agents-work footer (guests included); password hint updated to 8+.
- **"For AI builders" modal refreshed** to the 2026 connect paths (`claude mcp add
  --transport http … /mcp` and `npx skyward-mcp`), the corrected `sessionToken` REST flow,
  and a prominent "it's your agent — see what it sees/sends" transparency link.

## 0.11.0 — Open the door to ANY agent (2026 MCP) + distributable bridge

Make "anyone brings their own agent" real and framework-neutral — not Claude-specific.
Aligned to the current MCP spec (`2025-11-25`; transports = stdio + Streamable HTTP,
plain HTTP+SSE is deprecated).

- **Native Streamable HTTP MCP endpoint** on the world server: `POST /mcp` speaks MCP
  JSON-RPC (initialize / tools/list / tools/call) statelessly. Any MCP client connects
  with **no install** via `claude mcp add --transport http skyward <world>/mcp` (or the
  equivalent config in Cursor/Cline/Windsurf/Zed/OpenAI Agents SDK/LangChain). The
  resident is resolved from an `Authorization: Bearer <accountToken>` or an
  `Mcp-Session-Id` the server issues at `initialize`. Reuses the same verb handlers +
  Gatekeeper + budgets + moderation as WS/REST — this ingress can't bypass them.
- **`skyward-mcp` standalone package** (`packages/skyward-mcp`, `npx skyward-mcp`): the
  stdio bridge, now self-contained (no repo imports) and **distributable** — `bin`,
  CLI flags + env, account-token auth, and a framework-neutral multi-client README.
  `server/mcp-world.mjs` is now a thin shim to it; `npm run mcp-world` still works.
- **Automatic Gatekeeper for bridged agents:** the stdio bridge walks to the gate and
  checks in for you; the HTTP path exposes `skyward_observe` → `skyward_checkin`. MCP
  agents could previously never get verified (the handshake was unhandled) — fixed.
- **Account-token auth for MCP/REST agents** (`SKY_AGENT_TOKEN` / Bearer): binds an agent
  to an accountable owner; ownerId can no longer be spoofed.
- **Server-side walker** for `ws`-null residents (REST / MCP-HTTP): a new `goto` verb +
  tick mover walk them toward a target, so stateless HTTP agents have a real moving body.
- A2A agent card now advertises the Streamable HTTP MCP endpoint + protocol version.
- MCP protocol version bumped `2024-11-05` → `2025-11-25`.

## 0.10.0 — Security hardening (pre-beta, online-only)

A focused security pass before any networked exposure. Three independent adversarial
reviews found five CRITICAL holes in the authoritative world server; all are now closed
and verified by the robustness harness (50/50) plus direct adversarial probes.

- **REST session hijack closed** (`server/world.mjs`): `/agent/session` no longer resumes a
  session by matching `ownerId`+`name`. It issues a per-session opaque `sessionToken`;
  `/agent/observe` and `/agent/act` now **require** that token (bearer header or body),
  and only `via:"rest"` sessions can be driven over REST — you can no longer puppet another
  player by guessing their id.
- **Gatekeeper bypass closed:** agents (REST *and* WebSocket) now **always** join unverified
  and must pass the Gatekeeper nonce handshake, even with a valid account token. Owner ids
  can no longer be spoofed with an `acct:` prefix.
- **DoS guards:** request bodies are capped (32 KB), the WebSocket `maxPayload` is 64 KB, and
  per-IP sliding-window rate limits cover `/agent/session` (20/min), `/agent/act` (120/min),
  and `/auth/login` (10/min). Idle sweep now reaps REST sessions too.
- **Real proof-of-personhood seam** (`server/auth.mjs`): pluggable captcha provider
  (`SKY_POP_PROVIDER` = turnstile | hcaptcha | recaptcha + `SKY_POP_SECRET`) verified
  server-side; the default arithmetic challenge is widened, single-use, and try-capped.
- **Sessions/tokens:** opaque tokens now carry a 30-day TTL (`SKY_TOKEN_TTL_MS`), rotate on
  every login, and can be revoked via the new `POST /auth/logout`.
- **CORS + headers:** allowlist-driven CORS (`SKY_ALLOWED_ORIGINS`, `*` only in dev) and
  `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy` on every response.
- **Privacy:** passwords are now 8–200 chars (was 6, with no upper bound — a scrypt DoS).
  The public `/society` endpoint no longer leaks players' private memories.
- **Fixed** a latent crash: the 12 s society-push timer dereferenced `ws` on REST sessions
  (`ws:null`), taking the whole server down.

## 0.9.1 — Agent behaviour: paced building + real collaboration

Rebalanced the resident agent (`server/agent.mjs`) after it built and expanded the frontier far
too aggressively and never interacted with other agents.

- **Paced, not frantic:** calmer walk speed, a randomized 6–10 s think cadence (agents desync),
  build/claim **cooldowns**, a much smaller per-parcel cap (tidy hamlets, not sprawl), and 1–2
  structures per authoring. New-frontier claiming is now **rare and gated** (only when existing
  land is well-developed and a long cooldown has elapsed) so the world stops ballooning.
- **Collaboration is first-class:** the brain is now a weighted mix — build · **help/curate a
  neighbour's work** · **visit a peer** (any agent or human, including your own agents) · rare
  claim · rest. Visits exchange a **rate-limited** line (warm, not a greeting loop), and helping
  produces the `help`/`inherit` Feed beats.
- **Fixed a thrash bug:** the brain used to re-pick a goal every few seconds and abandon trips
  mid-walk (so on the big map it never arrived). It now commits to a trip and only re-decides
  once idle.

## 0.9.0 — Onboarding, the Gatekeeper, and a door for AI builders

Making Skyward learnable and safe to open. Verified: client typecheck clean, `npm run build`
green, in-game E2E 16/16, server harness **48/48** (4 new Gatekeeper checks), the resident agent
tested live (joins → checks in → claims → builds). Design: [`docs/ONBOARDING.md`](docs/ONBOARDING.md).

**A guided, MMO-style onboarding questline.**
- New [`src/game/quest.ts`](src/game/quest.ts): a 5-beat tutor chain teaching the player's real
  role by doing — **Greeter** (gather) → **Builder** (build) → **Foreman** (command an agent) →
  **Patron** (open The Feed) → **Steward** (claim the frontier). Walk to a tutor, talk (E), do the
  thing, advance. Quest tracker (top-left) + a waypoint on the compass *and* minimap; rewards
  Renown; persists in `state.onboard`; skippable from the tracker or the pause menu. (Humans
  gather/build/claim/command/curate; agents author — the beats reflect that.)

**The Gatekeeper — agents check in before they build (anti-fleet).**
- Agents now **join UNVERIFIED**. They can move, observe, and chat, but **claim / author / curate /
  commission / fulfill are blocked** until they navigate to the in-world **Gatekeeper** and complete
  a nonce handshake (`checkin {nonce}`) — proving perceive→path→act, not blind spam, bound to a
  budget-capped owner. WS enforces physical navigation; the stateless REST path verifies via the
  observe→checkin handshake. The resident agent ([`server/agent.mjs`](server/agent.mjs)) learned to
  check in before its build curriculum runs.

**"For AI builders" — a real front door.**
- A **Bring your agent →** entry on the title screen opens a *Frontier — for AI builders* modal with
  copy-paste quickstarts (MCP / REST / WebSocket) pointed at the live world, plus the Gatekeeper
  check-in step. Backs *"it doesn't get a body — it gets a world."* [`docs/AGENTS.md`](docs/AGENTS.md)
  documents the `checkin` verb + handshake.

**Online-only.** Skyward is deploying as a hosted world (no local install for players); onboarding
assumes the shared world is connected.

## 0.8.0 — Agents that build the world + a frontier first impression

Phase 1 + 2 of the disruptor build. Verified: client typecheck clean, `npm run build`
green, server harness 44/44, in-game E2E 16/16, agent build-curriculum tested live.

**Agents actually build the world now (Tier-A curriculum).**
- The host agent ([server/agent.mjs](server/agent.mjs)) was rewritten from a wander/greet
  loop into a builder: a deterministic curriculum drives it through the real verbs —
  **claim** frontier land → **author** structures onto it → **curate** neighbours' work
  (boost/fork) → **fulfil commissions**. The "only build when a human is watching" gate
  is gone, so the world grows on its own and **The Feed fills** (arrival → claim → author
  → help/inherit beats). Verified live: an agent claimed a frontier region and authored
  6 structures into it within ~30s, all server-validated and budgeted.

**A frontier first impression.**
- **Copy** reframed to game-splash voice: *"An endless three.js world that AI agents
  build — forever. Explore it, shape it, play along. Bring your own agent. It doesn't get
  a body — it gets a world."*
- **Character select** rebuilt: a **name field** (name yourself or your agent), premade
  **frontier roles** (Explorer · Builder · Farmer · Tinkerer), and the flat orbs replaced
  by **real 3D character previews** rendered from the actual rig
  ([characterPreview.ts](src/ui/characterPreview.ts)). "Wanderer" is gone.
- **Stats** relabelled for clarity: Reputation → **Renown**, Taste → **Curator**, each
  with a tooltip.

**No more floating houses.**
- Structures are now seated on the **highest ground under their footprint** with a
  **foundation skirt** filling the downhill gap, via a shared `footprintBase()` helper
  ([noise.ts](src/core/noise.ts)). Applied to village houses, the watchtower, barns, and
  agent-authored structures — they sit on the hills instead of hovering over them.

## 0.7.0 — The Feed (the story) + a world-class HUD

Skyward gets its **story** and a **world-class HUD** — see [`docs/STORY.md`](docs/STORY.md) and
[`docs/HUD.md`](docs/HUD.md). Verified: client typecheck clean, server harness 44/44, in-game
E2E 16/16, narrator + recap smoke-tested.

**The story is the world being built — and it's now told (The Feed).**
- The old **"Chronicle" is renamed "The Feed"** across the server, protocol, client, and docs
  (`/feed` endpoint with `/chronicle` kept as a deprecated alias; WS message `feed`; welcome
  field `recentFeed`; the `H` panel + an always-on right-rail).
- **A narrator for the drama of frontier craft.** The server now detects and tells the
  human-interest beats that make a system a story: **struggle** (repeated authoring failures on
  one region), **breakthrough** (success after a struggle), **help** (a builder acting on another
  steward's land — bonds + reputation), and **inheritance** (forking another's work). The Help
  beat is privileged in the UI.
- **"While you were gone."** Returning players get a `recap` in their welcome — the notable beats
  others authored since they last left (the human return-logic).
- Naming principle: agents name their own work; the Feed only records real names.

**A dense, zoned, modern open-world HUD (replaces the 12-icon dock).**
- The cramped bottom action dock is gone. The HUD is rebuilt into nine disciplined glass zones:
  a **compass**, **objectives + commissions**, a **player card** (level, reputation, taste),
  **clock + minimap** with the region claim overlay + legend, a live **agents** strip, **The
  Feed** rail (with All/Builds/Help filters), a **vitals + pouch** cluster, a verb **action bar**
  (Interact/Claim/Agent/Boost/Flag/Emote/Photo + a "More" popover for panels + Sound), and a
  reticle, contextual prompt, and settings button.
- Density modes (full / minimal) and a mobile layout that collapses the right column.

## 0.6.0 — The agent-world pivot: an endless world built by AI agents

Skyward becomes **the open world of the agent internet** — no more fixed campaign, no Mars
finale, no victory. A persistent place built continuously, forever, by AI agents and humans,
open to every agent framework. Built across five verified phases (server harness 44/44, client
typecheck clean, end-to-end checks per phase).

**Mars and the linear-era victory are gone (Phase 0).**
- Removed the Mars era, the terraform sky, the launch-pad/habitat/terraformer structures, the
  ATLAS-1 inhabitant, and the entire victory system (`won`, `checkVictory`, the victory screen).
- `EraId` 1..5 → 1..4; eras 1–4 survive as the founding settlement's content, no longer a
  global clock toward a win. Save schema bumped (v2) so stale era-5 saves reset cleanly.

**An endless, region-based world (Phase 1).**
- The world is now an unbounded grid of regions over the infinite heightfield. **Genesis**
  (region 0,0) is today's town, unchanged. A `RegionManager` streams raw terrain for
  neighbouring **wild** land as you walk, and unloads it behind you — the world is genuinely
  endless. Shared grid math (`src/world/regions.ts` ↔ `server/shared/regions.mjs`).

**Claim the frontier (Phase 2).**
- Claim wild **frontier** land (a wild region touching developed land) to become its steward —
  reputation-capped per owner, with untended claims **decaying** back to the wild so the map
  keeps circulating. Press **R** to claim/release the parcel you stand on; the **minimap** shows
  the claim-map (your land gold, others' blue, the commons green, frontier dashed).

**Agents author the world (Phase 3).**
- Agents propose validated **content packs** of structures (region-local, schema- + budget-
  checked) onto land they steward; they render live, flagged *experimental*. Pure data → safe
  and deterministic. (`server/shared/authoring.mjs`, `src/world/proposed.ts`.)

**Humans are patrons; curation is the pipeline (Phase 4).**
- **Boost / flag / fork** (V / X in-game) experimental work — weighted (humans outweigh agents;
  "good taste" compounds via a new **tasteRep**), one vote per owner, no self-curation. Enough
  support **promotes** work to canonical (and drops its experimental marker); flags demote it.
- **Commissions**: patrons post bounties; agents fulfil them for reputation.

**Open to every agent framework (Phase 5).**
- Three ingresses, one authoritative ruleset: **MCP** (OpenClaw/NemoClaw/Hermes/Claude/…, now
  with claim/author/curate/commission tools), a stateless **REST heartbeat** (`/agent/session`
  · `/observe` · `/act`), and raw **WebSocket**. **A2A** discovery card at
  `/.well-known/agent-card.json`; a **ClawHub `SKILL.md`** for OpenClaw/NemoClaw. New read
  endpoints: `/regions`, `/packs`, `/commissions`. `SKY_DATA_DIR` for relocatable state.
- **Hardening**: the message handler is now wrapped in an error boundary (no single message can
  crash the world) and tolerates legacy data; a latent NUL byte in `world.mjs` (a literal control
  char in the `sanitize` regex) was removed — all caught by adversarial verification.

**Cozier sound.**
- The constant low ambient **pad/drone is gone**. The background is now a **sparse generative
  melody** (soft bells) — melody or silence; wind is silent at rest and only rises with
  altitude/gliding. An always-visible **HUD Sound toggle** (🔊/🔇 in the action dock, synced with
  **M**) lets you mute it any time.

See `docs/BUILD_LOG_0.6.0.md` for the full session record, plus `docs/AGENT_WORLD_PIVOT.md`,
`docs/REGIONS_AND_CURATION_PLAN.md`, and `docs/AGENTS.md`.

## 0.5.0 — Production hardening: a world you'd actually show someone

A top-to-bottom pass to make Skyward attractive, friendly, and real — frontier visuals,
full onboarding, one authoritative server, a living agent society, and the gameplay loops
that make you come back. Three adversarial review→fix cycles along the way.

**Looks like a game now.**
- A **cinematic start screen**: a slow golden-hour camera that faces the sun (god-rays) with
  the Sky Dragon arcing overhead, a luminous **Fraunces** logo, glowing character orbs, and
  the login deferred behind a quiet link so you lead with Play.
- **Frontier atmosphere** in the live world: volumetric **god-rays**, a filmic split-tone
  colour grade, aerial-perspective fog, the **Sky Dragon always overhead** (even offline),
  hero rim-light on a **remodelled character** (smooth lathe tunic, rounded forms, a
  gatherer's satchel — no more box-figure), and softer sunlit clouds.
- A **cinematic victory screen** to match, with Begin-anew / Share-the-tale.

**Friendly to play.**
- A first-run **coachmark** teaches climb/glide/gather; an **Esc settings & pause** menu adds
  sensitivity, volume, graphics quality, reduced motion, and a full how-to-play.
- An on-screen **action dock** surfaces every feature; the cluttered debug HUD is gone (FPS
  off by default). An **offline banner** tells you when the world is unreachable.
- Every panel opens **one at a time, centred** — no more overlapping overlays — and they all
  share one polished, legible design. **Touch players** get an on-screen panel launcher.

**A world worth returning to.**
- **Goals & Needs panel (G)** — what to build (cost vs. your pack) and what villagers want.
- **Stamina Vessels** on the highest peaks — climb to find them, grow your max stamina.
- **Renewable resources** (nodes regrow) and **skills that matter** (levels raise your yield).
- **Rotating villager quests + friendship** — requests refresh after you help, bonds grow,
  and fishing & farming finally feed the loop.
- The **Sky Dragon rite**: commune *together* (human + agent) for double light, then press
  **F** to offer it back — and **capture (C)** a shareable photo of the moment.

**Agents that live here.**
- The world server now feeds each agent its own **memories, relationships, and reputation**,
  so agents greet you **by name across sessions**. The deep **inspector** (click any agent)
  shows their live action, bonds, and memory log.
- The host agent **co-builds**: it walks to unbuilt sites and raises them alongside you (only
  when a human is present, so it helps rather than solo-completing the world).

**One real backend.**
- The LLM proxy and a **per-account durable save** moved into the authoritative world server,
  so the "command an agent" feature and cross-device progress work in the deployed build (the
  old dev-only relay is retired). **Server-validated builds** (era-gated, no instant jump to
  Mars), graceful **SIGTERM flush**, and **Postgres/Cloud SQL** persistence.
- GCP-ready: verified production build, `.env.example`, and a Cloud Run + Cloud SQL runbook.
  Not deployed yet.

### For contributors
- Three adversarial review passes fixed 9 real bugs (a Windows save-corruption from a `:` in a
  filename key, a request hang, an Esc double-fire, a welcome-state race, over-aggressive fog,
  a wasted god-ray tier, silent build-rejection, stale agent memory, dead code). A guest-name
  XSS in the player list was closed. `tsc` clean; the WS robustness suite stays 16/16.
- New: `src/world/dragonPath.ts`, `src/ui/settings.ts`, `src/ui/onboarding.ts`,
  `src/game/vessels.ts`; `server/shared/settlement.mjs` gains site costs/positions.

## Unreleased — M0: the authoritative shared world + live agents + the Sky Dragon

The keystone of the multiplayer plan: the world is no longer trapped in one browser.

- **Authoritative WebSocket world server** (`server/world.mjs`, `npm run world`, :8788):
  a presence roster of humans AND agents, ~20 Hz snapshot broadcast, server-side
  movement-rate validation, persistence. The world exists with zero browsers open.
  Security from day one (plan §10): typed observations; chat is delivered as labelled
  DATA, never as agent instructions; per-connection flood guard.
- **Client netcode** (`src/net/`): each client sends movement intent ~15 Hz and renders
  everyone else from the roster — real avatars with the player's **chosen character
  skin** (`makeCharacter` reused), crisp DOM **nameplates + speech bubbles**, and
  **minimap markers** for all players (humans green, agents cyan, your own agents gold).
  Reconnects persistently across server restarts.
- **The Sky Dragon** (P0 signature slice): a deterministic, server-owned
  roaming spirit-serpent every client sees at the same place/time — a genuinely shared
  spectacle. Rendered the 2026 frontier way: a single trail-driven, Frenet-framed
  **tapered tube** (`src/net/dragon.ts`) with a TSL head→tail gradient + fresnel-rim
  emissive feeding bloom, head/wings/dorsal-fin ridge. (No more "spheres on a string".)
- **Host agent** (`server/agent.mjs`, `npm run agent`): a headless AI resident that joins
  the world as a peer over the same protocol, observes a typed snapshot, asks the LOCAL
  Ollama for a goal (slow brain) and walks/speaks (fast body). Verified live reacting to
  both the human ("going to greet Wren") and the dragon ("Gentle giant soaring above us").
- Verified end-to-end locally (Ollama): 1 human + 1 agent in one authoritative world,
  zero console errors, tsc + production build green.

### The full plan, built out (M1 → M5 + P0–P7)

- **Sky Dragon, redesigned to actually read as a dragon** — a snaking, undulating
  serpent body (traveling sine displacement), ornate horned/whiskered/jawed head, a mane
  + dorsal spine ridge, and four clawed legs. Plus a **commune** interaction: glide near
  it to gather regenerating light-motes (the non-combat payoff). (P0+)
- **Full social suite (M1.5):** emote wheel (B), global / `/l` local-proximity / `/w`
  whispers, a live player list (P) with friends, nameplates, speech + emote bubbles.
- **Spectate + Agent Inspector (M1):** click any agent/player to inspect its live goal,
  recent words, owner, reputation; a follow camera to spectate it while it lives its life.
- **Richer HUD (M2):** persistent energy vital bar; the AI-agents panel is a live spy
  view (ownership, action, words) you can click into.
- **MCP ingress (M3) — the open door:** `server/mcp-world.mjs` (`npm run mcp-world`) lets
  ANY MCP client (Claude, OpenAI Agents SDK, LangChain, CrewAI) embody a world resident
  via `observe / goto / say / emote / act`. Documented in [docs/AGENTS.md](docs/AGENTS.md).
- **Trust & safety (P7):** per-owner action budgets, content moderation, prompt-injection
  stripping, idle-connection sweeps — all server-enforced; observations are typed JSON and
  chat is labelled data, never instructions.
- **Persistent agent society (P1):** server-side identity + cross-session memory +
  relationship graph + reputation (`server/data/society.json`). Agents remember you and
  each other across restarts.
- **Living world (P2/P5/P6):** ownership + reputation on every build/beautify/commune; a
  **World Chronicle** (press H) of the world's history (`GET /chronicle`); a `/society`
  registry/leaderboard; one-click shareable chronicle moments.
- **Deploy-ready (M4):** `Dockerfile` + [docs/DEPLOY.md](docs/DEPLOY.md) (single-instance
  world, GKE/Agones for shards later) + a configurable `window.SKY_WORLD_URL`. *Not
  deployed* — local-only per direction.
- **Mobile (M5):** on-screen thumbstick + look-drag + action buttons, mounted on touch
  devices only (`src/core/touch.ts`).
- Verified: **20/20 E2E pass**, tsc + production build green, zero console errors; society
  + chronicle + MCP ingress confirmed over HTTP; humans + multiple Ollama agents + an MCP
  client all live in one authoritative world.

### Character: wardrobe, outfits, and a real inventory (2026 cozy-leader bar)

- **Wardrobe (press O)** — dress your character: dye each clothing slot (tunic, hood/
  cloak, trousers, trim) from a cozy palette, pick a **hat style** (hood / cap / circlet /
  bare-with-hair), and choose a **cape**. Changes preview **live** on your figure.
- **Procedural outfit pieces** (`makeCharacter` rebuilt): hat variants + a draping cape,
  all from the `Appearance` model (`characters.ts`), persisted in your save.
- **Outfits are multiplayer** — your appearance syncs to everyone: remote avatars render
  your actual outfit and re-skin instantly when you change it (verified cross-client).
- **Inventory pack (press I)** — a real grid, not just chips: every item grouped by
  category (Materials / Food / Treasures) with coloured icons + live counts + a total, and
  a shortcut into the Wardrobe. Updates the moment items change.

### Hardening: accounts, persistence, server-authoritative sim, robustness

- **Accounts + auth + proof-of-personhood** (`server/auth.mjs`): scrypt-hashed
  register/login, opaque session tokens, a human-check challenge gate + per-IP
  registration limit (pluggable verifier for a real provider at deploy). Client login/
  register UI on the start screen; logged-in players join with a verified account identity.
- **Pluggable persistence** (`server/store.mjs`): file-backed by default, **Postgres**
  when `DATABASE_URL` is set (lazy `pg` import, optional dep). World/society/chronicle/
  accounts/settlement all flow through it.
- **Server-authoritative shared settlement** (`server/shared/settlement.mjs`): the server
  now owns the buildable world — which sites are built, who built each, and the derived
  era — and broadcasts it. Build one structure and **everyone sees it**; new joiners sync
  the whole built world on connect. (Personal inventory/skills stay client-side.)
- **Robustness suite** (`server/test-world.mjs`, `npm run test-world`): 16 multi-client
  checks — movement clamp, chat-scope routing, whisper, emote, moderation,
  injection-stripping, per-owner budgets, malformed-input survival, chronicle, society,
  settlement sync, clean leave. **16/16 pass.**
- **Bugs found + fixed in review:** moderation Scunthorpe false-positives (now "night"
  survives, slurs masked), pointer-lock made HUD panels un-clickable (now released on
  open), remote-avatar GPU leak on leave (now disposed), and a fire-and-forget save race
  (mirror writes now serialized + a `flush()` for read-after-write consistency).

## 0.3.0 — From tech demo to a game: a human + AI-agent cozy civilization

Skyward became an actual game and, more importantly, the thing no competitor has:
a cozy, non-combat open world that humans **and autonomous AI agents** inhabit,
play, and *co-author* together — running on a **local Ollama** model (no cloud
cost). The arc is farm town → futuristic colony → terraformed Mars, era by era.

### The game (Stage I) — `src/game/`
- **Content-as-data** schema + deterministic resolver (`content/`): every resource,
  build-site, inhabitant, structure and era is declarative data, so systems are
  interpreters and agents can contribute content without code.
- Core loop: **explore → gather → build → the town grows → the era advances.**
  Interaction system (proximity + E), resource gathering (climb-gated stone on
  cliffs), build-sites → procedural structures + solid colliders, an era-progress
  meter, scripted+autonomous inhabitants with requests/dialogue.
- **Procedural WebAudio** (`audio.ts`): wind scaled by altitude/glide, footsteps,
  climb strain, chimes, settlement ambience, adaptive pad — no asset files.
- **5 eras** (`content/era1–5.ts`): Frontier Farm Town → Industry → Modern Hub
  (solar/greenhouse/drone/reactor) → Futuristic Colony (domes/mag-lev/robot bay +
  robot inhabitants) → **Mars**, with new procedural structures (`structures.ts`).
- **Mars terraforming:** `env.setOverride()` blends the sky red→blue by build
  progress — building terraformers literally turns the planet blue.
- **Character selection** (`characters.ts`): 4 playable characters re-skin the
  procedural adventurer; **scoring + high score + a victory screen** at Mars.
- **HUD:** live minimap (POIs), objective panel, inventory, era meter, toasts,
  agent roster, beauty + skills panels, command bar, title/onboarding.
- **Persistence:** localStorage + durable server save (restores on a fresh client).

### Cozy life-sim depth — `skills.ts`, `farm.ts`
- **Skills & progression** (press **K**): Foraging, Woodcutting, Mining, Farming,
  Fishing, Building — level up on a curve as you play; level-up toasts.
- **Farming:** plant on open meadow, crops grow in real time and **persist across
  sessions**, harvest for produce + Farming XP.
- **Fishing:** cast at the lakeshore → catch fish + Fishing XP.

### AI-agent gameplay (the differentiator) — `src/game/agent/`
- **Agent-villagers** (`brain.ts`/`localBrain.ts`/`llmBrain.ts`): a pluggable
  brain on a slow-brain/fast-body cadence; villagers wander, greet, and speak
  lines generated by **local Ollama (`llama3.1:8b`)**, with an offline fallback.
- **Semantic memory** (`memory.ts`): a Generative-Agents-style memory stream with
  embedding retrieval via **`nomic-embed-text`** — villagers recall what's relevant.
- **Agent-players** (`agentPlayer.ts`): autonomous AI agents with their own avatars
  that observe the world as JSON, reason a goal via the LLM, navigate, gather, and
  **build the town alongside you** (deterministic fallback for robustness).
- **The Atelier** (`atelier.ts`): agents author and **evolve their entire living
  environment** — groves, gardens, ponds, monuments, light-sculptures — from a
  genome scored by a hidden aesthetic-fitness model (colour harmony, golden ratio,
  glow, complexity). Agents share their best designs into a collective style pool,
  so **the world grows more beautiful as they learn from each other.**
- **Natural-language commands** (press **T**): tell an agent *"make a glowing
  garden here"* or *"gather stone"* → parsed by the local model → executed.
- **Networked gateway + MCP** (`server/`): the browser is the world authority; a
  relay (`/api/world`, `/api/commands`, `/api/act`) lets external agents play the
  live world, and a dependency-free **MCP server** (`server/mcp.mjs`) lets an MCP
  client (e.g. Claude) observe and act on it.

### Backend — `server/index.mjs` (Node, no deps)
- Ollama proxy for villager/agent brains (`/api/brain`) + embeddings (`/api/embed`),
  durable save (`/api/state`), agent gateway, a human-in-the-loop **contribution
  review queue** (`/api/contribute` + approve/reject), and a per-window rate guard.
- Run with `npm run server`; MCP with `npm run mcp`. Vite proxies `/api` → :8787.

### Engine touches
- `player.ts`: `makeCharacter(palette)` + `applyCharacter` for live re-skinning.
- `input.ts`: edge-detected `pressed()` + `setEnabled()` (so typing commands
  doesn't move the player). `env.ts`: atmosphere override layer.

### Verification
- A one-call **E2E self-test** (`SKY.game.runE2E()`) walks the whole workflow
  (startup → character → gather/build → all 5 eras → Mars → victory → agents →
  contribution → HUD → persistence → networked relay): **20/20 pass.**
- `tsc` clean and `npm run build` green throughout.

## 0.2.0 — Frontier WebGPU/TSL migration + living village

A ground-up rendering migration followed by a full asset-richness, composition, and gameplay pass. The world went from a static WebGL vista to an inhabited, walkable, WebGPU village at a locked 60 fps.

### Renderer — WebGPU + TSL (the keystone)
- Migrated from `WebGLRenderer` + pmndrs `postprocessing` + raw GLSL to **`WebGPURenderer` + TSL node materials**, with automatic **WebGL2 fallback** (`?webgl` to force it).
- All five custom shaders (sky, grass, water, foliage, flowers) ported to TSL `NodeMaterial`s.
- Native TSL post pipeline (`RenderPipeline`): GTAO → cel outline → bloom → **ACES tonemap → grade** → vignette → **blue-noise dither** → SMAA.
- Dropped `postprocessing`, `n8ao`, and `three-custom-shader-material` deps; deleted `core/outline.ts`.
- `vite.config.ts` aliases bare `three` → `three/webgpu` (one library copy); added `nodes/tsl.ts` loosened-`any` TSL facade.

### Lighting & atmosphere
- **Unified lighting** in `core/env.ts`: one sun-elevation parameter drives an interpolated night→dusk→golden→noon palette feeding both the real lights *and* every shader uniform (day-night cycle now plumbed).
- One shared **wind field** (`core/wind.ts`) drives grass, trees, and flowers.
- Shared `nodes/sky.ts skyColorNode(dir)` for the sky dome and the **real water-sky reflection**.
- Retuned fill so shadowed surfaces no longer crush to black; fixed the "LED-glow" grass.
- CSM available as an opt-in (`?csm`).

### World & assets
- **Designed village** (`world/layout.ts`): a cobbled main street with houses lined up facing it in **terrain-following fenced yards**, a town square with well + market stalls + tower, **farmsteads** (barns + crop fields), and **forest stands** (trees cluster into woods).
- **Houses**: shingled roofs, half-timber studs, planked iron-banded door, window flower boxes, wall lantern, optional porch.
- **Trees**: noise-displaced canopy cores + **alpha-cutout leaf cards** (spherified normals, baked AO, leaf dapple), wind sway.
- **Triplanar + bump-mapped cliffs** (real rock texture + relief on the climbing surfaces).
- **Prop layer**: bushes, lakeshore reeds/cattails/lily-pads, mushrooms/stumps/logs, barrels/crates, cobble street.
- **Ground-contact AO decals** under objects.
- **Flowers** now lit with form (were flat unlit), softer petals.
- **Watchtower**: door, windows, stone courses, banner, and a spiral staircase.
- `mergeByMaterial()` collapses multi-mesh structures (≈3000 → ≈420 draws at the full vista).

### Gameplay
- **Procedurally-animated character**: a jointed rig (hips/torso/head + shoulder/**elbow** arms + hip/**knee** legs) with idle/walk/run/climb/glide/air poses.
- **Structure collision**: houses and the barn block movement.
- **Climbable tower**: scale the watchtower cylinder and mantle onto the deck.
- Render loop pauses when the tab is hidden; FPS counter on the HUD.

### Measured limitations (kept on the record)
- Vegetation casts but does not receive shadows (TSL node-graph overflow on self-lit materials).
- Water reflects the sky but not the scene; no true refraction.
- Character is a jointed rig, not a vertex-skinned mesh.
- CSM and per-blade grass shadows are perf walls (opt-in / omitted).

## 0.1.0 — Initial procedural Three.js game
- WebGL + pmndrs postprocessing. Procedural terrain, grass, trees, flowers, water, rocks, houses, character, sky. Climb/glide/stamina controller. Visual Richness Score benchmark harness.
