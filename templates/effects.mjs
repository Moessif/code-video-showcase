/**
 * effects.mjs — 共享确定性效果库（v2.5）。
 *
 * 背景：v2.4 之前效果散落在 motion.js（grain/scanlines/RGB-split/bloom/halation/
 * kinetic text）与各 recipe 页里，没有统一目录，也没有「同一效果跨页复用」的入口。
 * 对标 Remotion (@remotion/noise / motion-blur / effects 目录)、editly (gl-transitions)、
 * FFCreator (~90 animate 效果) 与 subtitled-skill 的 kinetic 字幕，这里把效果收敛成
 * 一张**命名目录** + 一组**纯函数核**。
 *
 * 铁律（与全片确定性契约一致）：
 *   - 一切输出只是 (t, seed, 显式参数) 的纯函数；
 *   - 禁 Math.random / Date.now / performance.now / rAF；
 *   - 粒子用种子哈希闭式求解（不是逐帧积分），同一 t 永远同一画面；
 *   - 纯核（scrambleText / particleField / kenBurns / spectrumBins / …）不碰 DOM，
 *     Node 单测可直接验证确定性；canvas 包装只在浏览器里跑。
 *
 * 复用：grain/scanlines/RGBSplit/bloom/halation/kineticText 直接 re-export motion.js，
 * 不抄第二份。新增的是 vignette/halftone/dotGrid/particles/spectrum/lightLeak/crt/
 * duotone/scramble/splitFlap/kenBurns/shake/beatPulse 等。
 *
 * 用法：
 *   import { EFFECTS, particleField, drawParticles, applyPost, effectProbe } from './effects.mjs';
 *   drawParticles(ctx, { kind: 'confetti', t, seed: 7, W, H });
 *   applyPost(ctx, 'vignette', t, { W, H, strength: 0.5 });
 */

import { clamp, lerp, ease } from './motion.js';
import {
  drawGrain, drawScanlines, drawRGBSplit, drawBloom, drawHalation, drawKineticText,
} from './motion.js';

// 目录复用的 motion.js 后期/文字原语一并 re-export：页面可以统一从 effects.mjs
// 取任何目录里列出的效果（EFFECTS[*].draw 引用的名字都必须可 import）。
export { drawGrain, drawScanlines, drawRGBSplit, drawBloom, drawHalation, drawKineticText };

export const TAU = Math.PI * 2;

/* ───────────────────────────── 确定性哈希 / 种子 ───────────────────────────── */
// 与 recipes/util.js 同算法（逐位一致），独立一份避免循环依赖、保证 Node 可跑。

