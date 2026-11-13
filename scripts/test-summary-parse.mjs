#!/usr/bin/env node
/**
 * test-summary-parse.mjs — 统一测试汇总解析器的回归（纯 Node）。
 *
 * 背景：仓库里的测试脚本有五种汇总写法。解析器曾经两处读错：
 *   1. 强制要求 "Ran N tests:" 前缀 → "34 tests: 32 passed, 2 failed" 落到通用模式，
 *      total 被读成 32（少报总数）；
 *   2. 用 m.length===4 判断「有 total」→ "51 passed, 4 failed" 只有 2 个捕获组，
 *      被当成「只有 passed」，**failed 丢成 0**。机器可读报告因此少报失败断言，
 *      CI 上只看 JSON 会以为全绿（退出码仍然是对的，所以人读汇总能发现）。
 *
 * 退出码 0/1。零依赖。
 */
import assert from 'node:assert/strict';
import { parseSummary } from './summary-parse.mjs';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
}

const FORMATS = [
  ['Ran 21 tests: 20 passed, 1 failed', { total: 21, passed: 20, failed: 1 }],
  ['34 tests: 32 passed, 2 failed', { total: 34, passed: 32, failed: 2 }],
  ['33 checks: 32 passed, 1 failed', { total: 33, passed: 32, failed: 1 }],
  ['51 passed, 4 failed', { total: 55, passed: 51, failed: 4 }],
  ['22 tests passed', { total: 22, passed: 22, failed: 0 }],
  ['55 passed, 0 failed', { total: 55, passed: 55, failed: 0 }],
];

for (const [text, want] of FORMATS) {
  test(`格式读对：${text}`, () => {
    assert.deepEqual(parseSummary(text), want);
  });
}

test('失败断言数不会被丢成 0（回归 m.length 误判）', () => {
  const r = parseSummary('51 passed, 4 failed\nRESULT: FAIL');
  assert.equal(r.failed, 4, 'failed count must survive');
  assert.equal(r.total, 55);
});

test('带 RESULT 行与前置噪声仍能读对（只看尾部 12 行）', () => {
  const noise = Array.from({ length: 40 }, (_, i) => `PASS  case ${i}`).join('\n');
  const r = parseSummary(`${noise}\n\n51 passed, 4 failed\nRESULT: FAIL\n`);
  assert.deepEqual(r, { total: 55, passed: 51, failed: 4 });
});

test('CRLF 与缩进不影响解析', () => {
  assert.deepEqual(parseSummary('  51 passed, 4 failed  \r\nRESULT: FAIL\r\n'), { total: 55, passed: 51, failed: 4 });
});

test('total 与 passed+failed 不符时以自洽值为准', () => {
  const r = parseSummary('Ran 9 tests: 5 passed, 2 failed');
  assert.deepEqual(r, { total: 7, passed: 5, failed: 2 });
});

test('用例名里含汇总格式字符串时，仍取最后一条真实汇总', () => {
  // 本测试自己的输出就是这样：用例名里印着各种格式样本。
  const out = [
    '✓ 格式读对：Ran 21 tests: 20 passed, 1 failed',
    '✓ 格式读对：34 tests: 32 passed, 2 failed',
    '✓ 格式读对：51 passed, 4 failed',
    '',
    '12 tests: 12 passed, 0 failed',
  ].join('\n');
  assert.deepEqual(parseSummary(out), { total: 12, passed: 12, failed: 0 });
});

test('没有汇总行 → null（不臆造计数）', () => {
  assert.equal(parseSummary('nothing to see here'), null);
  assert.equal(parseSummary(''), null);
  assert.equal(parseSummary(null), null);
  assert.equal(parseSummary(undefined), null);
});

test('只有 passed 的格式不误报 failed', () => {
  assert.deepEqual(parseSummary('22 tests passed'), { total: 22, passed: 22, failed: 0 });
  assert.deepEqual(parseSummary('17 passed'), { total: 17, passed: 17, failed: 0 });
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);