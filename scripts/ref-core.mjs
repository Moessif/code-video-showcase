/**
 * ref-core.mjs — 参考图的纯函数核心（Node 与浏览器共用）。
 *
 * 输入一组 sRGB 像素（0..1）或浏览器 ImageData，输出：
 *   主题匹配（top-3 候选）、提取色板、强调色、APCA 指标、密度/材质提示。
 *
 * 不复制像素；只提取统计特征。确定性：给定相同像素与 k，输出逐字段一致。
 */
import { parseColor, rgbToOklab, oklabToRgb, toHex, readableInk, apcaAbs } from '../templates/color.js';
import { THEMES, THEME_IDS, accentOverride } from '../templates/themes.js';

export const REF_SAMPLE = 96;
export const REF_K = 6;
const ITER = 24;

const d2 = (A, B) => (A.l - B.l) ** 2 + (A.a - B.a) ** 2 + (A.b - B.b) ** 2;

/** 确定性 k-means（OKLab 空间，按亮度分位初始化）。 */
export function kmeansPixels(pixels, k = REF_K, iter = ITER) {
  const lab = pixels.map((p) => rgbToOklab(p));
  const sorted = [...lab].sort((a, b) => a.l - b.l);
  let centers = Array.from({ length: k }, (_, i) =>
    ({ ...sorted[Math.floor(((i + 0.5) * sorted.length) / k)] }));
  const assign = new Array(lab.length).fill(0);

  for (let it = 0; it < iter; it++) {
    let moved = false;
    for (let i = 0; i < lab.length; i++) {
      let best = 0;
      let bd = Infinity;
      for (let j = 0; j < k; j++) {
        const d = d2(lab[i], centers[j]);
        if (d < bd) { bd = d; best = j; }
      }
      if (assign[i] !== best) { assign[i] = best; moved = true; }
    }
    const sums = Array.from({ length: k }, () => ({ l: 0, a: 0, b: 0, n: 0 }));
    for (let i = 0; i < lab.length; i++) {
      const s = sums[assign[i]];
      s.l += lab[i].l; s.a += lab[i].a; s.b += lab[i].b; s.n++;
    }
    centers = sums.map((s, j) => (s.n ? { l: s.l / s.n, a: s.a / s.n, b: s.b / s.n } : centers[j]));
    if (!moved) break;
  }

  const counts = new Array(k).fill(0);
  for (const a of assign) counts[a]++;

  return centers
    .map((c, j) => {
      const rgb = oklabToRgb(c);
      return {
        hex: toHex(rgb),
        share: counts[j] / lab.length,
        l: c.l,
        c: Math.hypot(c.a, c.b),
        h: (Math.atan2(c.b, c.a) * 180 / Math.PI + 360) % 360,
      };
    })
    .filter((c) => c.share > 0.005)
    .sort((a, b) => b.share - a.share);
}

const hexDist = (h1, h2) => {
  const A = rgbToOklab(parseColor(h1));
  const B = rgbToOklab(parseColor(h2));
  return Math.sqrt(d2(A, B));
};

export function themePalette(t) {
  const c = t.colors;
  return [c.bg, c.bgDeep, c.surface, c.ink, c.muted, c.accent, c.accentSoft,
    c.paper, c.paperInk, c.paperMuted, c.cardDark, c.cardDarkInk].filter(Boolean);
}

/** 提取色板到主题色板的加权最近邻距离。 */
export function paletteDistance(clusters, theme) {
  const colors = themePalette(theme);
  let sum = 0;
  let wsum = 0;
  for (const c of clusters) {
    let best = Infinity;
    for (const h of colors) best = Math.min(best, hexDist(c.hex, h));
    sum += best * c.share;
    wsum += c.share;
  }
  return wsum ? sum / wsum : 1;
}

export function matchTheme(clusters, isDark) {
  const scored = THEME_IDS.map((id) => {
    const t = THEMES[id];
    const modePenalty = (t.mode === 'dark') === isDark ? 0 : 0.08;
    return { id, name: t.name, score: paletteDistance(clusters, t) + modePenalty };
  }).sort((a, b) => a.score - b.score);

  const best = scored[0];
  const second = scored[1];
  const confidence = Math.max(0, Math.min(1, 1 - best.score / (second.score || 1)));
  return {
    ...best,
    confidence,
    runnerUp: second.id,
    candidates: scored.slice(0, 3).map((s) => ({ id: s.id, name: s.name, score: Number(s.score.toFixed(4)) })),
  };
}

