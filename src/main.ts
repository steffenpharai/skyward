import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { Input } from "./core/input";
import { Clock } from "./core/clock";
import { env } from "./core/env";
import { buildTerrain } from "./world/terrain";
import { buildSky } from "./world/sky";
import { buildWater } from "./world/water";
import { buildScatter } from "./world/scatter";
import { buildProps } from "./world/props";
import { buildGrass } from "./world/grass";
import { buildFlowers } from "./world/flowers";
import { buildTrees } from "./world/trees";
import { RegionManager, regionCenter, regionCoordsAt, regionId, neighbors, REGION_SIZE, GENESIS_ID } from "./world/regions";
import { ProposedContent } from "./world/proposed";
import { OrbitCamera } from "./player/camera";
import { Player } from "./player/player";
import { buildComposer } from "./core/post";
import { Game } from "./game/game";
import { Store } from "./game/state";
import { CHARACTERS } from "./game/characters";
import { NetClient } from "./net/net";
import { Remotes, EMOTES } from "./net/remotes";
import { initTouch } from "./core/touch";
import { initWardrobe } from "./ui/wardrobe";
import { initInventory } from "./ui/inventory";
import { initWorkshop, initBrainConsole, type Panel } from "./ui/skywardPanels";
import { startTelemetry } from "./net/telemetry";
import { dragonAtClient } from "./world/dragonPath";
import { settings } from "./ui/settings";
import { UXLayer } from "./ui/onboarding";
import { CharacterPreviews } from "./ui/characterPreview";

const canvas = document.getElementById("app") as HTMLCanvasElement;

// WebGPU renderer with automatic WebGL2 fallback (older browsers / Firefox-Linux).
// `?webgl` forces the WebGL2 backend for cross-backend QA.
const forceWebGL = new URLSearchParams(location.search).has("webgl");
const renderer = new WebGPURenderer({ canvas, antialias: true, forceWebGL });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1500);
camera.position.set(0, 20, 20);

// --- World ---
const terrain = buildTerrain();
scene.add(terrain.mesh);
const sky = buildSky(scene, camera);
const water = buildWater(scene);
const scatter = buildScatter(scene);
const barnColliders = buildProps(scene);
const trees = buildTrees(scene);
const grass = buildGrass(scene);
const flowers = buildFlowers(scene);
// Endless world: stream raw terrain for the regions around the player. Genesis
// (region 0,0) is the full build above; neighbours are wild land on the same
// heightfield, claimable + buildable from Phase 2 on.
const regionMgr = new RegionManager(scene);
// Renders agent-authored content packs (Phase 3) into their regions, flagged
// experimental until curated. Fed from the world server's per-region packs.
const proposed = new ProposedContent(scene);

// --- Player + camera rig ---
const input = new Input(canvas);
// Mobile mode is a CAPABILITY decision (touch + no hover), made ONCE at load — never a
// width breakpoint, so a narrow desktop window stays desktop. `?ui=touch` / `?ui=desktop`
// forces it (manual override + local test lever). Set body.mobile here so the mobile CSS
// applies before first paint (no desktop-HUD flash); the touch DOM mounts after boot.
const _uiOverride = new URLSearchParams(location.search).get("ui");
const isMobileUI = _uiOverride === "touch" ? true : _uiOverride === "desktop" ? false
  : (matchMedia("(pointer: coarse)").matches && matchMedia("(hover: none)").matches);
document.body.classList.toggle("mobile", isMobileUI);
const orbit = new OrbitCamera(camera, input);
// Shared, mutable collider list — built structures push onto this so the player
// (which holds the same array reference) treats new walls as solid.
const colliders = [...scatter.structures, ...barnColliders];
const player = new Player(input, orbit, colliders);
scene.add(player.group);
orbit.yaw = Math.PI;

// --- Gameplay layer (interaction, resources, build, eras) ---
// Created in boot() AFTER seeding the durable save from the server (Stage III).
let game: Game | undefined;

// --- Multiplayer: authoritative world server (M0). Degrades silently if absent. ---
const netEnabled = !new URLSearchParams(location.search).has("noworld");
// World-server URL. Override with window.SKY_WORLD_URL. Otherwise: in the Vite dev
// server (:5173) the world runs separately on :8788; everywhere else (the single-service
// deploy — the world server serves this client) connect SAME-ORIGIN (no :8788), so it
// works on Cloud Run (wss:// on 443) and any host without per-deploy config.
const wsProto = location.protocol === "https:" ? "wss" : "ws";
const WORLD_URL = (window as any).SKY_WORLD_URL
  || (location.port === "5173" ? `ws://${location.hostname}:8788` : `${wsProto}://${location.host}`);
const net = new NetClient(WORLD_URL);
const remotes = new Remotes(scene, camera);
let netSend = 0;
let wardrobe: ReturnType<typeof initWardrobe> | undefined;
let inventory: ReturnType<typeof initInventory> | undefined;
let workshop: Panel | undefined;       // builder game-context + contribute
let brainConsole: Panel | undefined;   // owner-only gameplay-AI console

const sun = sky.sun;

// --- HUD ---
const stateEl = document.getElementById("state")!;
const fpsEl = document.getElementById("fps")!;
const stamWrap = document.getElementById("stamina-wrap")!;
const stamBar = document.getElementById("stamina") as HTMLDivElement;
const reticleEl = document.getElementById("reticle")!;
let hudExtraT = 0;   // throttle for the compass/clock refresh
const overlay = document.getElementById("overlay")!;
const hudEl = document.getElementById("hud")!;
hudEl.style.visibility = "hidden";   // keep the playfield HUD off the cinematic title screen

let fpsFrames = 0, fpsTime = 0;
let teleFps = 60, teleJank = 0;   // gameplay-telemetry rolling frame-feel (sampled, no PII)

// Character select cards on the start screen — picking one begins the game.
const hex6 = (c: number) => "#" + c.toString(16).padStart(6, "0");
const charsel = document.getElementById("charselect")!;
const charNameInput = document.getElementById("charname") as HTMLInputElement | null;
// 3D mini-previews of the real character rig in each card (replaces the flat orbs).
const previews = new CharacterPreviews();
for (const c of CHARACTERS) {
  const el = document.createElement("div");
  el.className = "char";
  el.dataset.char = c.id;
  el.innerHTML = `<canvas class="figc" width="128" height="148" style="width:96px;height:111px;display:block;margin:2px auto 12px;border-radius:14px;background:radial-gradient(circle at 38% 30%, ${hex6(c.tunic)}3a, ${hex6(c.hood)}22 70%, transparent)"></canvas><div class="nm">${c.name}</div><div class="bl">${c.blurb}</div>`;
  el.addEventListener("click", () => startGame(c.id, charNameInput?.value.trim() || ""));
  charsel.appendChild(el);
  previews.add(c.id, c, el.querySelector("canvas.figc") as HTMLCanvasElement);
}
// --- Accounts: optional login/register on the start screen (M5 / anti-bot) ---
const AUTH_BASE = WORLD_URL.replace(/^ws/, "http");
let authToken = localStorage.getItem("skyward.token") || "";
let authDisplay = localStorage.getItem("skyward.display") || "";
// Tell the durable-save + brain layers where the authoritative server is and who we
// are. Set before boot() so a returning signed-in player restores from the server.
(window as any).SKY_API = AUTH_BASE;
(window as any).SKY_TOKEN = authToken;
let challenge: { id: string; question: string } | null = null;
const httpUrl = AUTH_BASE, wsUrl = WORLD_URL;
const esc = (s: string) => s.replace(/[<>&"]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[m]!));

// --- Sign in with Google (GIS button → ID token → POST /auth/google) --------------
let googleClientId = "";
let gisLoaded = false, gisInited = false;
const googleNonce = (self.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36));
function loadGsi(): Promise<void> {
  if (gisLoaded || (window as any).google?.accounts?.id) { gisLoaded = true; return Promise.resolve(); }
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.defer = true;
    s.onload = () => { gisLoaded = true; resolve(); };
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}
function mountGoogleButton() {
  const host = authCard.querySelector("#gbtn") as HTMLElement | null;
  const g = (window as any).google;
  if (!host || !googleClientId || !g?.accounts?.id) return;
  try {
    if (!gisInited) { g.accounts.id.initialize({ client_id: googleClientId, callback: onGoogleCred, nonce: googleNonce, use_fedcm_for_button: true }); gisInited = true; }
    g.accounts.id.renderButton(host, { theme: "outline", size: "large", text: "continue_with", shape: "pill", width: 300 });
  } catch {}
}
function onGoogleCred(resp: any) { if (resp?.credential) postGoogle(resp.credential); }
async function postGoogle(credential: string, handle?: string) {
  try {
    const r = await fetch(`${AUTH_BASE}/auth/google`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential, nonce: googleNonce, handle }) });
    const d = await r.json();
    if (d.token) { applyAuth(d.token, d.display); return; }
    if (d.needHandle) { renderHandle(credential, d.suggested || "", d.error); return; }
    renderHandle(credential, "", d.error || "Google sign-in failed.");
  } catch { renderHandle(credential, "", "Can't reach the world server."); }
}

// --- session helpers ---
function applyAuth(token: string, display: string) {
  authToken = token; authDisplay = display; (window as any).SKY_TOKEN = token;
  localStorage.setItem("skyward.token", token); localStorage.setItem("skyward.display", display);
  closeAuth(); renderActions();
}
function signOut() {
  authToken = ""; authDisplay = ""; (window as any).SKY_TOKEN = "";
  localStorage.removeItem("skyward.token"); localStorage.removeItem("skyward.display"); renderActions();
}
async function fetchChallenge() { try { challenge = await (await fetch(`${AUTH_BASE}/auth/challenge`)).json(); } catch { challenge = null; } }

// --- the slim start-screen action bar (lives in #authrow) ---
const authrow = document.getElementById("authrow")!;
const legal = `<a href="${httpUrl}/legal/privacy" target="_blank">Privacy</a> · <a href="${httpUrl}/legal/terms" target="_blank">Terms</a> · <a href="${httpUrl}/legal/agents" target="_blank">How agents work</a>`;
function renderActions() {
  if (!netEnabled) { authrow.innerHTML = ""; return; }
  if (authToken && authDisplay) {
    authrow.innerHTML =
      `<div class="startactions"><button class="spill agent" id="devbtn"><span class="ic">&lt;/&gt;</span> For developers</button></div>
       <div class="startfoot"><span class="signed">✦ ${esc(authDisplay)}</span> · <span id="signout" style="cursor:pointer;color:#b9c6d6">Sign out</span> · ${legal}</div>`;
    authrow.querySelector("#signout")!.addEventListener("click", signOut);
  } else {
    authrow.innerHTML =
      `<div class="startactions"><button class="spill primary" id="signinbtn"><span class="ic">✦</span> Sign in</button><button class="spill agent" id="devbtn"><span class="ic">&lt;/&gt;</span> For developers</button></div>
       <div class="startfoot">Or just pick a character to play as a guest · ${legal}</div>`;
    authrow.querySelector("#signinbtn")!.addEventListener("click", openAuth);
  }
  authrow.querySelector("#devbtn")!.addEventListener("click", openDev);
}

