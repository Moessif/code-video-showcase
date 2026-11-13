#!/usr/bin/env node
/**
 * test-all.mjs — 一个入口跑全套，并把结果收敛成机器可读报告。
 *
 *   node scripts/test-all.mjs                 # 人读：逐套输出 + 汇总表
 *   node scripts/test-all.mjs --json          # CI：stdout 只有一行 JSON
 *   node scripts/test-all.mjs --tap           # CI：TAP14
 *   node scripts/test-all.mjs --browser       # 加上真实 Chrome 套件
 *   node scripts/test-all.mjs --only brand,contract
 *
 * 为什么需要（v2.4 / P1-04）：v2.3.5 的 16 个测试脚本有四种汇总格式
 * （"N passed, M failed" / "N checks: ..." / "Ran N tests: ..." / "RESULT: PASS"），
 * CI 只能人肉 grep。这里统一解析成 {ok,total,passed,failed,suites[]}，
 * 退出码只看子进程真实 exit —— 不靠正则推断成败。
 *
 * 退出码：0 全部通过；1 任一失败；2 用法。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// 解析器单独成模块，便于直接单测（本文件有顶层执行副作用，import 就会跑全套）。
import { parseSummary } from './summary-parse.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const UNIT_SUITES = [
  'scripts/test-core.mjs',
  'scripts/test-nl2spec.mjs',
  'scripts/test-script.mjs',
  'scripts/test-assets.mjs',
  'scripts/test-variants.mjs',
  'scripts/test-reflow.mjs',
  'scripts/test-ref-core.mjs',
  'scripts/test-from-reference.mjs',
  'scripts/test-brand.mjs',
  'scripts/test-motion-profile.mjs',
  'scripts/test-style-pages.mjs',
  'scripts/test-spec-security.mjs',
  'scripts/test-accent-route.mjs',
  'scripts/test-compiler-contract.mjs',
  'scripts/test-versioning.mjs',
  'scripts/test-summary-parse.mjs',
  'scripts/test-transitions.mjs',
  'scripts/test-effects.mjs',
  'scripts/test-domains.mjs',
  'ingest/test-edl.mjs',
];

const BROWSER_SUITES = [
  'scripts/test-inspect.mjs',
  'scripts/test-wizard-ref.mjs',
  'scripts/test-reflow-pages.mjs',
  'scripts/still-cyber-pixel.mjs',
  'scripts/test-recipes.mjs',
  'scripts/test-style-pages-render.mjs',
  'scripts/test-effects-render.mjs',
  'scripts/test-image.mjs',
  'server/test-api.mjs',
  'scripts/test-brand-visual.mjs',
  'scripts/test-type-tokens.mjs',
  'scripts/test-renderer-recovery.mjs',
];

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) { a._.push(k); continue; }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) a[k.slice(2)] = true;
    else { a[k.slice(2)] = next; i++; }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: node scripts/test-all.mjs [options]
  --json            machine-readable one-line report
  --tap             TAP version 14 output
  --browser         include suites that need real Chrome / ffmpeg
  --only <a,b>      run only suites whose path contains one of the substrings
  --timeout <ms>    per-suite timeout (default 900000 browser / 300000 unit)`);
  process.exit(0);
}

const MODE = args.json ? 'json' : args.tap ? 'tap' : 'text';
const SUITES = [...UNIT_SUITES, ...(args.browser ? BROWSER_SUITES : [])];
const only = typeof args['only'] === 'string'
  ? String(args['only']).split(',').map((s) => s.trim()).filter(Boolean)
  : null;
const selected = only ? SUITES.filter((s) => only.some((k) => s.includes(k))) : SUITES;
if (!selected.length) {
  console.error(`[test-all] no suites matched --only ${only.join(',')}`);
  process.exit(2);
}

const timeout = Number(args.timeout) || (args.browser ? 900000 : 300000);

export { parseSummary };

const rows = [];
const startedAll = Date.now();
for (const suite of selected) {
  const file = path.join(ROOT, suite);
  if (!fs.existsSync(file)) {
    rows.push({ suite, ok: false, exit: null, passed: null, failed: null, total: null, durationMs: 0, summary: 'missing suite file', output: '' });
    continue;
  }
  if (MODE === 'text') console.log(`\n=== ${suite} ===`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [file], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    env: process.env,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (MODE === 'text') process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
  const parsed = parseSummary(out);
  const ok = r.status === 0;
  const summary = out.trim().split(/\r?\n/).filter((l) => /passed|failed|RESULT|tests?/i.test(l)).slice(-2).join(' | ');
  rows.push({
    suite,
    ok,
    exit: r.status,
    passed: parsed ? parsed.passed : null,
    failed: parsed ? (ok ? parsed.failed : Math.max(parsed.failed, 1)) : (ok ? 0 : null),
    total: parsed ? parsed.total : null,
    durationMs: Date.now() - t0,
    summary: summary || (ok ? 'ok' : `exit ${r.status}${r.signal ? ` signal ${r.signal}` : ''}`),
    output: r.error ? String(r.error.message || r.error) : '',
  });
}

const totals = rows.reduce((acc, r) => {
  acc.passed += Number(r.passed || 0);
  acc.failed += Number(r.failed || 0);
  return acc;
}, { passed: 0, failed: 0 });
const ok = rows.every((r) => r.ok);
const report = {
  ok,
  generatedBy: 'scripts/test-all.mjs',
  durationMs: Date.now() - startedAll,
  browser: !!args.browser,
  suites: rows.length,
  passed: totals.passed,
  failed: rows.every((r) => r.failed === null) ? (ok ? 0 : null) : totals.failed,
  results: rows.map(({ output, ...r }) => ({ ...r, ...(output ? { detail: output } : {}) })),
};

if (MODE === 'json') {
  process.stdout.write(JSON.stringify(report) + '\n');
} else if (MODE === 'tap') {
  console.log('TAP version 14');
  console.log(`1..${rows.length}`);
  rows.forEach((r, i) => {
    const name = r.suite.replace(/#/g, '');
    const counts = r.passed === null ? '' : ` passed=${r.passed} failed=${r.failed}`;
    console.log(`${r.ok ? 'ok' : 'not ok'} ${i + 1} - ${name}${counts} # exit=${r.exit}`);
    if (!r.ok) console.log(`  ---\n  suite: ${name}\n  exit: ${r.exit}\n  summary: ${r.summary.replace(/\r?\n/g, ' ')}\n  ...`);
  });
} else {
  console.log('\n── summary ───────────────────────────────────────────────');
  for (const r of rows) {
    const counts = r.passed === null ? '' : ` ${r.passed}/${r.total ?? r.passed} passed`;
    console.log(`${r.ok ? '✓' : '✗'} ${r.suite.padEnd(42)}${counts}  (${(r.durationMs / 1000).toFixed(1)}s)`);
  }
  console.log(`\n${ok ? 'PASS' : 'FAIL'} · ${rows.length} suites · ${report.passed} passed · ${report.failed ?? '?'} failed · ${(report.durationMs / 1000).toFixed(1)}s`);
}

process.exit(ok ? 0 : 1);
