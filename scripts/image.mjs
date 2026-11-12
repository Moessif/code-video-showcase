#!/usr/bin/env node
/**
 * image.mjs — 从同一个 spec 出一套**图片**（封面 / 方图 / 海报 / 竖屏），v2.3.2。
 *
 * 背景：渲染管线本来就是「代码逐帧画 → Chrome → PNG/JPEG」，所以"代码生图"
 * 技术上早就通了（`render-segment.mjs --still`、golden 回归都在用）。缺的是
 * **产品入口**：没有命令、没有成套的社媒尺寸、没有清单。这个脚本补上。
 *
 *   node scripts/image.mjs --spec project.spec.json                 # cover/card/poster/story
 *   node scripts/image.mjs --spec project.spec.json --set cover,card --at 2.4
 *   node scripts/image.mjs --spec project.spec.json --from r02-style --out out/stills
 *   node scripts/image.mjs --page templates/recipe-guofeng.html --theme celadon-paper --set poster
 *
 * 关键点：
 *   • 用的是 **plan 里那条段的 URL**，所以 theme / ?mp= / ?accent= 与成片完全一致
 *     ——图和视频是同一个画面，不会两套配色。
 *   • 一个浏览器渲完所有尺寸（withRenderer + ctx.stills），不是每个尺寸起一次 Chrome。
 *   • 输出 image-manifest.json（尺寸、页面 URL、帧时间、sha256、字节数），
 *     可直接做资产清单或缓存键。
 *   • 确定性：同一 spec + 同一 --at + 同一尺寸 → 同一 sha256（同 t 必出同帧）。
 *
 *   --spec <f>        spec.json（与 build 同一个文件）
 *   --from <segId>    指定段（默认取第一条 style 段）
 *   --kind <k>        没有 --from 时按段类型挑：style(默认)|card|opening|ending|more
 *   --page <p>        不走 spec：直接给页面（可带 ?theme=…&mp=…）
 *   --theme <id>      --page 模式下追加 ?theme=
 *   --at <t|auto>     帧时间（秒，页面本地时间）。auto=段落时长的 0.78（画面已稳）
 *   --set <a,b,c>     尺寸预设，默认 cover,card,poster,story
 *   --out <dir>       输出目录，默认 out/images
 *   --format png|jpeg 默认 png
 *   --quality <n>     jpeg 质量，默认 92
 *   --root <dir>      项目根，默认 cwd
 *   --list            只列出预设，不渲染
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { withRenderer } from '../templates/render-segment.mjs';
import { buildPlanFromSpec } from '../templates/plan.mjs';

// ── 尺寸预设 ────────────────────────────────────────────────────────────────
export const PRESETS = {
  cover:  { width: 1920, height: 1080, note: '16:9 视频封面 / 缩略图' },
  wide:   { width: 2560, height: 1080, note: '21:9 横幅 / 头图' },
  card:   { width: 1080, height: 1080, note: '1:1 方图 / 朋友圈 · IG' },
  poster: { width: 1080, height: 1350, note: '4:5 海报 / 小红书 · 微博' },
  story:  { width: 1080, height: 1920, note: '9:16 竖屏 / Story · 短视频封面' },
  avatar: { width: 800, height: 800, note: '1:1 小图 / 头像 · 角标' },
};
export const DEFAULT_SET = ['cover', 'card', 'poster', 'story'];

// 画面"稳下来"的时刻：段落 78% 处；太快是入场动画（缩放/白闪），太晚有些页会收尾。
const HERO_FRACTION = 0.78;
const MIN_BYTES = 8 * 1024;   // 低于此值基本是空帧（纯色 1080p PNG 约 3–12 KB）

/** hero 帧时间：clamp(0.78 * duration)，并留 0.05s 余量不到片尾。 */
export function heroTime(duration) {
  const d = Number(duration);
  if (!Number.isFinite(d) || d <= 0) return 1.0;
  return Number(Math.min(Math.max(HERO_FRACTION * d, 0.2), Math.max(d - 0.05, 0.2)).toFixed(3));
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const k = a.slice(2);
    if (k === 'help' || k === 'list') { out[k] = true; continue; }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) { out[k] = true; continue; }
    out[k] = v; i++;
  }
  return out;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const toPosix = (p) => p.split(path.sep).join('/');

