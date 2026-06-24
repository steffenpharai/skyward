/**
 * Shared settlement spec — the buildable world the AUTHORITATIVE server owns. The
 * server tracks which sites are built (shared across everyone) + who built each, and
 * derives the era. Clients render the built world from this truth, so when one player
 * raises the Village Well, everyone sees it. (Per-player inventory/skills stay client-
 * side — those are personal, not shared.)
 *
 * Mirrors the build-site ids in src/game/content/era*.ts; advanceAt is 1.0 across the
 * board, so an era advances once ALL of its sites are built.
 */
export const ERA_SITES = {
  1: ["cottage_a", "well_a", "granary_a", "mill_a"],
  2: ["workshop_a", "bridge_a", "signpost_a"],
  3: ["solar_a", "greenhouse_a", "drone_a", "reactor_a"],
  4: ["dome_a", "maglev_a", "robot_a"],
};
export const MAX_ERA = 4;
export const SITE_ERA = {};
for (const [era, ids] of Object.entries(ERA_SITES)) for (const id of ids) SITE_ERA[id] = +era;

// Build-site world positions (mirrors src/game/content/era*.ts) so a networked agent
// can navigate to a site and raise it — it perceives unbuilt sites + walks to them.
export const SITE_POS = {
  cottage_a: { x: 6, z: 20 }, well_a: { x: 24, z: 2 }, granary_a: { x: 34, z: -14 }, mill_a: { x: -10, z: 34 },
  workshop_a: { x: 28, z: -16 }, bridge_a: { x: -18, z: 40 }, signpost_a: { x: 40, z: 4 },
  solar_a: { x: 40, z: -22 }, greenhouse_a: { x: 6, z: 30 }, drone_a: { x: 32, z: 12 }, reactor_a: { x: -6, z: -22 },
  dome_a: { x: -16, z: -16 }, maglev_a: { x: 46, z: -2 }, robot_a: { x: 22, z: 22 },
};

/** Current era from the set of built site ids (advance when an era is fully built). */
export function eraFromBuilt(builtSet) {
  let era = 1;
  for (let e = 1; e < MAX_ERA; e++) {
    if ((ERA_SITES[e] || []).every((id) => builtSet.has(id))) era = e + 1; else break;
  }
  return era;
}
