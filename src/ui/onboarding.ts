/**
 * Onboarding + friendliness layer — the things that decide whether a new player
 * stays past 30 seconds:
 *   • a first-run COACHMARK that teaches the core verbs once (climb/glide are
 *     otherwise undiscoverable), gated by localStorage so it shows a single time;
 *   • a SETTINGS + PAUSE menu (Esc): resume, sensitivity, volume, graphics quality,
 *     FPS toggle, reduced motion, and a persistent How-to-Play — closing the
 *     "no settings / no pause / no sensitivity" gap;
 *   • an OFFLINE banner so a server outage doesn't silently look like the
 *     multiplayer/agent product simply doesn't exist.
 *
 * Self-contained DOM in the project's dark-glass style. Opening any of these
 * releases the pointer + disables game input; closing re-locks so the camera
 * never silently "freezes" (the classic web-3D bounce).
 */
import { settings } from "./settings";
import type { Game } from "../game/game";
import type { Input } from "../core/input";

const SEEN_KEY = "skyward.onboarded";

interface Deps {
  game: () => Game | undefined;
  input: Input;
  releasePointer: () => void;
  requestLock: () => void;
}

const card =
  "background:#0b1722f2;border:1px solid #ffffff26;border-radius:16px;padding:22px 26px;" +
  "font:500 14px/1.55 system-ui,sans-serif;color:#eaf6ff;backdrop-filter:blur(8px);box-shadow:0 18px 60px #000a";
const scrim =
  "position:fixed;inset:0;z-index:40;display:none;align-items:center;justify-content:center;" +
  "background:radial-gradient(120% 120% at 50% 40%,#0a1423cc,#070d18ee);backdrop-filter:blur(3px)";
const BTN =
  "background:#1a3550;border:1px solid #ffffff2e;color:#eaf6ff;border-radius:10px;padding:9px 16px;" +
  "cursor:pointer;font:600 13px system-ui;transition:background .15s";
const ROW = "display:flex;align-items:center;gap:12px;margin:12px 0";
const LBL = "flex:1;opacity:.9";

export class UXLayer {
  private menu: HTMLDivElement;
  private coach: HTMLDivElement;
  private banner: HTMLDivElement;
  private _menuOpen = false;

  constructor(private deps: Deps) {
    this.menu = this.buildMenu();
    this.coach = this.buildCoach();
    this.banner = this.buildBanner();
    document.body.append(this.menu, this.coach, this.banner);
    settings.on((s) => { document.documentElement.classList.toggle("reduce-motion", s.reducedMotion); });
  }

  menuOpen() { return this._menuOpen; }