/** 32 位整数哈希 → 0..1。同一 (n, seed) 永远同一个值。 */
export function hash01(n, seed = 0) {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed | 0, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 种子随机数（只用于启动时预渲染，不用于逐帧绘制）。 */
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

const fract = (x) => x - Math.floor(x);

/* ───────────────────────────── 效果目录 ───────────────────────────── */
/**
 * 命名目录。category ∈ text | particle | post | camera | audio。
 * core 指向纯函数核（Node 可测）；draw 指向 canvas 包装（浏览器）。
 * 这张表就是 docs/COVERAGE.md 效果维度的单一真值。
 */
export const EFFECTS = {
  // text —— 文字揭示
  typewriter: { category: 'text', label: '打字机', core: 'typewriterText', draw: 'drawKineticText' },
  scramble: { category: 'text', label: '乱码解码', core: 'scrambleText', draw: 'drawScrambleText' },
  splitFlap: { category: 'text', label: '翻牌', core: 'splitFlapProgress', draw: 'drawScrambleText' },
  maskWipe: { category: 'text', label: '遮罩擦除', core: null, draw: 'drawKineticText' },
  charStagger: { category: 'text', label: '逐字错峰', core: null, draw: 'drawKineticText' },
  // particle —— 粒子（种子闭式）
  confetti: { category: 'particle', label: '彩纸', core: 'particleField', draw: 'drawParticles' },
  sparks: { category: 'particle', label: '火花', core: 'particleField', draw: 'drawParticles' },
  snow: { category: 'particle', label: '落雪', core: 'particleField', draw: 'drawParticles' },
  bubbles: { category: 'particle', label: '气泡', core: 'particleField', draw: 'drawParticles' },
  embers: { category: 'particle', label: '余烬', core: 'particleField', draw: 'drawParticles' },
  // post —— 后期
  grain: { category: 'post', label: '颗粒', core: null, draw: 'drawGrain' },
  scanlines: { category: 'post', label: '扫描线', core: null, draw: 'drawScanlines' },
  chromatic: { category: 'post', label: '色散', core: null, draw: 'drawRGBSplit' },
  bloom: { category: 'post', label: '泛光', core: null, draw: 'drawBloom' },
  halation: { category: 'post', label: '光晕', core: null, draw: 'drawHalation' },
  vignette: { category: 'post', label: '暗角', core: 'vignetteFactor', draw: 'drawVignette' },
  halftone: { category: 'post', label: '半调网点', core: 'halftoneRadius', draw: 'drawHalftone' },
  dotGrid: { category: 'post', label: '点阵', core: null, draw: 'drawDotGrid' },
  lightLeak: { category: 'post', label: '漏光', core: null, draw: 'drawLightLeak' },
  crt: { category: 'post', label: 'CRT', core: null, draw: 'drawCRT' },
  duotone: { category: 'post', label: '双色调', core: null, draw: 'drawDuotone' },
  // camera —— 相机
  kenBurns: { category: 'camera', label: '肯·伯恩斯', core: 'kenBurns', draw: null },
  shake: { category: 'camera', label: '抖动', core: 'cameraShake', draw: null },
  parallax: { category: 'camera', label: '视差', core: 'parallaxOffset', draw: null },
  // audio —— 音频反应（确定性伪频谱）
  beatPulse: { category: 'audio', label: '节拍脉冲', core: 'beatPulse', draw: null },
  spectrum: { category: 'audio', label: '频谱条', core: 'spectrumBins', draw: 'drawSpectrum' },
};

export const EFFECT_IDS = Object.keys(EFFECTS);
export const EFFECT_CATEGORIES = ['text', 'particle', 'post', 'camera', 'audio'];

/** 合法效果名？ */
export function isEffect(v) {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(EFFECTS, v);
}

/* ───────────────────────────── 纯核：文字 ───────────────────────────── */

/**
 * 打字机：progress p∈0..1 时显示前 floor(p*len) 个字符。纯函数。
 */
export function typewriterText(text, p) {
  const chars = Array.from(String(text));
  const n = Math.round(clamp(p) * chars.length);
  return chars.slice(0, n).join('');
}

const SCRAMBLE_GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&@!<>/\\';

/**
 * 乱码解码揭示：p∈0..1。前 floor(p*len) 个字符已「解码」为真字，
 * 其余显示种子乱码；乱码随时间量子 floor(t*rate) 闪烁（仍是纯函数）。
 * @returns {string}
 */
export function scrambleText(text, p, { seed = 1, t = 0, rate = 18 } = {}) {
  const chars = Array.from(String(text));
  const resolved = Math.floor(clamp(p) * chars.length);
  const q = Math.floor(Math.max(0, t) * rate);
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    if (i < resolved || chars[i] === ' ') { out += chars[i]; continue; }
    const g = SCRAMBLE_GLYPHS[Math.floor(hash01(i + 1, seed + q) * SCRAMBLE_GLYPHS.length)];
    out += g;
  }
  return out;
}

/**
 * 翻牌：每个字符在 p 推进时依次「翻到位」。返回每字符的局部进度 0..1。
 * 纯函数；调用方据此选字形/旋转。
 */
export function splitFlapProgress(text, p, { stagger = 0.6 } = {}) {
  const chars = Array.from(String(text));
  const n = Math.max(1, chars.length);
  return chars.map((_, i) => {
    const delay = (i / n) * stagger;
    return clamp((clamp(p) - delay) / Math.max(1e-6, 1 - stagger));
  });
}

/* ───────────────────────────── 纯核：粒子 ───────────────────────────── */

