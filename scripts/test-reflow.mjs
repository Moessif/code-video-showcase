#!/usr/bin/env node
/**
 * test-reflow.mjs — C4-05 多平台重排（spec 级重排，不是裁切）的回归测试。
 *
 *   node scripts/test-reflow.mjs
 *
 * 覆盖：宽高互换、structure 不变、rounds 数量不变、card.layout 重映射、
 * round.style.reflow 参数、meta.reflowFrom、原 spec 不被修改、幂等性、
 * normalizeSpec/validateSpec 通过、reflowParams 数值与纯度。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

const reflow = await load('templates/reflow.mjs');
const { normalizeSpec, validateSpec } = await load('templates/spec.mjs');

const BASE = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/mini-41s/spec.json'), 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));
const ORIGINAL = clone(BASE);

// ── reflowParams ────────────────────────────────────────────────────────────

test('reflowParams(9:16) 给出竖屏安全区与字号系数', () => {
  const p = reflow.reflowParams('9:16');
  assert.equal(p.aspect, '9:16');
  assert.equal(p.width, 1080);
  assert.equal(p.height, 1920);
  assert.equal(p.scale, 0.72);
  assert.deepEqual(p.safe, [80, 120]);
  assert.ok(p.fontScale > 0 && p.fontScale < 1, `fontScale=${p.fontScale}`);
  assert.ok(Number.isInteger(p.maxLines) && p.maxLines >= 2, `maxLines=${p.maxLines}`);
  assert.equal(p.stack, true);
});

test('reflowParams(1:1) 比竖屏更宽松，安全区仍为正', () => {
  const p = reflow.reflowParams('1:1');
  assert.equal(p.width, 1080);
  assert.equal(p.height, 1080);
  assert.ok(p.scale > 0.72 && p.scale <= 1, `scale=${p.scale}`);
  assert.equal(p.safe.length, 2);
  assert.ok(p.safe.every((n) => Number.isFinite(n) && n > 0));
  assert.ok(p.fontScale > 0 && p.fontScale <= 1);
  assert.ok(Number.isInteger(p.maxLines) && p.maxLines >= 1);
});

test('reflowParams(16:9) 保持原生比例', () => {
  const p = reflow.reflowParams('16:9');
  assert.equal(p.width, 1920);
  assert.equal(p.height, 1080);
  assert.equal(p.scale, 1);
  assert.equal(p.stack, false);
});

test('reflowParams 返回新对象（调用方改 safe 不污染下一次）', () => {
  const a = reflow.reflowParams('9:16');
  a.safe.push(999);
  assert.deepEqual(reflow.reflowParams('9:16').safe, [80, 120]);
});

test('reflowParams 拒绝未知画幅', () => {
  assert.throws(() => reflow.reflowParams('4:5'), /aspect/i);
  assert.throws(() => reflow.reflowParams(''), /aspect/i);
});

// ── reflowSpec ──────────────────────────────────────────────────────────────

const vertical = reflow.reflowSpec(BASE, '9:16');

test('16:9 → 9:16 宽高互换且 format.aspect 更新', () => {
  assert.equal(vertical.format.width, 1080);
  assert.equal(vertical.format.height, 1920);
  assert.equal(vertical.format.aspect, '9:16');
  assert.equal(vertical.format.fps, BASE.format.fps);
  assert.equal(vertical.format.duration, BASE.format.duration);
});

test('structure 与 rounds 数量完全不变', () => {
  assert.deepEqual(vertical.structure, ORIGINAL.structure);
  assert.equal(vertical.rounds.length, ORIGINAL.rounds.length);
  assert.deepEqual(vertical.rounds.map((r) => r.id), ORIGINAL.rounds.map((r) => r.id));
});

test('card.layout 重映射到竖屏安全布局（layout 3 → 2 并记录来源）', () => {
  const byId = Object.fromEntries(vertical.rounds.map((r) => [r.id, r]));
  assert.equal(byId.r04.card.layout, 2, 'fixture r04 原本是左对齐 layout 3');
  assert.equal(byId.r04.card.layoutFrom, 3);
  assert.equal(byId.r01.card.layout, 0);
  assert.equal(byId.r01.card.layoutFrom, undefined);
  for (const r of vertical.rounds) {
    assert.ok(Number.isInteger(r.card.layout) && r.card.layout >= 0 && r.card.layout <= 3, `${r.id}.layout=${r.card.layout}`);
  }
});

test('每轮 style 增加 reflow: {scale:0.72, safe:[80,120], stack:true}', () => {
  for (const r of vertical.rounds) {
    assert.deepEqual(r.style.reflow, { scale: 0.72, safe: [80, 120], stack: true }, `${r.id}.style.reflow`);
    assert.equal(r.style.speed, ORIGINAL.rounds.find((o) => o.id === r.id).style.speed);
  }
});

test('meta.reflowFrom 记录横屏来源', () => {
  assert.deepEqual(vertical.meta.reflowFrom, { width: 1920, height: 1080, aspect: '16:9' });
  assert.equal(vertical.meta.name, BASE.meta.name);
});

test('原 spec 没有被修改（深比较 + 非同一引用）', () => {
  assert.deepEqual(BASE, ORIGINAL);
  assert.notEqual(vertical, BASE);
  assert.notEqual(vertical.rounds, BASE.rounds);
});

test('重排结果通过 normalizeSpec + validateSpec（无 error）', () => {
  const normalized = normalizeSpec(vertical);
  const errors = validateSpec(normalized).filter((i) => i.level === 'error');
  assert.deepEqual(errors, []);
  assert.equal(normalized.format.width, 1080);
  assert.equal(normalized.format.height, 1920);
  assert.equal(normalized.format.aspect, '9:16');
});

test('16:9 → 1:1 得到方图且仍保留全部轮次', () => {
  const square = reflow.reflowSpec(BASE, '1:1');
  assert.equal(square.format.width, 1080);
  assert.equal(square.format.height, 1080);
  assert.equal(square.format.aspect, '1:1');
  assert.deepEqual(square.structure, ORIGINAL.structure);
  assert.equal(square.rounds.length, ORIGINAL.rounds.length);
  assert.ok(square.rounds.every((r) => r.style.reflow && r.style.reflow.scale > 0.72));
  assert.deepEqual(square.meta.reflowFrom, { width: 1920, height: 1080, aspect: '16:9' });
});

test('非标准尺寸的 16:9 源也能记录来源（不产生 NaN）', () => {
  const raw = {
    specVersion: 1,
    meta: { name: 'raw' },
    format: { width: 1280, height: 720, aspect: '16:9', fps: 30 },
    rounds: [],
  };
  const out = reflow.reflowSpec(raw, '9:16');
  assert.equal(out.format.width, 1080);
  assert.equal(out.format.height, 1920);
  assert.deepEqual(out.meta.reflowFrom, { width: 1280, height: 720, aspect: '16:9' });
});

test('同一画幅重复重排是幂等的（不会叠加 reflowFrom）', () => {
  const twice = reflow.reflowSpec(vertical, '9:16');
  assert.deepEqual(twice, vertical);
});

test('目标画幅等于当前画幅且尺寸标准时是 no-op', () => {
  assert.deepEqual(reflow.reflowSpec(BASE, '16:9'), BASE);
});

test('reflowSpec 拒绝未知目标画幅', () => {
  assert.throws(() => reflow.reflowSpec(BASE, '4:5'), /aspect/i);
  assert.throws(() => reflow.reflowSpec(BASE, undefined), /aspect/i);
});

test('全流程后原 fixture 仍然未被修改', () => {
  assert.deepEqual(BASE, ORIGINAL);
});

const total = passed + failed;
console.log(`\nRan ${total} tests: ${passed} passed, ${failed} failed`);
console.log(`${passed} passed`);
if (failed) process.exit(1);
