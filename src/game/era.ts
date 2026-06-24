/**
 * Era progression tracker. For S1.1 it reports build progress to the HUD. The
 * actual Era I→II transition (atmosphere shift, new content) lands in S1.4 via
 * the `onAdvance` hook fired when the era's build threshold is reached.
 */
import type { Store } from "./state";
import type { ContentPack } from "./content/types";

export class Eras {
  private pack: ContentPack;
  private siteIds: string[];
  private advanceFired = false;

  constructor(
    private store: Store,
    pack: ContentPack,
    private onProgress: (name: string, built: number, total: number, ratio: number) => void,
    private onAdvance?: () => void,
  ) {
    this.pack = pack;
    this.siteIds = pack.buildSites.map((s) => s.id);
  }

  /** Switch tracking to a new era's pack (after advancing). */
  setPack(pack: ContentPack) {
    this.pack = pack;
    this.siteIds = pack.buildSites.map((s) => s.id);
    this.advanceFired = false;
    this.refresh();
  }

  builtCount(): number {
    return this.siteIds.filter((id) => this.store.state.builtSites.includes(id)).length;
  }

  total(): number { return this.siteIds.length; }
  eraName(): string { return this.pack.era.name; }

  ratio(): number {
    return this.siteIds.length ? this.builtCount() / this.siteIds.length : 0;
  }

  refresh() {
    const built = this.builtCount();
    this.onProgress(this.pack.era.name, built, this.siteIds.length, this.ratio());
    if (!this.advanceFired && this.siteIds.length > 0 && this.ratio() >= this.pack.era.advanceAt) {
      this.advanceFired = true;
      this.onAdvance?.();
    }
  }
}
