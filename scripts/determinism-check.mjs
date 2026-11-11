#!/usr/bin/env node
/**
 * determinism-check.mjs — render the same instant twice in fresh browsers and
 * compare the bytes. Catches Date.now/Math.random/CSS animation leaks and
 * font-loading races before they become a 61 s re-render.
 *
 *   node scripts/determinism-check.mjs
 *   node scripts/determinism-check.mjs --page "templates/segment.html?theme=cyber-neon" --t 0.5
 *   node scripts/determinism-check.mjs --page segments/01.html --t 2.4 --runs 3
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (!next || next.startsWith('--')) args[a.slice(2)] = true;
  else { args[a.slice(2)] = next; i++; }
}
const str = (k, d) => (args[k] === undefined ? d : String(args[k]));
const page = str('page', 'templates/segment.html?theme=coral-noir');
const t = Number(str('t', '0.5'));
const runs = Math.max(2, Number(str('runs', '2')));
const renderer = path.join(ROOT, 'templates/render-segment.mjs');
const projectRoot = path.resolve(str('root', ROOT));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cvshow-determinism-'));
const hashes = [];

try {
  for (let i = 0; i < runs; i++) {
    const outdir = path.join(tmp, `run-${i}`);
    const r = spawnSync(process.execPath, [
      renderer, '--page', page, '--still', String(t), '--outdir', outdir,
      '--root', projectRoot, '--duration', '1',
    ], { cwd: projectRoot, encoding: 'utf8' });
    if (r.status !== 0) {
      console.error(`[run ${i + 1}] failed:\n${(r.stderr || r.stdout).slice(-1200)}`);
      process.exit(1);
    }
    const files = fs.readdirSync(outdir).filter((f) => /^still-/.test(f));
    if (!files.length) { console.error(`[run ${i + 1}] produced no still`); process.exit(1); }
    const file = path.join(outdir, files[0]);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    hashes.push({ file, bytes: fs.statSync(file).size, hash });
    console.log(`[run ${i + 1}] ${files[0]}  ${(hashes[i].bytes / 1024).toFixed(1)} KB  ${hash.slice(0, 16)}`);
  }
} finally {
  // cleanup after the result is printed
  setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } }, 0);
}

const ok = hashes.every((h) => h.hash === hashes[0].hash);
console.log(ok
  ? `\n✓ deterministic: ${runs} runs of t=${t} are byte-identical`
  : `\n✗ NOT deterministic:\n${hashes.map((h, i) => `  run ${i + 1}: ${h.hash}`).join('\n')}`);
if (!ok) process.exit(1);
