#!/usr/bin/env node
/**
 * deliver.mjs — 交付清单：把「平台 → 文件 → 封面 → 标题」整理成机器可读的一份表。
 *
 *   node scripts/deliver.mjs --spec project.spec.json
 *   node scripts/deliver.mjs --spec spec.json --outdir out/demo --json
 *
 * 产物（写在 outDir）：
 *   delivery.json  每行 { platform, file, bytes, sha256, duration, cover, title, cta, specHash }
 *   master.srt     从 plan 的 card/opening/ending 段生成的字幕（静音投放可直接用）
 *   master.vtt     同内容的 WebVTT
 *
 * 为什么需要：一天 3 个尺寸 2 个版本，最后对着 6 个 mp4 和 6 张封面猜哪个是抖音，
 * 还要手填标题——错发版本属于对外事故。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

function parse(argv) {
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

const args = parse(process.argv.slice(2));
if (args.help || !args.spec) {
  console.log(`Usage: node scripts/deliver.mjs --spec <spec> [options]
  --outdir <dir>   output dir (default spec.render.outDir)
  --root <dir>     project root (default cwd)
  --out <file>     delivery.json path (default <outDir>/delivery.json)
  --cover <file>   explicit cover image (default: image-manifest cover, then <outDir>/cover.png)
  --no-subs        skip master.srt / master.vtt
  --json           print the manifest to stdout`);
  process.exit(args.help ? 0 : 2);
}

const root = path.resolve(String(args.root || process.cwd()));
const specPath = path.resolve(String(args.spec));
let spec;
try { spec = JSON.parse(fs.readFileSync(specPath, 'utf8')); }
catch (e) { console.error(`[error] [E_JSON] ${specPath}: ${e.message}`); process.exit(10); }

const outDir = path.resolve(root, String(args.outdir || spec.render?.outDir || 'out'));
const planPath = path.join(outDir, 'plan.json');
let plan = null;
try { plan = JSON.parse(fs.readFileSync(planPath, 'utf8')); } catch { /* plan 可选 */ }

// master-burned = --burn-subtitles 且没有平台版时的硬字幕母版（v2.4 / P1-08）。
const PLATFORMS = ['master', 'master-burned', 'bilibili', 'youtube', 'douyin', 'xiaohongshu', 'weixin', 'wechat', 'square'];
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const bytes = (file) => fs.statSync(file).size;

