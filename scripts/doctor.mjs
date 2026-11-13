#!/usr/bin/env node
/**
 * doctor.mjs — one-command environment check for the skill.
 *
 *   node scripts/doctor.mjs            # human table
 *   node scripts/doctor.mjs --json     # machine-readable (+ cliVersion / resolved paths)
 *   node scripts/doctor.mjs --strict   # exit 1 when *anything* is missing (including optional)
 *
 * v2.3.5:
 *   - Node 22+ 是默认渲染路径的硬要求（raw CDP 依赖全局 WebSocket）；
 *   - 增加 renderer 能力探测（chrome + playwright/websocket），不再被「playwright 已安装」
 *     误导成「能渲染」——playwright-core 不带浏览器；
 *   - 增加 bash（带音频的 build 走 concat-and-encode.sh）；
 *   - 每行给 code / fix，--json 顶层给 cliVersion 与 resolved 绝对路径。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { browserCandidates } from '../templates/cdp.mjs';

const CLI_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; }
  catch { return '0.0.0'; }
})();

const args = process.argv.slice(2);
const json = args.includes('--json');
const strict = args.includes('--strict');
const rows = [];
const add = (group, name, ok, detail, required = true, extra = {}) =>
  rows.push({ group, name, ok, detail, required, ...extra });

function run(cmd, a = []) {
  const r = spawnSync(cmd, a, { encoding: 'utf8', windowsHide: true });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim(), status: r.status, error: r.error };
}

// ── runtime ────────────────────────────────────────────────────────────────
const nodeMajor = Number(process.versions.node.split('.')[0]);
add('runtime', 'node', nodeMajor >= 22, `v${process.versions.node} (need ≥ 22)`, true, {
  code: 'E_NODE',
  fix: 'install Node 22+ (nvm use 22 / winget install OpenJS.NodeJS.LTS)',
});
add('runtime', 'os', true, `${process.platform} ${process.arch}, ${os.cpus().length} cpus`, false);

// ── ffmpeg ─────────────────────────────────────────────────────────────────
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const ff = run(FFMPEG, ['-version']);
const ffLine = ff.out.split('\n')[0] || 'not found';
add('ffmpeg', 'ffmpeg', ff.ok, ffLine, true, { code: 'E_NO_FFMPEG', fix: 'winget install Gyan.FFmpeg / apt install ffmpeg' });
if (ff.ok) {
  const enc = run(FFMPEG, ['-hide_banner', '-encoders']);
  add('ffmpeg', 'libx264', /libx264/.test(enc.out), 'H.264 encoder', true, { code: 'E_NO_X264', fix: 'use a full ffmpeg build (gyan.dev full)' });
  add('ffmpeg', 'aac', /\baac\b/.test(enc.out), 'AAC encoder', true, { code: 'E_NO_AAC', fix: 'use a full ffmpeg build' });
  add('ffmpeg', 'libvmaf', /libvmaf/.test(enc.out) || /vmaf/.test(enc.out), 'optional QA metric', false, {
    code: 'W_NO_VMAF', fix: 'optional: use a ffmpeg build with libvmaf',
  });
  const filt = run(FFMPEG, ['-hide_banner', '-filters']);
  add('ffmpeg', 'loudnorm', /loudnorm/.test(filt.out), 'EBU R128 filter', true, { code: 'E_NO_LOUDNORM', fix: 'use a full ffmpeg build' });
  add('ffmpeg', 'blackdetect/freezedetect', /blackdetect/.test(filt.out) && /freezedetect/.test(filt.out), 'QA filters', true, {
    code: 'E_NO_QA_FILTERS', fix: 'use a full ffmpeg build',
  });
}
const fp = run(FFPROBE, ['-version']);
add('ffmpeg', 'ffprobe', fp.ok, fp.ok ? fp.out.split('\n')[0] : 'not found', true, {
  code: 'E_NO_FFPROBE', fix: 'install ffmpeg (ffprobe ships with it)',
});

// ── renderer ───────────────────────────────────────────────────────────────
const candidates = browserCandidates();
let pw = false;
try { await import('playwright'); pw = true; } catch { try { await import('playwright-core'); pw = true; } catch { /* none */ } }
const hasWs = typeof WebSocket !== 'undefined';
add('browser', 'chrome/edge', candidates.length > 0, candidates[0] || 'not found (set CHROME_EXE to an absolute path)', true, {
  code: 'E_NO_CHROME', fix: 'install Chrome/Edge or set CHROME_EXE=/absolute/path/to/chrome',
});
add('browser', 'playwright', pw, pw ? 'installed (optional)' : 'not installed; raw CDP fallback will be used', false, {
  code: 'W_NO_PLAYWRIGHT', fix: 'optional: npm i playwright-core (raw CDP works without it)',
});
add('browser', 'node WebSocket', hasWs,
  hasWs ? 'available (raw CDP)' : 'missing; Node <22 has no global WebSocket', !pw, {
    code: 'E_NO_WEBSOCKET', fix: 'use Node 22+ or install Playwright',
  });