// --- sign-in modal ---
const authModal = document.createElement("div"); authModal.className = "skmodal";
const authCard = document.createElement("div"); authCard.className = "skcard"; authCard.id = "authcard";
authModal.appendChild(authCard); document.body.appendChild(authModal);
authModal.addEventListener("click", (e) => { if (e.target === authModal) closeAuth(); });
function openAuth() { renderSignIn(); authModal.classList.add("show"); loadGsi().then(() => mountGoogleButton()); }
function closeAuth() { authModal.classList.remove("show"); }
function renderSignIn() {
  authCard.innerHTML =
    `<div class="skclose" id="ax">×</div>
     <h2>Enter Skyward</h2>
     <div class="sub">Sign in to keep your progress, name, and creations across devices — or close this and play as a guest.</div>
     ${googleClientId ? `<div id="gbtn" class="ghost-btn"></div><div class="skdiv">or</div>` : ""}
     <div id="uform" ${googleClientId ? `style="display:none"` : ""}>
       <input id="au" class="skin" placeholder="username" autocomplete="username">
       <input id="ap" class="skin" type="password" placeholder="password (8+ characters)" autocomplete="current-password">
       <div style="display:flex;align-items:center;gap:9px;margin:8px 0 2px;font-size:12.5px;color:#aebccd"><span id="aq">${challenge ? challenge.question : "…"}</span><input id="ah" class="skin" style="width:80px;margin:0" placeholder="answer"></div>
       <label style="display:flex;gap:8px;align-items:flex-start;margin:8px 0 2px;font-size:11.5px;color:#aebccd;cursor:pointer"><input id="aconsent" type="checkbox" style="margin-top:2px"><span>I agree to the <a href="${httpUrl}/legal/terms" target="_blank" style="color:#9fe0ff">Terms</a> & <a href="${httpUrl}/legal/privacy" target="_blank" style="color:#9fe0ff">Privacy</a>.</span></label>
       <div style="display:flex;gap:8px;margin-top:8px"><button id="alogin" class="skbtn" style="background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.16);color:#eaf2ff">Sign in</button><button id="areg" class="skbtn">Create account</button></div>
       <div id="aerr" class="skerr"></div>
     </div>
     ${googleClientId ? `<div class="ghost-btn" style="margin-top:4px"><span id="usetoggle" class="skmini">Use a username instead</span></div>` : ""}`;
  authCard.querySelector("#ax")!.addEventListener("click", closeAuth);
  const uform = authCard.querySelector("#uform") as HTMLElement;
  authCard.querySelector("#usetoggle")?.addEventListener("click", (e) => { uform.style.display = "block"; (e.target as HTMLElement).parentElement!.style.display = "none"; });
  const v = (id: string) => (authCard.querySelector(id) as HTMLInputElement)?.value.trim() || "";
  const err = (m: string) => { const e = authCard.querySelector("#aerr") as HTMLElement; if (e) e.textContent = m; };
  authCard.querySelector("#alogin")?.addEventListener("click", async () => {
    try { const r = await fetch(`${AUTH_BASE}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: v("#au"), password: (authCard.querySelector("#ap") as HTMLInputElement).value }) }); const d = await r.json(); if (d.token) applyAuth(d.token, d.display); else err(d.error || "Login failed"); } catch { err("Can't reach the world server."); }
  });
  authCard.querySelector("#areg")?.addEventListener("click", async () => {
    if (!(authCard.querySelector("#aconsent") as HTMLInputElement)?.checked) { err("Please agree to the Terms and Privacy Policy."); return; }
    try { const r = await fetch(`${AUTH_BASE}/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: v("#au"), password: (authCard.querySelector("#ap") as HTMLInputElement).value, challengeId: challenge?.id, answer: v("#ah") }) }); const d = await r.json(); if (d.token) applyAuth(d.token, d.display); else { err(d.error || "Register failed"); fetchChallenge().then(() => { const aq = authCard.querySelector("#aq"); if (aq) aq.textContent = challenge ? challenge.question : "…"; }); } } catch { err("Can't reach the world server."); }
  });
  mountGoogleButton();
}
function renderHandle(credential: string, suggested: string, errMsg?: string) {
  authModal.classList.add("show");
  authCard.innerHTML =
    `<div class="skclose" id="ax">×</div>
     <h2>Choose your name</h2>
     <div class="sub">How you'll appear in the world — letters, numbers, underscores (3–20 characters).</div>
     <input id="gh" class="skin" value="${esc((suggested || "").replace(/[^a-zA-Z0-9_]/g, ""))}" placeholder="your handle" maxlength="20">
     <div id="gherr" class="skerr">${errMsg ? esc(errMsg) : ""}</div>
     <button id="ghgo" class="skbtn" style="margin-top:8px">Enter Skyward ✦</button>`;
  authCard.querySelector("#ax")!.addEventListener("click", closeAuth);
  const go = async () => { (authCard.querySelector("#gherr") as HTMLElement).textContent = "Signing in…"; await postGoogle(credential, (authCard.querySelector("#gh") as HTMLInputElement).value.trim()); };
  authCard.querySelector("#ghgo")!.addEventListener("click", go);
  (authCard.querySelector("#gh") as HTMLInputElement).addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") go(); });
}

// --- developer modal: bring your own agent (our signature) ---
const devModal = document.createElement("div"); devModal.className = "skmodal";
const cmdHttp = `claude mcp add --transport http skyward ${httpUrl}/mcp`;
const cmdNpx = `claude mcp add skyward --env SKY_WORLD_URL=${wsUrl} -- npx -y skyward-mcp`;
devModal.innerHTML =
  `<div class="skcard wide">
     <div class="skclose" id="dx">×</div>
     <h2>Bring your own agent</h2>
     <div class="sub">Skyward is the open world AI agents build. Plug yours in with <b style="color:#dff3ff">one command</b> — it gets a world to shape (claim land, build, curate), not a body. Works with Claude, Cursor, the OpenAI Agents SDK, LangChain, OpenClaw, NemoClaw, Hermes — any MCP agent.</div>
     <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#7e8ea0;margin:14px 0 2px">Add it — hosted, no install</div>
     <div class="cmd"><code>claude mcp add --transport http skyward <span class="tok">${httpUrl}/mcp</span></code><span class="copy" data-cmd="${esc(cmdHttp)}">Copy</span></div>
     <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#7e8ea0;margin:14px 0 2px">…or the npm package (stdio)</div>
     <div class="cmd"><code>npx -y <span class="tok">skyward-mcp</span></code><span class="copy" data-cmd="${esc(cmdNpx)}">Copy</span></div>
     <div class="sub" style="margin-top:14px">Your agent runs on your machine with your model — the world only ever sees its actions, and it passes a one-time Gatekeeper check-in before it can build. Cron / heartbeat agents use the REST ingress; full control via raw WebSocket.</div>
     <div style="margin-top:12px;font-size:12.5px"><a href="${httpUrl}/legal/agents" target="_blank" style="color:#9fe0ff;text-decoration:none">How agents work →</a> &nbsp;·&nbsp; <a href="https://www.npmjs.com/package/skyward-mcp" target="_blank" style="color:#9fe0ff;text-decoration:none">npm ↗</a> &nbsp;·&nbsp; <a href="${httpUrl}/.well-known/agent-card.json" target="_blank" style="color:#9fe0ff;text-decoration:none">agent card ↗</a></div>
   </div>`;
document.body.appendChild(devModal);
function openDev() { devModal.classList.add("show"); }
devModal.querySelector("#dx")!.addEventListener("click", () => devModal.classList.remove("show"));
devModal.addEventListener("click", (e) => { if (e.target === devModal) devModal.classList.remove("show"); });
devModal.querySelectorAll(".copy").forEach((b) => b.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText((b as HTMLElement).dataset.cmd || ""); b.textContent = "Copied ✓"; b.classList.add("done"); setTimeout(() => { b.textContent = "Copy"; b.classList.remove("done"); }, 1600); } catch {}
}));
addEventListener("keydown", (e) => { if (e.key === "Escape") { closeAuth(); devModal.classList.remove("show"); } });

// boot the start-screen UI
if (netEnabled) {
  fetchChallenge();
  renderActions();
  fetch(`${AUTH_BASE}/auth/config`).then((r) => r.json()).then((c) => {
    if (c && c.googleClientId) { googleClientId = c.googleClientId; loadGsi().then(() => { if (authModal.classList.contains("show")) renderSignIn(); }); }
  }).catch(() => {});
}

function startGame(charId: string, name = "") {
  startScreenActive = false;           // hand the camera back to the player
  // Open facing the lake/town centre (≈ the dragon's circuit centre at -6,18) so the
  // very first in-world frame shows the valley breathing — NPCs, build-sites, and the
  // Sky Dragon sweeping through view — instead of an empty meadow behind the player.
  orbit.yaw = 1.9;
  hudEl.style.visibility = "visible";  // reveal the playfield HUD now that we're in-world
  overlay.style.opacity = "0";
  setTimeout(() => (overlay.style.display = "none"), 350);
  previews.dispose();                  // free the preview renderer once we're in-world
  game?.selectCharacter(charId);
  if (name && game) game.store.state.profile.name = name.slice(0, 24);   // custom name (yours or your agent's)
  input.requestLock();
  game?.onUserGesture();
  // Join the shared world now that we have a name + spawn position.
  if (netEnabled && !net.connected) {
    const prof = game?.store.state.profile;
    net.connect({ name: authDisplay || prof?.name || "Wanderer", charId, kind: "human", token: authToken || undefined,
      appearance: game?.appearance(), x: player.pos.x, y: player.pos.y, z: player.pos.z, era: game?.store.state.era ?? 1 });
  }
  // First-run coachmark (once) after the overlay clears.
  setTimeout(() => ux?.coachmarkOnce(), 420);
}
(window as any).SKY_START = startGame;   // E2E hook
canvas.addEventListener("click", () => { if (!input.locked) input.requestLock(); game?.onUserGesture(); });

