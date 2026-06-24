/** Keyboard + pointer-lock mouse input. */
export class Input {
  keys = new Set<string>();
  private prev = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  locked = false;
  enabled = true;   // set false while typing a command so keys don't drive the player

  constructor(private dom: HTMLElement) {
    addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));

    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.dom;
    });
    addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
  }

  requestLock() {
    // No-op safe on touch/mobile (no Pointer Lock) and swallows the promise rejection
    // some browsers throw when lock is denied — maybeRelock() calls this freely.
    try { const p = (this.dom.requestPointerLock as any)?.(); if (p && typeof p.catch === "function") p.catch(() => {}); } catch { /* unsupported */ }
  }

  /** Feed look delta from touch (bypasses pointer-lock, which mobile lacks). */
  addLook(dx: number, dy: number) { this.mouseDX += dx; this.mouseDY += dy; }
  /** Synthesise a held key (touch controls drive the same WASD/Space the keyboard does). */
  setKey(code: string, on: boolean) { if (on) this.keys.add(code); else this.keys.delete(code); }

  down(code: string) {
    return this.enabled && this.keys.has(code);
  }

  /** True only on the frame the key transitioned from up→down (ignores OS auto-repeat). */
  pressed(code: string) {
    return this.enabled && this.keys.has(code) && !this.prev.has(code);
  }

  /** Disable input + clear held keys (e.g. while a text field is focused). */
  setEnabled(on: boolean) { this.enabled = on; if (!on) { this.keys.clear(); this.prev.clear(); } }

  /** Call once at the END of each game update so `pressed()` is edge-accurate. */
  postUpdate() {
    this.prev = new Set(this.keys);
  }

  /** Read & clear accumulated mouse delta for this frame. */
  consumeMouse(): [number, number] {
    const d: [number, number] = [this.mouseDX, this.mouseDY];
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }
}
