/**
 * motion.js — deterministic motion, typography and texture recipes for
 * code-video-showcase. Plain ES module, no dependencies, browser-first.
 *
 * Everything here is a pure function of an explicit progress/time value: no
 * requestAnimationFrame, no Date.now, no CSS transitions. That is what makes
 * frame-by-frame rendering reproducible.
 *
 *   import { spring, rateFunc, stagger, layoutCJK, drawKineticText } from './motion.js';
 *   const pop = spring({ stiffness: 170, damping: 26 });   // pop(seconds) -> 0..1 (+overshoot)
 *   const lines = layoutCJK(ctx, '想做科普视频？', 1200, { font: '900 120px "Noto Sans SC"' });
 *
 * Recipe notes live in references/motion-and-color.md.
 */

import { toOklch, toHex, mixOklch, gamut, apcaLc, contrastRatio, readableInk } from './color.js';

// ── easing ──────────────────────────────────────────────────────────────────

const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * Math.PI) / 3;
const c5 = (2 * Math.PI) / 4.5;

export const ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inQuint: (t) => t * t * t * t * t,
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  inOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  inExpo: (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
  inBack: (t) => c3 * t * t * t - c1 * t * t,
  outBack: (t) => 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2),
  inOutBack: (t) => (t < 0.5
    ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
    : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2),
  outElastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1),
  inOutElastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1
    : t < 0.5
      ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
      : (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1),
  outBounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  // Manim-style rate functions
  smooth: (t) => t * t * (3 - 2 * t),
  smoother: (t) => t * t * t * (t * (t * 6 - 15) + 10),
  rushFrom: (t) => Math.pow(t, 5),
  rushInto: (t) => 1 - Math.pow(1 - t, 5),
  thereAndBack: (t) => (t < 0.5 ? ease.smoother(t * 2) : ease.smoother((1 - t) * 2)),
  // quantised steps: steps(3)(0.4) -> 1/3
  steps: (n, jump = 'end') => (t) => {
    const q = Math.floor(t * n);
    return jump === 'start' ? (Math.min(n, q + 1) / n) : q / n;
  },
};

/** Manim-compatible lookup: rateFunc('smooth') / rateFunc(ease.outExpo). */
export function rateFunc(name = 'smooth') {
  if (typeof name === 'function') return name;
  if (ease[name]) return ease[name];
  const camel = String(name).replace(/[-_\s]+(.)/g, (_, c) => c.toUpperCase());
  if (ease[camel]) return ease[camel];
  throw new Error(`unknown rate function: ${name}`);
}

/**
 * Analytic damped spring. Returns f(seconds) -> value (0..1 by default, can
 * overshoot). Deterministic and closed-form: no integration step, so the same
 * t always gives the same value.
 *
 * Presets after react-spring:
 *   default {170,26}  gentle {120,14}  wobbly {180,12}  stiff {210,20}
 *   slow {280,60}
 */
export function spring({ stiffness = 170, damping = 26, mass = 1, v0 = 0, from = 0, to = 1 } = {}) {
  const k = Math.max(1e-6, stiffness);
  const m = Math.max(1e-6, mass);
  const w0 = Math.sqrt(k / m);
  const zeta = damping / (2 * Math.sqrt(k * m));
  const d = to - from;
  return function value(t) {
    if (!(t > 0)) return from;
    if (zeta < 1 - 1e-6) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      const x = 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0 + v0) / wd) * Math.sin(wd * t));
      return from + d * x;
    }
    if (Math.abs(zeta - 1) <= 1e-6) {
      const x = 1 - Math.exp(-w0 * t) * (1 + (w0 + v0) * t);
      return from + d * x;
    }
    const s = Math.sqrt(zeta * zeta - 1);
    const r1 = -w0 * (zeta - s), r2 = -w0 * (zeta + s);
    const A = (-v0 - r2) / (r1 - r2), B = 1 - A;
    const x = 1 - A * Math.exp(r1 * t) - B * Math.exp(r2 * t);
    return from + d * x;
  };
}

