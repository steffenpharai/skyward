/**
 * Procedural structure builders, keyed by StructureKind. These are what a
 * completed build-site spawns. The flagship 'cottage' reuses the town's own
 * makeHouse so new buildings match the village; the rest are authored here in
 * the same timber/stone/plaster palette.
 *
 * Returns the visual group plus an optional collider (so finished buildings can
 * block movement, same Structure shape the scatter/props colliders use).
 */
import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { makeHouse } from "../world/scatter";
import { surfaceMat } from "../world/materials";
import type { Structure } from "../world/scatter";
import { heightAt, footprintBase } from "../core/noise";
import type { StructureKind } from "./content/types";

export interface BuiltStructure {
  group: THREE.Group;
  collider?: Structure;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function emissive(color: number, intensity: number) {
  const m = new MeshStandardNodeMaterial({ color, roughness: 0.4, metalness: 0.1 });
  m.emissive = new THREE.Color(color); (m as any).emissiveIntensity = intensity;
  return m;
}

const M = {
  timber: () => surfaceMat({ kind: "wood", color: "#5a4126", rim: 0.25 }),
  plank:  () => surfaceMat({ kind: "plank", color: "#7a5a35", rim: 0.25 }),
  stone:  () => surfaceMat({ kind: "stone", color: "#8d8478", rim: 0.2 }),
  roof:   () => surfaceMat({ kind: "shingle", color: "#6f5536", rim: 0.2 }),
  water:  () => new MeshStandardNodeMaterial({ color: "#3f6f86", roughness: 0.3, metalness: 0 }),
  metal:  () => surfaceMat({ kind: "metal", color: "#c2cad3", rim: 0.28, roughness: 0.45, metalness: 0.6 }),
  dark:   () => new MeshStandardNodeMaterial({ color: "#39424e", roughness: 0.6, metalness: 0.4 }),
  glass:  () => new MeshStandardNodeMaterial({ color: "#bfe6f0", roughness: 0.1, metalness: 0, transparent: true, opacity: 0.4 }),
  panel:  () => new MeshStandardNodeMaterial({ color: "#1d2c5a", roughness: 0.3, metalness: 0.3 }),
  leaf:   () => new MeshStandardNodeMaterial({ color: "#5aa84a", roughness: 1 }),
  emBlue: () => emissive(0x49c6ff, 2.0),
  emGreen:() => emissive(0x6ee07a, 2.0),
  emOrange:() => emissive(0xff9a36, 2.2),
};

function add(g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m);
  return m;
}

