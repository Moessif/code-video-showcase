// common.js — shared drawing/runtime helpers for the code-rendered video pipeline.
// Plain ES module, no dependencies. Copy next to your segment HTML (or serve /tools/common.js).
//
// Contract:
//   const seg = createSegment({ duration: 3 });
//   window.DURATION = seg.duration;
//   window.renderFrame = (u) => { const { t, fx } = seg.sample(u); ... };
//
// Segment mode URL params (set by the renderer):
//   ?seg=1&t0=0.35&speed=1.4&dur=3
//   -> local clip time u in [0,dur] maps to scene time t = t0 + u*speed
//
// Deterministic only: never call Date.now(), performance.now(), Math.random().

export const TAU = Math.PI * 2;

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const smoothstep = (a, b, v) => {
  const t = clamp(invLerp(a, b, v));
  return t * t * (3 - 2 * t);
};
export const mapRange = (v, a, b, c, d) => lerp(c, d, clamp(invLerp(a, b, v)));

// ---------- easing ----------
// v2.3：唯一缓动来源是 templates/motion.js。
// 之前 common.js 自己抄了一份，motion.js 又抄了一份，recipes/util.js 还是第三份。
// motion.js 的 ease 与本文件原实现逐点数值相同（已用 77 个采样点比对过），
// 所以改成 re-export 是零像素变化，但从此只有一处真值。
import { ease as motionEase } from './motion.js';
import { MOTION_PROFILES, motionParams, motionLevelFromQuery } from './motion-profile.mjs';

export const ease = motionEase;

// 内部快捷引用（行为与原来完全一致）
const _outQuad = motionEase.outQuad;
const _outCubic = motionEase.outCubic;

/**
 * 当前生效的动效档位参数（v2.3）。
 *
 * 优先级：显式传入 > URL 的 ?mp= > 'standard'。
 * 未指定时返回 standard 档，其所有乘数都是 1 → 与 v2.2 逐像素一致。
 */
export function motionProfile(level) {
  if (level != null && MOTION_PROFILES[level]) return motionParams(level);
  const fromUrl = typeof location !== 'undefined' ? motionLevelFromQuery(location.search) : 'standard';
  return motionParams(fromUrl);
}

// ---------- seeded randomness (replaces Math.random everywhere) ----------
export function mulberry32(seed = 1) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rng(seed = 1) {
  const next = mulberry32(seed);
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => Math.floor(a + (b - a + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    sign: () => (next() < 0.5 ? -1 : 1),
    gauss: () => {
      const u = Math.max(1e-9, next()), v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
    },
  };
}

export function hash01(n, seed = 0) {
  let h = Math.imul((n | 0) ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul(seed | 0, 0xC2B2AE35);
  h ^= h >>> 13; h = Math.imul(h, 0x27D4EB2F); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------- value noise / fbm ----------
const fract = (x) => x - Math.floor(x);

export function noise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i;
  const a = hash01(i, seed), b = hash01(i + 1, seed);
  const s = f * f * (3 - 2 * f);
  return lerp(a, b, s) * 2 - 1;
}

export function noise2(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const h = (i, j) => hash01(i * 73856093 ^ j * 19349663, seed);
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const n00 = h(xi, yi), n10 = h(xi + 1, yi), n01 = h(xi, yi + 1), n11 = h(xi + 1, yi + 1);
  return (lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy)) * 2 - 1;
}

export function fbm1(x, octaves = 4, seed = 0, lac = 2.0, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise1(x * freq, seed + o * 17);
    norm += amp; amp *= gain; freq *= lac;
  }
  return sum / norm;
}

export function fbm2(x, y, octaves = 4, seed = 0, lac = 2.0, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(x * freq, y * freq, seed + o * 17);
    norm += amp; amp *= gain; freq *= lac;
  }
  return sum / norm;
}