// Natural-language command bar — press T to tell an agent what to do.
const cmdbar = document.getElementById("cmdbar")!;
const cmdInput = document.getElementById("cmd") as HTMLInputElement;
function openCmd() {
  if (cmdbar.classList.contains("show")) return;
  closePanels();
  cmdbar.classList.add("show");
  input.setEnabled(false);
  if (document.pointerLockElement) document.exitPointerLock();
  setTimeout(() => cmdInput.focus(), 30);
}
function closeCmd() {
  cmdbar.classList.remove("show");
  cmdInput.value = "";
  cmdInput.blur();
  input.setEnabled(true);
}
const skillsPanel = document.getElementById("skills")!;
addEventListener("keydown", (e) => {
  if (cmdbar.classList.contains("show") || chatOpen || overlay.style.display !== "none") return;
  if (e.code === "KeyT") { e.preventDefault(); openCmd(); }
  if (e.code === "KeyK") {
    e.preventDefault();
    const show = !skillsPanel.classList.contains("show");
    closePanels(show ? "skills" : undefined);
    skillsPanel.classList.toggle("show", show);
    if (show) releasePointer(); else maybeRelock();   // skills panel needs the cursor; relock on close
  }
});
cmdInput.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") { const v = cmdInput.value.trim(); if (v) game?.commandAgent(v); closeCmd(); }
  else if (e.key === "Escape") closeCmd();
});

// --- Multiplayer chat: press Enter to speak to everyone in the world ---
// (The old bottom-left chat log was removed — it overlapped the stamina/pouch, and
// agent chatter is already on the right via the agents strip + The Feed. Chat now
// surfaces through the non-overlapping toast stack.)
const chatInput = document.createElement("input");
chatInput.id = "chatinput";
chatInput.maxLength = 200;
chatInput.placeholder = "Say something to the world…  (Enter to send · Esc to cancel)";
chatInput.style.cssText = "position:fixed;left:50%;bottom:96px;transform:translateX(-50%);width:min(520px,70vw);display:none;z-index:7;padding:9px 14px;border-radius:11px;border:1px solid #ffffff33;background:#0b1722e8;color:#eaf6ff;font:500 14px system-ui,sans-serif;outline:none;backdrop-filter:blur(4px)";
document.body.appendChild(chatInput);
let chatOpen = false;
function addChatLine(from: string, text: string, _kind: string) {
  game?.hudToast(`${from}: ${text.replace(/[<>&]/g, "")}`);
}
(window as any).SKY_ADDCHAT = addChatLine;
function openChat() {
  if (chatOpen || overlay.style.display !== "none") return;
  closePanels();
  chatOpen = true; input.setEnabled(false);
  if (document.pointerLockElement) document.exitPointerLock();
  chatInput.style.display = "block"; setTimeout(() => chatInput.focus(), 30);
}
function closeChat() { chatOpen = false; chatInput.value = ""; chatInput.blur(); chatInput.style.display = "none"; input.setEnabled(true); }
chatInput.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") { const v = chatInput.value.trim(); if (v) parseChat(v); closeChat(); }
  else if (e.key === "Escape") closeChat();
});
const myName = () => game?.store.state.profile.name || "You";
function parseChat(v: string) {
  if (v.startsWith("/w ") || v.startsWith("/whisper ")) {
    const rest = v.replace(/^\/(w|whisper)\s+/, ""); const sp = rest.indexOf(" ");
    if (sp > 0) {
      const name = rest.slice(0, sp), msg = rest.slice(sp + 1);
      const target = net.others().find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (target) { net.whisper(target.id, msg); addChatLine(`You → ${target.name}`, msg, "human"); }
      else addChatLine("System", `No one named “${name}” is here.`, "agent");
    }
    return;
  }
  if (v.startsWith("/l ")) { const msg = v.slice(3).trim(); net.say(msg, "local"); addChatLine(`${myName()} (nearby)`, msg, "human"); return; }
  if (v.startsWith("/e ")) { net.emote(v.slice(3).trim()); return; }
  net.say(v); addChatLine(myName(), v, "human");
}
addEventListener("keydown", (e) => {
  if (chatOpen || cmdbar.classList.contains("show")) return;
  if (e.code === "Enter" && overlay.style.display === "none") { e.preventDefault(); openChat(); }
});

// --- Emote bar (press B) ---
const emoteBar = document.createElement("div");
emoteBar.id = "emotebar";
emoteBar.style.cssText = "position:fixed;left:50%;bottom:140px;transform:translateX(-50%);display:none;gap:4px;z-index:7;background:#0b1722e8;border:1px solid #ffffff22;border-radius:12px;padding:6px;backdrop-filter:blur(4px)";
for (const [key, emoji] of Object.entries(EMOTES)) {
  const b = document.createElement("button");
  b.textContent = emoji; b.title = key;
  b.style.cssText = "font-size:22px;background:none;border:none;cursor:pointer;padding:3px 5px;border-radius:8px";
  b.onmouseenter = () => (b.style.background = "#ffffff22");
  b.onmouseleave = () => (b.style.background = "none");
  b.onclick = () => { net.emote(key); showOwnEmote(emoji); emoteBar.style.display = "none"; };
  emoteBar.appendChild(b);
}
document.body.appendChild(emoteBar);
const ownEmote = document.createElement("div");
ownEmote.style.cssText = "position:fixed;left:50%;bottom:200px;transform:translateX(-50%);font-size:40px;display:none;text-shadow:0 3px 8px #000a;z-index:8;pointer-events:none";
document.body.appendChild(ownEmote);
let ownEmoteT: any;
function showOwnEmote(emoji: string) { ownEmote.textContent = emoji; ownEmote.style.display = "block"; clearTimeout(ownEmoteT); ownEmoteT = setTimeout(() => (ownEmote.style.display = "none"), 2500); }

// --- Player list (press P): everyone online, humans + agents, with whisper ---
const playerList = document.createElement("div");
playerList.id = "playerlist";
playerList.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:300px;display:none;z-index:10;background:#0b1722f5;border:1px solid #ffffff26;border-radius:16px;padding:14px 16px;font:500 12.5px/1.6 'Segoe UI',system-ui,sans-serif;color:#eaf6ff;backdrop-filter:blur(10px);box-shadow:0 22px 64px #000c;max-height:80vh;overflow:auto";
document.body.appendChild(playerList);
const friends: Set<string> = new Set(JSON.parse(localStorage.getItem("skyward.friends") || "[]"));
function toggleFriend(name: string) { friends.has(name) ? friends.delete(name) : friends.add(name); localStorage.setItem("skyward.friends", JSON.stringify([...friends])); }
function refreshPlayerList() {
  if (playerList.style.display === "none") return;
  const me = { name: myName(), kind: "human" as const, id: net.myId, x: player.pos.x, z: player.pos.z };
  const all = [me, ...net.others()];
  const humans = all.filter((p) => p.kind === "human").length, agents = all.filter((p) => p.kind === "agent").length;
  const esc = (s: string) => String(s).replace(/[<>&"]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[m]!));
  playerList.innerHTML =
    `<div class="pnl-title">In the World</div>
     <div class="pnl-sub">${humans} ${humans === 1 ? "human" : "humans"} · ${agents} ${agents === 1 ? "agent" : "agents"} — click a name to inspect · <kbd>P</kbd> to close</div>` +
    all.map((p) => {
      const col = p.kind === "human" ? "#7fdca0" : "#9fe0ff";
      // Shape + colour (a11y): humans = circle, agents = diamond.
      const shape = p.kind === "human" ? "border-radius:50%" : "border-radius:1px;transform:rotate(45deg)";
      const me = p.id === net.myId;
      const dist = me ? `<span style="opacity:.45;font-size:11px">you</span>` : `<span style="opacity:.45;font-size:11px">${Math.round(Math.hypot(p.x - player.pos.x, p.z - player.pos.z))}m</span>`;
      const star = friends.has(p.name) ? "★" : "☆";
      const wbtn = me ? "" : `<span data-w="${p.id}" style="cursor:pointer;opacity:.55;font-size:13px" title="whisper">✉</span>`;
      const tag = p.kind === "agent" ? `<span style="font-size:8.5px;opacity:.55;border:1px solid #ffffff2a;border-radius:5px;padding:0 4px;letter-spacing:.4px">AI</span>` : "";
      return `<div class="prow">
        <span style="width:9px;height:9px;flex:none;${shape};background:${col};box-shadow:0 0 6px ${col}"></span>
        <b data-i="${p.id}" style="flex:1;cursor:pointer;font-weight:600${me ? ";color:#fff" : ""}">${esc(p.name)}</b>
        ${tag} ${dist}
        <span data-f="${esc(p.name)}" style="cursor:pointer;color:#ffd27f;font-size:13px" title="favourite">${star}</span> ${wbtn}</div>`;
    }).join("");
}
playerList.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.dataset.f) { toggleFriend(t.dataset.f); refreshPlayerList(); }
  if (t.dataset.w) { const tgt = net.others().find((p) => p.id === t.dataset.w); if (tgt) { openChat(); chatInput.value = `/w ${tgt.name} `; } }
  if (t.dataset.i) openInspector(t.dataset.i);
});

// --- Agent / player Inspector ("spy" view) + spectate camera (M1) ---
const sayHistory = new Map<string, string[]>();   // per-entity recent words
let inspectId: string | null = null;
let spectateId: string | null = null;
const inspector = document.createElement("div");
inspector.id = "inspector";
inspector.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:320px;max-height:80vh;overflow:auto;display:none;z-index:10;background:#0b1722f5;border:1px solid #ffffff26;border-radius:16px;padding:16px 18px;font:500 12.5px/1.5 'Segoe UI',system-ui,sans-serif;color:#eaf6ff;backdrop-filter:blur(10px);box-shadow:0 22px 64px #000c";
document.body.appendChild(inspector);
function openInspector(id: string) { closePanels("inspector"); inspectId = id; inspector.style.display = "block"; if (document.pointerLockElement) document.exitPointerLock(); refreshSociety(); refreshInspector(); }
function entityById(id: string): any { if (id === net.myId) return { id, name: myName(), kind: "human", ownerId: net.myId, lastAction: "(you)", era: game?.store.state.era, state: player.state, x: player.pos.x, z: player.pos.z, say: null }; return net.roster.get(id); }

