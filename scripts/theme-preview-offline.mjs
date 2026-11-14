#!/usr/bin/env node
/**
 * theme-preview-offline.mjs — 无 CDP / 无 Playwright 的主题预览生成器。
 *
 * 背景：theme-preview.mjs 走 render-segment.mjs → cdp.mjs，需要浏览器暴露
 * WebSocket 调试端口；本机该路径起不来（window.__ready 超时，连默认主题也失败）。
 * Chrome 的 `--headless=new --screenshot` 直出路径实测可用，且 --virtual-time-budget
 * 能等 Canvas 页面的字体/图片加载完成。本脚本用这条路径产出与 theme-preview.mjs
 * 完全相同的资产名，可在任何装了 Chrome + Node 的机器上复现。
 *
 *   node scripts/theme-preview-offline.mjs                    # 全部 17 套 + 联系表 + 三拼
 *   node scripts/theme-preview-offline.mjs --themes a,b      # 只渲指定主题
 *   node scripts/theme-preview-offline.mjs --no-sheet        # 跳过拼版
 *   node scripts/theme-preview-offline.mjs --only-sheets     # 复用已有单图，只重建拼版
 *   node scripts/theme-preview-offline.mjs --force           # 覆盖已有单图（会破坏测试基准，慎用）
 *   node scripts/theme-preview-offline.mjs --chrome <path>   # 指定 Chrome
 *   node scripts/theme-preview-offline.mjs --out <dir>
 *
 * 默认不覆盖已有单图：01–13 是 test-assets（sha256）与 test-from-reference
 * （色板聚类）的固定基准，重渲会打破回归。新增主题 14–17 首次生成时自动写入。
 *
 * 依赖：Node 内置模块 + Chrome（--headless=new）+ ffmpeg（PNG→JPEG）。
 * 不写任何 npm 依赖，不启动长驻进程（静态 server 随脚本退出）。
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT_DEFAULT = path.join(ROOT, 'assets', 'theme-previews');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

function parseArgs(argv) {
  // 默认不覆盖已有单图：01–13 是 test-assets / test-from-reference 的固定基准，
  // 重新渲染会改变 sha256 与色板聚类，打破回归测试。只有 --force 才覆盖。
  const o = { themes: null, out: OUT_DEFAULT, sheet: true, chrome: process.env.CHROME_EXE || null,
    budget: 9000, force: false, onlySheets: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined || String(v).startsWith('--')) throw new Error(`缺少参数值：${a}`); return v; };
    if (a === '--themes') o.themes = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--out') o.out = path.resolve(next());
    else if (a === '--chrome') o.chrome = path.resolve(next());
    else if (a === '--budget') o.budget = Number(next());
    else if (a === '--no-sheet') o.sheet = false;
    else if (a === '--force') o.force = true;
    else if (a === '--only-sheets') o.onlySheets = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  return o;
}

function findChrome(explicit) {
  if (explicit) return explicit;
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

function startServer(root) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let p;
      try { p = decodeURIComponent(req.url.split('?')[0]); } catch { p = '/'; }
      if (p === '/') p = '/index.html';
      const file = path.join(root, p);
      // 防穿越：解析后必须仍在 root 内。
      if (!path.resolve(file).startsWith(path.resolve(root))) { res.writeHead(403); res.end('forbidden'); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      });
    });
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/**
 * Chrome headless 直出一张 PNG。失败抛带 stderr 尾巴的错误。
 * 必须用异步 spawn：静态 server 跑在同一个 Node 进程里，spawnSync 会阻塞事件循环，
 * 导致 Chrome 请求 HTML/字体时 server 无法响应，最终 Chrome 卡到超时。
 */
async function shoot({ chrome, url, png, W, H, budget, profile }) {
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--mute-audio', '--no-first-run', '--disable-extensions',
    '--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    `--user-data-dir=${profile}`,
    `--virtual-time-budget=${budget}`,
    `--screenshot=${png}`, `--window-size=${W},${H}`,
    url,
  ];
  const { code, stderr, stdout } = await new Promise((resolve, reject) => {
    const child = spawn(chrome, args, { windowsHide: true });
    let so = '', se = '';
    child.stdout.on('data', (d) => { so += d; });
    child.stderr.on('data', (d) => { se += d; });
    child.on('error', reject);
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 120000);
    child.on('close', (c) => { clearTimeout(timer); resolve({ code: c, stderr: se, stdout: so }); });
  });
  if (code !== 0 || !fs.existsSync(png)) {
    const tail = (stderr || stdout || '').trim().split('\n').slice(-10).join('\n');
    throw new Error(`chrome exit ${code}\n${tail}`);
  }
  return fs.statSync(png).size;
}

