/**
 * Minimal frame clock — replaces the deprecated THREE.Clock (r184 warns).
 * Caps dt so a tab-switch hitch can't teleport the player or spike wind.
 */
export class Clock {
  private last = performance.now() / 1000;
  elapsed = 0;
  delta = 0;

  tick(): number {
    const now = performance.now() / 1000;
    this.delta = Math.min(now - this.last, 0.05);
    this.last = now;
    this.elapsed += this.delta;
    return this.delta;
  }
}
