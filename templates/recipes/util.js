/**
 * util.js — 四个风格配方页（templates/recipe-*.html）共用的小工具。
 *
 * 设计约束：
 *   - 纯函数优先：所有输出只依赖显式输入（t / 索引 / seed），不读墙钟、不用随机数；
 *   - 不依赖 DOM，除了 setupStage / drawHud 这类确实要写 canvas 的函数；
 *   - 不引入渐变缓存或离屏画布，那些留给各页面自己管（页面级单例）。
 *
 * 画幅契约（D7）：画布尺寸一律来自 window.innerWidth / window.innerHeight，
 * 取偶数、缺省回退 1920×1080；页面不再硬编码 1920×1080。
 */

export const TAU = Math.PI * 2;

// v2.4/P1-06：安全区唯一真值。util.js 只 re-export，页面继续 import safePad。
import { safe } from '../tokens.mjs';

/* ─────────────────────────────── 数值 / 缓动 ─────────────────────────────── */

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const fract = (x) => x - Math.floor(x);

/** smoothstep 0..1（clamp 输入）。 */
export const smooth = (t) => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};

// v2.3：缓动唯一真值是 templates/motion.js。
// 本文件原先是第三份手抄副本；motion.js 的同名函数逐点数值相同，
// 改成 re-export 是零像素变化。
export { ease } from '../motion.js';

/* ─────────────────────────────── 确定性哈希 ─────────────────────────────── */

