#!/usr/bin/env node
/**
 * compile.mjs — 一条命令完成「spec → 校验 → plan → 增量渲染 → 拼接 → 质检」。
 *
 *   node scripts/compile.mjs --spec project.spec.json
 *   node scripts/compile.mjs --spec project.spec.json --audio audio/mix.wav
 *   node scripts/compile.mjs --spec project.spec.json --platform douyin --strict
 *   node scripts/compile.mjs --spec project.spec.json --no-audio --no-qa
 *
 * v2.3.5 的四个硬变化：
 *   1. build 先跑与 spec-lint 相同的深度校验（页面/主题/APCA/占位品牌/空标题）；
 *   2. 有 spec.audio 时自动合成配乐；没有音轨必须显式 --no-audio，不再静默出默片；
 *   3. render.preset / --platform 真正接线，产出 <outDir>/<platform>.mp4（master 保留）；
 *   4. 失败按阶段返回退出码并写 <outDir>/error.json，不再只有一句 "failed"。
 *
 * 退出码：10 spec / 11 render / 12 concat / 13 qa / 14 env / 2 用法。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync as _spawnSync } from 'node:child_process';
import { buildPlanFromSpec } from '../templates/plan.mjs';
import { concatList } from '../templates/timeline.mjs';
import { deepValidate } from '../templates/spec-check.mjs';
import { xfadeOffsets, xfadeFilterGraph } from '../templates/transitions.mjs';

// R2-14（N04-F2）：build --json 机器模式——stdout 只有一行结果 JSON，
// 所有进度（含子进程 render-farm/ffmpeg/qa 的输出）退到 stderr。旧版 build
// 根本没有 --json，agent 只能正则人类日志或去 outDir 捞 error.json。
const JSON_MODE = process.argv.includes('--json');
const spawnSync = (cmd, args, opts = {}) => {
  if (!JSON_MODE) return _spawnSync(cmd, args, opts);
  const r = _spawnSync(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.stdout && r.stdout.length) process.stderr.write(r.stdout);
  if (r.stderr && r.stderr.length) process.stderr.write(r.stderr);
  return r;
};
if (JSON_MODE) console.log = (...a) => console.error(...a);
const emitJson = (obj) => { if (JSON_MODE) process.stdout.write(JSON.stringify(obj) + '\n'); };

const EXIT = { spec: 10, render: 11, concat: 12, qa: 13, env: 14, usage: 2 };
const STARTED = Date.now();
const CLI_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; }
  catch { return '0.0.0'; }
})();

// R2-16（N04-F8）：未知 flag 以前静默忽略——`--strik` 拼错一次，
// 「已按交付态 strict 验收」就成了写进结论的假阳性。现在一律 exit 2 + 指名。
const KNOWN_FLAGS = new Set(['spec', 'root', 'outdir', 'master', 'audio', 'no-audio', 'platform',
  'concurrency', 'no-cache', 'no-resume', 'no-qa', 'no-strict', 'deliver', 'no-deliver',
  'strict', 'burn-subtitles', 'cover', 'transition', 'transition-duration', 'dry-run', 'print',
  'json', 'help']);

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const name = k.slice(2);
    if (!KNOWN_FLAGS.has(name)) {
      const near = [...KNOWN_FLAGS].find((f) => (f.startsWith(name.slice(0, 3)) || name.startsWith(f.slice(0, 3))));
      console.error(`[error] [E_UNKNOWN_FLAG] ${k}${near ? ` — did you mean --${near}?` : ''}`);
      process.exit(EXIT.usage);
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) a[name] = true;
    else { a[name] = next; i++; }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.spec) {
  console.log(`Usage: node scripts/compile.mjs --spec <project.spec.json> [options]
  --root <dir>          project root (default cwd)
  --outdir <dir>        output dir (default spec.render.outDir)
  --master <file>       default <outDir>/master.mp4
  --audio <wav>         explicit soundtrack; spec.audio is synthesized when omitted
  --no-audio            build a silent film on purpose (otherwise audio is required)
  --platform <id>       also encode a delivery copy: bilibili|douyin|youtube|xiaohongshu|wechat|square
  --concurrency <n>     render parallelism (default spec.render.concurrency)
  --no-cache            ignore the segment cache
  --no-resume           re-render even when a segment file already exists
  --no-qa               skip qa-video / qa-audio
  --strict              QA warnings fail the build (delivery mode)
  --no-strict           QA warnings are informational
  --burn-subtitles      burn master.srt into delivery copies (platform-*.mp4 / master-burned.mp4)
  --cover               render a card-layout cover (cvs image) into <outDir>/images
  --transition <name>   xfade between segments (fade/dissolve/wipeleft/slideleft/circleopen/zoomin/...;
                        'none' = hard cut). Shortens total by (N-1)*duration; plan/subtitles follow.
  --transition-duration <s>  transition length in seconds, (0,2], default 0.4
  --no-deliver          skip delivery.json + master.srt/.vtt
  --dry-run             validate + plan, do not render
  --print               print the segment table`);
  process.exit(args.help ? 0 : EXIT.usage);
}

const specPath = path.resolve(String(args.spec));
const root = path.resolve(String(args.root || process.cwd()));

/** 早期失败也要有落点：按 spec 里能读到的 outDir 推断。 */
function errorDir(raw) {
  // CLI --outdir 是操作者显式给的，尊重它。
  if (args.outdir) return path.resolve(root, String(args.outdir));
  // spec.render.outDir 是不可信输入：被 validateSpec 拒绝的 spec 仍会走到这里写
  // error.json，若直接 resolve 原始 outDir，`../../escape` 依旧能写到仓库外。
  // 含绝对路径/盘符/../控制字符时回落到根内 out/，并做 relative  containment 双保险。
  const s = String(raw?.render?.outDir || 'out');
  const bad = /^(?:[/\\]|[A-Za-z]:)/.test(s) || s.split(/[\\/]+/).includes('..') || /[\x00-\x1f]/.test(s);
  if (bad) return path.join(root, 'out');
  const dir = path.resolve(root, s);
  const rel = path.relative(root, dir);
  return (rel.startsWith('..') || path.isAbsolute(rel)) ? path.join(root, 'out') : dir;
}

