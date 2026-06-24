/**
 * Remotes — renders everyone the local player is NOT: other humans and all AI
 * agents, from the authoritative roster, plus the shared Sky Dragon. Avatars
 * interpolate toward their last server position (smooth at 20 Hz); crisp DOM
 * nameplates + speech bubbles are projected above each head every frame. This is
 * the visible payoff of M0 — the map is suddenly populated by live players.
 */
import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { heightAt } from "../core/noise";
import { DRAGON, buildDragon, poseDragon } from "./dragon";
import { makeCharacter } from "../player/player";
import { characterById } from "../game/characters";
import type { Presence, DragonState } from "./net";

// Agents wear the same procedural figure as humans, in a cooler "synthetic" palette
// plus a floating glow node, so they read as kin-but-clearly-AI on the same map.
const AGENT_PALETTE = { tunic: 0x8aa0b8, hood: 0x46566a, pants: 0x9fb0c2, accent: 0x9fe0ff };
const OWN_AGENT_PALETTE = { tunic: 0xe8c98a, hood: 0xb07a3a, pants: 0xd9c08a, accent: 0xffd27f };

interface RemoteEntry {
  pres: Presence;
  group: THREE.Group;
  cx: number; cy: number; cz: number;   // current (interpolated) pos
  nameEl: HTMLDivElement;
  sayEl: HTMLDivElement;
  emoteEl: HTMLDivElement;
  appKey: string;                        // outfit signature, to rebuild on change
}
const appKeyOf = (p: Presence) => JSON.stringify(p.appearance || p.charId || "");

export const EMOTES: Record<string, string> = {
  wave: "👋", cheer: "🎉", heart: "💗", laugh: "😄", sit: "🪑", dance: "💃", bow: "🙇", sleep: "💤", think: "💭", sparkle: "✨",
};

const HUMAN = 0x7fdca0, AGENT = 0x9fe0ff, OWN_AGENT = 0xffd27f;
const _v = new THREE.Vector3();

export class Remotes {
  private map = new Map<string, RemoteEntry>();
  private plates: HTMLDivElement;
  private dragonGroup: THREE.Group;
  private dragonTrail: THREE.Vector3[] = [];
  ownerId = "host";   // which agents are "mine" (highlighted)

  constructor(private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    this.plates = document.createElement("div");
    this.plates.id = "nameplates";
    this.plates.style.cssText = "position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:5";
    document.body.appendChild(this.plates);

    this.dragonGroup = buildDragon();
    this.dragonGroup.visible = false;
    scene.add(this.dragonGroup);
  }

  /** Reconcile the rendered set with the authoritative roster. */
  sync(others: Presence[]) {
    const seen = new Set<string>();
    for (const p of others) {
      seen.add(p.id);
      let e = this.map.get(p.id);
      if (!e) e = this.spawn(p);
      e.pres = p;
      // outfit changed → rebuild the avatar in place (keeps interpolated position)
      const key = appKeyOf(p);
      if (e.appKey !== key) {
        this.scene.remove(e.group); disposeGroup(e.group);
        const mine = p.kind === "agent" && p.ownerId === this.ownerId;
        e.group = buildAvatar(p.kind, mine, p.charId, p.appearance);
        e.group.position.set(e.cx, e.cy, e.cz);
        this.scene.add(e.group);
        e.appKey = key;
      }
    }
    for (const [id, e] of this.map) if (!seen.has(id)) { this.scene.remove(e.group); disposeGroup(e.group); e.nameEl.remove(); e.sayEl.remove(); e.emoteEl.remove(); this.map.delete(id); }
  }

  private spawn(p: Presence): RemoteEntry {
    const mine = p.kind === "agent" && p.ownerId === this.ownerId;
    const group = buildAvatar(p.kind, mine, p.charId, p.appearance);
    const y = groundY(p.x, p.z, p.y);
    group.position.set(p.x, y, p.z);
    this.scene.add(group);

    const nameEl = document.createElement("div");
    const col = p.kind === "human" ? HUMAN : mine ? OWN_AGENT : AGENT;
    nameEl.style.cssText = "position:absolute;transform:translate(-50%,-100%);font:600 12px/1.2 system-ui,sans-serif;white-space:nowrap;text-shadow:0 1px 3px #000a;padding:1px 0";
    nameEl.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${hex(col)};box-shadow:0 0 6px ${hex(col)};margin-right:5px;vertical-align:middle"></span><span style="color:#fff">${esc(p.name)}</span>`;
    this.plates.appendChild(nameEl);

    const sayEl = document.createElement("div");
    sayEl.style.cssText = "position:absolute;transform:translate(-50%,-100%);font:500 12px/1.3 system-ui,sans-serif;max-width:220px;background:#0b1722e0;color:#eaf6ff;border:1px solid #ffffff22;border-radius:10px;padding:5px 9px;text-align:center;display:none;backdrop-filter:blur(3px)";
    this.plates.appendChild(sayEl);

    const emoteEl = document.createElement("div");
    emoteEl.style.cssText = "position:absolute;transform:translate(-50%,-100%);font-size:26px;text-shadow:0 2px 6px #000a;display:none";
    this.plates.appendChild(emoteEl);

    const e: RemoteEntry = { pres: p, group, cx: p.x, cy: y, cz: p.z, nameEl, sayEl, emoteEl, appKey: appKeyOf(p) };
    this.map.set(p.id, e);
    return e;
  }