/** Build a structure for the given site. `seedId` keeps it deterministic. */
export function buildStructure(kind: StructureKind, seedId: string, x: number, z: number, rot = 0): BuiltStructure {
  const rng = mulberry32(strHash(seedId + kind));
  const y = heightAt(x, z);
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rot;

  let collider: Structure | undefined;

  switch (kind) {
    case "cottage": {
      const house = makeHouse(rng);
      g.add(house);
      collider = { kind: "box", x, z, y, rx: 2.4, rz: 2.2, height: 3 };
      break;
    }
    case "well": {
      const stone = M.stone();
      const ring = add(g, new THREE.CylinderGeometry(1.0, 1.1, 1.0, 16), stone, 0, 0.5, 0);
      ring.receiveShadow = true;
      add(g, new THREE.CylinderGeometry(0.9, 0.9, 0.4, 16), M.water(), 0, 0.55, 0);
      const post = M.timber();
      add(g, new THREE.BoxGeometry(0.16, 1.8, 0.16), post, -0.9, 1.4, 0);
      add(g, new THREE.BoxGeometry(0.16, 1.8, 0.16), post, 0.9, 1.4, 0);
      const roof = add(g, new THREE.ConeGeometry(1.5, 0.9, 4), M.roof(), 0, 2.6, 0);
      roof.rotation.y = Math.PI / 4;
      collider = { kind: "cylinder", x, z, y, rx: 1.1, rz: 1.1, height: 1 };
      break;
    }
    case "granary": {
      // raised timber store on stone stilts
      const stone = M.stone();
      for (const sx of [-1.2, 1.2]) for (const sz of [-1.0, 1.0])
        add(g, new THREE.CylinderGeometry(0.22, 0.26, 1.0, 8), stone, sx, 0.5, sz);
      add(g, new THREE.BoxGeometry(3.2, 2.0, 2.6), M.plank(), 0, 2.0, 0);
      const roof = add(g, new THREE.ConeGeometry(2.6, 1.3, 4), M.roof(), 0, 3.6, 0);
      roof.rotation.y = Math.PI / 4;
      collider = { kind: "box", x, z, y, rx: 1.7, rz: 1.4, height: 3.2 };
      break;
    }
    case "mill": {
      add(g, new THREE.BoxGeometry(3.4, 3.0, 3.0), M.plank(), 0, 2.0, 0);
      const roof = add(g, new THREE.ConeGeometry(2.8, 1.6, 4), M.roof(), 0, 4.3, 0);
      roof.rotation.y = Math.PI / 4;
      // water wheel
      const wheel = new THREE.Group();
      const hubMat = M.timber();
      add(wheel as any, new THREE.CylinderGeometry(1.5, 1.5, 0.2, 18), hubMat, 0, 0, 0).rotation.x = Math.PI / 2;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const p = add(wheel as any, new THREE.BoxGeometry(0.5, 0.1, 0.6), M.plank(), Math.cos(a) * 1.3, Math.sin(a) * 1.3, 0);
        p.rotation.z = a;
      }
      wheel.position.set(2.0, 1.4, 0);
      g.add(wheel);
      (g.userData as any).wheel = wheel; // animated by BuildSites.update
      collider = { kind: "box", x, z, y, rx: 1.8, rz: 1.6, height: 3.2 };
      break;
    }
    case "bridge": {
      const deck = add(g, new THREE.BoxGeometry(2.2, 0.2, 6.0), M.plank(), 0, 0.4, 0);
      deck.receiveShadow = true;
      const rail = M.timber();
      for (const rx of [-1.0, 1.0]) {
        add(g, new THREE.BoxGeometry(0.12, 0.9, 6.0), rail, rx, 0.9, 0);
        for (const rz of [-2.5, 0, 2.5]) add(g, new THREE.BoxGeometry(0.16, 1.0, 0.16), rail, rx, 0.9, rz);
      }
      break; // walkable — no collider
    }
    case "workshop": {
      add(g, new THREE.BoxGeometry(4.0, 2.4, 3.2), M.plank(), 0, 1.7, 0);
      const roof = add(g, new THREE.BoxGeometry(4.4, 0.3, 3.6), M.roof(), 0, 3.0, 0);
      roof.rotation.z = 0.12;
      collider = { kind: "box", x, z, y, rx: 2.0, rz: 1.6, height: 2.9 };
      break;
    }
    case "signpost": {
      add(g, new THREE.BoxGeometry(0.16, 2.0, 0.16), M.timber(), 0, 1.0, 0);
      add(g, new THREE.BoxGeometry(1.2, 0.4, 0.08), M.plank(), 0.4, 1.7, 0);
      break;
    }

    // ---- Era III: modern hub ----
    case "solar": {
      for (let i = 0; i < 3; i++) {
        add(g, new THREE.BoxGeometry(2.2, 0.08, 1.4), M.panel(), (i - 1) * 2.5, 1.2, 0).rotation.x = -0.5;
        add(g, new THREE.CylinderGeometry(0.08, 0.08, 1.2, 6), M.metal(), (i - 1) * 2.5, 0.6, 0);
      }
      add(g, new THREE.BoxGeometry(0.6, 0.8, 0.5), M.dark(), 0, 0.4, 1.3);
      add(g, new THREE.BoxGeometry(0.3, 0.1, 0.2), M.emBlue(), 0, 0.85, 1.55);
      collider = { kind: "box", x, z, y, rx: 3.6, rz: 0.9, height: 1.6 };
      break;
    }
    case "greenhouse": {
      add(g, new THREE.BoxGeometry(4.0, 0.4, 2.6), M.metal(), 0, 0.2, 0);
      add(g, new THREE.BoxGeometry(3.8, 2.2, 2.4), M.glass(), 0, 1.5, 0);
      for (const sx of [-1.9, 1.9]) add(g, new THREE.BoxGeometry(0.08, 2.2, 2.4), M.metal(), sx, 1.5, 0);
      for (let i = 0; i < 6; i++) add(g, new THREE.ConeGeometry(0.18, 0.6, 5), M.leaf(), (i % 3 - 1) * 1.0, 0.8, i < 3 ? -0.6 : 0.6);
      collider = { kind: "box", x, z, y, rx: 2.0, rz: 1.4, height: 2.5 };
      break;
    }
    case "drone_hub": {
      add(g, new THREE.CylinderGeometry(1.8, 2.0, 0.3, 16), M.dark(), 0, 0.15, 0);
      add(g, new THREE.CylinderGeometry(1.4, 1.4, 0.05, 16), M.emBlue(), 0, 0.32, 0);
      add(g, new THREE.BoxGeometry(0.8, 2.5, 0.8), M.metal(), 1.5, 1.4, 1.5);
      const drone = new THREE.Group();
      add(drone, new THREE.BoxGeometry(0.4, 0.15, 0.4), M.metal(), 0, 0, 0);
      for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]] as const)
        add(drone, new THREE.CylinderGeometry(0.18, 0.18, 0.03, 8), M.dark(), dx, 0.08, dz);
      add(drone, new THREE.SphereGeometry(0.06, 6, 6), M.emOrange(), 0, -0.1, 0);
      drone.position.set(0, 2.2, 0); g.add(drone);
      collider = { kind: "cylinder", x, z, y, rx: 2.0, rz: 2.0, height: 0.6 };
      break;
    }
    case "reactor": {
      add(g, new THREE.CylinderGeometry(1.2, 1.4, 2.4, 16), M.metal(), 0, 1.2, 0);
      add(g, new THREE.CylinderGeometry(1.3, 1.3, 0.3, 16), M.emGreen(), 0, 2.4, 0);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; add(g, new THREE.BoxGeometry(0.15, 2.2, 0.5), M.dark(), Math.cos(a) * 1.5, 1.2, Math.sin(a) * 1.5).rotation.y = a; }
      add(g, new THREE.IcosahedronGeometry(0.4, 0), M.emBlue(), 0, 2.95, 0);
      collider = { kind: "cylinder", x, z, y, rx: 1.6, rz: 1.6, height: 3 };
      break;
    }

    // ---- Era IV: futuristic colony ----
    case "dome": {
      const d = add(g, new THREE.IcosahedronGeometry(3.0, 1), M.glass(), 0, 0.2, 0);
      d.scale.set(1, 0.55, 1);
      add(g, new THREE.TorusGeometry(2.9, 0.18, 8, 24), M.metal(), 0, 0.2, 0).rotation.x = Math.PI / 2;
      for (let i = 0; i < 4; i++) { const tr = add(g, new THREE.TorusGeometry(3.0, 0.05, 6, 20, Math.PI), M.metal(), 0, 0.2, 0); tr.rotation.y = i / 4 * Math.PI; }
      add(g, new THREE.SphereGeometry(0.3, 8, 8), M.emBlue(), 0, 1.2, 0);
      collider = { kind: "cylinder", x, z, y, rx: 3.0, rz: 3.0, height: 1.8 };
      break;
    }
    case "maglev": {
      add(g, new THREE.BoxGeometry(0.6, 4.0, 0.6), M.metal(), 0, 2.0, 0);
      add(g, new THREE.BoxGeometry(8.0, 0.3, 1.0), M.dark(), 0, 4.0, 0);
      add(g, new THREE.BoxGeometry(8.0, 0.06, 0.3), M.emBlue(), 0, 4.2, 0);
      add(g, new THREE.CapsuleGeometry(0.5, 2.0, 4, 8), M.metal(), 1.5, 3.4, 0).rotation.z = Math.PI / 2;
      collider = { kind: "box", x, z, y, rx: 0.6, rz: 0.6, height: 4 };
      break;
    }
    case "robot_bay": {
      add(g, new THREE.BoxGeometry(4.0, 3.0, 3.0), M.metal(), 0, 1.5, 0);
      add(g, new THREE.BoxGeometry(4.2, 0.3, 3.2), M.dark(), 0, 3.0, 0);
      add(g, new THREE.BoxGeometry(2.5, 2.2, 0.1), M.emBlue(), 0, 1.3, 1.55);
      const r = new THREE.Group();
      add(r, new THREE.CapsuleGeometry(0.3, 0.7, 4, 8), M.metal(), 0, 0.85, 0);
      add(r, new THREE.BoxGeometry(0.45, 0.36, 0.4), M.dark(), 0, 1.5, 0);
      add(r, new THREE.BoxGeometry(0.5, 0.06, 0.4), M.emBlue(), 0, 1.46, 0);
      r.position.set(0, 0, 2.2); g.add(r);
      collider = { kind: "box", x, z, y, rx: 2.0, rz: 1.6, height: 3 };
      break;
    }
  }

  // Seat on the highest ground under the footprint + skirt the downhill gap so
  // agent-authored structures never float on sloped frontier land (same fix as the
  // founding village). Uses the collider extents as the footprint.
  if (collider && (collider.rx || collider.rz)) {
    const fb = footprintBase(x, z, rot, (collider.rx || 1) + 0.2, (collider.rz || 1) + 0.2);
    g.position.y = fb.baseY;
    collider.y = fb.baseY;
    if (fb.drop > 0.2) {
      const skH = fb.drop + 0.8;
      const skirt = new THREE.Mesh(new THREE.BoxGeometry((collider.rx || 1) * 2 + 0.3, skH, (collider.rz || 1) * 2 + 0.3), M.stone());
      skirt.position.set(0, -skH / 2 + 0.1, 0);
      skirt.castShadow = true; skirt.receiveShadow = true;
      g.add(skirt);
    }
  }

  return { group: g, collider };
}
