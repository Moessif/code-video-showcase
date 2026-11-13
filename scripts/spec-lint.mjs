#!/usr/bin/env node
/**
 * spec-lint.mjs — spec 的 CI 闸门。
 *
 * 与 `cvs build` 共用 templates/spec-check.mjs 的深度校验：
 *   1. 结构/时长/页面存在性；
 *   2. 主题 id 是否真实存在（不是静默回退默认主题）；
 *   3. 主题 + accentOverride 的 APCA 对比度；
 *   4. 占位品牌 / 空标题（v2.3.5 起是 error：默认路径不能把 {{BRAND}} 印进成片）。
 *
 *   node scripts/spec-lint.mjs --spec project.spec.json
 *   node scripts/spec-lint.mjs --spec fixtures/mini-41s/spec.json --strict --json
 *
 * 退出码：0 通过；10 spec 错误；11 strict 下存在 warning；2 用法错误。
 * `--json` 在任何情况下都向 stdout 输出一行可解析 JSON（包括致命错误）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { deepValidate } from '../templates/spec-check.mjs';

const EXIT_SPEC = 10;
const EXIT_WARN = 11;

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) a[k.slice(2)] = true;
    else { a[k.slice(2)] = next; i++; }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.spec) {
  console.log(`Usage: node scripts/spec-lint.mjs --spec <project.spec.json> [options]
  --root <dir>    project root (default cwd)
  --strict        warnings are failures
  --json          machine-readable report (always parseable, even on fatal errors)
  --quiet         only summary`);
  process.exit(args.help ? 0 : 2);
}

const specPath = path.resolve(String(args.spec));
const root = path.resolve(String(args.root || process.cwd()));
const strict = !!args.strict;

function emitFatal(code, message) {
  const issue = { code, path: specPath, message, level: 'error' };
  if (args.json) {
    console.log(JSON.stringify({
      ok: false, spec: specPath, code, exitCode: EXIT_SPEC,
      errors: 1, warnings: 0, errorCodes: [code], issues: [issue],
    }, null, 2));
  } else {
    console.error(`[error] [${code}] ${specPath}: ${message}`);
  }
  process.exit(EXIT_SPEC);
}

let raw;
try {
  raw = JSON.parse(fs.readFileSync(specPath, 'utf8'));
} catch (e) {
  emitFatal(e instanceof SyntaxError ? 'E_JSON_PARSE' : 'E_READ', e.message);
}

let spec;
let issues = [];
try {
  ({ spec, issues } = deepValidate(raw, { root }));
} catch (e) {
  emitFatal(e.code || 'E_SPEC', e.message || String(e));
}

const errors = issues.filter((i) => i.level === 'error');
const warnings = issues.filter((i) => i.level === 'warn');
const exitCode = errors.length ? EXIT_SPEC : (strict && warnings.length ? EXIT_WARN : 0);

if (args.json) {
  console.log(JSON.stringify({
    ok: errors.length === 0,
    spec: specPath,
    root,
    code: errors.length ? errors[0].code : (strict && warnings.length ? 'WARN' : null),
    exitCode,
    summary: `${spec.meta.name} · ${spec.format.width}×${spec.format.height} · ${spec.format.duration}s · ${spec.rounds.length} rounds · ${spec.look.theme}`,
    errors: errors.length,
    warnings: warnings.length,
    errorCodes: [...new Set(errors.map((i) => i.code))],
    issues,
  }, null, 2));
} else {
  if (!args.quiet) {
    for (const i of issues) console.log(`[${i.level}] [${i.code}] ${i.path}: ${i.message}`);
  }
  console.log(`${errors.length ? '✗' : '✓'} ${spec.meta.name} · ${spec.format.width}×${spec.format.height} · ${spec.format.duration}s · ${spec.rounds.length} rounds · ${spec.look.theme} — ${errors.length} error(s), ${warnings.length} warning(s)`);
}

process.exit(exitCode);
