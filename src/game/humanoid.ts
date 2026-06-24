/**
 * Jointed humanoid rigs for the inhabitants — villagers and helper-robots that
 * actually WALK instead of sliding as rigid statues.
 *
 * Technique (2026, future-proof): procedural forward-kinematics animation. The
 * limbs are separate primitive meshes parented to joint `Group`s (hips, knees,
 * shoulders, elbows, head); a sine-driven parametric gait writes each joint's
 * rotation per frame. This is the correct approach for hard-surface stylized
 * figures — SkinnedMesh + bones would only add rubbery vertex deformation we
 * don't want and skin weights we'd have to hand-author. It mirrors the hero's
 * own rig (player.ts) so settlers move with the same language as the player.
 *
 * The gait phase is advanced by DISTANCE TRAVELLED, not wall-clock time, so the
 * stride is locked to ground motion and feet don't slide (the canonical fix).
 */
import * as THREE from "three";
import { charToon } from "./charToon";
import { buildFace, type FaceRig } from "./face";
import { buildHair } from "./hair";
import { SKIN_TONES, HAIR_DYES, HAIR_STYLES } from "./characters";
import type { EmoteName } from "./agent/brain";

/** The joint pivots a gait drives. All are sub-Groups of the figure root. */
export interface HJoints {
  hips: THREE.Group;          // whole-body pivot (carries the vertical bob)
  torso: THREE.Group;         // lean
  head: THREE.Group;          // look/idle nod
  armL: THREE.Group; armR: THREE.Group;       // shoulder pitch (swing)
  elbowL: THREE.Group; elbowR: THREE.Group;   // forearm bend
  legL: THREE.Group; legR: THREE.Group;       // hip pitch (stride)
  kneeL: THREE.Group; kneeR: THREE.Group;     // shin bend (foot lift)
  hipsY0: number;             // rest height of the hips, for the bob
}

export interface Figure { group: THREE.Group; joints: HJoints; face?: FaceRig; }

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const put = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.position.set(x, y, z); parent.add(m); return m;
};

/** A friendly settler — rounded forms, rim-lit so the silhouette reads. Each
 *  villager draws a distinct skin tone, hair colour and hairstyle from the
 *  wardrobe palettes (deterministic by id) so the town reads as individuals. */
