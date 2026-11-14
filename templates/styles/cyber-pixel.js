// cyber-pixel.js — recipe 12「赛博像素」的浏览器 ESM 实现。
//
// 契约：
//   drawCyberPixel(ctx, W, H, t, theme, opts?)          整帧背景 + 六步效果链
//   cyberPixelPalette(theme)                            从主题派生 8–16 色板
//   drawPixelText(ctx, text, x, y, size, color, opts?)  方块字（CJK 安全，按字符排版）
//   measurePixelText(ctx, text, size, opts?)            排版测量，给调用方做居中/换行
//
// 确定性：唯一输入是 t、画布坐标、主题和整数哈希 hash32(x, y, frame)。
// 禁止 Math.random / Date.now / performance.now；同一 t 两次渲染结果逐像素相同。
//
// 效果链顺序（与 references/style-recipes.md §12 一致）：
//   1) 8–16 色量化（theme.colors 派生）
//   2) Bayer 4×4 有序抖动（替代渐变）
//   3) 扫描线（每 3px 一条，强度随 t 呼吸）
//   4) RGB 三通道偏移 1–2px（幅度是 t 的周期函数）
//   5) CRT 桶形畸变（按行位移，幅度小）
//   6) 强调色辉光（径向，位置固定）

import { getTheme, hexToRgb, mix, drawThemeBackground, relativeLuminance } from '../themes.js';

/* ────────────────────────────────────────────────────────────────────────────
 * 0. 确定性工具
 * ──────────────────────────────────────────────────────────────────────────── */

