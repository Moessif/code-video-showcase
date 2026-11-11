#!/usr/bin/env node
/**
 * from-reference.mjs — 参考图 → 主题 + 强调色 + 版式密度（结构化提取，不复制像素）。
 *
 *   node scripts/from-reference.mjs --img ref.jpg --out out/look.json
 *   node scripts/from-reference.mjs --img ref.jpg --spec project.spec.json --out patched.spec.json
 *   node scripts/from-reference.mjs --img ref.jpg --json
 *
 * 依赖：系统 ffmpeg + templates/color.js + templates/themes.js。零 npm 包。
 * 确定性：固定 96×96 采样、确定性初始质心、固定迭代次数。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseColor, rgbToOklab, oklabToRgb, toHex, readableInk, apcaAbs } from '../templates/color.js';
import { THEMES, THEME_IDS, accentOverride } from '../templates/themes.js';

const SAMPLE = 96;
const ITER = 24;

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

function decode(file) {
  const buf = execFileSync('ffmpeg', [
    '-v', 'error', '-i', file,
    '-vf', `scale=${SAMPLE}:${SAMPLE}:flags=area`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { maxBuffer: 64 * 1024 * 1024 });
  const px = [];
  for (let i = 0; i + 2 < buf.length; i += 3) {
    px.push({ r: buf[i] / 255, g: buf[i + 1] / 255, b: buf[i + 2] / 255 });
  }
  if (!px.length) throw new Error(`no pixels decoded from ${file}`);
  return px;
}

const d2 = (A, B) => (A.l - B.l) ** 2 + (A.a - B.a) ** 2 + (A.b - B.b) ** 2;

function kmeans(pixels, k) {
  const lab = pixels.map((p) => rgbToOklab(p));
  const sorted = [...lab].sort((a, b) => a.l - b.l);
  let centers = Array.from({ length: k }, (_, i) =>
    ({ ...sorted[Math.floor(((i + 0.5) * sorted.length) / k)] }));
  const assign = new Array(lab.length).fill(0);

  for (let it = 0; it < ITER; it++) {
    let moved = false;
    for (let i = 0; i < lab.length; i++) {
      let best = 0, bd = Infinity;
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

function themePalette(t) {
  const c = t.colors;
  return [c.bg, c.bgDeep, c.surface, c.ink, c.muted, c.accent, c.accentSoft,
    c.paper, c.paperInk, c.paperMuted, c.cardDark, c.cardDarkInk].filter(Boolean);
}

/** 提取色板到主题色板的加权最近邻距离：比单看 bg/accent 更能识别整套气质。 */
function paletteDistance(clusters, theme) {
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

function matchTheme(clusters, isDark) {
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

function analyze(img, k = 6) {
  const pixels = decode(img);
  const clusters = kmeans(pixels, k);
  if (!clusters.length) throw new Error('empty palette');

  const bg = clusters[0];
  // 强调色必须能在底上看见：APCA >= 25 才进候选，否则宁可沿用主题强调色
  const accentPool = clusters.filter((c) => c !== bg && c.c > 0.02 && apcaAbs(c.hex, bg.hex) >= 25);
  const accent = accentPool.sort((a, b) => (b.c * Math.sqrt(b.share)) - (a.c * Math.sqrt(a.share)))[0] || bg;

  const ink = readableInk(bg.hex);
  const apca = apcaAbs(ink, bg.hex);

  const bgLab = rgbToOklab(parseColor(bg.hex));
  let covered = 0;
  let edgeSum = 0;
  for (let y = 0; y < SAMPLE; y++) {
    for (let x = 0; x < SAMPLE; x++) {
      const i = y * SAMPLE + x;
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
    source: img,
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

// ── CLI ─────────────────────────────────────────────────────────────────────

const img = arg('img');
if (!img || img === true) {
  console.error(`usage:
  node scripts/from-reference.mjs --img <image> [--out look.json] [--k 6] [--json]
  node scripts/from-reference.mjs --img <image> --spec project.spec.json --out patched.spec.json`);
  process.exit(2);
}

let result;
try {
  result = analyze(path.resolve(String(img)), Number(arg('k', 6)));
} catch (e) {
  console.error(`[from-reference] ${e.message}`);
  process.exit(1);
}

const specPath = arg('spec');
const out = arg('out');

if (specPath && specPath !== true) {
  const spec = JSON.parse(fs.readFileSync(path.resolve(String(specPath)), 'utf8'));
  spec.look = spec.look || {};
  spec.look.theme = result.theme.id;
  spec.look.accentOverride = result.theme.accentOverride;
  if (result.hints.density) spec.look.density = result.hints.density;
  spec.meta = spec.meta || {};
  spec.meta.lookSource = { image: String(img), confidence: result.theme.confidence, at: new Date().toISOString() };
  const merged = JSON.stringify(spec, null, 2) + '\n';
  if (out && out !== true) {
    fs.mkdirSync(path.dirname(path.resolve(String(out))), { recursive: true });
    fs.writeFileSync(path.resolve(String(out)), merged);
    console.log(`[from-reference] theme=${result.theme.id} → ${out}`);
  } else {
    console.log(merged);
  }
} else if (out && out !== true) {
  fs.mkdirSync(path.dirname(path.resolve(String(out))), { recursive: true });
  fs.writeFileSync(path.resolve(String(out)), JSON.stringify(result, null, 2) + '\n');
  console.log(`[from-reference] theme=${result.theme.id} (${result.theme.name}) confidence=${result.theme.confidence}${result.warning ? ` !! ${result.warning}` : ''} → ${out}`);
} else {
  console.log(JSON.stringify(result, null, 2));
}
