import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { heightAt, slopeDeg, WORLD, LAKE, footprintBase } from "../core/noise";
import { VILLAGE } from "./layout";
import { contactDecals } from "./decals";
import { withRim, surfaceMat } from "./materials";

/**
 * Collapse a multi-mesh group into ONE merged mesh per material (baking each
 * mesh's local transform), preserving any lights. Turns a ~40-mesh house into
 * ~7 draws. Strips to position+normal and de-indexes so heterogeneous primitive
 * geometries merge cleanly (flat-coloured meshes need no UVs).
 */
export function mergeByMaterial(src: THREE.Object3D): THREE.Group {
  src.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const lights: THREE.Object3D[] = [];
  src.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if ((mesh as any).isMesh) {
      let g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
      g.applyMatrix4(mesh.matrixWorld);
      const mat = mesh.material as THREE.Material;
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat)!.push(g);
    } else if ((o as any).isLight) {
      lights.push(o);
    }
  });
  const out = new THREE.Group();
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = true; m.receiveShadow = true;
    out.add(m);
  }
  for (const o of lights) { const c = (o as any).clone(); c.position.setFromMatrixPosition(o.matrixWorld); out.add(c); }
  return out;
}

/**
 * TERRAIN-FOLLOWING post-and-rail fence line between two WORLD points: posts sit
 * at their own ground height, rails tilt to connect post-to-post. Builds in world
 * space (merge later, don't reposition) so fences hug slopes instead of floating.
 */
const _x1 = new THREE.Vector3(1, 0, 0), _dir = new THREE.Vector3();
export function fenceLine(g: THREE.Group, ax: number, az: number, bx: number, bz: number, mat: THREE.Material) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(2, Math.round(len / 1.7));
  const pts: { x: number; z: number; h: number }[] = [];
  for (let i = 0; i <= n; i++) { const t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t; pts.push({ x, z, h: heightAt(x, z) }); }
  for (const p of pts) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), mat);
    post.position.set(p.x, p.h + 0.42, p.z); post.castShadow = true; g.add(post);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    for (const yo of [0.3, 0.6]) {
      _dir.set(b.x - a.x, b.h - a.h, b.z - a.z); const L = _dir.length(); _dir.normalize();
      const rail = new THREE.Mesh(new THREE.BoxGeometry(L, 0.07, 0.05), mat);
      rail.position.set((a.x + b.x) / 2, (a.h + b.h) / 2 + yo, (a.z + b.z) / 2);
      rail.quaternion.setFromUnitVectors(_x1, _dir);
      rail.castShadow = true; g.add(rail);
    }
  }
}

/** Yard fence around a plot (world space, terrain-following), gate gap on the road side. */
function makeYardFence(cx: number, cz: number, rot: number, hw: number, hd: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const yw = hw + 2.4, yd = hd + 2.6;
  const c = Math.cos(rot), s = Math.sin(rot);
  // local (lx,lz) -> world, matching three's Object3D rotation.y convention
  const wx = (lx: number, lz: number) => cx + lx * c + lz * s;
  const wz = (lx: number, lz: number) => cz - lx * s + lz * c;
  const corners: [number, number][] = [[-yw, -yd], [yw, -yd], [yw, yd], [0.9, yd], [-0.9, yd], [-yw, yd]];
  const W = corners.map(([lx, lz]) => [wx(lx, lz), wz(lx, lz)] as [number, number]);
  // back, right, front-right, (gate gap), front-left, left
  fenceLine(g, W[0][0], W[0][1], W[1][0], W[1][1], mat);
  fenceLine(g, W[1][0], W[1][1], W[2][0], W[2][1], mat);
  fenceLine(g, W[2][0], W[2][1], W[3][0], W[3][1], mat);
  fenceLine(g, W[4][0], W[4][1], W[5][0], W[5][1], mat);
  fenceLine(g, W[5][0], W[5][1], W[0][0], W[0][1], mat);
  return g;
}

/**
 * Overlapping shingle/tile rows for a gable roof slope, merged into ONE geometry
 * (so the relief detail costs a single draw call, not hundreds of small meshes).
 * Sits on top of the solid roof slabs, which stay as a gap-free base.
 */
