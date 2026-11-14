#!/usr/bin/env node
/**
 * test-effects-render.mjs — 共享效果库 canvas 包装的真机验收（真实 Chrome）。
 *
 * 纯核确定性已由 scripts/test-effects.mjs（Node）证明；这里证明 canvas 路径：
 *   1. effects-probe.html 在 16:9 / 9:16 都渲出非空白 PNG；
 *   2. 同一 t 连渲两次 SHA-256 完全一致（逐帧可复现，含粒子/频谱/乱码）；
 *   3. 不同 t 哈希不同（效果真的随时间演化，不是冻帧）；
 *   4. 16:9 与 9:16 哈希不同（真重排）。
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
const OUT = path.join(ROOT, 'out', 'effects-render');
const CHROME = process.env.CHROME_EXE || browserCandidates()[0] || '';
const PAGE = 'templates/effects-probe.html';
const THEME = 'cyber-neon';
const MIN_BYTES = 30 * 1024;

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (ok) passed++; else failed++;
}
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function renderOnce({ t, width, height, outdir }) {
  fs.rmSync(outdir, { recursive: true, force: true });
  fs.mkdirSync(outdir, { recursive: true });
  const r = spawnSync(process.execPath, [
    RENDERER, '--page', `${PAGE}?theme=${THEME}`, '--still', String(t),
    '--outdir', outdir, '--root', ROOT, '--width', String(width), '--height', String(height),
    '--duration', '3', '--format', 'png', '--timeout', '90000',
  ], {
    cwd: ROOT, env: { ...process.env, CHROME_EXE: CHROME }, encoding: 'utf8',
    timeout: 180000, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
  });
  if (r.status !== 0) throw new Error(`render failed ${width}x${height} t=${t}\n${(r.stderr || '').slice(-400)}`);
  const files = fs.readdirSync(outdir).filter((f) => f.endsWith('.png'));
  if (files.length !== 1) throw new Error(`expected 1 png, got ${JSON.stringify(files)}`);
  const file = path.join(outdir, files[0]);
  return { file, bytes: fs.statSync(file).size, hash: sha256(file) };
}
function render(opts) {
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return renderOnce(opts); }
    catch (e) { last = e; if (attempt < 3) { console.log(`  (attempt ${attempt} failed; retrying)`); sleepSync(1500 * attempt); } }
  }
  throw last;
}

if (!CHROME) { console.error('no Chrome/Edge found; set CHROME_EXE'); process.exit(1); }
console.log('[effects-render] probe page × 2 aspects, determinism + evolution\n');

try {
  const a1 = render({ t: 1.0, width: 1920, height: 1080, outdir: path.join(OUT, 'a1') });
  const a2 = render({ t: 1.0, width: 1920, height: 1080, outdir: path.join(OUT, 'a2') });
  const a3 = render({ t: 2.0, width: 1920, height: 1080, outdir: path.join(OUT, 'a3') });
  const b1 = render({ t: 1.0, width: 1080, height: 1920, outdir: path.join(OUT, 'b1') });

  check('16:9 renders non-blank', a1.bytes > MIN_BYTES, `${a1.bytes} bytes`);
  check('9:16 renders non-blank', b1.bytes > MIN_BYTES, `${b1.bytes} bytes`);
  check('deterministic at t=1.0 (16:9)', a1.hash === a2.hash, `${a1.hash.slice(0, 12)} vs ${a2.hash.slice(0, 12)}`);
  check('evolves with t (1.0 != 2.0)', a1.hash !== a3.hash);
  check('9:16 is a real reflow', a1.hash !== b1.hash);
} catch (e) {
  failed += 5;
  console.error(`FAIL  effects-render: ${String(e.message || e).split('\n')[0]}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);