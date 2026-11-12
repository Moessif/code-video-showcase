#!/usr/bin/env node
/**
 * test-image.mjs — `cvs image`（spec → 图片集）的真机验收（v2.3.2）。
 *
 *   CHROME_EXE="C:/Program Files/Google/Chrome/Application/chrome.exe" node scripts/test-image.mjs
 *
 * 覆盖：
 *   1. 预设表结构（尺寸、比例、默认集）
 *   2. heroTime 数学（0.78×时长、上下界、永不超过片尾）
 *   3. `--list` 退出码 0 且列出全部预设
 *   4. 真机出一套图：尺寸正确、非空帧、清单逐项对得上磁盘文件
 *   5. 同参两次 → 逐字节相同（确定性）
 *   6. 换 `--at` → 哈希必须变（帧时间真的生效）
 *   7. 清单带 segment/segmentKind/segmentHash/theme/motion（可做缓存键与溯源）
 *   8. 走 spec 时用的是 plan 的段 URL（theme 一致），不是裸页面
 *
 * 退出码 0/1。需要真实 Chrome + 本仓库的 templates/。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { PRESETS, DEFAULT_SET, heroTime } from './image.mjs';
import { nl2spec } from './nl2spec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const IMAGE = path.join(ROOT, 'scripts', 'image.mjs');
const TMP = path.join(ROOT, 'out', 'test-image');
const CHROME = process.env.CHROME_EXE || '';
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (ok) passed++; else failed++;
  return ok;
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// ── 1/2) 纯逻辑 ─────────────────────────────────────────────────────────────

check('预设表：每项都有正整数的宽高与说明', Object.entries(PRESETS).every(([, v]) =>
  Number.isInteger(v.width) && v.width > 0 && Number.isInteger(v.height) && v.height > 0 && typeof v.note === 'string' && v.note.length > 0));

check('预设表：默认集全部存在', DEFAULT_SET.every((k) => !!PRESETS[k]));
check('预设表：默认集至少含 cover 与一个竖屏', DEFAULT_SET.includes('cover') && DEFAULT_SET.includes('story'));
check('预设表：cover 是横屏、story 是竖屏、card 是方图',
  PRESETS.cover.width > PRESETS.cover.height && PRESETS.story.height > PRESETS.story.width && PRESETS.card.width === PRESETS.card.height);

check('heroTime: 取段落时长的 78%', Math.abs(heroTime(10) - 7.8) < 1e-6, String(heroTime(10)));
check('heroTime: 永远不超过片尾（留 0.05s）', heroTime(1) <= 1 && heroTime(0.3) < 0.3, `${heroTime(1)} / ${heroTime(0.3)}`);
check('heroTime: 极短段落有下限 0.2s', heroTime(0.05) === 0.2, String(heroTime(0.05)));
check('heroTime: 非法输入回落 1.0', heroTime(0) === 1.0 && heroTime(NaN) === 1.0);

// ── 3) --list ───────────────────────────────────────────────────────────────

const listRun = spawnSync(process.execPath, [IMAGE, '--list'], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 60000 });
check('--list 退出码 0', listRun.status === 0, `exit=${listRun.status}`);
check('--list 列出全部预设', Object.keys(PRESETS).every((k) => new RegExp(`^\\s+${k}\\s`, 'm').test(listRun.stdout || '')));

if (!CHROME) {
  console.log('\n(no CHROME_EXE; skipped the render half)');
  console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

// ── 准备 spec ───────────────────────────────────────────────────────────────

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const specPath = path.join(TMP, 'p.spec.json');
fs.writeFileSync(specPath, JSON.stringify(nl2spec('做一条国风宣传片', { style: 'guofeng' }), null, 2) + '\n');

function runImage(outName, extra = []) {
  const out = path.join(TMP, outName);
  const argv = [IMAGE, '--spec', specPath, '--out', out, '--root', ROOT, ...extra];
  const once = () => spawnSync(process.execPath, argv, {
    cwd: ROOT, encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024,
    windowsHide: true, env: { ...process.env, CHROME_EXE: CHROME },
  });
  let r = once();
  if (r.status !== 0) {
    console.log(`  (retry ${outName} after a cold-start failure)`);
    sleepSync(1500);
    r = once();
  }
  if (r.status !== 0) throw new Error(`cvs image failed for ${outName}\n${(r.stdout || '').slice(-600)}\n${(r.stderr || '').slice(-600)}`);
  return { out, manifest: JSON.parse(fs.readFileSync(path.join(out, 'image-manifest.json'), 'utf8')) };
}

// ── 4) 真机出一套图 ─────────────────────────────────────────────────────────

let A = null;
try {
  A = runImage('a', ['--set', 'cover,card,avatar']);
  check('真机出图：3 张全部产出', A.manifest.images.length === 3, `${A.manifest.images.length} images`);

  const byName = Object.fromEntries(A.manifest.images.map((i) => [i.preset, i]));
  check('尺寸与预设一致', ['cover', 'card', 'avatar'].every((k) => {
    const im = byName[k];
    const pm = PRESETS[k];
    return im && im.width === pm.width && im.height === pm.height;
  }));

  const filesOk = A.manifest.images.every((i) => {
    const p = path.join(ROOT, i.file);
    return fs.existsSync(p) && fs.statSync(p).size === i.bytes && sha256(p) === i.sha256;
  });
  check('清单逐项对得上磁盘文件（bytes + sha256）', filesOk);

  check('每张都不是空帧（> 8 KB）', A.manifest.images.every((i) => i.bytes > 8192),
    A.manifest.images.map((i) => `${i.preset}:${(i.bytes / 1024).toFixed(0)}KB`).join(' '));

  check('文件名就是 <preset>.png', A.manifest.images.every((i) => i.file.endsWith(`/${i.preset}.png`)),
    A.manifest.images.map((i) => path.basename(i.file)).join(','));

  // 不同比例必须是不同画面（真重排，不是缩放）
  check('横屏 / 方图 / 小图 哈希各不相同', new Set(A.manifest.images.map((i) => i.sha256)).size === 3);

  // ── 7) 清单元数据 ──
  check('清单带 segment / kind / hash', !!A.manifest.segment && !!A.manifest.segmentKind && !!A.manifest.segmentHash,
    `${A.manifest.segment} (${A.manifest.segmentKind}) ${String(A.manifest.segmentHash).slice(0, 8)}`);
  check('清单的 segmentKind 是 style（默认取画风段）', A.manifest.segmentKind === 'style');
  check('清单带 theme 与 motion', A.manifest.theme === 'celadon-paper' && typeof A.manifest.motion === 'string',
    `${A.manifest.theme} / ${A.manifest.motion}`);
  check('清单带 at / format', Number.isFinite(A.manifest.at) && A.manifest.format === 'png', `at=${A.manifest.at}`);

  // ── 8) 用的是 plan 的段 URL ──
  check('页面来自 plan 的段 URL（带 theme，不是裸页面）',
    /[?&]theme=celadon-paper/.test(A.manifest.page) && /recipe-guofeng\.html/.test(A.manifest.page),
    A.manifest.page);
} catch (e) {
  failed += 9;
  console.error(`FAIL  render set: ${String(e.message || e).split('\n')[0]}`);
}

// ── 5) 确定性 ───────────────────────────────────────────────────────────────

if (A) {
  try {
    const B = runImage('b', ['--set', 'cover,card,avatar']);
    const ha = A.manifest.images.map((i) => i.sha256).join('|');
    const hb = B.manifest.images.map((i) => i.sha256).join('|');
    check('同参两次逐字节相同（确定性）', ha === hb);
  } catch (e) {
    failed += 1;
    console.error(`FAIL  determinism: ${String(e.message || e).split('\n')[0]}`);
  }

  // ── 6) --at 生效 ──
  try {
    const C = runImage('c', ['--set', 'cover', '--at', '1.0']);
    const a0 = A.manifest.images.find((i) => i.preset === 'cover').sha256;
    check('换 --at 后哈希不同（帧时间真的生效）', C.manifest.images[0].sha256 !== a0);
    check('--at 写进清单', Number(C.manifest.at) === 1, String(C.manifest.at));
  } catch (e) {
    failed += 2;
    console.error(`FAIL  --at: ${String(e.message || e).split('\n')[0]}`);
  }
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
