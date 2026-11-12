/**
 * motion-profile.mjs — 动效档位表与自动推导（v2.3）。
 *
 * 问题背景：仓库里 templates/motion.js 提供了完整的动效库（缓动、弹簧、
 * stagger、转场、CJK 排版、质感），但 v2.2 之前没有任何生产页面调用它——
 * 页面各自写死了一套缓动，动效库事实上处于"存在但未接线"的状态。
 *
 * v2.3 的做法不是让页面随便挑动效，而是引入**档位（profile）**：
 *   用户只声明一个档位名（calm / standard / dynamic / maximal），
 *   编译器把它展开成一组具体的、可序列化的动效参数，
 *   再由 URL 参数传给页面，页面按参数作画。
 *
 * 档位由「视频类型 kind × 画风 style」自动推导，用户可覆盖。
 *
 * 关键约束：
 *   1. 纯函数、零依赖、Node 与浏览器两侧都能跑（不 import fs）。
 *   2. 参数必须能完整序列化进 URL（短、可编码、无 NaN）。
 *   3. 档位只决定"动效风格"，不决定像素布局——所以同一个 spec 换档位
 *      必须改变画面（可被 golden 检测到），而不是改文案。
 *   4. 未显式指定档位时用 'standard'，且 standard 的参数与 v2.2 的
 *      既有行为**逐值相同**（见 D11），保证老项目零像素变化。
 *
 * 用法：
 *   import { MOTION_PROFILES, deriveMotionProfile, motionParams } from './motion-profile.mjs';
 *   const profile = deriveMotionProfile({ kind: 'promo', style: 'cyber-pixel' });
 *   const params = motionParams(profile);      // → { mp: 'dynamic', ... }
 */

export const MOTION_VERSION = 1;

/** 档位名（用户可写的全部取值）。 */
export const MOTION_LEVELS = ['calm', 'standard', 'dynamic', 'maximal'];

/**
 * 档位表。
 *
 * 字段含义：
 *   transition   入场转场类型 → templates/motion.js transitionParams()
 *   ease         主缓动函数名 → templates/motion.js ease / rateFunc()
 *   easeOut      次级（出场/回弹）缓动名
 *   spring       弹簧预设名 → templates/motion.js springs
 *   stagger      文字/元素逐个入场的总滞后比例（0..1）
 *   kineticMode  动态文字模式 → templates/motion.js drawKineticText()
 *   impact       段首冲击强度倍率（0 = 无冲击，1 = 原版，>1 更强）
 *   grain        胶片颗粒强度（0 = 无）
 *   scanlines    扫描线强度（0 = 无）
 *   texture      'none' | 'paper' | 'scan'
 *   shake        段首抖动倍率（0 = 无抖动）
 *   flash        段首白闪倍率（0 = 无白闪）
 *   push         段内缓推镜倍率（0 = 静止）
 *   blur         入场模糊像素上限
 *
 * standard 的数值 = v2.2 既有行为，切换它必须是零像素变化。
 */
export const MOTION_PROFILES = {
  calm: {
    label: '克制',
    description: '缓慢、几乎无冲击。适合发布会、知识科普、品牌故事。',
    transition: 'fade',
    ease: 'inOutCubic',
    easeOut: 'outCubic',
    spring: 'slow',
    stagger: 0.18,
    kineticMode: 'fade',
    impact: 0,
    grain: 0,
    scanlines: 0,
    texture: 'none',
    shake: 0,
    flash: 0,
    push: 0,
    blur: 6,
  },
  standard: {
    label: '标准',
    description: 'v2.2 既有行为：一次冲击、一次缓推、无质感层。',
    transition: 'slam',
    ease: 'outExpo',
    easeOut: 'outCubic',
    spring: 'default',
    stagger: 0.4,
    kineticMode: 'rise',
    impact: 1,
    grain: 0,
    scanlines: 0,
    texture: 'none',
    shake: 1,
    flash: 1,
    push: 1,
    blur: 16,
  },
  dynamic: {
    label: '动感',
    description: '明显冲击 + 逐字入场 + 轻胶片颗粒。适合宣传片、数据片。',
    transition: 'whip',
    ease: 'outBack',
    easeOut: 'outElastic',
    spring: 'wobbly',
    stagger: 0.55,
    kineticMode: 'rise',
    impact: 1.25,
    grain: 0.05,
    scanlines: 0,
    texture: 'none',
    shake: 1.25,
    flash: 1,
    push: 1.15,
    blur: 12,
  },
  maximal: {
    label: '极致',
    description: '强冲击 + 扫描线 + 颗粒 + 抖动过冲。适合赛博、故障、像素风。',
    transition: 'glitch',
    ease: 'outElastic',
    easeOut: 'outElastic',
    spring: 'wobbly',
    stagger: 0.72,
    kineticMode: 'scale',
    impact: 1.6,
    grain: 0.08,
    scanlines: 0.06,
    texture: 'scan',
    shake: 1.8,
    flash: 1.3,
    push: 1.35,
    blur: 16,
  },
};