// extra.detailPath = 该阶段最有用的诊断产物（render→render-manifest.json、
// concat→concat 日志、deliver→delivery.json）。**不要**叫 logPath：CLI 独立运行时
// 并没有 build.log（那是 API 服务器重定向 stdout 才有的），两个语义共用一个名字
// 会让 API 的 jobView.logPath 指向 manifest 而不是构建日志。
function fail(phase, code, message, extra = {}) {
  const { raw: rawForDir, ...publicExtra } = extra;
  const payload = {
    ok: false,
    phase,
    code,
    message: String(message || '').slice(0, 4000),
    spec: specPath,
    root,
    at: new Date().toISOString(),
    ...publicExtra,
  };
  console.error(`[error] [${code}] ${message}`);
  emitJson(payload);
  recordRun({ phase, exit: EXIT[phase] || 1, qaPass: false });
  try {
    const dir = errorDir(rawForDir || lastRaw);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'error.json'), JSON.stringify(payload, null, 2));
  } catch { /* 写不了错误文件也不能掩盖原始错误 */ }
  process.exit(EXIT[phase] || 1);
}

let lastRaw = null;
// 运行上下文：plan 生成后才填；失败路径（render/concat/qa）也用它记一次 run。
const ctx = { spec: null, plan: null, outDir: null, specHash: null, platform: null };

// 兜底：未预料的异常（如 outDir 含控制字符导致 mkdirSync 抛错）也要走 fail 写
// error.json，而不是裸 exit 1 让 API/CI 拿不到 phase/code。
process.on('uncaughtException', (err) => {
  fail('env', 'E_EXCEPTION', `unexpected error: ${(err && err.stack) || err}`, { raw: lastRaw });
});
process.on('unhandledRejection', (err) => {
  fail('env', 'E_EXCEPTION', `unhandled rejection: ${(err && err.stack) || err}`, { raw: lastRaw });
});

