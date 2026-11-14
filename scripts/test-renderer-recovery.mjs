#!/usr/bin/env node
/**
 * test-renderer-recovery.mjs — 浏览器失败/重启路径的回归（真实 Chrome）。
 *
 *   CHROME_EXE="C:/Program Files/Google/Chrome/Application/chrome.exe" node scripts/test-renderer-recovery.mjs
 *
 * 背景：一个页面在 renderFrame 里抛错，曾经让整条流水线空等 141s 才失败，而且报的是
 * 误导性的 "renderer is not running"。三个独立缺陷叠在一起：
 *   1. 复用 persistent profile 时，上一轮的 DevToolsActivePort 没删 → 等待循环第一轮
 *      就读到旧端口，connect() 对着死 ws 重试满 timeout；
 *   2. Windows 上 proc.kill() 只杀父进程，renderer/GPU 子进程活下来占着 profile 锁；
 *   3. 浏览器**启动**超时继承了页面 ready 的 120s 预算。
 *
 * 断言（全部真实执行）：
 *   1. 陈旧 DevToolsActivePort 被忽略：预置 bogus 端口后仍能起浏览器并 evaluate
 *   2. close() 收干净进程树：没有任何 chrome 进程还持有该 profile
 *   3. 同一 profile 关掉再起来能成功，且远快于启动超时（回归前会烧满 timeout）
 *   4. withRenderer.restart() 换用全新 profile 目录，并且重启后还能真的开页面
 *   5. launchTimeout 与 timeout 相互独立（默认 30000 / 120000，CLI 可覆盖）
 *
 * 退出码 0/1。零 npm 依赖。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, evaluate, browserCandidates } from '../templates/cdp.mjs';
import { withRenderer, normalizeOptions, optionsFromArgs } from '../templates/render-segment.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CHROME = process.env.CHROME_EXE || browserCandidates()[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
  return ok;
}

function section(title) { console.log(`\n--- ${title} ---`); }

/** 还有哪些浏览器进程持有这个 profile？（按命令行匹配，不碰用户自己的浏览器） */
function orphansFor(profileDir) {
  const needle = path.resolve(profileDir);
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `@(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' or Name='msedge.exe' or Name='chromium.exe'" | Where-Object { $_.CommandLine -like '*${needle.replace(/'/g, "''")}*' }).Count`,
      ], { encoding: 'utf8', timeout: 30000, windowsHide: true });
      const n = parseInt(String(r.stdout || '').trim(), 10);
      return Number.isFinite(n) ? n : -1;
    }
    const r = spawnSync('ps', ['-eo', 'args'], { encoding: 'utf8', timeout: 15000 });
    return String(r.stdout || '').split('\n').filter((l) => l.includes(needle)).length;
  } catch { return -1; }
}

