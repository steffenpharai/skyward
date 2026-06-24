// Visual Richness Score — no-reference image-quality battery for stylized 3D screenshots.
// Usage:  node tools/score.mjs <image.png> [compareTo.png]
// Metrics & composite per research (Hasler&Süsstrunk colorfulness, RMS contrast,
// luminance entropy, dynamic range/clipping, Laplacian detail, Sobel edge density,
// saturation variety, local contrast). Higher composite = richer/more "AAA" looking.
import sharp from "sharp";

async function load(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, c: info.channels };
}

function luma(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

function metrics({ data, w, h, c }) {
  const n = w * h;
  // luminance buffer + accumulators
  const L = new Float32Array(n);
  let sumRg = 0, sumYb = 0, sumRg2 = 0, sumYb2 = 0;
  let sumL = 0, sumL2 = 0;
  const hist = new Uint32Array(256);
  let sumS = 0, sumS2 = 0, satGt = 0;
  let clipLo = 0, clipHi = 0;

  for (let i = 0, p = 0; i < data.length; i += c, p++) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const rg = r - g, yb = 0.5 * (r + g) - b;
    sumRg += rg; sumYb += yb; sumRg2 += rg * rg; sumYb2 += yb * yb;
    const l = luma(r, g, b);
    L[p] = l; sumL += l; sumL2 += l * l;
    hist[Math.max(0, Math.min(255, Math.round(l)))]++;
    if (l <= 2) clipLo++; if (l >= 253) clipHi++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const s = mx === 0 ? 0 : (mx - mn) / mx;
    sumS += s; sumS2 += s * s; if (s > 0.5) satGt++;
  }

  // colorfulness (Hasler & Süsstrunk M3)
  const mRg = sumRg / n, mYb = sumYb / n;
  const vRg = sumRg2 / n - mRg * mRg, vYb = sumYb2 / n - mYb * mYb;
  const colorfulness = Math.sqrt(vRg + vYb) + 0.3 * Math.sqrt(mRg * mRg + mYb * mYb);

  // RMS contrast (0..1)
  const mL = sumL / n;
  const rms = Math.sqrt(Math.max(0, sumL2 / n - mL * mL)) / 255;

  // entropy (bits)
  let entropy = 0;
  for (let i = 0; i < 256; i++) { const p = hist[i] / n; if (p > 0) entropy -= p * Math.log2(p); }

  // dynamic range via 1st/99th percentile + clipping
  let acc = 0, p1 = 0, p99 = 255; const lo = n * 0.01, hi = n * 0.99;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= lo) { p1 = i; break; } }
  acc = 0; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= hi) { p99 = i; break; } }
  const dynRange = (p99 - p1) / 255;
  const clipping = (clipLo + clipHi) / n;

  // saturation stats
  const mS = sumS / n, vS = sumS2 / n - mS * mS, stdS = Math.sqrt(Math.max(0, vS));

  // Half-res luminance (2x2 box average) — averages out single-pixel aliasing so the
  // detail/edge metrics measure REAL structure, not jaggies (AA must not be penalized).
  const hw = w >> 1, hh = h >> 1;
  const Lh = new Float32Array(hw * hh);
  for (let y = 0; y < hh; y++)
    for (let x = 0; x < hw; x++) {
      const x2 = x << 1, y2 = y << 1;
      Lh[y * hw + x] = 0.25 * (L[y2 * w + x2] + L[y2 * w + x2 + 1] + L[(y2 + 1) * w + x2] + L[(y2 + 1) * w + x2 + 1]);
    }

  // Laplacian detail variance + Sobel edge density on the half-res buffer.
  let lapSum = 0, lapSum2 = 0, lapN = 0, edges = 0;
  const idx = (x, y) => y * hw + x;
  for (let y = 1; y < hh - 1; y++) {
    for (let x = 1; x < hw - 1; x++) {
      const c0 = Lh[idx(x, y)];
      const lap = Lh[idx(x - 1, y)] + Lh[idx(x + 1, y)] + Lh[idx(x, y - 1)] + Lh[idx(x, y + 1)] - 4 * c0;
      lapSum += lap; lapSum2 += lap * lap; lapN++;
      const gx = (Lh[idx(x + 1, y - 1)] + 2 * Lh[idx(x + 1, y)] + Lh[idx(x + 1, y + 1)]) -
                 (Lh[idx(x - 1, y - 1)] + 2 * Lh[idx(x - 1, y)] + Lh[idx(x - 1, y + 1)]);
      const gy = (Lh[idx(x - 1, y + 1)] + 2 * Lh[idx(x, y + 1)] + Lh[idx(x + 1, y + 1)]) -
                 (Lh[idx(x - 1, y - 1)] + 2 * Lh[idx(x, y - 1)] + Lh[idx(x + 1, y - 1)]);
      if (Math.hypot(gx, gy) > 40) edges++;
    }
  }
  const lapMean = lapSum / lapN;
  const detail = lapSum2 / lapN - lapMean * lapMean; // variance of Laplacian
  const edgeDensity = edges / lapN;

  // local contrast: mean of per-tile luma stdev (16x16)
  const T = 16; let tileC = 0, tiles = 0;
  for (let ty = 0; ty < h; ty += T) {
    for (let tx = 0; tx < w; tx += T) {
      let s = 0, s2 = 0, m = 0;
      for (let y = ty; y < Math.min(ty + T, h); y++)
        for (let x = tx; x < Math.min(tx + T, w); x++) { const v = L[idx(x, y)]; s += v; s2 += v * v; m++; }
      if (m > 0) { const mu = s / m; tileC += Math.sqrt(Math.max(0, s2 / m - mu * mu)); tiles++; }
    }
  }
  const localContrast = (tileC / tiles) / 255;

  return { colorfulness, rms, entropy, dynRange, clipping, mS, stdS, satGt: satGt / n, detail, edgeDensity, localContrast };
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

