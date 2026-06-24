import * as THREE from "three";
import { uniform } from "../nodes/tsl";

/**
 * ENV — the single source of truth for lighting, sky and fog.
 *
 * Everything (the directional sun light, the hemisphere/ambient fill, the sky
 * dome, the fog, and every custom TSL material) reads from ONE place. Before
 * this, terrain used PBR while grass/water/foliage hand-rolled magic constants,
 * so they never agreed and a day-night cycle was impossible. Now the whole
 * world is a function of a single sun elevation/azimuth.
 *
 * The palette is interpolated across hand-authored anchors (night -> dusk ->
 * golden -> noon). The default sits at the GOLDEN anchor, calibrated to match
 * the project's established golden-hour look so the migration is visual parity.
 */

interface Anchor {
  el: number;        // sun elevation in degrees
  sun: number;       // sun/key color
  sunI: number;      // directional intensity
  top: number;       // sky zenith
  mid: number;       // sky middle band
  bot: number;       // sky horizon
  fog: number;       // aerial fog color (≈ horizon)
  hemiSky: number;   // hemisphere up color
  hemiGround: number;// hemisphere down (bounce) color
  amb: number;       // flat ambient
  ambI: number;      // ambient intensity
  hemiI: number;     // hemisphere intensity
}

// Calibrated anchors. GOLDEN reproduces the prior look exactly.
const ANCHORS: Anchor[] = [
  { el: -10, sun: 0x223049, sunI: 0.0, top: 0x070b16, mid: 0x111a2e, bot: 0x20293f,
    fog: 0x161d2e, hemiSky: 0x222f48, hemiGround: 0x0e0c08, amb: 0x141f33, ambI: 0.10, hemiI: 0.22 },
  { el: 0,   sun: 0xff8a44, sunI: 1.7, top: 0x2a4a78, mid: 0xb56a48, bot: 0xf0b070,
    fog: 0xd29a72, hemiSky: 0x6a7aa0, hemiGround: 0x3a2c1e, amb: 0x4a3a44, ambI: 0.14, hemiI: 0.36 },
  // GOLDEN (default). Lower sun + much stronger hemi/ambient fill so shadowed
  // PBR surfaces (mountains, trunks, the character's dark side) never crush to
  // black — this replaces the RoomEnvironment IBL fill dropped in the migration.
  { el: 32,  sun: 0xffe6b8, sunI: 2.9, top: 0x3877c0, mid: 0xa6ceea, bot: 0xf0e8cc,
    fog: 0xcfe0ee, hemiSky: 0x9ec4ef, hemiGround: 0x6a5a3e, amb: 0x9fbce0, ambI: 0.34, hemiI: 0.85 },
  { el: 60,  sun: 0xfff6e8, sunI: 3.2, top: 0x2f6fc8, mid: 0xbcdcf0, bot: 0xe8f2f8,
    fog: 0xd6e6f2, hemiSky: 0xb0d4f5, hemiGround: 0x6a5d44, amb: 0xa8c8e8, ambI: 0.36, hemiI: 0.92 },
];

function lerpColor(a: number, b: number, t: number, out: THREE.Color): THREE.Color {
  return out.set(a).lerp(_tmpB.set(b), t);
}
const _tmpB = new THREE.Color();

function evalAnchor(el: number) {
  let lo = ANCHORS[0], hi = ANCHORS[ANCHORS.length - 1];
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    if (el >= ANCHORS[i].el && el <= ANCHORS[i + 1].el) { lo = ANCHORS[i]; hi = ANCHORS[i + 1]; break; }
  }
  if (el <= ANCHORS[0].el) { lo = hi = ANCHORS[0]; }
  if (el >= ANCHORS[ANCHORS.length - 1].el) { lo = hi = ANCHORS[ANCHORS.length - 1]; }
  const t = lo === hi ? 0 : THREE.MathUtils.clamp((el - lo.el) / (hi.el - lo.el), 0, 1);
  return { lo, hi, t };
}

function sunDirection(azimuthDeg: number, elevationDeg: number, out: THREE.Vector3): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  const cosEl = Math.cos(el);
  // direction pointing FROM the scene TOWARD the sun
  return out.set(Math.cos(az) * cosEl, Math.sin(el), Math.sin(az) * cosEl).normalize();
}

export class Env {
  azimuth = 23;     // deg
  elevation = 32;   // deg — GOLDEN by default (matches the prior look)

  // CPU-side resolved values
  sunDir = new THREE.Vector3();
  sunColor = new THREE.Color();
  sunIntensity = 3.9;
  hemiSky = new THREE.Color();
  hemiGround = new THREE.Color();
  hemiIntensity = 0.42;
  ambient = new THREE.Color();
  ambientIntensity = 0.12;
  fogColor = new THREE.Color();
  // Aerial perspective: haze builds across the view for real depth (the BOTW/Sky cue),
  // pulled in from the old 150 — but not so close it hazes out nearby build-site
  // objectives (38 was too aggressive). 55→620 keeps the playable field readable while
  // distant peaks gain atmosphere.
  fogNear = 55;
  fogFar = 620;
  skyTop = new THREE.Color();
  skyMid = new THREE.Color();
  skyBot = new THREE.Color();