export const springs = {
  default: () => spring({ stiffness: 170, damping: 26 }),
  gentle: () => spring({ stiffness: 120, damping: 14 }),
  wobbly: () => spring({ stiffness: 180, damping: 12 }),
  stiff: () => spring({ stiffness: 210, damping: 20 }),
  slow: () => spring({ stiffness: 280, damping: 60 }),
};

/** Seconds until a spring is within `eps` of its target (for timeline budgeting). */
export function springSettle(fn, eps = 0.001, maxT = 10) {
  for (let t = 0; t <= maxT; t += 1 / 240) if (Math.abs(fn(t) - 1) < eps) return t;
  return maxT;
}

// ── timing helpers ──────────────────────────────────────────────────────────

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);

/**
 * Stagger delays for n items, Manim `LaggedStart` style.
 * Returns normalized offsets in [0, lagRatio].
 */
export function stagger(n, { lagRatio = 0.1, total = 1 } = {}) {
  if (n <= 1) return [0];
  const span = lagRatio * total;
  return Array.from({ length: n }, (_, i) => (i / (n - 1)) * span);
}

/**
 * Piecewise keyframe track. Points are [[t, v], ...] or [{t,v,ease}], sorted.
 *   const y = track([[0, 0], [0.24, 120, 'outExpo'], [0.8, 120]]) 
 */
export function track(points, { defaultEase = 'linear' } = {}) {
  const pts = points.map((p) => (Array.isArray(p)
    ? { t: p[0], v: p[1], e: p[2] || defaultEase }
    : { t: p.t, v: p.v, e: p.ease || defaultEase })).sort((a, b) => a.t - b.t);
  return function at(t) {
    if (!pts.length) return 0;
    if (t <= pts[0].t) return pts[0].v;
    if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].v;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (t >= a.t && t <= b.t) {
        const p = (t - a.t) / (b.t - a.t);
        return lerp(a.v, b.v, rateFunc(b.e || a.e || defaultEase)(p));
      }
    }
    return pts[pts.length - 1].v;
  };
}

/**
 * Cut/transition parameter block used by impact overlays and card/shot changes.
 *   const tr = transitionParams('slam', p);
 *   applyImpact2D(ctx, { scale: tr.scale, ... });
 */
export function transitionParams(name, p, { dur = 0.24, amp = 1 } = {}) {
  const t = clamp(p);
  switch (name) {
    case 'slam': {
      const k = ease.outExpo(clamp(t / 0.45));
      return { alpha: 1, scale: 1.13 - 0.13 * k, blur: 16 * (1 - k), x: 0, y: 0, rot: 0, ca: 0, flash: t < 0.12 ? 0.85 * (1 - ease.outQuad(t / 0.12)) : 0 };
    }
    case 'whip': {
      const k = ease.outCubic(t);
      return { alpha: 1, scale: 1 + 0.02 * (1 - k), blur: 8 * (1 - k) * amp, x: (1 - k) * 0.18, y: 0, rot: (1 - k) * -2.5 * amp, ca: 6 * (1 - k), flash: 0 };
    }
    case 'glitch': {
      const k = Math.floor(t * 3) / 3; // three discrete frames, not smooth
      return { alpha: 1, scale: 1, blur: 0, x: 0, y: 0, rot: 0, ca: 6 * (1 - k), flash: t > 0.9 ? 0.3 : 0, slice: 1 - k };
    }
    case 'fade':
      return { alpha: ease.inOutCubic(t), scale: 1, blur: 0, x: 0, y: 0, rot: 0, ca: 0, flash: 0 };
    case 'none':
    default:
      return { alpha: 1, scale: 1, blur: 0, x: 0, y: 0, rot: 0, ca: 0, flash: 0 };
  }
}

/** Quantise to a frame index (avoids float drift at scene cuts). */
export const quantize = (t, fps = 30) => Math.round(t * fps) / fps;

