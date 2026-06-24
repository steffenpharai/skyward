/**
 * HUD controller for the gameplay layer — era panel, objective, inventory chips,
 * a live minimap with points of interest, agent oversight, toasts, the
 * interaction prompt, dialogue, and era banners.
 */
import type { GameState } from "./state";
import type { ItemDef } from "./content/types";
import { SKILLS, skillProgress } from "./skills";

function hex(c: number): string { return "#" + c.toString(16).padStart(6, "0"); }

/** Escape untrusted text (agent-supplied names/actions/chat) before HTML interpolation. */
function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export interface MinimapData {
  player: { x: number; z: number; facing: number };
  sites: { x: number; z: number; built: boolean; name: string }[];
  resources: { x: number; z: number; color: number }[];
  villagers: { x: number; z: number }[];
  agents: { x: number; z: number }[];
  netPlayers?: { x: number; z: number; kind: string; mine: boolean }[];
  dragon?: { x: number; z: number } | null;
  regions?: { cx: number; cz: number; size: number; kind: string }[];   // claim-map cells (world space)
  waypoint?: { x: number; z: number } | null;                            // onboarding quest target
}

const MAP_RANGE = 150;   // world units shown from centre to edge

export class Hud {
  private prompt = document.getElementById("prompt")!;
  private inv = document.getElementById("inv")!;
  private eraLabel = document.getElementById("era-label")!;
  private eraBar = document.getElementById("era-bar") as HTMLDivElement;
  private objective = document.getElementById("objective")!;
  private banner = document.getElementById("era-banner")!;
  private dialogueEl = document.getElementById("dialogue")!;
  private agentsEl = document.getElementById("agents")!;
  private toasts = document.getElementById("toasts")!;
  private mini = document.getElementById("minimap") as HTMLCanvasElement;
  private mctx = this.mini.getContext("2d")!;
  private flashT = 0;
  private bannerT = 0;
  private dialogueT = 0;

  setPrompt(text: string | null) {
    if (text) {
      // bold the trailing "(E)" hint into a kbd glyph
      this.prompt.innerHTML = text.replace(/\(E\)\s*$/, '<kbd>E</kbd>');
      this.prompt.classList.add("show");
    } else this.prompt.classList.remove("show");
  }

  renderInventory(state: GameState, items: ItemDef[]) {
    this.inv.innerHTML = items
      .filter((it) => (state.inventory[it.id] ?? 0) > 0)
      .map((it) => `<span class="chip"><i style="background:${hex(it.color)};color:${hex(it.color)}"></i>${it.name}<b>${state.inventory[it.id]}</b></span>`)
      .join("");
  }

  setEra(name: string, built: number, total: number, ratio: number) {
    this.eraLabel.innerHTML = `<span class="num">${name}</span> · ${built}/${total} built`;
    this.eraBar.style.width = (ratio * 100).toFixed(1) + "%";
  }

  setObjective(text: string) { this.objective.textContent = text; }

  private questEl = document.getElementById("quest");
  /** The onboarding quest tracker (HTML, or null to hide). */
  setQuest(html: string | null) {
    if (!this.questEl) return;
    if (html) { this.questEl.innerHTML = html; this.questEl.classList.add("show"); }
    else this.questEl.classList.remove("show");
  }

  private scoreEl = document.getElementById("score")!;
  private beautyEl = document.getElementById("beauty")!;

  setBeauty(best: number, count: number) {
    this.beautyEl.innerHTML = count
      ? `<span class="lbl">BEAUTY</span> ${(best * 100) | 0}<span class="cnt"> · ${count} works</span>`
      : "";
  }

