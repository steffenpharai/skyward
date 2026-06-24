/**
 * Wardrobe (press O) — dress your character. A live TURNTABLE preview of your
 * figure sits at the top (front-and-all-sides, with the face animating), and below
 * it you dye each slot, pick skin/hair/hairstyle, a hat and a cape. Every change
 * applies instantly to the preview AND the in-world figure, and broadcasts to
 * everyone in the world. Cozy-clean, hide-by-default.
 */
import type { Game } from "../game/game";
import type { Appearance, HatStyle, HairStyle } from "../game/characters";
import { DYES, CAPE_DYES, HAT_STYLES, SKIN_TONES, HAIR_DYES, HAIR_STYLES, DEFAULT_SKIN, DEFAULT_HAIR } from "../game/characters";
import { CharacterViewer } from "./characterViewer";

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

export function initWardrobe(game: Game) {
  const panel = document.createElement("div");
  panel.id = "wardrobe";
  panel.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,92vw);max-height:86vh;overflow:auto;display:none;z-index:10;background:#0b1722f4;border:1px solid #ffffff26;border-radius:16px;padding:18px 20px;font:500 13px/1.5 system-ui,sans-serif;color:#eaf6ff;backdrop-filter:blur(8px);box-shadow:0 16px 60px #000a";
  document.body.appendChild(panel);

  // --- persistent header: title + live turntable preview (never re-rendered) ---
  const titleEl = document.createElement("div");
  titleEl.innerHTML = `<div class="pnl-title">Wardrobe</div><div class="pnl-sub">Dress your wanderer — changes show instantly to everyone in the world. <kbd>O</kbd> to close</div>`;
  const viewerWrap = document.createElement("div");
  viewerWrap.style.cssText = "margin:8px auto 4px;width:148px;height:182px;border-radius:14px;background:radial-gradient(circle at 42% 32%, #2a456622, transparent 70%);";
  const viewerCanvas = document.createElement("canvas");
  viewerCanvas.width = 280; viewerCanvas.height = 344;
  viewerCanvas.style.cssText = "width:148px;height:182px;display:block";
  viewerWrap.append(viewerCanvas);
  const content = document.createElement("div");
  panel.append(titleEl, viewerWrap, content);

  let viewer: CharacterViewer | null = null;
  const ensureViewer = () => { if (!viewer) { try { viewer = new CharacterViewer(viewerCanvas); } catch { viewer = null; } } };

  const swatch = (color: number, active: boolean, onPick: () => void) => {
    const b = document.createElement("button");
    b.style.cssText = `width:30px;height:30px;border-radius:8px;cursor:pointer;background:${hex(color)};border:2px solid ${active ? "#fff" : "#ffffff22"};box-shadow:${active ? "0 0 8px #fff8" : "none"}`;
    b.onclick = onPick; return b;
  };
  const row = (label: string) => {
    const wrap = document.createElement("div"); wrap.style.cssText = "margin:10px 0 4px";
    const l = document.createElement("div"); l.textContent = label; l.style.cssText = "font:700 10px system-ui;letter-spacing:.6px;text-transform:uppercase;opacity:.6;margin-bottom:6px";
    const grid = document.createElement("div"); grid.style.cssText = "display:flex;flex-wrap:wrap;gap:6px";
    wrap.append(l, grid); return { wrap, grid };
  };

  function set(patch: Partial<Appearance>) {
    game.setAppearance({ ...game.appearance(), ...patch });
    viewer?.setAppearance(game.appearance());   // live turntable update
    render();
  }

  function render() {
    const a = game.appearance();
    content.innerHTML = "";

    const slots: [string, keyof Appearance, number[]][] = [
      ["Skin", "skin", SKIN_TONES], ["Tunic", "tunic", DYES], ["Hood & cloak", "hood", DYES],
      ["Trousers", "pants", DYES], ["Trim", "accent", DYES],
    ];
    for (const [label, key, colors] of slots) {
      const { wrap, grid } = row(label);
      const cur = key === "skin" ? (a.skin ?? DEFAULT_SKIN) : a[key];
      for (const c of colors) grid.append(swatch(c, cur === c, () => set({ [key]: c } as Partial<Appearance>)));
      content.append(wrap);
    }

    const pills = <T extends string>(label: string, items: { id: T; name: string }[], active: T, onPick: (id: T) => void) => {
      const { wrap, grid } = row(label);
      for (const it of items) {
        const b = document.createElement("button");
        b.textContent = it.name;
        b.style.cssText = `padding:6px 11px;border-radius:9px;cursor:pointer;font:600 12px system-ui;border:1px solid ${active === it.id ? "#fff" : "#ffffff26"};background:${active === it.id ? "#2a4a66" : "#162636"};color:#eaf6ff`;
        b.onclick = () => onPick(it.id);
        grid.append(b);
      }
      content.append(wrap);
    };

    pills("Headwear", HAT_STYLES, a.hat, (id) => set({ hat: id as HatStyle }));

    const { wrap: hairW, grid: hairG } = row("Hair colour");
    const curHair = a.hair ?? DEFAULT_HAIR;
    for (const c of HAIR_DYES) hairG.append(swatch(c, curHair === c, () => set({ hair: c })));
    content.append(hairW);
    pills("Hairstyle", HAIR_STYLES, a.hairStyle ?? "tousled", (id) => set({ hairStyle: id as HairStyle }));

    // cape (None + colours)
    const { wrap: cw, grid: cg } = row("Cape");
    const none = document.createElement("button");
    none.textContent = "None";
    none.style.cssText = `padding:6px 11px;border-radius:9px;cursor:pointer;font:600 12px system-ui;border:1px solid ${a.cape === null ? "#fff" : "#ffffff26"};background:${a.cape === null ? "#2a4a66" : "#162636"};color:#eaf6ff`;
    none.onclick = () => set({ cape: null });
    cg.append(none);
    for (const c of CAPE_DYES) cg.append(swatch(c, a.cape === c, () => set({ cape: c })));
    content.append(cw);

    const close = document.createElement("button");
    close.textContent = "Done";
    close.style.cssText = "margin-top:16px;width:100%;padding:9px;border-radius:10px;border:1px solid #ffffff2a;background:#1a3550;color:#eaf6ff;cursor:pointer;font:700 13px system-ui";
    close.onclick = () => toggle(false);
    content.append(close);
  }

  let open = false;
  function toggle(force?: boolean) {
    open = force ?? !open;
    panel.style.display = open ? "block" : "none";
    if (open) {
      ensureViewer();
      viewer?.setAppearance(game.appearance());
      viewer?.start();
      render();
    } else {
      viewer?.stop();
    }
  }
  return { toggle, isOpen: () => open };
}
