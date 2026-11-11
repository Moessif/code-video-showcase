#!/usr/bin/env node
/**
 * plan.mjs — spec.json (IR) → plan.json（带段哈希的渲染计划）
 *
 * 在 timeline.mjs 的帧对齐逻辑之上补三件事：
 *   1. spec 归一化 + 校验（错误直接阻断）；
 *   2. 每段一个内容哈希 segmentHash（缓存/增量的唯一依据）；
 *   3. plan 里记录 spec 摘要、资产哈希与渲染选项，供 render-farm / compile 使用。
 *
 *   node templates/plan.mjs --spec project.spec.json --out out/plan.json --concat out/segments.txt --print
 *   node templates/plan.mjs --spec project.spec.json --check
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildPlan as buildLegacyPlan, concatList, formatPlan } from './timeline.mjs';
import { normalizeSpec, validateSpec, specToTimeline, specDuration, SPEC_VERSION, ENGINE_VERSION } from './spec.mjs';

export const PLAN_VERSION = 2;

const isAbsoluteUrl = (s) => /^https?:\/\//i.test(String(s || ''));

/** 段哈希：任何影响该段像素的输入都必须进来。 */
export function segmentHash(segment, meta, spec) {
  const assetHashes = (spec.assets || [])
    .map((a) => a.hash || a.sha256 || null)
    .filter(Boolean)
    .sort();
  const scopedPatches = (spec.patches || []).filter((p) => !p.scope || p.scope === segment.id);
  const payload = JSON.stringify({
    plan: PLAN_VERSION,
    engine: ENGINE_VERSION,
    id: segment.id,
    kind: segment.kind,
    page: segment.page,
    startFrame: segment.startFrame,
    frames: segment.frames,
    t0: segment.t0 ?? null,
    speed: segment.speed ?? null,
    theme: meta.theme || '',
    motion: meta.motion || '',        // v2.3：动效档位进哈希，换档位必须重渲染
    brand: meta.brand || '',
    assets: assetHashes,
    patches: scopedPatches,
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

function assertPages(spec, root) {
  const missing = [];
  const pages = [
    ['opening.page', spec.opening.page],
    ...spec.rounds.flatMap((r, i) => [[`rounds[${i}].card.page`, r.card.page], [`rounds[${i}].style.page`, r.style.page]]),
    ['moreCard.page', spec.moreCard.page],
    ['flash.page', spec.flash.page],
    ['ending.page', spec.ending.page],
  ];
  for (const [label, page] of pages) {
    if (!page || isAbsoluteUrl(page)) continue;
    const p = String(page).split('?')[0];
    if (!fs.existsSync(path.resolve(root, p))) missing.push({ code: 'E_PAGE_MISSING', path: label, message: `page not found: ${p}`, level: 'error' });
  }
  return missing;
}

/**
 * @param {object} input  spec v1 或 timeline v1
 * @param {{root?:string,outDir?:string,checkPages?:boolean}} opts
 */
export function buildPlanFromSpec(input, opts = {}) {
  const spec = normalizeSpec(input);
  const root = path.resolve(opts.root || process.env.CVS_ROOT || process.cwd());
  const issues = validateSpec(spec);
  if (opts.checkPages !== false) issues.push(...assertPages(spec, root));

  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warn');
  if (errors.length) {
    const e = new Error('invalid spec:\n  - ' + errors.map((x) => `[${x.code}] ${x.path}: ${x.message}`).join('\n  - '));
    e.code = 'SPEC_INVALID';
    e.issues = issues;
    throw e;
  }

  const timeline = specToTimeline(spec, { root, outDir: opts.outDir });
  const plan = buildLegacyPlan(timeline, { root, outDir: opts.outDir });

  plan.version = PLAN_VERSION;
  plan.generatedBy = 'templates/plan.mjs';
  plan.spec = {
    version: SPEC_VERSION,
    engine: ENGINE_VERSION,
    authoredBy: spec._authoredBy,
    duration: specDuration(spec),
    look: spec.look,
    format: spec.format,
    audio: spec.audio,
    motion: plan.meta.motion || null,   // v2.3：实际生效的动效档位
    assets: (spec.assets || []).map((a) => ({ id: a.id, hash: a.hash || a.sha256 || null, kind: a.kind || null, path: a.path || null })),
    patches: spec.patches || [],
  };
  plan.warnings = warnings.map((w) => ({ code: w.code, path: w.path, message: w.message }));

  for (const s of plan.segments) s.hash = segmentHash(s, plan.meta, spec);
  plan.stats.hashed = plan.segments.length;

  return { plan, spec, issues };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.spec) {
    console.log(`Usage: node templates/plan.mjs --spec <project.spec.json> [options]
  --out <plan.json>       default <outDir>/plan.json
  --concat <segments.txt> default <outDir>/segments.txt
  --root <dir>            project root (default cwd)
  --outdir <dir>          override outDir
  --check                 validate only
  --print                 print segment table
  --json                  print plan JSON`);
    process.exit(args.help ? 0 : 1);
  }

  const specPath = path.resolve(String(args.spec));
  const raw = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const root = path.resolve(String(args.root || path.dirname(specPath) || process.cwd()));

  if (args.check) {
    const spec = normalizeSpec(raw);
    const issues = [...validateSpec(spec), ...assertPages(spec, root)];
    for (const i of issues) console.log(`[${i.level}] [${i.code}] ${i.path}: ${i.message}`);
    const errors = issues.filter((i) => i.level === 'error');
    if (errors.length) process.exit(1);
    console.log(`✓ spec valid: ${spec.rounds.length} rounds, ${specDuration(spec)}s @ ${spec.format.fps}fps, ${spec.look.theme}`);
    return;
  }

  let built;
  try {
    built = buildPlanFromSpec(raw, { root, outDir: args.outdir ? String(args.outdir) : undefined });
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(1);
  }
  const { plan, spec } = built;
  for (const w of plan.warnings) console.error(`[warn] [${w.code}] ${w.path}: ${w.message}`);

  const outDir = plan.meta.outDir;
  const planPath = path.resolve(String(args.out || path.join(root, outDir, 'plan.json')));
  const concatPath = path.resolve(String(args.concat || path.join(root, outDir, 'segments.txt')));
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.mkdirSync(path.dirname(concatPath), { recursive: true });
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
  fs.writeFileSync(concatPath, concatList(plan));

  if (args.print) console.log(formatPlan(plan));
  if (args.json) console.log(JSON.stringify(plan, null, 2));
  console.log(`[spec]   ${specPath}`);
  console.log(`[plan]   ${planPath}`);
  console.log(`[concat] ${concatPath}`);
  console.log(`[stats]  ${plan.stats.duration.toFixed(3)}s / ${plan.stats.frames} frames / ${plan.stats.segments} segments / every segment hashed`);
}

const invokedDirectly = process.argv[1] && path.basename(process.argv[1]) === 'plan.mjs';
if (invokedDirectly) {
  try { main(); } catch (e) { console.error('[fatal]', e.stack || e); process.exit(1); }
}
