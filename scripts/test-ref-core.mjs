#!/usr/bin/env node
/** test-ref-core.mjs — 参考图核心的纯函数回归（无需 ffmpeg / 浏览器）。 */
import { analyzePixels, analyzeImageData, REF_SAMPLE } from './ref-core.mjs';

let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}${detail ? `  (${detail})` : ''}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? `  (${detail})` : ''}`); }
};

const N = REF_SAMPLE;
const hex = (h) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 });
const DARK = hex('#0e0e0d');
const CORAL = hex('#d97757');
const PAPER = hex('#f4efe6');

const pixels = [];
const rgba = [];
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const c = y / N;
    const p = c < 0.7 ? DARK : c < 0.9 ? CORAL : PAPER;
    pixels.push({ ...p });
    rgba.push(Math.round(p.r * 255), Math.round(p.g * 255), Math.round(p.b * 255), 255);
  }
}

const a = analyzePixels(pixels, { k: 6 });
const b = analyzePixels(pixels, { k: 6 });

ok('theme matched coral-noir', a.theme.id === 'coral-noir', a.theme.id);
ok('top-3 candidates', a.theme.candidates.length === 3, a.theme.candidates.map((c) => c.id).join(','));
ok('palette has 3 clusters', a.palette.length === 3, a.palette.map((p) => `${p.hex}:${p.share}`).join(' '));
ok('background is dark', a.metrics.bg === '#0e0e0d', a.metrics.bg);
ok('accent extracted', a.metrics.accent.toLowerCase() === '#d97757', a.metrics.accent);
ok('accent contrast >= 30', a.metrics.accentContrast >= 30, String(a.metrics.accentContrast));
ok('ink contrast >= 60', a.metrics.apca >= 60, String(a.metrics.apca));
ok('deterministic (same pixels -> same JSON)', JSON.stringify(a) === JSON.stringify(b));

const fromImageData = analyzeImageData({ data: new Uint8ClampedArray(rgba) }, { k: 6 });
ok('analyzeImageData matches analyzePixels', JSON.stringify(fromImageData) === JSON.stringify(a));

const blank = Array.from({ length: N * N }, () => ({ ...DARK }));
const flat = analyzePixels(blank, { k: 4 });
ok('flat image: single cluster', flat.palette.length === 1, flat.palette.map((p) => p.hex).join(','));
ok('flat image: no accent override', flat.theme.accentOverride === null);

console.log(`\n${failures.length ? '✗' : '✓'} ref-core — ${pass} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
