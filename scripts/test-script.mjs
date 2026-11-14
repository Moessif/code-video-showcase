#!/usr/bin/env node
/**
 * scripts/test-script.mjs — C2-06/07 剧本表格与版本树的验收测试。
 *
 *   node scripts/test-script.mjs
 *
 * 只依赖 Node 内置模块与仓库 fixtures；不联网、不 npm install。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const FIXTURE = path.join(REPO, 'fixtures', 'mini-41s', 'spec.json');

let model;
let versionModel;
try {
  model = await import(new URL('../app/script/model.mjs', import.meta.url));
  versionModel = await import(new URL('../app/versions/model.mjs', import.meta.url));
} catch (err) {
  console.error(`✗ script model — 无法加载模块：${err.message}`);
  process.exit(1);
}

// ── 微型测试框架 ────────────────────────────────────────────────────────────
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const clone = (v) => JSON.parse(JSON.stringify(v));
const deepFreeze = (v) => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
};
const close = (a, b, eps = 1e-9) => Math.abs(Number(a) - Number(b)) <= eps;
const codes = (issues) => issues.map((i) => i.code);

const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const makeSpec = () => clone(raw);

// ── specToRows ──────────────────────────────────────────────────────────────
test('fixture 可被解析为表格行，数量 = opening + N×2 + more + flash + ending', () => {
  const spec = makeSpec();
  const rows = model.specToRows(spec);
  const expected = 1 + spec.rounds.length * 2 + 1 + spec.structure.flash.count + 1;
  assert.equal(rows.length, expected);
});

test('行顺序与 plan 的段顺序一致：opening → card/scene 交替 → more → flash → ending', () => {
  const spec = makeSpec();
  const rows = model.specToRows(spec);
  const flashes = spec.structure.flash.count;
  assert.equal(rows[0].id, '00-opening');
  assert.equal(rows[0].role, 'opening');
  assert.equal(rows[1].id, 'r01-card');
  assert.equal(rows[1].role, 'card');
  assert.equal(rows[2].id, 'r01-style');
  assert.equal(rows[2].role, 'scene');
  assert.equal(rows[rows.length - (flashes + 2)].id, '99-more');
  assert.equal(rows[rows.length - (flashes + 1)].id, 'f01');
  assert.equal(rows[rows.length - 2].id, `f${String(flashes).padStart(2, '0')}`);
  assert.equal(rows[rows.length - 1].id, '99-ending');
  assert.equal(rows[rows.length - 1].role, 'ending');
});

test('行字段齐全：id/name/start/duration/role/first/keyword/recipe/t0/speed', () => {
  const row = model.specToRows(makeSpec())[1];
  for (const k of ['id', 'name', 'start', 'duration', 'role']) assert.ok(k in row, `缺 ${k}`);
  assert.equal(row.role, 'card');
  assert.equal(row.first, '想做');
  assert.equal(row.keyword, '科普视频？');
  assert.equal(typeof row.start, 'number');
  assert.equal(typeof row.duration, 'number');
  const scene = model.specToRows(makeSpec())[2];
  assert.equal(scene.recipe, null);
  assert.equal(scene.t0, 0.3);
  assert.equal(scene.speed, 1.4);
});

test('speed/t0 为 null 时按 plan 默认值 1/0 处理，不应误报 E_SPEED', () => {
  const spec = makeSpec();
  spec.rounds[0].style.speed = null;
  spec.rounds[0].style.t0 = null;
  const scene = model.specToRows(spec)[2];
  assert.equal(scene.speed, 1, 'speed null 应回落为 plan 的默认 1');
  assert.equal(scene.t0, 0, 't0 null 应回落为 plan 的默认 0');
  assert.deepEqual(codes(model.validateRows(spec)), []);
});

test('时间轴首尾相接，总时长 41s / 1230 帧 / N 段', () => {
  const spec = makeSpec();
  const rows = model.specToRows(spec);
  assert.equal(rows[0].start, 0);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(close(rows[i].start, rows[i - 1].start + rows[i - 1].duration), `第 ${i} 行起点不连续`);
  }
  const last = rows[rows.length - 1];
  assert.ok(close(last.start + last.duration, 41), `末尾应在 41s，实际 ${last.start + last.duration}`);
  const totals = model.specTotals(spec);
  assert.equal(totals.duration, 41);
  assert.equal(totals.frames, 1230);
  assert.equal(totals.segments, rows.length);
  assert.equal(totals.nominal, 41);
});

// ── applyRowEdit ────────────────────────────────────────────────────────────
test('applyRowEdit 返回新 spec，原 spec 不被修改（冻结输入也不报错）', () => {
  const spec = deepFreeze(makeSpec());
  const before = clone(spec);
  const next = model.applyRowEdit(spec, 'r03-card', 'first', '想办');
  assert.notEqual(next, spec);
  assert.equal(next.rounds[2].card.first, '想办');
  assert.equal(spec.rounds[2].card.first, '想开');
  assert.deepEqual(clone(spec), before, '原 spec 被就地修改');
  assert.equal(makeSpec().rounds[2].card.first, '想开');
});

test('applyRowEdit 拒绝未知行与白名单外字段', () => {
  const spec = makeSpec();
  assert.throws(() => model.applyRowEdit(spec, 'nope-card', 'first', 'x'), /unknown row/);
  assert.throws(() => model.applyRowEdit(spec, '00-opening', 'speed', 1), /not editable/);
  assert.throws(() => model.applyRowEdit(spec, 'f01', 'name', 'x'), /not editable/);
});

test('applyRowEdit 数字字段做范围校验：speed<=0、t0<0、非数字都拒绝', () => {
  const spec = makeSpec();
  assert.throws(() => model.applyRowEdit(spec, 'r01-style', 'speed', 0), /speed/);
  assert.throws(() => model.applyRowEdit(spec, 'r01-style', 'speed', -1), /speed/);
  assert.throws(() => model.applyRowEdit(spec, 'r01-style', 'speed', 'abc'), /speed/);
  assert.throws(() => model.applyRowEdit(spec, 'r01-style', 't0', -0.1), /t0/);
  assert.throws(() => model.applyRowEdit(spec, 'r01-style', 't0', Infinity), /t0/);
  assert.equal(model.applyRowEdit(spec, 'r01-style', 'speed', '2.5').rounds[0].style.speed, 2.5);
  assert.equal(model.applyRowEdit(spec, 'r01-style', 't0', '0').rounds[0].style.t0, 0);
});

test('applyRowEdit 编辑 recipe 空串归一化为 null', () => {
  const spec = makeSpec();
  const withRecipe = model.applyRowEdit(spec, 'r01-style', 'recipe', 'cyber-pixel');
  assert.equal(withRecipe.rounds[0].style.recipe, 'cyber-pixel');
  const cleared = model.applyRowEdit(withRecipe, 'r01-style', 'recipe', '');
  assert.equal(cleared.rounds[0].style.recipe, null);
});

test('applyRowEdit 从 scene 行编辑 name 会落到 round.name（共享字段）', () => {
  const spec = makeSpec();
  const next = model.applyRowEdit(spec, 'r02-style', 'name', '新名字');
  assert.equal(next.rounds[1].name, '新名字');
  assert.equal(next.rounds[1].id, 'r02');
});

// ── validateRows ────────────────────────────────────────────────────────────
test('fixture 校验无 issue', () => {
  assert.deepEqual(model.validateRows(makeSpec()), []);
});

test('超长 first（>8 字）被 validateRows 捕获，并指向具体行与字段', () => {
  const spec = makeSpec();
  spec.rounds[0].card.first = '一二三四五六七八九';
  const issues = model.validateRows(spec);
  const hit = issues.find((i) => i.code === 'E_COPY_LEN' && i.field === 'first');
  assert.ok(hit, `未捕获超长 first: ${JSON.stringify(issues)}`);
  assert.equal(hit.rowId, 'r01-card');
  assert.match(hit.message, /9/);
});

test('超长 keyword（>12 字）被 validateRows 捕获', () => {
  const spec = makeSpec();
  spec.rounds[2].card.keyword = '一二三四五六七八九十一二三';
  const issues = model.validateRows(spec);
  const hit = issues.find((i) => i.code === 'E_COPY_LEN' && i.field === 'keyword');
  assert.ok(hit);
  assert.equal(hit.rowId, 'r03-card');
});

test('重复 round id 被捕获', () => {
  const spec = makeSpec();
  spec.rounds[1].id = spec.rounds[0].id;
  assert.ok(codes(model.validateRows(spec)).includes('E_DUP_ID'));
});

test('structure 总时长与 format.duration 不一致被捕获', () => {
  const spec = makeSpec();
  spec.format.duration = 50;
  const issues = model.validateRows(spec);
  assert.ok(codes(issues).includes('E_DURATION'));
});

test('单轮时长与 structure.round 不一致被捕获（round.duration 覆盖）', () => {
  const spec = makeSpec();
  spec.rounds[0].duration = 5;
  const issues = model.validateRows(spec);
  const hit = issues.find((i) => i.code === 'E_ROUND_TOTAL');
  assert.ok(hit, `未捕获单轮时长不一致: ${JSON.stringify(issues)}`);
  assert.equal(hit.rowId, 'r01-card');
});

test('speed<=0 被 validateRows 捕获（导入的坏 spec）', () => {
  const spec = makeSpec();
  spec.rounds[0].style.speed = 0;
  assert.ok(codes(model.validateRows(spec)).includes('E_SPEED'));
});

test('structure.card >= structure.round 被捕获', () => {
  const spec = makeSpec();
  spec.structure.card = spec.structure.round;
  assert.ok(codes(model.validateRows(spec)).includes('E_CARD_GE_ROUND'));
});

// ── specHash ────────────────────────────────────────────────────────────────
test('specHash 稳定：同 spec 两次一致，12 位十六进制', () => {
  const a = model.specHash(makeSpec());
  const b = model.specHash(makeSpec());
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{12}$/);
});

test('specHash 与键序无关（稳定序列化）', () => {
  const spec = makeSpec();
  const reversed = {};
  for (const k of Object.keys(spec).reverse()) reversed[k] = spec[k];
  assert.equal(model.specHash(spec), model.specHash(reversed));
});

test('specHash 随内容变化', () => {
  const spec = makeSpec();
  const edited = model.applyRowEdit(spec, 'r01-style', 'speed', 2);
  assert.notEqual(model.specHash(spec), model.specHash(edited));
});

test('sha256Hex 与标准测试向量一致', () => {
  assert.equal(model.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(model.sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(model.sha256Hex('中文'), model.sha256Hex('中文'));
});

// ── diffSpecs ───────────────────────────────────────────────────────────────
test('相同 spec 的 diff 为空', () => {
  assert.equal(model.diffSpecs(makeSpec(), makeSpec()), '');
});

test('diff 能识别一行文案变更（恰好 1 增 1 删）', () => {
  const a = makeSpec();
  const b = model.applyRowEdit(a, 'r03-card', 'first', '想办');
  const text = model.diffSpecs(a, b);
  assert.ok(text.startsWith('--- '), '缺 --- 头');
  assert.ok(text.includes('\n+++ '), '缺 +++ 头');
  const removed = text.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
  const added = text.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  assert.equal(removed.length, 1, `删除行数应为 1，实际 ${removed.length}\n${text}`);
  assert.equal(added.length, 1, `新增行数应为 1，实际 ${added.length}\n${text}`);
  assert.match(removed[0], /first=想开/);
  assert.match(added[0], /first=想办/);
});

test('diff 包含 hunk 头与上下文', () => {
  const a = makeSpec();
  const b = model.applyRowEdit(a, 'r06-style', 'speed', 1.9);
  const text = model.diffSpecs(a, b);
  assert.match(text, /@@ -\d+,\d+ \+\d+,\d+ @@/);
  assert.match(text, /speed=1\.9/);
});

test('diff 支持多行变更', () => {
  let b = makeSpec();
  b = model.applyRowEdit(b, 'r01-card', 'first', '甲');
  b = model.applyRowEdit(b, 'r05-card', 'keyword', '乙');
  const text = model.diffSpecs(makeSpec(), b);
  const added = text.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  assert.equal(added.length, 2, text);
});

// ── 版本树存储 ──────────────────────────────────────────────────────────────
const memStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
};

test('版本存储：保存 / 列出（新→旧）/ 删除', () => {
  const store = versionModel.createVersionStore(memStorage());
  assert.equal(store.list().length, 0);
  const e1 = store.save(makeSpec(), 'v1', { now: 1000 });
  assert.equal(e1.deduped, false);
  assert.equal(e1.entry.hash.length, 12);
  assert.equal(e1.entry.duration, 41);
  assert.equal(store.list().length, 1);

  const edited = model.applyRowEdit(makeSpec(), 'r01-style', 'speed', 2);
  const e2 = store.save(edited, 'v2', { now: 2000 });
  assert.equal(store.list().length, 2);
  assert.equal(store.list()[0].id, e2.entry.id, '列表应按时间倒序');
  assert.equal(store.get(e1.entry.id).name, 'v1');

  assert.equal(store.remove(e1.entry.id), 1);
  assert.equal(store.list().length, 1);
  assert.equal(store.get(e1.entry.id), null);
});

test('版本存储：同 hash 去重（更新名称/时间，不新增）', () => {
  const store = versionModel.createVersionStore(memStorage());
  const e1 = store.save(makeSpec(), 'v1', { now: 1000 });
  const e2 = store.save(makeSpec(), 'v1 改名', { now: 2000 });
  assert.equal(store.list().length, 1);
  assert.equal(e2.deduped, true);
  assert.equal(e2.entry.id, e1.entry.id);
  assert.equal(store.get(e1.entry.id).name, 'v1 改名');
});

test('版本存储：快照可完整恢复（深拷贝，不受后续修改影响）', () => {
  const storage = memStorage();
  const store = versionModel.createVersionStore(storage);
  const spec = makeSpec();
  const { entry } = store.save(spec, 'baseline', { now: 1000 });
  const restored = store.get(entry.id).spec;
  assert.deepEqual(restored, spec);
  restored.rounds[0].card.first = '污染';
  assert.equal(store.get(entry.id).spec.rounds[0].card.first, '想做', '快照被引用泄漏');
});

test('版本存储：JSON 损坏时回退为空列表', () => {
  const storage = memStorage();
  storage.setItem(versionModel.VERSIONS_KEY, '{not json');
  const store = versionModel.createVersionStore(storage);
  assert.deepEqual(store.list(), []);
});

// ── 运行 ────────────────────────────────────────────────────────────────────
let passed = 0;
const failures = [];
for (const t of tests) {
  try {
    t.fn();
    passed++;
  } catch (err) {
    failures.push({ name: t.name, err });
  }
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} 个用例失败：`);
  for (const f of failures) {
    console.error(`\n  ✗ ${f.name}\n    ${String(f.err?.stack || f.err).split('\n').slice(0, 6).join('\n    ')}`);
  }
  console.error(`\nRan ${tests.length} tests · ${passed} passed · ${failures.length} failed`);
  process.exit(1);
}

console.log(`✓ script model`);
console.log(`Ran ${tests.length} tests · ${passed} passed · 0 failed`);
