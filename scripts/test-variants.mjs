#!/usr/bin/env node
/**
 * test-variants.mjs — C4-04 变体矩阵的回归测试。
 *
 *   node scripts/test-variants.mjs
 *
 * 覆盖：2×2×2 笛卡尔积、id 唯一、每份 spec 通过 normalizeSpec + validateSpec、
 * copy 轮换 / 单组应用、theme/aspect 覆盖、manifest 完整性、
 * dry-run 不写盘、CLI 实际写盘、axes.example.json 可用、非法轴报错。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e.stack || e.message}`);
    process.exitCode = 1;
  }
}

const variantsMod = await load('scripts/variants.mjs');
const { normalizeSpec, validateSpec } = await load('templates/spec.mjs');

const FIXTURE = path.join(ROOT, 'fixtures/mini-41s/spec.json');
const BASE = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));
const ORIGINAL = clone(BASE);

const TMP = path.join(ROOT, 'out', `test-variants-${process.pid}`);
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
process.on('exit', () => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
});

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
const errorsOf = (spec) => validateSpec(normalizeSpec(spec)).filter((i) => i.level === 'error');

const AXES = {
  first: [['想做', '产品发布会？'], ['想拍', '品牌故事？']],
  theme: ['coral-noir', 'cyber-neon'],
  aspect: ['16:9', '9:16'],
};
const VARIANTS = variantsMod.expandVariants(BASE, AXES);

// ── 笛卡尔积 ───────────────────────────────────────────────────────────────

test('2×2×2 轴得到 8 个变体', () => {
  assert.equal(VARIANTS.length, 8);
  for (const v of VARIANTS) {
    assert.equal(v.specVersion, 1);
    assert.equal(v.rounds.length, BASE.rounds.length);
    assert.equal(v.format.duration, BASE.format.duration);
  }
});

test('id 是唯一短哈希', () => {
  const ids = VARIANTS.map((v) => v.id);
  assert.equal(new Set(ids).size, 8);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8,16}$/, id);
});

test('每个变体都通过 normalizeSpec + validateSpec', () => {
  for (const v of VARIANTS) {
    const errors = errorsOf(v);
    assert.deepEqual(errors, [], `variant ${v.id}: ${JSON.stringify(errors)}`);
  }
});

test('copy 轴：单组 pair 应用到所有轮', () => {
  const v = VARIANTS.find((x) => x.axes.first[0] === '想拍');
  assert.ok(v, 'missing 想拍 variant');
  for (const r of v.rounds) {
    assert.equal(r.card.first, '想拍');
    assert.equal(r.card.keyword, '品牌故事？');
  }
});

test('copy 轴：多组 pair 按轮次顺序轮换', () => {
  const rot = variantsMod.expandVariants(BASE, {
    first: [[['想做', 'A？'], ['想拍', 'B？']]],
  });
  assert.equal(rot.length, 1);
  const expected = [['想做', 'A？'], ['想拍', 'B？'], ['想做', 'A？'], ['想拍', 'B？'], ['想做', 'A？'], ['想拍', 'B？']];
  rot[0].rounds.forEach((r, i) => {
    assert.equal(r.card.first, expected[i][0], `round ${i}.first`);
    assert.equal(r.card.keyword, expected[i][1], `round ${i}.keyword`);
  });
});

test('theme / aspect 轴真正进入 spec', () => {
  for (const v of VARIANTS) {
    assert.equal(v.look.theme, v.axes.theme);
    if (v.axes.aspect === '9:16') {
      assert.equal(v.format.width, 1080);
      assert.equal(v.format.height, 1920);
      assert.equal(v.format.aspect, '9:16');
      assert.ok(v.rounds.every((r) => r.style.reflow), `${v.id} missing style.reflow`);
      assert.deepEqual(v.meta.reflowFrom, { width: 1920, height: 1080, aspect: '16:9' });
    } else {
      assert.equal(v.format.width, 1920);
      assert.equal(v.format.height, 1080);
      assert.equal(v.format.aspect, '16:9');
      assert.ok(v.rounds.every((r) => !r.style.reflow), `${v.id} should not be reflowed`);
    }
  }
});

test('outDir / specPath 遵循 out/variants/<id>', () => {
  for (const v of VARIANTS) {
    assert.equal(v.outDir, `out/variants/${v.id}`);
    assert.equal(v.specPath, `${v.outDir}/project.spec.json`);
  }
});

// ── manifest ───────────────────────────────────────────────────────────────

test('writeManifest 写出完整清单且 specHash 可复算', () => {
  const manifestPath = path.join(TMP, 'manifest.json');
  const manifest = variantsMod.writeManifest(VARIANTS, manifestPath);

  assert.equal(manifest.version, 1);
  assert.equal(manifest.count, 8);
  assert.equal(manifest.variants.length, 8);
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), manifest);

  for (const row of manifest.variants) {
    assert.match(row.id, /^[0-9a-f]{8,16}$/);
    assert.deepEqual(Object.keys(row.axes).sort(), ['aspect', 'first', 'theme']);
    assert.equal(row.outDir, `out/variants/${row.id}`);
    assert.equal(row.specPath, `${row.outDir}/project.spec.json`);
    assert.match(row.specHash, /^[0-9a-f]{64}$/);
    const v = VARIANTS.find((x) => x.id === row.id);
    assert.ok(v, `manifest id ${row.id} not found in variants`);
    assert.equal(row.specHash, variantsMod.specHashOf(v));
  }
});

// ── CLI ────────────────────────────────────────────────────────────────────

const CLI = path.join(ROOT, 'scripts', 'variants.mjs');
const AXES_FILE = path.join(ROOT, 'fixtures', 'mini-41s', 'axes.example.json');

test('axes.example.json 存在且展开为 8 个变体', () => {
  assert.ok(fs.existsSync(AXES_FILE), `missing ${AXES_FILE}`);
  const axes = JSON.parse(fs.readFileSync(AXES_FILE, 'utf8'));
  assert.deepEqual(Object.keys(axes).sort(), ['aspect', 'first', 'theme']);
  assert.equal(variantsMod.expandVariants(BASE, axes).length, 8);
});

test('CLI --dry-run 打印数量与矩阵且不写盘', () => {
  const outDir = path.join(TMP, 'dry-out');
  const r = spawnSync(
    process.execPath,
    [
      CLI,
      '--spec', 'fixtures/mini-41s/spec.json',
      '--axes', 'fixtures/mini-41s/axes.example.json',
      '--out', rel(outDir),
      '--dry-run',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(r.status, 0, `exit ${r.status}\n${r.stderr}\n${r.stdout}`);
  assert.match(r.stdout, /8 variants/);
  assert.match(r.stdout, /dry-run/i);
  for (const axis of ['aspect', 'first', 'theme']) assert.match(r.stdout, new RegExp(axis));
  assert.equal(fs.existsSync(outDir), false, 'dry-run must not create the output directory');
});

test('CLI 实际写盘：8 份 project.spec.json + manifest.json', () => {
  const outDir = path.join(TMP, 'live-out');
  const r = spawnSync(
    process.execPath,
    [
      CLI,
      '--spec', 'fixtures/mini-41s/spec.json',
      '--axes', 'fixtures/mini-41s/axes.example.json',
      '--out', rel(outDir),
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(r.status, 0, `exit ${r.status}\n${r.stderr}\n${r.stdout}`);

  const dirs = fs.readdirSync(outDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  assert.equal(dirs.length, 8);

  for (const d of dirs) {
    const specPath = path.join(outDir, d.name, 'project.spec.json');
    assert.ok(fs.existsSync(specPath), `missing ${specPath}`);
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    assert.equal(spec.rounds.length, BASE.rounds.length);
    assert.deepEqual(errorsOf(spec), []);
  }

  const manifestPath = path.join(outDir, 'manifest.json');
  assert.ok(fs.existsSync(manifestPath));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.count, 8);
  for (const row of manifest.variants) {
    const spec = JSON.parse(fs.readFileSync(path.resolve(ROOT, row.specPath), 'utf8'));
    assert.equal(row.specHash, variantsMod.specHashOf(spec), `specHash mismatch for ${row.id}`);
  }
});

// ── 错误输入 ───────────────────────────────────────────────────────────────

test('未知轴 / 空轴值 / 非法画幅都显式报错', () => {
  assert.throws(() => variantsMod.expandVariants(BASE, { wat: ['x'] }), /unsupported axis/i);
  assert.throws(() => variantsMod.expandVariants(BASE, { theme: [] }), /non-empty/i);
  assert.throws(() => variantsMod.expandVariants(BASE, { aspect: ['4:5'] }), /aspect/i);
});

test('expandVariants 不修改原 spec', () => {
  assert.deepEqual(BASE, ORIGINAL);
});

const total = passed + failed;
console.log(`\nRan ${total} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
