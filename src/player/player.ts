import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { Input } from "../core/input";
import { OrbitCamera } from "./camera";
import { heightAt, slopeDeg, normalAt, WORLD } from "../core/noise";
import type { Structure } from "../world/scatter";
import type { CharPalette, Appearance, HatStyle, HairStyle } from "../game/characters";
import { DEFAULT_SKIN, DEFAULT_HAIR } from "../game/characters";
import { charToon } from "../game/charToon";
import { buildFace, type FaceRig } from "../game/face";
import { buildHair } from "../game/hair";
import { Cape } from "../game/cape";

type State = "ground" | "air" | "climb" | "glide";

const GRAVITY = -26;
const WALK = 6.5;
const SPRINT = 11;
const CLIMB_SPEED = 3.4;
const GLIDE_FALL = -2.2;
const GLIDE_SPEED = 9;
const JUMP_V = 9.5;

const CLIMB_ENTER = 50; // deg — surfaces this steep become climbable
const CLIMB_EXIT = 42;  // deg — below this you mantle/stand
const MAX_WALK = 46;    // deg — steeper than this you can't just walk up

export class Player {
  pos = new THREE.Vector3();
  vy = 0;
  state: State = "ground";
  stamina = 100;
  maxStamina = 100;
  facing = 0;

  group = new THREE.Group();
  private glider: THREE.Group;
  private body: THREE.Group;
  private joints: CharJoints;
  private face: FaceRig;
  private cape: Cape | null = null;
  private prevPos = new THREE.Vector3();
  private animPhase = 0;
  private bodyTilt = new THREE.Vector2();   // grounding: x=pitch, y=roll(z), eased
  private prevFacing = 0;
  private prevState: State = "ground";
  private squashT = 0;                        // landing-squash timer
  private colliders: Structure[];
  private climbStruct: Structure | null = null;

  constructor(private input: Input, private camera: OrbitCamera, colliders: Structure[] = [], palette?: CharPalette) {
    this.colliders = colliders;
    const char = makeCharacter(palette);
    this.body = char.group;
    this.joints = char.joints;
    this.face = char.face;
    this.cape = char.cape;
    this.group.add(this.body);
    this.glider = makeGlider();
    this.glider.visible = false;
    this.group.add(this.glider);

    // Spawn on the central meadow.
    const sx = 18, sz = 10;
    this.pos.set(sx, heightAt(sx, sz) + 0.1, sz);
  }

  /** Re-skin the character to a palette or a full appearance (selection / wardrobe). */
  applyCharacter(palette: CharPalette | Appearance) {
    this.group.remove(this.body);
    this.body.traverse((c) => {
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      const mat = (m as any).material;
      if (Array.isArray(mat)) mat.forEach((x) => x?.dispose?.()); else mat?.dispose?.();
    });
    const char = makeCharacter(palette);
    this.body = char.group;
    this.joints = char.joints;
    this.face = char.face;
    this.cape = char.cape;
    this.group.add(this.body);
  }

  private wantMove(): { dir: THREE.Vector3; mag: number } {
    const f = this.camera.forwardFlat();
    const r = this.camera.rightFlat();
    const dir = new THREE.Vector3();
    if (this.input.down("KeyW")) dir.add(f);
    if (this.input.down("KeyS")) dir.sub(f);
    if (this.input.down("KeyD")) dir.add(r);
    if (this.input.down("KeyA")) dir.sub(r);
    const mag = dir.length();
    if (mag > 0) dir.normalize();
    return { dir, mag };
  }

  /** Ground height including standable structure tops (only climbable ones — the tower deck). */
  private groundHeightAt(x: number, z: number): number {
    let h = heightAt(x, z);
    for (const c of this.colliders) {
      if (!c.climb || c.kind !== "cylinder") continue;
      if (Math.hypot(x - c.x, z - c.z) < c.rx && this.pos.y > c.y + c.height - 1.2) h = Math.max(h, c.y + c.height);
    }
    return h;
  }