  setDragon(d: DragonState | null) {
    if (!d || !d.active) { this.dragonGroup.visible = false; return; }
    this.dragonGroup.visible = true;
    // maintain a trail of head positions so the body flows behind the head;
    // trimmed by total ARC LENGTH so the serpent stays a consistent length.
    const head = _v.set(d.x, d.y, d.z);
    const trail = this.dragonTrail;
    if (!trail.length || trail[0].distanceToSquared(head) > 1.0) {
      trail.unshift(head.clone());
      let len = 0;
      for (let i = 0; i < trail.length - 1; i++) {
        len += trail[i].distanceTo(trail[i + 1]);
        if (len > DRAGON.trailLen) { trail.length = i + 2; break; }
      }
    }
    poseDragon(this.dragonGroup, d, trail);
  }

  /** Per-frame: interpolate avatars, billboard nameplates. */
  update(dt: number) {
    const k = Math.min(1, dt * 12);   // interpolation smoothing
    for (const e of this.map.values()) {
      const p = e.pres;
      const ty = groundY(p.x, p.z, p.y);
      e.cx += (p.x - e.cx) * k; e.cy += (ty - e.cy) * k; e.cz += (p.z - e.cz) * k;
      e.group.position.set(e.cx, e.cy, e.cz);
      e.group.rotation.y += (p.facing - e.group.rotation.y) * k;
      const marker = e.group.userData.marker as THREE.Mesh | undefined;
      if (marker) marker.rotation.y += dt * 2;

      // project head to screen for the nameplate
      _v.set(e.cx, e.cy + 2.1, e.cz).project(this.camera);
      const onScreen = _v.z < 1 && _v.x > -1.3 && _v.x < 1.3 && _v.y > -1.3 && _v.y < 1.3;
      if (onScreen) {
        const sx = (_v.x * 0.5 + 0.5) * innerWidth, sy = (-_v.y * 0.5 + 0.5) * innerHeight;
        e.nameEl.style.display = "block";
        e.nameEl.style.left = sx + "px"; e.nameEl.style.top = sy + "px";
        if (p.say) {
          e.sayEl.style.display = "block"; e.sayEl.textContent = p.say;
          e.sayEl.style.left = sx + "px"; e.sayEl.style.top = (sy - 20) + "px";
        } else e.sayEl.style.display = "none";
        if (p.emote && EMOTES[p.emote]) {
          e.emoteEl.style.display = "block"; e.emoteEl.textContent = EMOTES[p.emote];
          e.emoteEl.style.left = sx + "px"; e.emoteEl.style.top = (sy - 42) + "px";
        } else e.emoteEl.style.display = "none";
      } else { e.nameEl.style.display = "none"; e.sayEl.style.display = "none"; e.emoteEl.style.display = "none"; }
    }
  }

  /** Interpolated render position of a remote entity (for the spectate camera). */
  getRenderPos(id: string): THREE.Vector3 | null {
    const e = this.map.get(id);
    return e ? new THREE.Vector3(e.cx, e.cy, e.cz) : null;
  }

  /** Live roster for the minimap (others only; caller adds the local player). */
  minimap(): { x: number; z: number; kind: string; mine: boolean }[] {
    const out = [];
    for (const e of this.map.values()) out.push({ x: e.pres.x, z: e.pres.z, kind: e.pres.kind, mine: e.pres.ownerId === this.ownerId && e.pres.kind === "agent" });
    return out;
  }
  count() { return this.map.size; }
}

function groundY(x: number, z: number, serverY: number): number {
  const g = heightAt(x, z);
  // trust the server's y only when clearly airborne (gliding/climbing/jumping)
  return serverY > g + 1.2 ? serverY : g;
}

function buildAvatar(kind: "human" | "agent", mine: boolean, charId: string, appearance?: any): THREE.Group {
  const g = new THREE.Group();
  if (kind === "human") {
    g.add(makeCharacter(appearance || characterById(charId)).group);   // the player's chosen outfit
  } else {
    g.add(makeCharacter(mine ? OWN_AGENT_PALETTE : AGENT_PALETTE).group);
    // a floating glow node marks it as an AI resident (gold = yours, cyan = others')
    const glowMat = new MeshStandardNodeMaterial({ color: mine ? 0xffe2a8 : 0x9fe0ff, roughness: 0.3 });
    glowMat.emissive = new THREE.Color(mine ? 0xffb84d : 0x49c6ff); (glowMat as any).emissiveIntensity = 2.4;
    const marker = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), glowMat);
    marker.position.y = 2.15; g.add(marker); g.userData.marker = marker;
  }
  return g;
}

/** Free a departed avatar's GPU resources (avoids a leak under frequent join/leave). */
function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}

const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");
const esc = (s: string) => s.replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]!));