// 真正的渲染能力：有浏览器 + (playwright 或 全局 WebSocket)。
// 只装 playwright-core 但没有浏览器时，旧的 doctor 会误报绿灯。
add('browser', 'renderer', candidates.length > 0 && (pw || hasWs),
  `chrome=${candidates[0] ? 'yes' : 'no'} playwright=${pw ? 'yes' : 'no'} websocket=${hasWs ? 'yes' : 'no'}`,
  true, {
    code: 'E_RENDERER',
    fix: 'use Node 22+ with system Chrome, or install Playwright with browsers (`npx playwright install chromium`)',
  });

// ── shell / python ─────────────────────────────────────────────────────────
const BASH = process.env.BASH || 'bash';
const bash = run(BASH, ['--version']);
add('shell', 'bash', bash.ok, bash.ok ? bash.out.split('\n')[0] : 'not found (needed for --audio concat)', true, {
  code: 'E_NO_BASH', fix: 'Windows: install Git for Windows (Git Bash); Linux/macOS: built-in',
});

const PYTHON = process.env.PYTHON || 'python';
const py = run(PYTHON, ['--version']);
add('python', 'python', py.ok, py.ok ? py.out : 'not found (needed for synth_audio.py + qa-audio.py)', true, {
  code: 'E_NO_PYTHON', fix: 'install Python 3.10+ and `pip install numpy scipy`',
});
if (py.ok) {
  const mods = run(PYTHON, ['-c', 'import numpy,scipy;print("numpy",numpy.__version__,"scipy",scipy.__version__)']);
  add('python', 'numpy+scipy', mods.ok, mods.ok ? mods.out : 'pip install numpy scipy', true, {
    code: 'E_NO_NUMPY', fix: `"${PYTHON}" -m pip install numpy scipy`,
  });
  const plt = run(PYTHON, ['-c', 'import matplotlib;print(matplotlib.__version__)']);
  add('python', 'matplotlib', plt.ok, plt.ok ? `v${plt.out}` : 'optional (spectrogram PNG)', false, {
    code: 'W_NO_MATPLOTLIB', fix: `"${PYTHON}" -m pip install matplotlib`,
  });
}

