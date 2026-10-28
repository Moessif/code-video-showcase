#!/usr/bin/env node
/**
 * theme-preview.mjs — 为 code-video-showcase 的主题系统生成静态预览图。
 *
 * 产物（默认写到 <skill>/assets/theme-previews/）：
 *   01-coral-noir.jpg … 08-crimson-theater.jpg   1920×1080 主题海报 + 规格板
 *   theme-contact-sheet.jpg                      8 套 4×2 联系表（1920×1080）
 *   theme-three-up.jpg                           原版 / 橙光白 / 水蓝白 三拼（1920×1080）
 *
 * 用法（在 WSL 里，先让 Chrome 进 PATH）：
 *   cd /mnt/e/0workspace/dshd/remotion && source tools/env.sh >/dev/null 2>&1
 *   node /mnt/e/0workspace/dshd/code-video-showcase/scripts/theme-preview.mjs \
 *     --root /mnt/e/0workspace/dshd/remotion
 *
 * 选项：
 *   --root <dir>      remotion 渲染根（含 render-segment.mjs / shared/fonts.css），默认取 $THEME_RENDER_ROOT
 *   --themes a,b      只渲染指定主题（子集不生成两张拼版）
 *   --out <dir>       输出目录，默认 <skill>/assets/theme-previews
 *   --no-sheet        不生成联系表 / 三拼
 *   --quality <n>     JPEG 质量，默认 95
 *   --keep            保留 <root>/.theme-preview-tmp 与中间 stills，便于排查
 *   --list            只列出 8 套主题 id / 名称
 *
 * 依赖：node（内置模块）+ <root>/render-segment.mjs（Playwright/Chrome 由它自己找）。
 * 本脚本不新增任何 npm 依赖，也不直接调用 ffmpeg。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(HERE, '..');
const TEMPLATES = path.join(SKILL_ROOT, 'templates');
const DEFAULT_OUT = path.join(SKILL_ROOT, 'assets', 'theme-previews');
const TMP_NAME = '.theme-preview-tmp';
const STILL_T = 0.4;
const STILL_NAME = `still-${STILL_T.toFixed(2).replace('.', '_')}.jpg`;

/* ---------- 参数 ---------- */
function parseArgs(argv) {
  const out = { themes: null, out: DEFAULT_OUT, sheet: true, quality: 95, keep: false, list: false, root: process.env.THEME_RENDER_ROOT || null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined || String(v).startsWith('--')) throw new Error(`缺少参数值：${a}`);
      return v;
    };
    if (a === '--root') out.root = next();
    else if (a === '--out') out.out = path.resolve(next());
    else if (a === '--themes') out.themes = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--quality') out.quality = Number(next());
    else if (a === '--no-sheet') out.sheet = false;
    else if (a === '--keep') out.keep = true;
    else if (a === '--list') out.list = true;
    else if (a === '-h' || a === '--help') out.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!(out.quality >= 50 && out.quality <= 100)) throw new Error('--quality 需要在 50–100 之间');
  return out;
}

function usage() {
  return [
    '用法: node scripts/theme-preview.mjs --root <remotion-root> [options]',
    '',
    '  --root <dir>    remotion 渲染根（必需，或设 $THEME_RENDER_ROOT）',
    '  --themes a,b    只渲染指定主题（子集不生成拼版）',
    '  --out <dir>     输出目录（默认 assets/theme-previews）',
    '  --no-sheet      不生成联系表 / 三拼',
    '  --quality <n>   JPEG 质量，默认 95',
    '  --keep          保留 <root>/.theme-preview-tmp 与中间 stills',
    '  --list          列出主题 id / 名称',
  ].join('\n');
}

/* ---------- 主题元数据（直接读 templates/themes.js，保证名字/顺序单一来源） ---------- */
async function loadThemes() {
  const mod = await import(pathToFileURL(path.join(TEMPLATES, 'themes.js')).href);
  return { THEMES: mod.THEMES, THEME_IDS: mod.THEME_IDS };
}

/* ---------- 小工具 ---------- */
const log = (...a) => console.log(...a);

