/**
 * style-pages.mjs — 画风 id → 真实渲染页 的单一真值（v2.3.1）。
 *
 * 问题背景（v2.3 审计发现 F1）：
 *   `scripts/nl2spec.mjs` 与 `app/wizard/app.js` 都把用户的画风选择写进
 *   `style.recipe`，`templates/spec.mjs` 再把它拼成页面 URL 的 `?recipe=<id>`。
 *   但 `templates/segment.html` **从不读这个参数**——于是无论用户选赛博像素、
 *   水墨还是扁平插画，出片都是 segment.html 的占位骨架
 *   （"风格段标题 / 替换 drawScene() 开始做真正的画面"）。
 *
 *   也就是说：整个"选画风"功能在生成端是空的。
 *
 * 修法（本表就是修法）：
 *   1. 每个画风 id 必须映射到一个**真实存在**的渲染页；
 *   2. 没有专属页面的画风，映射到能表达该画风的通用页，而不是占位骨架；
 *   3. 生成端（nl2spec / wizard）按这张表填 `style.page`，
 *      `?recipe=` 只作为页内提示，不再是"页面由谁决定"的载体。
 *
 * 用法：
 *   import { STYLE_PAGES, stylePageFor, styleRecipeIdFor } from './style-pages.mjs';
 *   stylePageFor('cyber-pixel');   // → 'templates/cyber-pixel.html'
 *   stylePageFor('ink-wash');      // → 'templates/recipe-inkwash.html'
 *   stylePageFor('screencast');    // → 'templates/segment.html'（通用场景页）
 *
 * 纯数据 + 纯函数，零依赖，Node 与浏览器都能跑。
 */

/** 通用场景页（没有专属配方的画风走这里）。 */
export const GENERIC_PAGE = 'templates/segment.html';

/**
 * 画风 id → 页面。
 *
 * 页面必须真实存在（scripts/test-style-pages.mjs 会逐个检查）。
 * 新增配方页时在这里加一行即可——这是唯一需要改的地方。
 */
export const STYLE_PAGES = {
  'cyber-pixel': 'templates/cyber-pixel.html',
  'cyber-glitch': 'templates/recipe-glitch.html',
  'pixel-8bit': 'templates/recipe-8bit.html',
  'ink-wash': 'templates/recipe-inkwash.html',
  guofeng: 'templates/recipe-guofeng.html',
  'great-wall': 'templates/recipe-greatwall.html',
  whiteboard: 'templates/recipe-whiteboard.html',
  'three-d': 'templates/recipe-threed.html',
  'data-viz': 'templates/recipe-datarace.html',
  screencast: 'templates/recipe-screencast.html',
  flat: 'templates/recipe-flat.html',
  minimal: 'templates/recipe-minimal.html',
  vertical: 'templates/segment.html',
  // v2.5：新增画风（研究背书：guizang Swiss / Editorial / neo-brutalist /
  // vaporwave / blueprint / risograph）+ 收编此前未注册的 kinetic。
  kinetic: 'templates/recipe-kinetic.html',
  swiss: 'templates/recipe-swiss.html',
  editorial: 'templates/recipe-editorial.html',
  brutalist: 'templates/recipe-brutalist.html',
  vaporwave: 'templates/recipe-vaporwave.html',
  blueprint: 'templates/recipe-blueprint.html',
  risograph: 'templates/recipe-risograph.html',
};

/**
 * 画风 id → 页内 recipe 提示（可选）。
 * 只写进 `?recipe=`，供页面在页内显示风格名/选择分支；
 * **不再决定用哪个页面**（那是 STYLE_PAGES 的事）。
 */
export const STYLE_RECIPE_IDS = {
  'cyber-pixel': 'cyber-pixel',
  'cyber-glitch': 'cyber-glitch',
  'pixel-8bit': '8bit',
  'ink-wash': 'ink-wash',
  guofeng: 'guofeng',
  'great-wall': 'great-wall',
  whiteboard: 'whiteboard',
  'three-d': 'three-d',
  'data-viz': 'data-race',
  screencast: 'screencast',
  flat: 'flat',
  minimal: 'minimal',
  vertical: 'vertical',
  kinetic: 'kinetic',
  swiss: 'swiss',
  editorial: 'editorial',
  brutalist: 'brutalist',
  vaporwave: 'vaporwave',
  blueprint: 'blueprint',
  risograph: 'risograph',
};

/**
 * 画风 id → 页面。未知 id 回落到通用场景页（而不是占位骨架）。
 * @param {string} styleId
 * @returns {string}
 */
export function stylePageFor(styleId) {
  const key = String(styleId || '');
  return STYLE_PAGES[key] || GENERIC_PAGE;
}

/**
 * 画风 id → 页内 recipe 提示。未知 id 返回 null（页面用默认值）。
 * @param {string} styleId
 * @returns {string|null}
 */
export function styleRecipeIdFor(styleId) {
  const key = String(styleId || '');
  return STYLE_RECIPE_IDS[key] || null;
}

/**
 * 画风 id → 完整 URL 查询串（`recipe=` + 主题/动效由上层拼）。
 * @param {string} styleId
 * @returns {string}
 */
export function styleQueryFor(styleId) {
  const rid = styleRecipeIdFor(styleId);
  return rid ? `recipe=${encodeURIComponent(rid)}` : '';
}
