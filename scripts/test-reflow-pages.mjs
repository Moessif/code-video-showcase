#!/usr/bin/env node
/**
 * test-reflow-pages.mjs — D7 多画幅页面契约的端到端验收（真实 Chrome + 真实 ffprobe）。
 *
 *   CHROME_EXE="C:/Program Files/Google/Chrome/Application/chrome.exe" node scripts/test-reflow-pages.mjs
 *
 * 断言：
 *   1. 1080×1920：big-card@0.5 + segment@1.2 的 still 由 render-segment 产出，
 *      ffprobe 读到 1080×1920。
 *   2. 1080×1080：同上，ffprobe 读到 1080×1080。
 *   3. 1080×1920 页面里 canvas.width/height === window.innerWidth/innerHeight，
 *      CSS 尺寸同步；__hit 非空；每个 rect 是有限数值且完全落在画布内；
 *      __inspect 命中 card.first / card.keyword / title.main / hud.capsule 等已知节点。
 *   4. 16:9 基线：render-segment --still 的 JPG SHA-256 与 D7 冻结哈希逐字节一致
 *      （big-card@0.5 / segment@1.2）。JPEG 编码器在这里实测可复现，因此直接比哈希；
 *      若换机器后出现不稳定，再退回页面 canvas.toDataURL('image/png') 的哈希。
 *
 * 退出码 0/1。零 npm 依赖；只连本机 Chrome 与临时静态服务器。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, evaluate, browserCandidates, launchRetry } from '../templates/cdp.mjs';
import { createStaticServer } from '../app/canvas/serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'out', 'reflow-test');
const RENDER = path.join(ROOT, 'templates', 'render-segment.mjs');
const FFPROBE = process.env.FFPROBE_EXE || 'ffprobe';
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

// D7 冻结基线（docs/DECISIONS.md）。v2.4 重定一次，理由见 D7 附注：
// v2.3.5 去掉开发者占位文案、v2.4 引入排版 token，16:9 像素**有意**变了。
// 重定前已验证 HEAD 页面仍能复现旧哈希，且本轮 D3 接线修复对基线零像素漂移。
const D7 = {
  'big-card': 'af48254753aeaa0758b2489b285e259e50d8b876460d43e2ab22b63ba298dc0c',
  segment: 'b39be97209eba14714bd57b9d313779eb3882d4d371c74d6c43aab08bfd8f08e',
  // 带内容的基线：无参数形态在 v2.3.5 之后几乎只剩 HUD/背景，守不住标题排版。
  'big-card-content': '416a84f63e44e33266c12f9f7c548ecf10a4ce5b9b246e575c3bc0e6610988d3',
  'segment-content': 'cd9142a5fe5499e316914318ff1b30d769a7235970722117eaec0fd1b1c19641',
};
const D7_CONTENT_PAGE = {
  'big-card': 'templates/big-card.html?first=契约&keyword=基线？&brand=CVS',
  segment: 'templates/segment.html?title=契约基线&sub=副标题&brand=CVS',
};
// 命中表审计必须带内容：空文本不注册命中区（D7 v2.4），没有标题就无从验证标题重排。
const SEG_AUDIT_QS = 'seg=1&t0=0&speed=1&dur=3&title=契约基线&sub=副标题&brand=CVS';

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
  return ok;
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fileSize = (file) => { try { return fs.statSync(file).size; } catch { return 0; } };

/** 用真实的 render-segment CLI 出 still（验收命令同一条路径）。偶发的 CDP 启动超时重试一次。 */
function renderStill({ page, width, height, t, outdir }) {
  fs.mkdirSync(outdir, { recursive: true });
  const out = path.join(outdir, `still-${String(t.toFixed(2)).replace('.', '_')}.jpg`);
  try { fs.unlinkSync(out); } catch { /* first run */ }
  const argv = [
    RENDER, '--page', page, '--width', String(width), '--height', String(height),
    '--still', String(t), '--outdir', outdir,
  ];
  let last = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = spawnSync(process.execPath, argv, {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, CHROME_EXE: process.env.CHROME_EXE || (browserCandidates()[0] || '') },
      timeout: 180000,
    });
    last = r;
    if (r.status === 0 && fs.existsSync(out)) return { ok: true, file: out, attempt, stdout: r.stdout || '' };
    console.log(`[retry] render ${page} ${width}x${height} @${t} attempt ${attempt} failed (status=${r.status})`);
    try { fs.unlinkSync(out); } catch { /* ignore */ }
  }
  console.log(String((last && (last.stderr || last.stdout)) || '').slice(-1200));
  return { ok: false, file: out, attempt: 2, stdout: String((last && last.stdout) || '') };
}

