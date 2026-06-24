/**
 * Mobile touch control layer (mounted only in `body.mobile`, see docs/MOBILE_HUD.md).
 *
 * Provides locomotion (left thumbstick → WASD, right-area drag → camera look, Jump),
 * a primary contextual action (E) with an expandable verb fan, and a left rail of
 * panel shortcuts. The same input the keyboard drives, so every feature stays reachable.
 *
 * Critical: mobile has no Pointer Lock, so look + move are SUPPRESSED while any UI
 * surface is open (`uiOpen()`); otherwise a drag would keep rotating the camera behind
 * an open panel. Tappable controls use `touch-action: manipulation` (kills double-tap
 * zoom on mashing — WCAG-safe), drag surfaces use `touch-action: none`.
 */
import type { Input } from "./input";

export interface TouchApi {
  input: Input;
  /** True while any panel / sheet / text input / the title overlay is up. */
  uiOpen: () => boolean;
  /** T — agent command. Focuses an input, so it must run inside a real touch gesture. */
  openCmd: () => void;
  /** Enter — world chat. Likewise needs a genuine gesture for the soft keyboard. */
  openChat: () => void;
  /** ⚙ — pause / settings menu. */
  openMenu: () => void;
}

export function initTouch(api: TouchApi) {
  const { input, uiOpen } = api;

  const root = document.createElement("div");
  root.id = "touch";
  root.style.cssText = "position:fixed;inset:0;z-index:4;pointer-events:none;touch-action:none";
  document.body.appendChild(root);

  // Pure action verbs key off `e.code`, so a synthetic KeyboardEvent is enough. (The
  // input-focusing verbs T/Enter go through api.openCmd/openChat instead — a synthetic
  // event is not a user gesture and iOS would refuse to open the keyboard.)
  const fireKey = (code: string) => {
    for (const ty of ["keydown", "keyup"]) window.dispatchEvent(new KeyboardEvent(ty, { code, bubbles: true }));
  };

  // ---------------------------------------------------------------- camera look
  const lookArea = document.createElement("div");
  lookArea.className = "m-look";
  root.appendChild(lookArea);
  let lookId = -1, lx = 0, ly = 0;
  lookArea.addEventListener("touchstart", (e) => {
    if (uiOpen()) return;
    const t = e.changedTouches[0]; lookId = t.identifier; lx = t.clientX; ly = t.clientY;
  }, { passive: true });
  lookArea.addEventListener("touchmove", (e) => {
    if (uiOpen()) { lookId = -1; return; }
    for (const t of Array.from(e.changedTouches)) if (t.identifier === lookId) {
      input.addLook((t.clientX - lx) * 1.4, (t.clientY - ly) * 1.4); lx = t.clientX; ly = t.clientY;
    }
  }, { passive: true });
  const endLook = () => (lookId = -1);
  lookArea.addEventListener("touchend", endLook);
  lookArea.addEventListener("touchcancel", endLook);

  // ---------------------------------------------------------------- thumbstick
  const stick = document.createElement("div"); stick.className = "m-stick";
  const nub = document.createElement("div"); nub.className = "m-nub";
  stick.appendChild(nub); root.appendChild(stick);
  let stickId = -1;
  const setMove = (dx: number, dy: number) => {
    const dead = 0.30;   // radial dead zone — ignore resting-thumb jitter
    input.setKey("KeyW", dy < -dead); input.setKey("KeyS", dy > dead);
    input.setKey("KeyA", dx < -dead); input.setKey("KeyD", dx > dead);
    nub.style.transform = `translate(${dx * 35}px,${dy * 35}px)`;
  };
  const endStick = () => { stickId = -1; setMove(0, 0); };   // release WASD + recentre the nub
  stick.addEventListener("touchstart", (e) => {
    if (uiOpen()) return;
    stickId = e.changedTouches[0].identifier; e.preventDefault();
  }, { passive: false });
  stick.addEventListener("touchmove", (e) => {
    // A panel may open mid-drag (a second finger taps the rail). Zero the keys instead of
    // bailing, or the last WASD direction stays held and the avatar walks behind the panel.
    if (uiOpen()) { endStick(); return; }
    for (const t of Array.from(e.changedTouches)) if (t.identifier === stickId) {
      const r = stick.getBoundingClientRect();
      let dx = (t.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let dy = (t.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const len = Math.hypot(dx, dy); if (len > 1) { dx /= len; dy /= len; }
      setMove(dx, dy);
    }
  }, { passive: false });
  stick.addEventListener("touchend", endStick);
  stick.addEventListener("touchcancel", endStick);

  // ------------------------------------------------ bottom-right action cluster
  const mkBtn = (cls: string, label: string, pos: string) => {
    const b = document.createElement("button");
    b.className = "m-btn " + cls; b.textContent = label; b.style.cssText = pos;
    root.appendChild(b); return b;
  };
  const holdKey = (b: HTMLButtonElement, code: string, releaseDelay = 0) => {
    b.addEventListener("touchstart", (e) => { e.preventDefault(); input.setKey(code, true); }, { passive: false });
    const up = () => releaseDelay ? setTimeout(() => input.setKey(code, false), releaseDelay) : input.setKey(code, false);
    b.addEventListener("touchend", up); b.addEventListener("touchcancel", up);
  };
  // E is POLLED by the game loop; keep it down while held (a fast tap is held ≥1 frame).
  const eBtn = mkBtn("primary", "E", "right:calc(20px + var(--safe-r));bottom:calc(34px + var(--safe-b))");
  holdKey(eBtn, "KeyE", 60);
  // Jump (hold to glide once airborne — Space drives both, same as the keyboard).
  const jumpBtn = mkBtn("small", "Jump", "right:calc(30px + var(--safe-r));bottom:calc(124px + var(--safe-b))");
  holdKey(jumpBtn, "Space");

  // verb fan: ⋯ toggles a popover of the discrete world verbs
  const vpop = document.createElement("div"); vpop.className = "m-vpop";
  vpop.style.cssText = "right:calc(108px + var(--safe-r));bottom:calc(96px + var(--safe-b))";
  root.appendChild(vpop);
  const VERBS: { label: string; act: () => void }[] = [
    { label: "Claim", act: () => fireKey("KeyR") },
    { label: "Agent", act: () => api.openCmd() },
    { label: "Boost", act: () => fireKey("KeyV") },
    { label: "Flag", act: () => fireKey("KeyX") },
    { label: "Emote", act: () => fireKey("KeyB") },
    { label: "Photo", act: () => fireKey("KeyC") },
    { label: "Offer", act: () => fireKey("KeyF") },
  ];
  const PILL = "pointer-events:auto;touch-action:manipulation;width:104px;height:44px;border-radius:12px;" +
    "display:flex;align-items:center;justify-content:center;color:#eef4ff;font:600 12.5px var(--ui);" +
    "background:rgba(11,23,34,.74);border:1px solid rgba(255,255,255,.24);backdrop-filter:blur(6px);" +
    "-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent";
  for (const v of VERBS) {
    const b = document.createElement("button"); b.textContent = v.label; b.style.cssText = PILL;
    b.addEventListener("touchend", (e) => { e.preventDefault(); vpop.classList.remove("show"); if (!uiOpen()) v.act(); }, { passive: false });
    vpop.appendChild(b);
  }
  const verbsBtn = mkBtn("small", "⋯", "right:calc(108px + var(--safe-r));bottom:calc(34px + var(--safe-b));font-size:24px");
  verbsBtn.addEventListener("touchend", (e) => { e.preventDefault(); vpop.classList.toggle("show"); }, { passive: false });

  // ----------------------------------------------------- left rail: panel access
  const rail = document.createElement("div"); rail.className = "m-rail"; root.appendChild(rail);
  const morepop = () => document.getElementById("morepop");
  const railItem = (icon: string, label: string, act: () => void) => {
    const b = document.createElement("button"); b.className = "m-chip";
    b.innerHTML = `<span class="ic">${icon}</span>${label}`;
    b.addEventListener("touchend", (e) => { e.preventDefault(); act(); }, { passive: false });
    rail.appendChild(b);
  };
  // Five fit a single short-edge in landscape; Players/Goals/Skills/Wardrobe/Workshop
  // live one level down in the existing "More" popover (which already lists them).
  railItem("📖", "Feed", () => fireKey("KeyH"));
  railItem("🎒", "Pack", () => fireKey("KeyI"));
  railItem("💬", "Chat", () => api.openChat());
  railItem("⋯", "More", () => { const p = morepop(); if (p) p.style.display = p.style.display === "none" ? "flex" : "none"; });
  railItem("⚙", "Menu", () => api.openMenu());
}
