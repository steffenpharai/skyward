/**
 * Procedural audio — entirely synthesized via WebAudio, no asset files (matching
 * the project's procedural-everything ethos). One looping wind bed whose cutoff
 * and level track altitude + gliding, footsteps from movement, a low climb-strain
 * drone, a gentle pad that swells as the town grows, and short musical chimes for
 * gather / build / fulfil. Created lazily on the first user gesture (autoplay).
 */
import * as THREE from "three";

export interface AudioInfo {
  state: string;        // 'ground' | 'air' | 'climb' | 'glide'
  pos: THREE.Vector3;
  builtRatio: number;   // 0..1 — how built-up the town is
}

function makeNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private climbGain!: GainNode;
  private lastPos = new THREE.Vector3();
  private stepTimer = 0;
  private havePos = false;
  // Sparse generative ambient melody (soft bells) so the world sings, not hums.
  private musicTimer = 2.5;
  private readonly scale = [440, 493.88, 554.37, 659.25, 739.99, 880, 987.77]; // A-major pentatonic + extensions
  muted = false;
  started = false;

  /** Build the graph + start the loops. Safe to call repeatedly. */
  start() {
    if (this.started) return;
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx: AudioContext = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);

    // wind bed — looping noise through a lowpass
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(ctx, 2);
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windFilter.frequency.value = 560;      // airier than the old 420Hz "hum"
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;   // silent at rest; rises only with altitude/glide
    src.connect(this.windFilter); this.windFilter.connect(this.windGain); this.windGain.connect(this.master);
    src.start();

    // NO ambient pad/drone — the background is a sparse generative MELODY only (see
    // ambientNote + update). Standing still is quiet; the world sings, never hums.

    // climb-strain drone — silent until climbing
    const climbF = ctx.createBiquadFilter();
    climbF.type = "lowpass"; climbF.frequency.value = 200;
    this.climbGain = ctx.createGain(); this.climbGain.gain.value = 0;
    const climbOsc = ctx.createOscillator();
    climbOsc.type = "sawtooth"; climbOsc.frequency.value = 68;
    climbOsc.connect(climbF); climbF.connect(this.climbGain); this.climbGain.connect(this.master);
    climbOsc.start();

    this.started = true;
  }

  resume() { this.ctx?.resume(); }

  private volume = 0.5;   // master level when unmuted (settings-controlled)

  /** Set master volume 0..1 (from the settings panel). Persists across mute toggles. */
  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && !this.muted) this.master.gain.value = this.volume;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }
  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  // ---- one-shot musical cues (pentatonic-ish, pleasant) ----
  private chime(notes: number[], gain: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    let t = ctx.currentTime;
    for (const n of notes) {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = n;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 0.55);
      t += 0.11;
    }
  }
  pickup() { this.chime([659.3], 0.12); }
  build() { this.chime([440, 554.4, 659.3, 880], 0.16); }
  fulfilled() { this.chime([523.3, 659.3, 784], 0.15); }

  /** A single soft, bell-like ambient note (fundamental + octave + fifth shimmer),
   *  panned and warmly filtered with a long, gentle decay. The melodic life. */
  private ambientNote() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    const f = this.scale[Math.floor(Math.random() * this.scale.length)];
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2600;
    const pan = ctx.createStereoPanner(); pan.pan.value = (Math.random() - 0.5) * 0.7;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.05, t + 0.06);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    for (const [mult, lvl, type] of [[1, 1, "sine"], [2, 0.38, "sine"], [1.5, 0.16, "triangle"]] as const) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * mult;
      const og = ctx.createGain(); og.gain.value = lvl;
      o.connect(og); og.connect(env);
      o.start(t); o.stop(t + 2.3);
    }
    env.connect(lp); lp.connect(pan); pan.connect(this.master);
  }

  private footstep() {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = 88 + Math.random() * 30;
    const g = ctx.createGain(); const t = ctx.currentTime;
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.14);
  }

  update(dt: number, info: AudioInfo) {
    if (!this.ctx || this.muted) return;
    const k = (rate: number) => Math.min(1, dt * rate);

    // Wind is silent at rest — it only rises with altitude/gliding as motion feedback,
    // so standing in the meadow is quiet (no constant bed).
    const alt = Math.max(0, Math.min(1, (info.pos.y - 4) / 40));
    const glide = info.state === "glide" ? 0.5 : 0;
    const windTarget = alt * 0.1 + glide;
    this.windGain.gain.value += (windTarget - this.windGain.gain.value) * k(2);
    this.windFilter.frequency.value += (560 + alt * 1400 + glide * 800 - this.windFilter.frequency.value) * k(2);

    // sparse generative ambient melody — soft bells, a little denser as the town grows.
    this.musicTimer -= dt;
    if (this.musicTimer <= 0) {
      this.ambientNote();
      this.musicTimer = Math.max(1.6, 4 + Math.random() * 4 - info.builtRatio * 1.8);
    }

    const climbTarget = info.state === "climb" ? 0.06 : 0;
    this.climbGain.gain.value += (climbTarget - this.climbGain.gain.value) * k(4);

    // footsteps from actual movement
    let speed = 0;
    if (this.havePos) speed = info.pos.distanceTo(this.lastPos) / Math.max(dt, 1e-3);
    this.lastPos.copy(info.pos); this.havePos = true;
    if (info.state === "ground" && speed > 1.5) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) { this.footstep(); this.stepTimer = Math.max(0.27, 0.62 - speed * 0.03); }
    } else {
      this.stepTimer = 0;
    }
  }
}