function pickSegment(plan, args) {
  const segs = plan.segments || [];
  if (args.from) {
    const s = segs.find((x) => x.id === args.from);
    if (!s) throw new Error(`--from ${args.from}: no such segment (have: ${segs.map((x) => x.id).join(', ')})`);
    return s;
  }
  const kind = typeof args.kind === 'string' ? args.kind : 'style';
  const s = segs.find((x) => x.kind === kind);
  if (!s) throw new Error(`--kind ${kind}: no such segment kind (have: ${[...new Set(segs.map((x) => x.kind))].join(', ')})`);
  return s;
}

/** 页面 URL：优先用 plan 里的（带 theme/mp/accent/recipe），--page 模式下自行拼。 */
function resolvePage(plan, args) {
  if (args.page) {
    let page = String(args.page);
    const extra = [];
    if (args.theme && !/[?&]theme=/.test(page)) extra.push(`theme=${encodeURIComponent(String(args.theme))}`);
    if (args.mp && !/[?&]mp=/.test(page)) extra.push(`mp=${encodeURIComponent(String(args.mp))}`);
    if (extra.length) page += (page.includes('?') ? '&' : '?') + extra.join('&');
    return { page, segment: null, duration: Number(args.duration) || 4 };
  }
  const seg = pickSegment(plan, args);
  return { page: seg.page, segment: seg, duration: Number(seg.duration) || Number(seg.frames) / Number(plan.stats?.fps || 30) || 4 };
}

