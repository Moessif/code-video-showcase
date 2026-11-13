#!/usr/bin/env node
/**
 * errors.mjs — 错误码注册表检查 + 文档生成。
 *
 *   node scripts/errors.mjs                 # report coverage
 *   node scripts/errors.mjs --check         # exit 1 if a code is emitted but not registered
 *   node scripts/errors.mjs --json          # machine-readable
 *   node scripts/errors.mjs --write         # regenerate docs/ERRORS.md
 *
 * 为什么需要：以前 90–116 个 E_* 码散在代码里，同一个码在不同阶段含义不同，
 * SKILL.md 只解释了 2 个。CI 只能拿到 exit 1，重试策略无从下手。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const REGISTRY = path.join(ROOT, 'schema', 'errors.json');
const DOC = path.join(ROOT, 'docs', 'ERRORS.md');
const SCAN_DIRS = ['scripts', 'templates', 'bin', 'server', 'ingest', 'app'];
const CODE_RE = /\b(E_[A-Z][A-Z0-9_]{2,})\b/g;

const args = new Set(process.argv.slice(2));
const registry = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
      walk(p, out);
    } else if (/\.(mjs|js|cjs|py|sh|html|json)$/.test(ent.name) && !/^test-|\.test\./.test(ent.name)) {
      out.push(p);
    }
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
const used = new Map(); // code -> Set(file)
for (const file of files) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  for (const m of text.matchAll(CODE_RE)) {
    const code = m[1];
    if (!used.has(code)) used.set(code, new Set());
    used.get(code).add(path.relative(ROOT, file).replace(/\\/g, '/'));
  }
}

const registered = new Set(Object.keys(registry.codes));
const unknown = [...used.keys()].filter((c) => !registered.has(c)).sort();
const unused = [...registered].filter((c) => !used.has(c)).sort();

const report = {
  ok: unknown.length === 0,
  registry: path.relative(ROOT, REGISTRY).replace(/\\/g, '/'),
  used: used.size,
  registered: registered.size,
  unknown,
  unused,
  coverage: registered.size ? Number(((used.size - unknown.length) / used.size * 100).toFixed(1)) : 0,
};

if (args.has('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`[errors] registry ${report.registered} · emitted ${report.used} · registered+used ${report.used - unknown.length} · coverage ${report.coverage}%`);
  if (unknown.length) {
    console.log(`[errors] ${unknown.length} unregistered code(s):`);
    for (const c of unknown) console.log(`  - ${c}  (${[...used.get(c)].slice(0, 3).join(', ')})`);
  }
  if (unused.length) console.log(`[errors] ${unused.length} registered but unused: ${unused.join(', ')}`);
}

if (args.has('--write')) {
  const order = { usage: 0, spec: 1, render: 2, concat: 3, qa: 4, env: 5, api: 6 };
  const rows = Object.entries(registry.codes)
    .sort(([a, x], [b, y]) => (order[x.phase] ?? 9) - (order[y.phase] ?? 9) || a.localeCompare(b))
    .map(([code, m]) => `| \`${code}\` | ${m.phase} | ${m.exit} | ${m.meaning} | ${m.action} |`);
  const md = `# 错误码与退出码

> 由 \`node scripts/errors.mjs --write\` 从 \`schema/errors.json\` 生成。
> 修改错误码请改注册表，不要手改本文件。

## 退出码

| 退出码 | 阶段 | 用法 |
|---|---|---|
${Object.entries(registry.exitCodes).map(([k, v]) => `| ${k} | ${v.split(' ')[0]} | ${v} |`).join('\n')}

脚本可以用退出码做粗分流，用 \`--json\` / \`error.json\` 的 \`code\` 做精确重试。

## 已注册错误码（${Object.keys(registry.codes).length}）

| 错误码 | 阶段 | 退出码 | 含义 | 唯一动作 |
|---|---|---|---|---|
${rows.join('\n')}

## 覆盖情况

- 代码中出现的 \`E_*\`：${report.used}
- 已注册且被使用：${report.used - unknown.length}
- 未注册：${unknown.length}
${unknown.length ? `\n未注册清单（按文件）：\n\n${unknown.map((c) => `- \`${c}\` — ${[...used.get(c)].join(', ')}`).join('\n')}\n` : ''}
- 已注册但当前未使用：${unused.length}${unused.length ? `（${unused.join(', ')}）` : ''}
`;
  fs.mkdirSync(path.dirname(DOC), { recursive: true });
  fs.writeFileSync(DOC, md);
  console.log(`[errors] wrote ${path.relative(ROOT, DOC)}`);
}

if (args.has('--check') && unknown.length) process.exit(1);