/** ffprobe 读视频/单帧文件的像素尺寸。 */
function probeSize(file) {
  const r = spawnSync(FFPROBE, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
  ], { encoding: 'utf8', timeout: 30000 });
  if (r.error) return { ok: false, error: String(r.error.message || r.error) };
  if (r.status !== 0) return { ok: false, error: String(r.stderr || `ffprobe exit ${r.status}`).trim() };
  const m = String(r.stdout).trim().match(/^(\d+),(\d+)/);
  if (!m) return { ok: false, error: `unparsable ffprobe output: ${JSON.stringify(r.stdout)}` };
  return { ok: true, width: Number(m[1]), height: Number(m[2]) };
}

async function waitFor(client, sessionId, fn, timeoutMs, label) {
  const started = Date.now();
  let lastErr = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const v = await evaluate(client, sessionId, fn);
      if (v) return true;
    } catch (e) { lastErr = e; }
    await SLEEP(120);
  }
  console.log(`[wait] timeout: ${label}${lastErr ? ` — ${lastErr.message}` : ''}`);
  return false;
}

/** 在一个已定尺寸的浏览器里导航到页面，渲染 t，收集画布/命中表/inspect 探针。 */
async function auditPage(browser, origin, { pagePath, t, expectIds, probeIds }) {
  const { client, sessionId } = browser;
  await client.send('Page.navigate', { url: `${origin}${pagePath}` }, sessionId);
  await SLEEP(400);
  const ready = await waitFor(client, sessionId, () => window.__ready === true || !!window.__bootError, 60000, pagePath);
  const boot = await evaluate(client, sessionId, () => window.__bootError || null);
  if (!ready || boot) return { ok: false, error: boot || 'page did not become ready' };

  const data = await evaluate(client, sessionId, ({ tt, probes }) => {
    window.renderFrame(tt);
    const c = document.querySelector('canvas');
    const rect = c.getBoundingClientRect();
    const hit = (window.__hit || []).map((e) => ({ id: e.id, rect: e.rect.slice(0, 4) }));
    const inspect = {};
    for (const id of probes) {
      const e = hit.find((x) => x.id === id);
      inspect[id] = e ? (window.__inspect(e.rect[0] + e.rect[2] / 2, e.rect[1] + e.rect[3] / 2) || null) : null;
    }
    return {
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      canvasW: c.width,
      canvasH: c.height,
      cssW: rect.width,
      cssH: rect.height,
      hit,
      inspect: Object.fromEntries(Object.entries(inspect).map(([k, v]) => [k, v && v.id])),
    };
  }, { tt: t, probes: probeIds });

  const bad = data.hit.filter((e) => !Array.isArray(e.rect) || e.rect.length !== 4
    || !e.rect.every((n) => Number.isFinite(Number(n))));
  const outside = data.hit.filter((e) => {
    const [x, y, w, h] = e.rect;
    return x < -0.5 || y < -0.5 || x + w > data.canvasW + 0.5 || y + h > data.canvasH + 0.5;
  });
  return { ok: true, data, expectIds, probeIds, bad, outside };
}

