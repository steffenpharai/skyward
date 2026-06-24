/**
 * Loosened TSL facade. `@types/three`'s node typings are incomplete in r184
 * (color vs vec3, AttributeNode<string>, over-strict math overloads) and fight
 * correct shader-graph code while adding no real safety to graph construction.
 * This re-exports `three/tsl` verbatim at runtime, typed `any`. Import TSL from
 * here instead of "three/tsl".
 */
import * as _tsl from "three/tsl";

const A: any = _tsl;

export const {
  uniform, Fn, If,
  vec2, vec3, vec4, float, int, color,
  sin, cos, tan, abs, sign, floor, fract, mod, pow, sqrt, exp, log, min, max, clamp,
  mix, smoothstep, step, dot, cross, normalize, length, distance, oneMinus, negate,
  add, sub, mul, div, atan, reflect,
  positionLocal, positionWorld, positionView, normalLocal, normalWorld, normalView,
  cameraPosition, modelWorldMatrix, instanceIndex, attribute, vertexColor, uv,
  screenUV, screenSize, viewportUV, dFdx, dFdy,
  perspectiveDepthToViewZ, viewZToOrthographicDepth, cameraNear, cameraFar,
  toneMapping, saturation, hue, vibrance, pass, mrt, output, texture, shadow,
  triplanarTexture, bumpMap, normalMap,
} = A;
