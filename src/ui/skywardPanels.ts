/**
 * Skyward client panels:
 *  - Workshop (builders): rich context OF THE GAME — population, friction, and a subsystem→
 *    GitHub orientation map — so you know what's worth improving, then a one-click
 *    "Report / Suggest" that opens a prefilled GitHub issue under YOUR OWN identity.
 *    Game context, never source; the repo is on GitHub.
 *  - Brain Console (owner only): the gameplay AI's recent decisions + token/$ meter, read
 *    from /brain/status (owner-gated). Gameplay only — no issues, no code.
 *
 * Both follow the wardrobe/inventory panel pattern: a fixed overlay with toggle()/isOpen().
 */

const PANEL_CSS =
  "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:380px;max-height:78vh;overflow:auto;" +
  "display:none;z-index:11;background:#0b1722f6;border:1px solid #ffffff26;border-radius:16px;padding:16px 18px;" +
  "font:500 12.5px/1.5 'Hanken Grotesk',system-ui,sans-serif;color:#eaf6ff;backdrop-filter:blur(10px);box-shadow:0 22px 64px #000c";
const esc = (s: any) => String(s).replace(/[<>&]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" } as Record<string, string>)[m]!);

export interface Panel { toggle(force?: boolean): void; isOpen(): boolean; }

// ---- Workshop (game context → contribute on GitHub) -------------------------
export function initWorkshop(base: string, repo: string, getContext: () => { region: string; lookingAt?: string }): Panel {
  const el = document.createElement("div");
  el.id = "workshop"; el.style.cssText = PANEL_CSS;
  document.body.appendChild(el);

  async function render() {
    el.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="flex:1;font:700 15px 'Fraunces',serif;color:#ffd27f">Workshop</span>
        <span style="opacity:.6;font-size:11px">improve the world</span></div>
      <div style="opacity:.7;font-size:11px;margin-bottom:10px">See how the world plays, then build it. You contribute on GitHub under your own identity — the owner reviews + ships everything.</div>
      <div id="ws-body" style="opacity:.8">Loading the world's context…</div>`;
    let ctx: any = {}, tele: any = {}, orient: any = {}, issues: any = {};
    try {
      [ctx, tele, orient, issues] = await Promise.all([
        fetch(`${base}/context/game`).then((r) => r.json()).catch(() => ({})),
        fetch(`${base}/context/telemetry`).then((r) => r.json()).catch(() => ({})),
        fetch(`${base}/context/orientation`).then((r) => r.json()).catch(() => ({})),
        fetch(`${base}/context/issues`).then((r) => r.json()).catch(() => ({})),
      ]);
    } catch { /* offline */ }
    const here = getContext();
    const friction = (tele.friction || []).slice(0, 5);
    const subs = (orient.subsystems || []);
    const body = el.querySelector("#ws-body") as HTMLElement; if (!body) return;
    body.innerHTML =
      `<div style="margin:2px 0 10px"><b>Now:</b> ${ctx.counts ? `${ctx.counts.total} online (${ctx.counts.humans}🙂 ${ctx.counts.agents}🤖)` : "—"} · you're in <b>${esc(here.region)}</b></div>
       <div style="font:700 12px;color:#9fe0ff;margin:8px 0 4px">What's playing rough</div>
       ${friction.length ? friction.map((f: any) => `<div style="opacity:.85;padding:2px 0">• ${esc(f.where)} — ${esc(f.what)} <span style="opacity:.5">×${f.count}</span></div>`).join("") : '<div style="opacity:.5">nothing flagged right now</div>'}
       <div style="font:700 12px;color:#9fe0ff;margin:12px 0 4px">Where things live (read the code on GitHub)</div>
       ${subs.slice(0, 6).map((s: any) => `<div style="opacity:.85;padding:2px 0">• <b>${esc(s.area)}</b> → <span style="opacity:.7">${esc(s.path)}</span></div>`).join("")}
       <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
         <a id="ws-report" href="#" style="flex:1;text-align:center;background:#ffd27f;color:#10202c;font-weight:700;border-radius:9px;padding:8px 10px;text-decoration:none">Report / Suggest</a>
         <a href="${esc(issues.issuesUrl || `https://github.com/${repo}/issues`)}" target="_blank" rel="noopener" style="flex:1;text-align:center;border:1px solid #ffffff2e;border-radius:9px;padding:8px 10px;color:#eaf6ff;text-decoration:none">Open the repo</a>
       </div>
       <div style="opacity:.5;font-size:10.5px;margin-top:8px">Improvements: drop files under <code>contributions/</code> and open a PR (data/asset/shader), or PR engine code directly. <kbd>N</kbd> to close.</div>`;
    const report = body.querySelector("#ws-report") as HTMLAnchorElement | null;
    if (report) report.onclick = (ev) => {
      ev.preventDefault();
      const title = encodeURIComponent(`[in-game] ${here.lookingAt ? here.lookingAt + " — " : ""}`);
      const bodyText = encodeURIComponent(`What I saw in play (region ${here.region}):\n\n\nWhat I expected / would improve:\n\n\n— filed from playskyward.ai`);
      const url = (issues.newIssueUrl || `https://github.com/${repo}/issues/new`) + `?title=${title}&body=${bodyText}`;
      window.open(url, "_blank", "noopener");
    };
  }

  let open = false;
  return {
    toggle(force?: boolean) { open = force ?? !open; el.style.display = open ? "block" : "none"; if (open) render(); },
    isOpen() { return open; },
  };
}

