/**
 * Game — the orchestrator that ties the gameplay systems to the engine. Built in
 * main.ts and ticked from the render loop's update(). Systems stay small and
 * data-driven; this wires them together, owns the persisted Store, and drives the
 * era progression (loading each era's content pack and easing the atmosphere).
 */
import * as THREE from "three";
import type { Input } from "../core/input";
import type { Player } from "../player/player";
import { env } from "../core/env";
import { Store } from "./state";
import { Interact } from "./interact";
import { Resources } from "./resources";
import { BuildSites } from "./build";
import { Inhabitants } from "./inhabitants";
import { Farm } from "./farm";
import { Eras } from "./era";
import { Hud } from "./hud";
import { Quest } from "./quest";
import type { QuestSignal } from "./quest";
import { AudioEngine } from "./audio";
import { AgentPlayer } from "./agent/agentPlayer";
import type { AgentWorld, Goal } from "./agent/agentPlayer";
import { getPack, packsThrough, nextPack, allItems, validateContentPack, item } from "./content";
import type { ContentPack } from "./content/types";
import type { Structure } from "../world/scatter";
import { TOWN } from "../world/layout";
import { heightAt, LAKE } from "../core/noise";

const FISH = ["silverfin", "river trout", "moonscale", "golden carp", "sunperch"];
import { characterById, appearanceFor, defaultAppearance } from "./characters";
import type { Appearance } from "./characters";
import { itemSkill, skillName } from "./skills";
import { atelier, createBetterOrnament, animateOrnament } from "./agent/atelier";
import { StaminaVessels } from "./vessels";
import type { PlacedOrnament, Genome } from "./agent/atelier";

export interface GameDeps {
  scene: THREE.Scene;
  player: Player;
  input: Input;
  colliders: Structure[];   // shared with Player so built structures become solid
}

export class Game {
  store: Store;
  private interact: Interact;
  private resources: Resources;
  private build: BuildSites;
  private inhabitants: Inhabitants;
  private farm: Farm;
  private vessels: StaminaVessels;
  private eras: Eras;
  private hud: Hud;
  private quest?: Quest;
  private audio = new AudioEngine();
  private input: Input;
  private player: Player;
  private targetSun = 32;
  private scene: THREE.Scene;
  private agents: AgentPlayer[] = [];
  private agentWorld: AgentWorld;
  private hudT = 0;
  private fishing = { active: false, until: 0 };
  private ornGroup = new THREE.Group();
  private ornaments: PlacedOrnament[] = [];
  private agentStyles = new Map<string, Genome>();   // each agent refines its own taste
  private beautyBest = 0;
  /** Live networked players + dragon for the minimap (set from main.ts when online). */
  netSource?: () => { players: { x: number; z: number; kind: string; mine: boolean }[]; dragon: { x: number; z: number } | null };
  setNetSource(fn: Game["netSource"]) { this.netSource = fn; }
  /** Live networked agents for the "AI agents" oversight panel (the spy view). */
  netAgentsFn?: () => { name: string; doing: string; mine?: boolean; say?: string | null; id?: string }[];
  setNetAgents(fn: Game["netAgentsFn"]) { this.netAgentsFn = fn; }
  /** Live region claim-map cells for the minimap overlay (world-space rects). */
  netRegionsFn?: () => { cx: number; cz: number; size: number; kind: string }[];
  setNetRegions(fn: Game["netRegionsFn"]) { this.netRegionsFn = fn; }
  /** Surface remote chat into the dialogue HUD. */
  showChat(name: string, text: string) { this.hud.dialogue(name, text, 5); }
  /** Surface a remote world event as a toast (used by the net layer). */
  hudToast(text: string) { this.hud.toast(text); }

  // --- Sky Dragon commune (P0 payoff): glide near it to gather regenerating
  //     light-motes. Non-combat; doubles as the wordless reveal/trust ritual. ---
  private dragonPos: THREE.Vector3 | null = null;
  private communeCd = 0;
  private communeFelt = false;
  netActFn?: (ev: any) => void;
  setNetAct(fn: (ev: any) => void) { this.netActFn = fn; }
  setDragonPos(p: THREE.Vector3 | null) { this.dragonPos = p; }