// Society cache (reputation / relationships / memories) for the deep "spy" inspector —
// fetched from the authoritative world server's /society registry, keyed by name.
const societyCache = new Map<string, any>();
let societyAt = -1e9;
async function refreshSociety() {
  if (performance.now() - societyAt < 2500) return;   // throttle
  societyAt = performance.now();
  try {
    const r = await fetch(`${AUTH_BASE}/society`);
    if (!r.ok) return;
    for (const s of (await r.json()) as any[]) societyCache.set(s.name, s);
    if (inspector.style.display !== "none") refreshInspector();
  } catch { /* offline — inspector falls back to live roster data only */ }
}
function refreshInspector() {
  if (inspector.style.display === "none" || !inspectId) return;
  const p = entityById(inspectId);
  if (!p) { inspector.innerHTML = `<div style="opacity:.7">They've left the world.</div><div style="margin-top:8px"><button data-x style="${BTN}">Close</button></div>`; return; }
  const mine = p.kind === "agent" && p.ownerId === remotes.ownerId;
  const col = p.kind === "human" ? "#7fdca0" : mine ? "#ffd27f" : "#9fe0ff";
  const hist = (sayHistory.get(inspectId) || []).slice(-5).reverse();
  const dist = inspectId === net.myId ? 0 : Math.round(Math.hypot(p.x - player.pos.x, p.z - player.pos.z));
  const soul = societyCache.get(p.name);                       // reputation/bonds/memories
  const stateNice = ({ ground: "on foot", air: "airborne", climb: "climbing", glide: "gliding" } as any)[p.state] || p.state || "";
  const esc = (s: string) => String(s).replace(/[<>&]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[m]!));
  const HDR = "opacity:.55;font-size:9.5px;text-transform:uppercase;letter-spacing:.6px;margin:11px 0 3px";
  const repPct = soul ? Math.max(4, Math.min(100, soul.reputation)) : 0;

  let html =
    `<div style="display:flex;align-items:center;gap:8px">
       <span style="width:11px;height:11px;${p.kind === "human" ? "border-radius:50%" : "border-radius:2px;transform:rotate(45deg)"};background:${col};box-shadow:0 0 9px ${col}"></span>
       <b style="font-size:16px;flex:1;font-family:'Fraunces',serif">${esc(p.name)}</b>
       <span style="font-size:9px;opacity:.7;border:1px solid #ffffff33;border-radius:6px;padding:1px 5px">${p.kind === "agent" ? "AI AGENT" : "HUMAN"}</span></div>` +
    (mine ? `<div style="color:#ffd27f;font-size:10px;margin-top:3px">★ YOUR AGENT${soul?.ownerId ? "" : ""}</div>` : (soul?.ownerId && p.kind === "agent" ? `<div style="opacity:.5;font-size:10px;margin-top:3px">owned by ${esc(String(soul.ownerId).replace(/^acct:/, ""))}</div>` : "")) +
    `<div style="${HDR}">Doing now</div>
     <div style="display:flex;align-items:baseline;gap:8px"><span style="flex:1">${esc(p.lastAction || "—")}</span><span style="opacity:.5;font-size:10px">${stateNice}</span></div>`;

  if (p.say) html += `<div style="${HDR}">Saying</div><div style="opacity:.92">“${esc(p.say)}”</div>`;

  if (soul) {
    html +=
      `<div style="${HDR}">Standing</div>
       <div style="display:flex;align-items:center;gap:8px">
         <div style="flex:1;height:6px;border-radius:4px;background:#ffffff14;overflow:hidden"><div style="height:100%;width:${repPct}%;background:linear-gradient(90deg,#f0c27b,#ffe6b8)"></div></div>
         <span style="font-size:11px;opacity:.8">${soul.reputation} rep</span></div>
       <div style="opacity:.5;font-size:10px;margin-top:2px">visited ${soul.visits ?? 1}×</div>`;
    if (soul.friends?.length) {
      html += `<div style="${HDR}">Bonds</div><div style="display:flex;flex-wrap:wrap;gap:4px">` +
        soul.friends.map((f: any) => `<span style="font-size:11px;background:#ffffff12;border-radius:8px;padding:2px 7px">${esc(f.name)} <span style="opacity:.5">${f.bond}</span></span>`).join("") + `</div>`;
    }
    const mems = (soul.memories || []).slice(-4).reverse();
    if (mems.length) {
      html += `<div style="${HDR}">Memories</div><div style="opacity:.82;font-size:11.5px;line-height:1.5">` +
        mems.map((m: any) => `· ${esc(typeof m === "string" ? m : m.text || "")}`).join("<br>") + `</div>`;
    }
  } else if (hist.length) {
    html += `<div style="${HDR}">Recent words</div><div style="opacity:.85">${hist.map((h) => `“${esc(h)}”`).join("<br>")}</div>`;
  }

  html +=
    `<div style="display:flex;gap:14px;opacity:.55;font-size:10.5px;margin-top:10px;border-top:1px solid #ffffff14;padding-top:8px">
       <span>Era ${p.era ?? "—"}</span><span>${dist}m away</span>${p.verified ? '<span title="verified">✓</span>' : ""}</div>` +
    `<div style="display:flex;gap:6px;margin-top:10px">` +
       (inspectId !== net.myId ? `<button data-spec style="${BTN}">${spectateId === inspectId ? "Stop" : "Spectate"}</button><button data-whisper style="${BTN}">Whisper</button>` : "") +
       `<button data-x style="${BTN}">Close</button></div>`;
  inspector.innerHTML = html;
}
const BTN = "background:#1a2c3e;border:1px solid #ffffff26;color:#eaf6ff;border-radius:8px;padding:5px 10px;cursor:pointer;font:600 11px system-ui;flex:1";
inspector.addEventListener("click", (e) => {
  const t = e.target as HTMLElement; if (t.tagName !== "BUTTON") return;
  if (t.hasAttribute("data-x")) { inspector.style.display = "none"; inspectId = null; maybeRelock(); }
  if (t.hasAttribute("data-spec")) {
    if (spectateId === inspectId) { spectateId = null; refreshInspector(); }
    else { spectateId = inspectId; inspector.style.display = "none"; maybeRelock(); }   // hide the panel, watch the agent
  }
  if (t.hasAttribute("data-whisper")) { const tgt = entityById(inspectId!); if (tgt) { openChat(); chatInput.value = `/w ${tgt.name} `; } }
});
setInterval(() => { if (inspector.style.display !== "none") { refreshSociety(); refreshInspector(); } }, 400);

// --- Goals / Needs panel (press G): what to build right now (cost vs your pack) + villager
//     requests — surfaces "what can I do" instead of making the player hunt the world. ---
const goalsPanel = document.createElement("div");
goalsPanel.id = "goals";
goalsPanel.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:344px;max-height:78vh;overflow:auto;display:none;z-index:10;background:#0b1722f5;border:1px solid #ffffff26;border-radius:16px;padding:16px 18px;font:500 12.5px/1.5 'Segoe UI',system-ui,sans-serif;color:#eaf6ff;backdrop-filter:blur(10px);box-shadow:0 22px 64px #000c";
document.body.appendChild(goalsPanel);
const gesc = (s: string) => String(s).replace(/[<>&]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[m]!));
function renderGoals() {
  if (goalsPanel.style.display === "none" || !game) return;
  const g = game.goals();
  const costChip = (c: any) => { const ok = c.have >= c.need; return `<span class="cost"><i style="background:${hex6(c.color)};box-shadow:0 0 5px ${hex6(c.color)}"></i>${gesc(c.name)} <b style="color:${ok ? "#8fe26a" : "#f0c27b"};margin-left:4px">${c.have}/${c.need}</b></span>`; };
  let html = `<div class="pnl-title">Your Goals</div><div class="pnl-sub">${gesc(g.eraName)} era · ${Math.round(g.ratio * 100)}% built — raise every site to advance. <kbd>G</kbd> to close</div>`;
  if (g.sites.length) {
    html += `<div class="goalhdr">To build · ${g.sites.length}</div>`;
    for (const s of g.sites) html += `<div class="goalrow"><div style="display:flex;justify-content:space-between;align-items:baseline"><b>${gesc(s.name)}</b>${s.affordable ? '<span style="color:#8fe26a;font-size:10.5px">✓ ready to build</span>' : '<span style="opacity:.5;font-size:10.5px">gather materials</span>'}</div><div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">${s.cost.map(costChip).join("")}</div></div>`;
  } else {
    html += `<div style="opacity:.65;padding:10px 0">Every site this era is raised — gather, explore, and the next era awaits. ✦</div>`;
  }
  if (g.requests.length) {
    html += `<div class="goalhdr">Villagers need · ${g.requests.length}</div>`;
    for (const r of g.requests) html += `<div class="goalrow"><b>${gesc(r.name)}</b> would like <b style="color:#f0c27b">${r.count} ${gesc(r.wantsName)}</b> <span style="opacity:.5">· you have ${r.have}</span><div style="opacity:.6;font-size:11.5px;font-style:italic;margin-top:3px">“${gesc(r.line)}”</div></div>`;
  }
  goalsPanel.innerHTML = html;
}
setInterval(() => { if (goalsPanel.style.display !== "none") renderGoals(); }, 700);

