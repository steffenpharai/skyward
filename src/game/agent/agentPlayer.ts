/**
 * AgentPlayer — an autonomous AI agent that PLAYS the world alongside the human:
 * it has its own avatar, observes the shared world as structured JSON (the same
 * observe() an MCP/WS gateway would serialise), reasons about a goal, navigates,
 * gathers resources, and helps build the town. Stage-IV "agents create characters
 * and play", running locally; the networked gateway is the same loop over HTTP/WS.
 *
 * Planning is LLM-driven (the local Ollama model picks the next goal from the
 * world state through the AgentWorld seam) with a deterministic planner as a
 * robust fallback — the "slow brain". Movement is the 60fps "fast body".
 */
import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { heightAt } from "../../core/noise";
import { USE_LLM, BRAIN_MODEL } from "./config";

export interface AgentWorld {
  observe(): any;
  count(item: string): number;
  nearestNodePos(item: string, from: THREE.Vector3): THREE.Vector3 | null;
  sitePos(id: string): { x: number; z: number } | null;
  gatherNear(pos: THREE.Vector3): { item: string; amount: number } | null;
  build(siteId: string): boolean;
  beautify(x: number, z: number, by: string): number;   // author a piece of the environment
  plant(x: number, z: number): boolean;                 // sow a crop
}

export type Goal =
  | { kind: "idle" }
  | { kind: "gather"; item: string; target: THREE.Vector3 }
  | { kind: "build"; siteId: string; target: THREE.Vector3 }
  | { kind: "beautify"; target: THREE.Vector3 };

const SPEED = 5;

const AGENT_SYS = `You are an AI builder agent in a cozy, non-combat open world that humans and AI agents build together — an ever-growing settlement that is never finished.
Given the world state, choose ONE next goal as compact JSON and nothing else:
{"goal":"build","siteId":"<id>","say":"..."}  — construct an AFFORDABLE unbuilt site
{"goal":"gather","item":"<item>","say":"..."} — collect a resource an unbuilt site still needs
{"goal":"idle","say":"..."}                    — nothing useful to do right now
Prefer building an affordable site; otherwise gather a resource that an unbuilt site needs and that still has nodes left. "say" is a short in-character line (optional).`;

export class AgentPlayer {
  group = new THREE.Group();
  pos = new THREE.Vector3();
  name: string;
  lastAction = "spawned";
  private goal: Goal = { kind: "idle" };
  private think = 0;
  private planning = false;

  constructor(scene: THREE.Scene, private world: AgentWorld, name: string, start: THREE.Vector3) {
    this.name = name;
    this.pos.copy(start);
    buildAgentAvatar(this.group);
    this.group.position.copy(start);
    scene.add(this.group);
  }

  update(dt: number, t: number) {
    this.think -= dt;
    if (this.think <= 0 && !this.planning) {
      this.planning = true; this.think = 999;            // guard while (async) planning
      this.planAsync()
        .then((g) => { this.goal = g; this.planning = false; this.think = g.kind === "idle" ? 2.5 : 1.2; })
        .catch(() => { this.planning = false; this.think = 2; });
    }

    if (this.goal.kind !== "idle") {
      const tgt = this.goal.target;
      const dx = tgt.x - this.pos.x, dz = tgt.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const reach = this.goal.kind === "build" ? 4 : this.goal.kind === "beautify" ? 2 : 3;
      if (d > reach) {
        const step = Math.min(d, SPEED * dt);
        this.pos.x += (dx / d) * step;
        this.pos.z += (dz / d) * step;
        this.group.rotation.y = Math.atan2(dx, dz);
      } else {
        this.act();
        this.think = 0;                                  // arrived → replan next frame
      }
    }

    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.group.position.set(this.pos.x, this.pos.y + Math.sin(t * 6) * 0.03, this.pos.z);
    const marker = this.group.userData.marker as THREE.Mesh;
    if (marker) marker.rotation.y = t * 2;
  }

  /** Slow brain: ask the LLM for a goal, fall back to the deterministic planner. */
  private async planAsync(): Promise<Goal> {
    const obs = this.world.observe();
    let g: Goal | null = null;
    if (USE_LLM) { const llm = await this.askLLM(obs); g = llm && this.resolveGoal(llm, obs); }
    if (!g) g = this.deterministicPlan(obs);
    // Artisan: when there's no build/gather work, shape the environment into beauty.
    if (g.kind === "idle" && Math.random() < 0.75) {
      const ang = Math.random() * Math.PI * 2, r = 5 + Math.random() * 9;
      this.lastAction = "imagining a new piece of the world";
      return { kind: "beautify", target: new THREE.Vector3(this.pos.x + Math.cos(ang) * r, 0, this.pos.z + Math.sin(ang) * r) };
    }
    return g;
  }