function fmtKB(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function run(cmd, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => reject(new Error(`无法启动 ${cmd}: ${err.message}`)));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function renderStill({ root, page, outdir, quality }) {
  const renderer = path.join(root, 'render-segment.mjs');
  const args = [renderer, '--page', page, '--still', String(STILL_T), '--outdir', outdir, '--duration', '1', '--quality', String(quality)];
  const { code, stdout, stderr } = await run(process.execPath, args, root, { ...process.env });
  if (code !== 0) {
    const tail = (stderr || stdout).trim().split('\n').slice(-14).join('\n');
    throw new Error(`render-segment.mjs 退出码 ${code}\n${tail}`);
  }
  const still = path.join(outdir, STILL_NAME);
  if (!(await exists(still))) {
    throw new Error(`渲染器没有产出 ${STILL_NAME}（${outdir}）：\n${(stderr || stdout).trim().split('\n').slice(-8).join('\n')}`);
  }
  return still;
}

/* ---------- 主流程 ---------- */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { log(usage()); return; }

  const { THEMES, THEME_IDS } = await loadThemes();

  if (args.list) {
    THEME_IDS.forEach((id, i) => log(`${String(i + 1).padStart(2, '0')}  ${id.padEnd(16)} ${THEMES[id].name}  ${THEMES[id].nameEn}`));
    return;
  }

  if (!args.root) throw new Error(`缺少 --root（remotion 渲染根）。\n\n${usage()}`);
  const root = path.resolve(args.root);
  const outDir = args.out;

  // 目标主题
  const ids = args.themes && args.themes.length ? args.themes : THEME_IDS.slice();
  const unknown = ids.filter((id) => !THEMES[id]);
  if (unknown.length) throw new Error(`未知主题 id: ${unknown.join(', ')}\n可用: ${THEME_IDS.join(', ')}`);
  const fullSet = ids.length === THEME_IDS.length && THEME_IDS.every((id) => ids.includes(id));
  const wantSheet = args.sheet && fullSet;

  // 环境检查
  const renderer = path.join(root, 'render-segment.mjs');
  if (!(await exists(renderer))) throw new Error(`找不到渲染器：${renderer}\n--root 应指向 remotion 根目录（含 render-segment.mjs / shared/）。`);
  const boardSrc = path.join(TEMPLATES, 'theme-board.html');
  const themesSrc = path.join(TEMPLATES, 'themes.js');
  const sheetSrc = path.join(TEMPLATES, 'theme-sheet.html');
  for (const f of [boardSrc, themesSrc]) {
    if (!(await exists(f))) throw new Error(`缺少模板：${f}`);
  }
  if (wantSheet && !(await exists(sheetSrc))) throw new Error(`缺少模板：${sheetSrc}`);

  const fontsCss = path.join(root, 'shared', 'fonts.css');
  if (!(await exists(fontsCss))) {
    log(`[warn] 没有 ${fontsCss}，页面字体可能回退；请确认 --root 正确。`);
  }
  if (!process.env.CHROME_EXE) {
    log('[info] 未设置 CHROME_EXE；render-segment.mjs 会自己找 Chrome（建议先 source tools/env.sh）。');
  }

  const tmp = path.join(root, TMP_NAME);
  const raw = path.join(root, 'out', 'theme-preview-raw');
  await fs.mkdir(path.join(tmp, 'thumbs'), { recursive: true });
  await fs.mkdir(raw, { recursive: true });
  await fs.mkdir(outDir, { recursive: true });

  // 页面 + 主题定义拷进渲染根（静态服务器以 --root 为根）
  await fs.copyFile(boardSrc, path.join(tmp, 'theme-board.html'));
  await fs.copyFile(themesSrc, path.join(tmp, 'themes.js'));
  if (wantSheet) await fs.copyFile(sheetSrc, path.join(tmp, 'theme-sheet.html'));

  log(`[root] ${root}`);
  log(`[out ] ${outDir}`);
  log(`[themes] ${ids.length} 套${fullSet ? '' : '（子集，跳过拼版）'}`);

  const results = [];
  let failed = 0;

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const th = THEMES[id];
    const label = `[${i + 1}/${ids.length}] ${id}`;
    const themeOutdir = path.join(raw, id);
    const page = `${TMP_NAME}/theme-board.html?theme=${encodeURIComponent(id)}`;
    try {
      const still = await renderStill({ root, page, outdir: themeOutdir, quality: args.quality });
      const num = String(THEME_IDS.indexOf(id) + 1).padStart(2, '0');
      const dest = path.join(outDir, `${num}-${id}.jpg`);
      await fs.copyFile(still, dest);
      const bytes = (await fs.stat(dest)).size;
      results.push({ dest, bytes, id, num });
      log(`${label}  ${th.name}  →  ${path.basename(dest)}  ${fmtKB(bytes)}`);
    } catch (err) {
      failed++;
      log(`${label}  ${th.name}  ✗  ${err.message}`);
    }
  }

  // 拼版（只有在完整 8 套都成功时才做）
  if (wantSheet && failed === 0) {
    const thumbs = path.join(tmp, 'thumbs');
    for (const r of results) await fs.copyFile(r.dest, path.join(thumbs, `${r.id}.jpg`));
    const idsParam = encodeURIComponent(THEME_IDS.join(','));
    const sheetJobs = [
      { kind: 'contact', file: 'theme-contact-sheet.jpg', ids: idsParam, label: '联系表 4×2' },
      { kind: 'three', file: 'theme-three-up.jpg', ids: encodeURIComponent(['coral-noir', 'claude-light', 'aqua-morandi'].join(',')), label: '三拼' },
    ];
    for (const job of sheetJobs) {
      const page = `${TMP_NAME}/theme-sheet.html?kind=${job.kind}&ids=${job.ids}`;
      try {
        const still = await renderStill({ root, page, outdir: path.join(raw, `sheet-${job.kind}`), quality: args.quality });
        const dest = path.join(outDir, job.file);
        await fs.copyFile(still, dest);
        const bytes = (await fs.stat(dest)).size;
        results.push({ dest, bytes, id: job.kind });
        log(`[sheet] ${job.label}  →  ${job.file}  ${fmtKB(bytes)}`);
      } catch (err) {
        failed++;
        log(`[sheet] ${job.label}  ✗  ${err.message}`);
      }
    }
  } else if (args.sheet && !fullSet) {
    log('[skip] 子集渲染不生成联系表 / 三拼（需要完整 8 套）');
  }

  // 收尾
  if (!args.keep) {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    await fs.rm(raw, { recursive: true, force: true }).catch(() => {});
  } else {
    log(`[keep] ${tmp}`);
    log(`[keep] ${raw}`);
  }

  if (failed) {
    log(`\n[失败] ${failed} 个任务没有完成，见上面的错误。`);
    process.exitCode = 1;
    return;
  }

  log('');
  log(`生成完成：${results.length} 个文件 → ${outDir}`);
  for (const r of results) {
    const rel = path.relative(SKILL_ROOT, r.dest).replace(/\\/g, '/');
    log(`  ${rel.startsWith('..') ? r.dest : rel}  ${fmtKB(r.bytes)}`);
  }
}

main().catch((err) => {
  console.error(`[fatal] ${err && err.message ? err.message : err}`);
  process.exit(1);
});
