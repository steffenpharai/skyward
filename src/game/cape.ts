/**
 * Cape secondary motion — a lightweight, always-stable procedural cloth chain.
 *
 * Rather than a full spring-bone physics solver (which can go unstable and needs
 * VRM-shaped joint data), the cape is a short chain of segment pivots whose bend
 * is driven directly from the character's motion: it trails BACK when you run,
 * BILLOWS UP when you fall/glide, sways laterally, and flutters — with each lower
 * segment lagging the one above (the cascade that reads as cloth). Fully owned,
 * ~no failure modes, cheap for many characters.
 *
 * Inputs are the character-LOCAL forward speed and vertical velocity, so the cape
 * trails opposite the way you're actually facing.
 */
import * as THREE from "three";
import { charToon } from "./charToon";

const SEGS = 3;
const SEG_LEN = 0.4;
const WIDTHS = [0.66, 0.58, 0.46];

export class Cape {
  private segs: THREE.Group[] = [];
  private cur: number[] = [];          // current eased bend per segment (x)
  private curZ: number[] = [];         // lateral sway per segment

  constructor(parent: THREE.Object3D, color: THREE.ColorRepresentation) {
    const mat = charToon(color, { rimStrength: 0.3 });
    (mat as any).side = THREE.DoubleSide;

    // anchor at the upper back, tilted slightly off the spine
    const anchor = new THREE.Group();
    anchor.position.set(0, 0.18, -0.32);
    anchor.rotation.x = -0.12;
    parent.add(anchor);

    let cur: THREE.Object3D = anchor;
    for (let i = 0; i < SEGS; i++) {
      const g = new THREE.Group();
      g.position.y = i === 0 ? 0 : -SEG_LEN;        // hang from the end of the previous segment
      cur.add(g);
      const w0 = WIDTHS[i], w1 = WIDTHS[Math.min(SEGS - 1, i + 1)];
      const geo = new THREE.PlaneGeometry((w0 + w1) / 2, SEG_LEN, 2, 1);
      geo.translate(0, -SEG_LEN / 2, 0);
      const m = new THREE.Mesh(geo, mat); m.castShadow = true;
      g.add(m);
      this.segs.push(g); this.cur.push(0); this.curZ.push(0);
      cur = g;
    }
  }

  /** forwardSpeed = velocity along the facing dir (m/s); vy = vertical velocity. */
  update(dt: number, forwardSpeed: number, vy: number, lateral: number, t: number) {
    const trail = THREE.MathUtils.clamp(forwardSpeed * 0.22, -0.5, 1.1);   // run → trail back/up
    const billow = THREE.MathUtils.clamp(-vy * 0.16, -0.3, 1.0);            // fall/glide → lift up
    const sway = THREE.MathUtils.clamp(lateral * 0.18, -0.6, 0.6);
    for (let i = 0; i < SEGS; i++) {
      const depth = i + 1;
      // deeper segments swing more and flutter more; top segment barely moves
      const flutter = Math.sin(t * 7 + i * 1.3) * (0.04 + Math.abs(forwardSpeed) * 0.03) * depth;
      const targetX = -(trail + billow) * depth * 0.5 + flutter;           // -x swings the hem backward/up
      const targetZ = sway * depth * 0.4 + Math.sin(t * 5 + i) * 0.02 * depth;
      // lag: deeper segments ease slower (cloth follows)
      const k = Math.min(1, dt * (10 - i * 2.2));
      this.cur[i] += (targetX - this.cur[i]) * k;
      this.curZ[i] += (targetZ - this.curZ[i]) * k;
      this.segs[i].rotation.x = this.cur[i];
      this.segs[i].rotation.z = this.curZ[i];
    }
  }
}
