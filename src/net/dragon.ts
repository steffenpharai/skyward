/**
 * The Sky Dragon — an eastern spirit-serpent, rendered the frontier way: a single
 * continuous TAPERED TUBE whose spine follows the server's head-trail, PLUS a
 * traveling sine undulation so the body visibly SNAKES (the #1 thing that reads as a
 * dragon, not a tube). Ornate horned/whiskered/jawed head, a flowing mane + a dorsal
 * spine ridge (InstancedMesh), and four small clawed legs ride the body. TSL shading:
 * head→tail gradient + fresnel-rim emissive that feeds bloom. Non-combat.
 */
import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { mix, color, attribute, normalize, normalWorld, float } from "../nodes/tsl";
import { fresnelRim } from "../nodes/lighting";

export const DRAGON = { rings: 56, radial: 10, trailLen: 50, maxR: 2.2 };

// taper: slim neck → fat shoulders → fine tail (a creature profile, not a cylinder)
function radiusAt(t: number): number {
  const neck = Math.min(1, t / 0.12);                 // ramp up off the head
  const taper = Math.pow(1 - t, 0.7);                 // thin toward the tail
  const belly = 0.55 + 0.45 * Math.sin(Math.min(1, t * 1.3) * Math.PI); // shoulder bulge
  return DRAGON.maxR * (0.35 + 0.65 * neck) * taper * belly + 0.1;
}

const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _b = new THREE.Vector3(), _t = new THREE.Vector3();
const _obj = new THREE.Object3D(), _UP = new THREE.Vector3(0, 1, 0);
let _centers: THREE.Vector3[] = [];

export function buildDragon(): THREE.Group {
  const g = new THREE.Group();
  g.name = "skydragon";
  const { rings, radial } = DRAGON;
  _centers = Array.from({ length: rings }, () => new THREE.Vector3());

  // --- tube geometry: allocate once, update positions in place ---
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(rings * radial * 3);
  const arc = new Float32Array(rings * radial);
  for (let i = 0; i < rings; i++) for (let j = 0; j < radial; j++) arc[i * radial + j] = i / (rings - 1);
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("arc", new THREE.BufferAttribute(arc, 1));
  const index: number[] = [];
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * radial + j, b = i * radial + ((j + 1) % radial);
    const c = (i + 1) * radial + j, d = (i + 1) * radial + ((j + 1) % radial);
    index.push(a, c, b, b, c, d);
  }
  geo.setIndex(index);

  const mat = new MeshStandardNodeMaterial({ roughness: 0.62, metalness: 0.04 });
  mat.colorNode = mix(color(0x2f6fd8), color(0x86e8d6), attribute("arc"));   // indigo head → jade tail
  mat.emissiveNode = fresnelRim(normalize(normalWorld), color(0x9fe6ff), float(2.4), float(0.9));
  (mat as any).emissive = new THREE.Color(0x15539c); (mat as any).emissiveIntensity = 0.3;
  const tube = new THREE.Mesh(geo, mat);
  tube.frustumCulled = false;
  g.add(tube);
  g.userData.geo = geo; g.userData.positions = positions; g.userData.tube = tube;

  // --- ornate head ---
  const head = buildHead();
  g.add(head); g.userData.head = head;

  // --- dorsal spine ridge + neck mane as ONE InstancedMesh (taller near head) ---
  const spineCount = Math.floor(rings / 2);
  const spineGeo = new THREE.ConeGeometry(0.32, 1.0, 4);
  const spineMat = spineMaterial();
  const spines = new THREE.InstancedMesh(spineGeo, spineMat, spineCount);
  spines.frustumCulled = false; spines.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  g.add(spines); g.userData.spines = spines;

  // --- four small clawed legs that ride the body ---
  const legs = [makeLeg(), makeLeg(), makeLeg(), makeLeg()];
  for (const l of legs) g.add(l);
  g.userData.legs = legs;

  return g;
}

function spineMaterial(): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({ color: 0xbfeffb, roughness: 0.35 });
  (m as any).emissive = new THREE.Color(0x7fd8ff); (m as any).emissiveIntensity = 1.1;
  (m as any).side = THREE.DoubleSide; (m as any).transparent = true; (m as any).opacity = 0.94;
  return m;
}

