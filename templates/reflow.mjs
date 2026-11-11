/**
 * reflow.mjs — C4-05 多平台重排：同一份 spec 在 16:9 / 9:16 / 1:1 之间重排。
 *
 * 设计原则：
 *   1. 重排（reflow）不是裁切（crop）。structure / rounds 数量 / 时间网格不变，
 *      只改画布尺寸、卡片布局映射与页面可读取的排版参数。
 *   2. 纯函数、零依赖，可在浏览器页面与 Node 两侧 import（不触碰 fs）。
 *   3. 不修改传入的 spec；每次返回深拷贝。
 *
 * 页面读取方式（Canvas 侧）：
 *   import { reflowParams } from './reflow.mjs';
 *   const p = reflowParams('9:16');   // { scale, safe, fontScale, maxLines, stack, ... }
 *
 *   node -e "import('./templates/reflow.mjs').then(m => console.log(m.reflowParams('9:16')))"
 */

/** 支持的画幅（与 schema 的 format.aspect 枚举一致）。 */
export const SUPPORTED_ASPECTS = ['16:9', '9:16', '1:1'];

/** 每个画幅的标准输出尺寸（偶数，yuv420p 安全）。 */
export const ASPECT_SIZES = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

/**
 * 排版参数：
 *   scale     — 内容整体缩放（相对 16:9 原生字号/间距）
 *   safe      — [水平, 垂直] 安全边距（逻辑像素），文字与关键元素不得越界
 *   fontScale — 字号系数（相对 16:9 原生字号）
 *   maxLines  — 单块文案最大行数（超过时应缩字号或截断，由页面执行）
 *   stack     — 卡片元素是否改为纵向堆叠
 */
const PARAMS = {
  '16:9': { scale: 1, safe: [96, 64], fontScale: 1, maxLines: 2, stack: false },
  '9:16': { scale: 0.72, safe: [80, 120], fontScale: 0.82, maxLines: 3, stack: true },
  '1:1': { scale: 0.86, safe: [64, 96], fontScale: 0.9, maxLines: 2, stack: true },
};

/**
 * 卡片布局重映射：0 强调底 / 1 纸底 / 2 暗底居中 / 3 暗底左对齐。
 * 竖屏下左对齐会贴边，映射到居中暗底；方图与横屏保持原布局。
 */
const LAYOUT_REMAP = {
  '16:9': { 0: 0, 1: 1, 2: 2, 3: 3 },
  '9:16': { 0: 0, 1: 1, 2: 2, 3: 2 },
  '1:1': { 0: 0, 1: 1, 2: 2, 3: 3 },
};

function normalizeAspect(aspect) {
  if (typeof aspect !== 'string') return null;
  const s = aspect.trim();
  return SUPPORTED_ASPECTS.includes(s) ? s : null;
}

function aspectFromSize(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0)) return null;
  if (Math.abs(w / h - 16 / 9) < 0.01) return '16:9';
  if (Math.abs(w / h - 9 / 16) < 0.01) return '9:16';
  if (Math.abs(w / h - 1) < 0.01) return '1:1';
  return null;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * 返回某画幅的排版参数。未知画幅抛错（入口层应先用 schema 枚举约束）。
 * @param {'16:9'|'9:16'|'1:1'} aspect
 */
export function reflowParams(aspect) {
  const key = normalizeAspect(aspect);
  if (!key) {
    throw new Error(`unsupported aspect "${aspect}"; expected one of ${SUPPORTED_ASPECTS.join(', ')}`);
  }
  const size = ASPECT_SIZES[key];
  const p = PARAMS[key];
  return {
    aspect: key,
    width: size.width,
    height: size.height,
    scale: p.scale,
    safe: [...p.safe],
    fontScale: p.fontScale,
    maxLines: p.maxLines,
    stack: p.stack,
  };
}

/**
 * spec 级重排：16:9 → 9:16 / 1:1（也支持反向与方图互转）。
 *
 * 规则：
 *   - format.width/height/aspect 改为目标画幅标准尺寸；
 *   - structure 原样保留（时长公式不变）；
 *   - rounds 数量与顺序不变；
 *   - rounds[].card.layout 按目标画幅安全区重映射（变更时记录 layoutFrom）；
 *   - rounds[].style.reflow = { scale, safe, stack }（页面可读取）；
 *   - meta.reflowFrom 记录最初来源画幅（重复重排不覆盖）；
 *   - 目标画幅与当前画幅、尺寸都一致时是 no-op（返回深拷贝）。
 *
 * @param {object} spec 归一化或原始 spec v1
 * @param {'16:9'|'9:16'|'1:1'} targetAspect
 * @returns {object} 新 spec，不修改入参
 */
export function reflowSpec(spec, targetAspect) {
  const aspect = normalizeAspect(targetAspect);
  if (!aspect) {
    throw new Error(`unsupported aspect "${targetAspect}"; expected one of ${SUPPORTED_ASPECTS.join(', ')}`);
  }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('reflowSpec(spec, aspect): spec must be an object');
  }

  const srcFormat = spec.format || {};
  const srcAspect = normalizeAspect(srcFormat.aspect) || aspectFromSize(srcFormat.width, srcFormat.height);
  const size = ASPECT_SIZES[aspect];
  const canonicalSrc = srcAspect ? ASPECT_SIZES[srcAspect] : null;
  const same =
    srcAspect === aspect &&
    canonicalSrc &&
    Number(srcFormat.width) === canonicalSrc.width &&
    Number(srcFormat.height) === canonicalSrc.height;

  const out = clone(spec);
  if (same) return out;

  const params = reflowParams(aspect);
  out.format = { ...(out.format || {}), width: size.width, height: size.height, aspect };

  const map = LAYOUT_REMAP[aspect];
  out.rounds = (Array.isArray(out.rounds) ? out.rounds : []).map((round) => {
    const card = { ...(round.card || {}) };
    const from = Number.isInteger(card.layout) ? card.layout : null;
    if (from !== null) {
      const to = Number.isInteger(map[from]) ? map[from] : from;
      card.layout = to;
      if (to !== from) card.layoutFrom = from;
    }
    const style = {
      ...(round.style || {}),
      reflow: { scale: params.scale, safe: [...params.safe], stack: params.stack },
    };
    return { ...round, card, style };
  });

  out.meta = { ...(out.meta || {}) };
  const prior = spec.meta && spec.meta.reflowFrom;
  const priorAspect = normalizeAspect(prior && prior.aspect);
  out.meta.reflowFrom =
    prior && Number.isFinite(Number(prior.width)) && Number.isFinite(Number(prior.height)) && priorAspect
      ? { width: Number(prior.width), height: Number(prior.height), aspect: priorAspect }
      : {
          width: Number.isFinite(Number(srcFormat.width)) ? Number(srcFormat.width) : null,
          height: Number.isFinite(Number(srcFormat.height)) ? Number(srcFormat.height) : null,
          aspect: srcAspect || null,
        };

  return out;
}