  // The actual sun light (set by buildSky) — so self-lit vegetation materials can
  // sample its shadow map via TSL `shadow(env.sunLight)`.
  sunLight: THREE.DirectionalLight | null = null;

  // Optional atmosphere repaint for an era or region. When set, these colours
  // override the sun-elevation palette. Structurally typed to avoid a core→game
  // import; the game passes a SkyOverride.
  private override: {
    top: number; mid: number; bot: number; fog: number;
    hemiSky: number; hemiGround: number; amb: number; sun: number; sunI?: number;
  } | null = null;

  // TSL uniforms — imported directly by every node material.
  // Typed `any`: these are dynamic TSL node objects; @types/three models color
  // uniforms as a distinct type from vec3, which fights honest shader math.
  u: any = {
    sunDir: uniform(new THREE.Vector3(0, 1, 0)),
    sunColor: uniform(new THREE.Color(0xffe6b8)),
    sunIntensity: uniform(3.9),
    hemiSky: uniform(new THREE.Color(0x9ec4ef)),
    hemiGround: uniform(new THREE.Color(0x5a4d34)),
    hemiIntensity: uniform(0.42),
    ambient: uniform(new THREE.Color(0x8fb0d8)),
    ambientIntensity: uniform(0.12),
    fogColor: uniform(new THREE.Color(0xcfe0ee)),
    fogNear: uniform(55),
    fogFar: uniform(620),
    skyTop: uniform(new THREE.Color(0x3877c0)),
    skyMid: uniform(new THREE.Color(0xa6ceea)),
    skyBot: uniform(new THREE.Color(0xf0e8cc)),
    time: uniform(0),
  };

  constructor() { this.recompute(); }

  /** Set the sun angle (drives the whole palette). */
  setSun(elevationDeg: number, azimuthDeg = this.azimuth) {
    this.elevation = elevationDeg;
    this.azimuth = azimuthDeg;
    this.recompute();
  }

  overrideActive = false;
  /** Repaint the atmosphere (era/region skies). null = back to the palette. */
  setOverride(o: typeof this.override) { this.override = o; this.overrideActive = !!o; this.recompute(); }

  recompute() {
    const { lo, hi, t } = evalAnchor(this.elevation);
    sunDirection(this.azimuth, this.elevation, this.sunDir);
    lerpColor(lo.sun, hi.sun, t, this.sunColor);
    this.sunIntensity = THREE.MathUtils.lerp(lo.sunI, hi.sunI, t);
    lerpColor(lo.hemiSky, hi.hemiSky, t, this.hemiSky);
    lerpColor(lo.hemiGround, hi.hemiGround, t, this.hemiGround);
    this.hemiIntensity = THREE.MathUtils.lerp(lo.hemiI, hi.hemiI, t);
    lerpColor(lo.amb, hi.amb, t, this.ambient);
    this.ambientIntensity = THREE.MathUtils.lerp(lo.ambI, hi.ambI, t);
    lerpColor(lo.fog, hi.fog, t, this.fogColor);
    lerpColor(lo.top, hi.top, t, this.skyTop);
    lerpColor(lo.mid, hi.mid, t, this.skyMid);
    lerpColor(lo.bot, hi.bot, t, this.skyBot);

    // Era/region atmosphere override — replaces the elevation palette's colours
    // while the sun angle still drives intensity/shadows.
    if (this.override) {
      const o = this.override;
      this.skyTop.set(o.top); this.skyMid.set(o.mid); this.skyBot.set(o.bot);
      this.fogColor.set(o.fog); this.hemiSky.set(o.hemiSky); this.hemiGround.set(o.hemiGround);
      this.ambient.set(o.amb); this.sunColor.set(o.sun);
      if (o.sunI != null) this.sunIntensity = o.sunI;
    }

    // push to TSL uniforms
    this.u.sunDir.value.copy(this.sunDir);
    this.u.sunColor.value.copy(this.sunColor);
    this.u.sunIntensity.value = this.sunIntensity;
    this.u.hemiSky.value.copy(this.hemiSky);
    this.u.hemiGround.value.copy(this.hemiGround);
    this.u.hemiIntensity.value = this.hemiIntensity;
    this.u.ambient.value.copy(this.ambient);
    this.u.ambientIntensity.value = this.ambientIntensity;
    this.u.fogColor.value.copy(this.fogColor);
    this.u.fogNear.value = this.fogNear;
    this.u.fogFar.value = this.fogFar;
    this.u.skyTop.value.copy(this.skyTop);
    this.u.skyMid.value.copy(this.skyMid);
    this.u.skyBot.value.copy(this.skyBot);
  }

  setTime(t: number) { this.u.time.value = t; }
}

// One shared instance for the whole app.
export const env = new Env();
