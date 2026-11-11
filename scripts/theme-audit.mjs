#!/usr/bin/env node
/**
 * theme-audit.mjs v2 — WCAG 2 + APCA audit for every theme.
 *
 *   node scripts/theme-audit.mjs
 *   node scripts/theme-audit.mjs aqua-morandi cyber-neon
 *   node scripts/theme-audit.mjs --strict          # CI gate (WCAG failures exit 1)
 *   node scripts/theme-audit.mjs --json qa/themes.json
 *
 * APCA (Lc) is reported alongside WCAG because dark backgrounds and thin CJK
 * strokes are where the WCAG 2 ratio flatters a design. Guidance: body ≥ 60,
 * small text ≥ 75, large display ≥ 45.
 */
import fs from 'node:fs';
import path from 'node:path';
import { THEME_LIST, getTheme, auditTheme, contrastRatio } from '../templates/themes.js';
import { auditApca } from '../templates/color.js';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const jsonIdx = args.indexOf('--json');
const jsonPath = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
const only = args.filter((a, i) => !a.startsWith('--') && (jsonIdx < 0 || i !== jsonIdx + 1));

const themes = only.length ? only.map((id) => getTheme(id)) : THEME_LIST;
let failures = 0, apcaWarnings = 0;
const report = { generatedAt: new Date().toISOString(), themes: [] };

for (const theme of themes) {
  console.log(`\n■ ${theme.id}  ${theme.name} / ${theme.nameEn}  [${theme.mode}]  ${theme.material.kind}`);
  console.log(`  底色 ${theme.colors.bg}  强调 ${theme.colors.accent}  ${theme.tagline}`);
  const wcag = auditTheme(theme);
  const apca = auditApca(theme);
  const entry = { id: theme.id, name: theme.name, mode: theme.mode, wcag: [], apca: [] };
  for (const row of wcag) {
    const mark = row.pass ? 'PASS' : 'FAIL';
    if (!row.pass) failures++;
    entry.wcag.push(row);
    console.log(`  [${mark}] ${row.label.padEnd(18, ' ')} ${row.pair.padEnd(22, ' ')} ${String(row.ratio).padStart(6)} : 1   (min ${row.min})`);
  }
  for (const row of apca) {
    const mark = row.pass ? 'PASS' : 'WARN';
    if (!row.pass) apcaWarnings++;
    entry.apca.push(row);
    console.log(`  [${mark}] APCA ${row.label.padEnd(16, ' ')} ${row.pair.padEnd(22, ' ')} ${String(row.lc).padStart(6)} Lc  (min ${row.need})`);
  }
  // HUD capsule: composite the rgba capsule over the theme background.
  const capsule = composite(theme.hud.capsuleBg, theme.colors.bg);
  const numRatio = contrastRatio(theme.hud.capsuleNumber, capsule);
  const textRatio = contrastRatio(theme.hud.capsuleText, capsule);
  const numPass = numRatio >= 3, textPass = textRatio >= 4.5;
  if (!numPass || !textPass) failures++;
  console.log(`  [${numPass ? 'PASS' : 'FAIL'}] HUD 编号 / 胶囊        ${numRatio.toFixed(2)} : 1   (min 3)`);
  console.log(`  [${textPass ? 'PASS' : 'FAIL'}] HUD 文字 / 胶囊        ${textRatio.toFixed(2)} : 1   (min 4.5)`);
  entry.hud = { numberRatio: +numRatio.toFixed(2), textRatio: +textRatio.toFixed(2), pass: numPass && textPass };
  console.log(`  点缀色 ${theme.accents.map((a) => `${a.name} ${a.hex}`).join(' · ')}`);
  report.themes.push(entry);
}

function composite(fg, bg) {
  const m = String(fg).match(/rgba?\(([^)]+)\)/);
  if (!m) return fg;
  const [r, g, b, a = 1] = m[1].split(',').map(Number);
  const h = String(bg).replace('#', '');
  const br = parseInt(h.slice(0, 2), 16), bgc = parseInt(h.slice(2, 4), 16), bb = parseInt(h.slice(4, 6), 16);
  const to = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${to(r * a + br * (1 - a))}${to(g * a + bgc * (1 - a))}${to(b * a + bb * (1 - a))}`;
}

report.summary = { themes: themes.length, wcagFailures: failures, apcaWarnings };
if (jsonPath) {
  fs.mkdirSync(path.dirname(path.resolve(jsonPath)), { recursive: true });
  fs.writeFileSync(path.resolve(jsonPath), JSON.stringify(report, null, 2));
  console.log(`\n[report] ${path.resolve(jsonPath)}`);
}
console.log(`\n${failures === 0 ? '✓ WCAG 全部通过' : `✗ ${failures} 项 WCAG 不合格`}${apcaWarnings ? `  ·  ${apcaWarnings} 项 APCA 提醒` : ''}`);
if (strict && failures > 0) process.exit(1);
