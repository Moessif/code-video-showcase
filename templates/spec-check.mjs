/**
 * spec-check.mjs — Node 侧深度校验（spec-lint 与 build 共用）。
 *
 * spec.mjs 的 validateSpec 是纯逻辑校验（可在浏览器跑）；
 * 这里补三件只有 Node 能做的事：
 *   1. 页面文件是否存在；
 *   2. 主题 id 是否真实存在（不是静默回退默认主题）；
 *   3. 主题 + accentOverride 的 APCA 对比度。
 *
 * 为什么要共用：v2.3.4 的 `cvs build` 根本不调 spec-lint，主题拼错也能出片。
 * 现在 build 在写 plan 之前调用 deepValidate()，与 lint 同一套判定。
 *
 * 用法：
 *   import { deepValidate } from '../templates/spec-check.mjs';
 *   const { spec, issues } = deepValidate(rawSpec, { root });
 */
import { normalizeSpec } from './spec.mjs';
import { buildPlanFromSpec } from './plan.mjs';
import { THEMES, THEME_LIST, accentOverride } from './themes.js';
import { auditApca } from './color.js';
import { brandFromSpec, checkBrand } from '../scripts/brand.mjs';

/** 主题 id 或别名是否存在。 */
export function themeExists(ref) {
  if (!ref) return false;
  const key = String(ref).trim().toLowerCase();
  if (THEMES[key]) return true;
  return THEME_LIST.some((t) => (t.aliases || []).some((a) => String(a).toLowerCase() === key));
}

/**
 * @param {object} raw 原始 spec
 * @param {{root?: string}} opts
 * @returns {{spec: object, issues: Array<{code:string,path:string,message:string,level:string}>}}
 */
export function deepValidate(raw, { root = process.cwd() } = {}) {
  const spec = normalizeSpec(raw);
  let issues = [];
  try {
    issues = buildPlanFromSpec(raw, { root }).issues.slice();
  } catch (e) {
    if (!e.issues) throw e;
    issues = e.issues.slice();
  }

  if (!themeExists(spec.look?.theme)) {
    issues.push({
      code: 'E_THEME_UNKNOWN',
      path: 'look.theme',
      message: `unknown theme "${spec.look?.theme}"; known: ${Object.keys(THEMES).join(', ')}`,
      level: 'error',
    });
  } else {
    const theme = accentOverride(spec.look.theme, spec.look.accentOverride);
    // auditApca 的 need 是「正文级」建议值；HUD/次要字与大字号强调块按实际用途放宽。
    const practical = { 'muted / bg': 30, 'accentInk / accent': 45, 'paperMuted / paper': 30, 'accent / bg': 30 };
    for (const row of auditApca(theme)) {
      const need = practical[row.pair] ?? row.need;
      if (row.lc < need) {
        issues.push({
          code: 'E_APCA',
          path: 'look.theme',
          message: `${row.pair} (${row.label}) APCA ${row.lc} < ${need}`,
          level: 'error',
        });
      }
    }
  }

  // 品牌合规（v2.4 / P1-03）：spec 里带 brandKit 时，build 与 lint 用同一把尺子。
  // 覆盖：广告法禁用词、logo 存在性/越界、品牌强调色对比度、品牌名同步。
  // 没有 brandKit 的 spec 不做任何品牌检查（不误伤未用品牌包的片子）。
  const brand = brandFromSpec(spec, { root });
  if (brand) {
    for (const issue of checkBrand(spec, brand, { root })) issues.push(issue);
  }

  // 去重（validateSpec + plan 的页面检查可能重叠）
  const seen = new Set();
  issues = issues.filter((i) => {
    const k = `${i.level}|${i.code}|${i.path}|${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { spec, issues };
}
