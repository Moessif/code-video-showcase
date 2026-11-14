#!/usr/bin/env node
/**
 * test-versioning.mjs — 审片/回滚闭环的回归（v2.4 / P1-13，纯 Node + 假产物）。
 *
 *   node scripts/test-versioning.mjs
 *
 * 覆盖：
 *   1. snapshot 收齐 master/spec/plan/清单/字幕/QA，并记录每文件 sha256+bytes；
 *   2. list 能看到快照与 label；
 *   3. verify 对完好快照 exit 0，对被人为改动的快照 exit 13 并指出文件；
 *   4. rollback 只在 verify 通过时恢复，且恢复后的 master sha 等于记录值；
 *   5. 篡改快照时 rollback 拒绝（不把坏版本推回产物目录）；
 *   6. 不存在的版本 → exit 13；缺 --spec → exit 2。
 *
 * 用假 master（随机字节）即可：这条链路只关心字节身份，不需要真渲染。
 *
 * 退出码 0/1。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TOOL = path.join(ROOT, 'scripts', 'versions.mjs');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cvs-versions-'));
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run = (args) => spawnSync(process.execPath, [TOOL, ...args], { cwd: TMP, encoding: 'utf8', windowsHide: true });

function writeSpec({ duration = 3, brand = 'Test Brand' } = {}) {
  const spec = {
    specVersion: 1,
    meta: { name: 'versions-test', brand, title: '版本测试', cta: '试试', locale: 'zh-CN' },
    format: { width: 1920, height: 1080, fps: 30, aspect: '16:9', duration },
    look: { mode: 'showcase', style: null, theme: 'coral-noir', accentOverride: null },
    audio: { mood: 'electronic', bpm: 120, vo: null },
    structure: { opening: 1, round: 1, card: 0.4, ending: 1, moreCard: 1, flash: { count: 0, each: 0.25 } },
    opening: { page: 'templates/segment.html', name: 'opening' },
    rounds: [{
      id: 'r01', name: 'r',
      card: { layout: 0, first: '测试', keyword: '版本？', page: 'templates/big-card.html' },
      style: { page: 'templates/segment.html', t0: 0.3, speed: 1.3 },
    }],
    moreCard: { page: 'templates/big-card.html', first: '还有', keyword: '更多？' },
    flash: { page: 'templates/segment.html' },
    ending: { page: 'templates/segment.html', name: 'ending' },
    assets: [], patches: [],
    render: { quality: 'master', preset: 'master', concurrency: 1, outDir: 'out' },
  };
  fs.mkdirSync(path.join(TMP, 'out'), { recursive: true });
  fs.writeFileSync(path.join(TMP, 'project.spec.json'), JSON.stringify(spec, null, 2) + '\n');
  // 假 master + 附属产物（字节身份才是这条链路关心的）
  fs.writeFileSync(path.join(TMP, 'out', 'master.mp4'), crypto.randomBytes(4096));
  fs.writeFileSync(path.join(TMP, 'out', 'plan.json'), JSON.stringify({ stats: { duration, frames: duration * 30, fps: 30 } }, null, 2));
  fs.writeFileSync(path.join(TMP, 'out', 'render-manifest.json'), JSON.stringify({ segments: { '00-opening': { status: 'cached' } } }, null, 2));
  fs.writeFileSync(path.join(TMP, 'out', 'master.srt'), '1\n00:00:00,000 --> 00:00:01,000\n版本测试\n');
  fs.writeFileSync(path.join(TMP, 'out', 'master.vtt'), 'WEBVTT\n\n00:00.000 --> 00:01.000\n版本测试\n');
  fs.writeFileSync(path.join(TMP, 'out', 'delivery.json'), JSON.stringify({ rows: [] }, null, 2));
  fs.mkdirSync(path.join(TMP, 'out', 'qa'), { recursive: true });
  fs.writeFileSync(path.join(TMP, 'out', 'qa', 'qa-video.json'), JSON.stringify({ summary: { fail: 0 } }));
  fs.writeFileSync(path.join(TMP, 'out', 'qa', 'qa-audio.json'), JSON.stringify({ summary: { fail: 0 } }));
  return spec;
}

writeSpec();
const masterSha1 = sha(path.join(TMP, 'out', 'master.mp4'));

test('snapshot 记录每个文件的 sha256 与 bytes', () => {
  const r = run(['snapshot', '--spec', 'project.spec.json', '--label', '初版']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const index = JSON.parse(fs.readFileSync(path.join(TMP, 'out', 'versions', 'versions.json'), 'utf8'));
  assert.equal(index.versions.length, 1);
  const v = index.versions[0];
  assert.match(v.version, /^v001/);
  assert.equal(v.label, '初版');
  assert.equal(v.masterSha256, masterSha1);
  for (const rel of ['master.mp4', 'project.spec.json', 'plan.json', 'master.srt', 'qa/qa-video.json']) {
    assert.ok(v.files[rel], `missing ${rel}`);
    assert.match(v.files[rel].sha256, /^[a-f0-9]{64}$/);
    assert.ok(v.files[rel].bytes > 0);
  }
  assert.ok(v.files['review.json'], 'review.json should be seeded');
});

test('list 输出快照与 label', () => {
  const r = run(['list']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /v001-初版|v001/);
  const j = run(['list', '--json']);
  assert.equal(j.status, 0);
  assert.equal(JSON.parse(j.stdout).versions.length, 1);
});

test('verify 完好快照 exit 0', () => {
  const r = run(['verify', 'v001']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /match the recorded sha256/);
});

test('第二次快照得到 v002，且 master 变化被记录', () => {
  fs.writeFileSync(path.join(TMP, 'out', 'master.mp4'), crypto.randomBytes(4096));
  const masterSha2 = sha(path.join(TMP, 'out', 'master.mp4'));
  const r = run(['snapshot', '--spec', 'project.spec.json', '--label', '第二版']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const index = JSON.parse(fs.readFileSync(path.join(TMP, 'out', 'versions', 'versions.json'), 'utf8'));
  assert.equal(index.versions.length, 2);
  assert.equal(index.versions[1].masterSha256, masterSha2);
  assert.notEqual(index.versions[0].masterSha256, index.versions[1].masterSha256);
});

test('rollback v001 恢复 master 并写 rollback.json', () => {
  const r = run(['rollback', 'v001', '--spec', 'project.spec.json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(sha(path.join(TMP, 'out', 'master.mp4')), masterSha1);
  const receipt = JSON.parse(fs.readFileSync(path.join(TMP, 'out', 'rollback.json'), 'utf8'));
  assert.equal(receipt.version, 'v001-初版');
  assert.equal(receipt.masterSha256, masterSha1);
  assert.ok(receipt.restored.includes('master.mp4'));
});

test('被篡改的快照 verify exit 13 并指出文件', () => {
  const dir = fs.readdirSync(path.join(TMP, 'out', 'versions')).find((d) => d.startsWith('v002'));
  fs.appendFileSync(path.join(TMP, 'out', 'versions', dir, 'master.mp4'), Buffer.from('tamper'));
  const r = run(['verify', 'v002']);
  assert.equal(r.status, 13, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /sha256 mismatch|size mismatch/);
});

test('rollback 拒绝被篡改的快照（不把坏版本推回产物目录）', () => {
  const before = sha(path.join(TMP, 'out', 'master.mp4'));
  const r = run(['rollback', 'v002', '--spec', 'project.spec.json']);
  assert.equal(r.status, 13, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /E_SNAPSHOT_TAMPERED/);
  assert.equal(sha(path.join(TMP, 'out', 'master.mp4')), before, 'master must be untouched');
});

test('不存在的版本 exit 13；缺 --spec 的 snapshot exit 2', () => {
  assert.equal(run(['verify', 'v999']).status, 13);
  assert.equal(run(['rollback', 'v999']).status, 13);
  assert.equal(run(['snapshot']).status, 2);
});

test('没有 master 时 snapshot exit 13', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cvs-versions-empty-'));
  fs.writeFileSync(path.join(empty, 'project.spec.json'), JSON.stringify({ render: { outDir: 'out' } }));
  const r = spawnSync(process.execPath, [TOOL, 'snapshot', '--spec', 'project.spec.json'], { cwd: empty, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 13, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /E_NO_MASTER/);
  fs.rmSync(empty, { recursive: true, force: true });
});

// ── --spec 必须能定位 outDir（list/verify 与 snapshot/rollback 一致）──────────
// 回归：list/verify 曾只认 --outdir，`cvs verify v001 --spec X` 会静默跑去 out/ 找，
// 报 E_VERSION_UNKNOWN。默认 outDir='out' 的用例抓不到这个错，所以这里用非默认 outDir。
test('list / verify 用 --spec 定位非默认 outDir', () => {
  const T2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cvs-versions-spec-'));
  try {
    fs.writeFileSync(path.join(T2, 'project.spec.json'), JSON.stringify({ render: { outDir: 'custom-out' } }));
    const od = path.join(T2, 'custom-out');
    fs.mkdirSync(path.join(od, 'qa'), { recursive: true });
    fs.writeFileSync(path.join(od, 'master.mp4'), crypto.randomBytes(2048));
    fs.writeFileSync(path.join(od, 'plan.json'), '{"stats":{}}');
    fs.writeFileSync(path.join(od, 'qa', 'qa-video.json'), '{"summary":{"fail":0}}');
    const r2 = (args) => spawnSync(process.execPath, [TOOL, ...args], { cwd: T2, encoding: 'utf8', windowsHide: true });

    const snap = r2(['snapshot', '--spec', 'project.spec.json', '--label', 'spec定位']);
    assert.equal(snap.status, 0, snap.stdout + snap.stderr);
    assert.ok(fs.existsSync(path.join(od, 'versions', 'versions.json')), 'snapshot must land in custom-out');

    const listed = r2(['list', '--spec', 'project.spec.json']);
    assert.equal(listed.status, 0, listed.stdout + listed.stderr);
    assert.match(listed.stdout, /v001/, `list --spec missed the snapshot: ${listed.stdout}`);

    const verified = r2(['verify', 'v001', '--spec', 'project.spec.json']);
    assert.equal(verified.status, 0, verified.stdout + verified.stderr);
    assert.match(verified.stdout, /match the recorded sha256/);

    // 不给 --spec 时确实找不到（证明是 --spec 在定位，而不是碰巧默认目录里有）。
    const blind = r2(['verify', 'v001']);
    assert.notEqual(blind.status, 0, 'without --spec it must not silently find custom-out');
  } finally {
    fs.rmSync(T2, { recursive: true, force: true });
  }
});

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nRan ${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
