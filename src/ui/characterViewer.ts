/**
 * CharacterViewer — a dedicated turntable that shows YOUR character in full: the
 * current appearance on a slowly-rotating figure, with the expressive face live
 * (blink/glance) and the odd wave/nod so you can actually see what you built. Used
 * by the wardrobe so dressing up has a proper front-and-all-sides preview (the
 * in-world figure is usually seen from behind).
 *
 * Its own small WebGPU renderer, fully guarded: if WebGPU/init/render fails it
 * quietly shows nothing and the wardrobe still works.
 */
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { makeCharacter, type CharJoints } from "../player/player";
import { emotePose } from "../game/humanoid";
import type { Appearance } from "../game/characters";
import type { FaceRig } from "../game/face";
import type { EmoteName } from "../game/agent/brain";

function disposeRig(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = (m as any).material;
    if (Array.isArray(mat)) mat.forEach((x) => x?.dispose?.()); else mat?.dispose?.();
  });
}

export class CharacterViewer {
  private renderer: WebGPURenderer | null = null;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private rig: THREE.Group | null = null;
  private joints: CharJoints | null = null;
  private face: FaceRig | null = null;
  private rest: { o: THREE.Object3D; x: number; y: number; z: number }[] = [];
  private spin = 0;
  private time = 0;
  private last = 0;
  private running = false;
  private ready = false;
  private busy = false;
  private emote: EmoteName | null = null;
  private emoteT = 0;
  private emoteCD = 3;

  constructor(canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(30, canvas.width / canvas.height, 0.1, 50);
    this.camera.position.set(0, 1.05, 5.0);     // frames feet → peaked-hood tip (~2.3)
    this.camera.lookAt(0, 1.05, 0);
    try {
      this.renderer = new WebGPURenderer({ canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(canvas.width, canvas.height, false);
      const hemi = new THREE.HemisphereLight(0xdcebff, 0x3a2f24, 1.25);
      const key = new THREE.DirectionalLight(0xfff0d8, 2.2); key.position.set(2.5, 4, 3);
      const rim = new THREE.DirectionalLight(0x9fd0ff, 1.2); rim.position.set(-3, 2, -2);
      this.scene.add(hemi, key, rim);
      this.renderer.init().then(() => { this.ready = true; }).catch(() => { this.ready = false; });
    } catch { this.renderer = null; }
  }

  /** Rebuild the figure for a new appearance (called on every wardrobe change). */
  setAppearance(app: Appearance) {
    if (!this.renderer) return;
    try {
      if (this.rig) { this.scene.remove(this.rig); disposeRig(this.rig); }
      const { group, joints, face } = makeCharacter(app);
      this.rig = group; this.joints = joints; this.face = face;
      // capture the rest pose so the emote overlay has a clean base each frame
      this.rest = [joints.armL, joints.armR, joints.elbowL, joints.elbowR, joints.head, joints.torso]
        .map((o) => ({ o, x: o.rotation.x, y: o.rotation.y, z: o.rotation.z }));
      this.scene.add(group);
    } catch { /* keep the previous figure */ }
  }

  start() { if (this.renderer && !this.running) { this.running = true; this.last = performance.now(); this.loop(); } }
  stop() { this.running = false; }

  private loop = () => {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    if (!this.ready || this.busy || !this.rig) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    this.time += dt; this.spin += dt * 0.55;
    this.rig.rotation.y = this.spin;

    if (this.joints) {
      // reset to the rest pose + a faint breathing sway, then overlay an emote
      const b = Math.sin(this.time * 1.6) * 0.04;
      for (const r of this.rest) r.o.rotation.set(r.x, r.y, r.z);
      this.joints.armL.rotation.x += b; this.joints.armR.rotation.x += b;
      this.emoteCD -= dt;
      if (!this.emote && this.emoteCD <= 0) { this.emote = Math.random() < 0.55 ? "wave" : "nod"; this.emoteT = 0; this.emoteCD = 4 + Math.random() * 3; }
      if (this.emote) { this.emoteT += dt; if (!emotePose(this.joints as any, this.emote, this.emoteT)) this.emote = null; }
    }
    this.face?.update(dt, this.time);

    this.busy = true;
    this.renderer!.renderAsync(this.scene, this.camera).catch(() => {}).finally(() => { this.busy = false; });
  };

  dispose() { this.stop(); try { this.renderer?.dispose(); } catch {} this.renderer = null; this.rig = null; }
}
