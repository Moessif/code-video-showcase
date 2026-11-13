#!/usr/bin/env node
/**
 * qa-video.mjs — delivery gate for a rendered film.
 *
 *   node scripts/qa-video.mjs out/final.mp4 --plan out/plan.json
 *   node scripts/qa-video.mjs out/final.mp4 --ref out/master.mp4 --min-vmaf 95
 *
 * Checks: container/codec/colour tags/frame count, black frames, frozen frames
 * (whitelisting cards/flashes from the timeline), silence, EBU R128 loudness,
 * optional VMAF/SSIM against a reference, and a 1 fps contact sheet.
 *
 * Writes qa/qa-video.json and exits 1 on hard failures (warnings only with
 * --strict). Zero npm dependencies: ffprobe/ffmpeg must be on PATH.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = {};
const positional = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) { positional.push(a); continue; }
  const next = process.argv[i + 1];
  if (!next || next.startsWith('--')) args[a.slice(2)] = true;
  else { args[a.slice(2)] = next; i++; }
}
const num = (k, d) => (args[k] === undefined ? d : Number(args[k]));
const FILE = positional[0];

if (args.help || !FILE) {
  console.log(`Usage: node scripts/qa-video.mjs <video.mp4> [options]
  --plan <plan.json>     expected size/fps/frames + card/flash whitelist
  --ref <video.mp4>      reference for VMAF/SSIM (use a CRF12 master, not a platform copy)
  --min-vmaf <n>         default 95
  --width/--height <n>   expected size (default from plan, else 1920x1080)
  --fps <n>              expected fps (default from plan, else 30)
  --duration <sec>       expected duration (default from plan)
  --json <file>          report path, default qa/qa-video.json
  --contact <file>       contact sheet path, default qa/contact.jpg
  --no-contact           skip the contact sheet
  --strict               treat warnings as failures
  --quiet                only print the summary`);
  process.exit(args.help ? 0 : 1);
}

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const VIDEO = path.resolve(String(FILE));
const REPORT = path.resolve(String(args.json || path.join('qa', 'qa-video.json')));
const CONTACT = path.resolve(String(args.contact || path.join('qa', 'contact.jpg')));
const STRICT = !!args.strict;

const report = { file: VIDEO, checkedAt: new Date().toISOString(), checks: [], metrics: {} };
const add = (name, status, detail, value) => {
  report.checks.push({ name, status, detail, ...(value !== undefined ? { value } : {}) });
  if (!args.quiet) console.log(`[${status}] ${name}  ${detail}`);
};

function run(cmd, a, opts = {}) {
  return spawnSync(cmd, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

function ffprobeJson(file, extra = []) {
  const r = run(FFPROBE, ['-v', 'error', '-print_format', 'json', ...extra, file]);
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

if (!fs.existsSync(VIDEO)) { console.error(`missing file: ${VIDEO}`); process.exit(1); }

// ── plan expectations ───────────────────────────────────────────────────────
let plan = null;
if (args.plan) {
  plan = JSON.parse(fs.readFileSync(path.resolve(String(args.plan)), 'utf8'));
}
const fps = num('fps', plan?.meta?.fps ?? 30);
const width = num('width', plan?.meta?.width ?? 1920);
const height = num('height', plan?.meta?.height ?? 1080);
const duration = num('duration', plan?.stats?.duration ?? null);
const expectedFrames = plan?.stats?.frames ?? (duration ? Math.round(duration * fps) : null);
report.expect = { width, height, fps, duration, frames: expectedFrames };

// ── 1a. 内容级检查（v2.3.5）────────────────────────────────────────────────
// 容器指标全绿不代表画面是用户要的：旧版 fixture 用同一张占位页填了 78% 时长，
// 仍然拿 10 pass / 0 fail。这里补三类「画面内容」断言。
if (plan) {
  const proot = path.resolve(String(plan.meta?.root || process.cwd()));
  const pages = [...new Set((plan.segments || []).map((s) => String(s.page).split('?')[0]))];
  const missing = pages.filter((p) => !fs.existsSync(path.resolve(proot, p)));
  add('pages exist', missing.length ? 'FAIL' : 'PASS',
    missing.length ? `missing: ${missing.join(', ')}` : `${pages.length} page file(s) resolved`);

  const placeholders = [];
  for (const p of pages) {
    const abs = path.resolve(proot, p);
    if (!fs.existsSync(abs)) continue;
    let text = '';
    try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    if (/PLACEHOLDER_TITLE|PLACEHOLDER_SUB/.test(text)) placeholders.push(p);
  }
  add('placeholder pages', placeholders.length ? 'FAIL' : 'PASS',
    placeholders.length ? `developer placeholder constants in: ${placeholders.join(', ')}` : 'no PLACEHOLDER_* in used pages');

  if (plan.spec) {
    const copy = plan.spec.copy || {};
    add('copy present', copy.title ? 'PASS' : 'FAIL',
      copy.title ? `title="${copy.title}"` : 'plan.spec.copy.title is empty — the film has no title');
  }
}

// ── 1. container / streams ─────────────────────────────────────────────────
const probe = ffprobeJson(VIDEO, ['-count_frames', '-show_streams', '-show_format']);
const v = (probe.streams || []).find((s) => s.codec_type === 'video');
const au = (probe.streams || []).find((s) => s.codec_type === 'audio');
if (!v) { add('video stream', 'FAIL', 'no video stream'); }
else {
  const frames = Number(v.nb_read_frames || 0);
  report.metrics.frames = frames;
  report.metrics.codec = v.codec_name;
  report.metrics.pix_fmt = v.pix_fmt;
  report.metrics.color = { space: v.color_space, primaries: v.color_primaries, transfer: v.color_transfer, range: v.color_range };
  add('codec', v.codec_name === 'h264' ? 'PASS' : 'WARN', `video=${v.codec_name}${v.profile ? ` (${v.profile})` : ''}`);
  add('pix_fmt', v.pix_fmt === 'yuv420p' ? 'PASS' : 'FAIL', `${v.pix_fmt} (need yuv420p)`);
  add('size', Number(v.width) === width && Number(v.height) === height ? 'PASS' : 'FAIL', `${v.width}x${v.height} (need ${width}x${height})`);
  add('fps', v.r_frame_rate === `${fps}/1` ? 'PASS' : 'WARN', `${v.r_frame_rate} (need ${fps}/1)`);
  if (expectedFrames != null) {
    add('frames', frames === expectedFrames ? 'PASS' : 'FAIL', `${frames} (expected ${expectedFrames})`);
  }
  const colorOk = v.color_space === 'bt709' && v.color_primaries === 'bt709' && v.color_transfer === 'bt709' && v.color_range === 'tv';
  add('colour tags', colorOk ? 'PASS' : 'WARN', `${v.color_space || '?'}/${v.color_primaries || '?'}/${v.color_transfer || '?'}/${v.color_range || '?'} (need bt709/bt709/bt709/tv)`);
  if (duration != null) {
    const d = Number(probe.format?.duration || 0);
    add('duration', Math.abs(d - duration) <= 1 / fps + 0.001 ? 'PASS' : 'WARN', `${d.toFixed(3)}s (expected ${duration.toFixed(3)}s)`);
  }
  const tb = String(v.time_base || '');
  report.metrics.time_base = tb;
}
if (au) {
  report.metrics.audio = { codec: au.codec_name, sample_rate: Number(au.sample_rate), channels: au.channels };
  add('audio codec', au.codec_name === 'aac' ? 'PASS' : 'WARN', `${au.codec_name} ${au.sample_rate}Hz ${au.channels}ch`);
  add('audio rate', Number(au.sample_rate) === 48000 ? 'PASS' : 'WARN', `${au.sample_rate}Hz (need 48000)`);
} else {
  add('audio stream', 'WARN', 'no audio stream');
}

// ── 2. black / frozen / silence ────────────────────────────────────────────
function parseDetect(regex, text) {
  const out = [];
  for (const m of String(text).matchAll(regex)) out.push(m.groups || m);
  return out;
}

const bd = run(FFMPEG, ['-hide_banner', '-nostats', '-i', VIDEO, '-vf', 'blackdetect=d=0.10:pic_th=0.98:pix_th=0.10', '-an', '-f', 'null', '-']);
const blacks = parseDetect(/black_start:(?<start>[\d.]+)\s+black_end:(?<end>[\d.]+)\s+black_duration:(?<dur>[\d.]+)/g, bd.stderr);
const blackTotal = blacks.reduce((s, b) => s + Number(b.dur), 0);
report.metrics.black = { count: blacks.length, seconds: +blackTotal.toFixed(3), spans: blacks.map((b) => [Number(b.start), Number(b.end)]) };
add('black frames', blackTotal <= Math.max(0.5, (duration || 61) * 0.01) ? 'PASS' : 'WARN', `${blacks.length} spans, ${blackTotal.toFixed(2)}s total`);

const fd = run(FFMPEG, ['-hide_banner', '-nostats', '-i', VIDEO, '-vf', 'freezedetect=n=0.001:d=1.0', '-an', '-f', 'null', '-']);
const freezes = parseDetect(/freeze_start:\s*(?<start>[\d.]+)[\s\S]*?freeze_duration:\s*(?<dur>[\d.]+)/g, fd.stderr);
const staticWindows = (plan?.segments || []).filter((s) => ['card', 'flash', 'more'].includes(s.kind)).map((s) => [s.start, s.end]);
const unexpectedFreezes = freezes.filter((f) => {
  const a = Number(f.start), b = a + Number(f.dur);
  return !staticWindows.some(([s, e]) => b >= s - 0.05 && a <= e + 0.05);
});
report.metrics.freeze = { count: freezes.length, unexpected: unexpectedFreezes.length, spans: freezes.map((f) => [Number(f.start), +Number(f.dur).toFixed(3)]) };
add('frozen frames', unexpectedFreezes.length === 0 ? 'PASS' : 'WARN', `${freezes.length} spans (${unexpectedFreezes.length} outside card/flash windows)`);

if (au) {
  const sd = run(FFMPEG, ['-hide_banner', '-nostats', '-i', VIDEO, '-af', 'silencedetect=noise=-45dB:d=1.0', '-vn', '-f', 'null', '-']);
  const sils = parseDetect(/silence_start:\s*(?<start>-?[\d.]+)[\s\S]*?silence_end:\s*(?<end>[\d.]+)\s*\|\s*silence_duration:\s*(?<dur>[\d.]+)/g, sd.stderr);
  const midSilence = sils.filter((s) => Number(s.start) > 0.5 && Number(s.end) < (duration || 61) - 0.6);
  report.metrics.silence = { count: sils.length, mid: midSilence.length, spans: sils.map((s) => [Number(s.start), Number(s.end)]) };
  add('silence', midSilence.length === 0 ? 'PASS' : 'WARN', `${sils.length} spans, ${midSilence.length} mid-film`);
}

// ── 3. loudness ────────────────────────────────────────────────────────────
if (au) {
  const ln = run(FFMPEG, ['-hide_banner', '-nostats', '-i', VIDEO, '-af', 'loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json', '-vn', '-f', 'null', '-']);
  const m = String(ln.stderr).match(/\{[^{}]*"input_i"[^{}]*\}/s);
  if (m) {
    const d = JSON.parse(m[0]);
    const I = Number(d.input_i), TP = Number(d.input_tp), LRA = Number(d.input_lra);
    report.metrics.loudness = { lufs: I, truePeak: TP, lra: LRA };
    add('loudness', Math.abs(I + 14) <= 1 ? 'PASS' : 'WARN', `${I} LUFS (target -14 ±1)`);
    add('true peak', TP <= -0.5 ? 'PASS' : 'WARN', `${TP} dBTP (target ≤ -1.0)`);
    add('loudness range', LRA <= 14 ? 'PASS' : 'WARN', `${LRA} LU`);
  } else {
    add('loudness', 'WARN', 'could not parse loudnorm output');
  }
}

// ── 4. optional VMAF/SSIM against a reference ───────────────────────────────
if (args.ref) {
  const ref = path.resolve(String(args.ref));
  const refProbe = ffprobeJson(ref, ['-count_frames', '-show_streams']);
  const refVideo = (refProbe.streams || []).find((s) => s.codec_type === 'video');
  const refFrames = Number(refVideo?.nb_read_frames || 0);
  if (!refVideo || Math.abs(refFrames - (report.metrics.frames || 0)) > 1) {
    add('VMAF', 'ADVISORY', `reference has ${refFrames || '?'} frames vs ${report.metrics.frames || '?'}; skipped (use a same-length master)`);
  } else {
  const log = path.resolve('qa', 'vmaf.json');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const vm = run(FFMPEG, ['-hide_banner', '-nostats', '-i', VIDEO, '-i', ref, '-lavfi',
    `[0:v]setpts=PTS-STARTPTS[d];[1:v]setpts=PTS-STARTPTS[r];[d][r]libvmaf=model=version=vmaf_v0.6.1:log_path=${log.replace(/\\/g, '/')}:log_fmt=json:feature=name=psnr|name=float_ssim`,
    '-f', 'null', '-'], { timeout: 15 * 60 * 1000 });
  if (vm.status !== 0) {
    add('VMAF', 'ADVISORY', `libvmaf unavailable or reference mismatch: ${String(vm.stderr).split('\n').slice(-2).join(' ')}`);
  } else if (fs.existsSync(log)) {
    const j = JSON.parse(fs.readFileSync(log, 'utf8'));
    const pooled = j.pooled_metrics || j;
    const mean = Number(pooled.vmaf?.mean ?? pooled.vmaf);
    const min = Number(pooled.vmaf?.min ?? mean);
    report.metrics.vmaf = { mean, min, psnr_y: pooled.psnr_y?.mean, ssim: pooled.float_ssim?.mean };
    add('VMAF', mean >= num('min-vmaf', 95) ? 'PASS' : 'FAIL', `mean ${mean?.toFixed(2)} min ${min?.toFixed(2)} (need ≥ ${num('min-vmaf', 95)})`);
  }
  }
}

// ── 5. contact sheet ───────────────────────────────────────────────────────
if (!args['no-contact']) {
  fs.mkdirSync(path.dirname(CONTACT), { recursive: true });
  const cs = run(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-i', VIDEO, '-vf', 'fps=1,scale=320:-2,tile=8x8:padding=4:margin=8', '-frames:v', '1', CONTACT]);
  add('contact sheet', cs.status === 0 ? 'PASS' : 'ADVISORY', cs.status === 0 ? CONTACT : String(cs.stderr).slice(0, 200));
}

// ── summary ────────────────────────────────────────────────────────────────
// 三档：FAIL 交付物是错的；WARN 交付物不合格（--strict 下判失败）；
//       ADVISORY 诊断/装饰（VMAF 没装、封面拼图生成失败）——任何情况下都不拦交付。
const failures = report.checks.filter((c) => c.status === 'FAIL');
const warnings = report.checks.filter((c) => c.status === 'WARN');
const advisories = report.checks.filter((c) => c.status === 'ADVISORY');
report.summary = {
  pass: report.checks.length - failures.length - warnings.length - advisories.length,
  warn: warnings.length,
  advisory: advisories.length,
  fail: failures.length,
};
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(`\n${report.summary.pass} pass · ${report.summary.warn} warn · ${report.summary.advisory} advisory · ${report.summary.fail} fail  ->  ${REPORT}`);
if (failures.length || (STRICT && warnings.length)) process.exit(1);
