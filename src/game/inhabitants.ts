/**
 * Inhabitants — the settlers who make the town feel lived-in. Each is placed
 * from data and driven by an AgentBrain on a slow tick (every few seconds), with
 * the chosen Intent animated at 60fps in between (the slow-brain/fast-body
 * pattern). Today every villager runs a LocalBrain (autonomous, offline); a real
 * LLM/agent brain implements the same interface and drops in unchanged.
 *
 * Talk with E for the scripted request (the human↔agent content seam); the brain
 * adds the autonomous wandering, greeting, and ambient chatter around it. Each
 * villager keeps a small memory stream that colours what it says.
 */
import * as THREE from "three";
import { heightAt } from "../core/noise";
import { makeVillager, makeRobot, animateHumanoid, emotePose, type HJoints } from "./humanoid";
import type { FaceRig, Mood } from "./face";
import type { EmoteName } from "./agent/brain";
import type { Interact } from "./interact";
import type { Store } from "./state";
import type { ContentPack, InhabitantDef } from "./content/types";
import { item } from "./content";
import type { Hud } from "./hud";
import type { AgentBrain, Intent, Observation } from "./agent/brain";
import { makeBrain } from "./agent/config";
import { MemoryStore } from "./agent/memory";

type Req = { wants: string; count: number; line: string; thanks: string };

interface Person {
  def: InhabitantDef;
  group: THREE.Group;
  joints: HJoints;       // procedural walk-cycle rig
  face?: FaceRig;        // expressive face (villagers only; robots have a visor)
  ipos: THREE.Vector3;   // live interaction anchor (follows the wandering villager)
  req: Req | null;       // current rotating request (starts as the authored one)
  phase: number;
  brain: AgentBrain;
  memory: MemoryStore;
  intent: Intent;
  brainTimer: number;
  deciding: boolean;
  speakCD: number;
  facing: number;
  prevX: number;         // last-frame position — gait phase advances by distance moved
  prevZ: number;
  walkPhase: number;     // accumulated stride phase (distance-driven, kills foot-slide)
  walkW: number;         // smoothed 0..1 locomotion weight (idle<->walk blend)
  mood: Mood;            // expression the brain last chose
  emote: EmoteName | null;  // active body emote (wave/nod/…)
  emoteT: number;        // seconds into the active emote
  speakUntil: number;    // world-time the dialogue/talk-flap runs until
}

const SPEED = 1.3;

export class Inhabitants {
  group = new THREE.Group();
  private people: Person[] = [];
  private phase = 0;
  private era = 1;
  private lastT = 0;     // last world-time seen in update (for event-time stamping)

  constructor(
    scene: THREE.Scene,
    private store: Store,
    private interact: Interact,
    private hud: Hud,
    private onFulfilled?: (def: InhabitantDef) => void,
  ) {
    this.group.name = "inhabitants";
    scene.add(this.group);
  }

  addPack(pack: ContentPack) {
    for (const def of pack.inhabitants) {
      const fig = def.kind === "robot" ? makeRobot(def.id) : makeVillager(def.id);
      const g = fig.group;
      g.position.set(def.home.x, heightAt(def.home.x, def.home.z), def.home.z);
      this.group.add(g);
      const ipos = g.position.clone().setY(g.position.y + 0.9);
      const person: Person = {
        def, group: g, joints: fig.joints, face: fig.face, ipos, phase: (this.phase += 2.1),
        req: def.request ? { wants: def.request.wants, count: def.request.count, line: def.request.line, thanks: def.request.thanks } : null,
        brain: makeBrain(), memory: new MemoryStore(),
        intent: { kind: "idle", secs: 1 }, brainTimer: Math.random() * 2,
        deciding: false, speakCD: 4, facing: 0,
        prevX: g.position.x, prevZ: g.position.z, walkPhase: Math.random() * 6.28, walkW: 0,
        mood: "neutral", emote: null, emoteT: 0, speakUntil: 0,
      };
      this.people.push(person);

      this.interact.add({
        pos: ipos,   // same Vector3 instance, moved each frame in update()
        radius: 3.0,
        label: () => `Talk to ${def.name} (E)`,
        act: () => this.talk(person),
      });
    }
  }

  /** Structured snapshot of every villager — for the agent observation. */
  snapshot(): { id: string; name: string; x: number; z: number; fulfilled: boolean }[] {
    return this.people.map((p) => ({
      id: p.def.id, name: p.def.name,
      x: +p.group.position.x.toFixed(2), z: +p.group.position.z.toFixed(2),
      fulfilled: this.store.state.fulfilled.includes(p.def.id),
    }));
  }

