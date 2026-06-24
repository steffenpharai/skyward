import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { heightAt, slopeDeg, WORLD, LAKE, footprintBase } from "../core/noise";
import { VILLAGE, inVillage } from "./layout";
import { mergeByMaterial, fenceLine, type Structure } from "./scatter";
import { toonFoliage, surfaceMat } from "./materials";
import { noiseHull, bakeCanopyAO } from "./trees";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const TOWN = { x: 18, z: -6 };
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

/** Add an InstancedMesh from a list of matrices. */
function instances(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], cast = true, receive = true) {
  if (!mats.length) return;
  const inst = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((m, i) => inst.setMatrixAt(i, m));
  inst.castShadow = cast; inst.receiveShadow = receive;
  scene.add(inst);
}

/** A classic red barn: board walls, solid gable (extruded) roof, big door + hayloft. */
function makeBarn(): THREE.Group {
  const g = new THREE.Group();
  const red = surfaceMat({ kind: "plank", color: "#9a3f33", rim: 0.24 });
  const roofM = surfaceMat({ kind: "shingle", color: "#46413a", rim: 0.2 });
  const woodM = surfaceMat({ kind: "plank", color: "#3a2a18", rim: 0.22 });
  const trim = new MeshStandardNodeMaterial({ color: "#e8e0d2", roughness: 1 });
  const add = (m: THREE.Mesh) => { m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  const w = 6.5, d = 8.5, wallH = 4.2, hw = w / 2, hd = d / 2;
  add(new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), red)).position.y = wallH / 2;
  add(new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.4, d + 0.2), woodM)).position.y = 0.2; // sill

  // solid gable roof via an extruded triangle (closed ends, no gaps)
  const roofH = 2.6, oh = 0.45;
  const shape = new THREE.Shape();
  shape.moveTo(-(hw + oh), 0); shape.lineTo(hw + oh, 0); shape.lineTo(0, roofH); shape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: d + oh * 2, bevelEnabled: false });
  roofGeo.translate(0, wallH, -(hd + oh));
  add(new THREE.Mesh(roofGeo, roofM));

  // big barn door + white trim + hayloft on the +z gable end
  add(new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.0, 0.2), woodM)).position.set(0, 1.5, hd + 0.05);
  for (const sx of [-1, 1]) { const fr = add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.2, 0.24), trim)); fr.position.set(sx * 1.4, 1.6, hd + 0.06); }
  add(new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.18, 0.24), trim)).position.set(0, 3.1, hd + 0.06);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 0.2), woodM)).position.set(0, wallH + 0.9, hd + 0.05);
  return g;
}

/** A market stall: 4 posts, a table with goods, and a striped sloped canopy. */
function makeStall(rng: () => number): THREE.Group {
  const g = new THREE.Group();
  const wood = new MeshStandardNodeMaterial({ color: "#6e4a2c", roughness: 1 });
  const cloth = new MeshStandardNodeMaterial({ color: rng() < 0.5 ? "#b5503e" : "#3e6fb5", roughness: 1, flatShading: true });
  const add = (m: THREE.Mesh) => { m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  const w = 2.3, d = 1.5;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const p = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.7, 0.1), wood)); p.position.set(sx * w / 2, 0.85, sz * d / 2); }
  const t = add(new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), wood)); t.position.y = 1.0;
  const c = add(new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.08, d + 0.6), cloth)); c.position.set(0, 1.75, 0.3); c.rotation.x = 0.32;
  for (let i = 0; i < 3; i++) { const b = add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), wood)); b.position.set(-0.6 + i * 0.6, 1.2, 0); }
  return g;
}

