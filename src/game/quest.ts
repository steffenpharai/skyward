/**
 * Onboarding questline — an MMO-style guided first run. A chain of TUTOR NPCs, each
 * teaching one part of the player's loop by doing it: walk to the tutor, talk (E),
 * then perform the action they describe. A quest tracker shows the current step and a
 * waypoint points to the active tutor; completing a beat rewards score and advances.
 *
 * The player's real role (humans are patrons/curators; AGENTS author): gather → build
 * → command an agent to build → read The Feed → claim the frontier. Online-assumed.
 *
 * Beats complete via signals (`signal(kind)`): gather/build/command come from the game
 * systems; claim/feed come from the net + HUD handlers in main.ts. Persisted in
 * `state.onboard`; skippable from the tracker or the pause menu.
 */
import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { heightAt } from "../core/noise";
import { TOWN } from "../world/layout";
import type { Interact } from "./interact";
import type { Store } from "./state";
import type { Hud } from "./hud";

export type QuestSignal = "gather" | "build" | "command" | "feed" | "claim";

interface Beat {
  id: string;
  tutor: string;         // functional role name (not invented lore)
  pos: { x: number; z: number };
  intro: string;         // spoken on talk
  hint: string;          // the action objective shown after talking
  signal: QuestSignal;   // the action that completes the beat
  reward: number;
}

// In-town, quick beats first; the frontier claim is the "graduation" that sends a
// trained player out to the real loop.
const BEATS: Beat[] = [
  { id: "gather", tutor: "the Greeter", pos: { x: TOWN.x - 12, z: TOWN.z + 8 }, signal: "gather", reward: 30,
    intro: "Welcome to Skyward! Everything here is built by hand and by AI. Start simple — gather some wood: walk up to a tree or a resource node and press E.",
    hint: "Gather a resource — press E near a tree or glowing node" },
  { id: "build", tutor: "the Builder", pos: { x: TOWN.x - 2, z: TOWN.z + 6 }, signal: "build", reward: 40,
    intro: "Good! Now raise something. Stand at a build-site marker with the materials it needs and press E to build it.",
    hint: "Raise a build-site — gather what it needs, then press E on it" },
  { id: "command", tutor: "the Foreman", pos: { x: TOWN.x + 6, z: TOWN.z - 2 }, signal: "command", reward: 50,
    intro: "Here's the secret of Skyward: the AI agents are the builders. Press T and tell one what to make — try \"make a glowing garden here.\"",
    hint: "Command an agent — press T and type an order (e.g. \"build a well here\")" },
  { id: "feed", tutor: "the Patron", pos: { x: TOWN.x + 2, z: TOWN.z - 8 }, signal: "feed", reward: 40,
    intro: "The world never stops being built. Press H to open The Feed and watch what agents are claiming, building, and helping each other on. You can boost (V) the work you love.",
    hint: "Open The Feed — press H to see the living world" },
  { id: "claim", tutor: "the Steward", pos: { x: TOWN.x + 16, z: TOWN.z + 2 }, signal: "claim", reward: 60,
    intro: "You're ready. Beyond the valley is wild frontier — go stand on unclaimed land and press R to claim a parcel of your own. Then command agents to build it into something.",
    hint: "Claim the frontier — walk to wild land beyond the valley and press R" },
];

export class Quest {
  private group = new THREE.Group();
  private marker: THREE.Group;
  private anchor = new THREE.Vector3();   // live interaction/waypoint anchor (current tutor)
  private armed = false;                  // talked → now waiting on the action
  private removeInteract: () => void;
  private active = true;

  constructor(scene: THREE.Scene, private store: Store, interact: Interact, private hud: Hud) {
    this.group.name = "questline";
    scene.add(this.group);

    // place every tutor figure so the chain reads as a path through town
    for (const b of BEATS) {
      const fig = makeTutor();
      fig.position.set(b.pos.x, heightAt(b.pos.x, b.pos.z), b.pos.z);
      this.group.add(fig);
    }
    this.marker = makeMarker();
    this.group.add(this.marker);

    // one interact entry that follows the CURRENT tutor; only when not yet talked
    this.removeInteract = interact.add({
      pos: this.anchor,
      radius: 3.2,
      label: () => `Talk to ${this.beat()?.tutor ?? "…"} (E)`,
      enabled: () => this.active && !this.armed && !!this.beat(),
      act: () => this.talk(),
    });

    if (this.store.state.onboard >= BEATS.length) { this.finish(false); return; }
    this.syncBeat();
  }

  private beat(): Beat | undefined { return BEATS[this.store.state.onboard]; }