export function makeVillager(id: string): Figure {
  const g = new THREE.Group();
  const h = hash(id);
  const hue = (h % 360) / 360;
  const tunicC = new THREE.Color().setHSL(hue, 0.45, 0.5);
  const skinC = SKIN_TONES[h % 6];   // first 6 are the natural tones (fantasy hues reserved for player wardrobe)
  const hairColor = HAIR_DYES[((h / 7) | 0) % HAIR_DYES.length];
  const hairStyle = HAIR_STYLES[((h / 13) | 0) % HAIR_STYLES.length].id;
  const tunic = charToon(tunicC, { rimColor: 0xfff0d0, rimStrength: 0.36 });
  const tunicDk = charToon(tunicC.clone().multiplyScalar(0.72), { rimColor: 0xfff0d0, rimStrength: 0.36 });
  const skin = charToon(skinC, { rimColor: 0xfff0d0, rimStrength: 0.3 });
  const pants = charToon(new THREE.Color().setHSL((hue + 0.08) % 1, 0.3, 0.34), { rimColor: 0xfff0d0, rimStrength: 0.36 });
  const boots = charToon("#4a3320", { rimColor: 0xfff0d0, rimStrength: 0.36 });

  const hipsY0 = 0.62;
  const hips = new THREE.Group(); hips.position.y = hipsY0; g.add(hips);

  const mkLeg = (sx: number) => {
    const hip = new THREE.Group(); hip.position.set(sx * 0.12, 0, 0); hips.add(hip);
    put(hip, new THREE.CapsuleGeometry(0.105, 0.18, 4, 8), pants, 0, -0.16, 0);              // thigh
    const knee = new THREE.Group(); knee.position.set(0, -0.30, 0); hip.add(knee);
    put(knee, new THREE.CapsuleGeometry(0.092, 0.16, 4, 8), pants, 0, -0.12, 0);             // shin
    put(knee, new THREE.SphereGeometry(0.1, 12, 8), boots, 0, -0.26, 0.04).scale.set(1, 0.78, 1.5); // rounded boot
    return { hip, knee };
  };
  const lg = mkLeg(-1), rg = mkLeg(1);

  // torso: a smooth lathe tunic (flared hem -> waist -> shoulders) — kills the "peg body"
  const torso = new THREE.Group(); hips.add(torso);
  const profile = ([
    [0.30, -0.02], [0.33, 0.06], [0.30, 0.18], [0.27, 0.32], [0.26, 0.44], [0.20, 0.52], [0.12, 0.57],
  ] as [number, number][]).map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 18), tunic); body.castShadow = true; torso.add(body);
  put(torso, new THREE.CylinderGeometry(0.305, 0.30, 0.05, 18), tunicDk, 0, 0.0, 0);          // hem band
  put(torso, new THREE.TorusGeometry(0.23, 0.03, 6, 16), tunicDk, 0, 0.22, 0).rotation.x = Math.PI / 2; // belt

  const mkArm = (sx: number) => {
    const sh = new THREE.Group(); sh.position.set(sx * 0.30, 0.46, 0); sh.rotation.z = sx * 0.1; torso.add(sh);
    put(sh, new THREE.SphereGeometry(0.1, 12, 8), tunic, 0, 0, 0);                            // shoulder cap
    put(sh, new THREE.CapsuleGeometry(0.075, 0.15, 4, 8), tunic, 0, -0.14, 0);                // upper arm
    const elbow = new THREE.Group(); elbow.position.set(0, -0.26, 0); sh.add(elbow);
    put(elbow, new THREE.CapsuleGeometry(0.066, 0.13, 4, 8), tunicDk, 0, -0.1, 0);            // forearm
    put(elbow, new THREE.SphereGeometry(0.075, 10, 8), skin, 0, -0.2, 0);                     // hand
    return { sh, elbow };
  };
  const al = mkArm(-1), ar = mkArm(1);

  // head
  const head = new THREE.Group(); head.position.y = 0.57; torso.add(head);
  put(head, new THREE.CylinderGeometry(0.07, 0.085, 0.1, 10), skin, 0, 0.0, 0);               // neck
  put(head, new THREE.SphereGeometry(0.2, 16, 12), skin, 0, 0.18, 0).scale.set(1, 1.04, 0.96); // head
  const hairMesh = buildHair({ color: hairColor, headR: 0.2, style: hairStyle, fringe: 5 }); hairMesh.position.set(0, 0.18, 0); head.add(hairMesh); // stylized hair
  // expressive face — villagers blink, make eye contact, and react with mood (face.ts)
  const face = buildFace({ head, eyeY: 0.19, eyeZ: 0.18, spacing: 0.082, eyeR: 0.034, skin });

  return { group: g, joints: { hips, torso, head, armL: al.sh, armR: ar.sh, elbowL: al.elbow, elbowR: ar.elbow, legL: lg.hip, legR: rg.hip, kneeL: lg.knee, kneeR: rg.knee, hipsY0 }, face };
}