/** 32 位整数哈希：同一 (x,y,frame) 永远同一个值。 */
export function hash32(x, y, frame = 0) {
  let h = Math.imul((x | 0) ^ 0x9e3779b1, 0x85ebca6b);
  h = Math.imul(h ^ (y | 0), 0xc2b2ae35);
  h = Math.imul(h ^ (frame | 0), 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** 0..1 的确定性噪声。 */
export const hash01 = (x, y, frame = 0) => hash32(x, y, frame) / 4294967296;

const clampByte = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 标准 Bayer 4×4（行优先）。 */
export const BAYER4 = Object.freeze([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);

/* ────────────────────────────────────────────────────────────────────────────
 * 1. 色板：8–16 色，全部从 theme.colors / theme.accents 派生
 * ──────────────────────────────────────────────────────────────────────────── */

const _paletteCache = new Map();

/**
 * @param {object|string} themeRef 主题对象、id 或别名（走 themes.js 的 getTheme）
 * @returns {{
 *   id:string, count:number, hex:string[], rgb:number[][],
 *   bg:string, bgDeep:string, ink:string, paper:string, accent:string,
 *   accentSoft:string, accents:string[], bayer:number[], lutBits:number
 * }}
 */
export function cyberPixelPalette(themeRef) {
  const theme = getTheme(themeRef);
  const key = theme && theme.id ? String(theme.id) : 'theme';
  const sig = `${key}|${theme.colors.accent}|${theme.colors.bg}|${(theme.accents || []).map((a) => a.hex).join(',')}`;
  const hit = _paletteCache.get(sig);
  if (hit) return hit;

  const c = theme.colors;
  const accents = (theme.accents || []).map((a) => a.hex).filter(Boolean);
  // 语义顺序：深底 → 底色 → 中间调 → 墨/纸 → 主强调 → 次强调 → accents
  // 先给 8 个不可缺的骨架色，accents 负责把总数推到 12（不足 8 时用混合色补齐）。
  const seeds = [
    c.bgDeep,                                            // 0 最深底
    c.bg,                                                // 1 底色
    c.surface || mix(c.bgDeep, c.bg, 0.6),               // 2 面板
    mix(c.bg, c.ink, 0.18),                              // 3 中间调
    c.ink,                                               // 4 高光墨
    c.paper,                                             // 5 纸白（标题）
    c.accent,                                            // 6 主强调
    c.accentSoft || mix(c.accent, c.paper, 0.45),        // 7 柔强调
    mix(c.bgDeep, c.accent, 0.28),                       // 8 暗强调
    ...accents,                                          // 9.. accents
  ];

  const MAX_COLORS = 12; // 落在 8–16 之间：足够表现层次，又保得住像素感
  const hex = [];
  const seen = new Set();
  for (const s of seeds) {
    if (!s) continue;
    let rgb;
    try { rgb = hexToRgb(s); } catch { continue; }
    const canon = `#${rgb.r.toString(16).padStart(2, '0')}${rgb.g.toString(16).padStart(2, '0')}${rgb.b.toString(16).padStart(2, '0')}`;
    if (seen.has(canon)) continue;
    seen.add(canon);
    hex.push(canon);
    if (hex.length >= MAX_COLORS) break;
  }
  // 至少 8 色：用主强调与底色的混合继续补齐（确定性，不引入随机）
  const fillWeights = [0.42, 0.62, 0.18, 0.78, 0.32];
  for (const w of fillWeights) {
    if (hex.length >= MAX_COLORS) break;
    const h = mix(c.bg, c.accent, w);
    const rgb = hexToRgb(h);
    const canon = `#${rgb.r.toString(16).padStart(2, '0')}${rgb.g.toString(16).padStart(2, '0')}${rgb.b.toString(16).padStart(2, '0')}`;
    if (!seen.has(canon)) { seen.add(canon); hex.push(canon); }
  }
  let step = 1;
  while (hex.length < 8 && step <= 8) {
    const h = mix(c.bgDeep, c.accent, step / 9);
    const rgb = hexToRgb(h);
    const canon = `#${rgb.r.toString(16).padStart(2, '0')}${rgb.g.toString(16).padStart(2, '0')}${rgb.b.toString(16).padStart(2, '0')}`;
    if (!seen.has(canon)) { seen.add(canon); hex.push(canon); }
    step++;
  }

  const pal = {
    id: theme.id,
    count: hex.length,
    hex,
    rgb: hex.map((h) => { const { r, g, b } = hexToRgb(h); return [r, g, b]; }),
    bg: c.bg,
    bgDeep: c.bgDeep || c.bg,
    surface: c.surface || c.bg,
    ink: c.ink,
    paper: c.paper || c.ink,
    accent: c.accent,
    accentSoft: c.accentSoft || c.accent,
    darkAccent: mix(c.bgDeep || c.bg, c.accent, 0.3),
    accents,
    bayer: BAYER4,
    lutBits: 5,
  };

  // 浅色主题（paper-journal / claude-light / celadon-paper…）下，深底/纸白语义会反转。
  // 这里一次性给出与亮度无关的对比角色，页面只消费角色名，不再自己判断模式。
  const isLight = theme.mode === 'light' || relativeLuminance(c.bg) > 0.55;
  pal.isLight = isLight;
  pal.titleInk = isLight ? c.ink : (c.paper || c.ink);                       // 标题主色
  pal.outlineInk = isLight ? c.ink : (c.bgDeep || c.bg);                    // 1 格描边
  pal.shadowInk = isLight ? mix(c.accent, c.ink, 0.55) : pal.darkAccent;    // 投影
  pal.subtitleInk = isLight ? mix(c.accent, c.ink, 0.35) : (c.accentSoft || c.accent);
  pal.hudInk = isLight ? c.ink : (c.paper || c.ink);                        // HUD 中间文字
  pal.hudAccent = isLight ? c.accent : (c.accentSoft || c.accent);          // HUD 时间码
  pal.mutedInk = isLight ? mix(c.ink, c.bg, 0.35) : mix(c.paper || c.ink, c.bg, 0.3);
  pal.chipBg = isLight ? (c.paper || c.ink) : (c.bgDeep || c.bg);
  pal.starInk = isLight ? mix(c.ink, c.bg, 0.15) : (c.paper || c.ink);
  pal.ventInk = isLight ? mix(c.accent, c.ink, 0.3) : (c.accentSoft || c.accent);
  pal.groundShade = isLight ? c.ink : (c.bgDeep || c.bg);
  pal.groundAlpha = isLight ? 0.06 : 0.62;
  pal.canvasBg = isLight ? c.bg : (c.bgDeep || c.bg);

  _paletteCache.set(sig, pal);
  return pal;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. 量化查找表（5 bit/通道 = 32768 格）
 * ──────────────────────────────────────────────────────────────────────────── */

const _lutCache = new Map();

function buildLut(pal) {
  const sig = pal.hex.join('|');
  const hit = _lutCache.get(sig);
  if (hit) return hit;
  const lut = new Uint8Array(32768);
  const rgb = pal.rgb;
  for (let i = 0; i < 32768; i++) {
    const r = ((i >> 10) & 31) * 8 + 4;
    const g = ((i >> 5) & 31) * 8 + 4;
    const b = (i & 31) * 8 + 4;
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < rgb.length; k++) {
      const dr = r - rgb[k][0];
      const dg = g - rgb[k][1];
      const db = b - rgb[k][2];
      // 亮度加权，避免在深色里把红色算得比绿色近
      const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
      if (d < bestD) { bestD = d; best = k; }
    }
    lut[i] = best;
  }
  _lutCache.set(sig, lut);
  return lut;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. 每画布尺寸的离屏缓存
 * ──────────────────────────────────────────────────────────────────────────── */

const _canvasCache = new Map();

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  return c;
}

function scanPattern(ctx, step) {
  const key = `scan:${step}`;
  if (ctx.__cpScan && ctx.__cpScan.key === key) return ctx.__cpScan.pattern;
  const c = makeCanvas(1, step);
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,1)';
  g.fillRect(0, 0, 1, 1);
  const pattern = ctx.createPattern(c, 'repeat');
  ctx.__cpScan = { key, pattern };
  return pattern;
}

function getCache(W, H, pxOverride) {
  const px = pxOverride || Math.max(2, Math.round(Math.min(W / 480, H / 270)));
  const key = `${W}x${H}@${px}`;
  const hit = _canvasCache.get(key);
  if (hit) return hit;

  const lw = Math.ceil(W / px);
  const lh = Math.ceil(H / px);
  const low = makeCanvas(lw, lh);
  const stage = makeCanvas(lw * px, lh * px);
  const tintR = makeCanvas(W, H);
  const tintC = makeCanvas(W, H);
  const split = makeCanvas(W, H);
  const cache = {
    key, px, lw, lh, W, H,
    low, lowCtx: low.getContext('2d', { willReadFrequently: true }),
    stage, stageCtx: stage.getContext('2d'),
    tintR, tintRCtx: tintR.getContext('2d'),
    tintC, tintCCtx: tintC.getContext('2d'),
    split, splitCtx: split.getContext('2d'),
  };
  _canvasCache.set(key, cache);
  return cache;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. 六步效果链
 * ──────────────────────────────────────────────────────────────────────────── */

/** 步骤 1+2：量化 + Bayer 抖动，直接写回 ImageData.data。 */
function quantizeDither(data, lw, lh, pal, lut, strength) {
  const rgb = pal.rgb;
  for (let y = 0; y < lh; y++) {
    const brow = (y & 3) << 2;
    for (let x = 0; x < lw; x++) {
      const i = (y * lw + x) << 2;
      const b = BAYER4[brow + (x & 3)];
      const d = (b / 16 - 0.5) * strength;
      const r = clampByte(data[i] + d) >> 3;
      const g = clampByte(data[i + 1] + d) >> 3;
      const bl = clampByte(data[i + 2] + d) >> 3;
      const c = lut[(r << 10) | (g << 5) | bl] * 3;
      data[i] = rgb[c][0];
      data[i + 1] = rgb[c][1];
      data[i + 2] = rgb[c][2];
      // alpha 保持 255：整帧不透明，编码端不会出现黑边
      data[i + 3] = 255;
    }
  }
}

/** 步骤 4：RGB 通道错位（红 +dx，青 -dx，加法合成还原亮度）。 */
function chromaSplit(C, dx, W, H) {
  const r = C.tintRCtx;
  r.globalCompositeOperation = 'source-over';
  r.clearRect(0, 0, W, H);
  r.fillStyle = '#ff0000';
  r.fillRect(0, 0, W, H);
  r.globalCompositeOperation = 'multiply';
  r.drawImage(C.stage, 0, 0, W, H);

  const c = C.tintCCtx;
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#00ffff';
  c.fillRect(0, 0, W, H);
  c.globalCompositeOperation = 'multiply';
  c.drawImage(C.stage, 0, 0, W, H);

  const s = C.splitCtx;
  s.globalCompositeOperation = 'source-over';
  s.fillStyle = '#000000';
  s.fillRect(0, 0, W, H);
  s.globalCompositeOperation = 'lighter';
  s.drawImage(C.tintR, dx, 0);
  s.drawImage(C.tintC, -dx, 0);
  s.globalCompositeOperation = 'source-over';
  r.globalCompositeOperation = 'source-over';
  c.globalCompositeOperation = 'source-over';
}

/** 步骤 5：CRT 桶形（按行水平位移），行偏移量化后合并成少量 drawImage。 */
function crtRows(ctx, src, W, H, t, amp) {
  const breathe = 0.82 + 0.18 * Math.sin(t * 1.3);
  const A = amp * breathe;
  const syncFrame = Math.floor(t * 15);
  const offAt = (y) => {
    const yn = (y / Math.max(1, H - 1)) * 2 - 1;      // -1..1
    const bow = yn * yn - 0.5;                        // -0.5..0.5
    let dx = A * bow;
    // 极少量行同步抖动：1px，确定性，靠 hash 选行
    if (hash01(y, 97, syncFrame) > 0.994) dx += dx >= 0 ? 1 : -1;
    return Math.round(dx);
  };

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  let runStart = 0;
  let runOff = offAt(0);
  for (let y = 1; y <= H; y++) {
    const off = y < H ? offAt(y) : runOff + 1;
    if (off !== runOff) {
      ctx.drawImage(src, 0, runStart, W, y - runStart, runOff, runStart, W, y - runStart);
      runStart = y;
      runOff = off;
    }
  }
  ctx.restore();
}

/** 步骤 6：固定位置强调色辉光。 */
function accentGlow(ctx, W, H, pal, theme, t) {
  const m = (theme && theme.material) || {};
  const g = m.glow || {};
  const cx = W * (typeof g.x === 'number' ? g.x : 0.78);
  const cy = H * (typeof g.y === 'number' ? g.y : 0.24);
  const radius = Math.max(W, H) * 0.42;
  const breathe = 0.86 + 0.14 * Math.sin(t * 0.8 + 0.6);
  const base = (typeof g.alpha === 'number' ? g.alpha : 0.2) * (pal.isLight ? 0.55 : 1.35);
  const alpha = clamp01(base * breathe);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  grad.addColorStop(0, `rgba(${hexRgbCsv(pal.accent)},${alpha.toFixed(4)})`);
  grad.addColorStop(0.42, `rgba(${hexRgbCsv(pal.accent)},${(alpha * 0.34).toFixed(4)})`);
  grad.addColorStop(1, `rgba(${hexRgbCsv(pal.accent)},0)`);
  ctx.save();
  // 深色主题用加法叠辉光；浅色主题改用乘法，避免把纸白洗成粉色
  ctx.globalCompositeOperation = pal.isLight ? 'multiply' : 'lighter';
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function hexRgbCsv(hex) {
  const { r, g, b } = hexToRgb(hex);
  return `${r},${g},${b}`;
}

/**
 * 整帧绘制：低分辨率场景 →（1 量化 → 2 抖动）→ 放大 →（3 扫描线 → 4 色差 → 5 CRT）→ 6 辉光。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W @param {number} H
 * @param {number} t 秒，纯函数输入
 * @param {object|string} themeRef
 * @param {object} [opts]
 *   background: 'theme' | 'none'  默认 'theme'（在低分辨率缓冲里调用 drawThemeBackground）
 *   draw: (lowCtx, lw, lh, t) => void   在量化前画场景（文字也画在这里，一起被像素化）
 *   pixelScale: number            覆盖自动像素倍率（1920×1080 默认 4）
 *   dither: number                抖动强度（0–64），默认 28
 *   scanlineStep / scanlineAlpha  默认 3 / 0.14
 *   chroma: boolean | number      默认 true（1–2px 周期），数字则固定幅度
 *   crt: boolean                  默认 true
 *   crtAmp: number                默认 5
 *   glow: boolean                 默认 true
 * @returns {{palette:object,lw:number,lh:number,px:number,chroma:number,crtAmp:number}}
 */
export function drawCyberPixel(ctx, W, H, t, themeRef, opts = {}) {
  const theme = getTheme(themeRef);
  const pal = cyberPixelPalette(theme);
  const C = getCache(W, H, opts.pixelScale);
  const { lw, lh, px } = C;
  const low = C.lowCtx;

  // ---- 低分辨率场景（像素画布）----
  low.setTransform(1, 0, 0, 1, 0, 0);
  low.globalAlpha = 1;
  low.globalCompositeOperation = 'source-over';
  low.imageSmoothingEnabled = false;
  low.clearRect(0, 0, lw, lh);
  low.fillStyle = pal.bgDeep;
  low.fillRect(0, 0, lw, lh);

  if (opts.background !== 'none') {
    // 主题材质在低分辨率下同样成立；渐变随后会被 Bayer 抖动吃掉，正好成为有序网点
    try {
      drawThemeBackground(low, theme, lw, lh, t);
    } catch { /* 主题背景失败则保留纯色底，画面仍成立 */ }
  }
  if (typeof opts.draw === 'function') opts.draw(low, lw, lh, t);

  // ---- 1) 量化 + 2) Bayer 4×4 抖动 ----
  try {
    const img = low.getImageData(0, 0, lw, lh);
    quantizeDither(img.data, lw, lh, pal, buildLut(pal), opts.dither == null ? 28 : opts.dither);
    low.putImageData(img, 0, 0);
  } catch { /* tainted canvas：跳过量化，不阻断渲染 */ }

  // ---- 放大到 stage（最近邻，保持像素网格）----
  const sc = C.stageCtx;
  sc.setTransform(1, 0, 0, 1, 0, 0);
  sc.globalAlpha = 1;
  sc.globalCompositeOperation = 'source-over';
  sc.imageSmoothingEnabled = false;
  sc.clearRect(0, 0, C.stage.width, C.stage.height);
  sc.drawImage(C.low, 0, 0, lw, lh, 0, 0, lw * px, lh * px);

  // ---- 3) 扫描线：每 3px 一条，强度随 t 轻微呼吸 ----
  const step = Math.max(2, Math.round(opts.scanlineStep == null ? 3 : opts.scanlineStep));
  const pattern = opts.scanlines === false ? null : scanPattern(sc, step);
  if (pattern) {
    const base = opts.scanlineAlpha == null ? 0.14 : opts.scanlineAlpha;
    const breath = base * (0.82 + 0.18 * Math.sin(t * 2.3 + 1.1));
    sc.save();
    sc.globalAlpha = clamp01(breath);
    sc.fillStyle = pattern;
    sc.fillRect(0, 0, W, H);
    sc.restore();
  }

  // ---- 4) RGB 通道偏移 1–2px（幅度是 t 的周期函数）----
  const chromaOn = opts.chroma !== false;
  const dx = !chromaOn
    ? 0
    : (typeof opts.chroma === 'number'
      ? Math.max(0, Math.round(opts.chroma))
      : Math.round(1 + 1 * (0.5 + 0.5 * Math.sin(t * 2.0 + 0.4))));
  if (dx > 0) chromaSplit(C, dx, W, H);

  // ---- 5) CRT 桶形（按行位移，幅度小）----
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = pal.bgDeep;
  ctx.fillRect(0, 0, W, H);
  const crtAmp = opts.crt === false ? 0 : (opts.crtAmp == null ? 5 : opts.crtAmp);
  if (crtAmp > 0) {
    crtRows(ctx, dx > 0 ? C.split : C.stage, W, H, t, crtAmp);
  } else {
    ctx.drawImage(dx > 0 ? C.split : C.stage, 0, 0, W, H, 0, 0, W, H);
  }
  ctx.restore();

  // ---- 6) 强调色辉光（径向，固定位置）----
  if (opts.glow !== false) accentGlow(ctx, W, H, pal, theme, t);

  return { palette: pal, lw, lh, px, chroma: dx, crtAmp };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5. 方块字：按字符绘制，保留字距，CJK 安全
 * ──────────────────────────────────────────────────────────────────────────── */

const DEFAULT_FAMILY = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
const _glyphCache = new Map();
let _scratch = null;

function scratchCtx() {
  if (!_scratch) {
    const c = makeCanvas(8, 8);
    _scratch = c.getContext('2d', { willReadFrequently: true });
  }
  return _scratch;
}

function graphemes(text) {
  const s = String(text == null ? '' : text);
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      return [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(s)].map((x) => x.segment);
    } catch { /* fall through */ }
  }
  return Array.from(s);
}

/** 把字符栅格化成 block 网格；返回主色 runs 和 1 格描边 runs。 */
function buildGlyph(ch, size, weight, family, block, dither) {
  const key = `${family}|${weight}|${size}|${block}|${dither ? 1 : 0}|${ch}`;
  const hit = _glyphCache.get(key);
  if (hit) return hit;

  const ctx = scratchCtx();
  ctx.font = `${weight} ${size}px ${family}`;
  const advance = Math.max(1, Math.ceil(ctx.measureText(ch).width));
  const cellH = Math.max(1, Math.ceil(size * 1.4));
  const bw = Math.max(1, Math.ceil(advance / block));
  const bh = Math.max(1, Math.ceil(cellH / block));

  // 在 block 分辨率的 3× 超采样画布上栅格化，再按覆盖率阈值降到 block 网格。
  // 小字号 CJK 的 1px 笔画靠单点采样会碎，覆盖率采样能保住字形结构。
  const SS = 3;
  const hw = bw * SS;
  const hh = bh * SS;
  const c = makeCanvas(hw, hh);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, hw, hh);
  g.fillStyle = '#ffffff';
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.font = `${weight} ${Math.max(1, (size / block) * SS)}px ${family}`;
  g.fillText(ch, 0, ((size * 1.06) / block) * SS);
  let data;
  try { data = g.getImageData(0, 0, hw, hh).data; } catch { data = null; }

  const on = new Uint8Array(bw * bh);
  if (data) {
    const inv = 1 / (SS * SS * 255);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        let sum = 0;
        for (let sy = 0; sy < SS; sy++) {
          let idx = ((y * SS + sy) * hw + x * SS) * 4 + 3;
          for (let sx = 0; sx < SS; sx++) { sum += data[idx]; idx += 4; }
        }
        const cov = sum * inv;
        const b = BAYER4[((y & 3) << 2) | (x & 3)];
        const thresh = dither ? 0.24 + (b / 16) * 0.55 : 0.5;
        on[y * bw + x] = cov > thresh ? 1 : 0;
      }
    }
  }

  // 膨胀 1 格（8 邻域）作为描边
  const outline = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (!on[y * bw + x]) continue;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
          outline[ny * bw + nx] = 1;
        }
      }
    }
  }

  const runsOf = (mask) => {
    const runs = [];
    for (let y = 0; y < bh; y++) {
      let start = -1;
      for (let x = 0; x <= bw; x++) {
        const v = x < bw ? mask[y * bw + x] : 0;
        if (v && start < 0) start = x;
        else if (!v && start >= 0) { runs.push([y, start, x - 1]); start = -1; }
      }
    }
    return runs;
  };

  const entry = {
    bw, bh, advance,
    runs: runsOf(on),
    outlineRuns: runsOf(outline),
  };
  if (_glyphCache.size > 512) _glyphCache.clear();
  _glyphCache.set(key, entry);
  return entry;
}

