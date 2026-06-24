import * as THREE from "three";
import {
  positionLocal, positionWorld, cameraPosition, vec3, vec2, float, sin, cos,
  clamp, mix, smoothstep, max, dot, normalize, pow, color, length, oneMinus, reflect,
} from "../nodes/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { LAKE } from "../core/noise";
import { env } from "../core/env";
import { applyFog } from "../nodes/fog";
import { skyColorNode } from "../nodes/sky";

/**
 * Stylized lake: animated wavelets, view-dependent Fresnel sky reflection,
 * depth-graded body colour, animated shoreline foam, a sharp sun glint, fog.
 * Now TSL + env-driven sun (was a standalone GLSL ShaderMaterial).
 */
export function buildWater(scene: THREE.Scene): { update: (t: number) => void } {
  const R = LAKE.r + 5;
  const geo = new THREE.CircleGeometry(R, 96);
  geo.rotateX(-Math.PI / 2);

  const mat = new MeshBasicNodeMaterial({ transparent: true, fog: false });
  const T = env.u.time;

  // ---- waves (vertex) ----
  const p = positionLocal;
  const w = sin(p.x.mul(0.35).add(T.mul(1.4))).mul(0.10)
    .add(cos(p.z.mul(0.42).sub(T.mul(1.1))).mul(0.10))
    .add(sin(p.x.add(p.z).mul(0.7).add(T.mul(2.0))).mul(0.04));
  mat.positionNode = vec3(p.x, p.y.add(w), p.z);

  // ---- shading (fragment) ----
  const wx = positionWorld.x, wz = positionWorld.z;
  const rdist = length(vec2(wx.sub(LAKE.x), wz.sub(LAKE.z))).div(R);

  // analytic wave normal
  const dx = cos(wx.mul(0.35).add(T.mul(1.4))).mul(0.035)
    .add(cos(wx.add(wz).mul(0.7).add(T.mul(2.0))).mul(0.028));
  const dz = sin(wz.mul(0.42).sub(T.mul(1.1))).mul(-0.042)
    .add(cos(wx.add(wz).mul(0.7).add(T.mul(2.0))).mul(0.028));
  const N = normalize(vec3(dx.negate(), 1.0, dz.negate()));
  const V = normalize(cameraPosition.sub(positionWorld));

  const fres = pow(oneMinus(max(dot(N, V), 0.0)), 3.0);
  const body = mix(color(0x54c4cc), color(0x125e7a), smoothstep(0.55, 0.0, rdist));
  // REAL reflection: reflect the view ray off the wave normal and sample the
  // actual sky (gradient + sun), instead of mixing toward a flat constant colour.
  const reflDir = reflect(V.negate(), N);
  const skyRefl = skyColorNode(reflDir);
  let col = mix(body, skyRefl, clamp(fres.mul(0.92), 0.0, 1.0));

  const ndl = dot(N, normalize(env.u.sunDir)).mul(0.5).add(0.5);
  col = col.mul(mix(float(0.8), float(1.14), ndl));

  const swell = sin(wx.mul(0.5).add(T.mul(0.8))).mul(sin(wz.mul(0.42).sub(T.mul(0.6))));
  col = col.mul(float(1.0).add(swell.mul(0.06)));

  const glints = sin(wx.mul(1.1).add(T.mul(1.2))).mul(sin(wz.mul(0.9).sub(T.mul(0.9))));
  col = col.add(smoothstep(0.965, 1.0, glints).mul(0.12).mul(oneMinus(fres)));

  const H = normalize(normalize(env.u.sunDir).add(V));
  const spec = pow(max(dot(N, H), 0.0), 200.0);
  col = col.add(spec.mul(vec3(env.u.sunColor)).mul(1.2));

  const foam = smoothstep(0.82, 0.97, rdist)
    .mul(float(0.6).add(float(0.4).mul(sin(rdist.mul(60.0).sub(T.mul(3.0))))));
  col = mix(col, vec3(0.95, 0.98, 1.0), clamp(foam, 0.0, 0.8));

  mat.colorNode = applyFog(col);
  mat.opacityNode = mix(float(0.82), float(0.96), fres);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(LAKE.x, LAKE.level, LAKE.z);
  mesh.name = "water";
  scene.add(mesh);

  return { update: (_t: number) => {} };
}