  private skillsEl = document.getElementById("skills")!;
  renderSkills(state: GameState) {
    this.skillsEl.innerHTML =
      `<div class="pnl-title">Skills</div>
       <div class="pnl-sub">Master a craft — every 2 levels lifts your gathering yield. <kbd>K</kbd> to close.</div>` +
      SKILLS.map((s) => {
        const p = skillProgress(state.skills[s.id] ?? 0);
        const bonus = Math.floor(p.level / 2);
        return `<div class="skrow">
          <span class="skicon">${s.icon}</span>
          <div style="flex:1;min-width:0">
            <div class="skline"><b>${s.name}</b><span class="sklv">Lv ${p.level}${bonus ? ` · <span style="color:#8fe26a">+${bonus} yield</span>` : ""}</span></div>
            <div class="skbar"><span style="width:${(p.frac * 100).toFixed(0)}%"></span></div>
          </div>
          <span class="skxp">${p.into}/${p.span}</span>
        </div>`;
      }).join("");
  }

  setScore(score: number, high: number) {
    this.scoreEl.innerHTML = `<span class="lbl">SCORE</span> ${score}<span class="best">best ${high}</span>`;
  }

  setAgents(rows: { name: string; doing: string; mine?: boolean; say?: string | null; id?: string }[]) {
    this.agentsEl.innerHTML = rows.length
      ? `<div class="hdr">AI agents · ${rows.length}</div>` + rows.map((r) =>
          `<div class="row"${r.id ? ` data-agent-id="${esc(r.id)}" style="cursor:pointer"` : ""}><b>${esc(r.name)}</b>${r.mine ? '<span style="color:#ffd27f;font-size:9px;margin-left:5px;letter-spacing:.5px">YOURS</span>' : ""} <span style="opacity:.82">${esc(r.doing)}</span>${r.say ? `<div style="opacity:.7;font-style:italic;margin-top:1px">“${esc(r.say)}”</div>` : ""}</div>`).join("")
      : "";
  }

  showBanner(text: string, seconds = 4) {
    this.banner.textContent = text;
    this.banner.classList.add("show");
    this.bannerT = seconds;
  }

  dialogue(name: string, text: string, seconds = 5) {
    this.dialogueEl.innerHTML = `<b>${esc(name)}</b>${esc(text)}`;
    this.dialogueEl.classList.add("show");
    this.dialogueT = seconds;
  }