function fillRuns(ctx, runs, x0, y0, block) {
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    ctx.fillRect(x0 + r[1] * block, y0 + r[0] * block, (r[2] - r[1] + 1) * block, block);
  }
}

/** 排版测量：给居中 / 换行用。 */
export function measurePixelText(ctx, text, size, opts = {}) {
  const family = opts.family || DEFAULT_FAMILY;
  const weight = opts.weight == null ? 900 : opts.weight;
  const chars = graphemes(text);
  const block = Math.max(1, Math.round(opts.block || 1));
  const spacing = opts.letterSpacing == null ? Math.max(1, Math.round(size * 0.035)) : opts.letterSpacing;
  const advances = chars.map(() => 1);
  // measureText 依赖当前 font；调用方可能没设，先按目标字体量
  ctx.save();
  ctx.font = `${weight} ${size}px ${family}`;
  for (let i = 0; i < chars.length; i++) advances[i] = Math.max(1, Math.ceil(ctx.measureText(chars[i]).width || 1));
  ctx.restore();
  const width = advances.reduce((a, b) => a + b, 0) + spacing * Math.max(0, chars.length - 1);
  return {
    chars, advances, width,
    height: Math.ceil(size * 1.4),
    block, spacing,
  };
}

/**
 * 像素化方块字。每个字符单独栅格化到 block 网格，因此 CJK 不会被拆字，
 * 字距由 advance + letterSpacing 明确保留。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x @param {number} y
 * @param {number} size 字号（像素，指未分块前的字号）
 * @param {string} color
 * @param {object} [opts]
 *   align: 'left'|'center'|'right'（默认 center）
 *   baseline: 'middle'|'top'（默认 middle）
 *   family, weight, block, letterSpacing, dither (默认 true)
 *   outline: 颜色 | null            1 格描边
 *   shadow: 颜色 | null             右下 1 格投影
 *   alpha: 0..1
 *   perChar: (i, ch, n) => ({ dx, dy, alpha, color })  逐字动画（dy/dx 以像素计，建议取 block 倍数）
 */
