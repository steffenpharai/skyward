/**
 * Region grid — server mirror of src/world/regions.ts.
 *
 * The authoritative world is an unbounded grid of square parcels over the infinite
 * heightfield. Region (0,0) is GENESIS, the founding settlement. The server owns
 * region claim + lifecycle state (Phase 2); this module is the shared math so the
 * server, the client, and external agents all resolve the SAME parcels.
 *
 * REGION_SIZE MUST equal the client's WORLD.size so genesis exactly fills (0,0).
 */
export const REGION_SIZE = 460; // == src/core/noise.ts WORLD.size

export function regionId(rx, rz) { return `r_${rx}_${rz}`; }

export function regionCoordsAt(x, z) {
  return { rx: Math.round(x / REGION_SIZE), rz: Math.round(z / REGION_SIZE) };
}
export function regionIdAt(x, z) {
  const { rx, rz } = regionCoordsAt(x, z);
  return regionId(rx, rz);
}

export function regionCenter(rx, rz) { return { x: rx * REGION_SIZE, z: rz * REGION_SIZE }; }

export function parseRegionId(id) {
  const m = /^r_(-?\d+)_(-?\d+)$/.exec(String(id || ""));
  return m ? { rx: +m[1], rz: +m[2] } : null;
}

/** Four edge-adjacent neighbours — frontier growth is 4-connected. */
export function neighbors(rx, rz) {
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ rx: rx + dx, rz: rz + dz }));
}

export const GENESIS = { rx: 0, rz: 0 };
export const GENESIS_ID = regionId(0, 0);

/**
 * A region is on the frontier (claimable) iff it is currently UNclaimed but
 * edge-adjacent to at least one claimed region. Genesis bootstraps the frontier.
 * `claimedSet` is a Set of claimed region ids.
 */
export function isFrontier(rx, rz, claimedSet) {
  if (claimedSet.has(regionId(rx, rz))) return false;
  return neighbors(rx, rz).some((n) => claimedSet.has(regionId(n.rx, n.rz)));
}