function recordRun({ phase, exit, qaPass }) {
  if (!ctx.outDir || !ctx.plan || !ctx.spec) return;
  try {
    const dir = path.join(ctx.outDir, '.cvs');
    fs.mkdirSync(dir, { recursive: true });
    let m = { segments: {} };
    try { m = JSON.parse(fs.readFileSync(path.join(ctx.outDir, 'render-manifest.json'), 'utf8')); } catch { /* 首次构建 */ }
    const vals = Object.values(m.segments || {});
    const dirty = vals.filter((v) => !['cached', 'skipped'].includes(v.status)).length;
    const rec = {
      ts: new Date().toISOString(),
      cliVersion: CLI_VERSION,
      project: ctx.spec.meta.name,
      specHash: ctx.specHash,
      dirtySegments: dirty,
      totalSegments: ctx.plan.stats.segments,
      phase,
      exit,
      qaPass: !!qaPass,
      platform: ctx.platform || null,
      durationMs: Date.now() - STARTED,
    };
    fs.appendFileSync(path.join(dir, 'runs.jsonl'), JSON.stringify(rec) + '\n');
  } catch { /* 度量失败不影响构建 */ }
}
let raw;
try {
  raw = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  lastRaw = raw;
} catch (e) {
  const code = e instanceof SyntaxError ? 'E_JSON_PARSE' : 'E_READ';
  fail('spec', code, `${specPath}: ${e.message}`);
}

// CLI 转场开关（v2.5）覆盖 spec.render，且必须在校验/建 plan 之前注入，
// 这样时长/帧数/字幕偏移才会跟着转场一起算。--transition none 显式关闭。
if (args.transition !== undefined) {
  raw.render = raw.render || {};
  raw.render.transition = args.transition === true ? 'fade' : String(args.transition);
}
if (args['transition-duration'] !== undefined) {
  raw.render = raw.render || {};
  raw.render.transitionDuration = Number(args['transition-duration']);
}

// ── 1. 深度校验（与 spec-lint 同一套） ──────────────────────────────────────
let spec;
let issues = [];
try {
  ({ spec, issues } = deepValidate(raw, { root }));
} catch (e) {
  fail('spec', e.code || 'E_SPEC', e.message || String(e));
}
const errors = issues.filter((i) => i.level === 'error');
const warnings = issues.filter((i) => i.level === 'warn');
for (const w of warnings) console.error(`[warn] [${w.code}] ${w.path}: ${w.message}`);
if (errors.length) {
  for (const e of errors) console.error(`[error] [${e.code}] ${e.path}: ${e.message}`);
  fail('spec', errors[0].code, `${errors.length} spec error(s); first: ${errors[0].path}: ${errors[0].message}`, {
    issues: errors,
    raw,
  });
}

// ── 2. plan ─────────────────────────────────────────────────────────────────
let built;
try {
  built = buildPlanFromSpec(raw, { root, outDir: args.outdir ? String(args.outdir) : undefined });
} catch (e) {
  const first = e.issues?.find((i) => i.level === 'error');
  fail('spec', first?.code || e.code || 'E_SPEC', e.message || String(e), { issues: e.issues || [], raw });
}
const { plan } = built;
const outDir = path.resolve(root, plan.meta.outDir);
fs.mkdirSync(outDir, { recursive: true });
// 新构建一开始就作废旧的失败记录。否则上一次失败留下的 error.json 会一直躺在
// 成功产物旁边，API/CI 读到它就以为这次也失败了（假红）。
try { fs.rmSync(path.join(outDir, 'error.json'), { force: true }); } catch { /* 删不掉不影响构建 */ }
const planPath = path.join(outDir, 'plan.json');
const concatPath = path.join(outDir, 'segments.txt');
fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
// v2.4/P1-10：清单写成相对 outDir 的安全路径，concat 端可以使用 -safe 1。
// 绝对路径/盘符/UNC/`..` 在 concatList(baseDir) 里直接拒绝。
fs.writeFileSync(concatPath, concatList(plan, { baseDir: outDir }));