function shingleRoofGeo(w: number, hd: number, oh: number, eaveY: number, ridgeY: number, pitch: number, slant: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const width = w + oh * 2;
  const rows = Math.max(4, Math.round(slant / 0.3));
  const rowD = slant / rows;
  for (const sz of [-1, 1]) {
    const cx = 0, cy = (eaveY + ridgeY) / 2, cz = sz * (hd + oh) / 2;
    const rot = new THREE.Matrix4().makeRotationX(sz * pitch);
    for (let r = 0; r < rows; r++) {
      const zL = -slant / 2 + (r + 0.5) * rowD;
      const cols = Math.max(4, Math.round(width / 0.5));
      const colW = width / cols;
      for (let ci = 0; ci < cols; ci++) {
        const xL = -width / 2 + (ci + 0.5) * colW + (r % 2 ? colW * 0.5 : 0);
        if (xL > width / 2 - colW * 0.2) continue;
        const g = new THREE.BoxGeometry(colW * 0.94, 0.07, rowD * 1.3);
        const mtx = new THREE.Matrix4().makeTranslation(cx, cy, cz)
          .multiply(rot)
          .multiply(new THREE.Matrix4().makeTranslation(xL, 0.05, zL));
        g.applyMatrix4(mtx);
        parts.push(g);
      }
    }
  }
  return mergeGeometries(parts)!;
}

// Local deterministic RNG (separate stream from the terrain noise).
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dist2 = (ax: number, az: number, bx: number, bz: number) =>
  Math.hypot(ax - bx, az - bz);

export interface Structure {
  kind: "box" | "cylinder";
  x: number; z: number; y: number; // base center
  rx: number; rz: number; // half-extents (box) or radius (cyl in rx)
  height: number;
  climb?: boolean; // a climbable surface (the tower) — press into it to scale it
}

export interface ScatterResult {
  group: THREE.Group;
  structures: Structure[];
}

const TOWN = { x: 18, z: -6 };

