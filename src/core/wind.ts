import * as THREE from "three";
import { uniform } from "../nodes/tsl";
import { Fn, vec3, float, sin } from "../nodes/tsl";
import { env } from "./env";

/**
 * ONE wind field for the whole world. Grass, foliage, flowers, reeds, and the
 * tower flag all sample this so their motion is coherent (the BotW / Ghost-of-
 * Tsushima model: a single wind field drives every moving surface). The CPU
 * sampler is available for gameplay (e.g. grass trample) and stays in sync with
 * the GPU because both use the same direction + strength uniforms.
 */
export const windParams: { dir: any; strength: any } = {
  dir: uniform(new THREE.Vector2(1, 0.35).normalize()),
  strength: uniform(1.0),
};

/** CPU wind sway scalar at a world point — matches the GPU gust term. */
export function windAt(x: number, z: number, t: number): number {
  const gust = Math.sin(t * 0.9 + x * 0.06 + z * 0.05) * 0.5 + Math.sin(t * 1.7 + x * 0.13) * 0.25;
  return gust * windParams.strength.value;
}

/**
 * TSL: horizontal sway offset (world units) for a vertex.
 *  - posWorld: world position of the blade/branch base region
 *  - phase: per-instance phase so neighbours don't move in lockstep
 *  - heightFactor: 0 at the root (planted) -> 1 at the tip
 *  - flutterAmt: high-freq flutter scale (grass high, trees low)
 */
export const windSway = Fn(
  ([posWorld, phase, heightFactor, flutterAmt]: any) => {
    const t = env.u.time;
    const gust = sin(t.mul(0.9).add(posWorld.x.mul(0.06)).add(posWorld.z.mul(0.05)).add(phase)).mul(0.5)
      .add(sin(t.mul(1.7).add(posWorld.x.mul(0.13)).add(phase)).mul(0.25));
    const flutter = sin(t.mul(6.0).add(posWorld.x.mul(0.7)).add(posWorld.z).add(phase)).mul(flutterAmt);
    const amt = gust.add(flutter).mul(windParams.strength).mul(heightFactor);
    return vec3(windParams.dir.x.mul(amt), float(0.0), windParams.dir.y.mul(amt));
  }
);
