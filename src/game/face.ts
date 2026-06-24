/**
 * FaceRig — a procedural face that makes the character feel ALIVE.
 *
 * Built entirely in code (no morph-target asset authoring), but exposed through a
 * morph-target-style channel interface (blink / gaze / brows / mouth / speak) so a
 * later lip-sync or agent-expression layer drives the same knobs. The features are
 * small meshes parented to the head group; the rig animates them each frame:
 *
 *   • blink     — eyelids close on a randomised timer + whenever gaze changes
 *   • gaze      — eyes (and a clamped head turn) track a world look-target; idle
 *                 micro-saccades when there's nothing to look at
 *   • mood      — brows + mouth shape into neutral/happy/sad/angry/surprised
 *   • speak     — mouth opens with the speaking level (Phase-5 viseme hook)
 *
 * Eyes are sclera + dark iris + a bright EMISSIVE catchlight (the anime "alive
 * eye" trick — the catchlight stays bright even in shadow). Look-at slides the
 * iris+catchlight within the sclera so the gaze reads at distance.
 *
 * `update()` must run AFTER the body animation each frame: it owns `head.rotation.y`
 * (horizontal gaze) while the body animation owns head pitch — different axes, no
 * fight.
 */
import * as THREE from "three";
import { charToon } from "./charToon";

export type Mood = "neutral" | "happy" | "sad" | "angry" | "surprised";

export interface FaceConfig {
  head: THREE.Group;     // head pivot; local +z = forward, +y = up
  eyeY: number;          // eye centre height (head-local)
  eyeZ: number;          // face-front z
  spacing: number;       // eye half-separation (x)
  eyeR: number;          // eye radius
  skin: THREE.Material;  // shared skin material (for the brow ridge tint base)
}

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();

interface Eye { group: THREE.Group; iris: THREE.Mesh; }

export class FaceRig {
  private head: THREE.Group;
  private eyes: Eye[] = [];
  private browL!: THREE.Mesh; private browR!: THREE.Mesh;
  private mouthC!: THREE.Mesh; private mouthL!: THREE.Mesh; private mouthR!: THREE.Mesh;
  private eyeR: number;

  // state
  private blinkTimer: number;
  private blinkPhase = 0;          // 0 = open, 1 = shut (drives a fast envelope)
  private blinking = false;
  private sacTimer = 1.2;
  private gazeX = 0; private gazeY = 0;          // current smoothed gaze (-1..1-ish)
  private gazeTX = 0; private gazeTY = 0;        // target gaze
  private headYaw = 0;                            // smoothed gaze yaw written to head.rotation.y
  private lookTarget: THREE.Vector3 | null = null;
  private mood: Mood = "neutral";
  private moodW = 0;                              // eased 0..1 mood blend
  private speak = 0; private speakSmooth = 0;

  constructor(cfg: FaceConfig) {
    this.head = cfg.head;
    this.eyeR = cfg.eyeR;
    this.blinkTimer = 1.5 + Math.random() * 3;

    const dark = charToon("#23201c", { rimStrength: 0 });
    const sclera = charToon("#f4f1ea", { rimStrength: 0 });
    const brow = charToon("#3a2a20", { rimStrength: 0, flatShading: true });
    const mouth = charToon("#7a4a44", { rimStrength: 0 });

    const put = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = false; parent.add(m); return m;
    };

    for (const sx of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(sx * cfg.spacing, cfg.eyeY, cfg.eyeZ);
      cfg.head.add(g);
      // sclera (white), flattened against the face
      put(new THREE.SphereGeometry(cfg.eyeR, 14, 12), sclera, g).scale.set(1, 1.18, 0.6);
      // dark iris — slides for gaze
      const iris = put(new THREE.SphereGeometry(cfg.eyeR * 0.66, 12, 10), dark, g, 0, 0, cfg.eyeR * 0.5);
      iris.scale.set(1, 1, 0.5);
      // emissive catchlight on the iris (stays bright in shadow → "alive")
      const cl = charToon("#ffffff", { rimStrength: 0, emissive: 0xffffff, emissiveIntensity: 1.6 });
      put(new THREE.SphereGeometry(cfg.eyeR * 0.22, 8, 8), cl, iris, cfg.eyeR * 0.28, cfg.eyeR * 0.3, cfg.eyeR * 0.5);
      this.eyes.push({ group: g, iris });
    }

    // brows — small rounded bars a touch above the eyes (not a heavy mask)
    const browGeo = new THREE.CapsuleGeometry(cfg.eyeR * 0.26, cfg.eyeR * 1.0, 3, 6);
    this.browL = put(browGeo, brow, cfg.head, -cfg.spacing, cfg.eyeY + cfg.eyeR * 1.75, cfg.eyeZ - cfg.eyeR * 0.1);
    this.browR = put(browGeo, brow, cfg.head, cfg.spacing, cfg.eyeY + cfg.eyeR * 1.75, cfg.eyeZ - cfg.eyeR * 0.1);
    this.browL.rotation.z = Math.PI / 2; this.browR.rotation.z = Math.PI / 2;
    this.browL.userData.y0 = this.browL.position.y; this.browR.userData.y0 = this.browR.position.y;

