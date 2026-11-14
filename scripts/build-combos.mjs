#!/usr/bin/env node
/**
 * build-combos.mjs — 扩展 content/combos.json 的 theme×style 推荐矩阵（v2.5）。
 *
 * 背景：wizard 的画风选项在运行时以 combos.json 的列为准（app/wizard/app.js
 * `comboStyleIds`）。v2.5 把风格扩到 20，但 combos 还停在 12 列——新风格在
 * wizard 里根本选不到。本脚本把缺失的风格列补齐。
 *
 * 原则（幂等、不破坏既有策展）：
 *   - 已存在的 theme×style 判定**原样保留**（原 12 列是人工策展过的）；
 *   - 只为缺失的风格列按「族规则」计算基准判定；
 *   - presets.json 里每一组 theme×style 强制 recommended（规则 5）；
 *   - 更新 _meta.styleNames / counts / coverage，断言所有 preset 均 recommended。
 *
 * 族规则（与 _meta.rules 一致）：
 *   neon  → dark=recommended, light=avoid
 *   paper → light=recommended, dark=ok
 *   tech  → dark=recommended, light=ok
 *   neutral → 两边 ok
 *
 *   node scripts/build-combos.mjs          # 就地扩展
 *   node scripts/build-combos.mjs --check  # 只校验（缺列/preset 非 recommended 即退出 1）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEME_IDS, THEME_LIST, getTheme } from '../templates/themes.js';
import { STYLE_IDS } from './nl2spec.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
// --file <path> 覆盖目标文件（便于幂等/漂移测试用临时副本，不动真实策展文件）。
const fileArgIdx = process.argv.indexOf('--file');
const COMBOS = fileArgIdx >= 0 && process.argv[fileArgIdx + 1]
  ? path.resolve(process.argv[fileArgIdx + 1])
  : path.join(ROOT, 'content/combos.json');
const PRESETS = path.join(ROOT, 'content/presets.json');

// v2.5 新增风格的族归属（原 12 风格的判定保留在文件里，不在此重算）。
const NEW_STYLE_FAMILY = {
  'great-wall': 'tech',
  kinetic: 'neutral',
  swiss: 'paper',
  editorial: 'paper',
  brutalist: 'neutral',
  vaporwave: 'neon',
  blueprint: 'tech',
  risograph: 'paper',
};
const STYLE_LABEL = {
  'great-wall': '长城', kinetic: '动态字体', swiss: '瑞士网格', editorial: '报纸编辑',
  brutalist: '新粗野主义', vaporwave: '蒸汽波', blueprint: '工程蓝图', risograph: '孔版印刷',
};

function baseVerdict(family, mode) {
  if (family === 'neon') return mode === 'dark' ? 'recommended' : 'avoid';
  if (family === 'paper') return mode === 'light' ? 'recommended' : 'ok';
  if (family === 'tech') return mode === 'dark' ? 'recommended' : 'ok';
  return 'ok'; // neutral
}

const doc = JSON.parse(fs.readFileSync(COMBOS, 'utf8'));
const presets = JSON.parse(fs.readFileSync(PRESETS, 'utf8')).presets || [];
const combos = doc.combos || (doc.combos = {});
const modeOf = (id) => getTheme(id).mode;
// 全部 20 个风格的族归属：v2.5 新增 8 个来自 NEW_STYLE_FAMILY，原 12 个来自
// combos._meta.families.styleFamily（矩阵自己就是单一真值，不在此手写第二份）。
// 新增主题行需要这条完整映射，否则只有 8 个新风格能补、原 12 列会被判为「无族」。
const ALL_STYLE_FAMILY = {
  ...(doc._meta?.families?.styleFamily || {}),
  ...NEW_STYLE_FAMILY,
};
const familyOf = (style) => ALL_STYLE_FAMILY[style] || null;
const countMatrix = () => {
  const c = { recommended: 0, ok: 0, avoid: 0 };
  for (const t of THEME_IDS) for (const s of STYLE_IDS) c[combos[t]?.[s] || 'ok']++;
  return c;
};

// ── 漂移检测（只读）── --check 必须在任何修补之前判：旧版先补缺列/改 preset 再查，
// 于是「列被删、preset 被降级」都会被就地修好，--check 永远绿，门禁形同虚设。
const missingCols = [];
for (const theme of THEME_IDS) for (const style of STYLE_IDS) {
  if (!combos[theme]?.[style]) missingCols.push(`${theme}×${style}`);
}
const presetBad = presets.filter((p) => combos[p.theme]?.[p.style] !== 'recommended').map((p) => p.id);

if (CHECK) {
  if (missingCols.length || presetBad.length) {
    console.error('[combos --check] FAIL');
    if (missingCols.length) console.error('  missing columns: ' + missingCols.join(', '));
    if (presetBad.length) console.error('  presets not recommended: ' + presetBad.join(', '));
    process.exit(1);
  }
  console.log(`[combos --check] OK · ${THEME_IDS.length}×${STYLE_IDS.length} · ${JSON.stringify(countMatrix())} · ${presets.length} presets recommended`);
  process.exit(0);
}

// ── 写入模式：补缺列 + 修 preset + 同步 _meta ──
let added = 0;
const missing = [];
for (const theme of THEME_IDS) {
  const row = combos[theme] || (combos[theme] = {});
  for (const style of STYLE_IDS) {
    if (row[style]) continue; // 保留既有策展判定
    const family = familyOf(style);
    if (!family) { missing.push(`${theme}×${style}`); continue; }
    row[style] = baseVerdict(family, modeOf(theme));
    added++;
  }
}

// 规则 5：每组 preset 的 theme×style 必须 recommended。
const presetFix = [];
for (const p of presets) {
  const row = combos[p.theme] || (combos[p.theme] = {});
  if (row[p.style] !== 'recommended') { presetFix.push(`${p.theme}×${p.style} (${row[p.style] || '∅'}→recommended)`); row[p.style] = 'recommended'; }
}

// _meta 同步（含 families.styleFamily 与 description，避免文档与矩阵漂移）。
const meta = doc._meta || (doc._meta = {});
meta.styleNames = { ...(meta.styleNames || {}), ...STYLE_LABEL };
meta.families = meta.families || {};
meta.families.styleFamily = { ...(meta.families.styleFamily || {}), ...NEW_STYLE_FAMILY };
// 主题 id / 明暗 / 中文名全部从 themes.js 派生，杜绝手写第二份真值随新增皮肤漂移。
meta.families.themeMode = Object.fromEntries(THEME_LIST.map((t) => [t.id, t.mode]));
meta.themeNames = Object.fromEntries(THEME_LIST.map((t) => [t.id, t.name]));
meta.sourceOfTruth = 'themes ids + mode + names come from templates/themes.js; style ids are the 20 style vocabulary (v2.5).';
meta.description = `${THEME_IDS.length} themes × ${STYLE_IDS.length} styles 兼容矩阵。recommended/ok/avoid 三档；preset 组合必须 recommended。`;
meta.coverage = `${THEME_IDS.length}×${STYLE_IDS.length}=${THEME_IDS.length * STYLE_IDS.length}`;
const counts = countMatrix();
meta.counts = counts;

// 写入前断言：仍有无法补的缺列（无族归属）则拒绝写。
const errors = [];
if (missing.length) errors.push(`missing style columns (no family): ${missing.join(', ')}`);
if (errors.length) { console.error('[combos] refusing to write:\n  ' + errors.join('\n  ')); process.exit(1); }

const hadNL = fs.readFileSync(COMBOS, 'utf8').endsWith('\n');
fs.writeFileSync(COMBOS, JSON.stringify(doc, null, 2) + (hadNL ? '\n' : ''));
console.log(`[combos] +${added} cells · preset fixes: ${presetFix.length ? presetFix.join('; ') : 'none'} · ${meta.coverage} · ${JSON.stringify(counts)}`);