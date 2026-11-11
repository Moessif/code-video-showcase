#!/usr/bin/env node
/**
 * test-from-reference.mjs — 参考图提取器的回归测试。
 * 用仓库自带的主题预览板做真图测试（需要 ffmpeg）。零 npm 依赖。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeSpec, validateSpec } from '../templates/spec.mjs';
import { THEME_IDS } from '../templates/themes.js';

const ROOT = path.resolve('.');
const CLI = path.join(ROOT, 'scripts', 'from-reference.mjs');
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}${detail ? `  (${detail})` : ''}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail ? `  (${detail})` : ''}`); }
};

function analyze(file) {
  const out = execFileSync(process.execPath, [CLI, '--img', path.join(ROOT, file)], { encoding: 'utf8' });
  return JSON.parse(out);
}

const cases = [
  ['assets/theme-previews/09-cyber-neon.jpg', 'cyber-neon', 'first'],
  ['assets/theme-previews/02-claude-light.jpg', 'claude-light', 'first'],
  ['assets/theme-previews/07-celadon-paper.jpg', 'celadon-paper', 'first'],
  ['assets/theme-previews/01-coral-noir.jpg', 'coral-noir', 'top3'],
  ['assets/theme-previews/04-amber-noir.jpg', 'amber-noir', 'top3'],
];

const results = {};
for (const [file, expect, mode] of cases) {
  const r = analyze(file);
  results[file] = r;
  const ids = r.theme.candidates.map((c) => c.id);
  ok(`${file}: theme id valid`, THEME_IDS.includes(r.theme.id), r.theme.id);
  ok(`${file}: palette >= 4`, r.palette.length >= 4, `${r.palette.length} colours`);
  ok(`${file}: APCA >= 45`, r.metrics.apca >= 45, `Lc ${r.metrics.apca}`);
  ok(`${file}: candidates = 3`, r.theme.candidates.length === 3, ids.join(','));
  if (mode === 'first') ok(`${file}: top-1 = ${expect}`, ids[0] === expect, ids[0]);
  else ok(`${file}: ${expect} in top-3`, ids.includes(expect), ids.join(','));
}

// 确定性：同一张图两次输出逐字节一致
const a = execFileSync(process.execPath, [CLI, '--img', 'assets/theme-previews/01-coral-noir.jpg'], { encoding: 'utf8' });
const b = execFileSync(process.execPath, [CLI, '--img', 'assets/theme-previews/01-coral-noir.jpg'], { encoding: 'utf8' });
ok('deterministic: same image -> identical JSON', a === b);

// spec 合并：look.theme / accentOverride 被写入并通过校验
const tmp = path.join(ROOT, 'out', 'from-reference-merge.spec.json');
fs.mkdirSync(path.dirname(tmp), { recursive: true });
execFileSync(process.execPath, [CLI, '--img', 'assets/theme-previews/09-cyber-neon.jpg',
  '--spec', 'fixtures/mini-41s/spec.json', '--out', tmp], { encoding: 'utf8' });
const merged = JSON.parse(fs.readFileSync(tmp, 'utf8'));
ok('spec merge: theme written', merged.look.theme === 'cyber-neon', merged.look.theme);
ok('spec merge: accentOverride written', !!merged.look.accentOverride, JSON.stringify(merged.look.accentOverride));
const issues = validateSpec(normalizeSpec(merged)).filter((i) => i.level === 'error');
ok('spec merge: validates clean', issues.length === 0, issues.map((i) => i.code).join(','));

console.log(`\n${failures.length ? '✗' : '✓'} from-reference — ${pass} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