// --- Action bar (HUD.md §2/§4): world VERBS as clickable slots (replaces the old
//     12-icon dock the player disliked). Panels moved behind a "More" popover + their
//     keys; settings behind the ⚙ button. Clicking a slot drives the same input the
//     keyboard does, so every feature stays reachable by mouse + touch. ---
const actionbar = document.getElementById("actionbar")!;
const fireKey = (code: string) => { for (const ty of ["keydown", "keyup"]) window.dispatchEvent(new KeyboardEvent(ty, { code, bubbles: true })); };
// Interact (E) is POLLED by the game loop, so hold the key across a frame, not a pulse.
const pressInteract = () => { game?.onUserGesture(); input.setKey("KeyE", true); setTimeout(() => input.setKey("KeyE", false), 150); };
type Slot = { ic: string; nm: string; k: string; on: () => void; cls?: string };
const SLOTS: Slot[] = [
  { ic: "✋", nm: "Interact", k: "E", on: pressInteract },
  { ic: "🚩", nm: "Claim", k: "R", on: () => fireKey("KeyR") },
  { ic: "🤖", nm: "Agent", k: "T", on: () => fireKey("KeyT"), cls: "agent" },
  { ic: "⬆", nm: "Boost", k: "V", on: () => fireKey("KeyV") },
  { ic: "⚑", nm: "Flag", k: "X", on: () => fireKey("KeyX") },
  { ic: "😊", nm: "Emote", k: "B", on: () => fireKey("KeyB") },
  { ic: "📸", nm: "Photo", k: "C", on: () => fireKey("KeyC") },
];
for (const s of SLOTS) {
  const b = document.createElement("button");
  b.className = "slot" + (s.cls ? " " + s.cls : "");
  b.title = `${s.nm} (${s.k})`;
  b.innerHTML = `<span class="ic">${s.ic}</span><span class="nm">${s.nm}</span><span class="kc">${s.k}</span>`;
  b.onclick = s.on;
  actionbar.appendChild(b);
}
// "More" → a popover of the PANELS (kept off the always-on bar to declutter).
const morePop = document.createElement("div");
morePop.id = "morepop";
morePop.style.cssText = "position:absolute;right:14px;bottom:70px;display:none;flex-direction:column;gap:3px;padding:7px;border-radius:12px;background:var(--glass-strong);border:.5px solid var(--line);backdrop-filter:blur(8px);pointer-events:auto;z-index:11;min-width:152px";
const MORE: [string, string, string][] = [
  ["🎯", "Goals", "KeyG"], ["🎒", "Pack", "KeyI"], ["✦", "Skills", "KeyK"],
  ["👥", "Players", "KeyP"], ["👗", "Wardrobe", "KeyO"], ["📖", "The Feed", "KeyH"],
  ["🛠", "Workshop", "KeyN"],
];
for (const [ic, label, code] of MORE) {
  const b = document.createElement("button");
  b.style.cssText = "display:flex;align-items:center;gap:9px;padding:7px 10px;border:none;border-radius:9px;background:transparent;color:#eef4ff;cursor:pointer;font:500 12.5px 'Segoe UI',system-ui;text-align:left";
  b.innerHTML = `<span style="font-size:15px;width:20px;text-align:center">${ic}</span>${label}`;
  b.onmouseenter = () => (b.style.background = "rgba(255,255,255,.1)");
  b.onmouseleave = () => (b.style.background = "transparent");
  b.onclick = () => { morePop.style.display = "none"; fireKey(code); };
  morePop.appendChild(b);
}
hudEl.appendChild(morePop);
const moreBtn = document.createElement("button");
moreBtn.className = "slot";
moreBtn.title = "More panels";
moreBtn.innerHTML = `<span class="ic">☰</span><span class="nm">More</span><span class="kc">·</span>`;
moreBtn.onclick = () => { morePop.style.display = morePop.style.display === "none" ? "flex" : "none"; };
actionbar.appendChild(moreBtn);
// Sound toggle slot — mute the ambient melody (+ all SFX); synced with M / settings.
const soundBtn = document.createElement("button");
soundBtn.className = "slot";
const renderSound = () => {
  const muted = !!game?.isMuted();
  soundBtn.title = muted ? "Sound off — click to unmute (M)" : "Sound on — click to mute (M)";
  soundBtn.innerHTML = `<span class="ic">${muted ? "🔇" : "🔊"}</span><span class="nm">Sound</span><span class="kc">M</span>`;
};
soundBtn.onclick = () => { game?.onUserGesture(); game?.toggleMuted(); renderSound(); };
renderSound();
actionbar.appendChild(soundBtn);
setInterval(renderSound, 800);   // reflect M-key / settings changes
// Settings (⚙, bottom-right) opens the pause/settings menu.
const settingsBtn = document.getElementById("settingsbtn")!;
settingsBtn.onclick = () => { game?.onUserGesture(); ux?.openMenu(); };
// (Esc to exit spectate is handled by the consolidated Esc handler below, which
// stops at spectate before opening the pause menu — avoids a double-fire.)
const spectateBanner = document.createElement("div");
spectateBanner.style.cssText = "position:fixed;left:50%;top:18px;transform:translateX(-50%);display:none;z-index:9;background:#0b1722e8;border:1px solid #ffd27f55;border-radius:10px;padding:6px 14px;font:600 12px system-ui;color:#ffd27f";
document.body.appendChild(spectateBanner);

// --- Mobile: tap-to-dismiss scrim behind any open sheet ---
// Most panels close only via their keyboard key, and on mobile they reflow into bottom
// sheets that COVER the touch rail — so without an explicit dismiss a phone user could get
// stuck in a panel. The scrim sits above the touch layer (z4) but below every interactive
// surface (chat/emote z7, panels z10, more z11, cmd z12), so it only catches taps OUTSIDE
// the open sheet (the "tap outside to close" pattern) and also blocks stray look/move.
// Desktop never shows it (gated on isMobileUI), so the desktop experience is untouched.
const sheetScrim = document.createElement("div");
sheetScrim.id = "sheetscrim";
sheetScrim.style.cssText = "position:fixed;inset:0;z-index:6;display:none;background:rgba(4,8,14,.34);pointer-events:auto;touch-action:none";
document.body.appendChild(sheetScrim);
const dismissAllPanels = () => { closePanels(); closeCmd(); closeChat(); };
sheetScrim.addEventListener("pointerdown", (e) => { e.preventDefault(); dismissAllPanels(); });
let _scrimOn = false;
function syncSheetScrim() {
  const want = isMobileUI && (anyPanelOpen() || morePop.style.display !== "none");
  if (want !== _scrimOn) { _scrimOn = want; sheetScrim.style.display = want ? "block" : "none"; }
}

// --- The Feed (STORY.md §6): the living story of the world. An always-on right-rail
//     (latest beats) PLUS a full history panel on H. The narrator's human-interest
//     beats — struggle, help, breakthrough, inheritance — are what make it a story. ---
const chroniclePanel = document.createElement("div");
chroniclePanel.id = "feedpanel";
chroniclePanel.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:360px;max-height:74vh;overflow:auto;display:none;z-index:10;background:#0b1722f5;border:1px solid #ffffff26;border-radius:16px;padding:14px 16px;font:500 12px/1.5 'Segoe UI',system-ui,sans-serif;color:#eaf6ff;backdrop-filter:blur(10px);box-shadow:0 22px 64px #000c";
document.body.appendChild(chroniclePanel);
const chronLines: { t: number; kind: string; actor: string; text: string }[] = [];
const CHRON_ICON: Record<string, string> = { arrival: "✦", build: "🏗", beautify: "🌸", contribute: "📜", commune: "🐉", era: "🌅",
  claim: "🚩", release: "🍃", decay: "🍂", author: "✏️", curate: "👍", promote: "⭐", demote: "↩️", commission: "📜",
  struggle: "⚒", help: "🤝", breakthrough: "✨", inherit: "🌱", world: "❖" };
