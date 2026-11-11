#!/usr/bin/env node
/**
 * doctor.mjs — one-command environment check for the skill.
 *
 *   node scripts/doctor.mjs            # human table
 *   node scripts/doctor.mjs --json     # machine-readable
 *   node scripts/doctor.mjs --strict   # exit 1 on any missing required item
 *
 * Required: Node ≥ 20, ffmpeg/ffprobe with libx264 + AAC, a Chrome/Edge/Chromium
 * binary (Playwright is optional thanks to the raw-CDP fallback), Python 3 with
 * numpy + scipy (for the synthesized soundtrack and audio QA).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { browserCandidates } from '../templates/cdp.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const strict = args.includes('--strict');
const rows = [];
const add = (group, name, ok, detail, required = true) => rows.push({ group, name, ok, detail, required });

function run(cmd, a = []) {
  const r = spawnSync(cmd, a, { encoding: 'utf8', windowsHide: true });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim(), status: r.status };
}

// Node
const nodeMajor = Number(process.versions.node.split('.')[0]);
add('runtime', 'node', nodeMajor >= 20, `v${process.versions.node} (need ≥ 20)`);
add('runtime', 'os', true, `${process.platform} ${process.arch}, ${os.cpus().length} cpus`, false);

// ffmpeg
const ff = run(process.env.FFMPEG || 'ffmpeg', ['-version']);
const ffLine = ff.out.split('\n')[0] || 'not found';
add('ffmpeg', 'ffmpeg', ff.ok, ffLine);
if (ff.ok) {
  const enc = run(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-encoders']);
  add('ffmpeg', 'libx264', /libx264/.test(enc.out), 'H.264 encoder');
  add('ffmpeg', 'aac', /\baac\b/.test(enc.out), 'AAC encoder');
  add('ffmpeg', 'libvmaf', /libvmaf/.test(enc.out) || /vmaf/.test(enc.out), 'optional QA metric', false);
  const filt = run(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-filters']);
  add('ffmpeg', 'loudnorm', /loudnorm/.test(filt.out), 'EBU R128 filter');
  add('ffmpeg', 'blackdetect/freezedetect', /blackdetect/.test(filt.out) && /freezedetect/.test(filt.out), 'QA filters');
}
const fp = run(process.env.FFPROBE || 'ffprobe', ['-version']);
add('ffmpeg', 'ffprobe', fp.ok, fp.ok ? fp.out.split('\n')[0] : 'not found');

// browser
const candidates = browserCandidates();
add('browser', 'chrome/edge', candidates.length > 0, candidates[0] || 'not found (set CHROME_EXE)');
let pw = false;
try { await import('playwright'); pw = true; } catch { try { await import('playwright-core'); pw = true; } catch { /* none */ } }
add('browser', 'playwright', pw, pw ? 'installed (optional)' : 'not installed; raw CDP fallback will be used', false);
add('browser', 'node WebSocket', typeof WebSocket !== 'undefined',
  typeof WebSocket !== 'undefined' ? 'available (raw CDP)' : 'missing; use Node ≥22 or install Playwright', !pw);

// python
const py = run(process.env.PYTHON || 'python', ['--version']);
add('python', 'python', py.ok, py.ok ? py.out : 'not found (needed for synth_audio.py + qa-audio.py)');
if (py.ok) {
  const pyBin = process.env.PYTHON || 'python';
  const mods = run(pyBin, ['-c', 'import numpy,scipy;print("numpy",numpy.__version__,"scipy",scipy.__version__)']);
  add('python', 'numpy+scipy', mods.ok, mods.ok ? mods.out : 'pip install numpy scipy');
  const plt = run(pyBin, ['-c', 'import matplotlib;print(matplotlib.__version__)']);
  add('python', 'matplotlib', plt.ok, plt.ok ? `v${plt.out}` : 'optional (spectrogram PNG)', false);
}

// project assets
const root = process.cwd();
for (const [name, p, required] of [
  ['templates/common.js', 'templates/common.js', true],
  ['templates/motion.js', 'templates/motion.js', true],
  ['templates/motion-profile.mjs', 'templates/motion-profile.mjs', true],
  ['templates/color.js', 'templates/color.js', true],
  ['templates/themes.js', 'templates/themes.js', true],
  ['shared/fonts.css', 'shared/fonts.css', true],
  ['shared/fonts/', 'shared/fonts', true],
  ['timeline.json', 'timeline.json', false],
]) {
  const exists = fs.existsSync(path.join(root, p));
  if (name === 'shared/fonts/') {
    const n = exists ? fs.readdirSync(path.join(root, p)).filter((f) => /\.(woff2?|ttf|otf)$/i.test(f)).length : 0;
    add('assets', name, n > 0, `${n} font files`, required);
  } else {
    add('assets', name, exists, exists ? 'ok' : 'missing', required);
  }
}
try {
  const st = fs.statfsSync ? fs.statfsSync(root) : null;
  if (st) {
    const freeGb = (Number(st.bavail) * Number(st.bsize)) / 1024 ** 3;
    add('disk', 'free space', freeGb > 2, `${freeGb.toFixed(1)} GB`, false);
  }
} catch { /* statfs optional */ }

const failed = rows.filter((r) => r.required && !r.ok);
const warnings = rows.filter((r) => !r.required && !r.ok);

if (json) {
  console.log(JSON.stringify({ ok: failed.length === 0, rows, failed: failed.length, warnings: warnings.length }, null, 2));
} else {
  let group = '';
  for (const r of rows) {
    if (r.group !== group) { group = r.group; console.log(`\n■ ${group}`); }
    const mark = r.ok ? '✓' : (r.required ? '✗' : '·');
    console.log(`  ${mark} ${r.name.padEnd(22)} ${r.detail}`);
  }
  console.log(`\n${failed.length ? `✗ ${failed.length} required item(s) missing` : '✓ environment ready'}${warnings.length ? `  (${warnings.length} optional missing)` : ''}`);
}
if (strict && failed.length) process.exit(1);
if (failed.length) process.exit(1);