/** 32 位整数哈希 → 0..1。同一 (n, seed) 永远同一个值。 */
export function hash01(n, seed = 0) {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed | 0, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 二维整数哈希 → 0..1（网格抖动、星空、纸纤维都够用）。 */
export function hash2(x, y, seed = 0) {
  let h = Math.imul((x | 0) ^ 0x9e3779b1, 0x85ebca6b);
  h = Math.imul(h ^ (y | 0), 0xc2b2ae35);
  h = Math.imul(h ^ (seed | 0), 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** 种子随机数（只用于启动时预渲染离屏图层，不用于逐帧绘制）。 */
export function mulberry32(seed = 1) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ─────────────────────────────── 文本 / 时间码 ─────────────────────────────── */

export const pad2 = (v) => String(Math.max(0, Math.floor(v))).padStart(2, '0');
export const pad3 = (v) => String(Math.max(0, Math.floor(v))).padStart(3, '0');

/** 千分位（手写，不依赖 locale）。 */
export function formatInt(n) {
  const s = String(Math.max(0, Math.round(n)));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return out;
}

/** 时间码 hh:mm:ss:ff（ff 按 fps 取整，避免帧号漂移）。 */
export function timecode(u, fps = 30) {
  const t = Math.max(0, u);
  const total = Math.floor(t);
  return `${pad2(Math.floor(total / 3600))}:${pad2(Math.floor(total / 60) % 60)}:${pad2(total % 60)}:${pad2(Math.floor(fract(t) * fps))}`;
}

/* ─────────────────────────────── 画布尺寸（D7） ─────────────────────────────── */

const even = (v) => Math.max(2, Math.floor(v / 2) * 2);

/**
 * 按视口取画布尺寸；画布 CSS 尺寸同步，避免 1:1 映射被浏览器缩放。
 * @returns {{W:number,H:number,portrait:boolean,landscape:boolean,square:boolean}}
 */
export function setupStage(canvas, fallbackW = 1920, fallbackH = 1080) {
  const iw = typeof window !== 'undefined' ? window.innerWidth : 0;
  const ih = typeof window !== 'undefined' ? window.innerHeight : 0;
  const W = even(iw || fallbackW);
  const H = even(ih || fallbackH);
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const ratio = W / H;
  return {
    W,
    H,
    portrait: ratio < 0.95,
    landscape: ratio > 1.05,
    square: ratio >= 0.95 && ratio <= 1.05,
  };
}

/**
 * 安全区边距：1080p 下约 81px，竖屏按短边走。
 * v2.4/P1-06：唯一真值移到 tokens.mjs 的 safe()，这里只做兼容 re-export，
 * 避免 13 个页面各自维护一套百分比。
 */
export function safePad(W, H) {
  return safe(W, H).x;
}

/* ─────────────────────────────── 排版 ─────────────────────────────── */

export function measureChars(ctx, chars, { size, family, weight = 900, spacing = 0 }) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${family}`;
  const advances = chars.map((ch) => ctx.measureText(ch).width);
  ctx.restore();
  const total = advances.reduce((a, b) => a + b, 0) + spacing * Math.max(0, chars.length - 1);
  return { advances, total };
}

/**
 * 二分出能塞进 maxWidth 的最大字号。
 * spacing 是「字距 / 字号」的比例（0.02 = 2% em）。
 */
export function fitTextSize(ctx, text, {
  maxWidth, family = '"Noto Sans SC", sans-serif', weight = 900,
  maxSize = 320, minSize = 12, spacing = 0.02,
} = {}) {
  const chars = Array.from(String(text));
  if (!chars.length || !(maxWidth > 0)) return Math.max(minSize, 1);
  let lo = minSize;
  let hi = Math.max(minSize + 1, maxSize);
  let best = minSize;
  ctx.save();
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    ctx.font = `${weight} ${mid}px ${family}`;
    let w = 0;
    for (const ch of chars) w += ctx.measureText(ch).width;
    w += mid * spacing * Math.max(0, chars.length - 1);
    if (w <= maxWidth) { best = mid; lo = mid; } else hi = mid;
  }
  ctx.restore();
  return Math.max(minSize, Math.floor(best));
}

/**
 * 逐字绘制 + 统一字距（CJK 不会像 letterSpacing 属性那样在部分字体上失效）。
 * 返回整段宽度。调用方负责 save/restore 与 globalAlpha。
 */
export function drawTracked(ctx, text, x, y, {
  size = 24, family = '"JetBrains Mono", monospace', weight = 500,
  color = '#ffffff', tracking = 0, align = 'left', baseline = 'middle',
} = {}) {
  const chars = Array.from(String(text));
  if (!chars.length) return 0;
  ctx.save();
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = baseline;
  ctx.fillStyle = color;
  const advances = chars.map((ch) => ctx.measureText(ch).width);
  const total = advances.reduce((a, b) => a + b, 0) + tracking * Math.max(0, chars.length - 1);
  let cursor = align === 'center' ? -total / 2 : align === 'right' ? -total : 0;
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], x + cursor, y);
    cursor += advances[i] + tracking;
  }
  ctx.restore();
  return total;
}

/* ─────────────────────────────── 形状 / HUD ─────────────────────────────── */

export function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(Math.max(0, r), Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const MONO = '"JetBrains Mono", ui-monospace, monospace';

/**
 * 底部 HUD：左侧 STYLE 编号 + 风格名，中间品牌/帧号，右侧时间码。
 * 颜色默认取主题 hud 角色；页面可覆盖。
 */
export function drawHud(ctx, {
  W, H, u, duration = 3, fps = 30,
  theme = null, label = 'STYLE 13 / 16', name = 'RECIPE', brand = '',
  pad = safePad(W, H), font = MONO,
  accent, ink, frameColor,
} = {}) {
  const s = clamp(Math.min(W, H) / 1080, 0.55, 2.4);
  const size = Math.round(20 * s);
  const y = H - pad;
  const lineY = y - size * 1.95;
  const hud = (theme && theme.hud) || {};
  const accentColor = accent || hud.capsuleNumber || '#d97757';
  const inkColor = ink || hud.hudText || 'rgba(245,240,232,0.42)';
  const tcColor = frameColor || hud.countdown || inkColor;

  ctx.save();
  ctx.globalAlpha = 0.42;
  ctx.strokeStyle = inkColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, lineY + 0.5);
  ctx.lineTo(W - pad, lineY + 0.5);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const wLabel = drawTracked(ctx, label, pad, y, {
    size, family: font, weight: 600, color: accentColor,
    tracking: size * 0.14, baseline: 'alphabetic',
  });
  drawTracked(ctx, `· ${name}`, pad + wLabel + size * 0.85, y, {
    size, family: font, weight: 500, color: inkColor,
    tracking: size * 0.14, baseline: 'alphabetic',
  });

  if (W > 820) {
    const center = `${brand ? `${brand} · ` : ''}FRAME ${pad3(Math.round(u * fps))} / ${pad3(Math.round(duration * fps))}`;
    drawTracked(ctx, center, W / 2, y, {
      size: Math.round(size * 0.9), family: font, weight: 500, color: inkColor,
      tracking: size * 0.1, align: 'center', baseline: 'alphabetic',
    });
  }

  ctx.font = `600 ${size}px ${font}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = tcColor;
  ctx.fillText(`TC ${timecode(u, fps)}`, W - pad, y);
  ctx.restore();
}

/** 右上角品牌 / 主题标签（透明度压在 0.6 以内，不抢主视觉）。 */
export function drawTopMeta(ctx, {
  W, H, pad = safePad(W, H), text = '', sub = '',
  color = 'rgba(245,240,232,0.42)', accent = '#d97757',
  font = MONO, align = 'right',
} = {}) {
  if (!text) return;
  const s = clamp(Math.min(W, H) / 1080, 0.55, 2.4);
  const size = Math.round(18 * s);
  const x = align === 'right' ? W - pad : pad;
  const y = pad * 0.78;
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  ctx.font = `600 ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  const w = ctx.measureText(text).width;
  ctx.fillStyle = accent;
  const dot = Math.max(3, Math.round(size * 0.22));
  const dotX = align === 'right' ? x - w - size * 0.7 : x + w + size * 0.7;
  ctx.fillRect(Math.round(dotX), Math.round(y - dot / 2), dot, dot);
  if (sub) {
    ctx.font = `400 ${Math.round(size * 0.82)}px ${font}`;
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = color;
    ctx.fillText(sub, x, y + size * 1.45);
  }
  ctx.restore();
}
