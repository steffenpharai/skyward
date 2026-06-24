/**
 * The Sky Dragon — Skyward's signature shared spectacle (plan §9, BotW homage).
 *
 * AUTHORITATIVE + DETERMINISTIC: its transform is a pure function of server wall
 * time, computed here and broadcast in every snapshot. Because ONE server computes
 * it and every client renders the broadcast value, every human AND every agent sees
 * the same dragon over the same peak at the same instant — a genuinely shared event
 * that neural world-models (no persistence, no shared state) cannot reproduce.
 *
 * Non-combat: you glide near it to commune (handled client-side). Here we only own
 * where it is and where it's heading.
 */
export const DRAGON = {
  period: 105000,   // ms for one full circuit (slow, serene)
  R: 116,           // circuit radius (sweeps over the valley, closer in)
  cx: -6, cz: 18,   // circuit centre (over the meadow/lake side)
  squash: 0.82,     // ellipse flattening on z
  cruiseY: 56,      // base cruise altitude (well above the peaks, still present)
  undulate: 13,     // vertical wave amplitude
  segments: 30,     // body segments (client renders this many)
  name: "Auranyx",  // the spirit-dragon's name (Era I form)
};

/** Authoritative transform of the dragon at wall-clock time `t` (ms). */
export function dragonAt(t) {
  const { period, R, cx, cz, squash, cruiseY, undulate } = DRAGON;
  const phase = ((t % period) / period) * Math.PI * 2;
  const x = cx + Math.cos(phase) * R;
  const z = cz + Math.sin(phase) * R * squash;
  const y = cruiseY + Math.sin(phase * 2) * undulate;
  // heading = tangent direction of travel (for facing the body forward)
  const dx = -Math.sin(phase) * R;
  const dz = Math.cos(phase) * R * squash;
  const heading = Math.atan2(dx, dz);
  // bank into the turn a little (cosmetic, client may use it)
  const bank = Math.cos(phase) * 0.25;
  return {
    x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2),
    heading: +heading.toFixed(3), bank: +bank.toFixed(3),
    phase: +phase.toFixed(3), active: true,
  };
}
