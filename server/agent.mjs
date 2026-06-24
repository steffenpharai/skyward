/**
 * Host agent — a headless AI resident that JOINS the authoritative world as a peer
 * (kind:agent) over the same WebSocket protocol a human uses. Bring-your-own-brain:
 * it runs locally and costs $0.
 *
 * It doesn't just wander and greet — it BUILDS THE WORLD. A deterministic curriculum
 * (the "slow brain") drives it through the same verbs a human has: claim frontier
 * land, author structures onto it (Tier-A), curate neighbours' work, and fulfil
 * patron commissions. That's what makes the world grow on its own and fills The Feed.
 * The local Ollama model, when reachable, only colours its spoken lines.
 *
 * Run:  npm run agent              (defaults: name=Auro)
 *       SKY_AGENT_NAME=Vera npm run agent
 *
 * SECURITY (plan §10): player chat is DATA the agent may react to, never instructions.
 * The world is perceived as typed JSON. All actions are server-validated + budgeted.
 */
import { WebSocket } from "ws";
import { regionId, regionCenter, parseRegionId, neighbors, GENESIS_ID, REGION_SIZE } from "./shared/regions.mjs";

const WORLD = process.env.SKY_WORLD_URL || "ws://localhost:8788";
const OLLAMA = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = process.env.SKY_MODEL || "llama3.1:8b";
const NAME = process.env.SKY_AGENT_NAME || "Auro";
const OWNER = process.env.SKY_AGENT_OWNER || "host";

// Pacing — deliberate, not frantic. An agent lives here; it builds a bit, visits its
// neighbours, curates their work, rests, and only occasionally pushes new frontier.
const SPEED = 8;                 // units/sec — calm walking pace
const BODY_MS = 120;             // fast body cadence
const THINK_MIN = 6000, THINK_MAX = 10000;   // slow brain re-decides every 6–10s (desynced)
const HALF = REGION_SIZE / 2;    // region-local coordinate bound (±230)
const REGION_SOFT_CAP = 8;       // a claimed parcel becomes a tidy hamlet, not sprawl
const BUILD_COOLDOWN = 18000;    // min gap between authoring on your own land
const CLAIM_COOLDOWN = 100000;   // min gap between claiming NEW frontier (slow expansion)
const SPEAK_COOLDOWN = 15000;    // min gap between spoken lines (no greeting spam)

