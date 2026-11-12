#!/usr/bin/env node
/**
 * audit-exports.mjs — 找出「导出了但生产代码从不引用」的模块符号。
 *
 *   node scripts/audit-exports.mjs
 *   node scripts/audit-exports.mjs --verbose
 *
 * 用途：仓库里有过「库写完了但没有任何页面调用」的情况（v2.3 之前
 * templates/motion.js 就是如此）。这个脚本把那种漂移变成可检测的。
 *
 * 判定规则：
 *   - 只统计**非测试**文件里的引用（测试引用不算生产使用）；
 *   - import / export-from 语句算引用；
 *   - 模块自身的 export 声明不算；
 *   - 一个符号只要在任何生产文件里出现过就算「被使用」。
 *
 * 退出码 0/1。零依赖。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'shared', '.github', 'dist']);

const VERBOSE = process.argv.includes('--verbose');

/** 收集仓库里所有可分析的源文件。 */
function collectFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectFiles(p, acc);
    else if (/\.(js|mjs|html)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** 测试文件不算生产消费者。 */
function isTestFile(rel) {
  const name = path.basename(rel);
  if (/^test[-_]/.test(name) || /[-_]test\.(mjs|js)$/.test(name)) return true;
  if (rel.replace(/\\/g, '/').includes('/test-edl')) return true;
  return false;
}

/** 抽取模块导出的符号名。 */
function exportedNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop().trim();
      if (n && n !== 'default') names.add(n);
    }
  }
  return names;
}

const files = collectFiles(ROOT);
const prodFiles = files.filter((f) => !isTestFile(path.relative(ROOT, f)));

const MODULES = [
  'templates/motion.js',
  'templates/motion-profile.mjs',
  'templates/color.js',
  'templates/themes.js',
  'templates/common.js',
  'templates/spec.mjs',
  'templates/plan.mjs',
  'templates/timeline.mjs',
  'templates/recipes/util.js',
  'scripts/ref-core.mjs',
  'scripts/nl2spec.mjs',
];

let totalDead = 0;
let totalSymbols = 0;

for (const mod of MODULES) {
  const abs = path.join(ROOT, mod);
  if (!fs.existsSync(abs)) continue;
  const src = fs.readFileSync(abs, 'utf8');
  const names = exportedNames(src);
  totalSymbols += names.size;

  const dead = [];
  const used = [];
  for (const name of names) {
    // \b 词边界：构造正则时只转义 $ 与其它正则元字符
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('\\b' + esc + '\\b');
    const sites = [];
    for (const f of prodFiles) {
      if (path.resolve(f) === path.resolve(abs)) continue;
      const text = fs.readFileSync(f, 'utf8');
      if (!re.test(text)) continue;
      const rel = path.relative(ROOT, f).replace(/\\/g, '/');
      for (const [i, line] of text.split('\n').entries()) {
        if (re.test(line)) sites.push(`${rel}:${i + 1}`);
      }
    }
    if (sites.length === 0) dead.push(name);
    else used.push({ name, sites });
  }

  totalDead += dead.length;
  if (dead.length) {
    console.log(`\n=== ${mod} — ${dead.length}/${names.size} 个导出符号没有生产消费者 ===`);
    for (const d of dead) console.log(`  · ${d}`);
    if (VERBOSE) {
      console.log('  (已使用：' + used.map((u) => u.name).join(', ') + ')');
    }
  } else if (VERBOSE) {
    console.log(`\n=== ${mod} — ${names.size} 个导出符号全部有生产消费者 ===`);
  }
}

console.log(`\n共检查 ${MODULES.length} 个模块 / ${totalSymbols} 个导出符号，${totalDead} 个没有生产消费者。`);
console.log(`（文件总数 ${files.length}，其中生产文件 ${prodFiles.length}；测试文件不计入消费者）`);