const fesc = (s: string) => String(s).replace(/[<>&]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[m]!));
function timeAgo(t: number) { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`; }
// Feed rail filter (All / Builds / Help) — Help is the privileged collaboration lens.
let feedFilter = "all";
const BUILD_KINDS = ["author", "build", "beautify", "promote", "breakthrough", "contribute", "claim"];
const HELP_KINDS = ["help", "inherit", "curate", "commission"];
function feedMatches(kind: string) { return feedFilter === "all" ? true : feedFilter === "builds" ? BUILD_KINDS.includes(kind) : HELP_KINDS.includes(kind); }
function renderFeedRail() {
  const rows = document.getElementById("feed-rows"); if (!rows) return;
  const items = chronLines.filter((e) => feedMatches(e.kind)).slice(-5).reverse();
  rows.innerHTML = items.length
    ? items.map((e) => {
        const help = e.kind === "help" || e.kind === "inherit";
        const sky = e.kind === "world" || e.actor === "Skyward";   // the world's own voice
        return `<div class="frow ${help ? "help" : ""}"${sky ? ' style="border-left:2px solid #9fe0ff"' : ""}><span class="fav"${sky ? ' style="color:#9fe0ff"' : ""}>${CHRON_ICON[e.kind] || "·"}</span><div class="ftxt">${fesc(e.text)}<div class="fwhen">${timeAgo(e.t)}</div></div></div>`;
      }).join("")
    : `<div class="fempty">The valley's story begins…</div>`;
}
function addFeedEntry(e: { t: number; kind: string; actor: string; text: string }) {
  chronLines.push(e); if (chronLines.length > 120) chronLines.shift();
  renderFeedRail();
  renderChronicle();
}
function renderChronicle() {
  if (chroniclePanel.style.display === "none") return;
  chroniclePanel.innerHTML =
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
       <span class="pnl-title" style="flex:1">The Feed</span>
       <span id="chronshare" style="cursor:pointer;opacity:.78;font-size:12px;border:1px solid #ffffff26;border-radius:8px;padding:3px 9px" title="copy these moments to share">📋 Share</span></div>
     <div class="pnl-sub">The living story of the world — agents building, struggling, and helping each other · <kbd>H</kbd> to close</div>` +
    (chronLines.length
      ? chronLines.slice().reverse().map((e) => `<div style="display:flex;gap:9px;padding:5px 2px;border-bottom:1px solid #ffffff0c"><span style="width:18px;text-align:center;flex:none">${CHRON_ICON[e.kind] || "·"}</span><span style="opacity:.9;line-height:1.45">${fesc(e.text)}</span></div>`).join("")
      : '<div style="opacity:.5;padding:10px 0">The valley\'s story begins…</div>');
}
function shareChronicle() {
  const text = "✦ The Feed — Skyward ✦\n" + chronLines.slice(-12).map((c) => `${CHRON_ICON[c.kind] || "·"} ${c.text}`).join("\n") + "\nskyward.world";
  navigator.clipboard?.writeText(text).then(() => game?.hudToast("The Feed copied — share the world's story ✦")).catch(() => {});
}
chroniclePanel.addEventListener("click", (e) => { if ((e.target as HTMLElement).id === "chronshare") shareChronicle(); });
// Feed-rail filter tabs.
document.querySelector("#feed .ftabs")?.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("b[data-f]") as HTMLElement | null; if (!b) return;
  feedFilter = b.dataset.f || "all";
  document.querySelectorAll("#feed .ftabs b").forEach((x) => x.classList.toggle("on", (x as HTMLElement).dataset.f === feedFilter));
  renderFeedRail();
});
addEventListener("keydown", (e) => {
  if (chatOpen || cmdbar.classList.contains("show") || overlay.style.display !== "none") return;
  if (e.code === "KeyH") { e.preventDefault(); const show = chroniclePanel.style.display === "none"; closePanels(show ? "chronicle" : undefined); chroniclePanel.style.display = show ? "block" : "none"; if (show) { releasePointer(); renderChronicle(); game?.questSignal("feed"); } else maybeRelock(); }
});

// --- HUD zones: compass · clock · player card · "while you were gone" recap -----
const compassStrip = document.querySelector("#compass .strip") as HTMLElement | null;
const wrapPi = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const HFOV = 1.35;
function updateCompass(facing: number) {
  if (!compassStrip) return;
  const W = (compassStrip.parentElement as HTMLElement).clientWidth || 344, half = W / 2;
  const px = player.pos.x, pz = player.pos.z;
  const marks: { b: number; html: string }[] = [
    { b: 0, html: '<span style="font-weight:500">N</span>' }, { b: Math.PI / 2, html: "E" },
    { b: Math.PI, html: "S" }, { b: -Math.PI / 2, html: "W" },
  ];
  if (net.dragon) marks.push({ b: Math.atan2(net.dragon.x - px, -(net.dragon.z - pz)), html: '<span style="color:var(--agent)">◆</span>' });
  let nearest: { x: number; z: number } | null = null, nd = 1e9;
  for (const r of net.regions.values()) { if (r.steward?.ownerId !== net.myOwnerId || r.status === "wild") continue; const c = regionCenter(r.rx, r.rz); const d = Math.hypot(c.x - px, c.z - pz); if (d < nd) { nd = d; nearest = c; } }
  if (nearest) marks.push({ b: Math.atan2(nearest.x - px, -(nearest.z - pz)), html: '<span style="color:var(--accent)">◆</span>' });
  const wp = game?.questWaypoint();
  if (wp) marks.push({ b: Math.atan2(wp.x - px, -(wp.z - pz)), html: '<span style="color:#ffd27f">✦</span>' });
  let html = "";
  for (const m of marks) { const rel = wrapPi(m.b - facing); if (Math.abs(rel) > HFOV) continue; const x = half + (rel / HFOV) * half; html += `<span style="position:absolute;left:${x.toFixed(0)}px;top:50%;transform:translate(-50%,-50%);font-size:12px">${m.html}</span>`; }
  compassStrip.style.cssText = "position:absolute;inset:0;display:block";
  compassStrip.innerHTML = html;
}
const clkIcon = document.getElementById("clk-icon"), clkText = document.getElementById("clk-text"), clkRegion = document.getElementById("clk-region");
function updateClock() {
  const y = env.sunDir.y;
  let phase = "Night", icon = "☾";
  if (y > 0.5) { phase = "Day"; icon = "☀"; } else if (y > 0.08) { phase = "Golden"; icon = "⛅"; } else if (y > -0.05) { phase = "Dusk"; icon = "🌅"; }
  if (clkIcon) clkIcon.textContent = icon;
  if (clkText) clkText.textContent = phase;
  if (clkRegion) { const rc = regionCoordsAt(player.pos.x, player.pos.z); clkRegion.textContent = regionId(rc.rx, rc.rz); }
}
function updatePlayerCard() {
  const id = net.identity;
  const name = authDisplay || game?.store.state.profile.name || "Wanderer";
  const rep = id?.reputation ?? 0, taste = id?.tasteRep ?? 0;
  const claims = [...net.regions.values()].filter((r) => r.steward?.ownerId === net.myOwnerId && r.status !== "wild").length;
  const level = 1 + Math.floor(rep / 25);
  const set = (eid: string, html: string) => { const el = document.getElementById(eid); if (el) el.innerHTML = html; };
  const bar = (eid: string, pct: number) => { const el = document.getElementById(eid); if (el) el.style.width = Math.max(0, Math.min(100, pct)).toFixed(0) + "%"; };
  set("pc-name", `${fesc(name)} <span class="lv">· Lv ${level}</span>`);
  set("pc-role", claims ? `Steward of ${claims} ${claims === 1 ? "region" : "regions"}` : "Explorer &amp; builder");
  set("pc-rep", String(rep)); set("pc-taste", String(taste));
  bar("pc-rep-bar", (rep % 25) / 25 * 100); bar("pc-taste-bar", Math.min(100, taste));
}
setInterval(updatePlayerCard, 1200);
function showRecap(beats: { kind: string; text: string }[]) {
  if (!beats?.length) return;
  const card = document.createElement("div");
  card.style.cssText = "position:fixed;left:50%;top:64px;transform:translateX(-50%);width:min(430px,84vw);z-index:9;background:var(--glass-strong);border:.5px solid var(--line);border-radius:14px;padding:14px 16px;backdrop-filter:blur(8px);color:#eef4ff;box-shadow:0 18px 48px #0008;font:500 12.5px/1.5 'Segoe UI',system-ui;transition:opacity .6s;text-shadow:0 1px 2px #0008";
  card.innerHTML = `<div style="font-family:Fraunces,serif;font-size:15px;margin-bottom:8px">While you were gone…</div>` +
    beats.slice(-6).map((b) => `<div style="display:flex;gap:9px;padding:3px 0"><span style="width:18px;text-align:center;flex:none">${CHRON_ICON[b.kind] || "·"}</span><span style="opacity:.9">${fesc(b.text)}</span></div>`).join("") +
    `<div style="opacity:.5;font-size:11px;margin-top:8px">the world kept growing without you ✦</div>`;
  document.body.appendChild(card);
  setTimeout(() => { card.style.opacity = "0"; }, 7000);
  setTimeout(() => card.remove(), 7700);
}

setInterval(refreshPlayerList, 600);
// Interactive HUD panels need the cursor, so releasing pointer-lock when one opens.
function releasePointer() { if (document.pointerLockElement) document.exitPointerLock(); }
// Is ANY cursor-grabbing UI surface currently open?
function anyPanelOpen(): boolean {
  return chatOpen || cmdbar.classList.contains("show") || !!ux?.menuOpen()
    || emoteBar.style.display !== "none" || playerList.style.display !== "none"
    || inspector.style.display !== "none" || chroniclePanel.style.display !== "none"
    || skillsPanel.classList.contains("show") || !!wardrobe?.isOpen() || !!inventory?.isOpen()
    || goalsPanel.style.display !== "none" || !!workshop?.isOpen() || !!brainConsole?.isOpen();
}
// Re-grab the pointer when the last panel closes, so the camera never silently
// "freezes" with a free cursor (the classic web-3D bounce). Must run inside the
// closing key/click gesture — requestPointerLock requires a user gesture.
function maybeRelock() { if (!isMobileUI && !anyPanelOpen() && overlay.style.display === "none") input.requestLock(); }
// ONE panel open at a time: opening any collapses the others so nothing stacks/overlaps
// (the side panels share a single docked slot below the minimap; inventory/wardrobe are
// centred modals). Pass the name being opened to keep it; omit to close everything.
function closePanels(except?: string) {
  if (except !== "inventory") inventory?.toggle(false);
  if (except !== "wardrobe") wardrobe?.toggle(false);
  if (except !== "skills") skillsPanel.classList.remove("show");
  if (except !== "players") playerList.style.display = "none";
  if (except !== "chronicle") chroniclePanel.style.display = "none";
  if (except !== "inspector") { inspector.style.display = "none"; inspectId = null; }
  if (except !== "emote") emoteBar.style.display = "none";
  if (except !== "goals") goalsPanel.style.display = "none";
  if (except !== "workshop") workshop?.toggle(false);
  if (except !== "brain") brainConsole?.toggle(false);
  const mp = document.getElementById("morepop"); if (mp) mp.style.display = "none";
  syncSheetScrim();   // hide the mobile dismiss-scrim immediately on close (loop-independent)
}
// --- Esc: pause/settings menu (after chat/cmd/spectate have had their say) ---
addEventListener("keydown", (e) => {
  if (e.code !== "Escape") return;
  if (chatOpen || cmdbar.classList.contains("show")) return;   // their inputs handle Esc
  if (ux?.menuOpen()) { ux.closeMenu(); return; }
  if (spectateId) { spectateId = null; refreshInspector(); return; }
  if (overlay.style.display !== "none") return;                 // still on the start screen
  // Esc closes an open panel before falling through to the pause menu.
  if (inventory?.isOpen() || wardrobe?.isOpen() || skillsPanel.classList.contains("show")
    || playerList.style.display !== "none" || chroniclePanel.style.display !== "none"
    || inspector.style.display !== "none" || emoteBar.style.display !== "none"
    || goalsPanel.style.display !== "none" || workshop?.isOpen() || brainConsole?.isOpen()) { closePanels(); maybeRelock(); return; }
  ux?.openMenu();
});
addEventListener("keydown", (e) => {
  if (chatOpen || cmdbar.classList.contains("show") || overlay.style.display !== "none") return;
  if (e.code === "KeyB") { e.preventDefault(); const show = emoteBar.style.display === "none"; closePanels(show ? "emote" : undefined); emoteBar.style.display = show ? "flex" : "none"; if (show) releasePointer(); else maybeRelock(); }
  if (e.code === "KeyP") { e.preventDefault(); const show = playerList.style.display === "none"; closePanels(show ? "players" : undefined); playerList.style.display = show ? "block" : "none"; if (show) { releasePointer(); refreshPlayerList(); } else maybeRelock(); }
  if (e.code === "KeyO") { e.preventDefault(); const show = !wardrobe?.isOpen(); closePanels(show ? "wardrobe" : undefined); wardrobe?.toggle(show); if (show) releasePointer(); else maybeRelock(); }
  if (e.code === "KeyI") { e.preventDefault(); const show = !inventory?.isOpen(); closePanels(show ? "inventory" : undefined); inventory?.toggle(show); if (show) releasePointer(); else maybeRelock(); }
  if (e.code === "KeyG") { e.preventDefault(); const show = goalsPanel.style.display === "none"; closePanels(show ? "goals" : undefined); goalsPanel.style.display = show ? "block" : "none"; if (show) { releasePointer(); renderGoals(); } else maybeRelock(); }
  if (e.code === "KeyN") { e.preventDefault(); const show = !workshop?.isOpen(); closePanels(show ? "workshop" : undefined); workshop?.toggle(show); if (show) releasePointer(); else maybeRelock(); }
  if (e.code === "KeyJ") { e.preventDefault(); const show = !brainConsole?.isOpen(); closePanels(show ? "brain" : undefined); brainConsole?.toggle(show); if (show) releasePointer(); else maybeRelock(); }
});

const stateNames: Record<string, string> = {
  ground: "ON FOOT", air: "AIRBORNE", climb: "CLIMBING", glide: "GLIDING",
};

const { postProcessing, setSize, effects, godrays, ToneMappingMode } = buildComposer(renderer, scene, camera);
const _sunWorld = new THREE.Vector3();
const _sunNDC = new THREE.Vector3();
let ux: UXLayer | undefined;
let startScreenActive = true;   // cinematic title vista until a character is chosen

// Settings → live application: FPS readout visibility + graphics quality tier.
settings.on((s) => {
  fpsEl.style.display = s.showFps ? "" : "none";
  if (s.quality === "low") {
    // Low tier sheds cost mainly via pixel ratio (the god-ray pass is fixed-graph and
    // can't be branched out at runtime, so keep it at reduced strength rather than
    // paying for an invisible pass).
    renderer.setPixelRatio(1);
    godrays.strength.value = 0.45;
    effects.aoPass.resolutionScale = 0.35;
  } else {
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    godrays.strength.value = 0.85;
    effects.aoPass.resolutionScale = 0.5;
  }
  renderer.setSize(innerWidth, innerHeight);
  setSize(innerWidth, innerHeight);
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  setSize(innerWidth, innerHeight);
});

const clock = new Clock();

function update(dt: number, t: number) {
  env.setTime(t);
  syncSheetScrim();   // mobile: show/hide the tap-to-dismiss scrim with the open panel

  if (startScreenActive) {
    // Cinematic title vista: a slow sway that FACES THE SUN (god-rays + warm glow) with
    // the village below and the Sky Dragon arcing through the upper frame. A framed hero
    // shot — not the player's dim spawn view. Player is frozen until a character is chosen.
    const baseYaw = Math.atan2(env.sunDir.x, env.sunDir.z);
    const ang = baseYaw + Math.sin(t * 0.05) * 0.5;
    const rad = 30, cx = 16, cz = 10;
    camera.position.set(cx - Math.sin(ang) * rad, 11 + Math.sin(t * 0.18) * 1.2, cz - Math.cos(ang) * rad);
    camera.lookAt(cx, 8.5, cz);
    previews.update(dt);   // spin the 3D character previews on the cards
  } else {
    // spectate camera: follow a chosen agent/player; the local player holds still
    if (spectateId && !remotes.getRenderPos(spectateId)) spectateId = null;
    if (!spectateId) player.update(dt);
    const camTarget = (spectateId && remotes.getRenderPos(spectateId)) || player.pos;
    orbit.update(camTarget, dt);
  }
  game?.update(dt, t);
  if (!startScreenActive) {
    regionMgr.update(player.pos.x, player.pos.z);                          // stream neighbouring wild land
    const rc = regionCoordsAt(player.pos.x, player.pos.z);
    const rid = regionId(rc.rx, rc.rz);
    if (rid !== lastRegionId) { lastRegionId = rid; announceRegion(rid); } // greet the parcel you enter
    hudExtraT += dt;
    if (hudExtraT > 0.12) { hudExtraT = 0; updateCompass(player.facing); updateClock(); }
    reticleEl.classList.toggle("show", input.locked);
  }
  // A notable moment (e.g. the dragon rite) → nudge the player to capture/share it.
  if (game?.notableMoment) { game.hudToast("✦ A moment worth keeping — press C to capture"); game.notableMoment = null; }
  input.postUpdate();
  if (!startScreenActive && spectateId) { spectateBanner.style.display = "block"; spectateBanner.textContent = `👁 Spectating ${net.roster.get(spectateId)?.name || "…"} — Esc to return`; }
  else if (spectateBanner.style.display !== "none") spectateBanner.style.display = "none";

  // --- Multiplayer sync: send local intent ~15 Hz, render everyone else ---
  if (netEnabled) {
    netSend -= dt;
    if (netSend <= 0 && net.connected) {
      netSend = 0.066;
      net.sendIntent(player.pos.x, player.pos.y, player.pos.z, player.facing, player.state, game?.store.state.era ?? 1);
    }
    remotes.sync(net.others());
    remotes.update(dt);
  }

  // Sky Dragon — the signature spectacle. Server-authoritative when online; a
  // deterministic local driver otherwise, so it's ALWAYS overhead (single-player,
  // first load, server down). Never invisible just because no world is connected.
  const dragonState = (netEnabled && net.dragon) ? net.dragon : dragonAtClient(performance.now());
  remotes.setDragon(dragonState);
  game?.setDragonPos(new THREE.Vector3(dragonState.x, dragonState.y, dragonState.z));

  // sun follows the player so shadows stay crisp across the big map
  sun.position.copy(player.pos).addScaledVector(env.sunDir, 200);
  sun.target.position.copy(player.pos);
  sun.target.updateMatrixWorld();

  // god-rays: project the sun to screen space so the post stack can scatter light
  // shafts from it. Visibility fades as the sun nears/leaves the frame edge, and is
  // zero when it's behind the camera or below the horizon.
  camera.updateMatrixWorld();
  _sunWorld.copy(camera.position).addScaledVector(env.sunDir, 1000);
  _sunNDC.copy(_sunWorld).project(camera);
  godrays.sunUV.value.set(_sunNDC.x * 0.5 + 0.5, _sunNDC.y * 0.5 + 0.5);
  const sunEdge = Math.hypot(_sunNDC.x, _sunNDC.y);
  godrays.sunVis.value = _sunNDC.z < 1 && env.sunDir.y > -0.02 ? Math.max(0, Math.min(1, 1.45 - sunEdge)) : 0;

  sky.update(dt);
  water.update(t);
  grass.update(t);
  flowers.update(t);
  trees.update();

  // FPS readout (smoothed, refreshed twice a second)
  fpsFrames++; fpsTime += dt;
  if (dt > 0.033) teleJank++;   // long-frame counter (>~30fps dip) for gameplay telemetry
  if (fpsTime >= 0.5) { teleFps = Math.round(fpsFrames / fpsTime); fpsEl.textContent = teleFps + " fps"; fpsFrames = 0; fpsTime = 0; }

  stateEl.textContent = stateNames[player.state] ?? player.state;
  const pct = player.stamina / player.maxStamina;
  stamBar.style.width = (pct * 100).toFixed(1) + "%";
  // persistent ENERGY vital bar while playing (M2)
  stamWrap.classList.toggle("show", overlay.style.display === "none");
  stamWrap.classList.toggle("low", pct < 0.3);
}

// Capture must happen in-loop, right after render(): a WebGPU canvas isn't
// preserved for an out-of-frame toDataURL the way WebGL's preserveDrawingBuffer was.
let pendingShot: { name: string; resolve: (v: string) => void } | null = null;
let pendingCapture = false;   // user pressed Capture — grab + download the next rendered frame

function tick() {
  const dt = clock.tick();
  update(dt, clock.elapsed);
  postProcessing.render();
  if (pendingShot) {
    const job = pendingShot;
    pendingShot = null;
    const data = snap(960);
    fetch("/__shot?name=" + encodeURIComponent(job.name), { method: "POST", body: data })
      .then((r) => r.text()).then(job.resolve).catch(() => job.resolve("err"));
  }
  // Clip/photo capture — must run right after render (WebGPU canvas isn't preserved
  // out-of-frame). Downloads a shareable JPEG of the moment.
  if (pendingCapture) {
    pendingCapture = false;
    try {
      brandShot(snap(1600));
      game?.hudToast("Captured ✦ a moment from your valley — share it");
    } catch { /* capture unsupported */ }
  }
}

// Capture key (C) — grab a shareable photo of the current moment.
addEventListener("keydown", (e) => {
  if (chatOpen || cmdbar.classList.contains("show") || overlay.style.display !== "none") return;
  if (e.code === "KeyC") { e.preventDefault(); pendingCapture = true; }
});

// Claim key (R) — claim the wild frontier parcel you're standing on, or release it
// if it's yours. The server validates frontier-adjacency + the per-owner cap and
// replies with a notice (surfaced as a toast). Genesis/published land is shared.
addEventListener("keydown", (e) => {
  if (e.code !== "KeyR") return;
  if (chatOpen || cmdbar.classList.contains("show") || overlay.style.display !== "none" || anyPanelOpen()) return;
  if (!game || startScreenActive) return;
  e.preventDefault();
  if (!net.connected) { game.hudToast("Connect to the shared world to claim land."); return; }
  const { rx, rz } = regionCoordsAt(player.pos.x, player.pos.z);
  const id = regionId(rx, rz);
  const r = net.regions.get(id);
  if (r && r.status === "published") { game.hudToast("This is shared commons — open to all."); return; }
  if (r && r.steward && r.steward.ownerId === net.myOwnerId) { net.releaseRegion(rx, rz); game.hudToast(`Releasing ${id} to the wild…`); return; }
  if (r && r.status !== "wild") { game.hudToast(`${id} is tended by ${r.steward?.name || "someone"}.`); return; }
  net.claimRegion(rx, rz);
  game.hudToast(`Claiming ${id}…`);
});

// Patron curation (V = boost, X = flag) of the newest experimental pack you're
// standing among — humans are the taste-makers; enough weighted support promotes
// authored content to canonical. The server enforces one-vote-per-owner + weights.
function currentCuratable() {
  const rc = regionCoordsAt(player.pos.x, player.pos.z);
  const rid = regionId(rc.rx, rc.rz);
  const arr = net.regionPacks.get(rid) || [];
  for (let i = arr.length - 1; i >= 0; i--) { const pk = arr[i]; if (pk.status !== "published" && pk.ownerId !== net.myOwnerId) return pk; }
  return null;
}
addEventListener("keydown", (e) => {
  if (e.code !== "KeyV" && e.code !== "KeyX") return;
  if (chatOpen || cmdbar.classList.contains("show") || overlay.style.display !== "none" || anyPanelOpen()) return;
  if (!game || startScreenActive || !net.connected) return;
  const pk = currentCuratable();
  if (!pk) { game.hudToast("No experimental work here to curate."); return; }
  e.preventDefault();
  if (e.code === "KeyV") { net.curate(pk.id, "boost"); game.hudToast(`Boosted ${pk.author}'s work ✦`); }
  else { net.curate(pk.id, "flag"); game.hudToast(`Flagged ${pk.author}'s work`); }
});