function probeDuration(file) {
  try {
    const r = spawnSync(process.env.FFPROBE || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
    const n = Number(String(r.stdout).trim());
    return Number.isFinite(n) && n > 0 ? Number(n.toFixed(3)) : null;
  } catch { return null; }
}

function readImageManifest() {
  // 依次找：本次 outDir、outDir/images、仓库根 out/images（cvs image 的默认落点）。
  const candidates = [
    path.join(outDir, 'image-manifest.json'),
    path.join(outDir, 'images', 'image-manifest.json'),
    path.join(root, 'out', 'images', 'image-manifest.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* ignore */ }
    }
  }
  return null;
}

const imageManifest = readImageManifest();
const resolveAsset = (p) => {
  if (!p) return null;
  if (path.isAbsolute(p)) return p;
  const fromRoot = path.resolve(root, p);
  if (fs.existsSync(fromRoot)) return fromRoot;
  const fromOut = path.resolve(outDir, p);
  return fs.existsSync(fromOut) ? fromOut : fromRoot;
};
const coverFromImages = () => {
  if (args.cover) return resolveAsset(String(args.cover));
  const rows = imageManifest?.images || imageManifest?.items || imageManifest?.files || [];
  const cover = rows.find((r) => String(r.kind || r.set || r.preset || '').includes('cover')) || rows[0];
  const fromManifest = cover ? resolveAsset(cover.file || cover.path || '') : null;
  if (fromManifest && fs.existsSync(fromManifest)) return fromManifest;
  const local = path.join(outDir, 'cover.png');
  return fs.existsSync(local) ? local : null;
};

const title = String(spec.meta?.title || spec.meta?.name || '').trim();
const cta = String(spec.meta?.cta || '').trim();
const coverFile = coverFromImages();

// 硬字幕标记（compile --burn-subtitles 写 .cvs/burned.json）：清单要如实说明
// 哪些文件带烧录字幕，否则「同一个 master 两个字节」会被当成事故。
let burnedMeta = { files: [] };
try {
  burnedMeta = JSON.parse(fs.readFileSync(path.join(outDir, '.cvs', 'burned.json'), 'utf8'));
} catch { /* 没烧字幕 */ }
const burnedSet = new Set((burnedMeta.files || []).map((f) => String(f)));

const rows = [];
for (const platform of PLATFORMS) {
  const file = path.join(outDir, `${platform}.mp4`);
  if (!fs.existsSync(file)) continue;
  const hasBurnedSubs = platform === 'master-burned' || burnedSet.has(path.basename(file));
  rows.push({
    platform: platform === 'wechat' ? 'weixin' : platform,
    file: path.relative(root, file).split(path.sep).join('/'),
    bytes: bytes(file),
    sha256: sha256(file),
    duration: probeDuration(file) ?? plan?.stats?.duration ?? null,
    cover: coverFile ? path.relative(root, coverFile).split(path.sep).join('/') : null,
    title,
    cta,
    subtitles: hasBurnedSubs ? 'master.srt' : null,
    burned: hasBurnedSubs,
  });
}

if (!rows.length) {
  console.error(`[error] [E_NO_OUTPUT] no master.mp4 or platform mp4 in ${outDir}`);
  process.exit(13);
}

// ── 字幕（从 plan 的 card / opening / ending 段生成） ────────────────────────
function srtTime(t) {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`;
}
function vttTime(t) {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}

function captionRows() {
  if (!plan || !Array.isArray(plan.segments)) return [];
  const out = [];
  const copy = plan.spec?.copy || {};
  for (const s of plan.segments) {
    let text = '';
    if (s.kind === 'card' && s.card) text = [s.card.first, s.card.keyword].filter(Boolean).join(' ');
    else if (s.kind === 'opening') text = copy.title || title;
    else if (s.kind === 'ending') text = copy.cta || copy.sub || copy.title || title;
    else if (s.kind === 'style' && s.copy) text = s.copy.title || '';
    if (!text) continue;
    out.push({ start: s.start, end: s.end, text: String(text).trim() });
  }
  return out;
}

let captionCount = 0;
if (!args['no-subs']) {
  const rowsS = captionRows();
  if (rowsS.length) {
    const srt = rowsS.map((r, i) => `${i + 1}\n${srtTime(r.start)} --> ${srtTime(r.end)}\n${r.text}\n`).join('\n');
    fs.writeFileSync(path.join(outDir, 'master.srt'), srt);
    const vtt = `WEBVTT\n\n${rowsS.map((r) => `${vttTime(r.start)} --> ${vttTime(r.end)}\n${r.text}`).join('\n\n')}\n`;
    fs.writeFileSync(path.join(outDir, 'master.vtt'), vtt);
    captionCount = rowsS.length;
    console.log(`[subs]    master.srt / master.vtt · ${rowsS.length} cue(s)`);
  }
}

const relOrNull = (p) => (p ? path.relative(root, p).split(path.sep).join('/') : null);

const manifest = {
  generatedAt: new Date().toISOString(),
  spec: path.relative(root, specPath).split(path.sep).join('/'),
  specHash: crypto.createHash('sha256').update(JSON.stringify(spec)).digest('hex').slice(0, 12),
  title,
  cta,
  cover: relOrNull(coverFile),
  subtitles: {
    srt: fs.existsSync(path.join(outDir, 'master.srt')) ? relOrNull(path.join(outDir, 'master.srt')) : null,
    vtt: fs.existsSync(path.join(outDir, 'master.vtt')) ? relOrNull(path.join(outDir, 'master.vtt')) : null,
    cues: captionCount,
    burnedInto: rows.filter((r) => burnedSet.has(path.basename(r.file))).map((r) => r.file),
  },
  rows,
};
const outPath = path.resolve(String(args.out || path.join(outDir, 'delivery.json')));
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
if (args.json) console.log(JSON.stringify(manifest, null, 2));
console.log(`[deliver] ${rows.length} file(s) -> ${outPath}`);
