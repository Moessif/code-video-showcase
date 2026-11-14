#!/usr/bin/env node
/**
 * test-recipes.mjs — 四个风格配方页的端到端验收（真实 Chrome + ffmpeg/ffprobe）。
 *
 *   CHROME_EXE="C:/Program Files/Google/Chrome/Application/chrome.exe" \
 *     node scripts/test-recipes.mjs
 *
 * 断言（全部真实执行，退出码 0/1）：
 *   1. 静态契约：4 个页面存在；含 renderFrame / __ready / __bootError / innerWidth /
 *      themeFromURL / loadFontsFor / DURATION；不含 Math.random / Date.now /
 *      performance.now / requestAnimationFrame。
 *   2. 每页用 templates/render-segment.mjs 渲染 1 秒（30fps）到 out/recipes/<id>.mp4；
 *      ffprobe：帧数 = 30，尺寸 = 1920×1080，编码 = h264。
 *   3. 每页 --still 0.3 独立渲染两次（PNG）：SHA-256 必须一致；
 *      不一致时退回 CDP 比较 canvas.toDataURL('image/png') 并说明。
 *   4. CDP 打开每页：__bootError 为空、__ready === true、DURATION === 3、
 *      canvas 像素尺寸 = 1920×1080、renderFrame 是 t 的纯函数（同 t 重绘一致）、
 *      页内实测 1080p 单帧平均耗时 < 80ms。
 *
 * 零 npm 依赖：只用 Node 内置模块、仓库内 templates/cdp.mjs 与 app/canvas/serve.mjs。
 * 输出目录 out/recipes/ 已由 .gitignore 忽略。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../app/canvas/serve.mjs';
import { launch, evaluate, waitFor, browserCandidates } from '../templates/cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'out', 'recipes');
const STILLS_A = path.join(OUT, 'stills-a');
const STILLS_B = path.join(OUT, 'stills-b');

const CHROME = process.env.CHROME_EXE || browserCandidates()[0] || '';
const FFMPEG_EXE = process.env.FFMPEG_EXE || 'ffmpeg';
const FFPROBE_EXE = process.env.FFPROBE_EXE || 'ffprobe';
const FPS = 30;
const VW = 1920;
const VH = 1080;
const STILL_T = 0.3;
const FRAME_BUDGET_MS = 80;

const RECIPES = [
  { id: 'kinetic-type', page: 'templates/recipe-kinetic.html', theme: 'coral-noir', label: 'STYLE 13 / 16', name: 'KINETIC TYPE' },
  { id: 'data-race', page: 'templates/recipe-datarace.html', theme: 'graphite-signal', label: 'STYLE 14 / 16', name: 'DATA RACE' },
  { id: 'ink-wash', page: 'templates/recipe-inkwash.html', theme: 'celadon-paper', label: 'STYLE 15 / 16', name: 'INK WASH' },
  { id: '8bit', page: 'templates/recipe-8bit.html', theme: 'pop-acid', label: 'STYLE 16 / 16', name: '8-BIT' },
];

/* ───────────────────────────── 断言与日志 ───────────────────────────── */

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`;
  console.log(line);
  if (ok) passed++;
  else failed++;
  return ok;
}

function warn(name, detail = '') {
  console.log(`WARN  ${name}${detail ? `  (${detail})` : ''}`);
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const pageFile = (r) => path.join(ROOT, r.page);
const pageExists = (r) => fs.existsSync(pageFile(r));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const human = (n) => `${n.toLocaleString('en-US')} B (${(n / 1024).toFixed(1)} KiB)`;
const pad2 = (v) => String(v).padStart(2, '0');
const tcText = (u) => `${pad2(Math.floor(u / 60))}:${pad2(Math.floor(u) % 60)}:${pad2(Math.floor((u % 1) * FPS))}`;

/* ───────────────────────────── 子进程 ───────────────────────────── */

function run(command, args, { timeout = 360000, cwd = ROOT, env = {}, echo = true } = {}) {
  return new Promise((resolve) => {
    const p = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { p.kill('SIGKILL'); } catch { /* ignore */ }
    }, timeout);
    const onChunk = (chunk, sink) => {
      const text = chunk.toString();
      sink(text);
      if (echo) process.stdout.write(text.split(/\r?\n/).filter(Boolean).map((l) => `    ${l}`).join('\n') + '\n');
    };
    p.stdout.on('data', (d) => onChunk(d, (t) => { stdout += t; }));
    p.stderr.on('data', (d) => onChunk(d, (t) => { stderr += t; }));
    p.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: stderr + String(e), timedOut });
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code == null ? 1 : code, stdout, stderr, timedOut });
    });
  });
}

const runNode = (args, opts) => run(process.execPath, args, opts);

async function ffprobeVideo(file) {
  return new Promise((resolve) => {
    const p = spawn(FFPROBE_EXE, [
      '-v', 'error', '-select_streams', 'v:0', '-count_frames',
      '-show_entries', 'stream=codec_name,width,height,nb_read_frames,r_frame_rate',
      '-of', 'json', file,
    ], { windowsHide: true });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve({ ok: false, error: String(e) }));
    p.on('close', (code) => {
      if (code !== 0) { resolve({ ok: false, error: `ffprobe exit ${code}: ${err.slice(0, 300)}` }); return; }
      try {
        const json = JSON.parse(out);
        const s = (json.streams || [])[0];
        if (!s) { resolve({ ok: false, error: 'no video stream' }); return; }
        resolve({ ok: true, stream: s });
      } catch (e) {
        resolve({ ok: false, error: `bad ffprobe json: ${e.message}` });
      }
    });
  });
}

/* ───────────────────────────── 静态契约 ───────────────────────────── */

const MUST_CONTAIN = [
  'window.renderFrame',
  'window.__ready',
  'window.__bootError',
  'window.innerWidth',
  'window.innerHeight',
  'themeFromURL',
  'loadFontsFor',
  'window.DURATION',
  './recipes/util.js',
];

const FORBIDDEN = [
  [/\bMath\.random\s*\(/, 'Math.random('],
  [/\bDate\.now\s*\(/, 'Date.now('],
  [/\bperformance\.now\s*\(/, 'performance.now('],
  [/\brequestAnimationFrame\s*\(/, 'requestAnimationFrame('],
  [/\bnew\s+Date\s*\(/, 'new Date('],
];

function staticChecks() {
  section('[1/5] 静态契约');
  const utilFile = path.join(ROOT, 'templates', 'recipes', 'util.js');
  check('templates/recipes/util.js 存在', fs.existsSync(utilFile), fs.existsSync(utilFile) ? human(fs.statSync(utilFile).size) : 'missing');

  if (fs.existsSync(utilFile)) {
    const src = fs.readFileSync(utilFile, 'utf8');
    const hits = FORBIDDEN.filter(([re]) => re.test(src)).map(([, label]) => label);
    check('util.js 不含随机/墙钟调用', hits.length === 0, hits.length ? hits.join(', ') : 'clean');
  }

  for (const r of RECIPES) {
    const file = path.join(ROOT, r.page);
    const exists = fs.existsSync(file);
    check(`${r.id} 页面存在`, exists, exists ? human(fs.statSync(file).size) : r.page);
    if (!exists) continue;

    const src = fs.readFileSync(file, 'utf8');
    const missing = MUST_CONTAIN.filter((token) => !src.includes(token));
    check(`${r.id} 渲染契约齐全`, missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `7 tokens + util import`);

    const hits = FORBIDDEN.filter(([re]) => re.test(src)).map(([, label]) => label);
    check(`${r.id} 不含随机/墙钟/animation`, hits.length === 0, hits.length ? hits.join(', ') : 'clean');
  }
}

/* ───────────────────────────── 1 秒视频 ───────────────────────────── */

async function renderVideos() {
  section('[2/5] 渲染 1 秒（30 帧）视频');
  const results = [];
  for (const r of RECIPES) {
    if (!pageExists(r)) {
      check(`${r.id} 视频渲染`, false, `${r.page} missing — skipped`);
      results.push({ recipe: r, file: null, size: 0, probe: { ok: false } });
      continue;
    }
    const outRel = `out/recipes/${r.id}.mp4`;
    const file = path.join(ROOT, outRel);
    fs.rmSync(file, { force: true });
    console.log(`\n[render] ${r.id}  ${r.page}?theme=${r.theme}  (${FPS} frames)`);
    // 连续起 Chrome 时偶发冷启动超时（CDP Page.navigate / __ready 等待）；
    // 失败后退避 1.5s 重试一次——真实工作流里 `compile --resume` 也是这个做法。
    const renderVideo = async () => runNode([
      'templates/render-segment.mjs',
      '--page', `${r.page}?theme=${r.theme}`,
      '--out', outRel,
      '--duration', '1',
      '--fps', String(FPS),
      '--root', '.',
      '--timeout', '180000',
    ], { env: { CHROME_EXE: CHROME }, echo: true });
    let res = await renderVideo();
    if (res.code !== 0) {
      console.log(`  (retry ${r.id} after ${res.timedOut ? 'timeout' : `exit=${res.code}`})`);
      await new Promise((r2) => setTimeout(r2, 1500));
      fs.rmSync(file, { force: true });
      res = await renderVideo();
    }

    check(`${r.id} render-segment 退出码 0`, res.code === 0, res.timedOut ? 'timeout' : `exit=${res.code}`);
    const hasBootError = /page boot error/i.test(res.stdout + res.stderr);
    check(`${r.id} 渲染日志无 page boot error`, !hasBootError);
    const pageErrors = /\[page errors\]/i.test(res.stdout + res.stderr);
    check(`${r.id} 渲染日志无 [page errors]`, !pageErrors);

    const exists = fs.existsSync(file);
    const size = exists ? fs.statSync(file).size : 0;
    check(`${r.id} 视频文件存在且非空`, exists && size > 4096, exists ? human(size) : 'missing');

    if (!exists) { results.push({ recipe: r, file, size, probe: { ok: false } }); continue; }
    const probe = await ffprobeVideo(file);
    if (!probe.ok) {
      check(`${r.id} ffprobe 可读`, false, probe.error);
    } else {
      const s = probe.stream;
      check(`${r.id} ffprobe 帧数 = ${FPS}`, Number(s.nb_read_frames) === FPS, `nb_read_frames=${s.nb_read_frames}`);
      check(`${r.id} ffprobe 尺寸 = ${VW}×${VH}`, Number(s.width) === VW && Number(s.height) === VH, `${s.width}×${s.height}`);
      check(`${r.id} 编码 h264`, s.codec_name === 'h264', s.codec_name);
    }
    results.push({ recipe: r, file, size, probe });
  }
  return results;
}

/* ───────────────────────────── 静帧确定性 ───────────────────────────── */

async function renderStills(r, dirAbs) {
  const dirRel = rel(dirAbs);
  console.log(`\n[still] ${r.id}  t=${STILL_T.toFixed(2)}  -> ${dirRel}`);
  const res = await runNode([
    'templates/render-segment.mjs',
    '--page', `${r.page}?theme=${r.theme}`,
    '--still', STILL_T.toFixed(2),
    '--format', 'png',
    '--root', '.',
    '--outdir', dirRel,
    '--timeout', '180000',
  ], { env: { CHROME_EXE: CHROME }, echo: true });
  return { ...res, file: path.join(dirAbs, `still-${STILL_T.toFixed(2).replace('.', '_')}.png`) };
}

async function captureCanvasDataUrl(pageUrl) {
  const browser = await launch({ executablePath: CHROME || undefined, width: VW, height: VH, timeout: 60000 });
  try {
    await browser.client.send('Page.navigate', { url: pageUrl }, browser.sessionId);
    await waitFor(browser.client, browser.sessionId,
      'window.__ready === true || !!window.__bootError', { timeout: 120000, label: 'canvas capture ready' });
    return await evaluate(browser.client, browser.sessionId, () => {
      window.renderFrame(0.3);
      return document.querySelector('canvas').toDataURL('image/png');
    });
  } finally {
    await browser.close().catch(() => {});
  }
}

async function stillChecks() {
  section('[3/5] 同 t 两次静帧 SHA-256');
  fs.rmSync(STILLS_A, { recursive: true, force: true });
  fs.rmSync(STILLS_B, { recursive: true, force: true });

  let allSame = true;
  const rows = [];
  for (const r of RECIPES) {
    if (!pageExists(r)) {
      check(`${r.id} 静帧确定性`, false, `${r.page} missing — skipped`);
      allSame = false;
      rows.push({ id: r.id, size: 0, sha: '', same: false });
      continue;
    }
    const a = await renderStills(r, STILLS_A);
    const b = await renderStills(r, STILLS_B);
    check(`${r.id} 静帧 pass A 退出码 0`, a.code === 0, `exit=${a.code}`);
    check(`${r.id} 静帧 pass B 退出码 0`, b.code === 0, `exit=${b.code}`);
    const hasA = fs.existsSync(a.file);
    const hasB = fs.existsSync(b.file);
    const bufA = hasA ? fs.readFileSync(a.file) : Buffer.alloc(0);
    const bufB = hasB ? fs.readFileSync(b.file) : Buffer.alloc(0);
    const same = bufA.length > 1024 && bufA.length === bufB.length && sha256(bufA) === sha256(bufB);
    if (!same) allSame = false;
    rows.push({ id: r.id, size: bufA.length, sha: sha256(bufA), same });
    check(`${r.id} still t=${STILL_T} 两次 SHA-256 一致`, same,
      same ? `${sha256(bufA).slice(0, 16)}… ${human(bufA.length)}` : `A=${sha256(bufA).slice(0, 12)}… B=${sha256(bufB).slice(0, 12)}…`);
  }

  let fallbackUsed = false;
  if (!allSame) {
    warn('PNG 字节比对未全过，退回 CDP canvas.toDataURL 复核');
    fallbackUsed = true;
    const server = createStaticServer(ROOT);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const r of RECIPES) {
        if (!pageExists(r)) continue;
        const url = `${origin}/${r.page}?theme=${r.theme}&seg=1&t0=0&speed=1&dur=3`;
        try {
          const ua = await captureCanvasDataUrl(url);
          const ub = await captureCanvasDataUrl(url);
          check(`${r.id} canvas.toDataURL 两次一致（像素确定性）`, ua === ub, `${sha256(Buffer.from(String(ua))).slice(0, 16)}…`);
        } catch (e) {
          check(`${r.id} canvas.toDataURL 复核`, false, String(e.message).slice(0, 160));
        }
      }
    } finally {
      server.close();
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    }
  }
  return { rows, fallbackUsed };
}

/* ───────────────────────────── CDP 契约 + 性能 ───────────────────────────── */

async function cdpChecks() {
  section('[4/5] CDP：__bootError / DURATION / 纯函数 / 性能');
  if (!CHROME) {
    check('找到 Chrome/Edge', false, 'set CHROME_EXE');
    return { perf: [] };
  }
  console.log(`[browser] ${CHROME}`);

  const server = createStaticServer(ROOT);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  console.log(`[server] ${ROOT} -> ${origin}`);

  let browser = null;
  const perfRows = [];
  try {
    browser = await launch({ executablePath: CHROME, width: VW, height: VH, timeout: 90000 });

    for (const r of RECIPES) {
      if (!pageExists(r)) {
        check(`${r.id} CDP 检查`, false, `${r.page} missing — skipped`);
        continue;
      }
      const pageErrors = [];
      const offException = browser.client.on('Runtime.exceptionThrown', (p) => {
        pageErrors.push(p?.exceptionDetails?.exception?.description || p?.exceptionDetails?.text || 'page exception');
      });
      const offConsole = browser.client.on('Runtime.consoleAPICalled', (p) => {
        if (p.type === 'error') pageErrors.push('console: ' + (p.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
      });

      const url = `${origin}/${r.page}?theme=${r.theme}&seg=1&t0=0&speed=1&dur=3`;
      try {
        await browser.client.send('Page.navigate', { url }, browser.sessionId);
        await waitFor(browser.client, browser.sessionId,
          `location.pathname.endsWith(${JSON.stringify('/' + r.page)})`,
          { timeout: 60000, label: `${r.id} navigate` });
        await waitFor(browser.client, browser.sessionId,
          'window.__ready === true || !!window.__bootError',
          { timeout: 120000, label: `${r.id} __ready` });

        const info = await evaluate(browser.client, browser.sessionId, () => {
          const c = document.querySelector('canvas');
          return {
            bootError: window.__bootError || null,
            ready: window.__ready === true,
            duration: window.DURATION,
            hasRender: typeof window.renderFrame === 'function',
            canvas: c ? [c.width, c.height] : null,
            canvasCount: document.querySelectorAll('canvas').length,
          };
        });

        check(`${r.id} __bootError 为空`, info.bootError === null, info.bootError ? String(info.bootError).slice(0, 200) : 'null');
        check(`${r.id} __ready === true`, info.ready === true);
        check(`${r.id} DURATION === 3`, info.duration === 3, String(info.duration));
        check(`${r.id} renderFrame 是函数`, info.hasRender === true);
        check(`${r.id} 画布 ${VW}×${VH}`, Array.isArray(info.canvas) && info.canvas[0] === VW && info.canvas[1] === VH,
          info.canvas ? info.canvas.join('×') : 'none');
        check(`${r.id} 页面只有一个 canvas（canvas 捕获路径）`, info.canvasCount === 1, String(info.canvasCount));
        check(`${r.id} 页面无 JS/console error`, pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || 'clean');

        const purity = await evaluate(browser.client, browser.sessionId, async () => {
          // 等字体栅格化 settle，并预热几帧；否则首次比较可能被 CJK 字形补载入干扰。
          if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch { /* ignore */ } }
          const c = document.querySelector('canvas');
          const ctx = c.getContext('2d');
          const grab = () => ctx.getImageData(0, 0, c.width, c.height).data;
          for (let i = 0; i < 3; i++) window.renderFrame(i / 30);
          window.renderFrame(0.3);
          const A = grab();
          window.renderFrame(1.77);
          window.renderFrame(0.3);
          const B = grab();
          let diff = 0;
          let maxDelta = 0;
          for (let i = 0; i < A.length; i += 4) {
            const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
            if (d > 0) { diff++; if (d > maxDelta) maxDelta = d; }
          }
          return { diff, total: A.length / 4, maxDelta };
        });
        // 判定：要么逐像素完全一致，要么差异占比 ≤0.2% 且单像素 Δ≤4（Chrome 光栅器在帧间跳变后的抗锯齿容差）。
        // 跨进程的严格位级一致性由上面的 `--still` 两次渲染 SHA-256 提供。
        const tolOk = purity.diff === 0 || (purity.diff / purity.total <= 0.002 && purity.maxDelta <= 4);
        check(`${r.id} renderFrame 是 t 的纯函数`, tolOk,
          purity.diff === 0 ? 'bit-identical' : `${purity.diff}/${purity.total} px differ, maxDelta=${purity.maxDelta}`);

        const perf = await evaluate(browser.client, browser.sessionId, (budget) => {
          for (let i = 0; i < 3; i++) window.renderFrame(i / 30);
          const n = 24;
          const times = [];
          for (let i = 0; i < n; i++) {
            const t = (i / n) * 3;
            const t0 = performance.now();
            window.renderFrame(t);
            times.push(performance.now() - t0);
          }
          times.sort((a, b) => a - b);
          const sum = times.reduce((a, b) => a + b, 0);
          return {
            avg: sum / n,
            p95: times[Math.min(n - 1, Math.floor(n * 0.95))],
            max: times[n - 1],
            overBudget: times.filter((v) => v > budget).length,
          };
        }, FRAME_BUDGET_MS);

        const avgMs = Math.round(perf.avg * 100) / 100;
        const p95Ms = Math.round(perf.p95 * 100) / 100;
        perfRows.push({ id: r.id, ...perf, avgMs, p95Ms });
        check(`${r.id} 单帧平均 < ${FRAME_BUDGET_MS}ms`, perf.avg < FRAME_BUDGET_MS,
          `avg=${avgMs}ms p95=${p95Ms}ms max=${Math.round(perf.max * 100) / 100}ms`);
      } catch (e) {
        check(`${r.id} CDP 检查执行`, false, String(e.message).slice(0, 240));
      } finally {
        offException();
        offConsole();
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  }
  return { perf: perfRows, origin };
}

/* ───────────────────────────── main ───────────────────────────── */

async function main() {
  console.log('test-recipes.mjs — 4 风格配方页验收');
  console.log(`[root] ${ROOT}`);
  console.log(`[chrome] ${CHROME || 'NOT FOUND'}`);
  console.log(`[ffmpeg] ${FFMPEG_EXE}   [ffprobe] ${FFPROBE_EXE}`);

  fs.mkdirSync(OUT, { recursive: true });

  if (!CHROME) {
    check('找到 Chrome/Edge', false, 'set CHROME_EXE or install Chrome');
    console.log(`\n${passed} passed, ${failed} failed`);
    console.log('RESULT: FAIL');
    process.exitCode = 1;
    return;
  }

  const ffmpegOk = await run(FFMPEG_EXE, ['-version'], { echo: false, timeout: 20000 });
  check('ffmpeg 可用', ffmpegOk.code === 0, ffmpegOk.code === 0 ? (ffmpegOk.stdout.split('\n')[0] || '').split(' ')[0] : 'not found');
  const ffprobeOk = await run(FFPROBE_EXE, ['-version'], { echo: false, timeout: 20000 });
  check('ffprobe 可用', ffprobeOk.code === 0, ffprobeOk.code === 0 ? (ffprobeOk.stdout.split('\n')[0] || '').split(' ')[0] : 'not found');
  if (ffmpegOk.code !== 0 || ffprobeOk.code !== 0) {
    console.log(`\n${passed} passed, ${failed} failed`);
    console.log('RESULT: FAIL');
    process.exitCode = 1;
    return;
  }

  staticChecks();
  const videos = await renderVideos();
  const stills = await stillChecks();
  const cdp = await cdpChecks();

  section('[5/5] 汇总');
  console.log('recipe          video bytes    frames   size        still@0.3 sha256    avg frame   p95');
  for (const v of videos) {
    const s = v.probe && v.probe.ok ? v.probe.stream : null;
    const st = stills.rows.find((x) => x.id === v.recipe.id);
    const pf = (cdp.perf || []).find((x) => x.id === v.recipe.id);
    console.log([
      v.recipe.id.padEnd(15),
      String(v.size).padEnd(13),
      String(s ? s.nb_read_frames : '-').padEnd(8),
      String(s ? `${s.width}×${s.height}` : '-').padEnd(11),
      String(st ? `${st.sha.slice(0, 16)}…${st.same ? ' SAME' : ' DIFF'}` : '-').padEnd(20),
      String(pf ? `${pf.avgMs}ms` : '-').padEnd(11),
      String(pf ? `${pf.p95Ms}ms` : '-'),
    ].join(' '));
  }
  if (stills.fallbackUsed) console.log('[note] 静帧哈希不一致的页面已用 canvas.toDataURL 复核');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('RESULT: FAIL');
    process.exitCode = 1;
  } else {
    console.log('RESULT: PASS');
    process.exitCode = 0;
  }
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((e) => { console.error('[fatal]', (e && e.stack) || e); process.exit(1); });