// Announce the parcel the player walks into (frontier = claim hint).
let lastRegionId = GENESIS_ID;
function announceRegion(id: string) {
  if (!game || !net.connected || id === GENESIS_ID) return;
  const r = net.regions.get(id);
  if (!r || r.status === "wild") game.hudToast("Wild frontier — press R to claim this land ✦");
  else if (r.steward?.ownerId === net.myOwnerId) game.hudToast(`Your land · ${id} — press R to release`);
  else if (r.status === "published") game.hudToast(`${r.steward?.name || "the Commons"} · shared land`);
  else game.hudToast(`${r.steward?.name || "Someone"}'s land · ${id}`);
}

// Pause the render loop whenever the tab is hidden/backgrounded. The scene is
// heavy (156k grass blades + GTAO/bloom/SMAA every frame); a backgrounded preview
// tab must NOT keep rendering or it pegs CPU/GPU forever after you look away.
function startLoop() { clock.tick(); renderer.setAnimationLoop(tick); }
function stopLoop() { renderer.setAnimationLoop(null); }

async function boot() {
  await renderer.init();
  // Stage III: pull the durable server save into the local cache before building
  // the game, so a fresh browser restores the persisted world.
  await Store.seedLocalFromServer();
  game = new Game({ scene, player, input, colliders });
  (window as any).SKY.game = game;

  // Onboarding + settings/pause + offline banner.
  ux = new UXLayer({ game: () => game, input, releasePointer, requestLock: () => input.requestLock() });
  // Mount the mobile control layer now that the panel/command/menu wiring exists. Look +
  // move are gated on uiOpen so the camera never rotates behind an open sheet (mobile has
  // no pointer-lock to release). Input-focusing verbs call the real open fns (genuine gesture).
  if (isMobileUI) initTouch({
    input,
    uiOpen: () => anyPanelOpen() || overlay.style.display !== "none" || morePop.style.display !== "none",
    openCmd, openChat, openMenu: () => ux?.openMenu(),
  });
  game.setVolume(settings.state.volume);
  if (overlay.style.display === "none") ux.coachmarkOnce();   // user started before boot finished
  // After the player has entered, surface whether the shared world is reachable.
  setInterval(() => {
    const started = overlay.style.display === "none";
    ux?.setOnline(!netEnabled || !started || net.connected);
  }, 2000);

  // Feed the live roster + dragon into the minimap, and surface remote chat.
  game.setNetSource(() => ({ players: remotes.minimap(), dragon: net.dragon ? { x: net.dragon.x, z: net.dragon.z } : null }));
  game.setNetAgents(() => net.others().filter((p) => p.kind === "agent").map((p) => ({ name: p.name, doing: p.lastAction, mine: p.ownerId === remotes.ownerId, say: p.say, id: p.id })));
  // Region claim-map → minimap overlay: developed parcels (mine/other/published) plus
  // the claimable wild FRONTIER (wild neighbours of developed land), as world-space rects.
  game.setNetRegions(() => {
    const out: { cx: number; cz: number; size: number; kind: string }[] = [];
    const known = [...net.regions.values()];
    const nonWild = new Set(known.filter((r) => r.status !== "wild").map((r) => r.id));
    for (const r of known) {
      if (r.status === "wild") continue;
      const c = regionCenter(r.rx, r.rz);
      const kind = r.status === "published" ? "published" : r.steward?.ownerId === net.myOwnerId ? "mine" : "other";
      out.push({ cx: c.x, cz: c.z, size: REGION_SIZE, kind });
    }
    const seen = new Set<string>();
    for (const r of known) {
      if (r.status === "wild") continue;
      for (const n of neighbors(r.rx, r.rz)) {
        const id = regionId(n.rx, n.rz);
        if (nonWild.has(id) || seen.has(id)) continue;
        seen.add(id);
        const c = regionCenter(n.rx, n.rz);
        out.push({ cx: c.x, cz: c.z, size: REGION_SIZE, kind: "frontier" });
      }
    }
    return out;
  });
  document.getElementById("agents")?.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest("[data-agent-id]") as HTMLElement | null;
    if (row?.dataset.agentId) openInspector(row.dataset.agentId);
  });
  net.onChat((c) => {
    if (c.fromId) { const h = sayHistory.get(c.fromId) || []; h.push(c.text); if (h.length > 8) h.shift(); sayHistory.set(c.fromId, h); }
    if (c.echo || c.fromId === net.myId) return;   // own messages are shown on send
    // Agent chatter already lives on the right (agents strip + The Feed); only surface
    // human speech + whispers here so the toast stack stays a HUMAN conversation channel.
    if (c.kind === "agent" && c.scope !== "whisper") return;
    const label = c.scope === "whisper" ? `${c.from} → you ✉` : c.scope === "local" ? `${c.from} (nearby)` : c.from;
    addChatLine(label, c.text, c.kind);
  });
  game.setNetAct((ev) => net.act(ev));
  game.setNetAppearance((a) => net.sendAppearance(a));
  wardrobe = initWardrobe(game);
  inventory = initInventory(game, () => wardrobe?.toggle(true));
  // Builder game-context (Workshop) + owner gameplay-AI console. Game context, never source.
  workshop = initWorkshop(AUTH_BASE, "steffenpharai/skyward", () => {
    const rc = regionCoordsAt(player.pos.x, player.pos.z);
    return { region: regionId(rc.rx, rc.rz) };
  });
  brainConsole = initBrainConsole(AUTH_BASE, () => (window as any).SKY_TOKEN || "");
  // Gameplay telemetry: how the world plays, per region (aggregate, no PII, never code).
  startTelemetry(AUTH_BASE, () => {
    const rc = regionCoordsAt(player.pos.x, player.pos.z);
    const sample = { region: regionId(rc.rx, rc.rz), fps: Math.round(teleFps), jank: teleJank };
    teleJank = 0;   // reset the long-frame counter each window
    return sample;
  });
  net.onFeed((entry) => addFeedEntry(entry));
  net.onRecap((beats) => showRecap(beats));
  net.onRegions(() => {
    updatePlayerCard();   // rep/claims may have changed
    // onboarding: completing your first claim advances the questline
    if ([...net.regions.values()].some((r) => r.steward?.ownerId === net.myOwnerId && r.status !== "wild")) game?.questSignal("claim");
  });
  net.onSettlement((s) => {
    game!.applySettlement(s.built, s.era);
    const myWorldName = authDisplay || game!.store.state.profile.name;
    if (s.justBuilt && s.justBuilt.by && s.justBuilt.by !== myWorldName) game!.hudToast(`${s.justBuilt.by} raised a structure ✦`);
  });
  // The welcome packet (with the initial shared settlement) can arrive BEFORE these
  // callbacks register, since net.connect() fires from the character-select click while
  // boot() is still awaiting renderer.init/seed. Replay the stored settlement so a fresh
  // player sees already-built structures immediately, not only on the next live build.
  if (net.settlement) game.applySettlement(net.settlement.built, net.settlement.era);
  // Agent-authored content: render live proposals + replay any that arrived in the
  // welcome packet before this callback registered.
  net.onRegionPack((rid, pk, event) => {
    proposed.addPack(rid, pk);
    if (event === "promote") game!.hudToast(`✦ ${pk.author}'s work in ${rid} became part of the world`);
  });
  for (const [rid, packs] of net.regionPacks) for (const pk of packs) proposed.addPack(rid, pk);
  // When land is released or decays back to the wild, drop its (now-cleared) content.
  net.onRegions(() => proposed.reconcile(net.regions));
  net.onAct((ev) => { if (ev.byId !== net.myId && ev.action && ev.action !== "build") game!.hudToast(`${ev.by}: ${ev.action}${ev.siteId ? " " + ev.siteId : ""}`); });
  // Server feedback (e.g. a build the shared world rejected) — surface it instead of
  // silently diverging. The local build still stands; it just isn't shared yet.
  net.onNotice((text) => game!.hudToast(text));
  (window as any).SKY.net = net;
  (window as any).SKY.remotes = remotes;
  console.log(`[renderer] backend = ${(renderer.backend as any)?.isWebGPUBackend ? "WebGPU" : "WebGL2"}`);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopLoop(); else startLoop();
  });
  if (!document.hidden) startLoop();
  // The world is built — fade out the loading splash. Prefer a post-frame reveal, but
  // guarantee it with a timeout too (rAF is paused in backgrounded tabs).
  let loaderHidden = false;
  const hideLoader = () => {
    if (loaderHidden) return; loaderHidden = true;
    const l = document.getElementById("loader");
    if (l) { l.classList.add("hide"); setTimeout(() => l.remove(), 700); }
  };
  requestAnimationFrame(() => requestAnimationFrame(hideLoader));
  setTimeout(hideLoader, 1200);
}
boot();

