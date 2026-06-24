/**
 * NetClient — the browser's connection to the authoritative world server (M0).
 *
 * Sends local movement INTENT (~15 Hz) and receives the authoritative presence
 * roster + the shared Sky Dragon (~20 Hz). The player you control is rendered
 * locally with prediction; everyone else (humans AND agents) is rendered from the
 * roster. This is the seam that makes "see all players on one map" real.
 *
 * Disabled gracefully if the world server isn't running (?noworld or connection
 * fail) — the single-player game keeps working untouched.
 */
export interface Presence {
  id: string; kind: "human" | "agent"; name: string; ownerId: string; charId: string;
  x: number; y: number; z: number; facing: number;
  state: string; era: number; lastAction: string; say: string | null; emote?: string | null;
  appearance?: any; verified?: boolean;
}
export interface DragonState { x: number; y: number; z: number; heading: number; bank: number; phase: number; active: boolean; }
export interface ChatLine { from: string; fromId: string; kind: string; text: string; t: number; scope?: string; to?: string; toId?: string; echo?: boolean; }
export interface EmoteEvent { id: string; name: string; emote: string; }
export interface FeedEntry { t: number; kind: string; actor: string; text: string; }
/** A "while you were gone" recap beat, sent in the welcome to returning players. */
export interface RecapBeat { kind: string; text: string; }
export interface SettlementState { built: string[]; owners: Record<string, { by: string; t: number }>; era: number; justBuilt?: { siteId: string; by: string }; }
export type RegionStatus = "wild" | "claimed" | "developing" | "published" | "dormant";
export interface RegionInfo { id: string; rx: number; rz: number; status: RegionStatus; steward: { ownerId: string; name: string; kind: string } | null; lastActiveAt?: number; }
export interface AuthoredSite { id: string; name: string; pos: { x: number; z: number }; structure: string; rot?: number; }
export interface RegionPack { id: string; author: string; ownerId: string; t: number; status: string; buildSites: AuthoredSite[]; curation?: { score: number; boosts: number; flags: number; forks: number }; }

type ChatCb = (line: ChatLine) => void;
type ActCb = (ev: any) => void;
type EmoteCb = (ev: EmoteEvent) => void;
type FeedCb = (e: FeedEntry) => void;
type SettleCb = (s: SettlementState) => void;
type NoticeCb = (text: string) => void;
type RegionsCb = (regions: RegionInfo[], changed?: string) => void;
type RegionPackCb = (regionId: string, pack: RegionPack, event?: string) => void;
type CommissionCb = (c: Commission) => void;
export interface Commission { id: string; by: string; byOwner: string; text: string; reward: number; t: number; status: string; fulfilledBy: string | null; }

export class NetClient {
  ws: WebSocket | null = null;
  connected = false;
  myId = "";
  myOwnerId = "";          // the server-assigned owner id for THIS client (for "mine" checks)
  roster = new Map<string, Presence>();
  dragon: DragonState | null = null;
  serverNow = 0;          // last server timestamp (ms)
  private lastSnap = 0;   // perf.now() of last snapshot (for interpolation timing)
  private chatCbs: ChatCb[] = [];
  private actCbs: ActCb[] = [];
  private emoteCbs: EmoteCb[] = [];
  private feedCbs: FeedCb[] = [];
  private recapCbs: ((beats: RecapBeat[]) => void)[] = [];
  recap: RecapBeat[] = [];          // "while you were gone" — set from the welcome packet
  private settleCbs: SettleCb[] = [];
  private noticeCbs: NoticeCb[] = [];
  private regionsCbs: RegionsCb[] = [];
  private regionPackCbs: RegionPackCb[] = [];
  private commissionCbs: CommissionCb[] = [];
  identity: any = null;            // my persistent society record (from welcome)
  settlement: SettlementState | null = null;
  regions = new Map<string, RegionInfo>();   // the world's claim map
  regionPacks = new Map<string, RegionPack[]>();   // authored content per region
  commissions = new Map<string, Commission>();     // open patron bounties
  private join: any;
  private retry = 0;

  constructor(private url: string) {}

  onChat(cb: ChatCb) { this.chatCbs.push(cb); }
  onAct(cb: ActCb) { this.actCbs.push(cb); }
  onEmote(cb: EmoteCb) { this.emoteCbs.push(cb); }
  onFeed(cb: FeedCb) { this.feedCbs.push(cb); }
  onRecap(cb: (beats: RecapBeat[]) => void) { this.recapCbs.push(cb); }
  onSettlement(cb: SettleCb) { this.settleCbs.push(cb); }
  onNotice(cb: NoticeCb) { this.noticeCbs.push(cb); }
  onRegions(cb: RegionsCb) { this.regionsCbs.push(cb); }
  onRegionPack(cb: RegionPackCb) { this.regionPackCbs.push(cb); }
  onCommission(cb: CommissionCb) { this.commissionCbs.push(cb); }

  connect(join: { name: string; kind?: "human" | "agent"; charId?: string; ownerId?: string; token?: string; appearance?: any; x: number; y: number; z: number; era: number }) {
    this.join = { type: "join", kind: "human", ...join };
    this.open();
  }

