/**
 * GameState — the persisted save (localStorage now; server-authoritative in
 * Stage III). A tiny event emitter lets the HUD react to changes without polling.
 */
import type { EraId, ItemId } from "./content/types";

export interface GameState {
  era: EraId;
  inventory: Record<ItemId, number>;
  builtSites: string[];     // completed build-site ids
  fulfilled: string[];      // completed inhabitant request ids
  takenNodes: string[];     // one-shot resource nodes already gathered
  profile: { charId: string; name: string; appearance?: import("./characters").Appearance };
  score: number;
  highScore: number;
  skills: Record<string, number>;                                  // xp per skill
  friendship: Record<string, number>;                             // villager id -> times helped
  crops: { x: number; z: number; plantedAt: number; kind: string }[];  // planted farming
  onboard: number;          // guided-onboarding beat index (0..N; >=N means finished/skipped)
  version: number;
}

const KEY = "skyward.save";
// v2: dropped the linear-era Mars victory (era cap 5→4, removed `won`); old saves
// may carry an era:5 / won state that no longer maps, so bump to discard them.
const VERSION = 2;

// The durable save lives on the AUTHORITATIVE world server (per-account), reached at
// the same host the world WS uses. `window.SKY_API` is the http(s) base (set in
// main.ts); `window.SKY_TOKEN` is the signed-in account token. Empty base = same
// origin (dev). Guests (no token) stay localStorage-only — the server no-ops them.
function remoteUrl(): string { return ((globalThis as any).SKY_API || "") + "/api/state"; }
function authHeaders(): Record<string, string> {
  const t = (globalThis as any).SKY_TOKEN || "";
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function defaultState(): GameState {
  return {
    era: 1, inventory: {}, builtSites: [], fulfilled: [], takenNodes: [],
    profile: { charId: "explorer", name: "Explorer" }, score: 0, highScore: 0,
    skills: {}, friendship: {}, crops: [], onboard: 0,
    version: VERSION,
  };
}

type Listener = (s: GameState) => void;

export class Store {
  state: GameState;
  private subs: Record<string, Set<Listener>> = {};

  constructor() { this.state = this.load(); }

  private load(): GameState {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw) as GameState;
        if (s && s.version === VERSION) return { ...defaultState(), ...s };
      }
    } catch { /* corrupt save — fall through to default */ }
    return defaultState();
  }

  private mirror: Promise<unknown> = Promise.resolve();
  save() {
    const json = JSON.stringify(this.state);
    try { localStorage.setItem(KEY, json); } catch { /* private mode */ }
    // Mirror to the durable server save (Stage III). SERIALISED so rapid saves can't
    // land out of order (a stale state overwriting a newer one) — the last save wins.
    // localStorage is the offline cache; the server is the durable store.
    this.mirror = this.mirror.then(() =>
      fetch(remoteUrl(), { method: "PUT", headers: { "content-type": "application/json", ...authHeaders() }, body: json }).catch(() => {}),
    ).catch(() => {});
  }

  /** Await all pending durable-save mirrors (so a read-after-write is consistent). */
  async flush() { await this.mirror; }

  /** Seed the local cache from the server save before the game is built, so a
   *  fresh browser (empty localStorage) restores the durable server world. */
  static async seedLocalFromServer(): Promise<void> {
    try {
      if (localStorage.getItem(KEY)) return;       // local cache wins when present
      const r = await fetch(remoteUrl(), { headers: authHeaders() });
      if (!r.ok) return;
      const s = await r.json();
      if (s && s.version === VERSION) localStorage.setItem(KEY, JSON.stringify(s));
    } catch { /* server down — start fresh locally */ }
  }

  reset() {
    const hs = this.state.highScore ?? 0;       // a best score survives a new game
    this.state = defaultState();
    this.state.highScore = hs;
    this.save(); this.emit("inventory"); this.emit("state"); this.emit("score");
  }

  on(ev: "inventory" | "state" | "score" | "skills", cb: Listener): () => void {
    (this.subs[ev] ??= new Set()).add(cb);
    return () => this.subs[ev]?.delete(cb);
  }
  private emit(ev: string) { this.subs[ev]?.forEach((cb) => cb(this.state)); }

  /** Award points and track the best score. */
  addScore(n: number) {
    this.state.score += n;
    if (this.state.score > this.state.highScore) this.state.highScore = this.state.score;
    this.save(); this.emit("score");
  }

  /** Current level of a skill (matches addSkillXp's curve: level = √(xp/60)). */
  skillLevel(skill: string): number {
    return Math.floor(Math.sqrt((this.state.skills[skill] ?? 0) / 60));
  }

  /** Train a skill. Returns the new level if it leveled up, else 0. */
  addSkillXp(skill: string, n: number): number {
    const before = Math.floor(Math.sqrt((this.state.skills[skill] ?? 0) / 60));
    this.state.skills[skill] = (this.state.skills[skill] ?? 0) + n;
    const after = Math.floor(Math.sqrt(this.state.skills[skill] / 60));
    this.save(); this.emit("skills");
    return after > before ? after : 0;
  }

  // ---- inventory helpers ----
  count(id: ItemId): number { return this.state.inventory[id] ?? 0; }

  addItem(id: ItemId, n: number) {
    this.state.inventory[id] = this.count(id) + n;
    this.save(); this.emit("inventory");
  }

  /** Spend a cost atomically. Returns false (and changes nothing) if unaffordable. */
  spend(cost: Partial<Record<ItemId, number>>): boolean {
    for (const k in cost) if (this.count(k) < (cost[k] ?? 0)) return false;
    for (const k in cost) this.state.inventory[k] = this.count(k) - (cost[k] ?? 0);
    this.save(); this.emit("inventory");
    return true;
  }

  // ---- node persistence ----
  isNodeTaken(uid: string): boolean { return this.state.takenNodes.includes(uid); }
  markNodeTaken(uid: string) {
    if (!this.isNodeTaken(uid)) { this.state.takenNodes.push(uid); this.save(); }
  }
}
