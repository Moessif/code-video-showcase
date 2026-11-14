/**
 * color.js — OKLCH / OKLab colour engine, WCAG 2 contrast, APCA (Lc) and theme
 * derivation for code-video-showcase. Plain ES module, no dependencies, works in
 * the browser and in Node.
 *
 * Why: the legacy themes store hex values per role, which makes "one shade
 * lighter" a manual job and makes light/dark variants drift. This module adds an
 * OKLCH layer on top: keep the 14 role tokens as [L, C, H] triples, change
 * lightness on a perceptual scale, clamp chroma to the sRGB gamut, and audit
 * text with APCA (the modern replacement for WCAG 2 ratio on dark backgrounds).
 *
 *   import { toOklch, toHex, mixOklch, apcaLc, clampChroma } from './color.js';
 *   const c = toOklch('#d97757');          // { l: 0.68, c: 0.13, h: 40.6 }
 *   toHex({ l: 0.9, c: 0.05, h: 40 });     // '#f2d8c9'
 *
 * All functions are pure; no Date/Math.random.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// ── parsing ──────────────────────────────────────────────────────────────────

/** Parse #rgb / #rgba / #rrggbb / #rrggbbaa / rgb() / rgba() / oklch() → {r,g,b,a} (0..1). */
export function parseColor(input) {
  if (input && typeof input === 'object') {
    if ('r' in input) {
      return { r: clamp01(input.r), g: clamp01(input.g), b: clamp01(input.b), a: input.a ?? 1 };
    }
    if ('l' in input) return oklchToRgb(input);
  }
  const s = String(input || '').trim().toLowerCase();
  if (!s) return { r: 0, g: 0, b: 0, a: 1 };

  const ok = s.match(/^oklch\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+(-?[\d.]+)(?:deg)?(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
  if (ok) {
    return oklchToRgb({
      l: pct(ok[1], 1),
      c: pct(ok[2], 0.4),
      h: parseFloat(ok[3]),
      a: ok[4] === undefined ? 1 : pct(ok[4], 1),
    });
  }

  const rgb = s.match(/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (rgb) {
    return {
      r: pct(rgb[1], 1), g: pct(rgb[2], 1), b: pct(rgb[3], 1),
      a: rgb[4] === undefined ? 1 : pct(rgb[4], 1),
    };
  }

  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) throw new Error(`bad hex colour: ${input}`);
    const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 };
  }

  throw new Error(`unsupported colour: ${input}`);
}

function pct(v, scale) {
  return String(v).endsWith('%') ? (parseFloat(v) / 100) * scale : parseFloat(v);
}
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// ── sRGB ↔ linear ↔ OKLab / OKLCH ───────────────────────────────────────────

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** sRGB {r,g,b} 0..1 → OKLab {l,a,b}. */
export function rgbToOklab({ r, g, b }) {
  const R = toLinear(r), G = toLinear(g), B = toLinear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    l: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}

/** OKLab {l,a,b} → linear sRGB (may be out of gamut). */
function oklabToLinear({ l, a, b }) {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;
  const L = l_ * l_ * l_, M = m_ * m_ * m_, S = s_ * s_ * s_;
  return {
    r: 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    g: -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    b: -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S,
  };
}

/** OKLab → sRGB {r,g,b} 0..1 (gamut-clamped). */
export function oklabToRgb(lab) {
  const lin = oklabToLinear(lab);
  return { r: clamp01(toGamma(lin.r)), g: clamp01(toGamma(lin.g)), b: clamp01(toGamma(lin.b)), a: 1 };
}

/** OKLCH {l 0..1, c, h deg} → sRGB. */
export function oklchToRgb({ l, c = 0, h = 0, a = 1 }) {
  const hr = h * D2R;
  const rgb = oklabToRgb({ l, a: c * Math.cos(hr), b: c * Math.sin(hr) });
  rgb.a = a;
  return rgb;
}

/** Any colour → OKLCH {l,c,h,a}. */
export function toOklch(input) {
  const rgb = parseColor(input);
  const lab = rgbToOklab(rgb);
  return {
    l: lab.l,
    c: Math.hypot(lab.a, lab.b),
    h: (Math.atan2(lab.b, lab.a) * R2D + 360) % 360,
    a: rgb.a ?? 1,
  };
}