  /** Push the player out of solid structures; a climbable cylinder triggers a wall-climb. */
  private resolveColliders(dir: THREE.Vector3, mag: number) {
    const R = 0.42;
    for (const c of this.colliders) {
      const top = c.y + c.height;
      if (this.pos.y > top - 0.15) continue; // standing on / above it -> no wall block
      if (c.kind === "cylinder") {
        const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
        const d = Math.hypot(dx, dz) || 1e-3;
        const minD = c.rx + R;
        if (d < minD) {
          // climbable + pressing toward it on foot/air -> scale it
          if (c.climb && mag > 0.1 && (this.state === "ground" || this.state === "air")) {
            const toward = (-dx * dir.x - dz * dir.z) / d; // moving inward?
            if (toward > 0.25 && this.stamina > 5) {
              this.climbStruct = c; this.state = "climb"; this.vy = 0;
              this.pos.x = c.x + (dx / d) * minD; this.pos.z = c.z + (dz / d) * minD;
              return;
            }
          }
          this.pos.x = c.x + (dx / d) * minD; this.pos.z = c.z + (dz / d) * minD;
        }
      } else {
        const lx = this.pos.x - c.x, lz = this.pos.z - c.z;
        const ex = c.rx + R, ez = c.rz + R;
        if (Math.abs(lx) < ex && Math.abs(lz) < ez) {
          if (ex - Math.abs(lx) < ez - Math.abs(lz)) this.pos.x = c.x + Math.sign(lx || 1) * ex;
          else this.pos.z = c.z + Math.sign(lz || 1) * ez;
        }
      }
    }
  }