/**
 * 确定性粒子场：count 个粒子，每个的位置/大小/透明度只是 (i, t, seed) 的闭式函数。
 * 不做逐帧积分 → 任意 t 直接求值，逐帧可复现。
 * kind: confetti | sparks | snow | bubbles | embers
 * @returns {Array<{x:number,y:number,r:number,alpha:number,rot:number,hue:number}>}
 */
export function particleField(kind, t, { seed = 1, count = 60, W = 1920, H = 1080 } = {}) {
  const out = [];
  const tt = Math.max(0, t);
  for (let i = 0; i < count; i++) {
    const h0 = hash01(i * 3 + 1, seed);
    const h1 = hash01(i * 3 + 2, seed);
    const h2 = hash01(i * 3 + 3, seed);
    const h3 = hash01(i * 7 + 5, seed);
    let x, y, r, alpha, rot;
    if (kind === 'snow') {
      const speed = 40 + h1 * 90;
      x = (h0 * W + Math.sin(tt * (0.4 + h2) + i) * 30 + W) % W;
      y = (h1 * H + tt * speed) % H;
      r = 1.5 + h2 * 3.5;
      alpha = 0.35 + h3 * 0.5;
      rot = 0;
    } else if (kind === 'bubbles') {
      const speed = 30 + h1 * 70;
      x = (h0 * W + Math.sin(tt * (0.6 + h2) + i) * 18 + W) % W;
      y = (H - ((h1 * H + tt * speed) % H));
      r = 3 + h2 * 14;
      alpha = 0.12 + h3 * 0.3;
      rot = 0;
    } else if (kind === 'confetti') {
      const fall = (tt * (120 + h1 * 160)) % (H + 80);
      x = (h0 * W + Math.sin(tt * (1 + h2 * 2) + i) * 60 + W) % W;
      y = fall - 40;
      r = 3 + h2 * 6;
      alpha = 0.7 + h3 * 0.3;
      rot = tt * (2 + h1 * 6) + i;
    } else if (kind === 'sparks') {
      const life = fract(tt * (0.5 + h1 * 0.8) + h0);
      const ang = h2 * TAU;
      const dist = life * (120 + h3 * 320);
      x = W / 2 + Math.cos(ang) * dist;
      y = H / 2 + Math.sin(ang) * dist * 0.7;
      r = (1 - life) * (2 + h3 * 4);
      alpha = (1 - life) * 0.9;
      rot = ang;
    } else { // embers
      const speed = 25 + h1 * 55;
      x = (h0 * W + Math.sin(tt * (0.5 + h2) + i) * 24 + W) % W;
      y = H - ((h1 * H + tt * speed) % H);
      r = 1 + h2 * 3;
      alpha = (0.3 + h3 * 0.6) * (0.6 + 0.4 * Math.sin(tt * 3 + i));
      rot = 0;
    }
    out.push({ x, y, r: Math.max(0.2, r), alpha: clamp(alpha), rot, hue: h3 });
  }
  return out;
}

/* ───────────────────────────── 纯核：相机 ───────────────────────────── */

/**
 * 肯·伯恩斯：在 dur 内从 from 缓动到 to（scale + 平移）。纯函数。
 * @returns {{scale:number,x:number,y:number}}
 */
export function kenBurns(t, { dur = 3, from = { scale: 1, x: 0, y: 0 }, to = { scale: 1.12, x: 0, y: 0 }, easing = 'inOutCubic' } = {}) {
  const fn = ease[easing] || ease.inOutCubic;
  const k = fn(clamp(t / Math.max(1e-6, dur)));
  return {
    scale: lerp(from.scale, to.scale, k),
    x: lerp(from.x, to.x, k),
    y: lerp(from.y, to.y, k),
  };
}

/**
 * 衰减抖动：amp 像素，随 t 指数衰减，方向由种子噪声决定。纯函数。
 * @returns {{x:number,y:number}}
 */
export function cameraShake(t, { seed = 1, amp = 14, decay = 6, freq = 40 } = {}) {
  const tt = Math.max(0, t);
  const env = amp * Math.exp(-tt * decay);
  return {
    x: env * Math.sin(tt * freq + hash01(1, seed) * TAU),
    y: env * Math.cos(tt * freq * 0.83 + hash01(2, seed) * TAU),
  };
}

