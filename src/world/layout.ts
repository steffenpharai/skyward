import { heightAt, slopeDeg, LAKE, WORLD } from "../core/noise";

/**
 * The world LAYOUT — intentional composition instead of random scatter.
 * Computes a village (houses lined up along a street + fenced yards + a square
 * around the tower), farmsteads (barn + fenced field) out in the meadow, and
 * forest stands (so trees cluster into woods). Every placer reads from here so
 * the world reads as a designed place, not noise.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TOWN = { x: 18, z: -6 };

export interface HousePlot { x: number; z: number; rot: number; halfW: number; halfD: number; }
export interface Farm { x: number; z: number; rot: number; fieldW: number; fieldD: number; }
export interface Stand { x: number; z: number; r: number; }

export interface WorldLayout {
  houses: HousePlot[];
  road: { x: number; z: number }[]; // cobble centreline points
  farms: Farm[];
  stands: Stand[]; // forest centres
}

function buildLayout(): WorldLayout {
  const rng = mulberry32(70707);
  const cx = TOWN.x, cz = TOWN.z;
  const houses: HousePlot[] = [];
  const road: { x: number; z: number }[] = [];

  // ---- main street: a straight road out of the square; houses line both sides ----
  const streetAng = -0.55;
  const dx = Math.cos(streetAng), dz = Math.sin(streetAng);
  const px = -dz, pz = dx; // perpendicular (the two sides of the street)

  // Village geometry. Yards are ~10×10 (yard half = plot.half + ~2.5), so to keep
  // fenced yards from overlapping: along-street SPACING must exceed yard width, and
  // the cross-street OFFSET must leave a road gap between the two rows' yards.
  const HW = 2.5, HD = 2.4;     // plot halves -> yard ~9.8 × 10.0
  const OFFSET = 8.5;           // house centre distance from the street centreline
  const SPACING = 12.5;         // along-street gap between rows (> yard width 10)
  const START = 14, ROWS = 5;   // first row 14 out of the square; 5 rows per side

  // varied plots: each gets a slightly different yard size + a touch of jitter so
  // the street doesn't read as identical clones.
  const plot = (x: number, z: number, rot: number) => {
    if (slopeDeg(x, z) > 16) return;
    houses.push({ x, z, rot: rot + (rng() - 0.5) * 0.08, halfW: HW + rng() * 0.6, halfD: HD + rng() * 0.5 });
  };
  for (let r = 0; r < ROWS; r++) {
    const d = START + r * SPACING;
    const scx = cx + dx * d, scz = cz + dz * d;
    road.push({ x: scx, z: scz });
    for (const side of [-1, 1]) {
      const x = scx + px * side * OFFSET, z = scz + pz * side * OFFSET;
      plot(x, z, Math.atan2(scx - x, scz - z)); // front faces the road
    }
  }
  // houses framing the OTHER side of the square (behind the tower), facing in —
  // turns the open green into an enclosed plaza.
  for (const b of [{ d: -15, p: 0 }, { d: -12, p: -11.5 }, { d: -12, p: 11.5 }]) {
    const x = cx + dx * b.d + px * b.p, z = cz + dz * b.d + pz * b.p;
    plot(x, z, Math.atan2(cx - x, cz - z)); // face the square centre
  }
  // cobble street: down the centreline and back through the square (tower + well)
  for (let d = -16; d <= START + ROWS * SPACING; d += 1.3) road.push({ x: cx + dx * d, z: cz + dz * d });

  // ---- farmsteads: a barn + fenced field out in the flatter meadow ----
  const farms: Farm[] = [];
  let ftries = 0;
  while (farms.length < 2 && ftries < 400) {
    ftries++;
    const a = rng() * Math.PI * 2, rad = 42 + rng() * 28;
    const x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad;
    const h = heightAt(x, z);
    if (h < LAKE.level + 2 || h > 22 || slopeDeg(x, z) > 12) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 8) continue;
    if (farms.some((f) => Math.hypot(f.x - x, f.z - z) < 40)) continue;
    farms.push({ x, z, rot: rng() * Math.PI * 2, fieldW: 14 + rng() * 6, fieldD: 10 + rng() * 5 });
  }

  // ---- forest stands: dense tree clusters (the "woods") ----
  const stands: Stand[] = [];
  let stries = 0;
  while (stands.length < 5 && stries < 600) {
    stries++;
    const a = rng() * Math.PI * 2, rad = 55 + rng() * 80;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (Math.abs(x) > WORLD.half - 30 || Math.abs(z) > WORLD.half - 30) continue;
    const h = heightAt(x, z);
    if (h < LAKE.level + 2 || h > 46) continue;
    if (Math.hypot(x - TOWN.x, z - TOWN.z) < 35) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 10) continue;
    if (stands.some((st) => Math.hypot(st.x - x, st.z - z) < 38)) continue;
    if (farms.some((f) => Math.hypot(f.x - x, f.z - z) < 30)) continue;
    stands.push({ x, z, r: 20 + rng() * 14 });
  }

  return { houses, road, farms, stands };
}

export const VILLAGE = buildLayout();

/** Forest density multiplier at a point: high inside a stand, low outside. */
export function standDensity(x: number, z: number): number {
  let d = 0.06; // sparse scattered trees everywhere
  for (const st of VILLAGE.stands) {
    const dd = Math.hypot(x - st.x, z - st.z);
    if (dd < st.r) d = Math.max(d, 0.9 * (1 - (dd / st.r) * 0.6));
  }
  return d;
}

/** True if a point sits inside a house yard or on the road (keep trees/props out). */
export function inVillage(x: number, z: number, margin = 0): boolean {
  if (Math.hypot(x - TOWN.x, z - TOWN.z) < 18 + margin) return true;
  for (const h of VILLAGE.houses) if (Math.abs(x - h.x) < h.halfW + 3 + margin && Math.abs(z - h.z) < h.halfD + 3 + margin) return true;
  for (const f of VILLAGE.farms) if (Math.abs(x - f.x) < f.fieldW + margin && Math.abs(z - f.z) < f.fieldD + margin) return true;
  return false;
}