/**
 * @param {Array<{r:number,g:number,b:number}>} pixels sRGB 0..1，长度应为 sample²
 * @param {{k?:number, sample?:number}} [opts]
 */
export function analyzePixels(pixels, { k = REF_K, sample = REF_SAMPLE } = {}) {
  if (!Array.isArray(pixels) || !pixels.length) throw new Error('empty pixels');
  const clusters = kmeansPixels(pixels, k);
  if (!clusters.length) throw new Error('empty palette');

  const bg = clusters[0];
  // 强调色必须能在底上看见：APCA >= 25 才进候选
  const accentPool = clusters.filter((c) => c !== bg && c.c > 0.02 && apcaAbs(c.hex, bg.hex) >= 25);
  const accent = accentPool.sort((a, b) => (b.c * Math.sqrt(b.share)) - (a.c * Math.sqrt(a.share)))[0] || bg;

  const ink = readableInk(bg.hex);
  const apca = apcaAbs(ink, bg.hex);

  const bgLab = rgbToOklab(parseColor(bg.hex));
  const side = Math.max(1, Math.round(Math.sqrt(pixels.length)) || sample);
  let covered = 0;
  let edgeSum = 0;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const i = y * side + x;
      const p = pixels[i];
      if (p && Math.sqrt(d2(rgbToOklab(p), bgLab)) > 0.08) covered++;
      if (x > 0 && pixels[i] && pixels[i - 1]) {
        edgeSum += Math.abs(rgbToOklab(pixels[i]).l - rgbToOklab(pixels[i - 1]).l);
      }
    }
  }
  const coverage = covered / pixels.length;
  const texture = edgeSum / pixels.length;

  const match = matchTheme(clusters, bg.l < 0.5);
  const accentContrast = apcaAbs(accent.hex, bg.hex);
  const overrideWanted = accent.c >= 0.035 && accentContrast >= 30;
  const ao = accentOverride(match.id, overrideWanted ? accent.hex : match.id);
  const override = overrideWanted ? ao.override : null;

  const inkSafe = apca >= 60 ? ink : THEMES[match.id].colors.ink;

  const result = {
    theme: {
      id: match.id,
      name: match.name,
      confidence: Number(match.confidence.toFixed(3)),
      runnerUp: match.runnerUp,
      candidates: match.candidates,
      accentOverride: override,
    },
    palette: clusters.slice(0, 6).map((c) => ({
      hex: c.hex,
      share: Number(c.share.toFixed(3)),
      l: Number(c.l.toFixed(3)),
      c: Number(c.c.toFixed(3)),
      h: Math.round(c.h),
    })),
    metrics: {
      bg: bg.hex,
      ink: inkSafe,
      accent: accent.hex,
      apca: Math.round(apca),
      accentContrast: Math.round(accentContrast),
      coverage: Number(coverage.toFixed(3)),
      texture: Number(texture.toFixed(4)),
    },
    hints: {
      density: coverage < 0.08 ? 'airy' : coverage < 0.22 ? 'normal' : 'dense',
      material: texture > 0.035 ? 'grain' : 'clean',
    },
    briefPatch: { theme: { id: match.id, accentOverride: override } },
  };
  if (match.confidence < 0.15) {
    result.warning = 'low-confidence: palette does not clearly match any theme; consider coral-noir default';
  }
  return result;
}

/** 浏览器：ImageData → analyzePixels。 */
export function analyzeImageData(imageData, opts = {}) {
  const d = imageData && imageData.data;
  if (!d || !d.length) throw new Error('empty ImageData');
  const pixels = [];
  for (let i = 0; i + 3 < d.length; i += 4) {
    pixels.push({ r: d[i] / 255, g: d[i + 1] / 255, b: d[i + 2] / 255 });
  }
  return analyzePixels(pixels, opts);
}