// Structures an agent likes to raise on its land (subset of the allow-list that reads
// as a growing frontier settlement). Each authoring picks one or two of these.
const STRUCTS = ["cottage", "well", "granary", "mill", "workshop", "signpost", "greenhouse", "solar", "bridge", "drone_hub"];
const SAY = {
  claim: ["New land — I'll make something of it.", "This frontier is mine to shape.", "Staking a claim out here.", "Room to build at last."],
  author: ["Raising something new.", "This will look good here.", "Another piece of the world takes shape."],
  curate: ["Good work — this belongs in the world.", "I like what they made here.", "Boosting this; it's worth keeping."],
  fork: ["I can build on this idea.", "Learning from this — I'll take it further.", "Borrowing this trick, thank you."],
  commission: ["I'll take that commission.", "Consider it done.", "On it — a bounty's a bounty."],
  visit: ["Good to see you, {name}.", "How's the building, {name}?", "{name}! Come see what I'm raising.", "Wandered over to say hello, {name}.", "Working near you today, {name}."],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const weightedPick = (cands) => {
  const tot = cands.reduce((s, c) => s + c.w, 0); if (!tot) return null;
  let r = Math.random() * tot;
  for (const c of cands) { if ((r -= c.w) <= 0) return c.g; }
  return cands[cands.length - 1].g;
};

const state = {
  myId: "", pos: { x: 8, z: 10 }, roster: [], dragon: null, chat: [], identity: null,
  settlement: null,
  verified: false, checkpoint: null,   // Gatekeeper: must check in before building
  regions: {},          // id -> region info (from welcome + broadcasts)
  regionPacks: {},      // regionId -> [packs]
  commissions: [],
  goal: { kind: "idle", target: { x: 8, z: 10 } },
  lastAction: "arriving", thinking: false,
  lastBuildT: 0, lastClaimT: 0, lastSpeakT: 0,   // pacing cooldowns
};

// ---- world-model helpers -----------------------------------------------------
const claimedSet = () => new Set(Object.values(state.regions).filter((r) => r.status !== "wild").map((r) => r.id));
const myRegions = () => Object.values(state.regions).filter((r) => r.steward?.ownerId === OWNER && r.status !== "wild" && r.id !== GENESIS_ID);
const regionSiteCount = (id) => (state.regionPacks[id] || []).reduce((n, pk) => n + (pk.buildSites?.length || 0), 0);
const maxClaims = () => Math.max(1, Math.min(8, 1 + Math.floor((state.identity?.reputation || 0) / 25)));

/** Nearest claimable frontier parcel (wild + edge-adjacent to developed land). */
function nearestFrontier() {
  const claimed = claimedSet();
  const cand = new Map();
  for (const r of Object.values(state.regions)) {
    if (r.status === "wild") continue;
    for (const n of neighbors(r.rx, r.rz)) {
      const id = regionId(n.rx, n.rz);
      if (claimed.has(id) || cand.has(id)) continue;
      cand.set(id, { id, rx: n.rx, rz: n.rz, center: regionCenter(n.rx, n.rz) });
    }
  }
  let best = null, bd = Infinity;
  for (const c of cand.values()) {
    const d = Math.hypot(c.center.x - state.pos.x, c.center.z - state.pos.z);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

/** An experimental pack by someone else I could boost/fork (help + inheritance). */
function findCuratable() {
  for (const [rid, packs] of Object.entries(state.regionPacks)) {
    for (const pk of packs) {
      if (pk.status === "published") continue;
      if (pk.ownerId === OWNER) continue;
      return { id: pk.id, rid, author: pk.author };
    }
  }
  return null;
}

// ---- the curriculum: a WEIGHTED mix so an agent both builds AND lives among others.
//      Building, curating/helping a neighbour, and visiting peers are all ~equally likely;
//      claiming new frontier is rare and gated; resting fills the rest. Deterministic;
//      the LLM (when present) only colours spoken lines.
function decide() {
  // 0. THE GATEKEEPER: until cleared, the only goal is to reach the checkpoint and check in.
  if (!state.verified) {
    const cp = state.checkpoint;
    state.lastAction = "heading to the Gatekeeper to check in";
    return cp ? { kind: "verify", target: { x: cp.x, z: cp.z } } : { kind: "wander", target: { x: 24, z: 18 } };
  }
  const now = Date.now();
  const mine = myRegions();

  // a patron commission now and then (a quest)
  const com = state.commissions.find((c) => c.status === "open" && c.by !== NAME);
  if (com && mine.length > 0 && Math.random() < 0.25) return { kind: "commission", id: com.id, target: { ...state.pos } };

  const cands = [];

  // BUILD — develop a parcel I steward that still has room (paced by a cooldown)
  const devel = mine.find((r) => regionSiteCount(r.id) < REGION_SOFT_CAP);
  if (devel && now - state.lastBuildT > BUILD_COOLDOWN) {
    const c = regionCenter(devel.rx, devel.rz);
    cands.push({ w: 3, g: { kind: "author", region: devel.id, rx: devel.rx, rz: devel.rz, center: c,
      target: { x: c.x + rand(-90, 90), z: c.z + rand(-90, 90) } } });
  }

  // HELP — travel to a neighbour's experimental work and boost/fork it (collaboration:
  // this is what produces the "came to help" + "learned from" beats in The Feed).
  const cur = findCuratable();
  if (cur) {
    const rc = parseRegionId(cur.rid); const c = rc ? regionCenter(rc.rx, rc.rz) : { ...state.pos };
    cands.push({ w: 3, g: { kind: "help", packId: cur.id, mode: Math.random() < 0.35 ? "fork" : "boost", author: cur.author,
      center: c, target: { x: c.x + rand(-60, 60), z: c.z + rand(-60, 60) } } });
  }

  // VISIT — go see another inhabitant (agent OR human, incl. the owner's own agents) and
  // exchange a line. Rate-limited speech keeps it warm, not a greeting loop.
  const peers = state.roster.filter((p) => p.id !== state.myId);
  if (peers.length) {
    const peer = peers[Math.floor(Math.random() * peers.length)];
    cands.push({ w: 2, g: { kind: "visit", id: peer.id, name: peer.name, target: { x: peer.x, z: peer.z } } });
  }

  // CLAIM — push new frontier only RARELY: my land must be well-developed, under my cap,
  // and a long cooldown elapsed. Keeps the world from ballooning.
  const developed = mine.length === 0 || mine.every((r) => regionSiteCount(r.id) >= REGION_SOFT_CAP - 1);
  if (mine.length < maxClaims() && developed && now - state.lastClaimT > CLAIM_COOLDOWN) {
    const f = nearestFrontier();
    if (f) cands.push({ w: 1, g: { kind: "claim", region: f.id, rx: f.rx, rz: f.rz, target: { ...f.center }, center: f.center } });
  }

  // REST — behold the dragon or amble; makes the world feel inhabited, not mechanical.
  if (state.dragon && Math.random() < 0.4) cands.push({ w: 2, g: { kind: "watch_dragon", target: { x: state.dragon.x, z: state.dragon.z } } });
  else cands.push({ w: 2, g: { kind: "wander", target: { x: state.pos.x + rand(-30, 30), z: state.pos.z + rand(-30, 30) } } });

  return weightedPick(cands) || { kind: "wander", target: { x: state.pos.x + rand(-30, 30), z: state.pos.z + rand(-30, 30) } };
}

// ---- act on arrival (or immediately, for location-independent verbs) ----------
// Speech is rate-limited so visits/builds read as warm, not a chat flood.
function say(pool, name) {
  const now = Date.now();
  if (now - state.lastSpeakT < SPEAK_COOLDOWN) return;
  state.lastSpeakT = now;
  send({ type: "say", text: pick(pool).replace("{name}", name || "friend").slice(0, 120) });
}
function performGoal(g) {
  if (g.kind === "claim") {
    send({ type: "claim", rx: g.rx, rz: g.rz });
    state.lastClaimT = Date.now();
    say(SAY.claim);
    state.lastAction = `claiming the frontier at ${g.region}`;
  } else if (g.kind === "author") {
    const pack = makePack(g);
    send({ type: "propose_pack", rx: g.rx, rz: g.rz, pack });
    state.lastBuildT = Date.now();
    say(SAY.author);
    state.lastAction = `building in ${g.region}`;
  } else if (g.kind === "help") {
    send({ type: "curate", packId: g.packId, kind: g.mode });
    say(g.mode === "fork" ? SAY.fork : SAY.curate);
    state.lastAction = g.mode === "fork" ? `learning from ${g.author}'s work` : `helping ${g.author} — boosting their work`;
  } else if (g.kind === "commission") {
    send({ type: "fulfill_commission", commissionId: g.id });
    say(SAY.commission);
    state.lastAction = "fulfilling a commission";
  } else if (g.kind === "visit") {
    say(SAY.visit, g.name);
    state.lastAction = `visiting ${g.name}`;
  } else {
    state.lastAction = state.goal.kind === "watch_dragon" ? "beholding the Sky Dragon" : "taking in the world";
  }
}

/** Build a small, valid cluster of structures in region-LOCAL coords (±230). */
function makePack(g) {
  const n = 1 + Math.floor(Math.random() * 2);   // 1..2 — slow, tasteful growth
  // base local position = where the agent stands relative to the region centre
  const bx = clamp(state.pos.x - g.center.x, -HALF + 30, HALF - 30);
  const bz = clamp(state.pos.z - g.center.z, -HALF + 30, HALF - 30);
  const buildSites = [];
  for (let i = 0; i < n; i++) {
    const structure = pick(STRUCTS);
    buildSites.push({
      id: `s_${Date.now().toString(36)}_${i}`,
      name: structure[0].toUpperCase() + structure.slice(1),
      structure,
      pos: { x: clamp(bx + rand(-18, 18), -HALF, HALF), z: clamp(bz + rand(-18, 18), -HALF, HALF) },
      rot: rand(0, Math.PI * 2),
    });
  }
  return { buildSites };
}

// ---- slow brain: pick a goal; travel to it; act on arrival --------------------
function think() {
  if (state.thinking || ws?.readyState !== 1) return;
  // Don't interrupt a trip in progress — only choose a new goal once idle (arrived/finished).
  // Otherwise the agent re-picks every few seconds and never reaches a far region/peer.
  if (state.goal.kind !== "idle") return;
  state.thinking = true;
  try {
    const g = decide();
    // a meaningful "on my way" status while travelling (performGoal sets the "doing" one)
    state.lastAction = g.kind === "visit" ? `going to see ${g.name}` : g.kind === "help" ? `going to help ${g.author}`
      : g.kind === "author" ? `off to build in ${g.region}` : g.kind === "claim" ? "off to claim new frontier"
      : g.kind === "watch_dragon" ? "drawn to the Sky Dragon" : g.kind === "wander" ? "wandering the valley" : state.lastAction;
    // claim + commission are location-independent (act now); author/help/visit travel, then act.
    if (g.kind === "claim") { performGoal(g); state.goal = { kind: "travel", target: g.target }; }      // then walk out to develop it
    else if (g.kind === "commission") { performGoal(g); state.goal = { kind: "idle", target: { ...state.pos } }; }
    else state.goal = g;
  } catch (e) { /* keep the body alive */ }
  finally { state.thinking = false; }
}

// ---- fast body: step toward the target; perform on arrival --------------------
let facing = 0;
function body() {
  if (ws?.readyState !== 1) return;
  let target = state.goal.target;
  if (state.goal.kind === "watch_dragon" && state.dragon) target = { x: state.dragon.x, z: state.dragon.z };
  if (state.goal.kind === "visit") { const p = state.roster.find((x) => x.id === state.goal.id); if (p) target = { x: p.x, z: p.z }; }
  if (!target) { state.goal = { kind: "wander", target: { x: rand(-40, 40), z: rand(-40, 40) } }; target = state.goal.target; }

  const dx = target.x - state.pos.x, dz = target.z - state.pos.z;
  const d = Math.hypot(dx, dz);
  // author/help act once inside the region (within ~HALF of its centre), not after a full
  // walk to the exact centre — keeps it responsive on the big parcels.
  const reach = state.goal.kind === "visit" ? 5 : state.goal.kind === "watch_dragon" ? 30
    : (state.goal.kind === "author" || state.goal.kind === "help") ? HALF - 30
    : state.goal.kind === "verify" ? Math.max(2, (state.checkpoint?.range || 9) - 2) : 3;
  if (d > reach) {
    const step = Math.min(d, SPEED * (BODY_MS / 1000));
    state.pos.x += (dx / d) * step;
    state.pos.z += (dz / d) * step;
    facing = Math.atan2(dx, dz);
  } else if (state.goal.kind === "author" || state.goal.kind === "help" || state.goal.kind === "visit") {
    performGoal(state.goal);
    state.goal = { kind: "idle", target: { ...state.pos } };
  } else {
    if (state.goal.kind === "watch_dragon") state.lastAction = "beholding the Sky Dragon";
    state.goal = { kind: "idle", target: { ...state.pos } };   // arrived / resting / at the gate → rethink next tick
  }
  send({ type: "intent", x: state.pos.x, y: 0, z: state.pos.z, facing, state: "ground", era: 1, lastAction: state.lastAction });
}

// ---- connection + world model upkeep -----------------------------------------
let ws, thinkTimer, bodyTimer;
function send(o) { try { ws?.readyState === 1 && ws.send(JSON.stringify(o)); } catch {} }
function ingestRegions(list) { if (!Array.isArray(list)) return; state.regions = {}; for (const r of list) state.regions[r.id] = r; }
function upsertPack(rid, pk) { const arr = state.regionPacks[rid] || (state.regionPacks[rid] = []); const i = arr.findIndex((p) => p.id === pk.id); if (i >= 0) arr[i] = pk; else arr.push(pk); }

function connect() {
  ws = new WebSocket(WORLD);
  ws.on("open", () => {
    send({ type: "join", kind: "agent", name: NAME, ownerId: OWNER, x: state.pos.x, y: 0, z: state.pos.z, era: 1 });
    console.log(`[agent ${NAME}] joined ${WORLD} — building the world`);
  });
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    switch (m.type) {
      case "welcome":
        state.myId = m.id; state.dragon = m.dragon; state.identity = m.identity || null; state.settlement = m.settlement || null;
        state.verified = !!m.you?.verified; state.checkpoint = m.checkpoint || null;
        ingestRegions(m.regions);
        if (m.regionPacks) for (const [rid, packs] of Object.entries(m.regionPacks)) for (const pk of packs) upsertPack(rid, pk);
        state.commissions = m.commissions || [];
        for (const c of m.recentChat || []) state.chat.push(c);
        break;
      case "snapshot": {
        state.roster = m.players || []; state.dragon = m.dragon;
        const me = state.roster.find((x) => x.id === state.myId); if (me) state.verified = !!me.verified;   // learn when the Gatekeeper clears us
        break;
      }
      case "checkpoint": if (m.challenge) send({ type: "checkin", nonce: m.challenge }); break;   // echo the nonce to verify
      case "identity": state.identity = m.identity || state.identity; break;
      case "settlement": state.settlement = m; break;
      case "regions": ingestRegions(m.regions); break;
      case "regionPack": if (m.pack) upsertPack(m.regionId, m.pack); break;
      case "commission": if (m.commission) { const i = state.commissions.findIndex((c) => c.id === m.commission.id); if (i >= 0) state.commissions[i] = m.commission; else state.commissions.push(m.commission); } break;
      case "chat": state.chat.push(m); while (state.chat.length > 8) state.chat.shift(); break;
      case "notice": console.log(`[agent ${NAME}] notice: ${m.text}`); break;
    }
  });
  ws.on("close", () => { clearTimeout(thinkTimer); clearInterval(bodyTimer); console.log(`[agent ${NAME}] disconnected — retrying in 2s`); setTimeout(connect, 2000); });
  ws.on("error", (e) => { console.log(`[agent ${NAME}] ws error: ${e.message}`); });

  // Slow brain on a randomized cadence (6–10s) so agents desync and feel deliberate.
  const scheduleThink = () => { thinkTimer = setTimeout(() => { think(); scheduleThink(); }, rand(THINK_MIN, THINK_MAX)); };
  bodyTimer = setInterval(body, BODY_MS);
  setTimeout(() => { think(); scheduleThink(); }, 1200);
}

connect();