/** Active item at time t from [{at,dur,...}]. */
export function activeItem(items, t) {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (t >= it.at && t < it.at + it.dur) {
      return { index: i, item: it, u: (t - it.at) / it.dur, last: i === items.length - 1 };
    }
  }
  return null;
}

// ── CJK typography ─────────────────────────────────────────────────────────

const LINE_START_FORBIDDEN = new Set('、。，．：；？！）〕］｝」』】》〉”’…—～·%‰℃′″');
const LINE_END_FORBIDDEN = new Set('（〔［｛「『【《〈“‘$￥');

/** Grapheme split that handles CJK, emoji and combining marks. */
export function splitGraphemes(text) {
  const s = String(text);
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      const seg = new Intl.Segmenter('zh', { granularity: 'grapheme' });
      return Array.from(seg.segment(s), (x) => x.segment);
    } catch { /* fall through */ }
  }
  return Array.from(s);
}

function setFont(ctx, font) {
  if (font) ctx.font = font;
}

/**
 * Greedy CJK-aware line layout with 避头尾 (kinsoku) rules.
 * Returns { lines: [{text, width, chars:[{char,x}]}], width, height, lineHeight }.
 * The context font must already be set (or pass opts.font).
 */
export function layoutCJK(ctx, text, maxWidth, {
  font, lineHeight = 1.1, letterSpacing = 0, kinsoku = true, align = 'left',
} = {}) {
  setFont(ctx, font);
  const sizeMatch = String(ctx.font || '').match(/(\d+(?:\.\d+)?)px/);
  const fontSize = sizeMatch ? parseFloat(sizeMatch[1]) : 16;
  const lh = lineHeight * fontSize;
  const lines = [];
  const paragraphs = String(text).split('\n');

  for (const para of paragraphs) {
    const chars = splitGraphemes(para);
    if (!chars.length) { lines.push({ text: '', width: 0, chars: [] }); continue; }
    let current = [];
    let width = 0;
    const flush = () => {
      lines.push({ text: current.map((c) => c.char).join(''), width, chars: current });
      current = []; width = 0;
    };
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const w = ctx.measureText(ch).width + letterSpacing;
      const isSpace = ch === ' ';
      if (width + w > maxWidth && current.length) {
        // 避头：行首禁则字符允许挤出当前行
        if (kinsoku && LINE_START_FORBIDDEN.has(ch)) {
          current.push({ char: ch, x: width, w }); width += w; continue;
        }
        // 避尾：行末开引号/括号移到下一行
        if (kinsoku && LINE_END_FORBIDDEN.has(current[current.length - 1].char)) {
          const moved = current.pop();
          width -= moved.w;
          flush();
          current.push(moved); width = moved.w;
        } else {
          flush();
        }
      }
      if (isSpace && current.length === 0) continue;
      current.push({ char: ch, x: width, w });
      width += w;
    }
    flush();
  }

  const maxLine = lines.reduce((m, l) => Math.max(m, l.width), 0);
  if (align === 'center' || align === 'right') {
    for (const line of lines) {
      const off = align === 'center' ? (maxWidth - line.width) / 2 : maxWidth - line.width;
      for (const c of line.chars) c.x += off;
    }
  }
  return { lines, width: maxLine, height: lines.length * lh, lineHeight: lh, fontSize };
}

/** Find the largest font size that fits text into maxWidth × maxLines. */
export function fitText(ctx, text, {
  maxWidth, maxLines = 1, font = 'Noto Sans SC', weight = 900, maxSize = 280, minSize = 24,
  lineHeight = 1.05, letterSpacing = 0,
} = {}) {
  let lo = minSize, hi = maxSize, best = minSize;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const f = `${weight} ${mid}px "${font}"`;
    const layout = layoutCJK(ctx, text, maxWidth, { font: f, lineHeight, letterSpacing });
    if (layout.lines.length <= maxLines) { best = mid; lo = mid; } else { hi = mid; }
  }
  return { size: Math.floor(best), font: `${weight} ${Math.floor(best)}px "${font}"` };
}