export function buildScatter(scene: THREE.Scene): ScatterResult {
  const rng = mulberry32(99001);
  const group = new THREE.Group();
  group.name = "scatter";
  const structures: Structure[] = [];
  const decals: { x: number; y: number; z: number; r: number }[] = [];

  // (Trees now live in world/trees.ts — proper branching/layered species.)
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const pos = new THREE.Vector3();

  // ---------- ROCKS (instanced, irregular, mossy tops via baked vertex colors) ----------
  const rockMat = withRim(
    new MeshStandardNodeMaterial({ vertexColors: true, roughness: 1, flatShading: true, side: THREE.DoubleSide }),
    { color: 0xbcd0e8, power: 3.0, strength: 0.3 }
  );
  const makeRockGeo = (seed: number) => {
    const g = new THREE.DodecahedronGeometry(1, 0);
    const rr = mulberry32(seed);
    const pa = g.attributes.position as THREE.BufferAttribute;
    const cols = new Float32Array(pa.count * 3);
    const greyLt = new THREE.Color("#a9a496"), grey = new THREE.Color("#8b8579"), greyDk = new THREE.Color("#5f5a51");
    const lichen = new THREE.Color("#8a9466"); // muted grey-green, not bright moss
    const c = new THREE.Color();
    for (let i = 0; i < pa.count; i++) {
      // irregular: nudge each vertex outward/in
      const vx = pa.getX(i), vy = pa.getY(i), vz = pa.getZ(i);
      // displace by a hash of POSITION (not vertex index) so duplicated corner vertices of
      // this non-indexed geometry move together — otherwise faces split and you see through.
      const hsh = (a: number) => { const s = Math.sin(a) * 43758.5453; return s - Math.floor(s); };
      const k = 0.9 + hsh(vx * 12.9 + vy * 78.2 + vz * 37.7) * 0.2;
      const ky = 0.88 + hsh(vx * 4.1 + vy * 7.3 + vz * 1.7) * 0.24;
      pa.setXYZ(i, vx * k, vy * k * ky, vz * k);
      // natural stone: lighter (sun) up top, darker toward the base
      const up = THREE.MathUtils.smoothstep(vy, -0.7, 0.7);
      c.copy(greyDk).lerp(grey, up).lerp(greyLt, up * up * 0.7);
      // faint patchy lichen (random per vertex, not a clean cap)
      const patch = rr();
      if (patch > 0.72) c.lerp(lichen, (patch - 0.72) * 1.1 * (0.4 + up * 0.6));
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    g.computeVertexNormals();
    return g;
  };
  const rockGeos = [makeRockGeo(11), makeRockGeo(22), makeRockGeo(33)];
  const rockPtsByGeo: THREE.Matrix4[][] = [[], [], []];
  for (let i = 0; i < 240; i++) {
    const x = (rng() - 0.5) * WORLD.size * 0.96;
    const z = (rng() - 0.5) * WORLD.size * 0.96;
    const h = heightAt(x, z);
    if (h < LAKE.level + 0.5) continue;
    // clusters: sometimes drop 2-3 rocks together
    const cluster = rng() < 0.4 ? 2 + Math.floor(rng() * 2) : 1;
    for (let c2 = 0; c2 < cluster; c2++) {
      const ox = x + (rng() - 0.5) * 3, oz = z + (rng() - 0.5) * 3;
      const oh = heightAt(ox, oz);
      const s = 0.5 + rng() * 2.4;
      q.setFromEuler(new THREE.Euler(rng() * 0.5, rng() * Math.PI * 2, rng() * 0.5));
      sc.set(s, s * (0.7 + rng() * 0.5), s);
      pos.set(ox, oh + s * 0.25, oz);
      rockPtsByGeo[Math.floor(rng() * 3)].push(m.clone().compose(pos, q, sc));
      if (s > 0.9) decals.push({ x: ox, y: oh, z: oz, r: s * 0.85 });
    }
  }
  rockGeos.forEach((rg, gi) => {
    const pts = rockPtsByGeo[gi];
    if (!pts.length) return;
    const rockInst = new THREE.InstancedMesh(rg, rockMat, pts.length);
    pts.forEach((mm, i) => rockInst.setMatrixAt(i, mm));
    rockInst.castShadow = true; rockInst.receiveShadow = true;
    group.add(rockInst);
  });

  // ---------- VILLAGE: houses lined along the street, each in a fenced yard ----------
  const houseRng = mulberry32(4242);
  const fenceMat = new MeshStandardNodeMaterial({ color: "#6e4a2c", roughness: 1 });
  const skirtMat = new MeshStandardNodeMaterial({ color: "#8d8478", roughness: 1, flatShading: true });
  for (const plot of VILLAGE.houses) {
    const raw = makeHouse(houseRng); // ~40 meshes -> ~7 draws
    const fp = (raw.userData.footprint as { w: number; d: number }) ?? { w: 4, d: 3.4 };
    // Seat the house on the HIGHEST ground under its footprint so no corner floats; a
    // foundation skirt fills the downhill gap on a slope (fixes "floating houses").
    const { baseY, minY, drop } = footprintBase(plot.x, plot.z, plot.rot, fp.w / 2 + 0.2, fp.d / 2 + 0.2);
    const house = mergeByMaterial(raw);
    house.position.set(plot.x, baseY, plot.z);
    house.rotation.y = plot.rot;
    group.add(house);
    if (drop > 0.15) {
      const skH = drop + 0.8;
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(fp.w + 0.3, skH, fp.d + 0.3), skirtMat);
      skirt.position.set(plot.x, baseY - skH / 2 + 0.1, plot.z);
      skirt.rotation.y = plot.rot;
      skirt.castShadow = true; skirt.receiveShadow = true;
      group.add(skirt);
    }
    // yard fence is built in world space (terrain-following); merge but don't reposition
    group.add(mergeByMaterial(makeYardFence(plot.x, plot.z, plot.rot, plot.halfW, plot.halfD, fenceMat)));
    structures.push({ kind: "box", x: plot.x, z: plot.z, y: baseY, rx: 2.6, rz: 2.2, height: 3.2 });
    decals.push({ x: plot.x, y: minY, z: plot.z, r: plot.halfW + 2.2 });
  }
  contactDecals(scene, decals);

  // ---------- HERO LANDMARK: climbable watchtower ----------
  {
    const tx = TOWN.x, tz = TOWN.z;
    const { baseY: th, minY: tmin, drop: tdrop } = footprintBase(tx, tz, 0, 2.7, 2.7);
    const tower = mergeByMaterial(makeTower()); // ~80 step/wall meshes -> a few draws (+ beacon light)
    tower.position.set(tx, th, tz);
    group.add(tower);
    if (tdrop > 0.15) {
      const skH = tdrop + 1.0;
      const skirt = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 3.0, skH, 16), skirtMat);
      skirt.position.set(tx, th - skH / 2 + 0.2, tz);
      skirt.castShadow = true; skirt.receiveShadow = true;
      group.add(skirt);
    }
    void tmin;
    structures.push({ kind: "cylinder", x: tx, z: tz, y: th, rx: 2.6, rz: 2.6, height: 21, climb: true });
  }

  scene.add(group);
  return { group, structures };
}