/** A friendly humanoid helper-robot (Era IV–V inhabitants). Same rig, boxy forms. */
export function makeRobot(id: string): Figure {
  const g = new THREE.Group();
  const hue = (hash(id) % 360) / 360;
  const body = charToon(0xcfd6dd, { rimColor: 0xdfeeff, rimStrength: 0.36 });
  const trim = charToon(new THREE.Color().setHSL(hue, 0.4, 0.45), { rimColor: 0xdfeeff, rimStrength: 0.3 });
  const eye = charToon(0xaff0ff, { rimStrength: 0, emissive: 0x49c6ff, emissiveIntensity: 2.2 });

  const hipsY0 = 0.66;
  const hips = new THREE.Group(); hips.position.y = hipsY0; g.add(hips);

  const mkLeg = (sx: number) => {
    const hip = new THREE.Group(); hip.position.set(sx * 0.15, 0, 0); hips.add(hip);
    put(hip, new THREE.BoxGeometry(0.18, 0.3, 0.22), trim, 0, -0.17, 0);                      // thigh
    const knee = new THREE.Group(); knee.position.set(0, -0.32, 0); hip.add(knee);
    put(knee, new THREE.BoxGeometry(0.16, 0.26, 0.2), body, 0, -0.13, 0);                     // shin
    put(knee, new THREE.BoxGeometry(0.2, 0.1, 0.3), trim, 0, -0.28, 0.04);                    // foot
    return { hip, knee };
  };
  const lg = mkLeg(-1), rg = mkLeg(1);

  const torso = new THREE.Group(); hips.add(torso);
  put(torso, new THREE.CapsuleGeometry(0.28, 0.34, 4, 10), body, 0, 0.22, 0);                 // torso
  put(torso, new THREE.BoxGeometry(0.5, 0.1, 0.45), trim, 0, 0.46, 0);                        // shoulders

  const mkArm = (sx: number) => {
    const sh = new THREE.Group(); sh.position.set(sx * 0.32, 0.44, 0); torso.add(sh);
    put(sh, new THREE.SphereGeometry(0.1, 10, 8), trim, 0, 0, 0);                             // shoulder
    put(sh, new THREE.CapsuleGeometry(0.082, 0.16, 3, 8), trim, 0, -0.15, 0);                 // upper arm
    const elbow = new THREE.Group(); elbow.position.set(0, -0.28, 0); sh.add(elbow);
    put(elbow, new THREE.CapsuleGeometry(0.072, 0.14, 3, 8), body, 0, -0.11, 0);              // forearm
    put(elbow, new THREE.BoxGeometry(0.13, 0.13, 0.13), trim, 0, -0.22, 0);                   // gripper
    return { sh, elbow };
  };
  const al = mkArm(-1), ar = mkArm(1);

  const head = new THREE.Group(); head.position.y = 0.56; torso.add(head);
  put(head, new THREE.CylinderGeometry(0.05, 0.06, 0.08, 8), trim, 0, 0, 0);                  // neck
  put(head, new THREE.BoxGeometry(0.34, 0.3, 0.32), body, 0, 0.18, 0);                        // head
  put(head, new THREE.BoxGeometry(0.36, 0.08, 0.3), eye, 0, 0.2, 0.02);                       // visor
  put(head, new THREE.SphereGeometry(0.04, 6, 6), eye, 0, 0.4, 0);                            // antenna tip
  put(head, new THREE.CylinderGeometry(0.016, 0.016, 0.16, 4), trim, 0, 0.32, 0);             // antenna

  return { group: g, joints: { hips, torso, head, armL: al.sh, armR: ar.sh, elbowL: al.elbow, elbowR: ar.elbow, legL: lg.hip, legR: rg.hip, kneeL: lg.knee, kneeR: rg.knee, hipsY0 } };
}

// ---- the shared gait ------------------------------------------------------

const ease = (o: THREE.Object3D, x: number, y: number, z: number, k: number) => {
  o.rotation.x += (x - o.rotation.x) * k;
  o.rotation.y += (y - o.rotation.y) * k;
  o.rotation.z += (z - o.rotation.z) * k;
};
const easeX = (o: THREE.Object3D, x: number, k: number) => { o.rotation.x += (x - o.rotation.x) * k; };