    // mouth — a centre piece + two corners (corners raise to smile / drop to frown)
    const my = cfg.eyeY - cfg.eyeR * 2.6;
    this.mouthC = put(new THREE.BoxGeometry(cfg.eyeR * 1.5, cfg.eyeR * 0.34, cfg.eyeR * 0.4), mouth, cfg.head, 0, my, cfg.eyeZ - cfg.eyeR * 0.2);
    this.mouthL = put(new THREE.BoxGeometry(cfg.eyeR * 0.5, cfg.eyeR * 0.3, cfg.eyeR * 0.4), mouth, cfg.head, -cfg.eyeR * 1.0, my, cfg.eyeZ - cfg.eyeR * 0.2);
    this.mouthR = put(new THREE.BoxGeometry(cfg.eyeR * 0.5, cfg.eyeR * 0.3, cfg.eyeR * 0.4), mouth, cfg.head, cfg.eyeR * 1.0, my, cfg.eyeZ - cfg.eyeR * 0.2);
    this.mouthC.userData.y0 = my; this.mouthL.userData.y0 = my; this.mouthR.userData.y0 = my;
  }

  /** Look at a world point (e.g. the player), or null to relax into idle gaze. */
  lookAt(worldPos: THREE.Vector3 | null) {
    if ((worldPos === null) !== (this.lookTarget === null)) this.triggerBlink(); // blink on gaze shift
    this.lookTarget = worldPos;
  }
  setMood(mood: Mood) { this.mood = mood; }
  /** 0..1 mouth-open for speaking (Phase-5 lip-sync hook). */
  setSpeaking(level: number) { this.speak = Math.max(0, Math.min(1, level)); }

  private triggerBlink() { if (!this.blinking) { this.blinking = true; this.blinkPhase = 0; } }

  update(dt: number, t: number) {
    // ---- blink: fast asymmetric envelope; lids = eye-group scale.y ----
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && !this.blinking) { this.triggerBlink(); this.blinkTimer = 2.2 + Math.random() * 3.5; }
    if (this.blinking) {
      this.blinkPhase += dt / 0.11;                  // ~110ms full blink
      if (this.blinkPhase >= 1) { this.blinking = false; this.blinkPhase = 0; }
    }
    const shut = this.blinking ? Math.sin(Math.min(1, this.blinkPhase) * Math.PI) : 0; // 0→1→0
    const lid = 1 - shut * 0.92;

    // ---- gaze target: a world look-target, else idle micro-saccades ----
    if (this.lookTarget) {
      this.head.getWorldPosition(_v);
      const parent = this.head.parent!;
      parent.updateWorldMatrix(true, false);
      _m.copy(parent.matrixWorld).invert();
      const lt = this.lookTarget.clone().applyMatrix4(_m);     // target in parent-local space
      const dx = lt.x - this.head.position.x, dy = lt.y - this.head.position.y, dz = lt.z - this.head.position.z;
      const yaw = Math.atan2(dx, dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
      this.headYaw += (THREE.MathUtils.clamp(yaw, -0.6, 0.6) - this.headYaw) * Math.min(1, dt * 6);
      this.gazeTX = THREE.MathUtils.clamp(yaw * 1.4, -1, 1);
      this.gazeTY = THREE.MathUtils.clamp(pitch * 1.6, -1, 1);
    } else {
      this.headYaw += (0 - this.headYaw) * Math.min(1, dt * 3);
      this.sacTimer -= dt;
      if (this.sacTimer <= 0) {
        this.gazeTX = (Math.random() * 2 - 1) * 0.5;
        this.gazeTY = (Math.random() * 2 - 1) * 0.3;
        this.sacTimer = 0.6 + Math.random() * 2.2;
      }
    }
    // saccades snap fast; pursuit is smooth
    const gk = Math.min(1, dt * (this.lookTarget ? 8 : 22));
    this.gazeX += (this.gazeTX - this.gazeX) * gk;
    this.gazeY += (this.gazeTY - this.gazeY) * gk;

    this.head.rotation.y = this.headYaw;             // owns horizontal gaze (body owns pitch)

    // apply to eyes: lid squash + iris slide
    const slide = this.eyeR * 0.42;
    for (const e of this.eyes) {
      e.group.scale.y = lid;
      e.iris.position.x = this.gazeX * slide;
      e.iris.position.y = this.gazeY * slide;
    }

    // ---- mood: ease toward the active preset ----
    this.moodW += (1 - this.moodW) * Math.min(1, dt * 4);
    const P = MOOD[this.mood];
    const er = this.eyeR;
    // brows: inner/outer height + tilt
    this.browL.position.y = (this.browL.userData.y0 as number) + P.brow * er;
    this.browR.position.y = (this.browR.userData.y0 as number) + P.brow * er;
    this.browL.rotation.y = -P.browTilt; this.browR.rotation.y = P.browTilt;
    // mouth: corners raise (smile) / drop (frown), centre opens for speak (+ idle breath flutter)
    this.speakSmooth += (this.speak - this.speakSmooth) * Math.min(1, dt * 16);
    const flutter = this.speakSmooth > 0.05 ? (0.6 + 0.4 * Math.sin(t * 22)) : 0;
    const open = this.speakSmooth * flutter;
    this.mouthC.scale.y = 1 + open * 4.5;
    this.mouthL.position.y = (this.mouthL.userData.y0 as number) + P.corner * er;
    this.mouthR.position.y = (this.mouthR.userData.y0 as number) + P.corner * er;
    this.mouthC.position.y = (this.mouthC.userData.y0 as number) + P.corner * er * 0.4;
  }
}

// mood presets — brow lift, brow inner-tilt, mouth-corner lift (units of eyeR)
const MOOD: Record<Mood, { brow: number; browTilt: number; corner: number }> = {
  neutral:   { brow: 0.0,  browTilt: 0.0,  corner: 0.0 },
  happy:     { brow: 0.25, browTilt: 0.0,  corner: 0.55 },
  sad:       { brow: 0.15, browTilt: -0.5, corner: -0.45 },
  angry:     { brow: -0.3, browTilt: 0.6,  corner: -0.2 },
  surprised: { brow: 0.6,  browTilt: 0.0,  corner: 0.1 },
};

/** Build the face features onto a head group and return its rig. */
export function buildFace(cfg: FaceConfig): FaceRig {
  return new FaceRig(cfg);
}
