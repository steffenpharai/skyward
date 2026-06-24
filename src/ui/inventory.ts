/**
 * Inventory (press I) — a real grid pack, not just chips: every item you carry,
 * grouped by category, with a coloured icon + count, a live total, and a shortcut
 * to the Wardrobe. Updates instantly as items change.
 */
import type { Game } from "../game/game";
import { allItems } from "../game/content";

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");
const categoryOf = (id: string): string =>
  /grain|fish|crop|food|berry|honey/.test(id) ? "Food" :
  /lightmote|ember|relic|star|crystal/.test(id) ? "Treasures" : "Materials";
const ORDER = ["Materials", "Food", "Treasures"];

export function initInventory(game: Game, openWardrobe: () => void) {
  const panel = document.createElement("div");
  panel.id = "inventory";
  panel.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(460px,92vw);max-height:82vh;overflow:auto;display:none;z-index:10;background:#0b1722f4;border:1px solid #ffffff26;border-radius:16px;padding:18px 20px;font:500 13px system-ui,sans-serif;color:#eaf6ff;backdrop-filter:blur(8px);box-shadow:0 16px 60px #000a";
  document.body.appendChild(panel);

  function render() {
    const inv = game.store.state.inventory as Record<string, number>;
    const owned = allItems().filter((it) => (inv[it.id] ?? 0) > 0);
    const total = owned.reduce((n, it) => n + (inv[it.id] ?? 0), 0);
    const groups: Record<string, typeof owned> = {};
    for (const it of owned) (groups[categoryOf(it.id)] ||= []).push(it);

    let html = `<div style="display:flex;align-items:baseline;gap:8px"><span class="pnl-title" style="flex:1">Pack</span><span style="opacity:.5;font-size:11.5px">${total} ${total === 1 ? "item" : "items"}</span></div><div class="pnl-sub">Everything you've gathered · <kbd>I</kbd> to close</div>`;
    if (!owned.length) html += `<div style="opacity:.5;padding:18px 0;text-align:center">Your pack is empty — gather, forage, fish, and commune to fill it.</div>`;
    for (const cat of ORDER) {
      const items = groups[cat]; if (!items?.length) continue;
      html += `<div style="font:700 10px system-ui;letter-spacing:.6px;text-transform:uppercase;opacity:.55;margin:12px 0 6px">${cat}</div>`;
      html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px">`;
      for (const it of items) {
        html += `<div title="${it.name}" style="background:#ffffff0d;border:1px solid #ffffff18;border-radius:11px;padding:9px 8px;display:flex;flex-direction:column;align-items:center;gap:4px">
          <span style="width:26px;height:26px;border-radius:7px;background:${hex(it.color)};box-shadow:0 0 8px ${hex(it.color)}66"></span>
          <span style="font-size:11px;opacity:.85;text-align:center;line-height:1.1">${it.name}</span>
          <span style="font:700 13px system-ui">${inv[it.id]}</span></div>`;
      }
      html += `</div>`;
    }
    html += `<button id="invward" style="margin-top:16px;width:100%;padding:9px;border-radius:10px;border:1px solid #ffffff2a;background:#243d56;color:#eaf6ff;cursor:pointer;font:700 13px system-ui">👗 Open Wardrobe (O)</button>`;
    panel.innerHTML = html;
    panel.querySelector("#invward")?.addEventListener("click", () => { toggle(false); openWardrobe(); });
  }

  let open = false;
  function toggle(force?: boolean) { open = force ?? !open; panel.style.display = open ? "block" : "none"; if (open) render(); }
  game.store.on("inventory", () => { if (open) render(); });
  return { toggle, isOpen: () => open };
}