console.log(`[compile] ${spec.meta.name} · ${plan.stats.duration}s · ${plan.stats.frames} frames · ${plan.stats.segments} segments`);
console.log(`[plan]    ${planPath}`);

if (args.print) {
  console.log(plan.segments.map((s) => `${s.id.padEnd(12)} ${s.kind.padEnd(8)} ${String(s.startFrame).padStart(5)}-${String(s.endFrame).padEnd(5)} ${String(s.frames).padStart(4)}f  ${s.hash}  ${s.page}`).join('\n'));
}
if (args['dry-run']) {
  console.log('[dry-run] stop after plan');
  emitJson({ ok: true, phase: 'dry-run', exit: 0, outDir: path.relative(root, outDir).split(path.sep).join('/'),
    segments: plan.stats.segments, frames: plan.stats.frames, duration: plan.stats.duration });
  process.exit(0);
}

const specHash = crypto.createHash('sha256').update(JSON.stringify(spec)).digest('hex').slice(0, 12);
const manifestPath = path.join(outDir, 'render-manifest.json');
// 填运行上下文：此后的失败路径也能记一次 run（度量不因失败而缺账）。
ctx.spec = spec;
ctx.plan = plan;
ctx.outDir = outDir;
ctx.specHash = specHash;

function readManifest() {
  try { return JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { return { segments: {} }; }
}


// ── 3. 音频（有 spec.audio 就自动合成；没有必须 --no-audio） ─────────────────
let audioPath = null;
if (args.audio) {
  audioPath = path.resolve(String(args.audio));
  if (!fs.existsSync(audioPath)) fail('env', 'E_AUDIO_NOT_FOUND', `audio not found: ${audioPath}`);
} else if (!args['no-audio']) {
  const hasAudioIntent = !!(spec.audio && (spec.audio.mood || spec.audio.bpm));
  if (!hasAudioIntent) {
    fail('spec', 'E_AUDIO_REQUIRED', 'no soundtrack: pass --audio <wav>, or --no-audio to build a silent film on purpose', { raw });
  }
  audioPath = path.join(outDir, 'audio', 'mix.wav');
  fs.mkdirSync(path.dirname(audioPath), { recursive: true });
  const py = process.env.PYTHON || 'python';
  console.log(`[audio]   synthesizing ${audioPath}`);
  const synth = spawnSync(py, [path.join(root, 'templates', 'synth_audio.py'), '--plan', planPath, '--out', audioPath], {
    cwd: root, stdio: 'inherit', windowsHide: true,
  });
  if (synth.status !== 0) {
    fail('env', 'E_AUDIO_REQUIRED',
      `soundtrack synthesis failed (exit ${synth.status}); install Python 3.10+ with numpy/scipy, pass --audio, or use --no-audio`,
      { raw });
  }
}
console.log(audioPath ? `[audio]   ${audioPath}` : '[audio]   (silent by --no-audio)');

// ── 4. render ───────────────────────────────────────────────────────────────
const renderer = path.join(root, 'templates', 'render-farm.mjs');
const renderArgs = [renderer, '--plan', planPath, '--concurrency', String(args.concurrency || spec.render?.concurrency || 4)];
if (!args['no-resume']) renderArgs.push('--resume');
if (args['no-cache']) renderArgs.push('--no-cache');
const r = spawnSync(process.execPath, renderArgs, { cwd: root, stdio: 'inherit', windowsHide: true });
if (r.status !== 0) {
  const m = readManifest();
  const failed = Object.entries(m.segments || {}).filter(([, v]) => v.status === 'failed');
  fail('render', 'E_RENDER', `segment render failed (exit ${r.status})`, {
    failedSegment: failed[0]?.[0] || null,
    failedSegments: failed.map(([id]) => id),
    detailPath: path.join(outDir, 'render-manifest.json'),
    raw,
  });
}
{
  const m = readManifest();
  const bad = Object.entries(m.segments || {}).filter(([, v]) => ['failed', 'frame-mismatch'].includes(v.status));
  if (bad.length) {
    fail('render', 'E_RENDER', `${bad.length} segment(s) not clean: ${bad.map(([id, v]) => `${id}=${v.status}`).join(', ')}`, {
      failedSegments: bad.map(([id]) => id),
      detailPath: manifestPath,
      raw,
    });
  }
}

// ── 5. concat（master + 可选平台版） ────────────────────────────────────────
const master = path.resolve(String(args.master || path.join(outDir, 'master.mp4')));
fs.mkdirSync(path.dirname(master), { recursive: true });

const platform = args.platform
  ? String(args.platform)
  : (spec.render?.preset && spec.render.preset !== 'master' ? String(spec.render.preset) : null);
ctx.platform = platform;
// 未知 --platform 不能静默回落 1920×1080（那会出一个贴错标签的交付物）。
// 有音轨时 shell 会拒，但无音轨路径以前直接 PLATFORM_SIZE[p] || [1920,1080]。
const ACCEPTED_PLATFORMS = new Set(['master', 'bilibili', 'douyin', 'youtube', 'xiaohongshu', 'wechat', 'weixin', 'square', 'archive']);
if (platform && !ACCEPTED_PLATFORMS.has(platform)) {
  fail('usage', 'E_PRESET', `unknown --platform "${platform}"; accepted: ${[...ACCEPTED_PLATFORMS].join('|')}`, { raw });
}

const PLATFORM_SIZE = {
  bilibili: [1920, 1080], youtube: [1920, 1080], master: [1920, 1080],
  douyin: [1080, 1920], xiaohongshu: [1080, 1440], weixin: [1080, 1260], square: [1080, 1080],
};
function scriptPlatformArgs(p) {
  if (p === 'wechat') return ['--platform', 'weixin'];
  if (p === 'square') return ['--platform', 'custom', '--width', '1080', '--height', '1080'];
  return ['--platform', p];
}

// 转场参数（v2.5）：offset 直接读 plan 的段起点（transitions.mjs 单一真值）。
function transitionArgs() {
  const tr = plan.meta && plan.meta.transition;
  if (!tr || plan.segments.length < 2) return [];
  return ['--transition', tr.token, '--td', String(tr.duration), '--offsets', xfadeOffsets(plan.segments, plan.stats.fps, tr).join(',')];
}

// spawnSync 启动失败（缺 bash/ffmpeg，ENOENT）时 status=null、error 有值。
// 旧版 `c.status || 0` 把 null 当 0 → 编译器 exit 0 却没有 master.mp4。
// 这里把「没跑起来」归为 env/E_SPAWN，绝不伪装成功。
function spawnStatus(c, tool) {
  if (c.error || c.status === null || c.status === undefined) {
    fail('env', 'E_SPAWN', `${tool} failed to launch: ${c.error ? c.error.message : 'no exit status (is it installed / on PATH?)'}`, { raw });
  }
  return c.status;
}

function encode(scripted, outFile, preset, extraArgs = []) {
  if (scripted) {
    const script = path.join(root, 'templates', 'concat-and-encode.sh');
    const bash = process.env.BASH || 'bash';
    const c = spawnSync(bash, [script, ...scriptPlatformArgs(preset || 'master'), ...extraArgs, ...transitionArgs(), concatPath, audioPath, outFile, String(plan.stats.duration), String(plan.stats.fps)], {
      cwd: root, stdio: 'inherit', windowsHide: true,
    });
    return spawnStatus(c, 'bash');
  }
  const ffmpeg = process.env.FFMPEG || 'ffmpeg';
  const tr = plan.meta && plan.meta.transition;
  if (tr && plan.segments.length >= 2) {
    // 无音轨也要转场：直接套 xfade 滤镜链（与 shell 同一份 offset）。
    const inputs = [];
    for (const s of plan.segments) inputs.push('-i', path.resolve(root, s.out));
    const graph = xfadeFilterGraph(plan.segments, plan.stats.fps, tr);
    // 内存上限（v2.5）：N 路 xfade 同时解码 N 段，默认线程 + x264 lookahead 会
    // 在 Windows 上耗尽 commit（表现为 "x264 malloc failed"）。与 shell 路径一致：
    // 限制解码线程、滤镜图单线程、压缩 x264 lookahead。
    const c = spawnSync(ffmpeg, ['-y', '-threads', '2', '-filter_complex_threads', '1', ...inputs,
      '-filter_complex', graph, '-map', '[vout]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p',
      '-x264-params', 'rc-lookahead=8:sync-lookahead=0:threads=2', '-movflags', '+faststart', outFile], {
      cwd: outDir, stdio: 'inherit', windowsHide: true,
    });
    return spawnStatus(c, 'ffmpeg');
  }
  // 清单是相对 outDir 的安全路径；在 outDir 下执行 ffmpeg，-safe 1 才能生效。
  const c = spawnSync(ffmpeg, ['-y', '-f', 'concat', '-safe', '1', '-i', path.basename(concatPath), '-c', 'copy', '-movflags', '+faststart', outFile], {
    cwd: outDir, stdio: 'inherit', windowsHide: true,
  });
  return spawnStatus(c, 'ffmpeg');
}

if (audioPath) {
  // R2-09（N01-F2）：master = **项目原生画幅**（spec.format），不是硬编 1920×1080。
  // 旧逻辑把竖屏项目的母版强制成横屏，QA 按 spec.format 判 size FAIL——
  // 9:16 + --platform 的项目从第一天起就出不了绿灯。母版用原生尺寸 + master
  // 预设的高码率；平台版才是派生尺寸。横屏项目原生=1920×1080，行为不变。
  const nativeW = Number(spec.format?.width) || 1920;
  const nativeH = Number(spec.format?.height) || 1080;
  let code = encode(true, master, 'master', ['--width', String(nativeW), '--height', String(nativeH)]);
  if (code !== 0) fail('concat', 'E_CONCAT', `master encode failed (exit ${code})`, { detailPath: concatPath, raw });
  if (platform && platform !== 'master') {
    const platformFile = path.join(outDir, `${platform}.mp4`);
    code = encode(true, platformFile, platform);
    if (code !== 0) fail('concat', 'E_CONCAT', `platform encode failed: ${platform} (exit ${code})`, { platform, detailPath: concatPath, raw });
    console.log(`[platform] ${platformFile}`);
  }
} else {
  const code = encode(false, master);
  if (code !== 0) fail('concat', 'E_CONCAT', `video-only concat failed (exit ${code})`, { detailPath: concatPath, raw });
  if (platform && platform !== 'master') {
    // 无音轨时用一次显式重排编码出平台版（不静默补黑边：尺寸不匹配会在这里暴露）。
    const [w, h] = PLATFORM_SIZE[platform] || [1920, 1080];
    const platformFile = path.join(outDir, `${platform}.mp4`);
    const ffmpeg = process.env.FFMPEG || 'ffmpeg';
    const c = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', master,
      '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-pix_fmt', 'yuv420p', '-an', platformFile], {
      cwd: root, stdio: 'inherit', windowsHide: true,
    });
    if (c.status !== 0) fail('concat', 'E_CONCAT', `platform encode failed: ${platform} (exit ${c.status})`, { platform, raw });
    console.log(`[platform] ${platformFile}`);
  }
}
console.log(`[master]  ${master}`);

