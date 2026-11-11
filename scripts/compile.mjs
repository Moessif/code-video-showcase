#!/usr/bin/env node
/**
 * compile.mjs — 一条命令完成「spec → plan → 增量渲染 → 拼接 → 质检」。
 *
 *   node scripts/compile.mjs --spec project.spec.json
 *   node scripts/compile.mjs --spec project.spec.json --audio audio/mix.wav
 *   node scripts/compile.mjs --spec project.spec.json --concurrency 6 --no-qa
 *
 * 增量语义：每段带 segmentHash；render-farm 先查 out/.cache/<hash>.mp4，
 * 命中且帧数一致就直接复用。因此“改一处”只重渲受影响的段。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildPlanFromSpec } from '../templates/plan.mjs';
import { concatList } from '../templates/timeline.mjs';

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
  console.log(`Usage: node scripts/compile.mjs --spec <project.spec.json> [options]
  --root <dir>          project root (default spec dir)
  --outdir <dir>        output dir (default spec.render.outDir)
  --master <file>       default <outDir>/master.mp4
  --audio <wav>         optional soundtrack; without it the film is video-only
  --concurrency <n>     render parallelism (default spec.render.concurrency)
  --no-cache            ignore the segment cache
  --no-qa               skip qa-video
  --dry-run             plan + print, do not render
  --print               print the segment table`);
  process.exit(args.help ? 0 : 1);
}

const specPath = path.resolve(String(args.spec));
const root = path.resolve(String(args.root || path.dirname(specPath)));
const raw = JSON.parse(fs.readFileSync(specPath, 'utf8'));

let built;
try {
  built = buildPlanFromSpec(raw, { root, outDir: args.outdir ? String(args.outdir) : undefined });
} catch (e) {
  console.error(String(e.message || e));
  process.exit(1);
}
const { plan, spec } = built;
for (const w of plan.warnings) console.error(`[warn] [${w.code}] ${w.path}: ${w.message}`);

const outDir = path.resolve(root, plan.meta.outDir);
fs.mkdirSync(outDir, { recursive: true });
const planPath = path.join(outDir, 'plan.json');
const concatPath = path.join(outDir, 'segments.txt');
fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
fs.writeFileSync(concatPath, concatList(plan));

console.log(`[compile] ${spec.meta.name} · ${plan.stats.duration}s · ${plan.stats.frames} frames · ${plan.stats.segments} segments`);
console.log(`[plan]    ${planPath}`);

if (args.print) {
  console.log(plan.segments.map((s) => `${s.id.padEnd(12)} ${s.kind.padEnd(8)} ${String(s.startFrame).padStart(5)}-${String(s.endFrame).padEnd(5)} ${String(s.frames).padStart(4)}f  ${s.hash}  ${s.page}`).join('\n'));
}

if (args['dry-run']) {
  console.log('[dry-run] stop after plan');
  process.exit(0);
}

// ── 1. render ───────────────────────────────────────────────────────────────
const renderer = path.join(root, 'templates', 'render-farm.mjs');
const concurrency = String(args.concurrency || spec.render?.concurrency || 4);
const renderArgs = [renderer, '--plan', planPath, '--resume', '--concurrency', concurrency];
if (args['no-cache']) renderArgs.push('--no-cache');
const r = spawnSync(process.execPath, renderArgs, { cwd: root, stdio: 'inherit', windowsHide: true });
if (r.status !== 0) {
  console.error('[compile] render failed');
  process.exit(r.status || 1);
}

// ── 2. concat ───────────────────────────────────────────────────────────────
const master = path.resolve(String(args.master || path.join(outDir, 'master.mp4')));
fs.mkdirSync(path.dirname(master), { recursive: true });

if (args.audio) {
  const audio = path.resolve(String(args.audio));
  if (!fs.existsSync(audio)) { console.error(`[compile] audio not found: ${audio}`); process.exit(1); }
  const script = path.join(root, 'templates', 'concat-and-encode.sh');
  const bash = process.env.BASH || 'bash';
  const c = spawnSync(bash, [script, concatPath, audio, master, String(plan.stats.duration), String(plan.stats.fps)], {
    cwd: root, stdio: 'inherit', windowsHide: true,
  });
  if (c.status !== 0) { console.error('[compile] concat+encode failed'); process.exit(c.status || 1); }
} else {
  const ffmpeg = process.env.FFMPEG || 'ffmpeg';
  const c = spawnSync(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', concatPath, '-c', 'copy', '-movflags', '+faststart', master], {
    cwd: root, stdio: 'inherit', windowsHide: true,
  });
  if (c.status !== 0) { console.error('[compile] video-only concat failed'); process.exit(c.status || 1); }
}
console.log(`[master]  ${master}`);

// ── 3. qa ───────────────────────────────────────────────────────────────────
if (!args['no-qa']) {
  const qa = path.join(root, 'scripts', 'qa-video.mjs');
  const q = spawnSync(process.execPath, [qa, master, '--plan', planPath, '--json', path.join(outDir, 'qa', 'qa-video.json')], {
    cwd: root, stdio: 'inherit', windowsHide: true,
  });
  if (q.status !== 0) { console.error('[compile] qa failed'); process.exit(q.status || 1); }
}

// ── 4. summary ──────────────────────────────────────────────────────────────
const manifestPath = path.join(outDir, 'render-manifest.json');
if (fs.existsSync(manifestPath)) {
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const counts = {};
  for (const v of Object.values(m.segments || {})) counts[v.status] = (counts[v.status] || 0) + 1;
  console.log(`[cache]   ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  ')}`);
}
console.log(`[done]    ${master}`);