// ---------- beat helpers ----------
export const beat = (t, bpm = 120) => t * (bpm / 60);            // absolute beat position
export const beatPhase = (t, bpm = 120) => fract(beat(t, bpm));   // 0..1 within beat
export const beatIndex = (t, bpm = 120) => Math.floor(beat(t, bpm));
export function pulse(t, bpm = 120, decay = 6) {
  const ph = beatPhase(t, bpm);
  return Math.exp(-ph * decay);
}

// ---------- segment mode ----------
export function parseSegment(search = (typeof location !== 'undefined' ? location.search : '')) {
  const p = new URLSearchParams(search);
  const enabled = p.get('seg') === '1';
  const num = (k, d) => {
    const v = parseFloat(p.get(k));
    return Number.isFinite(v) ? v : d;
  };
  return {
    enabled,
    t0: num('t0', 0),
    speed: num('speed', 1),
    duration: num('dur', 3),
  };
}

/**
 * createSegment({duration=3, bpm=120, motion})
 *  - reads ?seg&t0&speed&dur and ?mp=<motion level>（v2.3）
 *  - sample(u) -> { u, t, fx }
 *  - fx: { flash, scale, shakeX, shakeY, push } (multiply scale*push for drawing)
 * Impact overlay (u in [0,0.4]):
 *    white flash 0.85 -> 0 over 0.12 s
 *    scale 1.13 -> 1 over 0.32 s (outCubic)
 *    shake 14 px decaying over 0.16 s
 *    then slow push 1 -> 1.05 across the clip
 *
 * v2.3：档位（motion profile）只作为**乘数**作用。standard 档的所有乘数是 1，
 * 所以不传 ?mp= 时输出与 v2.2 逐像素一致（D11）。
 */
export function createSegment(options = {}) {
  const params = parseSegment();
  const duration = params.enabled ? params.duration : (options.duration ?? 3);
  const t0 = params.enabled ? params.t0 : (options.t0 ?? 0);
  const speed = params.enabled ? params.speed : (options.speed ?? 1);
  const profile = motionProfile(options.motion ?? options.mp);

  function sample(u) {
    u = clamp(u, 0, duration);
    const impactDur = 0.4;
    const flash = u < 0.12 ? 0.85 * profile.flash * (1 - _outQuad(clamp(u / 0.12))) : 0;
    // 写成与 v2.2 原式同构的形式（1.13 - 0.13 * k * impact），
    // 而不是 (1 + 0.13*impact) - ... —— 后者会产生最后一位的浮点差，
    // 在 1× 缩放下也可能落到不同的亚像素上（D11：standard 必须逐位一致）。
    const scale = 1.13 - 0.13 * profile.impact * _outCubic(clamp(u / 0.32));
    const amp = u < 0.16 ? 14 * profile.shake * (1 - u / 0.16) : 0;
    const shakeX = amp * Math.sin(u * 220 + 1.7);
    const shakeY = amp * Math.cos(u * 170 + 0.4);
    const after = Math.max(0.0001, duration - impactDur);
    const push = 1 + 0.05 * profile.push * clamp((u - impactDur) / after);
    return { u, t: t0 + u * speed, fx: { flash, scale, shakeX, shakeY, push } };
  }
  return { duration, t0, speed, enabled: params.enabled, profile, sample };
}

// Apply impact transform to a 2D context (assumes W/H = design size).
export function applyImpact2D(ctx, fx, W = 1920, H = 1080) {
  const s = fx.scale * fx.push;
  ctx.translate(W / 2 + fx.shakeX, H / 2 + fx.shakeY);
  ctx.scale(s, s);
  ctx.translate(-W / 2, -H / 2);
}