  /**
   * Apply the AUTHORITATIVE shared settlement from the server: load content up to the
   * shared era, then construct every site someone has built — so all players see the
   * same world. Idempotent; safe to call on every settlement update + on join.
   */
  applySettlement(built: string[], era: number) {
    // load packs up to the shared era so the sites exist to construct (quiet — no
    // score/banner; this is a sync, not a personal achievement).
    while (this.store.state.era < era) {
      const next = nextPack(this.store.state.era);
      if (!next) break;
      this.store.state.era = next.era.id;
      this.resources.addPack(next);
      this.build.addPack(next);
      this.inhabitants.addPack(next);
      this.eras.setPack(next);
    }
    let changed = false;
    for (const id of built) {
      if (this.store.state.builtSites.includes(id)) continue;
      if (this.build.forceBuild(id)) changed = true;
    }
    if (changed || this.store.state.era !== era) {
      this.store.save();
      this.eras.refresh();
      this.applyEraAtmosphere();
    }
  }
  /** A notable moment worth capturing/sharing (set by the dragon rite); read by the clip system. */
  notableMoment: string | null = null;

  /** Returns a prompt string if currently communing (for the HUD), else null. */
  private updateCommune(dt: number): string | null {
    this.communeCd -= dt;
    if (!this.dragonPos) return null;
    const d = this.player.pos.distanceTo(this.dragonPos);
    if (d > 16) { this.communeFelt = false; return null; }
    // Cooperative rite: any other being (human OR agent) also gathered beneath the dragon
    // makes the light flow twice as bright — a shared human↔agent spectacle (P0/P5).
    const near = this.netSource?.().players ?? [];
    const together = near.some((p) => Math.hypot(p.x - this.dragonPos!.x, p.z - this.dragonPos!.z) < 18);
    if (!this.communeFelt) {
      this.communeFelt = true;
      this.hud.toast(together ? "You reach the Sky Dragon — together ✦" : "You reach the Sky Dragon ✦ a hush of light");
      this.audio.fulfilled();
      this.netActFn?.({ action: "commune" });   // chronicle + reputation (P1/P6)
    }
    if (this.communeCd <= 0) {
      this.communeCd = 1.6;
      this.store.addItem("lightmote", together ? 2 : 1);
      this.store.addScore(together ? 30 : 15);
      this.hud.flash(); this.audio.pickup();
      this.skillXp("foraging", 18);
    }
    // The RITE / sink: offer your gathered light back (F) — a luminous gift that brightens
    // the valley, spends the motes, scores big, and flags a shareable moment.
    const motes = this.store.count("lightmote");
    if (motes >= 12 && this.input.pressed("KeyF")) {
      this.store.spend({ lightmote: motes });
      this.store.addScore(motes * 6);
      this.hud.flash(); this.audio.fulfilled();
      this.hud.toast(`You offer ${motes} light to the Sky Dragon ✦ the valley brightens`);
      this.netActFn?.({ action: "commune" });
      this.notableMoment = together ? "shared the Sky Dragon's light with another soul" : "offered light to the Sky Dragon";
    }
    const offer = motes >= 12 ? "  ·  press F to offer your light ✦" : "";
    return (together ? "Communing together ✦  the light gathers twice as bright" : "Communing with the Sky Dragon ✦  light-motes gathering") + offer;
  }

