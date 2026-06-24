import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { uv, length, vec2, smoothstep, color } from "../nodes/tsl";

/**
 * Soft ground-contact AO decals — flat dark discs with a radial alpha falloff,
 * laid just above the terrain under objects so they read as grounded instead of
 * floating/placed-on-top. depthTest on + depthWrite off so they hug the surface
 * and get occluded by terrain on slopes. One instanced draw per call.
 */
let _mat: MeshBasicNodeMaterial | null = null;
function decalMat(): MeshBasicNodeMaterial {
  if (_mat) return _mat;
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  m.colorNode = color(0x161812);
  m.opacityNode = smoothstep(0.5, 0.12, length(uv().sub(vec2(0.5, 0.5)))).mul(0.32);
  _mat = m;
  return m;
}

export function contactDecals(scene: THREE.Scene, items: { x: number; y: number; z: number; r: number }[]) {
  if (!items.length) return;
  const geo = new THREE.CircleGeometry(1, 16);
  geo.rotateX(-Math.PI / 2);
  const inst = new THREE.InstancedMesh(geo, decalMat(), items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  items.forEach((it, i) => { s.set(it.r, 1, it.r); p.set(it.x, it.y + 0.04, it.z); inst.setMatrixAt(i, m.compose(p, q, s)); });
  inst.frustumCulled = true;
  inst.renderOrder = 1;
  scene.add(inst);
}