/** 视差：深度 depth∈0..1 的图层随相机平移产生的偏移。纯函数。 */
export function parallaxOffset(camX, camY, depth = 0.5) {
  return { x: camX * clamp(depth), y: camY * clamp(depth) };
}

/* ───────────────────────────── 纯核：音频反应 ───────────────────────────── */

/** 节拍脉冲 0..1（与 common.js pulse 同式）。纯函数。 */
export function beatPulse(t, bpm = 120, decay = 6) {
  const ph = fract(Math.max(0, t) * (bpm / 60));
  return Math.exp(-ph * decay);
}

/**
 * 确定性伪频谱：n 条 bin 的高度 0..1，随 t 起伏（不是真 FFT，是种子闭式动画，
 * 用于「音频反应」视觉而无需解码音频）。低频强、高频弱，叠加节拍脉冲。
 * @returns {number[]} 长度 n
 */
export function spectrumBins(t, { seed = 1, n = 24, bpm = 120 } = {}) {
  const tt = Math.max(0, t);
  const pulse = beatPulse(tt, bpm, 4);
  const out = [];
  for (let i = 0; i < n; i++) {
    const envelope = Math.pow(1 - i / Math.max(1, n - 1), 0.7); // 低频 stronger
    const f = 1.5 + hash01(i + 1, seed) * 5;
    const ph = hash01(i + 2, seed) * TAU;
    const osc = 0.5 + 0.5 * Math.sin(tt * f + ph);
    out.push(clamp(envelope * (0.35 + 0.65 * osc) * (0.7 + 0.5 * pulse)));
  }
  return out;
}

/* ───────────────────────────── 纯核：后期 ───────────────────────────── */

/**
 * 暗角系数：归一化坐标 (nx,ny)∈[-1,1] 处的亮度乘子 0..1。
 * 中心 1，边缘 1-strength。纯函数。
 */
export function vignetteFactor(nx, ny, strength = 0.5) {
  const d = Math.sqrt(nx * nx + ny * ny) / Math.SQRT2; // 0..1（角最远）
  return clamp(1 - clamp(strength) * d * d, 0, 1);
}

/**
 * 半调网点半径：给定亮度 luma∈0..1 与格子 cell，返回网点半径（暗处大）。纯函数。
 */
export function halftoneRadius(luma, cell = 8) {
  return clamp(1 - clamp(luma)) * (cell / 2) * 0.95;
}

/* ───────────────────────────── canvas 包装（浏览器） ───────────────────────────── */