  update(dt: number) {
    dt = Math.min(dt, 0.05);
    const sprint = this.input.down("ShiftLeft") || this.input.down("ShiftRight");
    const jump = this.input.down("Space");
    const { dir, mag } = this.wantMove();

    const gh = this.groundHeightAt(this.pos.x, this.pos.z);
    const slopeHere = slopeDeg(this.pos.x, this.pos.z);

    switch (this.state) {
      case "ground": this.ground(dt, dir, mag, sprint, jump, gh, slopeHere); break;
      case "air":    this.air(dt, dir, mag, jump, gh, slopeHere); break;
      case "climb":  this.climb(dt, dir, mag, jump, gh, slopeHere); break;
      case "glide":  this.glide(dt, dir, mag, jump, gh); break;
    }

    // structure collision (walls block; a climbable cylinder triggers a wall-climb)
    if (this.state !== "climb") this.resolveColliders(dir, mag);

    // Keep inside the world bounds.
    const lim = WORLD.half - 4;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -lim, lim);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -lim, lim);

    this.group.position.copy(this.pos);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, this.facing, 1 - Math.pow(0.0005, dt));
    this.glider.visible = this.state === "glide";

    this.animate(dt, mag, sprint);
  }

  /** Procedural skeletal animation: idle / walk / run / climb / glide / air. */
  private animate(dt: number, mag: number, sprint: boolean) {
    const j = this.joints;
    const moving = mag > 0.1;
    const t = performance.now() * 0.001;
    const k = Math.min(1, dt * 14); // ease toward target poses

    if (this.state === "ground" && moving) this.animPhase += dt * (sprint ? 13 : 9);
    else if (this.state === "climb") this.animPhase += dt * 5;
    else this.animPhase += dt * 2;

    const s = Math.sin(this.animPhase), c = Math.sin(this.animPhase + Math.PI);
    // target [x,y,z] euler per joint; keL/keR = knee bend, elL/elR = elbow bend (x only)
    let lL = [0, 0, 0], lR = [0, 0, 0], aL = [0, 0, -0.1], aR = [0, 0, 0.1], to = [0, 0, 0], hd = [0, 0, 0], hipsY = 0;
    let keL = 0, keR = 0, elL = -0.22, elR = -0.22; // elbows rest slightly bent

    if (this.state === "ground") {
      if (moving) {
        const amp = sprint ? 0.95 : 0.62;
        lL = [s * amp, 0, 0]; lR = [c * amp, 0, 0];
        aL = [c * amp * 0.8, 0, -0.1]; aR = [s * amp * 0.8, 0, 0.1];
        to = [0, s * 0.1, 0]; hd = [Math.sin(this.animPhase * 2) * 0.03, 0, 0];
        hipsY = Math.abs(s) * 0.05;
        keL = Math.max(0, -s) * 1.05; keR = Math.max(0, -c) * 1.05; // bend the trailing knee (foot lift)
        elL = -0.32 - Math.max(0, c) * 0.5; elR = -0.32 - Math.max(0, s) * 0.5; // elbows bend on forward swing
      } else {
        const b = Math.sin(t * 1.6); // idle breathing
        aL = [b * 0.04, 0, -0.1]; aR = [b * 0.04, 0, 0.1]; hd = [b * 0.03, 0, 0]; hipsY = b * 0.012;
      }
    } else if (this.state === "climb") {
      aL = [-2.3 + s * 0.5, 0, -0.25]; aR = [-2.3 + c * 0.5, 0, 0.25]; // alternating overhead reach
      lL = [c * 0.4, 0, 0]; lR = [s * 0.4, 0, 0]; hd = [0.1, 0, 0];
      keL = 0.6 + Math.max(0, c) * 0.4; keR = 0.6 + Math.max(0, s) * 0.4; elL = -0.8; elR = -0.8; // bent limbs gripping
    } else if (this.state === "glide") {
      aL = [-2.7, 0, -0.35]; aR = [-2.7, 0, 0.35];   // hands up gripping the bar
      lL = [0.25, 0, 0.05]; lR = [0.25, 0, -0.05]; to = [0.35, 0, 0]; hd = [-0.15, 0, 0]; // lean forward
      keL = 0.3; keR = 0.3; elL = -0.55; elR = -0.55;
    } else { // air
      lL = [0.5, 0, 0]; lR = [-0.25, 0, 0]; aL = [-0.7, 0, -0.2]; aR = [-0.7, 0, 0.2];
      keL = 0.7; keR = 0.25; elL = -0.5; elR = -0.5;
    }

    const ease = (o: THREE.Object3D, r: number[]) => {
      o.rotation.x += (r[0] - o.rotation.x) * k;
      o.rotation.y += (r[1] - o.rotation.y) * k;
      o.rotation.z += (r[2] - o.rotation.z) * k;
    };
    const easeX = (o: THREE.Object3D, x: number) => { o.rotation.x += (x - o.rotation.x) * k; };
    ease(j.legL, lL); ease(j.legR, lR); ease(j.armL, aL); ease(j.armR, aR); ease(j.torso, to); ease(j.head, hd);
    easeX(j.kneeL, keL); easeX(j.kneeR, keR); easeX(j.elbowL, elL); easeX(j.elbowR, elR);
    j.hips.position.y += (0.82 + hipsY - j.hips.position.y) * k;

    // face runs AFTER the body pose (it owns head.rotation.y for gaze). Idle gaze +
    // blink for the player; a gentle smile while gliding (wind in your face!).
    this.face.setMood(this.state === "glide" ? "happy" : "neutral");
    this.face.update(dt, t);

    // cape secondary motion — trail with forward speed, billow with fall/glide
    if (this.cape) {
      const idt = 1 / Math.max(dt, 1e-3);
      const vx = (this.pos.x - this.prevPos.x) * idt, vz = (this.pos.z - this.prevPos.z) * idt;
      const sf = Math.sin(this.facing), cf = Math.cos(this.facing);
      this.cape.update(dt, vx * sf + vz * cf, this.vy, vx * cf - vz * sf, t);
    }
    this.prevPos.copy(this.pos);

    // --- grounding & locomotion polish ---
    // slope-aligned stance: the whole figure tilts to the terrain normal so it
    // stands ON hills instead of through them (gentle, facing-relative, eased).
    let tPitch = 0, tRoll = 0;
    if (this.state === "ground") {
      const [nx, ny, nz] = normalAt(this.pos.x, this.pos.z);
      const sf = Math.sin(this.facing), cf = Math.cos(this.facing);
      tPitch = Math.atan2(nx * sf + nz * cf, ny) * 0.5;        // lean back uphill
      tRoll = -Math.atan2(nx * cf - nz * sf, ny) * 0.5;        // bank across side-slope
    }
    // turn-lean: bank into a turn while moving (athletic read)
    const turn = Math.atan2(Math.sin(this.facing - this.prevFacing), Math.cos(this.facing - this.prevFacing));
    this.prevFacing = this.facing;
    const bank = moving ? THREE.MathUtils.clamp((turn / Math.max(dt, 1e-3)) * 0.04, -0.25, 0.25) : 0;
    const tk = Math.min(1, dt * 6);
    this.bodyTilt.x += (tPitch - this.bodyTilt.x) * tk;
    this.bodyTilt.y += (tRoll + bank - this.bodyTilt.y) * tk;
    this.body.rotation.x = this.bodyTilt.x;
    this.body.rotation.z = this.bodyTilt.y;

    // landing squash: a quick knees-bend dip when you touch down from air/glide
    if (this.prevState !== "ground" && this.state === "ground") this.squashT = 1e-3;
    this.prevState = this.state;
    if (this.squashT > 0) {
      this.squashT += dt;
      const sp = this.squashT / 0.26;
      if (sp >= 1) this.squashT = 0;
      else j.hips.position.y -= Math.sin(sp * Math.PI) * 0.13;   // transient dip over the eased bob
    }
  }

  private regen(dt: number, rate = 30) {
    this.stamina = Math.min(this.maxStamina, this.stamina + rate * dt);
  }
  private drain(dt: number, rate: number): boolean {
    this.stamina -= rate * dt;
    if (this.stamina <= 0) { this.stamina = 0; return false; }
    return true;
  }

  private ground(dt: number, dir: THREE.Vector3, mag: number, sprint: boolean, jump: boolean, gh: number, slope: number) {
    this.regen(dt);
    const speed = sprint ? SPRINT : WALK;

    if (mag > 0) {
      this.facing = Math.atan2(dir.x, dir.z);
      const step = speed * dt;
      const nx = this.pos.x + dir.x * step;
      const nz = this.pos.z + dir.z * step;
      const nh = heightAt(nx, nz);
      const rise = nh - gh;
      const climbAngle = Math.atan2(rise, step) * (180 / Math.PI);

      if (climbAngle > MAX_WALK && slopeDeg(nx, nz) > CLIMB_ENTER) {
        // Hit a wall too steep to walk — start climbing.
        this.state = "climb";
        return;
      }
      this.pos.x = nx;
      this.pos.z = nz;
      this.pos.y = this.groundHeightAt(nx, nz);
    } else {
      this.pos.y = gh;
    }

    if (jump) {
      this.vy = JUMP_V;
      this.state = "air";
    }
  }

  private air(dt: number, dir: THREE.Vector3, mag: number, jump: boolean, gh: number, slope: number) {
    this.vy += GRAVITY * dt;
    this.pos.y += this.vy * dt;

    // air control
    if (mag > 0) {
      this.facing = Math.atan2(dir.x, dir.z);
      this.pos.x += dir.x * WALK * 0.6 * dt;
      this.pos.z += dir.z * WALK * 0.6 * dt;
    }

    // grab a steep wall we're pressing into
    if (mag > 0 && slope > CLIMB_ENTER && this.stamina > 5) {
      const ahead = heightAt(this.pos.x + dir.x * 0.8, this.pos.z + dir.z * 0.8);
      if (ahead > this.pos.y - 1) { this.state = "climb"; this.vy = 0; return; }
    }

    // start gliding
    if (jump && this.vy < 0 && this.stamina > 1) {
      this.state = "glide";
      return;
    }

    // land
    if (this.pos.y <= gh) {
      this.pos.y = gh;
      this.vy = 0;
      this.state = "ground";
    }
  }

  private climb(dt: number, dir: THREE.Vector3, mag: number, jump: boolean, gh: number, slope: number) {
    // --- climbing a STRUCTURE (the tower): scale the cylinder, mantle on top ---
    if (this.climbStruct) {
      const c = this.climbStruct;
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz) || 1e-3;
      const surfR = c.rx + 0.42;
      this.pos.x = c.x + (dx / d) * surfR; this.pos.z = c.z + (dz / d) * surfR; // stick to wall
      this.facing = Math.atan2(-dx / d, -dz / d);                                // face in
      if (jump) { this.vy = JUMP_V * 0.8; this.pos.x -= (dx / d) * 1.4; this.pos.z -= (dz / d) * 1.4; this.state = "air"; this.climbStruct = null; return; }
      if (!this.drain(dt, 12)) { this.state = "air"; this.vy = 0; this.climbStruct = null; return; }
      if (mag > 0) {
        const along = dir.dot(this.camera.forwardFlat()); // W/S = up/down
        const side = dir.dot(this.camera.rightFlat());     // A/D = around
        this.pos.y += along * CLIMB_SPEED * dt;
        const ang = Math.atan2(dz, dx) + (side * CLIMB_SPEED * dt) / surfR;
        this.pos.x = c.x + Math.cos(ang) * surfR; this.pos.z = c.z + Math.sin(ang) * surfR;
      }
      if (this.pos.y >= c.y + c.height) { // reached the top -> mantle onto the deck
        this.pos.set(c.x, c.y + c.height, c.z); this.state = "ground"; this.climbStruct = null; return;
      }
      if (this.pos.y < c.y) { this.pos.y = c.y; this.state = "ground"; this.climbStruct = null; } // back to base
      return;
    }

    // Stick to the surface.
    this.pos.y = heightAt(this.pos.x, this.pos.z) + 0.05;

    // Face into the wall (opposite the downhill gradient).
    const n = normalAt(this.pos.x, this.pos.z);
    const into = new THREE.Vector3(-n[0], 0, -n[2]);
    if (into.lengthSq() > 0.0001) { into.normalize(); this.facing = Math.atan2(into.x, into.z); }

    if (jump) {
      // hop off the wall, backward + up
      this.vy = JUMP_V * 0.8;
      this.pos.x -= into.x * 1.2;
      this.pos.z -= into.z * 1.2;
      this.state = "air";
      return;
    }

    if (!this.drain(dt, 14)) { this.state = "air"; this.vy = 0; return; }

    if (mag > 0) {
      // Move along the surface. Camera-relative input drives wall movement;
      // moving "forward" climbs toward higher ground.
      const uphill = into.clone(); // toward higher terrain
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), uphill).normalize();

      // W/S = up/down the wall, A/D = strafe
      const f = this.camera.forwardFlat();
      const along = dir.dot(f); // -1..1 forward/back intent
      const side = dir.dot(this.camera.rightFlat());

      const move = new THREE.Vector3();
      move.add(uphill.clone().multiplyScalar(along));
      move.add(right.clone().multiplyScalar(side));
      if (move.lengthSq() > 0) move.normalize();

      const step = CLIMB_SPEED * dt;
      this.pos.x += move.x * step;
      this.pos.z += move.z * step;
      this.pos.y = heightAt(this.pos.x, this.pos.z) + 0.05;
    }

    // mantle onto the top when the surface eases off
    if (slopeDeg(this.pos.x, this.pos.z) < CLIMB_EXIT) {
      // nudge forward onto the ledge
      this.pos.x += into.x * 0.6;
      this.pos.z += into.z * 0.6;
      this.pos.y = heightAt(this.pos.x, this.pos.z);
      this.state = "ground";
    }
  }

  private glide(dt: number, dir: THREE.Vector3, mag: number, jump: boolean, gh: number) {
    if (!jump || !this.drain(dt, 10)) { this.state = "air"; return; }

    this.vy = GLIDE_FALL;
    this.pos.y += this.vy * dt;

    if (mag > 0) {
      this.facing = Math.atan2(dir.x, dir.z);
      this.pos.x += dir.x * GLIDE_SPEED * dt;
      this.pos.z += dir.z * GLIDE_SPEED * dt;
    } else {
      // drift forward gently
      const f = this.camera.forwardFlat();
      this.pos.x += f.x * GLIDE_SPEED * 0.4 * dt;
      this.pos.z += f.z * GLIDE_SPEED * 0.4 * dt;
    }

    if (this.pos.y <= gh) {
      this.pos.y = gh;
      this.vy = 0;
      this.state = "ground";
    }
  }
}

