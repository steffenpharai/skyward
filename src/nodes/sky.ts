import { Fn, vec3, mix, pow, clamp, max, dot, normalize, smoothstep } from "./tsl";
import { env } from "../core/env";

/**
 * Sky colour for a given world direction — the gradient (zenith/mid/horizon)
 * plus the warm sun halo + disk, all from `env`. Shared by the sky dome AND the
 * water's reflected ray, so the lake reflects the REAL sky (and the moving sun),
 * not a flat constant colour.
 */
export const skyColorNode = Fn(([dir]: any) => {
  const d = normalize(dir);
  const h = d.y;
  const upCol = mix(vec3(env.u.skyMid), vec3(env.u.skyTop), pow(clamp(h, 0.0, 1.0), 0.6));
  const downCol = mix(vec3(env.u.skyMid), vec3(env.u.skyBot), clamp(h.negate().mul(2.2), 0.0, 1.0));
  const base = h.greaterThan(0.0).select(upCol, downCol);
  const sd = normalize(env.u.sunDir);
  const dd = max(dot(d, sd), 0.0);
  let col = base
    .add(vec3(env.u.sunColor).mul(pow(dd, 8.0).mul(0.35)))
    .add(vec3(env.u.sunColor).mul(pow(dd, 220.0).mul(1.5)));
  col = mix(col, vec3(env.u.sunColor).mul(2.2), smoothstep(0.9975, 0.9990, dd));
  return col;
});