function reportAudit(label, audit, { width, height }) {
  if (!audit.ok) {
    check(`${label}: 页面就绪`, false, audit.error);
    return;
  }
  const { data } = audit;
  check(`${label}: canvas.width === innerWidth`, data.canvasW === data.innerW && data.innerW === width,
    `canvas=${data.canvasW} inner=${data.innerW} want=${width}`);
  check(`${label}: canvas.height === innerHeight`, data.canvasH === data.innerH && data.innerH === height,
    `canvas=${data.canvasH} inner=${data.innerH} want=${height}`);
  check(`${label}: CSS 尺寸与位图一致`, Math.abs(data.cssW - width) < 0.5 && Math.abs(data.cssH - height) < 0.5,
    `css=${data.cssW}x${data.cssH}`);

  const ids = data.hit.map((e) => e.id);
  check(`${label}: __hit 非空`, data.hit.length > 0, `entries=${data.hit.length}`);
  check(`${label}: 每个 rect 都是有限数值`, audit.bad.length === 0,
    audit.bad.map((e) => e.id).join(',') || 'ok');
  check(`${label}: 每个 rect 都在画布内`, audit.outside.length === 0,
    audit.outside.map((e) => `${e.id}[${e.rect.map((n) => n.toFixed(1)).join(',')}]`).join(' ') || 'ok');
  check(`${label}: 已知节点齐全`, audit.expectIds.every((id) => ids.includes(id)),
    audit.expectIds.filter((id) => !ids.includes(id)).join(',') || ids.join(' '));
  for (const id of audit.probeIds) {
    check(`${label}: __inspect 命中 ${id}`, data.inspect[id] === id, `-> ${data.inspect[id]}`);
  }
}

