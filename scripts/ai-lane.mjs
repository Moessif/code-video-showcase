#!/usr/bin/env node
/**
 * ai-lane.mjs — optional, gated AI asset lane. The core film stays pure-code:
 * nothing here downloads a model or generates a frame. It only manages the
 * contract between optional model output and the deterministic timeline.
 *
 *   node scripts/ai-lane.mjs init
 *   node scripts/ai-lane.mjs manifest
 *   node scripts/ai-lane.mjs validate --plan out/plan.json
 *   node scripts/ai-lane.mjs overlay --clip assets/ai/broll-r01.mp4 --from 9 --to 11
 *   node scripts/ai-lane.mjs cache-key --spec ai/prompts/broll-02.yaml
 *
 * Rules baked in (see references/ai-lane.md):
 *   • lane.enabled=false by default; missing/invalid assets fall back to pure code
 *   • every asset is addressed by sha256(prompt|model|version|seed|steps|size)
 *   • an overlay must be 1920×1080 (or scalable), ≥ the target range, and is
 *     re-timed to the timeline, never allowed to change frame counts
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (!next || next.startsWith('--')) args[a.slice(2)] = true;
  else { args[a.slice(2)] = next; i++; }
}
const str = (k, d) => (args[k] === undefined ? d : String(args[k]));
const num = (k, d) => (args[k] === undefined ? d : Number(args[k]));
const LANE_DIR = path.resolve(str('dir', 'ai'));
const LANE = path.resolve(str('lane', path.join(LANE_DIR, 'lane.json')));
const cmd = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : (args._ || '');
const ffprobe = process.env.FFPROBE || 'ffprobe';

const DEFAULT_LANE = {
  version: 1,
  enabled: false,
  seed: 1200,
  models: {
    broll: 'wan2.2-ti2v-5b',
    firstLast: 'wan2.1-flf2v-14b',
    interp: 'rife4',
    upscale: 'realesrgan-x4',
    tts: 'cosyvoice2-0.5b',
    music: 'ace-step-1.5',
  },
  cacheDir: 'ai/cache',
  assetsDir: 'assets/ai',
  overlays: [],
  fallback: 'pure-code',
};

function usage() {
  console.log(`Usage: node scripts/ai-lane.mjs <command> [options]

  init                 write ai/lane.json + ai/prompts/broll.example.yaml + ai/README.md
  manifest             hash + probe every clip under ai/cache and assets/ai
  validate             check lane.json overlays against out/plan.json
  overlay --clip <f> --from <sec> --to <sec> [--out <f>] [--mode overlay|replace]
  cache-key --spec <file>   sha256 cache key for a prompt spec

Options: --dir <ai> --lane <ai/lane.json> --plan <out/plan.json>`);
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function probe(file) {
  const r = spawnSync(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const j = JSON.parse(r.stdout);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  if (!v) return null;
  return {
    width: Number(v.width), height: Number(v.height), fps: v.r_frame_rate,
    codec: v.codec_name, duration: Number(j.format?.duration || v.duration || 0),
    hasAlpha: /ya?uv|rgba|argb/.test(`${v.pix_fmt || ''}`),
  };
}

function readLane() {
  if (!fs.existsSync(LANE)) return { ...DEFAULT_LANE, overlays: [] };
  return { ...DEFAULT_LANE, ...JSON.parse(fs.readFileSync(LANE, 'utf8')) };
}

function init() {
  fs.mkdirSync(path.join(LANE_DIR, 'prompts'), { recursive: true });
  if (!fs.existsSync(LANE)) fs.writeFileSync(LANE, JSON.stringify(DEFAULT_LANE, null, 2));
  const prompt = `# ai/prompts/broll.example.yaml
# Consumed by your own generator wrapper (Wan / LTX / ComfyUI). This skill never
# calls a model itself; it only validates and times the output.
id: broll-r01
model: wan2.2-ti2v-5b
seed: 1200
steps: 30
size: [1280, 720]
duration: 5
prompt: >
  abstract paper-cut mountains, warm coral sun, slow parallax, no text, no logo,
  flat art direction matching a 120 BPM title sequence
negative: text, watermark, logo, photorealistic faces
post: [rife4, realesrgan-x4]
`;
  if (!fs.existsSync(path.join(LANE_DIR, 'prompts/broll.example.yaml'))) {
    fs.writeFileSync(path.join(LANE_DIR, 'prompts/broll.example.yaml'), prompt);
  }
  fs.writeFileSync(path.join(LANE_DIR, 'README.md'), `# AI lane (optional)

This directory is inert by default (\`enabled: false\`). The film is rendered by
pure code; assets produced by local models are optional overlays.

1. Generate clips with your own pipeline and write them to \`assets/ai/\`.
2. Add an overlay entry to \`lane.json\` (segment id, clip, at, duration).
3. \`node scripts/ai-lane.mjs validate --plan out/plan.json\`
4. \`node scripts/ai-lane.mjs overlay --clip ... --from ... --to ...\`

A missing clip, a probe failure, a resolution/fps mismatch or \`enabled: false\`
always falls back to the pure-code segment. Never let an AI clip change the
timeline frame count.
`);
  console.log(`✓ ai lane initialised at ${LANE_DIR}`);
}

function manifest() {
  const lane = readLane();
  const roots = [path.resolve(lane.cacheDir || 'ai/cache'), path.resolve(lane.assetsDir || 'assets/ai')];
  const items = [];
  for (const dir of roots) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!/\.(mp4|mov|webm|mkv|wav|mp3|flac|png|jpg|webp)$/i.test(f)) continue;
      const full = path.join(dir, f);
      const st = fs.statSync(full);
      const meta = /\.(mp4|mov|webm|mkv)$/i.test(f) ? probe(full) : null;
      items.push({ file: path.relative(process.cwd(), full).replace(/\\/g, '/'), bytes: st.size, sha256: sha256File(full), ...(meta ? { media: meta } : {}) });
    }
  }
  const out = path.join(LANE_DIR, 'manifest.json');
  fs.mkdirSync(LANE_DIR, { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2));
  console.log(`✓ ${items.length} asset(s) -> ${out}`);
}

function loadPlan() {
  const p = path.resolve(str('plan', 'out/plan.json'));
  if (!fs.existsSync(p)) throw new Error(`plan not found: ${p} (run timeline.mjs first)`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function validate() {
  const lane = readLane();
  const plan = loadPlan();
  const segs = new Map(plan.segments.map((s) => [s.id, s]));
  const errors = [];
  const warnings = [];
  if (!lane.enabled) warnings.push('lane.enabled=false — every AI overlay will be skipped');
  for (const [i, o] of (lane.overlays || []).entries()) {
    const tag = `overlays[${i}]`;
    if (!o.segment || !segs.has(o.segment)) errors.push(`${tag}: unknown segment "${o.segment}"`);
    if (!o.clip) { errors.push(`${tag}: missing clip`); continue; }
    const clip = path.resolve(o.clip);
    if (!fs.existsSync(clip)) { errors.push(`${tag}: missing file ${o.clip}`); continue; }
    const m = probe(clip);
    if (!m) { errors.push(`${tag}: ffprobe failed on ${o.clip}`); continue; }
    const s = segs.get(o.segment);
    const at = Number(o.at ?? 0);
    if (s && (at < -0.001 || at > s.duration + 0.001)) errors.push(`${tag}: at=${at} outside segment [0,${s.duration}]`);
    if (m.width < 640 || m.height < 360) warnings.push(`${tag}: low resolution ${m.width}x${m.height}`);
    if (!/^(30|60|24|25)\/(1|1001)$/.test(m.fps)) warnings.push(`${tag}: unusual fps ${m.fps}`);
    if (m.duration < (o.duration || s?.duration || 0) - 0.01) warnings.push(`${tag}: clip ${m.duration.toFixed(2)}s shorter than overlay ${o.duration}`);
    if (m.codec !== 'h264') warnings.push(`${tag}: codec ${m.codec}; re-encode to h264/yuv420p before concat`);
  }
  for (const w of warnings) console.log(`[warn] ${w}`);
  for (const e of errors) console.error(`[error] ${e}`);
  console.log(errors.length ? `✗ ${errors.length} error(s)` : `✓ ${lane.overlays?.length || 0} overlay(s) valid`);
  if (errors.length) process.exit(1);
}

function overlay() {
  const clip = path.resolve(str('clip', ''));
  if (!str('clip', '')) { console.error('--clip is required'); process.exit(1); }
  if (!fs.existsSync(clip)) { console.error(`missing clip: ${clip}`); process.exit(1); }
  const m = probe(clip);
  if (!m) { console.error('ffprobe failed'); process.exit(1); }
  const from = num('from', 0);
  const to = num('to', from + Math.min(3, m.duration));
  const mode = str('mode', 'overlay');
  const out = str('out', path.join('out', `ai-${path.basename(clip, path.extname(clip))}.mp4`));
  const seg = str('segment', 'out/segment.mp4');
  const W = num('width', 1920), H = num('height', 1080);
  if (mode === 'replace') {
    console.log(`ffmpeg -y -i "${seg}" -i "${clip}" -map 1:v -map 0:a? -t ${(to - from).toFixed(3)} -r 30 -c:v libx264 -crf 12 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -c:a copy "${out}"`);
    return;
  }
  const dur = (to - from).toFixed(3);
  const chain = `[1:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[b];[0:v][b]overlay=0:0:enable='between(t,${from},${to})'[v]`;
  console.log(`ffmpeg -y -i "${seg}" -i "${clip}" -filter_complex "${chain}" -map "[v]" -map 0:a? -t ${dur} -c:v libx264 -crf 12 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -c:a copy "${out}"`);
  if (m.width !== W || m.height !== H) console.error(`[warn] clip is ${m.width}x${m.height}; it will be letterboxed to ${W}x${H}`);
}

function cacheKey() {
  const spec = path.resolve(str('spec', ''));
  if (!fs.existsSync(spec)) { console.error(`missing spec: ${spec}`); process.exit(1); }
  const text = fs.readFileSync(spec, 'utf8');
  console.log(crypto.createHash('sha256').update(text).digest('hex'));
}

switch (cmd) {
  case 'init': init(); break;
  case 'manifest': manifest(); break;
  case 'validate': validate(); break;
  case 'overlay': overlay(); break;
  case 'cache-key': cacheKey(); break;
  default: usage(); process.exit(cmd ? 1 : 0);
}