function listPresets() {
  console.log('尺寸预设：');
  for (const [k, v] of Object.entries(PRESETS)) {
    console.log(`  ${k.padEnd(7)} ${String(v.width).padStart(4)}×${String(v.height).padEnd(5)} ${v.note}`);
  }
  console.log(`\n默认集: ${DEFAULT_SET.join(',')}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list || args.help) { listPresets(); process.exit(0); }

  const root = path.resolve(String(args.root || process.cwd()));
  const outDir = path.resolve(String(args.out || path.join(root, 'out', 'images')));
  const format = String(args.format || 'png').toLowerCase();
  if (!['png', 'jpeg', 'jpg'].includes(format)) throw new Error(`--format must be png|jpeg, got ${format}`);
  const ext = format === 'png' ? 'png' : 'jpg';
  const quality = Number(args.quality) || 92;

  const set = args.set
    ? String(args.set).split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_SET.slice();
  for (const k of set) {
    if (!PRESETS[k]) throw new Error(`unknown preset "${k}" (see --list; have: ${Object.keys(PRESETS).join(', ')})`);
  }

  // ── 解析来源：spec（推荐）或裸页面 ───────────────────────────────────────
  let source;
  if (args.spec) {
    const specPath = path.resolve(root, String(args.spec));
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    const { plan } = buildPlanFromSpec(spec, { root });
    source = { ...resolvePage(plan, args), spec, specPath, plan };
    console.log(`[image] spec   ${toPosix(path.relative(root, specPath))}`);
    console.log(`[image] theme  ${plan.meta.theme}${plan.meta.motion ? `  mp=${plan.meta.motion}` : ''}${plan.meta.accent ? `  accent=${plan.meta.accent.accent || plan.meta.accent.accentInk}` : ''}`);
  } else if (args.page) {
    source = { ...resolvePage(null, args), spec: null, specPath: null, plan: null };
    console.log(`[image] page   ${String(args.page)}`);
  } else {
    throw new Error('need --spec <file> (recommended) or --page <html>; see --help');
  }

  const at = args.at === undefined || args.at === 'auto' ? heroTime(source.duration) : Number(args.at);
  if (!Number.isFinite(at) || at < 0) throw new Error(`--at must be a non-negative number or "auto", got ${args.at}`);

  if (source.segment) {
    console.log(`[image] segment ${source.segment.id} (${source.segment.kind})  dur=${source.segment.duration}s  at=${at}s`);
  } else {
    console.log(`[image] at=${at}s`);
  }
  console.log(`[image] set    ${set.join(',')}  ->  ${toPosix(path.relative(root, outDir))}\n`);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const results = [];
  const t0 = Date.now();

  // 一个服务器 + 一个浏览器渲完所有尺寸；某个尺寸炸了就 restart 再试一次。
  await withRenderer(
    { root, width: PRESETS[set[0]].width, height: PRESETS[set[0]].height, quiet: true },
    async (ctx) => {
      for (const name of set) {
        const ps = PRESETS[name];
        const dir = path.join(outDir, name);
        const shot = async () => ctx.stills({
          page: source.page,
          stills: [at],
          outdir: dir,
          width: ps.width,
          height: ps.height,
          duration: source.duration,
          t0: source.segment?.t0 ?? 0,
          speed: source.segment?.speed ?? 1,
          format,
          quality,
        });

        let res;
        try {
          res = await shot();
        } catch (e) {
          console.log(`  (${name} failed: ${String(e.message || e).split('\n')[0]}; restarting browser)`);
          await ctx.restart();
          fs.rmSync(dir, { recursive: true, force: true });
          res = await shot();
        }

        // 把 still-<t>.png 规范化成 <preset>.<ext>
        const produced = fs.readdirSync(dir).filter((f) => f.startsWith('still-'));
        if (produced.length !== 1) throw new Error(`${name}: expected 1 still, got ${JSON.stringify(produced)}`);
        const finalName = `${name}.${ext}`;
        const finalPath = path.join(dir, finalName);
        fs.rmSync(finalPath, { force: true });
        fs.renameSync(path.join(dir, produced[0]), finalPath);

        const buf = fs.readFileSync(finalPath);
        const hash = sha256(buf);
        results.push({
          preset: name,
          width: ps.width,
          height: ps.height,
          note: ps.note,
          file: toPosix(path.relative(root, finalPath)),
          bytes: buf.length,
          sha256: hash,
        });
        const warn = buf.length < MIN_BYTES ? '  ⚠ 疑似空帧' : '';
        console.log(`  ✓ ${name.padEnd(7)} ${String(ps.width).padStart(4)}×${String(ps.height).padEnd(5)} ${(buf.length / 1024).toFixed(1).padStart(7)} KB  ${hash.slice(0, 12)}${warn}`);
        void res;
      }
    },
  );

  const manifest = {
    version: 1,
    generatedBy: 'scripts/image.mjs',
    at,
    format: ext,
    quality: format === 'png' ? null : quality,
    page: source.page,
    segment: source.segment ? source.segment.id : null,
    segmentKind: source.segment ? source.segment.kind : null,
    segmentHash: source.segment ? source.segment.hash : null,
    theme: source.plan ? source.plan.meta.theme : (args.theme || null),
    motion: source.plan ? (source.plan.meta.motion || null) : (args.mp || null),
    accent: source.plan ? (source.plan.meta.accent || null) : null,
    spec: source.specPath ? toPosix(path.relative(root, source.specPath)) : null,
    images: results,
  };
  const manifestPath = path.join(outDir, 'image-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const small = results.filter((r) => r.bytes < MIN_BYTES);
  console.log(`\n[image] ${results.length} 张 -> ${toPosix(path.relative(root, outDir))}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.log(`[image] 清单 ${toPosix(path.relative(root, manifestPath))}`);
  if (small.length) {
    console.error(`[image] ${small.length} 张低于 ${MIN_BYTES / 1024} KB，可能是空帧: ${small.map((r) => r.preset).join(', ')}`);
    process.exit(1);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((e) => {
    console.error(`[image] ${(e && e.message) || e}`);
    process.exit(1);
  });
}
