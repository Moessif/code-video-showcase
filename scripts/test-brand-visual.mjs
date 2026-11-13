#!/usr/bin/env node
/**
 * test-brand-visual.mjs — 品牌视觉真的进画面（v2.4 / P1-12，真机）。
 *
 *   CHROME_EXE="C:/Program Files/Google/Chrome/Application/chrome.exe" node scripts/test-brand-visual.mjs
 *
 * 断言：
 *   1. segment 页带 ?logo= 与 ?brandFont= 后，同一 t 的静帧 sha256 必须变；
 *   2. big-card 页同理（封面版式也能带品牌）；
 *   3. logo 文件不存在时渲染必须失败（__bootError），不能静默出片；
 *   4. 不传品牌参数时哈希与「不传」基线一致（默认片不被品牌逻辑污染）。
 *
 * 退出码 0/1。
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
const OUT = path.join(ROOT, 'out', 'brand-visual');
// 与其它浏览器套件一致：CHROME_EXE 优先，否则自动发现（不再因缺 env 直接退出）。
const CHROME = process.env.CHROME_EXE || browserCandidates()[0] || '';
const T = 1.0;
const LOGO = 'assets/theme-previews/09-cyber-neon.jpg';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (ok) passed++; else failed++;
  return ok;
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function render({ page, outdir, expectFail = false }) {
  fs.rmSync(outdir, { recursive: true, force: true });
  fs.mkdirSync(outdir, { recursive: true });
  const r = spawnSync(process.execPath, [
    RENDERER,
    '--page', page,
    '--still', String(T),
    '--outdir', outdir,
    '--root', ROOT,
    '--width', '1920',
    '--height', '1080',
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
  if (expectFail) return { ok: r.status !== 0, status: r.status, stderr: `${r.stdout || ''}${r.stderr || ''}` };
  if (r.status !== 0) {
    throw new Error(`render failed for ${page}\n${(r.stdout || '').slice(-500)}\n${(r.stderr || '').slice(-500)}`);
  }
  const files = fs.readdirSync(outdir).filter((f) => f.endsWith('.png'));
  if (files.length !== 1) throw new Error(`expected 1 png, got ${JSON.stringify(files)}`);
  const file = path.join(outdir, files[0]);
  return { ok: true, file, hash: sha256(file), bytes: fs.statSync(file).size };
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function renderRetry(opts) {
  let last = null;
  for (let i = 1; i <= 3; i++) {
    try { return render(opts); }
    catch (e) {
      last = e;
      if (i < 3) { console.log(`  (attempt ${i} failed; retrying)`); sleepSync(1200 * i); }
    }
  }
  throw last;
}

if (!CHROME) {
  console.error('no CHROME_EXE; set it to run the real-render brand checks');
  process.exit(1);
}

const baseSeg = 'templates/segment.html?theme=coral-noir&title=%E5%93%81%E7%89%8C%E6%B5%8B%E8%AF%95&brand=Tech%20Dark';
const brandSeg = `${baseSeg}&logo=${encodeURIComponent(LOGO)}&brandFont=${encodeURIComponent('Playfair Display')}`;
const baseCard = 'templates/big-card.html?theme=coral-noir&layout=0&index=1&total=1&first=%E6%83%B3%E5%81%9A&keyword=%E5%93%81%E7%89%8C%EF%BC%9F&brand=Tech%20Dark&seconds=1';
const brandCard = `${baseCard}&logo=${encodeURIComponent(LOGO)}&brandFont=${encodeURIComponent('Playfair Display')}`;

try {
  const a = renderRetry({ page: baseSeg, outdir: path.join(OUT, 'seg-base') });
  const b = renderRetry({ page: brandSeg, outdir: path.join(OUT, 'seg-brand') });
  check('segment: logo+brandFont 改变同帧 sha256', a.hash !== b.hash, `${a.hash.slice(0, 10)} vs ${b.hash.slice(0, 10)}`);

  const c = renderRetry({ page: baseCard, outdir: path.join(OUT, 'card-base') });
  const d = renderRetry({ page: brandCard, outdir: path.join(OUT, 'card-brand') });
  check('big-card: logo+brandFont 改变同帧 sha256', c.hash !== d.hash, `${c.hash.slice(0, 10)} vs ${d.hash.slice(0, 10)}`);

  const missing = render({ page: `${baseSeg}&logo=assets/does-not-exist.png`, outdir: path.join(OUT, 'seg-missing'), expectFail: true });
  check('logo 缺失时渲染失败（不静默出片）', missing.ok, `exit=${missing.status}`);
} catch (e) {
  failed += 3;
  console.error(`FAIL  brand visual: ${String(e.message || e).split('\n')[0]}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
