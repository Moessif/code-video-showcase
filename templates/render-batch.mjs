#!/usr/bin/env node
/**
 * render-batch.mjs — render a shard of a plan with ONE static server and ONE
 * browser, then write the same content-addressed cache entries render-farm uses.
 *
 * This is the hot path for a film: a plan with 23 segments used to start 23
 * Chrome instances (SwiftShader startup dominates). Here one process pays that
 * startup once and loops the segments; each segment is still a fresh page and a
 * fresh ffmpeg process, so frames are byte-for-byte the same pipeline.
 *
 *   node templates/render-batch.mjs --plan out/plan.json
 *   node templates/render-batch.mjs --plan out/plan.json --shard 0/4 --cache out/.cache
 *   node templates/render-batch.mjs --plan out/plan.json --shard 1/4 --resume --retries 2
 *
 * Selection flags mirror render-farm (--only/--kinds/--from/--to/--shard) but
 * render-farm normally hands each worker a temporary plan that already holds
 * only that worker's segments, so --shard 1/1 is the common case.
 *
 * Cache semantics are unchanged: <cache>/<hash>.mp4 + <hash>.json; a hit is
 * copied to the segment's --out path. Every result is verified with ffprobe
 * before it is accepted and cached.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  withRenderer, parseArgv, optionsFromRenderArgs, normalizeOptions,
} from './render-segment.mjs';

const args = parseArgv(process.argv.slice(2));
const num = (k, d) => (args[k] === undefined ? d : Number(args[k]));
const str = (k, d) => (args[k] === undefined ? d : String(args[k]));
const list = (k) => (args[k] ? String(args[k]).split(',').map((s) => s.trim()).filter(Boolean) : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (args.help || !args.plan) {
  console.log(`Usage: node templates/render-batch.mjs --plan <plan.json> [options]
  --shard <i/n>         render every n-th selected segment starting at i (0-based)
  --concurrency <n>     segments in flight in this process, default 1
  --outdir <dir>        override the output directory (default plan.meta.outDir)
  --cache <dir>         segment cache, default <outDir>/.cache
  --no-cache            disable the segment cache
  --retries <n>         retries per segment, default 2
  --resume              skip segments whose MP4 already has the expected frame count
  --only <id,id>        render only these segment ids
  --kinds <kind,kind>   render only these kinds (style,card,opening,flash,ending,more)
  --from <id> --to <id> inclusive segment range
  --root <dir>          project root, default plan.meta.root
  --manifest <file>     default <outDir>/render-manifest.json
  --browser <path>      pass through to the renderer
  --crf <n>             intermediate CRF, default 12
  --preset <name>       x264 preset, default veryfast
  --capture <mode>      auto|canvas|cdp
  --format <jpeg|png>   frame format
  --quality <n>         jpeg quality
  --profile-dir <dir>   persistent Chrome profile (default <outDir>/.chrome-profile/<pid>)
  --no-profile          use a throwaway profile instead
  --quiet               only errors and summary
  --stop-on-error       do not start remaining jobs after a failure
  --dry-run             print jobs without running`);
  process.exit(args.help ? 0 : 1);
}

const planPath = path.resolve(String(args.plan));
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const root = path.resolve(str('root', plan.meta?.root || path.dirname(planPath)));
const outDirAbs = (() => {
  const p = str('outdir', plan.meta?.outDir || path.dirname(planPath));
  return path.isAbsolute(String(p)) ? path.resolve(String(p)) : path.resolve(root, String(p));
})();
const concurrency = Math.max(1, num('concurrency', 1));
const retries = Math.max(0, num('retries', 2));
const resume = !!args.resume;
const dryRun = !!args['dry-run'];
const quiet = !!args.quiet;
const stopOnError = !!args['stop-on-error'];
// render-farm 会把绝对路径的 --manifest/--cache/--profile-dir 传下来；
// 绝对路径必须原样使用，只有相对路径才相对 outDir 解析（否则出现 <root>/<root>/...）。
const resolveOut = (p) => (path.isAbsolute(String(p)) ? path.resolve(String(p)) : path.resolve(outDirAbs, String(p)));
const manifestPath = args.manifest ? resolveOut(args.manifest) : path.join(outDirAbs, 'render-manifest.json');
const cacheDir = args['no-cache'] ? null : (args.cache ? resolveOut(args.cache) : path.join(outDirAbs, '.cache'));
const profileDir = args['no-profile']
  ? null
  : (args['profile-dir']
    ? resolveOut(args['profile-dir'])
    : path.join(outDirAbs, '.chrome-profile', String(process.pid)));

function selectSegments(all) {
  let segments = all.slice();
  const only = list('only');
  const kinds = list('kinds');
  if (only) segments = segments.filter((s) => only.includes(s.id));
  if (kinds) segments = segments.filter((s) => kinds.includes(s.kind));
  if (args.from) {
    const i = all.findIndex((s) => s.id === args.from);
    if (i >= 0) segments = segments.filter((s) => all.indexOf(s) >= i);
  }
  if (args.to) {
    const i = all.findIndex((s) => s.id === args.to);
    if (i >= 0) segments = segments.filter((s) => all.indexOf(s) <= i);
  }
  if (args.shard) {
    const m = /^(\d+)\/(\d+)$/.exec(String(args.shard));
    if (!m) { console.error('--shard must be i/n'); process.exit(1); }
    const i = Number(m[1]), n = Number(m[2]);
    segments = segments.filter((_, k) => k % n === i);
  }
  return segments;
}

const segments = selectSegments(plan.segments || []);
if (!segments.length) { console.error('[batch] no segments selected'); process.exit(1); }

const ffprobe = process.env.FFPROBE || 'ffprobe';
function probeFrames(file) {
  if (!fs.existsSync(file)) return -1;
  const r = spawnSync(ffprobe, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  if (r.status !== 0) return -1;
  return Number(String(r.stdout).trim()) || 0;
}

/** Resolve the segment output path, honouring --outdir and the plan's --out. */
function segmentOut(s) {
  const i = s.renderArgs.indexOf('--out');
  const raw = i >= 0 ? s.renderArgs[i + 1] : (s.out || `${s.id}.mp4`);
  const abs = path.resolve(root, raw);
  if (args.outdir) return path.join(outDirAbs, path.basename(raw));
  return abs;
}