async function main() {
  const chrome = process.env.CHROME_EXE || browserCandidates()[0];
  if (!chrome) {
    console.error('no Chrome/Edge found; set CHROME_EXE');
    process.exit(1);
  }
  const probe = spawnSync(FFPROBE, ['-version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    console.error(`ffprobe unavailable (${FFPROBE}); set FFPROBE_EXE`);
    process.exit(1);
  }
  console.log(`[browser] ${chrome}`);
  console.log(`[ffprobe] ${FFPROBE}`);
  fs.mkdirSync(OUT, { recursive: true });

  // ---------- 1. 16:9 基线（D7） ----------
  section('16:9 基线（D7 冻结哈希）');
  const baseBig = renderStill({ page: 'templates/big-card.html', width: 1920, height: 1080, t: 0.5, outdir: path.join(OUT, 'baseline-16x9', 'big-card') });
  const baseSeg = renderStill({ page: 'templates/segment.html', width: 1920, height: 1080, t: 1.2, outdir: path.join(OUT, 'baseline-16x9', 'segment') });
  check('16:9 big-card still 产出', baseBig.ok && fileSize(baseBig.file) > 5000, `${baseBig.file} (${fileSize(baseBig.file)} B)`);
  check('16:9 segment still 产出', baseSeg.ok && fileSize(baseSeg.file) > 5000, `${baseSeg.file} (${fileSize(baseSeg.file)} B)`);
  if (baseBig.ok) {
    const h = sha256(baseBig.file);
    check('16:9 big-card@0.5 SHA-256 === D7', h === D7['big-card'], h);
    const dim = probeSize(baseBig.file);
    check('16:9 big-card 尺寸 1920×1080', dim.ok && dim.width === 1920 && dim.height === 1080,
      dim.ok ? `${dim.width}x${dim.height}` : dim.error);
  }
  if (baseSeg.ok) {
    const h = sha256(baseSeg.file);
    check('16:9 segment@1.2 SHA-256 === D7', h === D7.segment, h);
    const dim = probeSize(baseSeg.file);
    check('16:9 segment 尺寸 1920×1080', dim.ok && dim.width === 1920 && dim.height === 1080,
      dim.ok ? `${dim.width}x${dim.height}` : dim.error);
  }

  // 带内容的 16:9 基线：标题/副标题真的在画面上，才守得住排版回归。
  for (const [name, t] of [['big-card', 0.5], ['segment', 1.2]]) {
    const r = renderStill({
      page: D7_CONTENT_PAGE[name], width: 1920, height: 1080, t,
      outdir: path.join(OUT, 'baseline-16x9-content', name),
    });
    check(`16:9 ${name}(带内容) still 产出`, r.ok && fileSize(r.file) > 5000, `${r.file} (${fileSize(r.file)} B)`);
    if (r.ok) {
      const h = sha256(r.file);
      check(`16:9 ${name}(带内容) SHA-256 === D7`, h === D7[`${name}-content`], h);
    }
  }

  // ---------- 2. 1080×1920 still ----------
  section('9:16 still（render-segment --width 1080 --height 1920 + ffprobe）');
  const vBig = renderStill({ page: 'templates/big-card.html', width: 1080, height: 1920, t: 0.5, outdir: path.join(OUT, '9x16', 'big-card') });
  const vSeg = renderStill({ page: 'templates/segment.html', width: 1080, height: 1920, t: 1.2, outdir: path.join(OUT, '9x16', 'segment') });
  for (const [name, r] of [['big-card', vBig], ['segment', vSeg]]) {
    check(`9:16 ${name} still 产出`, r.ok && fileSize(r.file) > 5000, `${r.file} (${fileSize(r.file)} B)`);
    if (r.ok) {
      const dim = probeSize(r.file);
      check(`9:16 ${name} ffprobe === 1080×1920`, dim.ok && dim.width === 1080 && dim.height === 1920,
        dim.ok ? `${dim.width}x${dim.height}` : dim.error);
    }
  }

  // ---------- 3. 1080×1080 still ----------
  section('1:1 still（render-segment --width 1080 --height 1080 + ffprobe）');
  const sBig = renderStill({ page: 'templates/big-card.html', width: 1080, height: 1080, t: 0.5, outdir: path.join(OUT, '1x1', 'big-card') });
  const sSeg = renderStill({ page: 'templates/segment.html', width: 1080, height: 1080, t: 1.2, outdir: path.join(OUT, '1x1', 'segment') });
  for (const [name, r] of [['big-card', sBig], ['segment', sSeg]]) {
    check(`1:1 ${name} still 产出`, r.ok && fileSize(r.file) > 5000, `${r.file} (${fileSize(r.file)} B)`);
    if (r.ok) {
      const dim = probeSize(r.file);
      check(`1:1 ${name} ffprobe === 1080×1080`, dim.ok && dim.width === 1080 && dim.height === 1080,
        dim.ok ? `${dim.width}x${dim.height}` : dim.error);
    }
  }

  // ---------- 4. 页面内断言（9:16） ----------
  section('9:16 页面断言（canvas / __hit / rect 边界 / __inspect）');
  const server = createStaticServer(ROOT);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;

  let browser = null;
  try {
    browser = await launchRetry({ executablePath: chrome, width: 1080, height: 1920, timeout: 40000 });
    const bigAudit = await auditPage(browser, origin, {
      pagePath: '/templates/big-card.html?seg=1&t0=0&speed=1&dur=1',
      t: 1.0,
      expectIds: ['card.first', 'card.keyword', 'card.color', 'card.index', 'card.brand', 'card.layout'],
      probeIds: ['card.first', 'card.keyword'],
    });
    reportAudit('9:16 big-card', bigAudit, { width: 1080, height: 1920 });

    const segAudit = await auditPage(browser, origin, {
      pagePath: `/templates/segment.html?${SEG_AUDIT_QS}`,
      t: 1.2,
      expectIds: ['title.main', 'title.sub', 'hud.capsule', 'hud.countdown', 'hud.stamp'],
      probeIds: ['title.main', 'hud.capsule', 'hud.countdown'],
    });
    reportAudit('9:16 segment', segAudit, { width: 1080, height: 1920 });

    // 方形：同一浏览器换视口，确认 canvas 跟随且命中表不越界。
    section('1:1 页面断言（canvas / rect 边界）');
    await browser.client.send('Emulation.setDeviceMetricsOverride', {
      width: 1080, height: 1080, deviceScaleFactor: 1, mobile: false,
      screenWidth: 1080, screenHeight: 1080,
    }, browser.sessionId);
    const sqBig = await auditPage(browser, origin, {
      pagePath: '/templates/big-card.html?seg=1&t0=0&speed=1&dur=1',
      t: 1.0,
      expectIds: ['card.first', 'card.keyword'],
      probeIds: ['card.first', 'card.keyword'],
    });
    reportAudit('1:1 big-card', sqBig, { width: 1080, height: 1080 });
    const sqSeg = await auditPage(browser, origin, {
      pagePath: `/templates/segment.html?${SEG_AUDIT_QS}`,
      t: 1.2,
      expectIds: ['title.main', 'hud.capsule'],
      probeIds: ['title.main', 'hud.capsule'],
    });
    reportAudit('1:1 segment', sqSeg, { width: 1080, height: 1080 });
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('RESULT: FAIL');
    process.exitCode = 1;
  } else {
    console.log('RESULT: PASS');
    process.exitCode = 0;
  }
}

main().catch((e) => {
  console.error('[fatal]', e && e.stack || e);
  process.exit(1);
});