  /** Transient corner notification (gather/build/era/contribution events). */
  toast(text: string) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    this.toasts.appendChild(el);
    setTimeout(() => el.remove(), 2900);
    while (this.toasts.children.length > 4) this.toasts.firstChild!.remove();
  }

  flash() { this.inv.classList.add("flash"); this.flashT = 0.4; }

  /** Draw the minimap from world positions (north-up, player-centred). */
  renderMinimap(d: MinimapData) {
    const ctx = this.mctx, S = this.mini.width, c = S / 2, R = c - 6;
    const scale = R / MAP_RANGE;
    const px = d.player.x, pz = d.player.z;
    const map = (x: number, z: number) => [c + (x - px) * scale, c + (z - pz) * scale] as const;
    const inRange = (x: number, z: number) => Math.hypot(x - px, z - pz) < MAP_RANGE + 6;

    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.clip();
    const g = ctx.createRadialGradient(c, c, 4, c, c, R);
    g.addColorStop(0, "rgba(40,60,80,.5)"); g.addColorStop(1, "rgba(12,20,30,.55)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);

    // Region claim-map overlay (under the markers): tint + outline developed parcels,
    // dashed gold for claimable frontier land. Genesis/published = green commons.
    const REGION_TINT: Record<string, { fill: string; stroke: string; dash: boolean }> = {
      mine:      { fill: "rgba(240,194,123,.14)", stroke: "rgba(240,194,123,.85)", dash: false },
      other:     { fill: "rgba(110,180,255,.10)", stroke: "rgba(140,195,255,.7)",  dash: false },
      published: { fill: "rgba(127,220,160,.10)", stroke: "rgba(140,225,170,.65)", dash: false },
      frontier:  { fill: "rgba(240,194,123,.04)", stroke: "rgba(240,194,123,.6)",  dash: true },
    };
    for (const rg of d.regions ?? []) {
      const t = REGION_TINT[rg.kind]; if (!t) continue;
      const h = rg.size / 2;
      const [x0, y0] = map(rg.cx - h, rg.cz - h);
      const w = rg.size * scale;
      ctx.fillStyle = t.fill; ctx.fillRect(x0, y0, w, w);
      ctx.strokeStyle = t.stroke; ctx.lineWidth = 1; ctx.setLineDash(t.dash ? [4, 3] : []);
      ctx.strokeRect(x0, y0, w, w);
    }
    ctx.setLineDash([]);

    const dot = (x: number, z: number, r: number, fill: string, glow = false) => {
      if (!inRange(x, z)) return;
      const [sx, sy] = map(x, z);
      if (glow) { ctx.shadowColor = fill; ctx.shadowBlur = 5; }
      ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    };
    // Agents render as a DIAMOND (humans = circle) so identity isn't colour-only — a
    // colourblind player can still tell people from AI on the map.
    const diamond = (x: number, z: number, r: number, fill: string, glow = false) => {
      if (!inRange(x, z)) return;
      const [sx, sy] = map(x, z);
      if (glow) { ctx.shadowColor = fill; ctx.shadowBlur = 5; }
      ctx.fillStyle = fill; ctx.save(); ctx.translate(sx, sy); ctx.rotate(Math.PI / 4);
      ctx.fillRect(-r, -r, r * 2, r * 2); ctx.restore(); ctx.shadowBlur = 0;
    };

    for (const r of d.resources) { ctx.globalAlpha = .65; dot(r.x, r.z, 1.4, hex(r.color)); }
    ctx.globalAlpha = 1;
    for (const v of d.villagers) dot(v.x, v.z, 2.1, "#8fe26a");
    for (const s of d.sites) {
      if (s.built) dot(s.x, s.z, 2.4, "rgba(220,220,220,.55)");
      else if (inRange(s.x, s.z)) {
        const [sx, sy] = map(s.x, s.z);
        ctx.strokeStyle = "#f0c27b"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx, sy, 3.2, 0, Math.PI * 2); ctx.stroke();
      }
    }
    for (const a of d.agents) diamond(a.x, a.z, 2.4, "#49c6ff", true);
    // networked players: humans = circle, agents = diamond (colour + shape, a11y).
    for (const np of d.netPlayers ?? []) {
      const col = np.kind === "human" ? "#7fdca0" : np.mine ? "#ffd27f" : "#9fe0ff";
      if (np.kind === "human") dot(np.x, np.z, 2.8, col, true);
      else diamond(np.x, np.z, 2.4, col, true);
    }
    // the Sky Dragon — a distinct diamond marker even at the map edge
    if (d.dragon && inRange(d.dragon.x, d.dragon.z)) {
      const [sx, sy] = map(d.dragon.x, d.dragon.z);
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(Math.PI / 4);
      ctx.shadowColor = "#9fe6ff"; ctx.shadowBlur = 7; ctx.fillStyle = "#bff0ff";
      ctx.fillRect(-3, -3, 6, 6); ctx.restore(); ctx.shadowBlur = 0;
    }
    // onboarding waypoint — a gold star, clamped to the rim so it always points the way
    if (d.waypoint) {
      const wdx = d.waypoint.x - px, wdz = d.waypoint.z - pz;
      const wd = Math.hypot(wdx, wdz);
      const wr = Math.min(R - 4, wd * scale);
      const wx = c + (wdx / (wd || 1)) * wr, wy = c + (wdz / (wd || 1)) * wr;
      ctx.fillStyle = "#ffd27f"; ctx.shadowColor = "#ffd27f"; ctx.shadowBlur = 8;
      ctx.font = "bold 13px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("✦", wx, wy); ctx.shadowBlur = 0;
    }
    ctx.restore();

    // player arrow at centre
    ctx.save();
    ctx.translate(c, c); ctx.rotate(d.player.facing);
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.moveTo(0, -5.5); ctx.lineTo(3.5, 4); ctx.lineTo(0, 1.8); ctx.lineTo(-3.5, 4); ctx.closePath(); ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.stroke();
  }

  update(dt: number) {
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.inv.classList.remove("flash"); }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.banner.classList.remove("show"); }
    if (this.dialogueT > 0) { this.dialogueT -= dt; if (this.dialogueT <= 0) this.dialogueEl.classList.remove("show"); }
  }
}