export function buildProps(scene: THREE.Scene): Structure[] {
  const colliders: Structure[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const compose = (x: number, y: number, z: number, sc: number, yaw: number, sy = sc) => {
    q.setFromAxisAngle(up, yaw); s.set(sc, sy, sc); p.set(x, y, z); return m.clone().compose(p, q, s);
  };

  // ---------- BUSHES (fill the meadow / understorey) ----------
  {
    const rng = mulberry32(5150);
    const bushGeo = (r: number) => {
      const parts = [noiseHull(rng, r, 0.8)];
      for (let i = 0; i < 2; i++) { const b = noiseHull(rng, r * 0.7, 0.8); const a = rng() * 6.28; b.translate(Math.cos(a) * r * 0.5, r * 0.18, Math.sin(a) * r * 0.5); parts.push(b); }
      return bakeCanopyAO(mergeGeometries(parts)!);
    };
    const geos = [bushGeo(0.6), bushGeo(0.5)];
    const mat = toonFoliage("#5d9a3e", 0xbfe07a).mat;
    const buckets: THREE.Matrix4[][] = [[], []];
    let placed = 0, tries = 0;
    while (placed < 150 && tries < 1600) {
      tries++;
      const x = (rng() - 0.5) * WORLD.size * 0.9, z = (rng() - 0.5) * WORLD.size * 0.9;
      const h = heightAt(x, z);
      if (h < LAKE.level + 1.0 || h > 38 || slopeDeg(x, z) > 24) continue;
      if (dist(x, z, LAKE.x, LAKE.z) < LAKE.r + 2) continue;
      if (inVillage(x, z, 2)) continue;
      const clump = Math.sin(x * 0.12) * Math.cos(z * 0.1) * 0.5 + 0.5;
      if (rng() > 0.35 + clump * 0.5) continue;
      buckets[Math.floor(rng() * 2)].push(compose(x, h, z, 0.7 + rng() * 0.8, rng() * 6.28));
      placed++;
    }
    geos.forEach((g, i) => instances(scene, g, mat, buckets[i], true, false));
  }

  // ---------- LAKESHORE: reeds + cattails + lily pads + pebbles ----------
  {
    const rng = mulberry32(2207);
    const reedGeo = new THREE.CylinderGeometry(0.015, 0.05, 1.4, 4); reedGeo.translate(0, 0.7, 0);
    const reedMat = new MeshStandardNodeMaterial({ color: "#6fae4a", roughness: 1, flatShading: true });
    const catGeo = new THREE.CapsuleGeometry(0.06, 0.22, 3, 6); catGeo.translate(0, 1.35, 0);
    const catMat = new MeshStandardNodeMaterial({ color: "#7a5230", roughness: 1 });
    const padGeo = new THREE.CircleGeometry(0.5, 7); padGeo.rotateX(-Math.PI / 2);
    const padMat = new MeshStandardNodeMaterial({ color: "#3f7d3a", roughness: 1, flatShading: true, side: THREE.DoubleSide });
    const pebGeo = new THREE.DodecahedronGeometry(0.16, 0);
    const pebMat = new MeshStandardNodeMaterial({ color: "#9a948a", roughness: 1, flatShading: true });

    const reeds: THREE.Matrix4[] = [], cats: THREE.Matrix4[] = [], pads: THREE.Matrix4[] = [], pebs: THREE.Matrix4[] = [];
    for (let i = 0; i < 520; i++) {
      const a = rng() * 6.28, rad = LAKE.r - 1.5 + (rng() - 0.5) * 4.5;
      const x = LAKE.x + Math.cos(a) * rad, z = LAKE.z + Math.sin(a) * rad;
      const h = heightAt(x, z);
      if (h > LAKE.level + 1.4 || h < LAKE.level - 0.6) continue; // only the wet shore band
      reeds.push(compose(x, h, z, 0.6 + rng() * 0.9, rng() * 6.28));
      if (rng() < 0.3) cats.push(compose(x, h, z, 0.7 + rng() * 0.6, 0));
      if (rng() < 0.25) pebs.push(compose(x + (rng() - 0.5), h, z + (rng() - 0.5), 0.6 + rng(), rng() * 6.28));
    }
    // lily pads float ON the water near the shore
    for (let i = 0; i < 46; i++) {
      const a = rng() * 6.28, rad = (LAKE.r - 4) * Math.sqrt(rng());
      const x = LAKE.x + Math.cos(a) * rad, z = LAKE.z + Math.sin(a) * rad;
      pads.push(compose(x, LAKE.level + 0.06, z, 0.5 + rng() * 0.8, rng() * 6.28));
    }
    instances(scene, reedGeo, reedMat, reeds, true, false);
    instances(scene, catGeo, catMat, cats, true, false);
    instances(scene, padGeo, padMat, pads, false, false);
    instances(scene, pebGeo, pebMat, pebs, true, true);
  }

  // ---------- FOREST FLOOR: mushrooms, stumps, fallen logs ----------
  {
    const rng = mulberry32(8842);
    const mush = (capHex: string) => {
      const stem = new THREE.CylinderGeometry(0.03, 0.045, 0.18, 5); stem.translate(0, 0.09, 0);
      const cap = new THREE.SphereGeometry(0.1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2); cap.scale(1, 0.7, 1); cap.translate(0, 0.18, 0);
      const g = mergeGeometries([stem, cap])!;
      return { g, mat: new MeshStandardNodeMaterial({ color: capHex, roughness: 1, flatShading: true }) };
    };
    const mr = mush("#cc4436"), mb = mush("#b5823f");
    const stemMat = new MeshStandardNodeMaterial({ color: "#e8e0cc", roughness: 1 });
    void stemMat;
    const mRed: THREE.Matrix4[] = [], mBrown: THREE.Matrix4[] = [];
    const stumpGeo = (() => {
      const c = new THREE.CylinderGeometry(0.34, 0.4, 0.5, 8); c.translate(0, 0.25, 0);
      const top = new THREE.CylinderGeometry(0.3, 0.3, 0.06, 8); top.translate(0, 0.5, 0);
      return mergeGeometries([c, top])!;
    })();
    const stumpMat = new MeshStandardNodeMaterial({ color: "#6b4a30", roughness: 1, flatShading: true });
    const logGeo = (() => { const c = new THREE.CylinderGeometry(0.26, 0.3, 2.2, 8); c.rotateZ(Math.PI / 2); return c; })();
    const stumps: THREE.Matrix4[] = [], logs: THREE.Matrix4[] = [];

    let placed = 0, tries = 0;
    while (placed < 240 && tries < 3000) {
      tries++;
      const x = (rng() - 0.5) * WORLD.size * 0.9, z = (rng() - 0.5) * WORLD.size * 0.9;
      const h = heightAt(x, z);
      if (h < LAKE.level + 1.2 || h > 42 || slopeDeg(x, z) > 24) continue;
      if (dist(x, z, LAKE.x, LAKE.z) < LAKE.r + 2) continue;
      if (inVillage(x, z, 2)) continue;
      const r = rng();
      if (r < 0.62) { (rng() < 0.5 ? mRed : mBrown).push(compose(x, h, z, 0.7 + rng() * 0.9, rng() * 6.28)); }
      else if (r < 0.85) stumps.push(compose(x, h - 0.05, z, 0.7 + rng() * 0.6, rng() * 6.28));
      else logs.push(compose(x, h + 0.25, z, 0.7 + rng() * 0.5, rng() * 6.28));
      placed++;
    }
    instances(scene, mr.g, mr.mat, mRed, true, false);
    instances(scene, mb.g, mb.mat, mBrown, true, false);
    instances(scene, stumpGeo, stumpMat, stumps, true, true);
    instances(scene, logGeo, stumpMat, logs, true, true);
  }

  // ---------- VILLAGE: well, yard barrels, cobble street ----------
  {
    const rng = mulberry32(1717);
    const stone = new MeshStandardNodeMaterial({ color: "#8d8478", roughness: 1, flatShading: true });
    const wood = new MeshStandardNodeMaterial({ color: "#6e4a2c", roughness: 1 });
    const iron = new MeshStandardNodeMaterial({ color: "#2a2622", roughness: 0.6, metalness: 0.4 });

    // WELL on the town square
    {
      const wx = TOWN.x + 5, wz = TOWN.z + 4, wh = heightAt(wx, wz);
      const well = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.95, 0.9, 12), stone); ring.position.y = 0.45;
      const lip = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.1, 6, 14), stone); lip.rotation.x = Math.PI / 2; lip.position.y = 0.9;
      well.add(ring, lip);
      for (const sx of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.7, 0.12), wood); post.position.set(sx * 0.8, 1.75, 0); well.add(post); }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.12, 0.12), wood); beam.position.y = 2.6; well.add(beam);
      const roof1 = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 1.3), wood); roof1.position.set(0, 3.0, 0.4); roof1.rotation.x = 0.5;
      const roof2 = roof1.clone(); roof2.position.z = -0.4; roof2.rotation.x = -0.5; well.add(roof1, roof2);
      const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.15, 0.28, 8), iron); bucket.position.set(0, 1.5, 0); well.add(bucket);
      const wellMerged = mergeByMaterial(well);
      wellMerged.position.set(wx, wh, wz);
      scene.add(wellMerged);
    }

    // MARKET STALLS on the square (clear of tower + well + road)
    {
      const sdx = Math.cos(-0.55), sdz = Math.sin(-0.55), spx = -sdz, spz = sdx;
      for (const sp of [{ d: 3, p: 7 }, { d: 3, p: -7 }, { d: -7, p: 5 }]) {
        const x = TOWN.x + sdx * sp.d + spx * sp.p, z = TOWN.z + sdz * sp.d + spz * sp.p, h = heightAt(x, z);
        const stall = mergeByMaterial(makeStall(rng));
        stall.position.set(x, h, z);
        stall.rotation.y = Math.atan2(TOWN.x - x, TOWN.z - z);
        scene.add(stall);
      }
    }

    // BARRELS / CRATES tucked at the corner of each house yard
    const barrelGeo = (() => {
      const b = new THREE.CylinderGeometry(0.3, 0.26, 0.7, 10); b.translate(0, 0.35, 0);
      const r1 = new THREE.TorusGeometry(0.3, 0.03, 4, 12); r1.rotateX(Math.PI / 2); r1.translate(0, 0.5, 0);
      const r2 = r1.clone(); r2.translate(0, -0.3, 0);
      return mergeGeometries([b, r1, r2])!;
    })();
    const crateGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6); crateGeo.translate(0, 0.3, 0);
    const barrels: THREE.Matrix4[] = [], crates: THREE.Matrix4[] = [];
    for (const plot of VILLAGE.houses) {
      if (rng() < 0.4) continue;
      const cxs = rng() < 0.5 ? -1 : 1, czs = rng() < 0.5 ? -1 : 1;
      const n = 1 + Math.floor(rng() * 2);
      for (let k = 0; k < n; k++) {
        const x = plot.x + cxs * (plot.halfW + 0.7) + (rng() - 0.5) * 0.6;
        const z = plot.z + czs * (plot.halfD + 0.7) + (rng() - 0.5) * 0.6;
        const h = heightAt(x, z);
        if (rng() < 0.6) barrels.push(compose(x, h, z, 0.8 + rng() * 0.3, rng() * 6.28));
        else crates.push(compose(x, h, z, 0.8 + rng() * 0.4, rng() * 6.28));
      }
    }
    instances(scene, barrelGeo, wood, barrels);
    instances(scene, crateGeo, wood, crates);

    // COBBLE STREET along the road centreline
    {
      const cobGeo = new THREE.CylinderGeometry(0.32, 0.34, 0.12, 6); cobGeo.scale(1, 1, 0.8);
      const cobMat = new MeshStandardNodeMaterial({ color: "#7e776c", roughness: 1, flatShading: true });
      const cobs: THREE.Matrix4[] = [];
      for (const pt of VILLAGE.road) {
        const m2 = 4 + Math.floor(rng() * 3);
        for (let k = 0; k < m2; k++) {
          const x = pt.x + (rng() - 0.5) * 2.6, z = pt.z + (rng() - 0.5) * 2.6, h = heightAt(x, z);
          if (h < LAKE.level + 0.5) continue;
          cobs.push(compose(x, h + 0.02, z, 0.8 + rng() * 0.5, rng() * 6.28));
        }
      }
      instances(scene, cobGeo, cobMat, cobs, false, true);
    }
  }

  // ---------- FARMSTEADS: barn + fenced field + crop rows ----------
  {
    const rng = mulberry32(606);
    const fenceMat = new MeshStandardNodeMaterial({ color: "#6e4a2c", roughness: 1 });
    const cropMat = new MeshStandardNodeMaterial({ color: "#caa83e", roughness: 1, flatShading: true });
    const barnSkirtMat = new MeshStandardNodeMaterial({ color: "#7c5436", roughness: 1, flatShading: true });
    for (const farm of VILLAGE.farms) {
      // Seat the barn on the highest ground under its 6.5×8.5 footprint + skirt the gap
      // so it never floats on the meadow's gentle slopes.
      const { baseY: fh, drop } = footprintBase(farm.x, farm.z, farm.rot, 3.45, 4.45);
      const barn = mergeByMaterial(makeBarn()); barn.position.set(farm.x, fh, farm.z); barn.rotation.y = farm.rot; scene.add(barn);
      if (drop > 0.15) {
        const skH = drop + 0.8;
        const skirt = new THREE.Mesh(new THREE.BoxGeometry(6.7, skH, 8.7), barnSkirtMat);
        skirt.position.set(farm.x, fh - skH / 2 + 0.1, farm.z); skirt.rotation.y = farm.rot;
        skirt.castShadow = true; skirt.receiveShadow = true; scene.add(skirt);
      }
      colliders.push({ kind: "box", x: farm.x, z: farm.z, y: fh, rx: 3.3, rz: 4.3, height: 4.5 });

      // field IN FRONT of the barn (the barn faces its own field), axis-aligned rows
      const fwx = Math.sin(farm.rot), fwz = Math.cos(farm.rot);
      const fx = farm.x + fwx * (6 + farm.fieldD * 0.5), fz = farm.z + fwz * (6 + farm.fieldD * 0.5);
      const fw = farm.fieldW, fd = farm.fieldD;
      // terrain-following field fence (world space, then merged)
      const hwf = fw / 2, hdf = fd / 2;
      const fg = new THREE.Group();
      fenceLine(fg, fx - hwf, fz - hdf, fx + hwf, fz - hdf, fenceMat);
      fenceLine(fg, fx - hwf, fz + hdf, fx + hwf, fz + hdf, fenceMat);
      fenceLine(fg, fx - hwf, fz - hdf, fx - hwf, fz + hdf, fenceMat);
      fenceLine(fg, fx + hwf, fz - hdf, fx + hwf, fz + hdf, fenceMat);
      scene.add(mergeByMaterial(fg));

      // crop rows (instanced furrows running along x)
      const rows: THREE.Matrix4[] = [];
      const rowGeo = new THREE.BoxGeometry(fw - 1.5, 0.5, 0.35);
      for (let rz = -hdf + 1.2; rz < hdf - 1.0; rz += 1.0) {
        const x = fx, z = fz + rz, h = heightAt(x, z);
        rows.push(compose(x, h + 0.25, z, 1, 0));
      }
      instances(scene, rowGeo, cropMat, rows, true, true);
    }
  }

  console.log(`[props] village (${VILLAGE.houses.length} plots) + ${VILLAGE.farms.length} farms + ${VILLAGE.stands.length} forest stands`);
  return colliders;
}
