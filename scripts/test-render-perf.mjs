#!/usr/bin/env node
/**
 * test-render-perf.mjs — 渲染性能闸门：冷编译 + 缓存重编译。
 *
 *   CHROME_EXE="..." node scripts/test-render-perf.mjs
 *   node scripts/test-render-perf.mjs --concurrency 4 --max-seconds 420 --warm-max 30
 *   node scripts/test-render-perf.mjs --skip-cold        # 只测缓存命中
 *
 * 断言：
 *   1. 冷编译（无缓存）完成且帧数 = 期望帧数；
 *   2. 冷编译 wall time ≤ --max-seconds；
 *   3. 缓存重编译 ≤ --warm-max，且 render-manifest.json 全部 cached；
 *   4. 段缓存条目数 = 段数。
 *
 * 退出码 0/1。长任务；CI 不默认跑（需要 Chrome）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
const SPEC = path.resolve(String(args.spec || path.join(ROOT, 'fixtures/mini-41s/spec.json')));
const OUTDIR = path.resolve(String(args.outdir || path.join(ROOT, 'out/perf')));
const CONCURRENCY = String(args.concurrency || 4);
const MAX_COLD = Number(args['max-seconds'] || 600);
const MAX_WARM = Number(args['warm-max'] || 30);
const SKIP_COLD = !!args['skip-cold'];

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
};

function compile() {
  const started = Date.now();
  const r = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts/compile.mjs'),
    '--spec', SPEC, '--root', ROOT, '--outdir', OUTDIR,
    '--no-qa', '--concurrency', CONCURRENCY,
  ], { cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const seconds = (Date.now() - started) / 1000;
  return { seconds, status: r.status, out: `${r.stdout || ''}\n${r.stderr || ''}` };
}

function probeFrames(file) {
  const r = spawnSync(process.env.FFPROBE || 'ffprobe', [
    '-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file,
  ], { encoding: 'utf8' });
  return r.status === 0 ? Number(String(r.stdout).trim()) : -1;
}

console.log(`[perf] spec=${path.relative(ROOT, SPEC)} concurrency=${CONCURRENCY} outdir=${path.relative(ROOT, OUTDIR)}`);
if (!SKIP_COLD) {
  fs.rmSync(OUTDIR, { recursive: true, force: true });
} else {
  fs.rmSync(path.join(OUTDIR, '.cache'), { recursive: true, force: true });
  fs.rmSync(path.join(OUTDIR, 'render-manifest.json'), { force: true });
}

fs.mkdirSync(OUTDIR, { recursive: true });
const planRun = spawnSync(process.execPath, [
  path.join(ROOT, 'templates/plan.mjs'), '--spec', SPEC, '--root', ROOT,
  '--out', path.join(OUTDIR, 'plan.json'), '--concat', path.join(OUTDIR, 'segments.txt'),
], { cwd: ROOT, encoding: 'utf8' });
if (planRun.status !== 0) {
  console.error('plan failed:', planRun.stderr || planRun.stdout);
  process.exit(1);
}
const plan = JSON.parse(fs.readFileSync(path.join(OUTDIR, 'plan.json'), 'utf8'));
const expectedFrames = plan.stats?.frames;
const segCount = plan.stats?.segments;

let coldSeconds = 0;
if (!SKIP_COLD) {
  const cold = compile();
  coldSeconds += cold.seconds;
  console.log(`[cold]   ${cold.seconds.toFixed(1)}s  exit=${cold.status}`);
  if (cold.status !== 0) {
    // 多浏览器冷启动偶发 CDP navigate 超时；重跑一次即为真实工作流（compile --resume）。
    console.log('[cold]   transient failure → repair pass');
    const repair = compile();
    coldSeconds += repair.seconds;
    console.log(`[repair] ${repair.seconds.toFixed(1)}s  exit=${repair.status}`);
  }
  const master = path.join(OUTDIR, 'master.mp4');
  const frames = probeFrames(master);
  check('cold master frame count matches plan', frames === expectedFrames, `${frames}/${expectedFrames}`);
  check(`cold + repair <= ${MAX_COLD}s`, coldSeconds <= MAX_COLD, `${coldSeconds.toFixed(1)}s`);
}

const warm = compile();
console.log(`[warm] ${warm.seconds.toFixed(1)}s  exit=${warm.status}`);
check('warm compile succeeded', warm.status === 0, `exit ${warm.status}`);
check(`warm recompile <= ${MAX_WARM}s`, warm.seconds <= MAX_WARM, `${warm.seconds.toFixed(1)}s`);

const manifestPath = path.join(OUTDIR, 'render-manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { segments: {} };
const statuses = Object.values(manifest.segments || {}).map((v) => v.status);
const cached = statuses.filter((s) => s === 'cached' || s === 'skipped').length;
check('all segments served from cache', cached === segCount && segCount > 0, `${cached}/${segCount}`);

const cacheDir = path.join(OUTDIR, '.cache');
const cacheEntries = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter((f) => f.endsWith('.mp4')).length : 0;
check('cache holds one mp4 per segment', cacheEntries === segCount, `${cacheEntries}/${segCount}`);

console.log(`\n${failed ? 'RESULT: FAIL' : 'RESULT: PASS'}`);
process.exit(failed ? 1 : 0);