/**
 * Draw text with per-grapheme kinetic entrance. Progress p is 0..1 over the
 * animation window; pass `p = clamp((t - start) / dur)`.
 * modes: 'rise' | 'clip' | 'wipe' | 'blur' | 'scale'
 * Returns the computed layout for callers that need char positions.
 */
export function drawKineticText(ctx, text, p, {
  x = 0, y = 0, maxWidth = 1200, font = '900 120px "Noto Sans SC"',
  color = '#ffffff', lineHeight = 1.08, letterSpacing = 0, align = 'left',
  mode = 'rise', stagger: lag = 0.55, duration = 0.45, rise = 0.35,
  shadowColor = null, shadowBlur = 0,
} = {}) {
  const layout = layoutCJK(ctx, text, maxWidth, { font, lineHeight, letterSpacing, align });
  const chars = layout.lines.flatMap((line, li) => line.chars.map((c) => ({ ...c, line: li })));
  const n = Math.max(1, chars.length);
  ctx.save();
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  if (shadowColor) { ctx.shadowColor = shadowColor; ctx.shadowBlur = shadowBlur; }
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const delay = (i / n) * lag;
    const local = clamp((p - delay) / Math.max(1e-6, duration));
    if (local <= 0) continue;
    const e = ease.outExpo(local);
    const lx = x + c.x;
    const ly = y + c.line * layout.lineHeight;
    ctx.save();
    if (mode === 'rise') {
      ctx.globalAlpha = e;
      ctx.fillText(c.char, lx, ly + (1 - e) * layout.fontSize * rise);
    } else if (mode === 'clip') {
      ctx.beginPath();
      ctx.rect(lx - 2, ly - layout.fontSize * 1.05, c.w + 4, layout.fontSize * 1.2 * e);
      ctx.clip();
      ctx.fillText(c.char, lx, ly);
    } else if (mode === 'wipe') {
      ctx.beginPath();
      ctx.rect(lx - 2, ly - layout.fontSize * 1.2, (c.w + 4) * e, layout.fontSize * 1.4);
      ctx.clip();
      ctx.fillText(c.char, lx, ly);
    } else if (mode === 'blur') {
      ctx.globalAlpha = e;
      ctx.filter = `blur(${((1 - e) * 16).toFixed(2)}px)`;
      ctx.fillText(c.char, lx, ly);
    } else if (mode === 'scale') {
      const s = 1.7 - 0.7 * e;
      ctx.translate(lx + c.w / 2, ly - layout.fontSize * 0.35);
      ctx.scale(s, s);
      ctx.fillText(c.char, -c.w / 2, layout.fontSize * 0.35);
    }
    ctx.restore();
  }
  ctx.restore();
  return layout;
}

// ── textures & post effects (browser only) ─────────────────────────────────

let _grainCache = new Map();

/**
 * Deterministic grain overlay. A 256×256 noise tile is generated once per
 * (seed, size) and scrolled by t, so the pattern never flickers randomly.
 */
export function drawGrain(ctx, { alpha = 0.07, seed = 1, tile = 256, t = 0, W = 1920, H = 1080, blend = 'overlay' } = {}) {
  if (typeof document === 'undefined') return;
  const key = `${seed}:${tile}`;
  let cv = _grainCache.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = cv.height = tile;
    const g = cv.getContext('2d');
    const img = g.createImageData(tile, tile);
    let a = seed >>> 0;
    const rand = () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(rand() * 255);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    _grainCache.set(key, cv);
  }
  const ox = Math.round((t * 30) % tile);
  const oy = Math.round((t * 47) % tile);
  ctx.save();
  ctx.globalCompositeOperation = blend;
  ctx.globalAlpha = alpha;
  for (let y = -oy; y < H; y += tile) {
    for (let x = -ox; x < W; x += tile) ctx.drawImage(cv, x, y);
  }
  ctx.restore();
}