/** Any colour → '#rrggbb'. */
export function toHex(input) {
  const { r, g, b } = parseColor(input);
  return '#' + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

/** Any colour → 'rgba(r,g,b,a)'. */
export function toRgba(input, alphaOverride) {
  const { r, g, b, a } = parseColor(input);
  const aa = alphaOverride === undefined ? a : alphaOverride;
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${+aa.toFixed(4)})`;
}

/** Format OKLCH for CSS. */
export function formatOklch({ l, c = 0, h = 0, a = 1 }, precision = 4) {
  const f = (v) => +v.toFixed(precision);
  return a >= 1
    ? `oklch(${f(l)} ${f(c)} ${f(h)})`
    : `oklch(${f(l)} ${f(c)} ${f(h)} / ${f(a)})`;
}

// ── gamut + manipulation ────────────────────────────────────────────────────

const inGamut = ({ r, g, b }) => r >= -1e-6 && r <= 1 + 1e-6 && g >= -1e-6 && g <= 1 + 1e-6 && b >= -1e-6 && b <= 1 + 1e-6;

/** Max chroma that stays inside sRGB for a given L and H (binary search). */
export function clampChroma(l, c, h) {
  const probe = (cc) => oklchToRgb({ l, c: cc, h });
  if (inGamut(probe(c))) return c;
  let lo = 0, hi = c;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(probe(mid))) lo = mid; else hi = mid;
  }
  return lo;
}

/** Return an in-gamut OKLCH object (chroma clamped). */
export function gamut({ l, c = 0, h = 0, a = 1 }) {
  const L = clamp01(l);
  return { l: L, c: clampChroma(L, Math.max(0, c), h), h: ((h % 360) + 360) % 360, a };
}

/** Change lightness, keep hue and relative chroma (clamped). */
export function withLightness(input, l) {
  const o = toOklch(input);
  const c = o.c * (1 + (l - o.l) * 0.35); // slightly desaturate when moving toward white/black
  return toHex(gamut({ ...o, l, c }));
}

/** Mix two colours in OKLab (perceptually even), t=0 → a, t=1 → b. */
export function mixOklch(a, b, t) {
  const A = rgbToOklab(parseColor(a));
  const B = rgbToOklab(parseColor(b));
  const k = clamp01(t);
  return toHex(oklabToRgb({ l: A.l + (B.l - A.l) * k, a: A.a + (B.a - A.a) * k, b: A.b + (B.b - A.b) * k }));
}

/** Lighten (amount > 0) or darken (amount < 0) in OKLCH, amount in L units. */
export function shade(input, amount) {
  return withLightness(input, clamp01(toOklch(input).l + amount));
}

/** Build an N-step ramp between two colours in OKLab. */
export function ramp(from, to, steps = 5) {
  return Array.from({ length: steps }, (_, i) => mixOklch(from, to, steps === 1 ? 0 : i / (steps - 1)));
}

/** Pick black or white text for a background by APCA, with WCAG as tiebreaker. */
export function readableInk(bg, { dark = '#111111', light = '#ffffff', minLc = 60 } = {}) {
  const d = Math.abs(apcaLc(dark, bg));
  const l = Math.abs(apcaLc(light, bg));
  if (Math.max(d, l) < minLc) return contrastRatio(light, bg) >= contrastRatio(dark, bg) ? light : dark;
  return l >= d ? light : dark;
}

// ── contrast: WCAG 2 + APCA ────────────────────────────────────────────────

/** WCAG relative luminance. */
export function relativeLuminance(input) {
  const { r, g, b } = parseColor(input);
  const [R, G, B] = [r, g, b].map(toLinear);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG 2 contrast ratio (1..21). */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function apcaY(input) {
  const { r, g, b } = parseColor(input);
  const y = 0.2126729 * Math.pow(r, 2.4) + 0.7151522 * Math.pow(g, 2.4) + 0.0721750 * Math.pow(b, 2.4);
  return y < 0.022 ? y + Math.pow(0.022 - y, 1.414) : y;
}

/**
 * APCA 0.1.9 lightness contrast (signed Lc). Positive = dark text on light bg,
 * negative = light text on dark bg. Guidance: |Lc| ≥ 60 body, ≥ 75 small text,
 * ≥ 45 large display text.
 */
export function apcaLc(text, bg) {
  const Yt = apcaY(text), Yb = apcaY(bg);
  if (Yb > Yt) {
    const sapc = (Math.pow(Yb, 0.56) - Math.pow(Yt, 0.57)) * 1.14;
    return sapc < 0.1 ? 0 : (sapc - 0.027) * 100;
  }
  const sapc = (Math.pow(Yb, 0.65) - Math.pow(Yt, 0.62)) * 1.14;
  return sapc > -0.1 ? 0 : (sapc + 0.027) * 100;
}

export const apcaAbs = (text, bg) => Math.abs(apcaLc(text, bg));

/** APCA pass level for a font size in px (0.1.9 guidance, simplified). */
export function apcaLevel(lc, fontSizePx, weight = 400) {
  const large = fontSizePx >= 24 || (fontSizePx >= 18.66 && weight >= 700);
  const need = large ? 45 : fontSizePx >= 16 ? 60 : 75;
  return { lc: Math.abs(lc), need, pass: Math.abs(lc) >= need };
}

// ── theme derivation ───────────────────────────────────────────────────────

const DARK_STEPS = { ink: 0.96, ink2: 0.82, ink3: 0.68, ink4: 0.55, bg: 0.13, bgDeep: 0.09, surface: 0.18, line: 0.28, line2: 0.36 };
const LIGHT_STEPS = { ink: 0.18, ink2: 0.34, ink3: 0.50, ink4: 0.62, bg: 0.97, bgDeep: 0.93, surface: 0.99, line: 0.88, line2: 0.80 };

/**
 * Build a full 14-role palette from a compact OKLCH seed:
 *   derivePalette({ mode:'dark', bg:[0.13,0.02,250], accent:[0.68,0.16,40] })
 * Hue stays fixed; chroma is scaled per role and clamped to sRGB.
 */
export function derivePalette({ mode = 'dark', bg, accent, paper, chroma = 1 }) {
  const base = bg ? toOklch(bg) : toOklch(mode === 'dark' ? '#0e0e0d' : '#f4efe6');
  const acc = accent ? toOklch(accent) : toOklch('#d97757');
  const steps = mode === 'dark' ? DARK_STEPS : LIGHT_STEPS;
  const at = (l, cScale = 1, h = base.h) => toHex(gamut({ l, c: base.c * cScale * chroma, h }));
  const colors = {
    bg: at(steps.bg, 1),
    bgDeep: at(steps.bgDeep, 1),
    surface: at(steps.surface, 0.9),
    ink: at(steps.ink, 0.15),
    muted: at(steps.ink3, 0.25),
    accent: toHex(gamut({ l: acc.l, c: acc.c, h: acc.h })),
    accentInk: readableInk(toHex(gamut({ l: acc.l, c: acc.c, h: acc.h }))),
    accentSoft: toHex(gamut({ l: clamp01(acc.l + (mode === 'dark' ? -0.18 : 0.20)), c: acc.c * 0.55, h: acc.h })),
    paper: paper ? toHex(parseColor(paper)) : toHex(gamut({ l: mode === 'dark' ? 0.95 : 0.99, c: base.c * 0.3, h: base.h })),
    paperInk: toHex(gamut({ l: 0.16, c: base.c * 0.2, h: base.h })),
    paperMuted: toHex(gamut({ l: 0.42, c: base.c * 0.15, h: base.h })),
    cardDark: at(mode === 'dark' ? steps.bg : 0.14, 0.9),
    cardDarkInk: at(0.95, 0.08),
    flash: '#ffffff',
  };
  return colors;
}

/** Convert a theme's hex role map into an OKLCH token map (for docs / audits). */
export function themeTokensToOklch(colors) {
  const out = {};
  for (const [k, v] of Object.entries(colors)) {
    if (typeof v === 'string' && v.startsWith('#')) out[k] = toOklch(v);
  }
  return out;
}

/** CSS custom properties for an OKLCH role map. */
export function oklchCssVars(tokens, prefix = '--') {
  const out = {};
  for (const [k, v] of Object.entries(tokens)) {
    out[`${prefix}${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}`] = formatOklch(v);
  }
  return out;
}

/**
 * Audit a theme object (from themes.js) with APCA. Returns rows for every
 * foreground/background pair that matters in the video layout.
 */
export function auditApca(theme) {
  const c = theme.colors;
  const rows = [
    ['ink', 'bg', 60, '主字 / 底（正文）'],
    ['muted', 'bg', 45, '次要字 / 底'],
    ['ink', 'surface', 60, '主字 / 表面'],
    ['accentInk', 'accent', 60, '强调底上的字'],
    ['paperInk', 'paper', 60, '纸底字'],
    ['paperMuted', 'paper', 45, '纸底次要字'],
    ['cardDarkInk', 'cardDark', 60, '暗卡字'],
    ['accent', 'bg', 30, '强调 / 底（大字/色块）'],
  ];
  return rows.map(([fg, bg, need, label]) => {
    const lc = Math.abs(apcaLc(c[fg], c[bg]));
    return { pair: `${fg} / ${bg}`, label, lc: Math.round(lc * 10) / 10, need, pass: lc >= need };
  });
}