// White flash overlay; call after restore.
export function drawFlash(ctx, alpha, W = 1920, H = 1080, color = '#ffffff') {
  if (alpha <= 0.001) return;
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ---------- standard segment chrome ----------
export function drawCapsuleLabel(ctx, index, name, category = '', opts = {}) {
  const {
    x = 96, y = 72, h = 58, padX = 26, font = '600 26px "Noto Sans SC", sans-serif',
    numberColor = '#d97757', textColor = '#f5f0e8',
    bg = 'rgba(12,12,12,0.72)', border = 'rgba(255,255,255,0.18)',
  } = opts;
  ctx.save();
  ctx.font = font;
  ctx.textBaseline = 'middle';
  const num = String(index).padStart(2, '0');
  const label = category ? `${name} · ${category}` : name;
  const wNum = ctx.measureText(num).width;
  const wLabel = ctx.measureText(label).width;
  const w = padX * 2 + wNum + 14 + wLabel;
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = bg; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = border; ctx.stroke();
  ctx.fillStyle = numberColor; ctx.fillText(num, x + padX, y + h / 2 + 1);
  ctx.fillStyle = textColor; ctx.fillText(label, x + padX + wNum + 14, y + h / 2 + 1);
  ctx.restore();
}

export function drawCountdown(ctx, u, duration, opts = {}) {
  const { x = 1824, y = 1016, size = 34, color = 'rgba(245,240,232,0.72)', font = 'JetBrains Mono, monospace' } = opts;
  const remain = Math.max(0, Math.ceil(duration - u - 0.001));
  const text = `00:0${Math.min(9, remain)}`;
  ctx.save();
  ctx.font = `${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function drawStamp(ctx, text, opts = {}) {
  const { x = 1824, y = 72, size = 20, align = 'right', color = 'rgba(245,240,232,0.42)', font = 'JetBrains Mono, monospace' } = opts;
  ctx.save();
  ctx.font = `${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

// Cached vertical/radial gradient helper (avoid rebuilding gradients every frame).
const _gradCache = new WeakMap();
export function cachedGradient(ctx, key, build) {
  const canvas = ctx.canvas;
  let map = _gradCache.get(canvas);
  if (!map) { map = new Map(); _gradCache.set(canvas, map); }
  let g = map.get(key);
  if (!g) { g = build(ctx); map.set(key, g); }
  return g;
}

// Typical safe-area helpers
export const SAFE = { left: 96, right: 96, top: 72, bottom: 72 };
export const DESIGN = { W: 1920, H: 1080 };

// Wait for fonts; returns when all requested families are ready.
export async function loadFonts(families, sample = 'ABCDEFG abcdefg 0123456789 中文测试') {
  if (typeof document === 'undefined' || !document.fonts) return;
  for (const family of families) {
    for (const weight of ['400', '500', '600', '700', '900']) {
      try { await document.fonts.load(`${weight} 64px "${family}"`, sample); } catch (e) { /* variable fonts may reject */ }
    }
  }
  await document.fonts.ready;
}

// ── v2: re-export the motion/colour toolkit so pages need one import ───────
// motion.js and color.js are side-effect-free; re-exporting keeps existing
// segment pages unchanged while new ones can use spring(), layoutCJK(), etc.
export {
  spring, springs, springSettle, rateFunc, stagger, track, transitionParams,
  activeItem, quantize, splitGraphemes, layoutCJK, fitText, drawKineticText,
  drawGrain, drawPaperTexture, drawScanlines, drawRGBSplit, drawBloom, drawHalation,
  accentRamp,
} from './motion.js';
export {
  parseColor, toOklch, toHex, toRgba, formatOklch, gamut, clampChroma,
  withLightness, mixOklch, shade, ramp, readableInk, relativeLuminance,
  contrastRatio, apcaLc, apcaAbs, apcaLevel, derivePalette, themeTokensToOklch,
  oklchCssVars, auditApca,
} from './color.js';

/**
 * Read renderer-provided variables. render-segment.mjs injects window.__vars
 * (and a base64url ?vars= fallback for pages opened manually).
 *   window.__vars = { brand: 'ACME', title: '...' }
 */
export function vars() {
  if (typeof window === 'undefined') return {};
  if (window.__vars && typeof window.__vars === 'object') return window.__vars;
  try {
    const p = new URLSearchParams(location.search).get('vars');
    if (!p) return {};
    const b64 = p.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(b64)));
    window.__vars = JSON.parse(json);
    return window.__vars;
  } catch { return {}; }
}