  /** Current (rotating) villager requests — for the Goals/Needs panel. */
  requests(): { name: string; wants: string; wantsName: string; count: number; have: number; line: string; friendship: number }[] {
    const out = [];
    for (const p of this.people) {
      const r = p.req;
      if (!r) continue;
      out.push({ name: p.def.name, wants: r.wants, wantsName: item(r.wants).name, count: r.count, have: this.store.count(r.wants), line: r.line, friendship: this.store.state.friendship[p.def.id] ?? 0 });
    }
    return out;
  }

  /** Items a villager might ask for, by the eras reached so far (so farming/fishing
   *  outputs — grain, fish — and every gathered material feed the relationship loop). */
  private eraPool(): string[] {
    const E: Record<number, string[]> = { 1: ["grain", "wood", "fiber", "stone", "fish"], 2: ["iron", "wood", "stone"], 3: ["silicon", "iron"], 4: ["alloy", "polymer"] };
    const out = new Set<string>();
    for (let e = 1; e <= this.era; e++) for (const it of (E[e] || [])) out.add(it);
    return [...out];
  }
  private nextRequest(person: Person): Req {
    const pool = this.eraPool();
    const wants = pool[Math.floor(Math.random() * pool.length)] || "wood";
    const fr = this.store.state.friendship[person.def.id] ?? 0;
    const count = 3 + Math.min(4, fr);
    const nm = item(wants).name;
    const lines = [`Could you gather me ${count} ${nm}? It would help us so.`, `We could use ${count} ${nm} around here, if you can spare it.`, `${count} ${nm} would make my week, friend.`];
    return { wants, count, line: lines[Math.floor(Math.random() * lines.length)], thanks: `Bless you — ${count} ${nm}, just what we needed.` };
  }

  /** React on the body+face when the player talks to this villager. */
  private react(person: Person, mood: Mood, emote: EmoteName | null) {
    person.speakUntil = this.lastT + 3.6;     // talk-flap while the bubble is up
    person.mood = mood;
    if (emote && !person.emote) { person.emote = emote; person.emoteT = 0; }
  }

  private talk(person: Person) {
    const def = person.def;
    const req = person.req;
    const fr = this.store.state.friendship[def.id] ?? 0;
    if (!req) {
      this.react(person, "happy", "nod");
      this.hud.dialogue(def.name, fr > 0 ? `Always good to see you, friend. ♥ Lv ${fr}` : "Fine day for the valley, isn't it?");
      return;
    }
    if (this.store.count(req.wants) >= req.count) {
      this.store.spend({ [req.wants]: req.count });
      const nf = fr + 1;
      this.store.state.friendship[def.id] = nf;
      if (!this.store.state.fulfilled.includes(def.id)) this.store.state.fulfilled.push(def.id);   // first-help compat
      this.store.save();
      this.react(person, "happy", "cheer");     // grateful!
      this.hud.dialogue(def.name, `${req.thanks}  ♥ Lv ${nf}`);
      this.remember(person, `The traveler brought me ${req.count} ${item(req.wants).name}.`);
      this.onFulfilled?.(def);
      person.req = this.nextRequest(person);   // a fresh ask — the bond keeps growing
    } else {
      this.react(person, "neutral", null);
      const have = this.store.count(req.wants);
      this.hud.dialogue(def.name, `${req.line}  (${have}/${req.count} ${item(req.wants).name})`);
    }
  }

  private remember(person: Person, ev: string) {
    person.memory.add(ev);
  }