// ── 5.5 交付资产：delivery.json + 字幕；可选把字幕烧进投放版（P1-08） ──────
const burnSubtitles = !!(args['burn-subtitles'] || spec.render?.burnSubtitles === true);
const wantCover = !!(args.cover || spec.render?.cover === true) && !args['no-cover'];
const wantDeliver = !args['no-deliver'];

// 封面（P2-02）：用 cvs image 的同一套代码出 card 版式封面，落到 <outDir>/images，
// deliver 会把它写进 delivery.json.cover —— 投放时不再需要截正片帧。
if (wantCover) {
  const img = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'image.mjs'),
    '--spec', specPath, '--root', root, '--set', 'cover',
    '--out', path.join(outDir, 'images'),
  ], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (img.status !== 0) fail('qa', 'E_COVER', `cover render failed (exit ${img.status})`, { raw });
}

function runDeliver() {
  const d = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'deliver.mjs'),
    '--spec', specPath, '--root', root, '--outdir', outDir,
  ], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (d.status !== 0) fail('qa', 'E_DELIVER', `delivery manifest failed (exit ${d.status})`, { detailPath: path.join(outDir, 'delivery.json'), raw });
}
if (wantDeliver) runDeliver();

if (burnSubtitles) {
  const srt = path.join(outDir, 'master.srt');
  if (!fs.existsSync(srt)) {
    fail('qa', 'E_SUBTITLES_MISSING', 'no master.srt to burn; run without --no-deliver (subtitles come from the plan)', { raw });
  }
  const ffmpeg = process.env.FFMPEG || 'ffmpeg';
  // 母版保持干净（软字幕），只给投放版加硬字幕。
  const targets = platform && platform !== 'master'
    ? [{ input: path.join(outDir, `${platform}.mp4`), output: path.join(outDir, `${platform}.mp4`) }]
    : [{ input: master, output: path.join(outDir, 'master-burned.mp4') }];
  const style = "FontName=Noto Sans SC,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H66000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=48";
  const burnedFiles = [];
  for (const t of targets) {
    if (!fs.existsSync(t.input)) continue;
    const tmpOut = path.join(outDir, `.burn-${process.pid}-${path.basename(t.output)}`);
    console.log(`[subs]    burning ${path.basename(srt)} -> ${path.basename(t.output)}`);
    const c = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error',
      '-i', path.basename(t.input),
      '-vf', `subtitles=master.srt:force_style='${style}'`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-maxrate', '12M', '-bufsize', '24M',
      '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart',
      path.basename(tmpOut)], { cwd: outDir, stdio: 'inherit', windowsHide: true });
    if (c.status !== 0) {
      try { fs.rmSync(tmpOut, { force: true }); } catch { /* ignore */ }
      fail('qa', 'E_BURN_SUBTITLES', `subtitle burn failed for ${path.basename(t.output)} (exit ${c.status})`, { raw });
    }
    fs.rmSync(t.output, { force: true });
    fs.renameSync(tmpOut, t.output);
    burnedFiles.push(path.basename(t.output));
    console.log(`[subs]    ${t.output}`);
  }
  // 烧字幕改变了字节：把「哪些文件带硬字幕」写进标记，delivery.json 才能如实标注；
  // 然后再跑一次 delivery，清单对应磁盘上的最终字节。
  fs.mkdirSync(path.join(outDir, '.cvs'), { recursive: true });
  fs.writeFileSync(path.join(outDir, '.cvs', 'burned.json'), JSON.stringify({
    at: new Date().toISOString(), srt: 'master.srt', files: burnedFiles,
  }, null, 2) + '\n');
  if (wantDeliver) runDeliver();
}