// flat triangle wall (for gable ends), spanning z in [-hz,hz], rising to apexY at z=0
function gableTri(hz: number, eaveY: number, apexY: number, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(
    [-hz, eaveY, 0, hz, eaveY, 0, 0, apexY, 0], 3));
  geo.setIndex([0, 1, 2]);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

export function makeHouse(rng: () => number): THREE.Group {
  const g = new THREE.Group();
  const plasterCol = new THREE.Color().setHSL(0.09 + rng() * 0.03, 0.22, 0.74 + rng() * 0.08);
  const plaster = surfaceMat({ kind: "plaster", color: plasterCol, rim: 0.22 });
  const beam = surfaceMat({ kind: "wood", color: "#5a4126", rim: 0.25 });
  const stone = surfaceMat({ kind: "stone", color: "#8d8478", rim: 0.2 });
  const roofCol = [0x8a4636, 0x6f5536, 0x55624a][Math.floor(rng() * 3)];
  const roofMat = surfaceMat({ kind: "shingle", color: roofCol, rim: 0.22 });
  const woodDk = surfaceMat({ kind: "plank", color: "#46331e", rim: 0.25 });
  const glass = new MeshStandardNodeMaterial({ color: "#cfe6ee", roughness: 0.35, metalness: 0.0, emissive: new THREE.Color("#6b4a22"), emissiveIntensity: 0.5 });
  const iron = new MeshStandardNodeMaterial({ color: "#2a2622", roughness: 0.6, metalness: 0.45 });
  const lanternGlow = new MeshStandardNodeMaterial({ color: "#ffe6a8", emissive: new THREE.Color("#ff9a36"), emissiveIntensity: 3.2 });
  const flowerR = new MeshStandardNodeMaterial({ color: "#e0566a", roughness: 1 });
  const flowerY = new MeshStandardNodeMaterial({ color: "#f2c23a", roughness: 1 });
  const add = (m: THREE.Mesh) => { m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };

  const w = 3.4 + rng() * 1.4, d = 3.0 + rng() * 1.0;
  g.userData.footprint = { w, d };   // so the placer can seat + skirt it on a slope
  const stories = rng() > 0.65 ? 2 : 1;
  const wallH = 2.3 + (stories - 1) * 1.9;
  const hw = w / 2, hd = d / 2;

  // stone foundation
  const found = add(new THREE.Mesh(new THREE.BoxGeometry(w + 0.25, 0.5, d + 0.25), stone));
  found.position.y = 0.25;
  // plaster walls
  const body = add(new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), plaster));
  body.position.y = 0.5 + wallH / 2;

  // timber frame: corner posts + top/mid plates + diagonal braces (front & back)
  const postT = 0.16;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const post = add(new THREE.Mesh(new THREE.BoxGeometry(postT, wallH, postT), beam));
    post.position.set(sx * hw, 0.5 + wallH / 2, sz * hd);
  }
  for (const sz of [-1, 1]) {
    const top = add(new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, 0.1), beam));
    top.position.set(0, 0.5 + wallH - 0.1, sz * hd + sz * 0.005);
    const mid = add(new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, 0.08), beam));
    mid.position.set(0, 0.5 + wallH * 0.5, sz * hd + sz * 0.005);
    // two diagonal braces
    for (const sx of [-1, 1]) {
      const brace = add(new THREE.Mesh(new THREE.BoxGeometry(0.12, wallH * 0.62, 0.07), beam));
      brace.position.set(sx * hw * 0.5, 0.5 + wallH * 0.42, sz * hd + sz * 0.01);
      brace.rotation.z = sx * 0.7;
    }
    // vertical timber studs (more half-timber detail)
    for (const sx of [-0.34, 0.34]) {
      const stud = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, wallH, 0.06), beam));
      stud.position.set(sx * w, 0.5 + wallH / 2, sz * hd + sz * 0.004);
    }
  }
  // side-wall timber studs
  for (const sx of [-1, 1]) for (const sz2 of [-0.3, 0.3]) {
    const stud = add(new THREE.Mesh(new THREE.BoxGeometry(0.06, wallH, 0.1), beam));
    stud.position.set(sx * hw + sx * 0.004, 0.5 + wallH / 2, sz2 * d);
  }

  // gable roof: two tilted slabs (ridge along X) + gable triangles + ridge beam
  const roofH = 1.2 + rng() * 0.4, oh = 0.45;
  const eaveY = 0.5 + wallH;
  const ridgeY = eaveY + roofH;
  const slant = Math.hypot(hd + oh, roofH);
  const pitch = Math.atan2(roofH, hd + oh);
  for (const sz of [-1, 1]) {
    const slope = add(new THREE.Mesh(new THREE.BoxGeometry(w + oh * 2, 0.14, slant), roofMat));
    slope.position.set(0, (eaveY + ridgeY) / 2, sz * (hd + oh) / 2);
    slope.rotation.x = sz * pitch; // ridge high at z=0, eaves low (peak, not valley)
  }
  const ridge = add(new THREE.Mesh(new THREE.BoxGeometry(w + oh * 2 + 0.1, 0.16, 0.16), woodDk));
  ridge.position.set(0, ridgeY + 0.02, 0);
  for (const sx of [-1, 1]) {
    const tri = gableTri(hd, eaveY, ridgeY, plaster);
    tri.position.set(sx * hw, 0, 0);
    tri.rotation.y = Math.PI / 2;
    g.add(tri);
  }
  // shingle/tile relief on top of the slabs (one merged mesh)
  add(new THREE.Mesh(shingleRoofGeo(w, hd, oh, eaveY, ridgeY, pitch, slant), roofMat));

  // windows (framed + cross mullion + shutters) on the front (+z)
  const winRows = stories === 2 ? [1.2, 3.0] : [1.3];
  for (const wy of winRows) {
    for (const wx of [-hw * 0.5, hw * 0.5]) {
      const frame = add(new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.78, 0.12), woodDk));
      frame.position.set(wx, wy, hd + 0.02);
      const pane = add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.06), glass));
      pane.position.set(wx, wy, hd + 0.06);
      const mull = add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 0.07), woodDk));
      mull.position.set(wx, wy, hd + 0.08);
      const mull2 = add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.07), woodDk));
      mull2.position.set(wx, wy, hd + 0.08);
      for (const sh of [-1, 1]) {
        const shutter = add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.78, 0.06), beam));
        shutter.position.set(wx + sh * 0.42, wy, hd + 0.04);
      }
      // flower box under ground-floor windows
      if (wy < 1.6) {
        const fbox = add(new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.16, 0.2), woodDk));
        fbox.position.set(wx, wy - 0.5, hd + 0.13);
        for (let fI = 0; fI < 3; fI++) {
          const fl = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 5), fI % 2 ? flowerR : flowerY);
          fl.position.set(wx - 0.2 + fI * 0.2, wy - 0.4, hd + 0.15);
          fl.castShadow = true; g.add(fl);
        }
      }
    }
  }

  // planked door with iron bands + frame + step
  const dframe = add(new THREE.Mesh(new THREE.BoxGeometry(1.04, 1.78, 0.08), beam));
  dframe.position.set(0, 1.39, hd + 0.0);
  for (let pI = 0; pI < 4; pI++) {
    const plank = add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.58, 0.1), woodDk));
    plank.position.set(-0.3 + pI * 0.2, 1.3, hd + 0.04);
  }
  for (const by of [0.95, 1.65]) {
    const band = add(new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.07, 0.12), iron));
    band.position.set(0, by, hd + 0.06);
  }
  const knob = add(new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), iron));
  knob.position.set(0.3, 1.25, hd + 0.11);
  const step = add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 0.5), stone));
  step.position.set(0, 0.59, hd + 0.28);

  // wall lantern beside the door (emissive core blooms; warm hearth accent)
  const bracket = add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.34), iron));
  bracket.position.set(0.66, 2.12, hd + 0.22);
  const lantern = add(new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.24, 0.17), iron));
  lantern.position.set(0.66, 1.96, hd + 0.4);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.1), lanternGlow);
  glow.position.set(0.66, 1.96, hd + 0.4); g.add(glow);

  // optional door porch (footprint/feature variety)
  if (rng() > 0.5) {
    const awn = add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.85), roofMat));
    awn.position.set(0, 2.5, hd + 0.55); awn.rotation.x = 0.32;
    for (const sx of [-1, 1]) {
      const post = add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.95, 0.09), beam));
      post.position.set(sx * 0.62, 1.48, hd + 0.9);
    }
  }

  // chimney
  const chim = add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.4, 0.45), stone));
  chim.position.set(hw * 0.5, ridgeY + 0.1, 0);
  const cap = add(new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.16, 0.58), woodDk));
  cap.position.set(hw * 0.5, ridgeY + 0.85, 0);

  return g;
}