function buildHead(): THREE.Group {
  const head = new THREE.Group();
  const skin = new MeshStandardNodeMaterial({ color: 0x356fd0, roughness: 0.55, metalness: 0.05 });
  (skin as any).emissive = new THREE.Color(0x1b54a8); (skin as any).emissiveIntensity = 0.35;
  const horn = new MeshStandardNodeMaterial({ color: 0xe9d6a8, roughness: 0.5 });
  (horn as any).emissive = new THREE.Color(0x6a5a30); (horn as any).emissiveIntensity = 0.25;
  const frill = spineMaterial();
  const eyeMat = new MeshStandardNodeMaterial({ color: 0xfff2b0, roughness: 0.2 });
  (eyeMat as any).emissive = new THREE.Color(0xffc23a); (eyeMat as any).emissiveIntensity = 4.0;
  const M = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent: THREE.Object3D = head) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
  };

  // elongated skull + brow
  const skull = M(new THREE.IcosahedronGeometry(1.5, 1), skin, 0, 0.1, 0); skull.scale.set(1.0, 0.92, 1.7);
  M(new THREE.BoxGeometry(1.9, 0.5, 1.1), skin, 0, 0.55, 0.1);                       // brow crest
  // upper snout + nostrils
  const snout = M(new THREE.ConeGeometry(0.78, 2.4, 8), skin, 0, 0.05, 1.9, Math.PI / 2, 0, 0); snout.scale.set(1, 1, 0.9);
  for (const sx of [-0.34, 0.34]) M(new THREE.SphereGeometry(0.12, 8, 6), skin, sx, 0.32, 2.7);
  // hinged lower jaw (slightly open)
  const jaw = new THREE.Group(); jaw.position.set(0, -0.35, 0.2); head.add(jaw); head.userData.jaw = jaw;
  M(new THREE.ConeGeometry(0.6, 2.0, 7), skin, 0, 0, 1.6, Math.PI / 2, 0, 0, jaw).scale.set(1, 0.7, 1);
  // glowing eyes + brow ridges
  for (const sx of [-0.72, 0.72]) { M(new THREE.SphereGeometry(0.3, 12, 10), eyeMat, sx, 0.45, 0.85); M(new THREE.BoxGeometry(0.5, 0.16, 0.5), skin, sx, 0.7, 0.8, -0.3, 0, sx > 0 ? 0.2 : -0.2); }
  // branched antler horns
  for (const sx of [-0.6, 0.6]) {
    const base = new THREE.Group(); base.position.set(sx, 0.85, -0.55); base.rotation.set(-0.7, 0, sx > 0 ? -0.3 : 0.3); head.add(base);
    M(new THREE.ConeGeometry(0.22, 2.4, 6), horn, 0, 1.0, 0, 0, 0, 0, base);
    M(new THREE.ConeGeometry(0.12, 1.1, 5), horn, sx > 0 ? 0.3 : -0.3, 1.7, 0.1, 0, 0, sx > 0 ? -0.7 : 0.7, base);   // tine
    M(new THREE.ConeGeometry(0.1, 0.9, 5), horn, 0, 1.9, -0.3, -0.6, 0, 0, base);                                    // back tine
  }
  // frill/crown of spikes fanning around the back of the head
  for (let i = 0; i < 7; i++) { const a = (i / 6 - 0.5) * 2.4; M(new THREE.ConeGeometry(0.13, 1.0 + Math.cos(a) * 0.5, 5), frill, Math.sin(a) * 1.0, 0.5 + Math.cos(a) * 0.3, -0.9, -0.9, a * 0.5, 0); }
  // long sweeping whiskers
  for (const sx of [-1, 1]) for (const yz of [[0.2, 2.5], [-0.1, 2.2]]) M(new THREE.ConeGeometry(0.05, 3.4, 4), frill, sx * 0.5, yz[0], yz[1], 1.4, 0, sx > 0 ? -0.4 : 0.4);

  return head;
}

function makeLeg(): THREE.Group {
  const leg = new THREE.Group();
  const skin = new MeshStandardNodeMaterial({ color: 0x2f63c0, roughness: 0.6 });
  (skin as any).emissive = new THREE.Color(0x16459a); (skin as any).emissiveIntensity = 0.3;
  const claw = new MeshStandardNodeMaterial({ color: 0xe9d6a8, roughness: 0.5 });
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.5, 3, 6), skin); upper.position.y = -0.35; leg.add(upper);
  const lower = new THREE.Group(); lower.position.y = -0.7; leg.add(lower);
  const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.45, 3, 6), skin); shin.position.y = -0.25; lower.add(shin);
  for (let i = -1; i <= 1; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.32, 5), claw); c.position.set(i * 0.12, -0.5, 0.12); c.rotation.x = 0.5; lower.add(c); }
  leg.userData.lower = lower;
  return leg;
}

