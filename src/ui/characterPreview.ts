/**
 * CharacterPreviews — renders the REAL procedural character rig (makeCharacter) as
 * small, slowly-turning 3D figures in the character-select cards (replacing the flat
 * orbs). One dedicated WebGPU renderer draws each rig in turn into its card's 2D
 * canvas (round-robin by frame), so a single device backs all the cards.
 *
 * Fully guarded: if WebGPU/init/render ever fails, the cards keep their CSS fallback
 * tint and nothing throws — the title screen must never break on a preview.
 */
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { makeCharacter } from "../player/player";
import type { CharPalette } from "../game/characters";
import type { FaceRig } from "../game/face";

interface Target { id: string; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; rig: THREE.Group; face: FaceRig | null; }

export class CharacterPreviews {
  private renderer: WebGPURenderer | null = null;
  private scene = new THREE.Scene();
  // portrait aspect matching the card canvases (128×148) so the square→tall
  // drawImage doesn't stretch the figure
  private readonly W = 256;
  private readonly H = 296;
  private camera = new THREE.PerspectiveCamera(32, 256 / 296, 0.1, 50);
  private targets: Target[] = [];
  private ready = false;
  private spin = 0;
  private time = 0;
  private busy = false;

  constructor() {
    try {
      const c = document.createElement("canvas");
      c.width = this.W; c.height = this.H;
      this.renderer = new WebGPURenderer({ canvas: c, antialias: true, alpha: true });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(this.W, this.H);
      // pulled back + raised to frame the WHOLE figure (feet → peaked-hood tip ≈ 2.3),
      // so heads no longer clip the top of the card
      this.camera.position.set(0, 1.05, 4.9);
      this.camera.lookAt(0, 1.05, 0);
      const hemi = new THREE.HemisphereLight(0xdcebff, 0x3a2f24, 1.25);
      const key = new THREE.DirectionalLight(0xfff0d8, 2.0); key.position.set(2.5, 4, 3);
      const rim = new THREE.DirectionalLight(0x9fd0ff, 1.1); rim.position.set(-3, 2, -2);
      this.scene.add(hemi, key, rim);
      this.renderer.init().then(() => { this.ready = true; }).catch(() => { this.ready = false; });
    } catch { this.renderer = null; }
  }

  /** Register a card: build its rig from the palette and bind it to a canvas. */
  add(id: string, palette: CharPalette, canvas: HTMLCanvasElement): boolean {
    if (!this.renderer) return false;
    try {
      const { group, face } = makeCharacter(palette);
      group.visible = false;
      this.scene.add(group);
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;
      this.targets.push({ id, canvas, ctx, rig: group, face });
      return true;
    } catch { return false; }
  }

  /** Drive from the render loop while the title screen is up. Renders each rig in turn. */
  update(dt: number): void {
    if (!this.ready || !this.renderer || !this.targets.length) return;
    this.spin += dt * 0.5;
    this.time += dt;
    // animate every face (cheap) so the cards blink + glance around, even while a
    // render is in flight
    for (const t of this.targets) { try { t.face?.update(dt, this.time); } catch {} }
    if (this.busy) return;
    this.busy = true;
    const r = this.renderer;
    const draw = async () => {
      try {
        for (const t of this.targets) {
          for (const o of this.targets) o.rig.visible = false;
          t.rig.visible = true;
          // gentle front-facing sway (±0.5 rad) instead of a full turntable, so the
          // card always shows the face rather than the back of the head
          t.rig.rotation.y = Math.sin(this.spin) * 0.5;
          await r.renderAsync(this.scene, this.camera);
          t.ctx.clearRect(0, 0, t.canvas.width, t.canvas.height);
          t.ctx.drawImage(r.domElement, 0, 0, t.canvas.width, t.canvas.height);
        }
      } catch { /* keep the fallback tint */ } finally { this.busy = false; }
    };
    void draw();
  }

  dispose(): void { try { this.renderer?.dispose(); } catch {} this.renderer = null; this.targets = []; }
}
