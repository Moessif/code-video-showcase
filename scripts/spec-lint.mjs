#!/usr/bin/env node
/**
 * spec-lint.mjs — spec 的 CI 闸门。
 *
 * 在 spec.mjs 的纯逻辑校验之上补三类只有 Node 侧能做的事：
 *   1. 页面文件是否存在（opening/card/style/more/flash/ending）；
 *   2. 主题 id 是否真实存在（不是静默回退默认主题）；
 *   3. 主题 + accentOverride 的 APCA 对比度是否达标。
 *
 *   node scripts/spec-lint.mjs --spec project.spec.json
 *   node scripts/spec-lint.mjs --spec fixtures/mini-41s/spec.json --strict --json
 *
 * 退出码：有 error → 1；--strict 时 warn 也 → 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildPlanFromSpec } from '../templates/plan.mjs';
import { normalizeSpec, validateSpec } from '../templates/spec.mjs';
import { THEMES, THEME_LIST, getTheme, accentOverride } from '../templates/themes.js';
import { auditApca } from '../templates/color.js';

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
  --root <dir>    project root (default spec dir)
  --strict        warnings are failures
  --json          machine-readable report
  --quiet         only summary`);
  process.exit(args.help ? 0 : 1);
}

const specPath = path.resolve(String(args.spec));
const root = path.resolve(String(args.root || path.dirname(specPath)));
const strict = !!args.strict;

function themeExists(ref) {
  if (!ref) return false;
  const key = String(ref).trim().toLowerCase();
  if (THEMES[key]) return true;
  return THEME_LIST.some((t) => (t.aliases || []).some((a) => String(a).toLowerCase() === key));
}

let raw;
try {
  raw = JSON.parse(fs.readFileSync(specPath, 'utf8'));
} catch (e) {
  console.error(`[error] [E_JSON] ${specPath}: ${e.message}`);
  process.exit(1);
}

let spec;
let issues = [];
try {
  spec = normalizeSpec(raw);
  issues = validateSpec(spec);

  // 页面存在性：复用 plan.mjs 的检查（它同时会做结构校验）
  try {
    const built = buildPlanFromSpec(raw, { root });
    issues = issues.concat(built.issues);
  } catch (e) {
    if (e.issues) issues = e.issues;
    else throw e;
  }

  if (!themeExists(spec.look.theme)) {
    issues.push({
      code: 'E_THEME_UNKNOWN',
      path: 'look.theme',
      message: `unknown theme "${spec.look.theme}"; known: ${Object.keys(THEMES).join(', ')}`,
      level: 'error',
    });
  } else {
    const theme = accentOverride(spec.look.theme, spec.look.accentOverride);
    // auditApca 的 need 是“正文级”建议值；HUD/次要字与大字号强调块按实际用途放宽。
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
} catch (e) {
  console.error(`[error] [E_SPEC] ${e.message}`);
  process.exit(1);
}

// 去重（validateSpec + plan 的页面检查可能重叠）
const seen = new Set();
issues = issues.filter((i) => {
  const k = `${i.level}|${i.code}|${i.path}|${i.message}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

const errors = issues.filter((i) => i.level === 'error');
const warnings = issues.filter((i) => i.level === 'warn');

if (args.json) {
  console.log(JSON.stringify({
    spec: specPath,
    summary: `${spec.meta.name} · ${spec.format.width}×${spec.format.height} · ${spec.format.duration}s · ${spec.rounds.length} rounds · ${spec.look.theme}`,
    errors: errors.length,
    warnings: warnings.length,
    issues,
  }, null, 2));
} else {
  if (!args.quiet) {
    for (const i of issues) console.log(`[${i.level}] [${i.code}] ${i.path}: ${i.message}`);
  }
  console.log(`${errors.length ? '✗' : '✓'} ${spec.meta.name} · ${spec.format.width}×${spec.format.height} · ${spec.format.duration}s · ${spec.rounds.length} rounds · ${spec.look.theme} — ${errors.length} error(s), ${warnings.length} warning(s)`);
}

if (errors.length || (strict && warnings.length)) process.exit(1);
