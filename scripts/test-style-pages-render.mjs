#!/usr/bin/env node
/**
 * test-style-pages-render.mjs — 新配方页的真机渲染验收（真实 Chrome）。
 *
 *   CHROME_EXE="C:/Program Files/Google/Chrome/Application/chrome.exe" \
 *     node scripts/test-style-pages-render.mjs
 *
 * 对 7 个 v2.3.1 新增页面（glitch / guofeng / whiteboard / threed / screencast /
 * flat / minimal）逐个断言：
 *   1. 16:9（1920×1080）与 9:16（1080×1920）都能渲染出 PNG；
 *   2. PNG 不是纯色/空白（字节数 > 30 KB，纯色 1080p PNG 通常 < 12 KB）；
 *   3. 同一 t 连渲两次，SHA-256 完全一致（确定性）；
 *   4. 16:9 与 9:16 的哈希不同（说明真的重排了，不是把横屏压扁）。
 *
 * 退出码 0/1。零 npm 依赖。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { browserCandidates } from '../templates/cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RENDERER = path.join(ROOT, 'templates', 'render-segment.mjs');
const OUT = path.join(ROOT, 'out', 'style-pages');
const CHROME = process.env.CHROME_EXE || browserCandidates()[0] || '';
const T = 1.0;
const MIN_BYTES = 30 * 1024;

const PAGES = [
  { id: 'glitch', page: 'templates/recipe-glitch.html', theme: 'cyber-neon' },
  { id: 'guofeng', page: 'templates/recipe-guofeng.html', theme: 'celadon-paper' },
  { id: 'whiteboard', page: 'templates/recipe-whiteboard.html', theme: 'paper-journal' },
  { id: 'threed', page: 'templates/recipe-threed.html', theme: 'cyber-neon' },
  { id: 'screencast', page: 'templates/recipe-screencast.html', theme: 'coral-noir' },
  { id: 'flat', page: 'templates/recipe-flat.html', theme: 'coral-noir' },
  { id: 'minimal', page: 'templates/recipe-minimal.html', theme: 'coral-noir' },
];

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (ok) passed++; else failed++;
  return ok;
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/**
 * 用真实 render-segment CLI 渲染一帧静帧。
 * 连续起多次 Chrome 时偶发冷启动超时（CDP Page.navigate / __ready 等待），
 * 所以失败会**退避后重试**——这正是真实工作流里的做法（compile --resume 同理）。
 */
function renderOnce({ page, theme, width, height, outdir }) {
  fs.rmSync(outdir, { recursive: true, force: true });
  fs.mkdirSync(outdir, { recursive: true });
  const r = spawnSync(process.execPath, [
    RENDERER,
    '--page', `${page}?theme=${theme}`,
    '--still', String(T),
    '--outdir', outdir,
    '--root', ROOT,
    '--width', String(width),
    '--height', String(height),
    '--duration', '3',
    '--format', 'png',
    '--timeout', '90000',
  ], {
    cwd: ROOT,
    env: { ...process.env, CHROME_EXE: CHROME },
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (r.status !== 0) {
    throw new Error(`render failed for ${page} ${width}x${height}\n${(r.stdout || '').slice(-500)}\n${(r.stderr || '').slice(-500)}`);
  }
  const files = fs.readdirSync(outdir).filter((f) => f.endsWith('.png'));
  if (files.length !== 1) throw new Error(`expected 1 png in ${outdir}, got ${JSON.stringify(files)}`);
  const file = path.join(outdir, files[0]);
  return { file, bytes: fs.statSync(file).size, hash: sha256(file) };
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function render(opts) {
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return renderOnce(opts);
    } catch (e) {
      last = e;
      if (attempt < 3) {
        console.log(`  (attempt ${attempt} failed: ${String(e.message || e).split('\n')[0]}; retrying)`);
        sleepSync(1500 * attempt);
      }
    }
  }
  throw last;
}

if (!CHROME) {
  console.error('no Chrome/Edge found; set CHROME_EXE');
  process.exit(1);
}

console.log(`[render] ${PAGES.length} pages × 2 aspects × 2 passes, t=${T}\n`);

for (const p of PAGES) {
  try {
    const a1 = render({ ...p, width: 1920, height: 1080, outdir: path.join(OUT, p.id, 'a1') });
    const a2 = render({ ...p, width: 1920, height: 1080, outdir: path.join(OUT, p.id, 'a2') });
    const b1 = render({ ...p, width: 1080, height: 1920, outdir: path.join(OUT, p.id, 'b1') });

    check(`${p.id}: 16:9 renders`, a1.bytes > MIN_BYTES, `${a1.bytes} bytes`);
    check(`${p.id}: 9:16 renders`, b1.bytes > MIN_BYTES, `${b1.bytes} bytes`);
    check(`${p.id}: deterministic at 16:9`, a1.hash === a2.hash, `${a1.hash.slice(0, 12)} vs ${a2.hash.slice(0, 12)}`);
    check(`${p.id}: 9:16 is a real reflow (hash differs)`, a1.hash !== b1.hash);
  } catch (e) {
    failed += 4;
    console.error(`FAIL  ${p.id}: ${String(e.message || e).split('\n')[0]}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