/** Rewrite the snaking spine + head/mane/spines/legs from the head transform + trail. */
export function poseDragon(g: THREE.Group, d: { x: number; y: number; z: number; heading: number; bank: number }, trail: THREE.Vector3[]) {
  const { rings, radial } = DRAGON;
  const positions = g.userData.positions as Float32Array;
  const geo = g.userData.geo as THREE.BufferGeometry;
  const now = performance.now() * 0.001;

  const pts: THREE.Vector3[] = [new THREE.Vector3(d.x, d.y, d.z)];
  for (const p of trail) pts.push(p);
  if (pts.length < 2) pts.push(new THREE.Vector3(d.x, d.y - 0.1, d.z - 2));
  const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
  const frames = curve.computeFrenetFrames(rings - 1, false);

  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    curve.getPointAt(t, _p);
    _n.copy(frames.normals[i]); _b.copy(frames.binormals[i]);
    // traveling undulation: the body snakes (lateral) + bobs (vertical), ramping off the head
    const env = Math.min(1, t * 2.4) * (1 - t * 0.25);
    const ph = t * Math.PI * 2 * 2.3 - now * 2.4;
    _p.addScaledVector(_n, Math.sin(ph) * 2.7 * env);
    _p.addScaledVector(_b, Math.cos(ph * 0.85) * 1.5 * env);
    _centers[i].copy(_p);
    const r = radiusAt(t);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const k = (i * radial + j) * 3;
      positions[k] = _p.x + r * (ca * _n.x + sa * _b.x);
      positions[k + 1] = _p.y + r * (ca * _n.y + sa * _b.y);
      positions[k + 2] = _p.z + r * (ca * _n.z + sa * _b.z);
    }
  }
  geo.attributes.position.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  // head at the snaking neck start, oriented by authoritative heading + a head bob
  const head = g.userData.head as THREE.Group;
  head.position.copy(_centers[0]);
  head.rotation.set(Math.sin(now * 1.5) * 0.08, d.heading, d.bank + Math.sin(now) * 0.05);
  const jaw = head.userData.jaw as THREE.Group; if (jaw) jaw.rotation.x = Math.sin(now * 0.7) * 0.12 + 0.12;

  // dorsal spines + neck mane: tall near the head (mane), shrinking down the back
  const spines = g.userData.spines as THREE.InstancedMesh;
  for (let si = 0; si < spines.count; si++) {
    const i = si * 2; const t = i / (rings - 1);
    _n.copy(frames.normals[i]); _b.copy(frames.binormals[i]); _t.copy(frames.tangents[i]);
    const r = radiusAt(t);
    _obj.position.copy(_centers[i]).addScaledVector(_b, r * 0.85).addScaledVector(_UP, 0.1);
    _obj.quaternion.setFromUnitVectors(_UP, _b.clone().multiplyScalar(0.6).add(_t.clone().multiplyScalar(0.5)).normalize());
    const mane = 1 + Math.max(0, 1 - t * 4) * 2.2;          // big mane on the first ~quarter
    const s = (1 - t) * (0.9 + mane) + 0.2;
    _obj.scale.set(s * 0.8, s, s * 0.8); _obj.updateMatrix();
    spines.setMatrixAt(si, _obj.matrix);
  }
  spines.instanceMatrix.needsUpdate = true;

  // four legs at fixed body fractions, hanging down with a gentle paddle
  const legs = g.userData.legs as THREE.Group[];
  const legAt = [0.14, 0.14, 0.4, 0.4];
  const side = [-1, 1, -1, 1];
  for (let li = 0; li < 4; li++) {
    const i = Math.round(legAt[li] * (rings - 1));
    _n.copy(frames.normals[i]); _b.copy(frames.binormals[i]);
    const r = radiusAt(legAt[li]);
    const leg = legs[li];
    leg.position.copy(_centers[i]).addScaledVector(_n, side[li] * r * 0.7).addScaledVector(_b, -r * 0.5);
    leg.rotation.set(0.2 + Math.sin(now * 3 + li) * 0.25, d.heading + side[li] * 0.5, side[li] * 0.3);
    const lower = leg.userData.lower as THREE.Group; if (lower) lower.rotation.x = 0.5 + Math.sin(now * 3 + li + 1) * 0.3;
  }
}