function composite(m, detailRef) {
  const norm = {
    colorfulness: clamp01(m.colorfulness / 90),
    localContrast: clamp01(m.localContrast / 0.16),
    detail: clamp01(Math.log10(1 + m.detail) / Math.log10(1 + detailRef)),
    rms: clamp01(m.rms / 0.28),
    entropy: clamp01((m.entropy - 4) / (7.8 - 4)),
    stdS: clamp01(m.stdS / 0.22),
    edgeDensity: clamp01(m.edgeDensity / 0.15),
    dynRange: clamp01(m.dynRange / 0.9),
  };
  const W = { colorfulness: 0.22, localContrast: 0.18, detail: 0.16, rms: 0.12, entropy: 0.12, stdS: 0.08, edgeDensity: 0.06, dynRange: 0.06 };
  let r = 0; for (const k in W) r += W[k] * norm[k];
  r -= 0.5 * m.clipping;
  return { score: Math.round(100 * clamp01(r)), norm };
}

const [a, b] = process.argv.slice(2);
if (!a) { console.error("usage: node tools/score.mjs <img.png> [compare.png]"); process.exit(1); }

const ma = metrics(await load(a));
const detailRef = b ? Math.max(ma.detail, (await metrics(await load(b))).detail) : ma.detail;
const ca = composite(ma, Math.max(detailRef, 1));

function row(label, va, vb) {
  const f = (x) => (x === undefined ? "" : (typeof x === "number" ? x.toFixed(4) : x).toString().padStart(11));
  console.log("  " + label.padEnd(16) + f(va) + (vb !== undefined ? f(vb) : ""));
}

console.log(`\n=== Visual Richness — ${a}${b ? "  vs  " + b : ""} ===`);
if (b) {
  const mb = metrics(await load(b));
  const cb = composite(mb, Math.max(detailRef, 1));
  row("metric", "A", "B");
  for (const k of ["colorfulness", "localContrast", "detail", "rms", "entropy", "stdS", "edgeDensity", "dynRange", "clipping"]) row(k, ma[k], mb[k]);
  row("", "", "");
  row("SCORE /100", ca.score, cb.score);
  console.log(`\n  Winner: ${ca.score > cb.score ? "A (" + a + ")" : cb.score > ca.score ? "B (" + b + ")" : "tie"}  (Δ ${ca.score - cb.score})`);
} else {
  for (const k of ["colorfulness", "localContrast", "detail", "rms", "entropy", "stdS", "satGt", "edgeDensity", "dynRange", "clipping"]) row(k, ma[k]);
  console.log("\n  composite norms:", Object.fromEntries(Object.entries(ca.norm).map(([k, v]) => [k, +v.toFixed(2)])));
  console.log(`  SCORE /100: ${ca.score}`);
}