function makeTower(): THREE.Group {
  const g = new THREE.Group();
  const stoneMat = surfaceMat({ kind: "stone", color: "#9a8f7d", rim: 0.2, scale: 0.45 });
  const trimMat = surfaceMat({ kind: "wood", color: "#5a4632", rim: 0.22 });
  const flagMat = new MeshStandardNodeMaterial({ color: "#cf5b4e", roughness: 1, side: THREE.DoubleSide });

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.6, 20, 12), stoneMat);
  shaft.position.y = 10;
  shaft.castShadow = true; shaft.receiveShadow = true;
  g.add(shaft);

  const darkWood = new MeshStandardNodeMaterial({ color: "#3a2a18", roughness: 1 });
  const bandMat = surfaceMat({ kind: "stone", color: "#7d7468", rim: 0.18 });
  const radAt = (y: number) => 2.6 - (0.6 / 20) * y;

  // arched door at the base (+z)
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.0, 0.3), darkWood);
  door.position.set(0, 1.25, radAt(1.25) - 0.05); door.castShadow = true; g.add(door);
  const doorTop = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.3, 10, 1, false, 0, Math.PI), darkWood);
  doorTop.rotation.x = Math.PI / 2; doorTop.position.set(0, 2.25, radAt(2.25) - 0.05); g.add(doorTop);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.25, 0.35), bandMat);
  lintel.position.set(0, 2.3, radAt(2.3) - 0.04); g.add(lintel);

  // narrow windows up the shaft
  for (const wy of [6, 11, 16]) for (const wa of [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5]) {
    const rr = radAt(wy);
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.8, 0.2), darkWood);
    win.position.set(Math.cos(wa) * (rr - 0.04), wy, Math.sin(wa) * (rr - 0.04));
    win.rotation.y = Math.PI / 2 - wa;
    g.add(win);
  }

  // stone course rings (banding the shaft)
  for (const by of [4, 9, 14, 19]) {
    const rr = radAt(by);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(rr + 0.07, rr + 0.07, 0.28, 12), bandMat);
    band.position.y = by; band.castShadow = true; g.add(band);
  }

  // hanging banner with the keep's colour
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 4.2), flagMat);
  banner.position.set(0, 16.5, radAt(16.5) + 0.05); g.add(banner);
  const bannerBar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6), darkWood);
  bannerBar.rotation.z = Math.PI / 2; bannerBar.position.set(0, 18.6, radAt(18.6) + 0.05); g.add(bannerBar);

  // spiral staircase wrapping the shaft (climb to the beacon)
  const turns = 3.0;
  const rise = 0.36;
  const nSteps = Math.floor(19.2 / rise);
  const stepGeo = new THREE.BoxGeometry(1.15, 0.16, 0.95);
  const railGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.0, 5);
  for (let i = 0; i < nSteps; i++) {
    const t = i / nSteps;
    const y = 0.25 + i * rise;
    const ang = t * turns * Math.PI * 2;
    const rr = radAt(y) + 0.55;
    const step = new THREE.Mesh(stepGeo, bandMat);
    step.position.set(Math.cos(ang) * rr, y, Math.sin(ang) * rr);
    step.rotation.y = Math.PI / 2 - ang;
    step.castShadow = true; step.receiveShadow = true;
    g.add(step);
    // outer railing posts every few steps
    if (i % 3 === 0) {
      const post = new THREE.Mesh(railGeo, darkWood);
      post.position.set(Math.cos(ang) * (rr + 0.5), y + 0.5, Math.sin(ang) * (rr + 0.5));
      post.castShadow = true; g.add(post);
    }
  }

  // crown deck
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.0, 1.2, 12), trimMat);
  deck.position.y = 20.6;
  deck.castShadow = true;
  g.add(deck);

  // GLOWING BEACON — the focal "weenie"/accent (complementary orange, blooms).
  const beaconMat = new MeshStandardNodeMaterial({
    color: "#ff8a30", emissive: new THREE.Color("#ff7a1a"), emissiveIntensity: 4.0,
  });
  const beacon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), beaconMat);
  beacon.position.y = 21.8;
  g.add(beacon);
  const beaconLight = new THREE.PointLight(0xff9a40, 8, 30, 2);
  beaconLight.position.y = 21.8;
  g.add(beaconLight);

  // battlements
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.7), stoneMat);
    b.position.set(Math.cos(a) * 2.7, 21.6, Math.sin(a) * 2.7);
    g.add(b);
  }

  // flag pole + flag
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 6), trimMat);
  pole.position.y = 23.5;
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), flagMat);
  flag.position.set(0.8, 24.4, 0);
  g.add(flag);

  return g;
}