  update(dt: number, t: number, playerPos: THREE.Vector3, ctx: { era: number; builtRatio: number }) {
    this.era = ctx.era;
    for (const p of this.people) {
      const gx = p.group.position.x, gz = p.group.position.z;
      const pdx = playerPos.x - gx, pdz = playerPos.z - gz;
      const pdist = Math.hypot(pdx, pdz);

      // --- slow brain: decide an intent every few seconds ---
      p.brainTimer -= dt;
      if (p.brainTimer <= 0 && !p.deciding) {
        p.deciding = true; p.brainTimer = 999;     // guard re-entry while (maybe async) deciding
        const near = pdist < 14;
        const query = near ? `A traveler is here with me in era ${ctx.era}.` : `Going about my day in era ${ctx.era}.`;
        // semantic recall → brain decision (slow-brain tick)
        p.memory.retrieve(query, 3).then((mems) => {
          const obs: Observation = {
            self: { id: p.def.id, name: p.def.name, pos: { x: gx, z: gz }, home: p.def.home },
            player: near ? { dist: pdist, pos: { x: playerPos.x, z: playerPos.z } } : null,
            era: ctx.era, builtRatio: ctx.builtRatio, memory: mems, t,
          };
          return p.brain.decide(obs);
        }).then((intent) => {
          p.intent = intent;
          p.deciding = false;
          p.brainTimer = intentDuration(intent);
          // realize the brain's expression: mood, an optional body emote, and a
          // talk-flap while a line is on screen (the {emote,mood,gaze} pattern)
          if (intent.mood) p.mood = intent.mood;
          if (intent.emote && !p.emote) { p.emote = intent.emote; p.emoteT = 0; }
          if (intent.say && p.speakCD <= 0 && pdist < 9) {
            this.hud.dialogue(p.def.name, intent.say, 4);
            p.speakUntil = t + 3.8;
            p.speakCD = 12 + Math.random() * 8;
          }
        }).catch(() => { p.deciding = false; p.brainTimer = 2; });
      }
      p.speakCD -= dt;

      // --- fast body: animate the current intent at 60fps ---
      const to = p.intent.kind === "wander" ? p.intent.to : null;
      if (to && Number.isFinite(to.x) && Number.isFinite(to.z)) {
        // clamp the target near home so a model can't fling a villager across the map
        const hx = p.def.home.x, hz = p.def.home.z;
        const cx = hx + Math.max(-10, Math.min(10, to.x - hx));
        const cz = hz + Math.max(-10, Math.min(10, to.z - hz));
        const dx = cx - gx, dz = cz - gz;
        const d = Math.hypot(dx, dz);
        if (d > 0.4) {
          const step = Math.min(d, SPEED * dt);
          p.group.position.x += (dx / d) * step;
          p.group.position.z += (dz / d) * step;
          p.facing = Math.atan2(dx, dz);
        }
      } else if (pdist < 12) {
        p.facing = Math.atan2(pdx, pdz);             // idle/facePlayer near the player → look at them
      }

      // feet planted on the terrain (the bob now lives in the hips, not the root)
      p.group.position.y = heightAt(p.group.position.x, p.group.position.z);
      p.ipos.set(p.group.position.x, p.group.position.y + 0.9, p.group.position.z);  // interaction follows them
      let df = p.facing - p.group.rotation.y;
      df = Math.atan2(Math.sin(df), Math.cos(df));
      p.group.rotation.y += df * Math.min(1, dt * 4);

      // --- procedural walk cycle: gait phase advances by DISTANCE moved (so the
      // stride is locked to ground motion and the feet never slide), and the
      // idle<->walk weight follows the actual ground speed. ---
      const moved = Math.hypot(p.group.position.x - p.prevX, p.group.position.z - p.prevZ);
      p.prevX = p.group.position.x; p.prevZ = p.group.position.z;
      const speed = dt > 1e-4 ? moved / dt : 0;
      const target = Math.min(1, speed / (SPEED * 0.6));         // ~full weight at cruising speed
      p.walkW += (target - p.walkW) * Math.min(1, dt * 8);        // smooth the blend
      p.walkPhase += moved * 3.4;                                 // ~stride per 1.85m travelled
      animateHumanoid(p.joints, p.walkPhase, p.walkW, t + p.phase, dt);

      // body emote (wave / nod / cheer / think) — overlaid on the walk, then expires
      if (p.emote) { p.emoteT += dt; if (!emotePose(p.joints, p.emote, p.emoteT)) p.emote = null; }

      // face: eye contact with the player when nearby (the conversational payoff),
      // the brain's mood (warming to a smile if befriended), and a talk-flap while
      // a line is on screen.
      if (p.face) {
        if (pdist < 11) { _lookAt.set(playerPos.x, playerPos.y + 1.5, playerPos.z); p.face.lookAt(_lookAt); }
        else p.face.lookAt(null);
        const friendly = (this.store.state.friendship[p.def.id] ?? 0) > 0;
        p.face.setMood(p.mood !== "neutral" ? p.mood : (friendly && pdist < 11 ? "happy" : "neutral"));
        p.face.setSpeaking(t < p.speakUntil ? 1 : 0);
        p.face.update(dt, t + p.phase);
      }
    }
    this.lastT = t;
  }
}

const _lookAt = new THREE.Vector3();

function intentDuration(intent: Intent): number {
  // tolerate a model that omits secs
  if (intent.kind === "idle" || intent.kind === "facePlayer") return intent.secs ?? 3;
  return 3 + Math.random() * 2;  // wander: re-decide after a few seconds
}

// Figures (jointed villager / robot rigs) live in ./humanoid — they return a
// { group, joints } pair so the walk cycle can drive the limb pivots.