/**
 * Drive one humanoid's joints. `phase` is the gait phase (advance it by distance
 * travelled while walking); `walkW` in [0,1] blends idle<->walk; `t` is the
 * global clock for idle breathing; `dt` controls the pose-ease rate.
 */
export function animateHumanoid(j: HJoints, phase: number, walkW: number, t: number, dt: number) {
  const k = Math.min(1, dt * 12);
  const w = Math.max(0, Math.min(1, walkW));
  const s = Math.sin(phase), c = Math.sin(phase + Math.PI);
  const amp = 0.6 * w;
  const b = Math.sin(t * 1.6); // idle breathing

  // legs counter-swing; trailing knee bends to lift the foot (rectified sine)
  ease(j.legL, s * amp, 0, 0, k);
  ease(j.legR, c * amp, 0, 0, k);
  easeX(j.kneeL, Math.max(0, -s) * 1.0 * w, k);
  easeX(j.kneeR, Math.max(0, -c) * 1.0 * w, k);

  // arms opposite their same-side leg; idle adds a gentle breathing sway
  ease(j.armL, c * amp * 0.75 + b * 0.04 * (1 - w), 0, -0.12, k);
  ease(j.armR, s * amp * 0.75 + b * 0.04 * (1 - w), 0, 0.12, k);
  easeX(j.elbowL, -0.2 - Math.max(0, c) * 0.4 * w, k);
  easeX(j.elbowR, -0.2 - Math.max(0, s) * 0.4 * w, k);

  // torso counter-rotates a touch; head nods with the stride / breathes when idle
  ease(j.torso, 0, s * 0.08 * w, 0, k);
  ease(j.head, Math.sin(phase * 2) * 0.02 * w + b * 0.03 * (1 - w), 0, 0, k);

  // vertical bob: two per stride while walking (|sin|), gentle breathe when idle
  const hipsY = Math.abs(s) * 0.05 * w + b * 0.012 * (1 - w);
  j.hips.position.y += (j.hipsY0 + hipsY - j.hips.position.y) * k;
}

const EMOTE_DUR: Record<EmoteName, number> = { wave: 1.7, nod: 1.2, cheer: 1.5, bow: 1.5, think: 2.2 };

/**
 * Overlay a named emote on the body, AFTER `animateHumanoid`. Blends the emote pose
 * over the locomotion pose by an in-out envelope (absolute blend → no accumulation
 * fighting the eased walk). Returns false when the emote has finished.
 */
export function emotePose(j: HJoints, name: EmoteName, tt: number): boolean {
  const dur = EMOTE_DUR[name] ?? 1.3;
  if (tt > dur) return false;
  const e = Math.sin(Math.min(1, tt / dur) * Math.PI);            // 0 → 1 → 0
  const blend = (o: THREE.Object3D, ax: "x" | "y" | "z", val: number) => {
    o.rotation[ax] = o.rotation[ax] * (1 - e) + val * e;
  };
  switch (name) {
    case "wave":
      blend(j.armR, "x", -1.5); blend(j.armR, "z", 0.45);
      j.elbowR.rotation.x = j.elbowR.rotation.x * (1 - e) + (-0.5 + Math.sin(tt * 16) * 0.55) * e;
      blend(j.head, "x", -0.05);
      break;
    case "nod":
      j.head.rotation.x = j.head.rotation.x * (1 - e) + Math.sin(tt * 6.5) * 0.22 * e;
      break;
    case "cheer":
      blend(j.armL, "x", -2.5); blend(j.armR, "x", -2.5);
      blend(j.armL, "z", -0.3); blend(j.armR, "z", 0.3);
      blend(j.head, "x", -0.12);
      break;
    case "bow":
      blend(j.torso, "x", 0.55); blend(j.head, "x", 0.25);
      break;
    case "think":
      blend(j.armR, "x", -1.1); blend(j.elbowR, "x", -1.5);
      blend(j.head, "x", 0.12); blend(j.head, "y", -0.18);
      break;
  }
  return true;
}