/** 暗角：径向渐变压暗四角。 */
export function drawVignette(ctx, { W = 1920, H = 1080, strength = 0.5, color = '0,0,0' } = {}) {
  if (typeof document === 'undefined') return;
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
  g.addColorStop(0, `rgba(${color},0)`);
  g.addColorStop(1, `rgba(${color},${clamp(strength)})`);
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** 半调网点：按格子采样亮度画点（近似，用固定灰度梯度演示）。 */
export function drawHalftone(ctx, { W = 1920, H = 1080, cell = 10, color = '#000000', alpha = 0.5, t = 0 } = {}) {
  if (typeof document === 'undefined') return;
  ctx.save();
  ctx.globalAlpha = clamp(alpha);
  ctx.fillStyle = color;
  for (let y = cell / 2; y < H; y += cell) {
    for (let x = cell / 2; x < W; x += cell) {
      const luma = 0.5 + 0.5 * Math.sin((x / W) * 3 + t * 0.3) * Math.cos((y / H) * 3);
      const r = halftoneRadius(luma, cell);
      if (r <= 0.3) continue;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** 点阵背景：规则圆点网格。 */
export function drawDotGrid(ctx, { W = 1920, H = 1080, step = 36, r = 1.6, color = 'rgba(255,255,255,0.10)' } = {}) {
  if (typeof document === 'undefined') return;
  ctx.save();
  ctx.fillStyle = color;
  for (let y = step / 2; y < H; y += step) {
    for (let x = step / 2; x < W; x += step) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** 粒子：调用纯核 particleField 再逐个画。 */
export function drawParticles(ctx, { kind = 'confetti', t = 0, seed = 1, count = 60, W = 1920, H = 1080, palette = null } = {}) {
  if (typeof document === 'undefined') return;
  const parts = particleField(kind, t, { seed, count, W, H });
  const colors = palette || ['#ff5f9e', '#ffcf5c', '#58c4dd', '#a58bff', '#7ee08a'];
  ctx.save();
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    ctx.globalAlpha = p.alpha;
    if (kind === 'confetti') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(-p.r, -p.r * 0.5, p.r * 2, p.r);
      ctx.restore();
    } else if (kind === 'bubbles') {
      ctx.strokeStyle = colors[i % colors.length];
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.stroke();
    } else {
      ctx.fillStyle = kind === 'embers' || kind === 'sparks' ? '#ffb347' : colors[i % colors.length];
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** 频谱条：底部 n 条确定性频谱。 */
export function drawSpectrum(ctx, { t = 0, seed = 1, n = 24, bpm = 120, W = 1920, H = 1080, color = '#58c4dd', maxH = null } = {}) {
  if (typeof document === 'undefined') return;
  const bins = spectrumBins(t, { seed, n, bpm });
  const mh = maxH || H * 0.22;
  const bw = W / n;
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const h = bins[i] * mh;
    ctx.globalAlpha = 0.55 + 0.45 * bins[i];
    ctx.fillRect(i * bw + bw * 0.18, H - h, bw * 0.64, h);
  }
  ctx.restore();
}

/** 漏光：暖色径向光斑扫过（种子定位，t 漂移）。 */
export function drawLightLeak(ctx, { t = 0, seed = 3, W = 1920, H = 1080, strength = 0.35 } = {}) {
  if (typeof document === 'undefined') return;
  const cx = W * (0.2 + 0.6 * hash01(1, seed)) + Math.sin(t * 0.4) * W * 0.08;
  const cy = H * (0.15 + 0.4 * hash01(2, seed));
  const r = Math.max(W, H) * (0.4 + 0.2 * hash01(3, seed));
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `rgba(255,170,80,${clamp(strength)})`);
  g.addColorStop(0.5, `rgba(255,90,60,${clamp(strength * 0.4)})`);
  g.addColorStop(1, 'rgba(255,90,60,0)');
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** CRT：扫描线 + 暗角 + 轻微 RGB 边缘（组合现有后期）。 */
export function drawCRT(ctx, { W = 1920, H = 1080, t = 0, strength = 0.5 } = {}) {
  if (typeof document === 'undefined') return;
  drawScanlines(ctx, { W, H, step: 3, alpha: 0.10 });
  drawVignette(ctx, { W, H, strength: strength * 0.8 });
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(255,0,80,0.05)');
  g.addColorStop(0.5, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,200,255,0.05)');
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** 双色调：用 source  canvas 的亮度映射到 shadow→highlight 两色。 */
export function drawDuotone(ctx, source, { shadow = '#1a1a2e', highlight = '#ffcf5c', W = 1920, H = 1080, alpha = 1 } = {}) {
  if (typeof document === 'undefined' || !source) return;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.drawImage(source, 0, 0, W, H);
  const img = g.getImageData(0, 0, W, H);
  const s = hexRgb(shadow), h = hexRgb(highlight);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    d[i] = s[0] + (h[0] - s[0]) * l;
    d[i + 1] = s[1] + (h[1] - s[1]) * l;
    d[i + 2] = s[2] + (h[2] - s[2]) * l;
  }
  g.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalAlpha = clamp(alpha);
  ctx.drawImage(cv, 0, 0);
  ctx.restore();
}

function hexRgb(hex) {
  const m = String(hex).replace('#', '');
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}

/** 乱码解码文字（canvas）：用纯核 scrambleText 取当前字符串再画。 */
export function drawScrambleText(ctx, text, p, { x = 0, y = 0, font = '700 80px "JetBrains Mono", monospace', color = '#ffffff', seed = 1, t = 0, align = 'left' } = {}) {
  if (typeof document === 'undefined') return;
  const s = scrambleText(text, p, { seed, t });
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
  ctx.restore();
}

/* ───────────────────────────── 后期分发器 ───────────────────────────── */

const POST_DRAW = {
  grain: drawGrain,
  scanlines: drawScanlines,
  bloom: drawBloom,
  halation: drawHalation,
  vignette: drawVignette,
  halftone: drawHalftone,
  dotGrid: drawDotGrid,
  lightLeak: drawLightLeak,
  crt: drawCRT,
};

/**
 * 统一后期入口。name 必须是 post 类效果；source 类（bloom/halation/chromatic）
 * 需要传 source canvas。未知名字静默返回（页面可安全调用）。
 */
export function applyPost(ctx, name, t, opts = {}) {
  if (!isEffect(name) || EFFECTS[name].category !== 'post') return;
  if (name === 'chromatic') { if (opts.source) drawRGBSplit(ctx, opts.source, opts); return; }
  if (name === 'duotone') { if (opts.source) drawDuotone(ctx, opts.source, opts); return; }
  const fn = POST_DRAW[name];
  if (fn) fn(ctx, { t, ...opts });
}

/* ───────────────────────────── 确定性探针 ───────────────────────────── */

/**
 * 自检：对每个纯核在采样时刻求值两次，断言逐位一致；并验证关键值域。
 * Node 与浏览器都能跑（不碰 DOM）。返回 {ok, checks:[...]}。
 */
export function effectProbe() {
  const checks = [];
  const same = (name, a, b) => checks.push({ name, ok: JSON.stringify(a) === JSON.stringify(b) });
  const range = (name, ok) => checks.push({ name, ok: !!ok });

  same('typewriter 确定性', typewriterText('你好世界', 0.5), typewriterText('你好世界', 0.5));
  range('typewriter 半程', typewriterText('abcd', 0.5) === 'ab');
  same('scramble 确定性', scrambleText('DECODE', 0.4, { seed: 7, t: 1.2 }), scrambleText('DECODE', 0.4, { seed: 7, t: 1.2 }));
  range('scramble 全解码', scrambleText('ABC', 1, { seed: 1 }) === 'ABC');
  same('splitFlap 确定性', splitFlapProgress('abc', 0.5), splitFlapProgress('abc', 0.5));
  for (const kind of ['confetti', 'sparks', 'snow', 'bubbles', 'embers']) {
    const a = particleField(kind, 1.234, { seed: 9, count: 40 });
    const b = particleField(kind, 1.234, { seed: 9, count: 40 });
    same(`particle ${kind} 确定性`, a, b);
    range(`particle ${kind} 值域`, a.every((p) => p.alpha >= 0 && p.alpha <= 1 && p.r > 0 && Number.isFinite(p.x) && Number.isFinite(p.y)));
  }
  same('kenBurns 确定性', kenBurns(1.5), kenBurns(1.5));
  range('kenBurns 端点', Math.abs(kenBurns(0, { dur: 3 }).scale - 1) < 1e-9 && Math.abs(kenBurns(3, { dur: 3 }).scale - 1.12) < 1e-9);
  same('shake 确定性', cameraShake(0.3, { seed: 4 }), cameraShake(0.3, { seed: 4 }));
  range('shake 衰减', Math.abs(cameraShake(0, { amp: 14 }).x) <= 14 && Math.abs(cameraShake(5, { amp: 14 }).x) < 0.01);
  same('beatPulse 确定性', beatPulse(0.7, 120), beatPulse(0.7, 120));
  range('beatPulse 值域', beatPulse(0, 120) === 1 && beatPulse(0.49, 120) < 0.1);
  const bins = spectrumBins(0.8, { seed: 2, n: 24 });
  same('spectrum 确定性', bins, spectrumBins(0.8, { seed: 2, n: 24 }));
  range('spectrum 值域', bins.length === 24 && bins.every((v) => v >= 0 && v <= 1));
  range('vignette 中心亮边缘暗', vignetteFactor(0, 0, 0.6) === 1 && vignetteFactor(1, 1, 0.6) < 0.5);
  range('halftone 暗处大', halftoneRadius(0, 10) > halftoneRadius(1, 10));
  range('目录非空', EFFECT_IDS.length >= 24);
  range('目录分类齐全', EFFECT_CATEGORIES.every((c) => EFFECT_IDS.some((id) => EFFECTS[id].category === c)));

  return { ok: checks.every((c) => c.ok), checks };
}