  private open() {
    let ws: WebSocket;
    try { ws = new WebSocket(this.url); } catch { return this.scheduleRetry(); }
    this.ws = ws;
    ws.onopen = () => { this.retry = 0; ws.send(JSON.stringify(this.join)); };
    ws.onmessage = (e) => this.handle(e.data);
    ws.onclose = () => { this.connected = false; this.scheduleRetry(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  private scheduleRetry() {
    // Keep trying forever with capped backoff — a world-server bounce (dev restart,
    // redeploy) must not permanently drop the player. Backoff caps at 5s.
    const delay = Math.min(5000, 500 * 2 ** Math.min(this.retry++, 4));
    setTimeout(() => this.open(), delay);
  }

  private handle(data: string) {
    let m: any; try { m = JSON.parse(data); } catch { return; }
    switch (m.type) {
      case "welcome":
        this.myId = m.id; this.myOwnerId = m.you?.ownerId || ""; this.connected = true; this.serverNow = m.now;
        this.identity = m.identity || null;
        this.roster.clear();
        for (const p of m.players || []) this.roster.set(p.id, p);
        this.dragon = m.dragon || null;
        for (const c of m.recentChat || []) this.emitChat(c);
        for (const e of m.recentFeed || []) for (const cb of this.feedCbs) cb(e);
        this.recap = Array.isArray(m.recap) ? m.recap : [];
        if (this.recap.length) for (const cb of this.recapCbs) cb(this.recap);
        if (m.settlement) { this.settlement = m.settlement; for (const cb of this.settleCbs) cb(m.settlement); }
        if (m.regions) this.ingestRegions(m.regions);
        if (m.regionPacks) for (const [rid, packs] of Object.entries(m.regionPacks as Record<string, RegionPack[]>)) for (const pk of packs) this.addRegionPack(rid, pk);
        for (const c of m.commissions || []) this.commissions.set(c.id, c);
        break;
      case "snapshot":
        this.serverNow = m.t; this.lastSnap = performance.now();
        // replace roster wholesale (small N); keep our own entry out of the render set
        this.roster.clear();
        for (const p of m.players || []) this.roster.set(p.id, p);
        this.dragon = m.dragon || this.dragon;
        break;
      case "join":   if (m.player) this.roster.set(m.player.id, m.player); break;
      case "leave":  this.roster.delete(m.id); break;
      case "chat":   this.emitChat(m); break;
      case "emote":  for (const cb of this.emoteCbs) cb(m); break;
      case "feed": for (const cb of this.feedCbs) cb(m.entry); break;
      case "settlement": this.settlement = m; for (const cb of this.settleCbs) cb(m); break;
      case "act":    for (const cb of this.actCbs) cb(m); break;
      case "notice": for (const cb of this.noticeCbs) cb(m.from ? `${m.from}: ${m.text}` : m.text); break;
      case "identity": this.identity = m.identity || this.identity; break;
      case "regions": this.ingestRegions(m.regions, m.changed); break;
      case "regionPack": if (m.pack) this.addRegionPack(m.regionId, m.pack, m.event); break;
      case "commission":
        if (m.commission) {
          if (m.commission.status === "open") this.commissions.set(m.commission.id, m.commission);
          else this.commissions.delete(m.commission.id);
          for (const cb of this.commissionCbs) cb(m.commission);
        }
        break;
      default: break;
    }
  }

  private addRegionPack(regionId: string, pack: RegionPack, event?: string) {
    const arr = this.regionPacks.get(regionId) || [];
    const i = arr.findIndex((p) => p.id === pack.id);
    if (i >= 0) arr[i] = pack; else arr.push(pack);   // upsert: curation/promotion updates in place
    this.regionPacks.set(regionId, arr);
    for (const cb of this.regionPackCbs) cb(regionId, pack, event);
  }

  private ingestRegions(list: RegionInfo[], changed?: string) {
    if (!Array.isArray(list)) return;
    this.regions.clear();
    for (const r of list) this.regions.set(r.id, r);
    for (const cb of this.regionsCbs) cb(list, changed);
  }

  private emitChat(c: ChatLine) { for (const cb of this.chatCbs) cb(c); }

  /** Everyone except me — what the remote renderer draws. */
  others(): Presence[] {
    const out: Presence[] = [];
    for (const p of this.roster.values()) if (p.id !== this.myId) out.push(p);
    return out;
  }

  sendIntent(x: number, y: number, z: number, facing: number, state: string, era: number, lastAction?: string) {
    if (!this.connected || this.ws?.readyState !== 1) return;
    this.ws.send(JSON.stringify({ type: "intent", x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), facing: +facing.toFixed(3), state, era, lastAction }));
  }
  say(text: string, scope: "all" | "local" = "all") { this.send({ type: "say", text, scope }); }
  emote(emote: string) { this.send({ type: "emote", emote }); }
  sendAppearance(appearance: any) { this.send({ type: "appearance", appearance }); }
  whisper(toId: string, text: string) { this.send({ type: "whisper", toId, text }); }
  act(ev: any) { this.send({ type: "act", ...ev }); }
  claimRegion(rx: number, rz: number) { this.send({ type: "claim", rx, rz }); }
  releaseRegion(rx: number, rz: number) { this.send({ type: "release", rx, rz }); }
  proposePack(rx: number, rz: number, pack: any) { this.send({ type: "propose_pack", rx, rz, pack }); }
  curate(packId: string, kind: "boost" | "flag" | "fork") { this.send({ type: "curate", packId, kind }); }
  commission(text: string, reward = 10) { this.send({ type: "commission", text, reward }); }
  fulfillCommission(commissionId: string) { this.send({ type: "fulfill_commission", commissionId }); }
  private send(obj: any) { if (this.connected && this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj)); }
}