// ── project assets ─────────────────────────────────────────────────────────
const root = process.cwd();
// 容器镜像里可以把字体交给系统（fonts-noto-cjk）；此时 shared/fonts 缺失不算硬失败。
const allowSystemFonts = process.env.CVS_ALLOW_SYSTEM_FONTS === '1';
for (const [name, p, required, code] of [
  ['templates/common.js', 'templates/common.js', true, 'E_ASSET'],
  ['templates/motion.js', 'templates/motion.js', true, 'E_ASSET'],
  ['templates/motion-profile.mjs', 'templates/motion-profile.mjs', true, 'E_ASSET'],
  ['templates/color.js', 'templates/color.js', true, 'E_ASSET'],
  ['templates/themes.js', 'templates/themes.js', true, 'E_ASSET'],
  ['shared/fonts.css', 'shared/fonts.css', !allowSystemFonts, 'E_NO_FONTS_CSS'],
  ['shared/fonts/', 'shared/fonts', !allowSystemFonts, 'E_NO_FONTS'],
  ['timeline.json', 'timeline.json', false, 'W_NO_TIMELINE'],
]) {
  const exists = fs.existsSync(path.join(root, p));
  if (name === 'shared/fonts/') {
    const n = exists ? fs.readdirSync(path.join(root, p)).filter((f) => /\.(woff2?|ttf|otf)$/i.test(f)).length : 0;
    add('assets', name, n > 0, `${n} font files`, required, {
      code, fix: 'download the fonts bundle (`node scripts/bundle-fonts.mjs` on a machine with node_modules)',
    });
  } else {
    add('assets', name, exists, exists ? 'ok' : 'missing', required, { code, fix: `restore ${p} from the release` });
  }
}
try {
  // 字体锁（v2.4 / P1-07）：字体集合必须是可验证的固定集合，而不是「装了哪些算哪些」。
  const lockPath = path.join(root, 'shared', 'fonts.lock.json');
  let lock = null;
  try { lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { /* missing/broken */ }
  const fontDir = path.join(root, 'shared', 'fonts');
  const actual = fs.existsSync(fontDir)
    ? fs.readdirSync(fontDir).filter((f) => /\.(woff2?|ttf|otf)$/i.test(f)).length
    : 0;
  const countOk = !lock || !actual || Number(lock.count) === actual;
  add('assets', 'shared/fonts.lock.json', !!lock && countOk, lock
    ? `${lock.count} files, set ${String(lock.setSha256 || '').slice(0, 12)}${countOk ? '' : ` (on disk: ${actual})`}`
    : 'missing', !allowSystemFonts, {
    code: 'E_NO_FONT_LOCK',
    fix: 'node scripts/bundle-fonts.mjs --lock-only',
  });
} catch { /* best effort */ }
try {
  const st = fs.statfsSync ? fs.statfsSync(root) : null;
  if (st) {
    const freeGb = (Number(st.bavail) * Number(st.bsize)) / 1024 ** 3;
    add('disk', 'free space', freeGb > 2, `${freeGb.toFixed(1)} GB`, false, { code: 'W_DISK', fix: 'free at least 2 GB' });
  }
} catch { /* statfs optional */ }

const failed = rows.filter((r) => r.required && !r.ok);
const warnings = rows.filter((r) => !r.required && !r.ok);
const strictFailed = strict ? rows.filter((r) => !r.ok) : failed;

const resolved = {
  node: process.execPath,
  ffmpeg: ff.ok ? ffLine.replace(/^ffmpeg version\s*/i, '').split(' ')[0] : null,
  ffprobe: fp.ok ? 'ok' : null,
  chrome: candidates[0] || null,
  bash: bash.ok ? BASH : null,
  python: py.ok ? py.out : null,
  playwright: pw,
  websocket: hasWs,
};

if (json) {
  console.log(JSON.stringify({
    ok: failed.length === 0,
    cliVersion: CLI_VERSION,
    strict,
    resolved,
    rows,
    failed: failed.length,
    warnings: warnings.length,
    strictFailed: strictFailed.length,
  }, null, 2));
} else {
  let group = '';
  for (const r of rows) {
    if (r.group !== group) { group = r.group; console.log(`\n■ ${group}`); }
    const mark = r.ok ? '✓' : (r.required ? '✗' : '·');
    console.log(`  ${mark} ${r.name.padEnd(22)} ${r.detail}${r.ok ? '' : `\n      ${r.code}: ${r.fix}`}`);
  }
  console.log(`\n${failed.length ? `✗ ${failed.length} required item(s) missing` : '✓ environment ready'}${warnings.length ? `  (${warnings.length} optional missing)` : ''}`);
  console.log(`  cli ${CLI_VERSION} · ${process.platform} · node ${process.versions.node}`);
}
process.exit(strictFailed.length ? 1 : (failed.length ? 1 : 0));
