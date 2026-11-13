#!/usr/bin/env node
/**
 * render-farm.mjs — plan-driven parallel renderer with retries and resume.
 *
 * Default (v3): split the selected segments into `--concurrency` shards and run
 * one `render-batch.mjs` per shard. Each worker pays one static server + one
 * browser startup and then renders its whole shard in that browser, which makes
 * a 23-segment film ~5x faster than one Chrome per segment.
 *
 * `--legacy` keeps the old behaviour: one render-segment process per segment.
 * Every old flag keeps working in both modes, including the manifest
 * (`<outDir>/render-manifest.json`) and the content-addressed cache
 * (`<outDir>/.cache/<hash>.mp4`).
 *
 *   node templates/render-farm.mjs --plan out/plan.json
 *   node templates/render-farm.mjs --plan out/plan.json --concurrency 6 --resume
 *   node templates/render-farm.mjs --plan out/plan.json --only r01-style,r02-style
 *   node templates/render-farm.mjs --plan out/plan.json --kinds style --dry-run
 *   node templates/render-farm.mjs --plan out/plan.json --legacy --concurrency 4
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(HERE, 'render-segment.mjs');
const BATCH_RENDERER = path.join(HERE, 'render-batch.mjs');

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
const num = (k, d) => (args[k] === undefined ? d : Number(args[k]));
const str = (k, d) => (args[k] === undefined ? d : String(args[k]));
const list = (k) => (args[k] ? String(args[k]).split(',').map((s) => s.trim()).filter(Boolean) : null);

if (args.help || !args.plan) {
  console.log(`Usage: node templates/render-farm.mjs --plan <plan.json> [options]
  --concurrency <n>     parallel shards (batch) or segments (legacy), default min(4, cpus-1)
  --retries <n>         retries per segment, default 2
  --resume              skip segments whose MP4 already has the expected frame count
  --only <id,id>        render only these segment ids
  --kinds <kind,kind>   render only these kinds (style,card,opening,flash,ending,more)
  --from <id> --to <id> inclusive segment range
  --shard <i/n>         render only every n-th segment starting at i (0-based)
  --legacy              one render-segment process per segment (old behaviour)
  --root <dir>          project root, default plan.meta.root
  --browser <path>      pass through to the renderer
  --crf <n>             intermediate CRF, default 12
  --preset <name>       x264 preset, default veryfast
  --capture <mode>      auto|canvas|cdp
  --format <jpeg|png>   frame format
  --quality <n>         jpeg quality
  --quiet               only errors and summary
  --stop-on-error       do not start remaining jobs after a failure
  --dry-run             print commands without running
  --manifest <file>     default <outDir>/render-manifest.json
  --cache <dir>         content-addressed segment cache, default <outDir>/.cache
  --no-cache            disable the segment cache
  --stagger <ms>        delay each batch worker's start (default 600; 0 disables)`);
  process.exit(args.help ? 0 : 1);
}

const planPath = path.resolve(String(args.plan));
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const root = path.resolve(str('root', plan.meta?.root || path.dirname(planPath)));
const concurrency = Math.max(1, num('concurrency', Math.min(4, Math.max(1, os.cpus().length - 1))));
const retries = Math.max(0, num('retries', 2));
const resume = !!args.resume;
const dryRun = !!args['dry-run'];
const quiet = !!args.quiet;
const stopOnError = !!args['stop-on-error'];
// outDir 可能是绝对路径（compile --outdir / spec.render.outDir），此时不能再 join(root)。
const resolveOutPath = (p) => (path.isAbsolute(String(p)) ? path.resolve(String(p)) : path.resolve(root, String(p)));
const manifestPath = args.manifest
  ? resolveOutPath(args.manifest)
  : path.join(resolveOutPath(plan.meta.outDir || 'out'), 'render-manifest.json');
const cacheDir = args['no-cache']
  ? null
  : (args.cache ? resolveOutPath(args.cache) : path.join(resolveOutPath(plan.meta.outDir || 'out'), '.cache'));

// ── selection (identical semantics to v2) ───────────────────────────────────
let segments = plan.segments.slice();
const only = list('only');
const kinds = list('kinds');
if (only) segments = segments.filter((s) => only.includes(s.id));
if (kinds) segments = segments.filter((s) => kinds.includes(s.kind));
if (args.from) {
  const i = plan.segments.findIndex((s) => s.id === args.from);
  if (i >= 0) segments = segments.filter((s) => plan.segments.indexOf(s) >= i);
}
if (args.to) {
  const i = plan.segments.findIndex((s) => s.id === args.to);
  if (i >= 0) segments = segments.filter((s) => plan.segments.indexOf(s) <= i);
}
if (args.shard) {
  const m = /^(\d+)\/(\d+)$/.exec(String(args.shard));
  if (!m) { console.error('--shard must be i/n'); process.exit(1); }
  const i = Number(m[1]), n = Number(m[2]);
  segments = segments.filter((_, k) => k % n === i);
}

if (!segments.length) { console.error('no segments selected'); process.exit(1); }

const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { version: 1, segments: {} };
manifest.version = 1;
manifest.updated = new Date().toISOString();

const ffprobe = process.env.FFPROBE || 'ffprobe';
function probeFrames(file) {
  if (!fs.existsSync(file)) return -1;
  const r = spawnSync(ffprobe, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  if (r.status !== 0) return -1;
  return Number(String(r.stdout).trim()) || 0;
}

// ── legacy mode: one process per segment ────────────────────────────────────
function rendererArgs(s) {
  const a = [RENDERER, ...s.renderArgs, '--root', root];
  if (args.browser) a.push('--browser', String(args.browser));
  if (args.crf !== undefined) a.push('--crf', String(args.crf));
  if (args.preset !== undefined) a.push('--preset', String(args.preset));
  if (args.capture !== undefined) a.push('--capture', String(args.capture));
  if (args.format !== undefined) a.push('--format', String(args.format));
  if (args.quality !== undefined) a.push('--quality', String(args.quality));
  return a;
}

function writeCache(s, outAbs, frames, seconds) {
  if (!cacheDir || !s.hash) return;
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.copyFileSync(outAbs, path.join(cacheDir, `${s.hash}.mp4`));
    fs.writeFileSync(
      path.join(cacheDir, `${s.hash}.json`),
      JSON.stringify({ id: s.id, hash: s.hash, frames, seconds, at: new Date().toISOString() }, null, 2),
    );
  } catch (e) {
    console.warn(`[${s.id}] cache write failed: ${e.message}`);
  }
}

function runOneLegacy(s) {
  return new Promise((resolve) => {
    const outAbs = path.resolve(root, s.out);

    // 内容寻址缓存：段哈希命中且帧数一致 → 直接复用，省掉整段渲染
    if (cacheDir && s.hash) {
      const cachedMp4 = path.join(cacheDir, `${s.hash}.mp4`);
      const cachedMeta = path.join(cacheDir, `${s.hash}.json`);
      if (fs.existsSync(cachedMp4) && fs.existsSync(cachedMeta)) {
        try {
          const m = JSON.parse(fs.readFileSync(cachedMeta, 'utf8'));
          if (Number(m.frames) === Number(s.frames)) {
            fs.mkdirSync(path.dirname(outAbs), { recursive: true });
            fs.copyFileSync(cachedMp4, outAbs);
            manifest.segments[s.id] = { status: 'cached', frames: m.frames, hash: s.hash, out: s.out };
            if (!quiet) console.log(`[${s.id}] ⚡ cache hit ${s.hash}`);
            resolve({ id: s.id, ok: true, cached: true });
            return;
          }
        } catch {
          // 损坏的缓存条目：忽略并重新渲染
        }
      }
    }

    if (resume) {
      // 同 render-batch：resume 必须同时校验上次记录的 hash，帧数相等不等于内容相等。
      const prev = manifest.segments[s.id];
      const got = probeFrames(outAbs);
      if (got === s.frames && prev && (!s.hash || prev.hash === s.hash)) {
        manifest.segments[s.id] = { status: 'skipped', frames: got, expected: s.frames, out: s.out, ...(s.hash ? { hash: s.hash } : {}) };
        if (!quiet) console.log(`[${s.id}] resume hit (${got} frames, hash ${s.hash || '-'})`);
        resolve({ id: s.id, ok: true, skipped: true });
        return;
      }
    }
    const a = rendererArgs(s);
    if (dryRun) {
      console.log(`[dry] node ${a.map((x) => (x.includes(' ') ? JSON.stringify(x) : x)).join(' ')}`);
      resolve({ id: s.id, ok: true, dry: true });
      return;
    }
    let attempt = 0;
    const attemptOnce = () => {
      attempt++;
      const started = performance.now();
      const child = spawn(process.execPath, a, { cwd: root, windowsHide: true, env: process.env });
      let tail = '';
      let settled = false;
      const onData = (d) => {
        const text = d.toString();
        tail = (tail + text).slice(-4000);
        if (!quiet) {
          for (const line of text.split(/\r?\n/).filter(Boolean)) console.log(`[${s.id}] ${line}`);
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', (e) => finish(false, String(e)));
      child.on('close', (code) => finish(code === 0, tail));
      function finish(ok, msg) {
        if (settled) return;
        settled = true;
        const sec = ((performance.now() - started) / 1000).toFixed(1);
        if (ok) {
          const got = probeFrames(outAbs);
          const framesOk = got === s.frames;
          manifest.segments[s.id] = {
            status: framesOk ? 'done' : 'frame-mismatch',
            frames: got, expected: s.frames, seconds: Number(sec), attempts: attempt, out: s.out,
            ...(s.hash ? { hash: s.hash } : {}),
          };
          if (!framesOk) {
            console.error(`[${s.id}] frame mismatch: got ${got}, expected ${s.frames}`);
            if (attempt <= retries) return setTimeout(attemptOnce, 500 * attempt);
            resolve({ id: s.id, ok: false, error: `frame mismatch ${got}/${s.frames}` });
            return;
          }
          if (!quiet) console.log(`[${s.id}] ✓ ${s.frames} frames in ${sec}s (attempt ${attempt})`);
          writeCache(s, outAbs, s.frames, Number(sec));
          resolve({ id: s.id, ok: true });
        } else {
          manifest.segments[s.id] = {
            status: 'failed', attempts: attempt, seconds: Number(sec), out: s.out,
            error: String(msg).slice(-1200),
          };
          console.error(`[${s.id}] ✗ attempt ${attempt}/${retries + 1}`);
          if (attempt <= retries) setTimeout(attemptOnce, 500 * attempt);
          else resolve({ id: s.id, ok: false, error: String(msg).slice(-600) });
        }
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      }
    };
    attemptOnce();
  });
}

async function runLegacy() {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  console.log(`[farm] legacy mode: ${segments.length} segments, concurrency=${concurrency}, retries=${retries}, resume=${resume}`);
  const queue = segments.slice();
  const results = [];
  let stopped = false;
  async function worker() {
    while (queue.length && !stopped) {
      const s = queue.shift();
      const r = await runOneLegacy(s);
      results.push(r);
      if (!r.ok && stopOnError) { stopped = true; break; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, segments.length) }, worker));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const ok = results.filter((r) => r.ok).length;
  const bad = results.filter((r) => !r.ok);
  console.log(`[farm] done: ${ok}/${results.length} ok, ${bad.length} failed`);
  if (bad.length) {
    for (const b of bad) console.error(`  ✗ ${b.id}: ${b.error || 'failed'}`);
    process.exit(1);
  }
  console.log(`[farm] manifest ${manifestPath}`);
}

// ── batch mode: N workers, one server + browser each ────────────────────────
function batchArgsFor(job) {
  // 临时 plan 已经只含本 shard 的段，worker 侧用 0/1（shard 是 0 基索引；1/1 会选空）。
  const a = [
    BATCH_RENDERER, '--plan', job.tmpPlan, '--shard', '0/1', '--concurrency', '1',
    '--root', root, '--manifest', job.partManifest, '--retries', String(retries),
  ];
  if (cacheDir) a.push('--cache', cacheDir); else a.push('--no-cache');
  if (resume) a.push('--resume');
  if (quiet) a.push('--quiet');
  if (stopOnError) a.push('--stop-on-error');
  if (args.browser) a.push('--browser', String(args.browser));
  if (args.crf !== undefined) a.push('--crf', String(args.crf));
  if (args.preset !== undefined) a.push('--preset', String(args.preset));
  if (args.capture !== undefined) a.push('--capture', String(args.capture));
  if (args.format !== undefined) a.push('--format', String(args.format));
  if (args.quality !== undefined) a.push('--quality', String(args.quality));
  return a;
}

function spawnBatch(job) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, job.argv, { cwd: root, stdio: 'inherit', windowsHide: true });
    let settled = false;
    const done = (code) => { if (!settled) { settled = true; resolve(code == null ? 1 : code); } };
    child.on('error', (e) => { console.error(`[farm] worker ${job.index} failed to start: ${e.message}`); done(1); });
    child.on('close', done);
  });
}

function mergePartManifests(jobs, codes) {
  const merged = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : { version: 1, segments: {} };
  merged.version = 1;
  merged.updated = new Date().toISOString();

  for (const job of jobs) {
    if (fs.existsSync(job.partManifest)) {
      try {
        const part = JSON.parse(fs.readFileSync(job.partManifest, 'utf8'));
        Object.assign(merged.segments, part.segments || {});
      } catch (e) {
        console.error(`[farm] worker ${job.index}: unreadable manifest: ${e.message}`);
      }
    }
    if (codes[job.index] !== 0) {
      for (const s of job.segments) {
        const entry = merged.segments[s.id];
        if (!entry || !['done', 'cached', 'skipped'].includes(entry.status)) {
          merged.segments[s.id] = {
            status: 'failed',
            ...(s.hash ? { hash: s.hash } : {}),
            out: s.out,
            error: (entry && entry.error) || `render-batch worker exited ${codes[job.index]}`,
          };
        }
      }
    }
  }

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(merged, null, 2));
  return merged;
}

async function runBatch() {
  const workers = Math.min(concurrency, segments.length);
  const outDirAbs = resolveOutPath(plan.meta.outDir || path.dirname(planPath));
  const batchDir = path.join(outDirAbs, '.batch');
  fs.mkdirSync(batchDir, { recursive: true });
  const stamp = `${process.pid}-${Date.now()}`;

  const jobs = [];
  for (let i = 0; i < workers; i++) {
    const shardSegments = segments.filter((_, k) => k % workers === i);
    if (!shardSegments.length) continue;
    const tmpPlan = path.join(batchDir, `plan-${stamp}-${i}.json`);
    fs.writeFileSync(tmpPlan, JSON.stringify({ ...plan, segments: shardSegments }, null, 2));
    const partManifest = path.join(batchDir, `manifest-${stamp}-${i}.json`);
    jobs.push({ index: i, segments: shardSegments, tmpPlan, partManifest });
  }

  console.log(`[farm] batch mode: ${jobs.length} workers (1 browser each), ${segments.length} segments, retries=${retries}, resume=${resume}`);
  for (const job of jobs) {
    job.argv = batchArgsFor(job);
  }

  if (dryRun) {
    for (const job of jobs) {
      console.log(`[dry] shard ${job.index}: ${job.segments.map((s) => s.id).join(', ')}`);
      console.log(`[dry] node ${job.argv.map((x) => (x.includes(' ') ? JSON.stringify(x) : x)).join(' ')}`);
    }
    for (const job of jobs) { try { fs.unlinkSync(job.tmpPlan); } catch { /* ignore */ } }
    return;
  }

  // 错峰启动：N 个 Chrome 同时冷启动会互相抢资源，造成 CDP navigate 超时。
  const staggerMs = Math.max(0, num('stagger', 600));
  const codes = {};
  try {
    const results = await Promise.all(jobs.map(async (job) => {
      if (staggerMs && job.index) await new Promise((r) => setTimeout(r, job.index * staggerMs));
      const code = await spawnBatch(job);
      codes[job.index] = code;
      return code;
    }));
    void results;
  } finally {
    const merged = mergePartManifests(jobs, codes);
    for (const job of jobs) {
      try { fs.unlinkSync(job.tmpPlan); } catch { /* ignore */ }
      try { fs.unlinkSync(job.partManifest); } catch { /* ignore */ }
    }
    try {
      if (!fs.readdirSync(batchDir).length) fs.rmdirSync(batchDir);
    } catch { /* ignore */ }

    const failed = [];
    let ok = 0;
    for (const s of segments) {
      const st = merged.segments[s.id]?.status;
      if (st === 'done' || st === 'cached' || st === 'skipped') ok++;
      else failed.push({ id: s.id, status: st || 'missing' });
    }
    console.log(`[farm] done: ${ok}/${segments.length} ok, ${failed.length} failed`);
    if (failed.length) {
      for (const f of failed) console.error(`  ✗ ${f.id}: ${f.status}`);
      process.exitCode = 1;
    }
    console.log(`[farm] manifest ${manifestPath}`);
  }
}

const useBatch = !args.legacy && fs.existsSync(BATCH_RENDERER);
if (useBatch) {
  runBatch().catch((e) => { console.error('[fatal]', e.stack || e); process.exit(1); });
} else {
  if (!args.legacy) console.warn('[farm] render-batch.mjs not found; falling back to legacy mode');
  runLegacy().catch((e) => { console.error('[fatal]', e.stack || e); process.exit(1); });
}