export interface CharJoints {
  hips: THREE.Group;   // whole figure pivot (vertical bob)
  torso: THREE.Group;  // chest twist/lean
  head: THREE.Group;   // head bob/turn
  armL: THREE.Group; armR: THREE.Group; // shoulder pivots
  legL: THREE.Group; legR: THREE.Group; // hip pivots
  elbowL: THREE.Group; elbowR: THREE.Group; // forearm bend
  kneeL: THREE.Group; kneeR: THREE.Group;   // shin bend
}

/**
 * Articulated hooded adventurer. Built as a joint hierarchy so the limbs animate
 * (walk/run/climb/glide/idle) instead of sliding as a rigid statue. Pivots: hips
 * at y=0.82; shoulders at torso-local y=0.44; legs hang from the hip pivot.
 */
function darken(hex: number, f: number): number {
  return ((((hex >> 16) & 255) * f) << 16 | (((hex >> 8) & 255) * f) << 8 | (hex & 255) * f) & 0xffffff;
}

export function makeCharacter(app?: Appearance | CharPalette): { group: THREE.Group; joints: CharJoints; face: FaceRig; cape: Cape | null } {
  const P = app ?? { tunic: 0x3f8a5f, hood: 0x356e4f, pants: 0xcaa46a, accent: 0xc9d2db };
  const hat: HatStyle = (app as Appearance)?.hat ?? "hood";
  const cape = (app as Appearance)?.cape ?? null;
  const skinC = (app as Appearance)?.skin ?? DEFAULT_SKIN;          // wardrobe: skin tone
  const hairC = (app as Appearance)?.hair ?? DEFAULT_HAIR;          // wardrobe: hair colour
  const hairStyle: HairStyle = (app as Appearance)?.hairStyle ?? "tousled";
  const root = new THREE.Group();
  // Cel-shaded character: MeshToon + cool→warm gradient ramp + Fresnel rim (charToon).
  // Hard toon bands replace the smooth PBR falloff — the single biggest step out of
  // "basic shaded shapes" into a stylized BotW/Ghibli figure. Hair stays flat-shaded
  // for a chunky cut; the scene post depth-outline inks the silhouette.
  const skin = charToon(skinC, { rimStrength: 0.32 });
  const tunic = charToon(P.tunic);
  const tunicDk = charToon(darken(P.tunic, 0.72));
  const pants = charToon(P.pants);
  const leather = charToon("#6b4a2e");
  const boots = charToon("#4a3320");
  const hood = charToon(P.hood);
  const steel = charToon(P.accent, { rimColor: 0xffffff, rimStrength: 0.55 });
  const put = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.position.set(x, y, z); parent.add(m); return m;
  };

  // hips — pivot for the whole figure
  const hips = new THREE.Group(); hips.position.y = 0.82; root.add(hips);

  // legs: hip pivot -> tapered thigh, KNEE pivot -> shin + a rounded boot (no more box feet)
  const mkLeg = (sx: number) => {
    const hip = new THREE.Group(); hip.position.set(sx * 0.13, 0, 0); hips.add(hip);
    put(hip, new THREE.CapsuleGeometry(0.12, 0.22, 4, 10), pants, 0, -0.2, 0);            // thigh
    const knee = new THREE.Group(); knee.position.set(0, -0.38, 0); hip.add(knee);
    put(knee, new THREE.CapsuleGeometry(0.1, 0.2, 4, 10), pants, 0, -0.14, 0);            // shin
    put(knee, new THREE.CapsuleGeometry(0.115, 0.1, 4, 10), boots, 0, -0.32, 0.02).scale.set(1, 0.85, 1.5); // ankle/boot
    put(knee, new THREE.SphereGeometry(0.12, 12, 8), boots, 0, -0.34, 0.13).scale.set(1, 0.7, 1);           // rounded toe
    return { hip, knee };
  };
  const legLs = mkLeg(-1), legRs = mkLeg(1);

  // torso: a SMOOTH lathe tunic (flared skirt → cinched waist → chest → neck) replacing
  // the stacked cylinders — the single biggest silhouette upgrade out of "Lego" territory.
  const torso = new THREE.Group(); hips.add(torso);
  const tunicProfile = ([
    [0.40, -0.30], [0.45, -0.24], [0.41, -0.13], [0.345, -0.02],
    [0.30, 0.12], [0.30, 0.30], [0.27, 0.42], [0.18, 0.50], [0.10, 0.56],
  ] as [number, number][]).map(([r, y]) => new THREE.Vector2(r, y));
  const tunicMesh = new THREE.Mesh(new THREE.LatheGeometry(tunicProfile, 22), tunic);
  tunicMesh.castShadow = true; torso.add(tunicMesh);
  put(torso, new THREE.CylinderGeometry(0.405, 0.40, 0.05, 22), tunicDk, 0, -0.285, 0);   // hem band
  put(torso, new THREE.CylinderGeometry(0.135, 0.21, 0.07, 16), tunicDk, 0, 0.5, 0);       // collar
  // belt: a slim torus + buckle at the waist
  put(torso, new THREE.TorusGeometry(0.3, 0.035, 8, 22), leather, 0, -0.02, 0).rotation.x = Math.PI / 2;
  put(torso, new THREE.BoxGeometry(0.1, 0.1, 0.05), steel, 0, -0.02, 0.31);                // buckle

  // arms: rounded shoulder -> upper arm, ELBOW pivot -> sleeved forearm + hand
  const mkArm = (sx: number) => {
    const sh = new THREE.Group(); sh.position.set(sx * 0.29, 0.42, 0); sh.rotation.z = sx * 0.08; torso.add(sh);
    put(sh, new THREE.SphereGeometry(0.115, 12, 8), tunic, 0, 0.0, 0);                      // rounded shoulder cap
    put(sh, new THREE.CapsuleGeometry(0.088, 0.18, 4, 8), tunic, 0, -0.16, 0);              // upper arm
    const elbow = new THREE.Group(); elbow.position.set(0, -0.3, 0); sh.add(elbow);
    put(elbow, new THREE.CapsuleGeometry(0.078, 0.16, 4, 8), tunicDk, 0, -0.12, 0);         // forearm (sleeve)
    put(elbow, new THREE.SphereGeometry(0.092, 12, 8), skin, 0, -0.25, 0);                  // hand
    return { sh, elbow };
  };
  const armLs = mkArm(-1), armRs = mkArm(1);

  // head group: neck + softened head + face + hood (pivot at torso-local y=0.56)
  const head = new THREE.Group(); head.position.y = 0.56; torso.add(head);
  put(head, new THREE.CylinderGeometry(0.085, 0.1, 0.12, 12), skin, 0, 0.02, 0);            // neck
  put(head, new THREE.SphereGeometry(0.27, 20, 16), skin, 0, 0.26, 0).scale.set(1, 1.05, 0.96); // cranium
  put(head, new THREE.SphereGeometry(0.2, 16, 12), skin, 0, 0.18, 0.03).scale.set(1.04, 0.82, 1); // soft jaw/cheeks
  // expressive procedural face (eyes + iris + catchlight, brows, mouth) — blinks,
  // tracks a look-target, shapes into moods (face.ts)
  const face = buildFace({ head, eyeY: 0.27, eyeZ: 0.222, spacing: 0.1, eyeR: 0.046, skin });
  put(head, new THREE.ConeGeometry(0.026, 0.055, 8), skin, 0, 0.225, 0.255).rotation.x = Math.PI / 2; // nose
  makeHat(head, hat, hood, steel, hairC, hairStyle, put);

  // cape — a procedural cloth chain that trails when you run and billows when you
  // glide/fall (cape.ts), instead of a static plane
  const capeRig = cape !== null ? new Cape(torso, cape) : null;

  // a cozy gatherer's satchel on the back (replaces the off-theme sword — this is a
  // NON-COMBAT game). A rounded pack + flap + strap across the chest.
  const pack = put(torso, new THREE.SphereGeometry(0.18, 14, 10), leather, 0, 0.16, -0.30);
  pack.scale.set(1.1, 1.2, 0.7);
  put(torso, new THREE.CylinderGeometry(0.185, 0.185, 0.1, 14, 1, true), leather, 0, 0.27, -0.30).scale.set(1.1, 1, 0.7); // flap
  put(torso, new THREE.TorusGeometry(0.26, 0.022, 6, 18), leather, 0, 0.18, 0).rotation.set(Math.PI / 2, 0, 0.5);          // strap

  return {
    group: root,
    joints: {
      hips, torso, head,
      armL: armLs.sh, armR: armRs.sh, elbowL: armLs.elbow, elbowR: armRs.elbow,
      legL: legLs.hip, legR: legRs.hip, kneeL: legLs.knee, kneeR: legRs.knee,
    },
    face,
    cape: capeRig,
  };
}

