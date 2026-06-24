/**
 * Player settings — persisted, observable, applied app-wide. The single source of
 * truth for sensitivity, volume, graphics quality, FPS readout, and reduced motion.
 * Systems either read it directly (camera sensitivity) or subscribe via `on()` and
 * apply on change (main.ts wires renderer quality, audio volume, the FPS readout,
 * and the reduced-motion body class).
 */
export type Quality = "low" | "high";

export interface SettingsState {
  sensitivity: number;   // look-speed multiplier (1 = default)
  volume: number;        // 0..1 master audio
  quality: Quality;      // graphics tier
  showFps: boolean;      // FPS readout (off by default → cozy, decluttered HUD)
  reducedMotion: boolean;
}

const KEY = "skyward.settings";

function detectReducedMotion(): boolean {
  try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

function defaults(): SettingsState {
  return { sensitivity: 1, volume: 0.5, quality: "high", showFps: false, reducedMotion: detectReducedMotion() };
}

type Listener = (s: SettingsState) => void;

class SettingsStore {
  state: SettingsState;
  private subs = new Set<Listener>();

  constructor() {
    this.state = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.state = { ...this.state, ...JSON.parse(raw) };
    } catch { /* ignore corrupt */ }
  }

  /** Merge a partial update, persist, and notify subscribers. */
  set(patch: Partial<SettingsState>) {
    this.state = { ...this.state, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch { /* private mode */ }
    for (const cb of this.subs) cb(this.state);
  }

  /** Subscribe; immediately fires once with the current state so the caller applies it. */
  on(cb: Listener): () => void {
    this.subs.add(cb);
    cb(this.state);
    return () => this.subs.delete(cb);
  }
}

export const settings = new SettingsStore();
