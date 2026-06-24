/**
 * Interaction system — a registry of world things you can act on, plus
 * nearest-in-range detection and the "press E" trigger. Cozy and forgiving:
 * the closest enabled interactable within its radius becomes the current target.
 */
import * as THREE from "three";
import type { Input } from "../core/input";

export interface Interactable {
  pos: THREE.Vector3;
  radius: number;
  label(): string;          // prompt text, e.g. "Gather Wood (E)"
  act(): void;
  enabled?: () => boolean;   // default true
}

export class Interact {
  private items = new Set<Interactable>();
  current: Interactable | null = null;

  constructor(private input: Input) {}

  add(i: Interactable): () => void {
    this.items.add(i);
    return () => this.items.delete(i);
  }

  /** Pick the nearest enabled interactable in range; fire it on E. */
  update(playerPos: THREE.Vector3): Interactable | null {
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const it of this.items) {
      if (it.enabled && !it.enabled()) continue;
      const d = it.pos.distanceTo(playerPos);
      if (d < it.radius && d < bestD) { bestD = d; best = it; }
    }
    this.current = best;
    if (best && this.input.pressed("KeyE")) best.act();
    return best;
  }
}
