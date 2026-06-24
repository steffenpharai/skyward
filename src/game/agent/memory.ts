/**
 * MemoryStore — a Generative-Agents-style memory stream with semantic retrieval.
 * Each remembered event is embedded (via Ollama nomic-embed-text through the
 * /api/embed proxy); at decision time the most RELEVANT memories to the current
 * situation are retrieved by cosine similarity and fed to the brain — not just
 * the most recent. Degrades gracefully to recency when embeddings are offline.
 */

async function embed(text: string): Promise<number[] | null> {
  try {
    const r = await fetch("/api/embed", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j.vec) ? j.vec : null;
  } catch { return null; }
}

function cosine(a: number[], b: number[]): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

interface MemItem { text: string; vec: number[] | null; }

export class MemoryStore {
  private items: MemItem[] = [];

  /** Record an event and embed it in the background. */
  add(text: string) {
    const item: MemItem = { text, vec: null };
    this.items.push(item);
    if (this.items.length > 50) this.items.shift();
    embed(text).then((v) => { item.vec = v; });
  }

  /** Top-k memories most relevant to `query` (semantic), else most recent. */
  async retrieve(query: string, k = 3): Promise<string[]> {
    if (this.items.length <= k) return this.items.map((i) => i.text);
    const qv = await embed(query);
    const scored = qv ? this.items.filter((i) => i.vec).map((i) => ({ text: i.text, s: cosine(qv, i.vec!) })) : [];
    if (!scored.length) return this.items.slice(-k).map((i) => i.text);     // recency fallback
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, k).map((s) => s.text);
  }

  get size(): number { return this.items.length; }
}
