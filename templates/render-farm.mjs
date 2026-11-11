#!/usr/bin/env node
/**
 * render-farm.mjs — plan-driven parallel renderer with retries and resume.
 *
 * One segment is one process; N segments render concurrently (default
 * min(4, cpus-1)). Each process owns its browser instance, so there is no
 * shared GPU context contention. Results are tracked in out/render-manifest.json
 * and can be resumed after a crash without re-rendering finished segments.
 *
 *   node templates/render-farm.mjs --plan out/plan.json
 *   node templates/render-farm.mjs --plan out/plan.json --concurrency 6 --resume
 *   node templates/render-farm.mjs --plan out/plan.json --only r01-style,r02-style
 *   node templates/render-farm.mjs --plan out/plan.json --kinds style --dry-run
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(HERE, 'render-segment.mjs');

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
  --concurrency <n>     parallel segments, default min(4, cpus-1)
  --retries <n>         retries per segment, default 2
  --resume              skip segments whose MP4 already has the expected frame count
  --only <id,id>        render only these segment ids
  --kinds <kind,kind>   render only these kinds (style,card,opening,flash,ending,more)
  --from <id> --to <id> inclusive segment range
  --shard <i/n>         render only every n-th segment starting at i (0-based)
  --root <dir>          project root, default plan.meta.root
  --browser <path>      pass through to render-segment
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
  --no-cache            disable the segment cache`);
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
const manifestPath = path.resolve(str('manifest', path.join(root, plan.meta.outDir || 'out', 'render-manifest.json')));
const cacheDir = args['no-cache'] ? null : path.resolve(str('cache', path.join(root, plan.meta.outDir || 'out', '.cache')));

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

function runOne(s) {
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
      const got = probeFrames(outAbs);
      if (got === s.frames) {
        manifest.segments[s.id] = { status: 'skipped', frames: got, expected: s.frames, out: s.out, ...(s.hash ? { hash: s.hash } : {}) };
        if (cacheDir && s.hash) writeCache(s, outAbs, got, 0);
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

async function main() {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  console.log(`[farm] ${segments.length} segments, concurrency=${concurrency}, retries=${retries}, resume=${resume}`);
  const queue = segments.slice();
  const results = [];
  let stopped = false;

  async function worker() {
    while (queue.length && !stopped) {
      const s = queue.shift();
      const r = await runOne(s);
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

main().catch((e) => { console.error('[fatal]', e.stack || e); process.exit(1); });