/**
 * kind × style → 档位。
 *
 * 规则优先级：style 特例 > kind 默认。
 * style 特例只覆盖真正需要额外冲击的画风（赛博/故障/像素）。
 */
const STYLE_MOTION = {
  'cyber-pixel': 'maximal',
  'cyber-glitch': 'maximal',
  'pixel-8bit': 'dynamic',
  'ink-wash': 'calm',
  guofeng: 'calm',
  'great-wall': 'dynamic',
  whiteboard: 'calm',
  'three-d': 'dynamic',
  'data-viz': 'standard',
  screencast: 'standard',
  flat: 'standard',
  minimal: 'calm',
  vertical: 'dynamic',
};

const KIND_MOTION = {
  promo: 'dynamic',
  launch: 'calm',
  knowledge: 'standard',
  ecommerce: 'dynamic',
  'brand-story': 'calm',
  'data-report': 'standard',
  recruiting: 'standard',
  annual: 'calm',
};

/** 合法档位名；非法值返回 null（调用方决定是报错还是回退）。 */
export function isMotionLevel(v) {
  return typeof v === 'string' && MOTION_LEVELS.includes(v);
}

/**
 * 推导档位。
 * @param {{kind?:string, style?:string, level?:string|null}} input
 * @returns {string} 档位名（始终合法）
 */
export function deriveMotionProfile(input = {}) {
  const explicit = input.level ?? input.motion ?? null;
  if (isMotionLevel(explicit)) return explicit;
  const style = input.style ? String(input.style) : null;
  const kind = input.kind ? String(input.kind) : null;
  if (style && STYLE_MOTION[style]) return STYLE_MOTION[style];
  if (kind && KIND_MOTION[kind]) return KIND_MOTION[kind];
  return 'standard';
}

/**
 * 展开档位为具体参数。
 * @param {string} level
 * @param {{overrides?:object}} opts
 * @returns {{level:string, label:string, description:string, ...}} 参数副本
 */
export function motionParams(level, { overrides = {} } = {}) {
  const name = isMotionLevel(level) ? level : deriveMotionProfile({ level });
  const base = MOTION_PROFILES[name];
  const merged = { ...base, ...(overrides || {}) };
  // 数值必须全部有限，否则 URL 编码会产生 NaN。
  for (const [k, v] of Object.entries(merged)) {
    if (typeof v === 'number' && !Number.isFinite(v)) merged[k] = base[k];
  }
  return { level: name, label: base.label, description: base.description, ...merged };
}

/**
 * 档位 → URL 查询参数。
 *
 * 只带 `mp`（档位名），页面拿到档位名后自己展开——这样档位表改了，
 * 旧 URL 也会按新表解释，不会两套参数各说各话。
 */
export function motionQuery(level) {
  const name = isMotionLevel(level) ? level : deriveMotionProfile({ level });
  return { mp: name };
}

/**
 * 从 URL 查询串解析档位（页面侧用；浏览器与 Node 都能跑）。
 * @param {string|URLSearchParams} search
 * @returns {string} 档位名，非法/缺失时回退 'standard'
 */
export function motionLevelFromQuery(search) {
  let raw = '';
  if (typeof search === 'string') {
    try { raw = new URLSearchParams(search).get('mp') || ''; } catch { raw = ''; }
  } else if (search && typeof search.get === 'function') {
    raw = search.get('mp') || '';
  }
  return isMotionLevel(raw) ? raw : 'standard';
}

/** 人类可读的一行摘要（CLI / UI 用）。 */
export function motionSummary(level) {
  const p = motionParams(level);
  return `${p.label}（${p.level}）· 转场 ${p.transition} · 冲击 ${p.impact}× · 颗粒 ${p.grain}`;
}