// ---- Brain Console (owner only) ---------------------------------------------
export function initBrainConsole(base: string, getToken: () => string): Panel {
  const el = document.createElement("div");
  el.id = "brainconsole"; el.style.cssText = PANEL_CSS;
  document.body.appendChild(el);

  async function render() {
    el.innerHTML = `<div style="font:700 15px 'Fraunces',serif;color:#9fe0ff;margin-bottom:4px">Skyward · Brain Console</div>
      <div style="opacity:.7;font-size:11px;margin-bottom:10px">The gameplay AI that runs the world. Gameplay only — it never touches code or GitHub.</div>
      <div id="bc-body" style="opacity:.8">Loading…</div>`;
    let s: any = null, denied = false;
    try {
      const r = await fetch(`${base}/brain/status`, { headers: { Authorization: "Bearer " + getToken() } });
      if (r.status === 403) denied = true; else s = await r.json();
    } catch { /* offline */ }
    const body = el.querySelector("#bc-body") as HTMLElement; if (!body) return;
    if (denied) { body.innerHTML = '<div style="opacity:.6">Owner only.</div>'; return; }
    if (!s || !s.provider) { body.innerHTML = '<div style="opacity:.6">The brain isn\'t reporting yet (start it with <code>npm run brain</code>).</div>'; return; }
    const pct = s.ceiling ? Math.min(100, Math.round((s.tokensToday / s.ceiling) * 100)) : 0;
    body.innerHTML =
      `<div style="display:flex;gap:10px;margin-bottom:8px">
         <div style="flex:1"><div style="opacity:.6;font-size:10.5px">MODEL</div><div><b>${esc(s.provider)}</b> · ${esc(s.model || "—")}</div></div>
         <div style="flex:1"><div style="opacity:.6;font-size:10.5px">CALLS TODAY</div><div><b>${s.calls || 0}</b></div></div>
       </div>
       <div style="opacity:.6;font-size:10.5px">TOKENS TODAY</div>
       <div style="background:#ffffff14;border-radius:6px;height:8px;overflow:hidden;margin:3px 0 2px"><div style="height:100%;width:${pct}%;background:${pct > 85 ? "#ff8f8f" : "#9fe0ff"}"></div></div>
       <div style="opacity:.7;font-size:11px;margin-bottom:10px">${(s.tokensToday || 0).toLocaleString()} / ${(s.ceiling || 0).toLocaleString()} (${pct}%)</div>
       <div style="font:700 12px;color:#ffd27f;margin:8px 0 4px">Recent decisions</div>
       ${(s.decisions || []).slice(0, 10).map((d: any) => `<div style="padding:3px 0;border-bottom:1px solid #ffffff10"><span style="opacity:.55">${esc(d.via)}</span> → <b>${esc((d.did || []).join(", ") || "silent")}</b>${d.decision?.narrate ? `<div style="opacity:.8;font-style:italic">“${esc(d.decision.narrate)}”</div>` : ""}</div>`).join("") || '<div style="opacity:.5">no decisions yet</div>'}`;
  }

  let open = false; let timer: any = null;
  return {
    toggle(force?: boolean) {
      open = force ?? !open; el.style.display = open ? "block" : "none";
      if (open) { render(); timer = setInterval(render, 5000); } else if (timer) { clearInterval(timer); timer = null; }
    },
    isOpen() { return open; },
  };
}