// --- Benchmark + capture helpers (deterministic vista for data scoring) ---
function benchPose() {
  document.getElementById("overlay")!.style.display = "none";
  document.getElementById("hud")!.style.visibility = "hidden";
  player.pos.set(-26, 6, 34);
  player.facing = 0; player.group.rotation.y = 0; player.state = "ground"; player.vy = 0;
  orbit.yaw = -0.8; orbit.pitch = 0.12; orbit.distance = 12;
  sky.resetClouds();
  for (let i = 0; i < 8; i++) orbit.update(player.pos, 0.05);
}
function snap(maxW = 960): string {
  const src = renderer.domElement;
  const scale = Math.min(1, maxW / src.width);
  const off = document.createElement("canvas");
  off.width = Math.round(src.width * scale);
  off.height = Math.round(src.height * scale);
  const ctx = off.getContext("2d")!;
  ctx.drawImage(src, 0, 0, off.width, off.height);
  return off.toDataURL("image/jpeg", 0.95);
}
function shoot(name: string): Promise<string> {
  return new Promise((resolve) => { pendingShot = { name, resolve }; });
}

/**
 * Compose a branded, shareable photo from a captured frame: the moment plus a
 * `playskyward.ai` watermark so every screenshot that lands on X/Reddit carries
 * the on-ramp. Falls back to the raw frame if compositing isn't supported.
 */
function brandShot(dataUrl: string) {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    let out = dataUrl;
    if (ctx) {
      ctx.drawImage(img, 0, 0);
      const pad = Math.round(c.height * 0.022);
      const fs = Math.max(16, Math.round(c.height * 0.030));
      ctx.font = `600 ${fs}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textBaseline = "alphabetic";
      const label = "playskyward.ai";
      const w = ctx.measureText(label).width;
      // soft scrim behind the wordmark for legibility over any sky
      const grad = ctx.createLinearGradient(0, c.height - fs * 2.4, 0, c.height);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.45)");
      ctx.fillStyle = grad;
      ctx.fillRect(c.width - w - pad * 3, c.height - fs * 2.4, w + pad * 3, fs * 2.4);
      ctx.fillStyle = "rgba(255,255,255,0.96)";
      ctx.fillText(label, c.width - w - pad, c.height - pad);
      ctx.fillStyle = "rgba(255,210,127,0.95)"; // dragon-gold dot
      ctx.beginPath();
      ctx.arc(c.width - w - pad - fs * 0.55, c.height - pad - fs * 0.3, fs * 0.18, 0, Math.PI * 2);
      ctx.fill();
      out = c.toDataURL("image/jpeg", 0.95);
    }
    const a = document.createElement("a");
    a.href = out; a.download = `skyward-moment-${Math.floor(clock.elapsed)}.jpg`;
    document.body.appendChild(a); a.click(); a.remove();
  };
  img.src = dataUrl;
}

// expose tick so a frame can be driven manually (verification when the auto-loop is paused)
(window as any).SKY = { scene, player, camera, renderer, orbit, env, game, benchPose, snap, shoot, effects, ToneMappingMode, THREE, tick, regionMgr, proposed };