function segmentOptions(s, outAbs) {
  const extra = {
    out: outAbs,
    root,
    browser: args.browser === undefined ? undefined : String(args.browser),
    crf: args.crf === undefined ? undefined : Number(args.crf),
    preset: args.preset === undefined ? undefined : String(args.preset),
    capture: args.capture === undefined ? undefined : String(args.capture),
    format: args.format === undefined ? undefined : String(args.format),
    quality: args.quality === undefined ? undefined : Number(args.quality),
    profileDir,
  };
  for (const k of Object.keys(extra)) if (extra[k] === undefined) delete extra[k];
  return optionsFromRenderArgs(s.renderArgs, extra);
}

const manifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : { version: 1, segments: {} };
manifest.version = 1;

function saveManifest() {
  manifest.updated = new Date().toISOString();
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

function tryCache(s, outAbs) {
  if (!cacheDir || !s.hash) return null;
  const cachedMp4 = path.join(cacheDir, `${s.hash}.mp4`);
  const cachedMeta = path.join(cacheDir, `${s.hash}.json`);
  if (!fs.existsSync(cachedMp4) || !fs.existsSync(cachedMeta)) return null;
  try {
    const m = JSON.parse(fs.readFileSync(cachedMeta, 'utf8'));
    if (Number(m.frames) !== Number(s.frames)) return null;
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.copyFileSync(cachedMp4, outAbs);
    return Number(m.frames);
  } catch {
    return null;
  }
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

async function main() {
  console.log(`[batch] ${segments.length} segments, concurrency=${concurrency}, retries=${retries}, resume=${resume}`);
  console.log(`[batch] root ${root}`);
  console.log(`[batch] out  ${outDirAbs}`);
  console.log(`[batch] cache ${cacheDir || '(disabled)'}`);
  if (profileDir) console.log(`[batch] profile ${profileDir}`);

  if (dryRun) {
    for (const s of segments) console.log(`[dry] ${s.id}  ${s.kind}  ${s.frames}f  -> ${segmentOut(s)}`);
    return { ok: segments.length, failed: 0, dry: true };
  }

  fs.mkdirSync(outDirAbs, { recursive: true });

  const results = [];
  let stopped = false;
  let consecutiveFailures = 0;

  // Resolve cache/resume hits before starting Chrome. A fully cached re-run
  // must not pay the browser startup at all.
  const pending = [];
  for (const s of segments) {
    const outAbs = segmentOut(s);
    const hit = tryCache(s, outAbs);
    if (hit !== null) {
      manifest.segments[s.id] = { status: 'cached', frames: hit, hash: s.hash, out: path.relative(root, outAbs).split(path.sep).join('/') };
      if (!quiet) console.log(`[${s.id}] cache hit ${s.hash}`);
      saveManifest();
      results.push({ id: s.id, ok: true, cached: true });
      continue;
    }
    if (resume) {
      // resume 只能证明「帧数对」，不能证明「内容对」。
      // v2.3.5：必须同时满足「上一次 manifest 记录的 hash == 本次 hash」才跳过；
      // 没有上次记录（旧 manifest / 中断后）时保守重渲，避免把旧画面当新画面。
      const prev = manifest.segments[s.id];
      const got = probeFrames(outAbs);
      if (got === s.frames && prev && (!s.hash || prev.hash === s.hash)) {
        manifest.segments[s.id] = { status: 'skipped', frames: got, expected: s.frames, out: path.relative(root, outAbs).split(path.sep).join('/'), ...(s.hash ? { hash: s.hash } : {}) };
        if (!quiet) console.log(`[${s.id}] resume hit (${got} frames, hash ${s.hash || '-'})`);
        saveManifest();
        results.push({ id: s.id, ok: true, skipped: true });
        continue;
      }
    }
    pending.push({ s, outAbs });
  }

  const runOne = async (ctx, s, outAbs) => {
    const opts = segmentOptions(s, outAbs);
    const log = quiet
      ? (line) => { if (/\[warn\]|\[fatal\]/.test(line)) console.log(`[${s.id}] ${line}`); }
      : (line) => console.log(`[${s.id}] ${line}`);
    let lastErr = null;
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      const started = performance.now();
      try {
        await ctx.render({ ...opts, log, warn: log });
      } catch (e) {
        lastErr = e;
        const sec = ((performance.now() - started) / 1000).toFixed(1);
        console.error(`[${s.id}] ✗ attempt ${attempt}/${retries + 1} after ${sec}s: ${String(e.message || e).split('\n')[0]}`);
        if (attempt <= retries) {
          if (concurrency === 1 && ++consecutiveFailures >= 2) {
            consecutiveFailures = 0;
            try {
              console.log(`[batch] restarting browser after repeated failures`);
              await ctx.restart();
            } catch (re) {
              console.error(`[batch] browser restart failed: ${re.message}`);
            }
          }
          await sleep(500 * attempt);
          continue;
        }
        manifest.segments[s.id] = { status: 'failed', attempts: attempt, seconds: Number(sec), out: path.relative(root, outAbs).split(path.sep).join('/'), error: String(e.message || e).slice(-1200) };
        saveManifest();
        return { id: s.id, ok: false, error: String(e.message || e).slice(-600) };
      }

      consecutiveFailures = 0;
      const sec = Number(((performance.now() - started) / 1000).toFixed(1));
      const got = probeFrames(outAbs);
      if (got === s.frames) {
        manifest.segments[s.id] = {
          status: 'done', frames: got, expected: s.frames, seconds: sec, attempts: attempt,
          out: path.relative(root, outAbs).split(path.sep).join('/'), ...(s.hash ? { hash: s.hash } : {}),
        };
        if (!quiet) console.log(`[${s.id}] ✓ ${s.frames} frames in ${sec}s (attempt ${attempt})`);
        writeCache(s, outAbs, s.frames, sec);
        saveManifest();
        return { id: s.id, ok: true };
      }

      lastErr = new Error(`frame mismatch: got ${got}, expected ${s.frames}`);
      console.error(`[${s.id}] frame mismatch: got ${got}, expected ${s.frames} (attempt ${attempt})`);
      if (attempt <= retries) await sleep(500 * attempt);
    }

    manifest.segments[s.id] = { status: 'frame-mismatch', attempts: retries + 1, out: path.relative(root, outAbs).split(path.sep).join('/'), error: String(lastErr && lastErr.message || lastErr) };
    saveManifest();
    return { id: s.id, ok: false, error: String(lastErr && lastErr.message || lastErr) };
  };

  if (pending.length) {
    const baseOpts = normalizeOptions({
      root,
      width: plan.meta?.width || 1920,
      height: plan.meta?.height || 1080,
      browser: args.browser === undefined ? undefined : String(args.browser),
      profileDir,
      log: (line) => { if (!quiet) console.log(`[batch] ${line}`); },
      warn: (line) => console.error(`[batch] ${line}`),
    });

    await withRenderer(baseOpts, async (ctx) => {
      const queue = pending.slice();
      async function worker() {
        while (queue.length && !stopped) {
          const { s, outAbs } = queue.shift();
          const r = await runOne(ctx, s, outAbs);
          results.push(r);
          if (!r.ok && stopOnError) { stopped = true; break; }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
    });
  }

  saveManifest();
  const ok = results.filter((r) => r.ok).length;
  const bad = results.filter((r) => !r.ok);
  console.log(`[batch] done: ${ok}/${results.length} ok, ${bad.length} failed`);
  if (bad.length) {
    for (const b of bad) console.error(`  ✗ ${b.id}: ${b.error || 'failed'}`);
    process.exitCode = 1;
  }
  return { ok, failed: bad.length };
}

main().catch((e) => { console.error('[fatal]', e && e.stack || e); process.exit(1); });
