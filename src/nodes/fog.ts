import { Fn, vec3, clamp, mix, positionView } from "./tsl";
import { env } from "../core/env";

/**
 * Env-driven aerial-perspective fog for self-lit materials (the standard light
 * stack fogs automatically; custom colorNode materials must do it manually).
 * Linear fog matched to the horizon sky colour -> distant geometry melts into
 * the sky, the painterly depth cue.
 */
export const applyFog = Fn(([color]: any) => {
  const dist = positionView.z.negate();
  const f = clamp(dist.sub(env.u.fogNear).div(env.u.fogFar.sub(env.u.fogNear)), 0.0, 1.0);
  return mix(color, vec3(env.u.fogColor), f);
});