export function drawPixelText(ctx, text, x, y, size, color, opts = {}) {
  const m = measurePixelText(ctx, text, size, opts);
  const { chars, advances, block, spacing } = m;
  if (!chars.length) return m;

  const align = opts.align || 'center';
  const baseline = opts.baseline || 'middle';
  const weight = opts.weight == null ? 900 : opts.weight;
  const family = opts.family || DEFAULT_FAMILY;
  const dither = opts.dither !== false;
  const cellH = m.height;
  let cursor = align === 'center' ? -m.width / 2 : align === 'right' ? -m.width : 0;
  const originY = baseline === 'top' ? y : y - cellH / 2;

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const per = typeof opts.perChar === 'function' ? (opts.perChar(i, ch, chars.length) || {}) : {};
    const alpha = clamp01((opts.alpha == null ? 1 : opts.alpha) * (per.alpha == null ? 1 : per.alpha));
    if (alpha > 0.004 && ch.trim() !== '') {
      const glyph = buildGlyph(ch, size, weight, family, block, dither);
      const gx = Math.round(x + cursor + (per.dx || 0));
      const gy = Math.round(originY + (per.dy || 0));
      ctx.globalAlpha = alpha;
      if (opts.shadow) {
        ctx.fillStyle = opts.shadow;
        fillRuns(ctx, glyph.outlineRuns, gx + block, gy + block, block);
      }
      if (opts.outline) {
        ctx.fillStyle = opts.outline;
        fillRuns(ctx, glyph.outlineRuns, gx, gy, block);
      }
      ctx.fillStyle = per.color || color;
      fillRuns(ctx, glyph.runs, gx, gy, block);
    }
    cursor += advances[i] + spacing;
  }
  ctx.restore();
  return m;
}