  /** Move marker + interaction anchor to the current tutor; refresh the tracker. */
  private syncBeat() {
    const b = this.beat();
    if (!b) return this.finish(true);
    const y = heightAt(b.pos.x, b.pos.z);
    this.anchor.set(b.pos.x, y + 0.9, b.pos.z);
    this.marker.position.set(b.pos.x, y + 2.5, b.pos.z);
    this.marker.visible = !this.armed;
    this.renderTracker();
  }

  private talk() {
    const b = this.beat(); if (!b) return;
    this.armed = true;
    this.marker.visible = false;
    this.hud.dialogue(b.tutor, b.intro, 7);
    this.renderTracker();
  }

  /** An action happened somewhere in the game — advance if it's what this beat wants. */
  signal(kind: QuestSignal) {
    if (!this.active || !this.armed) return;
    const b = this.beat(); if (!b || b.signal !== kind) return;
    this.store.state.onboard += 1;
    this.store.addScore(b.reward);
    this.store.save();
    this.armed = false;
    const next = this.beat();
    this.hud.toast(next ? `✓ ${b.tutor} — done!  +${b.reward}` : `✓ Tutorial complete  +${b.reward}`);
    if (next) this.syncBeat(); else this.finish(true);
  }

  /** Player skipped onboarding (from the tracker / pause menu). */
  skip() {
    if (!this.active) return;
    this.store.state.onboard = BEATS.length;
    this.store.save();
    this.finish(true);
  }

  private finish(announce: boolean) {
    this.active = false;
    this.armed = false;
    this.removeInteract();
    this.group.visible = false;
    this.hud.setQuest(null);
    if (announce) this.hud.toast("The frontier is yours — go build the world ✦");
  }

  /** Waypoint for the compass/minimap: the active tutor (only while not yet talked). */
  waypoint(): { x: number; z: number } | null {
    if (!this.active || this.armed) return null;
    const b = this.beat(); return b ? { x: b.pos.x, z: b.pos.z } : null;
  }

  isActive() { return this.active; }

  update(_dt: number, t: number) {
    if (!this.active) return;
    this.marker.rotation.y = t * 1.6;
    this.marker.position.y = (this.marker.position.y || 0);   // bob handled below
    const b = this.beat();
    if (b) this.marker.position.y = heightAt(b.pos.x, b.pos.z) + 2.5 + Math.sin(t * 2) * 0.15;
  }

  private renderTracker() {
    const b = this.beat();
    if (!b) { this.hud.setQuest(null); return; }
    const n = this.store.state.onboard + 1, total = BEATS.length;
    const body = this.armed
      ? `<div class="q-do">${b.hint}</div>`
      : `<div class="q-find">Find <b>${b.tutor}</b> — follow the ✦ marker</div>`;
    this.hud.setQuest(
      `<div class="q-head"><span class="q-step">Getting started · ${n}/${total}</span><span class="q-skip" data-q="skip">skip</span></div>${body}`,
    );
  }
}

// ---- a friendly, clearly-special tutor figure (gold-trimmed villager) ----
function makeTutor(): THREE.Group {
  const g = new THREE.Group();
  const robe = new MeshStandardNodeMaterial({ color: "#caa24a", roughness: 0.85 });
  const skin = new MeshStandardNodeMaterial({ color: "#edbd92", roughness: 0.9 });
  const trim = new MeshStandardNodeMaterial({ color: "#fff0c0", roughness: 0.6 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const e = new THREE.Mesh(geo, m); e.position.set(x, y, z); e.castShadow = true; g.add(e); return e;
  };
  add(new THREE.CylinderGeometry(0.28, 0.38, 1.0, 12), robe, 0, 0.78, 0);
  add(new THREE.TorusGeometry(0.3, 0.03, 6, 16), trim, 0, 0.5, 0).rotation.x = Math.PI / 2;
  add(new THREE.SphereGeometry(0.22, 14, 12), skin, 0, 1.45, 0);
  add(new THREE.SphereGeometry(0.235, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), trim, 0, 1.5, 0);
  for (const sx of [-0.34, 0.34]) add(new THREE.CylinderGeometry(0.08, 0.08, 0.7, 7), robe, sx, 0.86, 0).rotation.z = sx > 0 ? 0.14 : -0.14;
  return g;
}

// ---- the floating "talk to me" marker over the active tutor ----
function makeMarker(): THREE.Group {
  const g = new THREE.Group();
  const glow = new MeshStandardNodeMaterial({ color: "#ffe6a8", roughness: 0.3 });
  glow.emissive = new THREE.Color("#ffb43a"); (glow as any).emissiveIntensity = 2.6;
  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), glow);
  diamond.castShadow = false;
  g.add(diamond);
  return g;
}