  // ---- first-run coachmark -------------------------------------------------
  coachmarkOnce() {
    try { if (localStorage.getItem(SEEN_KEY)) return; } catch { /* private mode → show anyway */ }
    this.deps.input.setEnabled(false);
    this.deps.releasePointer();
    this.coach.style.display = "flex";
  }
  private dismissCoach() {
    try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* ignore */ }
    this.coach.style.display = "none";
    this.deps.input.setEnabled(true);
    this.deps.requestLock();
  }

  // ---- pause / settings ----------------------------------------------------
  openMenu() {
    if (this._menuOpen) return;
    this._menuOpen = true;
    this.syncMenu();
    this.menu.style.display = "flex";
    this.deps.input.setEnabled(false);
    this.deps.releasePointer();
  }
  closeMenu() {
    if (!this._menuOpen) return;
    this._menuOpen = false;
    this.menu.style.display = "none";
    this.deps.input.setEnabled(true);
    this.deps.requestLock();
  }
  toggleMenu() { this._menuOpen ? this.closeMenu() : this.openMenu(); }

  // ---- offline banner ------------------------------------------------------
  setOnline(online: boolean) {
    this.banner.style.display = online ? "none" : "block";
  }

  private buildBanner(): HTMLDivElement {
    const b = document.createElement("div");
    b.style.cssText =
      "position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:8;display:none;" +
      "background:#2a1c10e8;border:1px solid #f0c27b55;border-radius:10px;padding:7px 15px;" +
      "font:600 12px system-ui;color:#f6d9a8;text-shadow:0 1px 2px #000a;pointer-events:none";
    b.textContent = "⚠ Couldn't reach the world — playing solo. Other players & agents are offline.";
    return b;
  }

  private buildCoach(): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = scrim;
    const verbs: [string, string][] = [
      ["WASD", "Move"],
      ["Mouse", "Look around"],
      ["Shift", "Sprint"],
      ["Space", "Jump · hold while falling to <b>glide</b>"],
      ["walk into a cliff", "<b>Climb</b> any steep wall"],
      ["E", "Gather · build · talk"],
    ];
    wrap.innerHTML =
      `<div style="${card};max-width:430px;text-align:center">
        <div style="font:800 22px system-ui;letter-spacing:.5px;margin-bottom:4px">Welcome to Skyward</div>
        <div style="opacity:.7;font-size:13px;margin-bottom:16px">Climb, glide, gather, and help grow a living valley that never stops being built — beside AI agents who live here too.</div>
        <div style="text-align:left;display:grid;grid-template-columns:auto 1fr;gap:8px 14px;margin-bottom:18px">
          ${verbs.map(([k, v]) => `<kbd style="background:#ffffff1c;border:1px solid #ffffff33;border-radius:6px;padding:2px 8px;font:600 12px system-ui;text-align:center;white-space:nowrap">${k}</kbd><span style="opacity:.92">${v}</span>`).join("")}
        </div>
        <button id="coach-go" style="${BTN};width:100%;padding:11px">Begin →</button>
        <div style="opacity:.5;font-size:11px;margin-top:10px">Press <b>Esc</b> any time for settings &amp; the full controls.</div>
      </div>`;
    wrap.querySelector("#coach-go")!.addEventListener("click", () => this.dismissCoach());
    return wrap;
  }

  private buildMenu(): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.style.cssText = scrim;
    wrap.innerHTML =
      `<div style="${card};max-width:460px;width:90%">
        <div style="font:800 20px system-ui;letter-spacing:.5px;margin-bottom:2px">Paused</div>
        <div style="opacity:.6;font-size:12px;margin-bottom:16px">Settings &amp; controls</div>

        <div style="${ROW}"><span style="${LBL}">Look sensitivity</span>
          <input id="set-sens" type="range" min="0.3" max="2.5" step="0.05" style="flex:1.3"><span id="set-sens-v" style="width:34px;text-align:right;opacity:.7"></span></div>
        <div style="${ROW}"><span style="${LBL}">Volume</span>
          <input id="set-vol" type="range" min="0" max="1" step="0.05" style="flex:1.3"><span id="set-vol-v" style="width:34px;text-align:right;opacity:.7"></span></div>
        <div style="${ROW}"><span style="${LBL}">Graphics</span>
          <button id="set-q-high" style="${BTN};padding:6px 12px">High</button><button id="set-q-low" style="${BTN};padding:6px 12px">Low</button></div>
        <div style="${ROW}"><span style="${LBL}">Show FPS</span><input id="set-fps" type="checkbox"></div>
        <div style="${ROW}"><span style="${LBL}">Reduce motion</span><input id="set-rm" type="checkbox"></div>

        <details style="margin:14px 0 4px"><summary style="cursor:pointer;opacity:.85;font-weight:600">How to play · all controls</summary>
          <div style="opacity:.82;font-size:12.5px;line-height:1.7;margin-top:8px">
            <b>Move</b> WASD · <b>Look</b> Mouse · <b>Sprint</b> Shift · <b>Jump/Glide</b> Space (hold while falling)<br/>
            <b>Climb</b> walk into a steep cliff · <b>Interact</b> E (gather / build / talk / fish)<br/>
            <b>Chat</b> Enter · <b>Command an agent</b> T · <b>Inventory</b> I · <b>Wardrobe</b> O<br/>
            <b>Claim land</b> R · <b>Boost/Flag</b> V/X · <b>Players</b> P · <b>The Feed</b> H · <b>Skills</b> K · <b>Emote</b> B · <b>Pause/Settings</b> Esc
          </div>
        </details>

        <div style="${ROW}"><span style="${LBL}">Tutorial</span><button id="set-skip" style="${BTN};padding:6px 12px">Skip onboarding</button></div>
        <button id="set-resume" style="${BTN};width:100%;padding:11px;margin-top:12px;background:#1f4a36;border-color:#7fdca055">Resume</button>
      </div>`;

    const $ = <T extends HTMLElement>(s: string) => wrap.querySelector(s) as T;
    const sens = $("#set-sens") as HTMLInputElement, sensV = $("#set-sens-v");
    const vol = $("#set-vol") as HTMLInputElement, volV = $("#set-vol-v");
    const fps = $("#set-fps") as HTMLInputElement, rm = $("#set-rm") as HTMLInputElement;

    sens.addEventListener("input", () => { settings.set({ sensitivity: +sens.value }); sensV.textContent = (+sens.value).toFixed(2); });
    vol.addEventListener("input", () => { settings.set({ volume: +vol.value }); volV.textContent = Math.round(+vol.value * 100) + ""; this.deps.game()?.setVolume(+vol.value); });
    fps.addEventListener("change", () => settings.set({ showFps: fps.checked }));
    rm.addEventListener("change", () => settings.set({ reducedMotion: rm.checked }));
    $("#set-q-high").addEventListener("click", () => { settings.set({ quality: "high" }); this.syncMenu(); });
    $("#set-q-low").addEventListener("click", () => { settings.set({ quality: "low" }); this.syncMenu(); });
    $("#set-skip").addEventListener("click", () => { this.deps.game()?.skipOnboarding(); this.closeMenu(); });
    $("#set-resume").addEventListener("click", () => this.closeMenu());
    return wrap;
  }

  private syncMenu() {
    const s = settings.state;
    const $ = <T extends HTMLElement>(sel: string) => this.menu.querySelector(sel) as T;
    ($("#set-sens") as HTMLInputElement).value = String(s.sensitivity);
    $("#set-sens-v").textContent = s.sensitivity.toFixed(2);
    ($("#set-vol") as HTMLInputElement).value = String(s.volume);
    $("#set-vol-v").textContent = Math.round(s.volume * 100) + "";
    ($("#set-fps") as HTMLInputElement).checked = s.showFps;
    ($("#set-rm") as HTMLInputElement).checked = s.reducedMotion;
    $("#set-q-high").style.outline = s.quality === "high" ? "2px solid var(--accent, #f0c27b)" : "none";
    $("#set-q-low").style.outline = s.quality === "low" ? "2px solid var(--accent, #f0c27b)" : "none";
  }
}