  constructor(deps: GameDeps) {
    this.player = deps.player;
    this.input = deps.input;
    this.scene = deps.scene;
    this.store = new Store();
    this.interact = new Interact(deps.input);
    this.hud = new Hud();

    this.resources = new Resources(deps.scene, this.store, this.interact, (id, amount) => { this.hud.flash(); this.audio.pickup(); this.store.addScore(amount); this.skillXp(itemSkill(id), amount * 5); this.quest?.signal("gather"); });
    this.build = new BuildSites(deps.scene, this.store, this.interact, deps.colliders, (def) => {
      this.hud.flash();
      this.hud.toast(`${def.name} raised  +25`);
      this.audio.build();
      this.store.addScore(25);
      this.skillXp("building", 40);
      this.eras.refresh();
      this.applyEraAtmosphere();
      this.netActFn?.({ action: "build", siteId: def.id });   // share the build with the world (server-authoritative)
      this.quest?.signal("build");
    });
    this.inhabitants = new Inhabitants(deps.scene, this.store, this.interact, this.hud, (def) => {
      this.hud.flash();
      this.hud.toast(`${def.name} thanks you  +50`);
      this.audio.fulfilled();
      this.store.addScore(50);
    });

    // The seam an AI agent plays through (Stage IV). Same surface a networked
    // MCP/WebSocket gateway would expose to a remote agent.
    this.farm = new Farm(deps.scene, this.store, this.interact, (kind) => {
      this.store.addItem("grain", 3);
      this.hud.flash(); this.hud.toast(`Harvested ${kind} · +3 grain`); this.audio.pickup();
      this.skillXp("farming", 40);
    });

    this.ornGroup.name = "ornaments";
    deps.scene.add(this.ornGroup);

    this.agentWorld = {
      observe: () => this.observe(),
      count: (i) => this.store.count(i),
      nearestNodePos: (i, from) => this.resources.nearestNodePos(i, from),
      sitePos: (id) => this.build.sitePos(id),
      gatherNear: (pos) => this.resources.gatherNearest(pos),
      build: (id) => this.build.buildById(id),
      beautify: (x, z, by) => this.beautify(x, z, by),
      plant: (x, z) => this.farm.plant(x, z) !== null,
    };

    const cur = this.store.state.era;
    this.eras = new Eras(this.store, getPack(cur),
      (name, built, total, ratio) => this.hud.setEra(name, built, total, ratio),
      () => this.advanceEra());

    // Load every era's content up to the saved era (built structures come back finished).
    for (const p of packsThrough(cur)) {
      this.resources.addPack(p);
      this.build.addPack(p);
      this.inhabitants.addPack(p);
    }

    // Atmosphere for the current era.
    this.applyEraAtmosphere();
    env.setSun(this.targetSun);

    // Stamina Vessels on the high peaks — climb to reach them, grow your ceiling.
    this.vessels = new StaminaVessels(deps.scene, this.store, this.player, (bonus, found, total) => {
      this.hud.flash(); this.audio.fulfilled();
      this.hud.toast(`Stamina Vessel ✦ +${bonus} max energy · ${found}/${total} found`);
      this.store.addScore(40);
    });

    const items = allItems();
    this.hud.renderInventory(this.store.state, items);
    this.store.on("inventory", (s) => this.hud.renderInventory(s, items));

    // Apply the saved/selected character + wardrobe appearance to the player figure.
    this.player.applyCharacter(appearanceFor(this.store.state.profile.charId, this.store.state.profile.appearance));

    // Score HUD + initial meter (and auto-advance if a fully-built era was loaded).
    this.hud.setScore(this.store.state.score, this.store.state.highScore);
    this.store.on("score", (s) => this.hud.setScore(s.score, s.highScore));
    this.hud.renderSkills(this.store.state);
    this.store.on("skills", (s) => this.hud.renderSkills(s));
    this.eras.refresh();

    // Guided onboarding questline (MMO-style tutor chain). Online-assumed.
    this.quest = new Quest(this.scene, this.store, this.interact, this.hud);
    document.getElementById("quest")?.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).dataset.q === "skip") this.quest?.skip();
    });
  }

  /** Feed an onboarding signal (gather/build/command come from here; claim/feed from main.ts). */
  questSignal(kind: QuestSignal) { this.quest?.signal(kind); }
  /** The current onboarding waypoint (active tutor) for the compass/minimap, or null. */
  questWaypoint(): { x: number; z: number } | null { return this.quest?.waypoint() ?? null; }
  /** Skip the tutorial (pause menu). */
  skipOnboarding() { this.quest?.skip(); }

  /** Choose a character (from the start screen). Applies the look + saves it. */
  selectCharacter(id: string) {
    const def = characterById(id);
    const appearance = this.store.state.profile.appearance ?? defaultAppearance(def);
    this.store.state.profile = { charId: def.id, name: def.name, appearance };
    this.store.save();
    this.player.applyCharacter(appearance);
  }

  /** Current wardrobe appearance (for the wardrobe UI + net sync). */
  appearance(): Appearance { return appearanceFor(this.store.state.profile.charId, this.store.state.profile.appearance); }
  netAppearanceFn?: (a: Appearance) => void;
  setNetAppearance(fn: (a: Appearance) => void) { this.netAppearanceFn = fn; }
  /** Apply a wardrobe change: re-skin the player, persist, and broadcast to the world. */
  setAppearance(app: Appearance) {
    this.store.state.profile.appearance = app;
    this.store.save();
    this.player.applyCharacter(app);
    this.netAppearanceFn?.(app);
  }

  /** Fired when the current era's build threshold is met — bring on the next era. */
  private advanceEra() {
    const next = nextPack(this.store.state.era);
    if (!next) {
      this.hud.showBanner("This era is complete — more of the valley's future awaits.", 4);
      return;
    }
    this.store.state.era = next.era.id;
    this.store.save();

    this.resources.addPack(next);
    this.build.addPack(next);
    this.inhabitants.addPack(next);
    this.eras.setPack(next);

    this.applyEraAtmosphere();
    this.store.addScore(100);
    this.hud.showBanner(`Era ${next.era.id} · ${next.era.name}\n${next.era.introLine}`, 6);
    this.hud.toast(`Entering the ${next.era.name} era  +100`);
    this.audio.build();
  }

  /** Resolve the current era's sky override (if any) + sun target. */
  private applyEraAtmosphere() {
    const era = getPack(this.store.state.era).era;
    this.targetSun = era.sunElevation;
    env.setOverride(era.sky ?? null);
  }

  update(dt: number, t: number) {
    const cur = this.interact.update(this.player.pos);
    const p = this.player.pos;
    const lakeD = Math.hypot(p.x - LAKE.x, p.z - LAKE.z);
    const commune = this.updateCommune(dt);
    if (commune) {
      this.hud.setPrompt(commune);
    } else if (cur) {
      this.hud.setPrompt(cur.label());
    } else if (this.fishing.active) {
      this.hud.setPrompt("Fishing…  ◍");
      if (t >= this.fishing.until) {
        this.fishing.active = false;
        const f = FISH[Math.floor(Math.random() * FISH.length)];
        this.store.addItem("fish", 1); this.hud.flash(); this.hud.toast(`Caught a ${f}! ✦`); this.audio.fulfilled();
        this.skillXp("fishing", 30);
      }
    } else if (lakeD > LAKE.r - 2 && lakeD < LAKE.r + 5 && this.player.state === "ground") {
      this.hud.setPrompt("Cast a line (E)");
      if (this.input.pressed("KeyE")) { this.fishing.active = true; this.fishing.until = t + 2.5; this.audio.pickup(); }
    } else if (this.farm.plantableAt(p.x, p.z)) {
      this.hud.setPrompt("Plant a crop (E)");
      if (this.input.pressed("KeyE")) {
        const k = this.farm.plant(p.x, p.z);
        if (k) { this.hud.toast(`Planted ${k}`); this.audio.pickup(); this.skillXp("farming", 8); }
      }
    } else this.hud.setPrompt(null);
    this.farm.update();
    this.resources.update(t);
    this.vessels.update(t);
    this.build.update(dt, t);
    this.inhabitants.update(dt, t, this.player.pos, { era: this.store.state.era, builtRatio: this.eras.ratio() });

    // Ease the sky toward the current era's atmosphere.
    if (Math.abs(env.elevation - this.targetSun) > 0.04) {
      const e = env.elevation + (this.targetSun - env.elevation) * Math.min(1, dt * 0.7);
      env.setSun(e);
    }

    for (const a of this.agents) a.update(dt, t);
    for (const o of this.ornaments) animateOrnament(o, t);
    this.quest?.update(dt, t);

    // Throttled HUD: objective, minimap, agent roster (~8/s).
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.12;
      const next = this.build.nextSite(this.player.pos);
      this.hud.setObjective(next ? `Build the ${next.name} — ${next.dist}m` : `${this.eras.eraName()} complete · gather & explore`);
      const net = this.netSource?.();
      this.hud.renderMinimap({
        player: { x: this.player.pos.x, z: this.player.pos.z, facing: this.player.facing },
        sites: this.build.minimapSites(),
        resources: this.resources.minimapPoints(),
        villagers: this.inhabitants.snapshot().map((v) => ({ x: v.x, z: v.z })),
        agents: this.agents.map((a) => ({ x: a.pos.x, z: a.pos.z })),
        netPlayers: net?.players,
        dragon: net?.dragon ?? null,
        regions: this.netRegionsFn?.(),
        waypoint: this.questWaypoint(),
      });
      this.hud.setAgents([...this.agentStatus(), ...(this.netAgentsFn?.() ?? [])]);
    }

    if (this.input.pressed("KeyM")) this.audio.toggleMute();
    this.audio.update(dt, { state: this.player.state, pos: this.player.pos, builtRatio: this.eras.ratio() });
    this.hud.update(dt);
  }

  /**
   * Spawn an autonomous AI agent that plays alongside the human — gathers and
   * helps build the town. Exposed on window.SKY.game.spawnAgent(). Multiple may
   * coexist; this is the local form of the Stage-IV agent-player gateway.
   */
  spawnAgent(name = "Unit-7"): AgentPlayer {
    const sx = TOWN.x + (Math.random() * 8 - 4), sz = TOWN.z + (Math.random() * 8 - 4);
    const agent = new AgentPlayer(this.scene, this.agentWorld, name, new THREE.Vector3(sx, heightAt(sx, sz), sz));
    this.agents.push(agent);
    return agent;
  }

  /** Status line for each live agent (for the HUD / debugging). */
  agentStatus(): { name: string; doing: string }[] {
    return this.agents.map((a) => ({ name: a.name, doing: a.lastAction }));
  }

  /**
   * The Atelier: an agent crafts an ornament that LEARNS from the collective
   * style pool (so the village's beauty rises over time). Returns its fitness.
   */
  beautify(x: number, z: number, by = ""): number {
    const ownBest = by ? this.agentStyles.get(by) ?? null : null;
    const orn = createBetterOrnament(this.ornGroup, x, z, ownBest);
    this.ornaments.push(orn);
    if (by) this.agentStyles.set(by, orn.genome);   // the artisan refines their own taste
    this.store.addScore(Math.round(orn.fitness * 20));
    this.hud.setBeauty(atelier.best(), this.ornaments.length);
    if (orn.fitness > this.beautyBest + 0.008) {
      this.beautyBest = orn.fitness;
      this.hud.toast(`${by || "An artisan"} found a more beautiful design ✦ ${(orn.fitness * 100) | 0}`);
    }
    return orn.fitness;
  }

  /** Beauty stats for the E2E / HUD. */
  beautyStats() { return { best: atelier.best(), poolSize: atelier.size(), count: this.ornaments.length }; }

  /** Train a skill from doing an activity; toast on level-up. */
  skillXp(skill: string, n: number) {
    const lv = this.store.addSkillXp(skill, n);
    if (lv) { this.hud.toast(`${skillName(skill)} Lv ${lv} ✦`); this.audio.fulfilled(); this.store.addScore(20); }
  }

  /**
   * Natural-language command: the player's spoken order is parsed by the local
   * model into a structured goal and assigned to the nearest AI agent (spawning
   * one if needed). Returns a short description. Robust keyword fallback offline.
   */
  async commandAgent(text: string): Promise<string> {
    const p = this.player.pos;
    const obs = this.observe();
    const sys = `Translate the player's spoken order to an AI builder agent into ONE compact JSON command, nothing else:
{"action":"build","siteId":"<id>"} | {"action":"gather","item":"<item>"} | {"action":"beautify","x":<num>,"z":<num>} | {"action":"say","text":"..."}
For "make/grow/plant/beautify/decorate here", action=beautify at the player's position. Resolve site names to ids from the world. Reply with only JSON.`;
    const user = JSON.stringify({ order: text, playerPos: { x: +p.x.toFixed(1), z: +p.z.toFixed(1) }, unbuilt: obs.buildSites.filter((s: any) => !s.built).map((s: any) => ({ id: s.id, name: s.name })), resources: Object.keys(obs.resourcesRemaining) });
    let cmd: any = null;
    const apiBase = (globalThis as any).SKY_API || "";
    try { const r = await fetch(`${apiBase}/api/brain`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ system: sys, user }) }); if (r.ok) cmd = (await r.json()).intent; } catch { /* offline */ }
    if (!cmd || typeof cmd.action !== "string") cmd = keywordParse(text, p);   // offline / unparsed fallback

    // nearest agent (spawn one if the player has no crew yet)
    let agent = this.agents[0] ?? this.spawnAgent("Helper");
    for (const a of this.agents) if (a.pos.distanceTo(p) < agent.pos.distanceTo(p)) agent = a;

    if (cmd.action === "say") { this.hud.dialogue(agent.name, cmd.text || "...", 4); return "say"; }
    const goal = this.cmdToGoal(cmd, p);
    if (goal) {
      agent.assignCommand(goal);
      this.quest?.signal("command");
      const desc = cmd.action === "beautify" ? "creating something beautiful" : cmd.action === "build" ? `building ${cmd.siteId}` : `gathering ${cmd.item}`;
      this.hud.dialogue(agent.name, `On it — ${desc}.`, 4);
      this.hud.toast(`${agent.name}: ${desc}`);
      return desc;
    }
    this.hud.dialogue(agent.name, "I'm not sure how to do that yet.", 3);
    return "unparsed";
  }

  private cmdToGoal(cmd: any, p: THREE.Vector3): Goal | null {
    if (cmd.action === "build" && cmd.siteId) { const s = this.build.sitePos(cmd.siteId); if (s) return { kind: "build", siteId: cmd.siteId, target: new THREE.Vector3(s.x, 0, s.z) }; }
    if (cmd.action === "gather" && cmd.item) { const np = this.resources.nearestNodePos(cmd.item, p); if (np) return { kind: "gather", item: cmd.item, target: np }; }
    if (cmd.action === "beautify") { const x = typeof cmd.x === "number" ? cmd.x : p.x, z = typeof cmd.z === "number" ? cmd.z : p.z; return { kind: "beautify", target: new THREE.Vector3(x, 0, z) }; }
    return null;
  }

  /** Start audio on the first user gesture (called from the click-to-begin overlay). */
  onUserGesture() { this.audio.start(); this.audio.resume(); }

  /** Master volume 0..1 (settings panel). */
  setVolume(v: number) { this.audio.setVolume(v); }
  /** Mute/unmute (settings panel + HUD sound toggle). */
  setMuted(m: boolean) { this.audio.setMuted(m); }
  /** Current mute state (for the HUD sound toggle icon). */
  isMuted() { return this.audio.muted; }
  /** Toggle mute; returns the new state (HUD sound button). */
  toggleMuted() { this.audio.toggleMute(); return this.audio.muted; }

  /**
   * Structured world observation — the Stage-IV foundation: what an AI agent
   * reads to PLAY, as plain JSON (no pixels needed). A networked MCP/WebSocket
   * gateway later just serialises this and exposes the action verbs.
   */
  observe() {
    const cur = this.store.state.era;
    const sites = packsThrough(cur).flatMap((p) => p.buildSites).map((b) => ({
      id: b.id, name: b.name, pos: b.pos, cost: b.cost, structure: b.structure,
      built: this.store.state.builtSites.includes(b.id),
      affordable: Object.keys(b.cost).every((k) => this.store.count(k) >= ((b.cost as any)[k] ?? 0)),
    }));
    const p = this.player;
    return {
      t: +performance.now().toFixed(0),
      era: cur,
      builtRatio: +this.eras.ratio().toFixed(3),
      player: { pos: { x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2) }, state: p.state, stamina: +p.stamina.toFixed(0) },
      inventory: { ...this.store.state.inventory },
      resourcesRemaining: this.resources.remaining(),
      buildSites: sites,
      inhabitants: this.inhabitants.snapshot(),
    };
  }

  /**
   * Accept an agent-proposed content pack (Stage-V Tier-1, data contribution).
   * Validates against the schema, then — on approval — drops it into the live
   * world via the same addPack path the game already uses. In production this is
   * gated behind a human review queue; exposed here for local curation/testing.
   */
  contribute(obj: unknown): { ok: boolean; errors?: string[] } {
    const errors = validateContentPack(obj);
    if (errors.length) return { ok: false, errors };
    const pack = obj as ContentPack;
    this.resources.addPack(pack);
    this.build.addPack(pack);
    this.inhabitants.addPack(pack);
    this.store.addScore(30);
    this.hud.toast(`Agent contribution applied: +${pack.buildSites?.length ?? 0} sites`);
    return { ok: true };
  }

  /**
   * Structured goals for the Goals/Needs panel: the unbuilt sites of the current era
   * with their cost vs. what you carry, plus the villagers' open requests. Surfaces
   * "what can I do right now" without the player hunting the world.
   */
  goals() {
    const cur = this.store.state.era;
    const sites = packsThrough(cur).flatMap((p) => p.buildSites)
      .filter((b) => !this.store.state.builtSites.includes(b.id))
      .map((b) => ({
        id: b.id, name: b.name,
        cost: Object.keys(b.cost).map((k) => ({ item: k, name: item(k).name, color: item(k).color, have: this.store.count(k), need: (b.cost as any)[k] as number })),
        affordable: Object.keys(b.cost).every((k) => this.store.count(k) >= ((b.cost as any)[k] ?? 0)),
      }));
    return { era: cur, eraName: this.eras.eraName(), ratio: this.eras.ratio(), sites, requests: this.inhabitants.requests() };
  }

  /** Wipe the save and reload (dev helper, exposed on window.SKY.game). */
  resetSave() { this.store.reset(); location.reload(); }

  // ---- End-to-end self test: walks the WHOLE workflow and reports per feature.
  //      Run on a FRESH game (clear save + reload first). Exposed as SKY.game.runE2E().
  async runE2E(): Promise<any> {
    const R: { name: string; ok: boolean; detail: string }[] = [];
    const ck = (name: string, ok: any, detail: any = "") => R.push({ name, ok: !!ok, detail: String(detail) });

    // 1. startup screen + character cards
    const cards = document.querySelectorAll("#charselect .char").length;
    ck("startup screen + character cards", cards >= 3, cards + " characters");

    // 2. character selection
    this.selectCharacter("explorer");
    ck("character selection", this.store.state.profile.charId === "explorer", this.store.state.profile.name);

    // 3. gather a resource (+score)
    const pts = this.resources.minimapPoints();
    const s0 = this.store.state.score;
    const got = pts.length ? this.resources.gatherNearest(new THREE.Vector3(pts[0].x, heightAt(pts[0].x, pts[0].z), pts[0].z), 4) : null;
    ck("gather resource + score", got && this.store.state.score > s0, got ? `+${got.amount} ${got.item}` : "no node");

    // 4. inhabitant request fulfilment (real interact path)
    ck("inhabitant request fulfilled", this.testFulfill());

    // 5. build every era's sites → era transitions I→IV (endless world: no victory)
    const erasSeen = new Set<number>([this.store.state.era]);
    for (let guard = 0; guard < 10; guard++) {
      const todo = getPack(this.store.state.era).buildSites.filter((b) => !this.store.state.builtSites.includes(b.id));
      if (!todo.length) break;
      for (const b of todo) { for (const k in b.cost) this.store.addItem(k, (b.cost as any)[k]); this.build.buildById(b.id); }
      erasSeen.add(this.store.state.era);
    }
    ck("era progression I→IV", this.store.state.era === 4 && erasSeen.size >= 4, "eras seen: " + [...erasSeen].join(","));
    ck("all build-sites built", getPack(4).buildSites.every((b) => this.store.state.builtSites.includes(b.id)));
    ck("scoring accrued", this.store.state.score > 300, "score " + this.store.state.score);

    // 6. agent-player
    const a = this.spawnAgent("E2E-Bot");
    this.update(0.1, 1); this.update(0.1, 1.1);
    ck("agent spawned + has status", this.agents.length >= 1 && !!a.lastAction, a.lastAction);

    // 7. agent contribution (Stage V)
    const c = this.contribute({ era: { id: 1, name: "X", sunElevation: 32, advanceAt: 1 }, items: [], nodes: [], buildSites: [{ id: "e2e_site", name: "E2E Site", era: 1, pos: { x: 33, z: 18 }, cost: { wood: 1 }, structure: "signpost" }], inhabitants: [] });
    ck("agent contribution validated+applied", c.ok, JSON.stringify(c).slice(0, 60));

    // 8. HUD render
    this.update(0.13, 2);
    ck("HUD minimap renders", this.miniPainted() > 1000, this.miniPainted() + " px");
    ck("HUD objective set", (document.getElementById("objective")!.textContent || "").length > 2);
    ck("HUD score display", (document.getElementById("score")!.textContent || "").includes("SCORE"));
    ck("HUD agents panel", (document.getElementById("agents")!.textContent || "").includes("E2E-Bot"));
    ck("HUD inventory chips", document.querySelectorAll("#inv .chip").length > 0);

    // 9. persistence (local + server)
    this.store.save();
    const raw = localStorage.getItem("skyward.save");
    ck("persistence (localStorage)", !!raw && JSON.parse(raw!).era === 4);
    // Per-account durable save on the authoritative server (consolidated; the old
    // browser-authority relay is gone). Guests are localStorage-only by design.
    let serverOk = false;
    const apiBase = (globalThis as any).SKY_API || "";
    const token = (globalThis as any).SKY_TOKEN || "";
    if (token) {
      try { await this.store.flush(); serverOk = (await (await fetch(`${apiBase}/api/state`, { headers: { Authorization: `Bearer ${token}` } })).json())?.era === 4; } catch {}
    } else {
      serverOk = true;   // guest: localStorage-only is the intended behavior, not a failure
    }
    ck("persistence (server / per-account)", serverOk);

    const passed = R.filter((r) => r.ok).length;
    return { passed, total: R.length, allPass: passed === R.length, failed: R.filter((r) => !r.ok), results: R };
  }

  private testFulfill(): boolean {
    const defs = packsThrough(this.store.state.era).flatMap((p) => p.inhabitants);
    for (const v of this.inhabitants.snapshot()) {
      if (v.fulfilled) continue;
      const def = defs.find((d) => d.id === v.id);
      if (!def?.request) continue;
      this.store.addItem(def.request.wants, def.request.count);
      this.player.pos.set(v.x, heightAt(v.x, v.z), v.z);
      this.input.keys.add("KeyE");
      this.interact.update(this.player.pos);
      this.input.postUpdate();
      this.input.keys.delete("KeyE");
      if (this.store.state.fulfilled.includes(v.id)) return true;
    }
    return false;
  }

  private miniPainted(): number {
    const mm = document.getElementById("minimap") as HTMLCanvasElement;
    const d = mm.getContext("2d")!.getImageData(0, 0, mm.width, mm.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  }
}

function keywordParse(text: string, p: THREE.Vector3): any {
  const t = text.toLowerCase();
  if (/beautif|garden|grow|plant|decorat|pretty|art|grove|flower|monument|light|pond/.test(t)) return { action: "beautify", x: p.x, z: p.z };
  if (/gather|collect|get|fetch|mine/.test(t)) { const m = t.match(/wood|stone|grain|fiber|iron|silicon|alloy|polymer/); return { action: "gather", item: m ? m[0] : "wood" }; }
  if (/build|raise|construct/.test(t)) return { action: "build" };
  return { action: "say", text: "Hello!" };
}
