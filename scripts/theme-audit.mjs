#!/usr/bin/env node
/**
 * theme-audit.mjs — 主题对比度审计
 * ---------------------------------------------------------------------------
 * 不启动浏览器，直接读 templates/themes.js，检查每套主题的角色 token 对比度：
 *   主字/底 ≥ 7     次要字/底 ≥ 4.5    纸面/暗卡同理
 *   强调底上的字 ≥ 4.5（大字卡 A 版式直接可读）
 *   强调/底 ≥ 3（大面积色块可被识别，不要求当正文）
 *
 * 用法：
 *   node scripts/theme-audit.mjs                 # 全部主题，表格输出
 *   node scripts/theme-audit.mjs aqua-morandi    # 只看一套
 *   node scripts/theme-audit.mjs --strict        # 有不合格项时 exit 1（CI / QA 用）
 */
import { THEME_LIST, getTheme, auditTheme, contrastRatio } from '../templates/themes.js';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const only = args.filter((a) => !a.startsWith('--'));

const themes = only.length ? only.map((id) => getTheme(id)) : THEME_LIST;
let failures = 0;

for (const theme of themes) {
  console.log(`\n■ ${theme.id}  ${theme.name} / ${theme.nameEn}  [${theme.mode}]  ${theme.material.kind}`);
  console.log(`  底色 ${theme.colors.bg}  强调 ${theme.colors.accent}  ${theme.tagline}`);
  for (const row of auditTheme(theme)) {
    const mark = row.pass ? 'PASS' : 'FAIL';
    if (!row.pass) failures++;
    console.log(`  [${mark}] ${row.label.padEnd(18, ' ')} ${row.pair.padEnd(22, ' ')} ${String(row.ratio).padStart(6)} : 1   (min ${row.min})`);
  }
  // HUD 胶囊：rgba 叠在底上取近似实色再算
  const capsule = theme.colors[theme.mode === 'dark' ? 'bg' : 'bg'];
  const numRatio = contrastRatio(theme.hud.capsuleNumber, theme.colors[theme.mode === 'dark' ? 'bg' : 'bg']);
  const textRatio = contrastRatio(theme.hud.capsuleText, theme.hud.capsuleNumber === theme.colors.accent ? theme.colors.cardDark : theme.colors.cardDark);
  const numVsCapsule = contrastRatio(theme.hud.capsuleNumber, mixHex(theme.hud.capsuleBg, capsule, 0.72));
  const textVsCapsule = contrastRatio(theme.hud.capsuleText, mixHex(theme.hud.capsuleBg, capsule, 0.72));
  const numPass = numVsCapsule >= 3;
  const textPass = textVsCapsule >= 4.5;
  if (!numPass || !textPass) failures++;
  console.log(`  [${numPass ? 'PASS' : 'FAIL'}] HUD 编号 vs 胶囊        ${numVsCapsule.toFixed(2)} : 1   (min 3)`);
  console.log(`  [${textPass ? 'PASS' : 'FAIL'}] HUD 文字 vs 胶囊        ${textVsCapsule.toFixed(2)} : 1   (min 4.5)`);
  console.log(`  点缀色 ${theme.accents.map((a) => `${a.name} ${a.hex}`).join(' · ')}`);
}

function mixHex(a, b, t) {
  // a 可能是 rgba()，先按底色调成实色
  const m = String(a).match(/rgba?\(([^)]+)\)/);
  if (!m) return a;
  const parts = m[1].split(',').map((x) => parseFloat(x));
  const [r, g, bl, al = 1] = parts;
  const hexB = b.replace('#', '');
  const br = parseInt(hexB.slice(0, 2), 16);
  const bg = parseInt(hexB.slice(2, 4), 16);
  const bb = parseInt(hexB.slice(4, 6), 16);
  const mixc = (x, y) => Math.round(x * al + y * (1 - al));
  const to = (v) => v.toString(16).padStart(2, '0');
  return `#${to(mixc(r, br))}${to(mixc(g, bg))}${to(mixc(bl, bb))}`;
}

console.log(`\n${failures === 0 ? '✓ 全部通过' : `✗ ${failures} 项不合格`}`);
if (strict && failures > 0) process.exit(1);
