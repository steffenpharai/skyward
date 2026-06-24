/**
 * Client-side Sky Dragon flight path — the deterministic twin of the authoritative
 * server math in `server/shared/dragon.mjs`. The constants here MUST match that file
 * (they describe the same circuit). When online, the server's broadcast dragon wins;
 * offline / single-player / first-load, this drives the dragon locally so the hero
 * spectacle is ALWAYS present — it must never be invisible just because no server is up.
 */
export const DRAGON_PATH = {
  period: 105000,   // ms for one serene circuit
  R: 116,           // circuit radius
  cx: -6, cz: 18,   // circuit centre (over the meadow/lake)
  squash: 0.82,     // ellipse flattening on z
  cruiseY: 56,      // base cruise altitude
  undulate: 13,     // vertical wave amplitude
};

export interface DragonTransform {
  x: number; y: number; z: number; heading: number; bank: number; phase: number; active: boolean;
}

/** Deterministic dragon transform at wall-clock-ish time `t` (ms). */
export function dragonAtClient(t: number): DragonTransform {
  const { period, R, cx, cz, squash, cruiseY, undulate } = DRAGON_PATH;
  const phase = ((t % period) / period) * Math.PI * 2;
  const x = cx + Math.cos(phase) * R;
  const z = cz + Math.sin(phase) * R * squash;
  const y = cruiseY + Math.sin(phase * 2) * undulate;
  const dx = -Math.sin(phase) * R;
  const dz = Math.cos(phase) * R * squash;
  const heading = Math.atan2(dx, dz);
  const bank = Math.cos(phase) * 0.25;
  return { x, y, z, heading, bank, phase, active: true };
}