// ── 6. qa（视频 + 音频，**每一条交付件都过闸**） ────────────────────────────
// R2-01（N03+N07 交叉实证）：旧 QA 只测 master。实测 douyin.mp4 +2.67 dBTP /
// 0.0 dBFS 削顶出闸、runs.jsonl 仍记 qaPass:true——平台件永远裸奔的假绿。
let qaPass = true;
if (!args['no-qa']) {
  const strict = !!(args.strict || args.deliver) && !args['no-strict'];
  const qa = path.join(root, 'scripts', 'qa-video.mjs');
  const qaAudio = path.join(root, 'scripts', 'qa-audio.py');
  const py = process.env.PYTHON || 'python';

  const aliases = { wechat: 'weixin' };
  const platformSize = (p) => PLATFORM_SIZE[aliases[String(p)] || String(p)] || PLATFORM_SIZE.master;
  const targets = [{ file: master, name: 'master', w: null, h: null }];
  if (platform && platform !== 'master') {
    const pf = path.join(outDir, `${platform}.mp4`);
    if (fs.existsSync(pf)) {
      const [w, h] = platformSize(platform);
      targets.push({ file: pf, name: String(platform), w, h });
    }
  }

  for (const t of targets) {
    const qaArgs = [qa, t.file, '--plan', planPath,
      '--json', path.join(outDir, 'qa', t.name === 'master' ? 'qa-video.json' : `qa-video-${t.name}.json`)];
    if (t.w) qaArgs.push('--width', String(t.w), '--height', String(t.h), '--no-contact');
    // R2-09 配套：平台件画幅与原生不同 → letterbox/pillarbox 黑边是有意 padding，
    // 黑帧检查降为 advisory（否则横→竖平台件必被黑边误红）。
    if (t.w && t.h) {
      const nativeAR = (Number(spec.format?.width) || 1920) / (Number(spec.format?.height) || 1080);
      const platAR = t.w / t.h;
      if (Math.abs(nativeAR - platAR) > 0.01) qaArgs.push('--allow-letterbox');
    }
    if (strict) qaArgs.push('--strict');
    const q = spawnSync(process.execPath, qaArgs, { cwd: root, stdio: 'inherit', windowsHide: true });
    if (q.status !== 0) {
      qaPass = false;
      fail('qa', 'E_QA_VIDEO', `qa-video failed for ${path.basename(t.file)} (exit ${q.status}); see ${qaArgs[qaArgs.indexOf('--json') + 1]}`, { raw });
    }

    if (audioPath) {
      // 质检量的是**成片里的音轨**（过完 loudnorm 的交付流），不是未归一的合成 wav；
      // qa-audio.py 自身能吃 mp4（内部 ffmpeg 抽流），不再手写抽取命令。
      const report = path.join(outDir, 'qa', t.name === 'master' ? 'qa-audio.json' : `qa-audio-${t.name}.json`);
      const audioArgs = [qaAudio, t.file, '--plan', planPath, '--out', report,
        '--spectrogram', path.join(outDir, 'qa', t.name === 'master' ? 'spectrogram.png' : `spectrogram-${t.name}.png`)];
      if (strict) audioArgs.push('--strict');
      const qa2 = spawnSync(py, audioArgs, { cwd: root, stdio: 'inherit', windowsHide: true });
      if (qa2.status !== 0) {
        qaPass = false;
        fail('qa', 'E_QA_AUDIO', `qa-audio failed for ${path.basename(t.file)} (exit ${qa2.status}); see ${report}`, { raw });
      }
    }
  }
}

// ── 7. summary ──────────────────────────────────────────────────────────────
if (fs.existsSync(manifestPath)) {
  const m = readManifest();
  const counts = {};
  for (const v of Object.values(m.segments || {})) counts[v.status] = (counts[v.status] || 0) + 1;
  console.log(`[cache]   ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  ')}`);
}
recordRun({ phase: 'done', exit: 0, qaPass });
console.log(`[done]    ${master}`);
emitJson({
  ok: true, phase: 'done', exit: 0, qaPass: !!qaPass,
  master: path.relative(root, master).split(path.sep).join('/'),
  outDir: path.relative(root, outDir).split(path.sep).join('/'),
  platform: platform || null,
  specHash: ctx.specHash,
  segments: plan.stats.segments, frames: plan.stats.frames, duration: plan.stats.duration,
  durationMs: Date.now() - STARTED,
});
