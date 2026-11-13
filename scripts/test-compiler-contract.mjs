#!/usr/bin/env node
/**
 * test-compiler-contract.mjs — v2.3.5 交付契约回归。
 *
 *   node scripts/test-compiler-contract.mjs
 *
 * 覆盖本轮修复的「假绿」与契约缺口：
 *   - build/lint 共用深度校验（主题、占位品牌、空标题、未知字段）；
 *   - 内容参数真的进了段 URL（title/sub/brand、单段 motion）；
 *   - 页面内容变了段哈希必须变（pageHash）；
 *   - 默认 root = cwd（不再默默用 spec 所在目录）；
 *   - CLI --version / 未知命令 / spec-lint --json 可解析；
 *   - 变体每个 outDir 独立；
 *   - deliver 产出 delivery.json + srt；
 *   - 质检三档语义（FAIL 拦交付 / WARN strict 拦 / ADVISORY 永不拦）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BIN = path.join(ROOT, 'bin', 'cvs.mjs');
const FIXTURE = path.join(ROOT, 'fixtures', 'mini-41s', 'spec.json');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
}

const run = (args, opts = {}) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', ...opts });
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cvs-contract-'));
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');

const { buildPlanFromSpec, pageContentHash } = await load('templates/plan.mjs');
const { expandVariants } = await load('scripts/variants.mjs');

// 写一个 PCM16 mono wav（amp=1.0 时满刻度 → 触发 qa-audio 的 clipping FAIL）。
function writeWav(file, { seconds = 2, amp = 0.25, sr = 48000, freq = 440, clip = false } = {}) {
  const n = Math.round(seconds * sr);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    let v = amp * Math.sin((2 * Math.PI * freq * i) / sr);
    if (clip) v = Math.sign(v);
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(sr, 24); head.writeUInt32LE(sr * 2, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([head, data]));
}

const PY = process.env.PYTHON || 'python';
function qaAudio(wav, out, extra = []) {
  return spawnSync(PY, [path.join(ROOT, 'scripts', 'qa-audio.py'), wav, '--out', out, ...extra], {
    cwd: ROOT, encoding: 'utf8',
  });
}

function specWith(mutate = () => {}) {
  const s = readJson(FIXTURE);
  mutate(s);
  return s;
}

// ── CLI 契约 ────────────────────────────────────────────────────────────────

test('cvs --version 输出 semver 且 exit 0', () => {
  const r = run([BIN, '--version']);
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test('未知子命令：stdout 为空、stderr 含错误码、exit 2', () => {
  const r = run([BIN, 'frobnicate']);
  assert.equal(r.status, 2);
  assert.equal(r.stdout.trim(), '');
  assert.match(r.stderr, /E_UNKNOWN_COMMAND/);
});

test('spec-lint --json 在致命错误时也输出可解析 JSON', () => {
  const r = run([path.join(ROOT, 'scripts', 'spec-lint.mjs'), '--spec', path.join(tmp(), 'nope.json'), '--json']);
  assert.equal(r.status, 10);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, false);
  assert.ok(j.code);
});

// ── 内容门禁 ────────────────────────────────────────────────────────────────

test('占位品牌 {{BRAND}} 是 error，不再是 warning', () => {
  const r = run([path.join(ROOT, 'scripts', 'spec-lint.mjs'), '--spec', FIXTURE, '--json', '--root', ROOT]);
  const base = JSON.parse(r.stdout);
  assert.equal(base.ok, true, JSON.stringify(base.issues));

  const dir = tmp();
  const p = path.join(dir, 'brand.spec.json');
  writeJson(p, specWith((s) => { s.meta.brand = '{{BRAND}}'; }));
  const bad = run([path.join(ROOT, 'scripts', 'spec-lint.mjs'), '--spec', p, '--json', '--root', ROOT]);
  assert.equal(bad.status, 10);
  assert.ok(JSON.parse(bad.stdout).errorCodes.includes('E_BRAND_PLACEHOLDER'));
});

test('空标题 / untitled 是 error', () => {
  const dir = tmp();
  const p = path.join(dir, 'title.spec.json');
  writeJson(p, specWith((s) => { s.meta.name = 'untitled'; delete s.meta.title; }));
  const r = run([path.join(ROOT, 'scripts', 'spec-lint.mjs'), '--spec', p, '--json', '--root', ROOT]);
  assert.equal(r.status, 10);
  assert.ok(JSON.parse(r.stdout).errorCodes.includes('E_TITLE_MISSING'));
});

test('style 未知字段是 error（不再静默吞掉）', () => {
  const dir = tmp();
  const p = path.join(dir, 'unknown.spec.json');
  writeJson(p, specWith((s) => { s.rounds[0].style.motioin = 'maximal'; }));
  const r = run([path.join(ROOT, 'scripts', 'spec-lint.mjs'), '--spec', p, '--json', '--root', ROOT]);
  assert.equal(r.status, 10);
  assert.ok(JSON.parse(r.stdout).errorCodes.includes('E_UNKNOWN_FIELD'));
});

// ── 页面参数 ────────────────────────────────────────────────────────────────

test('plan 把 title / sub / brand 下发到页面 URL', () => {
  const { plan } = buildPlanFromSpec(readJson(FIXTURE), { root: ROOT });
  const opening = plan.segments.find((s) => s.id === '00-opening');
  const q = new URLSearchParams(opening.page.split('?')[1]);
  assert.equal(q.get('title'), readJson(FIXTURE).meta.title);
  assert.equal(q.get('brand'), readJson(FIXTURE).meta.brand);
  assert.ok(q.get('sub'));

  const style = plan.segments.find((s) => s.kind === 'style');
  const sq = new URLSearchParams(style.page.split('?')[1]);
  assert.ok(sq.get('title'), 'style segment must carry a title');
  assert.ok(!style.page.includes('segment.html'), 'style segment must use a real recipe page');
});

test('单段 motion 只影响该段 URL', () => {
  const base = readJson(FIXTURE);
  const withMotion = specWith((s) => { s.rounds[0].style.motion = 'maximal'; });
  const a = buildPlanFromSpec(base, { root: ROOT }).plan;
  const b = buildPlanFromSpec(withMotion, { root: ROOT }).plan;
  const id = 'r01-style';
  const qa = new URLSearchParams(a.segments.find((s) => s.id === id).page.split('?')[1]);
  const qb = new URLSearchParams(b.segments.find((s) => s.id === id).page.split('?')[1]);
  assert.equal(qb.get('mp'), 'maximal');
  assert.notEqual(qa.get('mp'), 'maximal');
  for (const seg of b.segments.filter((s) => s.id !== id)) {
    const before = a.segments.find((s) => s.id === seg.id).page;
    assert.equal(seg.page, before, `${seg.id} URL must not change`);
  }
});

// ── 缓存正确性 ──────────────────────────────────────────────────────────────

test('页面内容变了，pageContentHash 必须变', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'page.html'), '<h1>A</h1>');
  const h1 = pageContentHash(dir, 'page.html');
  fs.writeFileSync(path.join(dir, 'page.html'), '<h1>B</h1>');
  const h2 = pageContentHash(dir, 'page.html');
  assert.notEqual(h1, h2);

  // 依赖文件变了也要变
  fs.writeFileSync(path.join(dir, 'dep.js'), 'export const x = 1;');
  fs.writeFileSync(path.join(dir, 'page2.html'), '<script type="module">import { x } from "./dep.js";</script>');
  const d1 = pageContentHash(dir, 'page2.html');
  fs.writeFileSync(path.join(dir, 'dep.js'), 'export const x = 2;');
  const d2 = pageContentHash(dir, 'page2.html');
  assert.notEqual(d1, d2);
});

test('默认 root = cwd：从仓库根 lint 子目录 fixture 不再误报 E_PAGE_MISSING', () => {
  const r = run([path.join(ROOT, 'scripts', 'spec-lint.mjs'), '--spec', 'fixtures/mini-41s/spec.json', '--json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
});

// ── 变体 ────────────────────────────────────────────────────────────────────

test('每个变体有自己的 render.outDir，且 specHash 与 outDir 无关', () => {
  const vars = expandVariants(readJson(FIXTURE), { theme: ['coral-noir', 'ice-minimal'] }, { outDir: 'out/variants' });
  assert.equal(vars.length, 2);
  const dirs = vars.map((v) => v.render.outDir);
  assert.equal(new Set(dirs).size, 2);
  for (const v of vars) assert.ok(v.render.outDir.startsWith('out/variants/'));
  const again = expandVariants(readJson(FIXTURE), { theme: ['coral-noir', 'ice-minimal'] }, { outDir: 'out/other' });
  assert.deepEqual(vars.map((v) => v.specHash), again.map((v) => v.specHash));
});

// ── 交付清单 ────────────────────────────────────────────────────────────────

test('deliver 产出 delivery.json + master.srt/.vtt', () => {
  const dir = tmp();
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'master.mp4'), Buffer.from('fake-mp4-bytes'));
  const spec = specWith((s) => { s.render.outDir = outDir; });
  const specPath = path.join(dir, 'spec.json');
  writeJson(specPath, spec);
  writeJson(path.join(outDir, 'plan.json'), {
    segments: [
      { id: '00-opening', kind: 'opening', start: 0, end: 1 },
      { id: 'r01-card', kind: 'card', start: 1, end: 2, card: { first: '想做', keyword: '宣传片？' } },
      { id: 'r01-style', kind: 'style', start: 2, end: 5, copy: { title: '扁平插画' } },
    ],
    stats: { duration: 5 },
    spec: { copy: { title: spec.meta.title, cta: spec.meta.cta } },
  });
  const r = run([path.join(ROOT, 'scripts', 'deliver.mjs'), '--spec', specPath, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const manifest = readJson(path.join(outDir, 'delivery.json'));
  assert.equal(manifest.rows.length, 1);
  assert.equal(manifest.rows[0].platform, 'master');
  assert.equal(manifest.rows[0].sha256, crypto.createHash('sha256').update(Buffer.from('fake-mp4-bytes')).digest('hex'));
  const srt = fs.readFileSync(path.join(outDir, 'master.srt'), 'utf8');
  assert.match(srt, /想做 宣传片？/);
  assert.match(srt, /扁平插画/);
  assert.ok(fs.existsSync(path.join(outDir, 'master.vtt')));
});

// ── 质检三档语义：ADVISORY 永不拦交付，FAIL 一定拦 ──────────────────────────
test('qa-audio 三档：每次 check 带 level，summary 带 advisory 计数', () => {
  const dir = tmp();
  const wav = path.join(dir, 'ok.wav');
  const out = path.join(dir, 'qa.json');
  writeWav(wav, { amp: 0.25 });
  const r = qaAudio(wav, out);
  assert.equal(r.status, 0, r.stderr);
  const rep = readJson(out);
  for (const c of rep.checks) assert.ok(['fail', 'contract', 'advisory'].includes(c.level), `check ${c.name} 缺 level`);
  assert.equal(typeof rep.summary.advisory, 'number');
  assert.ok(rep.checks.some((c) => c.status === 'ADVISORY'), '应至少有一条 ADVISORY（HF 克制）');
});

test('qa-audio 三档：只有 ADVISORY 时 --strict 仍然 EXIT=0（红门禁不再永远红）', () => {
  const dir = tmp();
  const wav = path.join(dir, 'ok.wav');
  const out = path.join(dir, 'qa.json');
  writeWav(wav, { amp: 0.25 });
  const r = qaAudio(wav, out, ['--strict']);
  const rep = readJson(out);
  if (r.status !== 0) {
    // 允许因 contract-WARN 或 FAIL 失败，但绝不接受「仅 advisory 就失败」。
    assert.ok(rep.summary.fail > 0 || rep.summary.warn > 0,
      `--strict 因纯 advisory 失败：${JSON.stringify(rep.summary)}`);
  }
});

test('qa-audio 三档：满刻度削波一定 FAIL 且 --strict EXIT=1', () => {
  const dir = tmp();
  const wav = path.join(dir, 'clip.wav');
  const out = path.join(dir, 'qa.json');
  writeWav(wav, { amp: 1.0, clip: true });
  const r = qaAudio(wav, out, ['--strict']);
  assert.equal(r.status, 1, `削波应失败，实际 exit ${r.status}\n${r.stdout}`);
  const rep = readJson(out);
  assert.ok(rep.summary.fail > 0, '削波应产生 FAIL');
  const clip = rep.checks.find((c) => c.name === 'clipping');
  assert.equal(clip.status, 'FAIL');
  assert.equal(clip.level, 'fail');
});

test('qa-audio 拍网格细分从 cue 间距推断（半拍 flash → 1/2 网格，无需手传 --subdiv）', () => {
  const dir = tmp();
  const wav = path.join(dir, 'clicks.wav');
  const out = path.join(dir, 'qa.json');
  const planPath = path.join(dir, 'plan.json');
  // 120 BPM = 0.5s/拍；cue 每 0.25s 一条（模拟 8 连闪）→ 应推断出 1/2 网格。
  const cues = [];
  for (let i = 0; i < 16; i++) cues.push({ t: i * 0.25, frame: i * 7, beat: i, kind: 'flash' });
  writeJson(planPath, { stats: { duration: 4 }, audio: { bpm: 120, cues } });
  // 每 0.25s 一个短噪声脉冲，让 onset 检测有东西可数。
  const sr = 48000;
  const n = Math.round(4 * sr);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const ph = t % 0.25;
    const v = ph < 0.02 ? (Math.random() * 2 - 1) * 0.5 : 0;
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(sr, 24); head.writeUInt32LE(sr * 2, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(wav, Buffer.concat([head, data]));

  const r = qaAudio(wav, out, ['--plan', planPath]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const rep = readJson(out);
  assert.equal(rep.gridSubdivision, 2, `应为 1/2 网格，实际 ${rep.gridSubdivision}`);
  const grid = rep.checks.find((c) => c.name === 'beat grid');
  assert.match(grid.detail, /1\/2 grid/);
});

test('qa-audio 频谱图不依赖 matplotlib：--spectrogram 必出合法 PNG', () => {
  const dir = tmp();
  const wav = path.join(dir, 'ok.wav');
  const out = path.join(dir, 'qa.json');
  const png = path.join(dir, 'spec.png');
  writeWav(wav, { amp: 0.25, seconds: 1 });
  const r = qaAudio(wav, out, ['--spectrogram', png]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.ok(fs.existsSync(png), '频谱图未生成');
  const buf = fs.readFileSync(png);
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG 魔数不符');
  assert.ok(buf.length > 5000, `PNG 太小，可能是空图（${buf.length} bytes）`);
  // 源码里不应再有 matplotlib import（否则被 skip 的告警会回来）
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'qa-audio.py'), 'utf8');
  assert.ok(!/import matplotlib/.test(src), 'qa-audio.py 仍有 matplotlib 依赖');
});

test('qa-video 同样分三档（源码断言：ADVISORY 不参与 strict 失败）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'qa-video.mjs'), 'utf8');
  assert.match(src, /ADVISORY/);
  assert.match(src, /advisory: advisories\.length/);
  assert.match(src, /if \(failures\.length \|\| \(STRICT && warnings\.length\)\)/);
  // VMAF 未安装、封面拼图失败都是诊断项，不能拦交付。
  assert.ok(!/add\('VMAF', 'WARN'/.test(src));
  assert.ok(!/add\('contact sheet', cs\.status === 0 \? 'PASS' : 'WARN'/.test(src));
});

// ── 品牌合规进 build（v2.4 / P1-03） ───────────────────────────────────────

test('brand apply 写入整包 brandKit（build 不再依赖 content/brands）', () => {
  const dir = tmp();
  const out = path.join(dir, 'applied.json');
  const r = run([path.join(ROOT, 'scripts', 'brand.mjs'), 'apply',
    '--spec', FIXTURE, '--brand', path.join(ROOT, 'content', 'brands', 'tech-dark.json'), '--out', out]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const kit = readJson(out).meta.brandKit;
  assert.equal(kit.id, 'tech-dark');
  assert.ok(kit.voice && Array.isArray(kit.voice.forbiddenWords), 'voice.forbiddenWords must be snapshotted');
  assert.ok(kit.logo && kit.logo.path, 'logo.path must be snapshotted');
  assert.ok(kit.colors && kit.colors.accent, 'colors.accent must be snapshotted');
});

test('build 对 brandKit 里的禁用词报 error 并 exit 10（lint 同判）', () => {
  const dir = tmp();
  const applied = path.join(dir, 'applied.json');
  let r = run([path.join(ROOT, 'scripts', 'brand.mjs'), 'apply',
    '--spec', FIXTURE, '--brand', path.join(ROOT, 'content', 'brands', 'tech-dark.json'), '--out', applied]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const spec = readJson(applied);
  spec.rounds[0].style.copy.title = '全网最好画风';
  writeJson(applied, spec);

  r = run([BIN, 'build', applied, '--root', ROOT, '--dry-run', '--no-audio']);
  assert.equal(r.status, 10, `expected exit 10, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /E_FORBIDDEN_WORD/);

  const lint = run([path.join(ROOT, 'scripts', 'spec-lint.mjs'), '--spec', applied, '--root', ROOT, '--json']);
  assert.notEqual(lint.status, 0, 'lint must fail on the same spec');
  const report = JSON.parse(lint.stdout);
  assert.ok(report.issues.some((i) => i.code === 'E_FORBIDDEN_WORD' && i.level === 'error'));
});

test('brand apply 有 error 时 exit 1（无 error 时 exit 0）', () => {
  const dir = tmp();
  const spec = readJson(FIXTURE);
  spec.meta.cta = '全网最好用';
  const bad = path.join(dir, 'bad.spec.json');
  writeJson(bad, spec);
  const failApply = run([path.join(ROOT, 'scripts', 'brand.mjs'), 'apply',
    '--spec', bad, '--brand', path.join(ROOT, 'content', 'brands', 'tech-dark.json'), '--out', path.join(dir, 'out.json')]);
  assert.equal(failApply.status, 1, failApply.stdout + failApply.stderr);
  assert.match(failApply.stdout + failApply.stderr, /E_FORBIDDEN_WORD/);
  assert.ok(fs.existsSync(path.join(dir, 'out.json')), 'applied spec should still be written');
});

test('brandKit 的 logo 缺失时 build 报 E_LOGO_MISSING', () => {
  const dir = tmp();
  const applied = path.join(dir, 'applied.json');
  const r0 = run([path.join(ROOT, 'scripts', 'brand.mjs'), 'apply',
    '--spec', FIXTURE, '--brand', path.join(ROOT, 'content', 'brands', 'tech-dark.json'), '--out', applied]);
  assert.equal(r0.status, 0, r0.stdout + r0.stderr);
  const spec = readJson(applied);
  spec.meta.brandKit.logo.path = 'assets/does-not-exist.png';
  writeJson(applied, spec);
  const r = run([BIN, 'build', applied, '--root', ROOT, '--dry-run', '--no-audio']);
  assert.equal(r.status, 10, r.stdout + r.stderr);
  assert.match(r.stderr, /E_LOGO_MISSING/);
});

test('没有 brandKit 的 spec 不做品牌检查（不误伤）', () => {
  const r = run([BIN, 'build', FIXTURE, '--root', ROOT, '--dry-run', '--no-audio']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// ── 统一测试汇总（v2.4 / P1-04） ────────────────────────────────────────────

test('test-all --json 是可解析的单行报告，且 suites/ok 字段齐全', () => {
  const r = run([path.join(ROOT, 'scripts', 'test-all.mjs'), '--only', 'test-brand', '--json']);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, 'stdout must be one JSON line');
  const j = JSON.parse(lines[0]);
  assert.equal(j.ok, true);
  assert.equal(j.suites, 1);
  assert.ok(j.passed >= 20, `expected >=20 assertions, got ${j.passed}`);
  assert.ok(Array.isArray(j.results) && j.results[0].suite.includes('test-brand'));
});

test('test-all --tap 输出 TAP14 头与 ok/not ok 行', () => {
  const r = run([path.join(ROOT, 'scripts', 'test-all.mjs'), '--only', 'test-brand', '--tap']);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /^TAP version 14/m);
  assert.match(r.stdout, /^1\.\.1$/m);
  assert.match(r.stdout, /^ok 1 - scripts\/test-brand\.mjs/m);
});

test('test-all 汇总计数自洽：total === passed + failed（"N tests:" 无 Ran 前缀也要读对）', () => {
  // 回归：parseSummary 曾强制要求 "Ran N tests:"，于是 test-spec-security 的
  // "34 tests: 32 passed, 2 failed" 落到通用模式，total 被读成 32（少报总数）。
  const r = run([path.join(ROOT, 'scripts', 'test-all.mjs'), '--only', 'test-spec-security', '--json']);
  const j = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
  const s = j.results && j.results[0];
  assert.ok(s, 'no suite row');
  assert.equal(s.total, s.passed + s.failed, `total=${s.total} passed=${s.passed} failed=${s.failed}`);
  assert.ok(s.total >= 34, `expected the full spec-security suite, got total=${s.total}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