/** Paper fibre texture: sparse horizontal hairs + soft blotches. */
export function drawPaperTexture(ctx, { W = 1920, H = 1080, alpha = 0.08, seed = 7, t = 0 } = {}) {
  let a = seed >>> 0;
  const rand = () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#7a6b58';
  ctx.lineWidth = 1;
  for (let i = 0; i < 220; i++) {
    const x = rand() * W, y = rand() * H;
    const len = 12 + rand() * 90;
    const wob = Math.sin(t * 0.2 + i) * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + len * 0.5, y + wob, x + len, y + wob * 0.4);
    ctx.stroke();
  }
  for (let i = 0; i < 14; i++) {
    const x = rand() * W, y = rand() * H, r = 80 + rand() * 260;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(120,100,70,0.05)');
    g.addColorStop(1, 'rgba(120,100,70,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}

/** Horizontal scanlines, useful for CRT/cyber segments. */
export function drawScanlines(ctx, { W = 1920, H = 1080, step = 4, alpha = 0.06, color = '#000000' } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let y = 0; y < H; y += step) ctx.fillRect(0, y, W, 1);
  ctx.restore();
}

function tintCanvas(source, color) {
  const cv = document.createElement('canvas');
  cv.width = source.width; cv.height = source.height;
  const g = cv.getContext('2d');
  g.drawImage(source, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, cv.width, cv.height);
  return cv;
}

/** RGB channel split from a rendered source canvas (draw the result on top). */
export function drawRGBSplit(ctx, source, { px = 6, alpha = 0.85, red = '#ff2a2a', cyan = '#2affff' } = {}) {
  if (typeof document === 'undefined') return;
  const r = tintCanvas(source, red), c = tintCanvas(source, cyan);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.drawImage(r, -px, 0);
  ctx.drawImage(c, px, 0);
  ctx.restore();
}

/** Cheap bloom: downsample, blur, add back with screen. */
export function drawBloom(ctx, source, { strength = 0.3, radius = 12, W = 1920, H = 1080 } = {}) {
  if (typeof document === 'undefined') return;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(W / 4)); cv.height = Math.max(1, Math.round(H / 4));
  const g = cv.getContext('2d');
  g.filter = `blur(${radius / 4}px)`;
  g.drawImage(source, 0, 0, cv.width, cv.height);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = strength;
  ctx.drawImage(cv, 0, 0, W, H);
  ctx.restore();
}

/** Halation: warm bleed around highlights (approximation using bloom + tint). */
export function drawHalation(ctx, source, { strength = 0.22, color = '#ff5a2a', W = 1920, H = 1080 } = {}) {
  if (typeof document === 'undefined') return;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(W / 4)); cv.height = Math.max(1, Math.round(H / 4));
  const g = cv.getContext('2d');
  g.filter = 'blur(6px) brightness(1.6)';
  g.drawImage(source, 0, 0, cv.width, cv.height);
  const tinted = tintCanvas(cv, color);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = strength;
  ctx.drawImage(tinted, 0, 0, W, H);
  ctx.restore();
}

// ── colour helpers re-exported for convenience ────────────────────────────

export { toOklch, toHex, mixOklch, gamut, apcaLc, contrastRatio, readableInk };

/** Build a 5-step accent ramp for charts/HUD from one theme accent. */
export function accentRamp(accent, steps = 5, { mode = 'dark' } = {}) {
  const o = toOklch(accent);
  const dir = mode === 'dark' ? 1 : -1;
  return Array.from({ length: steps }, (_, i) => {
    const l = Math.min(0.98, Math.max(0.08, o.l + dir * (i - (steps - 1) / 2) * 0.11));
    return toHex(gamut({ l, c: o.c * (1 - Math.abs(i - (steps - 1) / 2) * 0.12), h: o.h }));
  });
}