/** PNG → JPEG（ffmpeg）。输出已存在时先删，避免交互确认。 */
function toJpeg(png, jpg, quality = 92) {
  try { fs.unlinkSync(jpg); } catch { /* not there */ }
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-q:v', String(Math.round(32 - quality * 0.28)), jpg],
    { encoding: 'utf8', timeout: 60000, windowsHide: true });
  if (r.status !== 0 || !fs.existsSync(jpg)) {
    throw new Error(`ffmpeg exit ${r.status}: ${(r.stderr || '').trim().slice(-300)}`);
  }
  return fs.statSync(jpg).size;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`用法: node scripts/theme-preview-offline.mjs [options]

  --themes a,b     只渲指定主题（子集不生成拼版）
  --no-sheet       跳过拼版
  --only-sheets    复用已有单图，只重建联系表 + 三拼
  --force          覆盖已有单图（会破坏 test-assets / test-from-reference 基准，慎用）
  --chrome <path>  指定 Chrome/Edge（默认自动发现或 $CHROME_EXE）
  --out <dir>      输出目录，默认 assets/theme-previews
  --budget <ms>    Chrome --virtual-time-budget，默认 9000

无 CDP / 无 Playwright / 无 npm 依赖；仅 Chrome + ffmpeg。默认不覆盖已有单图。`);
    return;
  }
  const chrome = findChrome(args.chrome);
  if (!chrome) throw new Error('找不到 Chrome/Edge；用 --chrome <path> 或设 CHROME_EXE');
  const { THEMES, THEME_IDS } = await import(pathToFileURL(path.join(ROOT, 'templates', 'themes.js')).href);

  const ids = args.themes?.length ? args.themes : THEME_IDS.slice();
  const unknown = ids.filter((id) => !THEMES[id]);
  if (unknown.length) throw new Error(`未知主题 id: ${unknown.join(', ')}\n可用: ${THEME_IDS.join(', ')}`);
  const fullSet = ids.length === THEME_IDS.length && THEME_IDS.every((id) => ids.includes(id));
  const wantSheet = args.sheet && fullSet;

  await fsp.mkdir(args.out, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cvs-preview-'));
  const profile = path.join(tmp, 'chrome-profile');
  const raw = path.join(tmp, 'raw');
  await fsp.mkdir(raw, { recursive: true });
  // theme-sheet.html 从 ./thumbs/<id>.jpg 读缩略图，相对它自己的目录。
  const thumbs = path.join(ROOT, '.theme-preview-offline-tmp', 'thumbs');
  await fsp.mkdir(thumbs, { recursive: true });
  if (wantSheet) {
    for (const f of ['theme-sheet.html', 'themes.js']) {
      await fsp.copyFile(path.join(ROOT, 'templates', f), path.join(ROOT, '.theme-preview-offline-tmp', f));
    }
  }

  const { srv, port } = await startServer(ROOT);
  const base = `http://127.0.0.1:${port}`;
  let failed = 0;
  const results = [];
  try {
    console.log(`[chrome] ${chrome}`);
    console.log(`[out]    ${args.out}`);
    console.log(`[themes] ${ids.length} 套${fullSet ? '' : '（子集，跳过拼版）'}`);

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const num = String(THEME_IDS.indexOf(id) + 1).padStart(2, '0');
      const png = path.join(raw, `${num}-${id}.png`);
      const jpg = path.join(args.out, `${num}-${id}.jpg`);
      // --only-sheets：复用已有单图，只重建拼版。
      // 默认（无 --force）：已有单图不重渲，保护 test-assets 的 sha256 基准。
      if (args.onlySheets || (!args.force && fs.existsSync(jpg))) {
        if (!fs.existsSync(jpg)) { failed++; console.error(`  [${i + 1}/${ids.length}] ${id} ✗ 缺少 ${jpg}`); continue; }
        results.push({ id, jpg });
        console.log(`  [${i + 1}/${ids.length}] ${id.padEnd(20)} ${THEMES[id].name.padEnd(8)} 复用 ${path.basename(jpg)}`);
        continue;
      }
      const url = `${base}/templates/theme-board.html?theme=${encodeURIComponent(id)}&seg=1&t0=0&speed=1&dur=1`;
      try {
        const bytes = await shoot({ chrome, url, png, W: 1920, H: 1080, budget: args.budget, profile });
        const jbytes = toJpeg(png, jpg);
        results.push({ id, jpg });
        console.log(`  [${i + 1}/${ids.length}] ${id.padEnd(20)} ${THEMES[id].name.padEnd(8)} png ${(bytes / 1024).toFixed(0)}K → ${path.basename(jpg)} ${(jbytes / 1024).toFixed(0)}K`);
      } catch (e) {
        failed++;
        console.error(`  [${i + 1}/${ids.length}] ${id} ✗ ${e.message}`);
      }
    }

    if (wantSheet && failed === 0) {
      for (const r of results) await fsp.copyFile(r.jpg, path.join(thumbs, `${r.id}.jpg`));
      const jobs = [
        { kind: 'contact', file: 'theme-contact-sheet.jpg', ids: THEME_IDS.join(',') },
        { kind: 'three', file: 'theme-three-up.jpg', ids: ['coral-noir', 'claude-light', 'aqua-morandi'].join(',') },
      ];
      for (const job of jobs) {
        const png = path.join(raw, `sheet-${job.kind}.png`);
        const jpg = path.join(args.out, job.file);
        const url = `${base}/.theme-preview-offline-tmp/theme-sheet.html?kind=${job.kind}&ids=${encodeURIComponent(job.ids)}&noDecode=1`;
        try {
          await shoot({ chrome, url, png, W: 1920, H: 1080, budget: args.budget, profile });
          const jbytes = toJpeg(png, jpg);
          console.log(`  [sheet] ${job.kind.padEnd(8)} → ${job.file} ${(jbytes / 1024).toFixed(0)}K`);
        } catch (e) {
          failed++;
          console.error(`  [sheet] ${job.kind} ✗ ${e.message}`);
        }
      }
    } else if (wantSheet) {
      console.log('[skip] 有主题失败，跳过拼版');
    }
  } finally {
    srv.close();
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(path.join(ROOT, '.theme-preview-offline-tmp'), { recursive: true, force: true }).catch(() => {});
  }

  console.log(`\n${failed ? `✗ ${failed} 个任务失败` : `✓ ${results.length} 套预览${wantSheet ? ' + 2 张拼版' : ''} 全部产出`}`);
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(`[fatal] ${e.message}`); process.exit(1); });