async function main() {
  if (!CHROME) {
    console.error('[fatal] no Chrome found; set CHROME_EXE');
    process.exit(1);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cvs-recovery-'));
  const profile = path.join(tmp, 'profile');
  fs.mkdirSync(profile, { recursive: true });

  // ── 5. 静态契约：两个超时互不继承 ───────────────────────────────────────────
  section('launch timeout is separate from page timeout');
  const def = normalizeOptions({ root: ROOT });
  check('默认 timeout=120000', def.timeout === 120000, String(def.timeout));
  check('默认 launchTimeout=30000', def.launchTimeout === 30000, String(def.launchTimeout));
  const big = normalizeOptions({ root: ROOT, timeout: 600000 });
  check('把页面超时拉到 600s 不会连带拉长启动超时', big.launchTimeout === 30000, String(big.launchTimeout));
  const cli = optionsFromArgs({ 'launch-timeout': '5000', timeout: '90000' });
  check('CLI --launch-timeout 生效', cli.launchTimeout === 5000 && cli.timeout === 90000, `${cli.launchTimeout}/${cli.timeout}`);

  let browser = null;
  try {
    // ── 1. 陈旧 DevToolsActivePort ────────────────────────────────────────────
    section('stale DevToolsActivePort is ignored');
    fs.writeFileSync(path.join(profile, 'DevToolsActivePort'), '9\n/devtools/browser/deadbeef\n');
    const t0 = Date.now();
    browser = await launch({ executablePath: CHROME, width: 640, height: 360, timeout: 45000, profileDir: profile });
    const launchMs = Date.now() - t0;
    const portFile = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/);
    const realPort = parseInt(portFile[0], 10);
    check('预置 bogus 端口后仍然起得来', !!browser && !!browser.client, `${launchMs}ms`);
    check('用的是新端口而不是陈旧的 9', realPort !== 9 && realPort > 0, `port=${realPort}`);
    const sum = await evaluate(browser.client, browser.sessionId, () => 1 + 1);
    check('CDP 会话真的可用', sum === 2, String(sum));

    // ── 2. close() 收进程树 ───────────────────────────────────────────────────
    section('close reaps the whole process tree');
    await browser.close();
    browser = null;
    await sleep(600);
    const left = orphansFor(profile);
    check('close 后没有进程还持有该 profile', left === 0, `orphans=${left}`);

    // ── 3. 同 profile 重启（回归前这里会烧满 timeout）─────────────────────────
    section('relaunch on the same profile');
    const t1 = Date.now();
    browser = await launch({ executablePath: CHROME, width: 640, height: 360, timeout: 45000, profileDir: profile });
    const relaunchMs = Date.now() - t1;
    check('同一 profile 关掉再起来能成功', !!browser && !!browser.client, `${relaunchMs}ms`);
    check('重启远快于启动超时（45s 预算）', relaunchMs < 20000, `${relaunchMs}ms`);
    const sum2 = await evaluate(browser.client, browser.sessionId, () => 6 * 7);
    check('重启后的会话可用', sum2 === 42, String(sum2));
    await browser.close();
    browser = null;
    await sleep(400);
    check('第二次 close 同样收干净', orphansFor(profile) === 0);
  } catch (e) {
    failed++;
    console.error(`FAIL  cdp recovery: ${String(e.message || e).split('\n')[0]}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  // ── 4. withRenderer.restart() ───────────────────────────────────────────────
  section('withRenderer.restart()');
  const workProfile = path.join(tmp, 'renderer-profile');
  const pageRel = path.join('out', 'recovery-test', 'page.html').split(path.sep).join('/');
  const pageAbs = path.join(ROOT, pageRel);
  fs.mkdirSync(path.dirname(pageAbs), { recursive: true });
  fs.writeFileSync(pageAbs, [
    '<!doctype html><meta charset="utf-8"><title>recovery</title>',
    '<canvas id="c" width="640" height="360"></canvas>',
    '<script>',
    'window.DURATION = 1;',
    'window.renderFrame = function (t) { const g = document.getElementById("c").getContext("2d");',
    '  g.fillStyle = "#101018"; g.fillRect(0, 0, 640, 360);',
    '  g.fillStyle = "#7ef9ff"; g.fillRect(20 + (t * 100) % 300, 40, 120, 120); };',
    'window.renderFrame(0); window.__ready = true;',
    '</script>',
  ].join('\n'));

  try {
    await withRenderer({
      root: ROOT, browser: CHROME, cdp: true, width: 640, height: 360,
      profileDir: workProfile, log: () => {}, warn: () => {},
    }, async (ctx) => {
      const p1 = await ctx.openPage({ page: pageRel, duration: 1 });
      check('重启前能开页面', p1 && typeof p1.ev === 'function');
      await p1.close().catch(() => {});

      const kind = await ctx.restart();
      check('restart() 成功返回 renderer kind', kind === 'cdp' || kind === 'playwright', String(kind));
      check('restart() 换用了全新 profile 目录', fs.existsSync(`${workProfile}-r1`), `${workProfile}-r1`);

      const p2 = await ctx.openPage({ page: pageRel, duration: 1 });
      const v = await p2.ev(() => { window.renderFrame(0.5); return window.__ready === true; });
      check('重启后还能真的开页面并 renderFrame', v === true);
      await p2.close().catch(() => {});
    });
    await sleep(600);
    check('withRenderer 收尾后不留孤儿', orphansFor(workProfile) === 0 && orphansFor(`${workProfile}-r1`) === 0);
  } catch (e) {
    failed++;
    console.error(`FAIL  withRenderer.restart: ${String(e.message || e).split('\n')[0]}`);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
    try { fs.rmSync(path.dirname(pageAbs), { recursive: true, force: true }); } catch { /* best effort */ }
  }

  // ── 6. 失败渲染必须限时退出（进程级回归）────────────────────────────────────
  // 页面在 renderFrame 里抛错时，ffmpeg 曾活着持有 stdin 管道，进程打印完 done 也不退出。
  // 这里断言的是**子进程真的结束**，不是「日志里出现了错误」——后者挂死时也会出现。
  section('a failing render exits promptly');
  const failDir = path.join(ROOT, 'out', 'renderer-recovery-exit');
  fs.mkdirSync(failDir, { recursive: true });
  const failPage = path.join(failDir, 'page-throws.html');
  fs.writeFileSync(failPage, [
    '<!doctype html><meta charset="utf-8"><body><canvas id="c" width="640" height="360"></canvas>',
    '<script>window.renderFrame = () => { throw new Error("intentional exit-test failure"); };',
    'window.__ready = true;</script></body>',
  ].join('\n'));
  const failOut = path.join(failDir, 'seg.mp4');
  try { fs.unlinkSync(failOut); } catch { /* first run */ }
  const t2 = Date.now();
  const r = spawnSync(process.execPath, [
    path.join(ROOT, 'templates', 'render-segment.mjs'),
    '--page', 'out/renderer-recovery-exit/page-throws.html',
    '--out', failOut, '--duration', '1', '--width', '640', '--height', '360',
    '--root', ROOT, '--cdp',
  ], {
    cwd: ROOT, encoding: 'utf8', timeout: 90000, windowsHide: true,
    env: { ...process.env, CHROME_EXE: CHROME },
  });
  const exitMs = Date.now() - t2;
  const exited = r.status !== null && !r.signal;
  check('抛错页面的渲染进程真的退出了（不是挂死）', exited, `status=${r.status} signal=${r.signal} ${exitMs}ms`);
  check('退出码非 0', exited && r.status !== 0, `status=${r.status}`);
  check('90s 内退出（挂死会吃满 timeout）', exitMs < 90000, `${exitMs}ms`);
  const log = `${r.stdout || ''}${r.stderr || ''}`;
  check('报的是真实页面错误', /intentional exit-test failure/.test(log), log.trim().split('\n').pop() || '');
  try { fs.rmSync(failDir, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('[fatal]', (e && e.stack) || e);
  process.exit(1);
});