  /** Direct order from the player / MCP (natural-language commands route here). */
  assignCommand(goal: Goal) { this.goal = goal; this.think = 1.2; this.planning = false; }

  private async askLLM(obs: any): Promise<any | null> {
    try {
      const unbuilt = obs.buildSites.filter((s: any) => !s.built).map((s: any) => ({ id: s.id, name: s.name, cost: s.cost, affordable: s.affordable }));
      const user = JSON.stringify({ era: obs.era, inventory: obs.inventory, resourcesRemaining: obs.resourcesRemaining, unbuilt });
      const apiBase = (globalThis as any).SKY_API || "";
      const r = await fetch(`${apiBase}/api/brain`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: BRAIN_MODEL, system: AGENT_SYS, user }),
      });
      if (!r.ok) return null;
      const g = (await r.json()).intent;
      return g && typeof g.goal === "string" ? g : null;
    } catch { return null; }
  }

  private resolveGoal(llm: any, obs: any): Goal | null {
    if (llm.goal === "build" && llm.siteId) {
      const site = obs.buildSites.find((s: any) => s.id === llm.siteId && !s.built && s.affordable);
      const p = site && this.world.sitePos(site.id);
      if (p) { this.lastAction = `${llm.say ? llm.say + " — " : ""}building ${site.name}`; return { kind: "build", siteId: site.id, target: new THREE.Vector3(p.x, 0, p.z) }; }
    }
    if (llm.goal === "gather" && llm.item) {
      const np = this.world.nearestNodePos(llm.item, this.pos);
      if (np) { this.lastAction = `${llm.say ? llm.say + " — " : ""}gathering ${llm.item}`; return { kind: "gather", item: llm.item, target: np }; }
    }
    if (llm.goal === "idle") { this.lastAction = llm.say || "taking a moment"; return { kind: "idle" }; }
    return null;
  }

  private deterministicPlan(obs: any): Goal {
    const unbuilt = obs.buildSites.filter((s: any) => !s.built);
    if (!unbuilt.length) { this.lastAction = "all built — resting"; return { kind: "idle" }; }
    const site = unbuilt.find((s: any) => s.affordable) ?? unbuilt[0];
    if (site.affordable) {
      const p = this.world.sitePos(site.id);
      if (p) { this.lastAction = `heading to build ${site.name}`; return { kind: "build", siteId: site.id, target: new THREE.Vector3(p.x, 0, p.z) }; }
    }
    const missing = Object.keys(site.cost).find((k) => this.world.count(k) < site.cost[k] && (obs.resourcesRemaining[k] ?? 0) > 0);
    if (missing) {
      const np = this.world.nearestNodePos(missing, this.pos);
      if (np) { this.lastAction = `gathering ${missing} for ${site.name}`; return { kind: "gather", item: missing, target: np }; }
    }
    this.lastAction = "waiting on resources";
    return { kind: "idle" };
  }

  private act() {
    if (this.goal.kind === "gather") {
      const got = this.world.gatherNear(this.pos);
      this.lastAction = got ? `gathered ${got.amount} ${got.item}` : "nothing to gather here";
    } else if (this.goal.kind === "build") {
      const ok = this.world.build(this.goal.siteId);
      this.lastAction = ok ? `built ${this.goal.siteId}!` : `can't build ${this.goal.siteId} yet`;
    } else if (this.goal.kind === "beautify") {
      const fit = this.world.beautify(this.pos.x, this.pos.z, this.name);
      this.lastAction = `shaped the world ✦ ${(fit * 100) | 0}`;
    }
    this.goal = { kind: "idle" };
  }
}

function buildAgentAvatar(g: THREE.Group) {
  const body = new MeshStandardNodeMaterial({ color: 0xcfd6dd, roughness: 0.5, metalness: 0.5 });
  const trim = new MeshStandardNodeMaterial({ color: 0x3a4654, roughness: 0.6, metalness: 0.4 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m;
  };
  add(new THREE.CapsuleGeometry(0.28, 0.7, 4, 10), body, 0, 0.85, 0);
  add(new THREE.BoxGeometry(0.42, 0.34, 0.36), body, 0, 1.5, 0);
  add(new THREE.BoxGeometry(0.46, 0.06, 0.4), trim, 0, 1.45, 0);
  for (const sx of [-0.32, 0.32]) add(new THREE.CapsuleGeometry(0.08, 0.5, 3, 6), trim, sx, 0.9, 0);
  const glowMat = new MeshStandardNodeMaterial({ color: 0x9fe0ff, roughness: 0.3 });
  glowMat.emissive = new THREE.Color(0x49c6ff); (glowMat as any).emissiveIntensity = 2.2;
  const marker = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), glowMat);
  marker.position.y = 1.95;
  g.add(marker);
  g.userData.marker = marker;
}