type PutFn = (p: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, x?: number, y?: number, z?: number) => THREE.Mesh;
function makeHat(head: THREE.Group, hat: HatStyle, hood: THREE.Material, accent: THREE.Material, hairColor: number, hairStyle: HairStyle, put: PutFn) {
  // hair shows under everything EXCEPT the hood (which covers the crown)
  if (hat !== "hood") {
    const h = buildHair({ color: hairColor, headR: 0.27, style: hairStyle });
    h.position.set(0, 0.26, 0); head.add(h);
  }
  if (hat === "hood") {
    // peaked hood worn HIGH so the whole face is open below the brim — the cone
    // base + brim sit above the brow line (face features live at y≈0.27–0.35).
    put(head, new THREE.ConeGeometry(0.27, 0.5, 12), hood, 0, 0.66, -0.01);            // base at y≈0.41
    put(head, new THREE.CylinderGeometry(0.26, 0.30, 0.1, 12), hood, 0, 0.45, -0.02);  // brim above the brows
    put(head, new THREE.ConeGeometry(0.15, 0.6, 8), hood, 0, 0.46, -0.24).rotation.x = -0.5; // back peak
  } else if (hat === "cap") {
    put(head, new THREE.SphereGeometry(0.29, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), hood, 0, 0.4, 0).scale.set(1, 0.72, 1); // crown cap over the hair
    put(head, new THREE.BoxGeometry(0.34, 0.045, 0.2), hood, 0, 0.4, 0.27);   // bill
  } else if (hat === "crown") {
    put(head, new THREE.CylinderGeometry(0.27, 0.27, 0.09, 14, 1, true), accent, 0, 0.44, 0);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; put(head, new THREE.ConeGeometry(0.05, 0.16, 5), accent, Math.cos(a) * 0.25, 0.54, Math.sin(a) * 0.25); }
  }
  // bare → just the hair (already added above)
}

function makeGlider(): THREE.Group {
  const g = new THREE.Group();
  const fabric = new MeshStandardNodeMaterial({ color: "#d8643c", roughness: 1, side: THREE.DoubleSide });
  const bar = new MeshStandardNodeMaterial({ color: "#3a2c1e", roughness: 1 });

  const wing = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.08, 1.4), fabric);
  wing.position.y = 2.6; wing.castShadow = true;
  g.add(wing);
  // little peak
  const peak = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.5, 4), fabric);
  peak.position.y = 2.85; peak.rotation.y = Math.PI / 4;
  g.add(peak);

  for (const sx of [-1, 1]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 5), bar);
    rod.position.set(sx * 0.6, 2.0, 0);
    rod.rotation.z = sx * 0.5;
    g.add(rod);
  }
  return g;
}
