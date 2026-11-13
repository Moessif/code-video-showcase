/**
 * tokens.mjs — 排版 token（v2.4 / P1-06）。
 *
 * 一个片子里的 13 个配方页以前各写各的字阶和页边距：`H*0.09`、`H*0.13`、
 * `min(W*0.13,H*0.115)`……连起来看「像 11 个人拼的」。这里把两件事变成唯一真值：
 *
 *   1. 4 级字阶（按画布短边归一）：display / title / body / caption
 *   2. 单一安全区 safe(W,H)：左右相等，横竖屏同一套比例
 *
 * 页面只 import 这两个函数；具体字号仍可 fitTextSize 收缩，但**上限**来自 token。
 * 设计意图：允许为长标题降级，不允许每个页面自己定义「标题应该多大」。
 */

/** 字阶：相对画布短边（min(W,H)）的比例。 */
export const TYPE_SCALE = {
  display: 0.19,    // 封面级大字 / 主视觉数字
  title: 0.135,     // 页面主标题（13 个配方页共用）
  body: 0.034,      // 正文 / 副标题
  caption: 0.019,   // 注释 / HUD / 角标
};

/** 安全区：横竖屏用同一组比例；左右必须相等。 */
export const SAFE_RATIO = {
  x: 0.075,       // 左右页边距（与旧 safePad 0.075 对齐，升级不改版式）
  top: 0.06,
  bottom: 0.07,
};

const clampInt = (n, min, max) => Math.max(min, Math.min(max, Math.round(n)));

/**
 * 取某一级字号。按短边归一，竖屏不会因为画布变高而字变大。
 * @param {'display'|'title'|'body'|'caption'} role
 * @param {number} W
 * @param {number} H
 */
export function typeSize(role, W, H) {
  const key = Object.prototype.hasOwnProperty.call(TYPE_SCALE, role) ? role : 'body';
  const short = Math.max(1, Math.min(Number(W) || 1920, Number(H) || 1080));
  const min = key === 'caption' ? 12 : key === 'body' ? 14 : key === 'title' ? 32 : 40;
  const max = key === 'caption' ? 72 : key === 'body' ? 160 : key === 'title' ? 320 : 480;
  return clampInt(short * TYPE_SCALE[key], min, max);
}

/**
 * 单一安全区。返回数值像素；left === right（验收断言）。
 * @param {number} W
 * @param {number} H
 */
export function safe(W, H) {
  const w = Number(W) || 1920;
  const h = Number(H) || 1080;
  const x = clampInt(Math.min(w, h) * SAFE_RATIO.x, 18, 240);
  return {
    x,
    left: x,
    right: x,
    top: clampInt(h * SAFE_RATIO.top, 18, 320),
    bottom: clampInt(h * SAFE_RATIO.bottom, 18, 360),
  };
}

/** 页面自报的排版探针：测试用它比较「实际 title 像素高」。 */
export function probe(role, px, area) {
  const metrics = { role, titlePx: Math.round(px), safe: area || null, token: 'v1' };
  if (typeof window !== 'undefined') window.__typeProbe = metrics;
  return metrics;
}
