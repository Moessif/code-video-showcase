#!/usr/bin/env node
/**
 * test-style-pages.mjs — 画风 → 渲染页 的契约测试（v2.3.1，纯 Node）。
 *
 * 背景：v2.3 审计发现 `?recipe=` 是死参数——所有画风都渲染 segment.html 的
 * 占位骨架。修法是 templates/style-pages.mjs 成为唯一真值，生成端按它填
 * `style.page`。本测试防止这张表再次与磁盘/枚举脱节。
 *
 * 断言：
 *   1. STYLE_PAGES 的键集合 === nl2spec 的 STYLE_IDS（不多不少）；
 *   2. 每个映射到的页面文件真实存在；
 *   3. 每个页面都实现了 window.renderFrame / window.__ready（不是静态图片）；
 *   4. 通用场景页存在；
 *   5. 未知画风回落到通用页，而不是崩；
 *   6. nl2spec 对每个画风产出的 style.page 与表一致；
 *   7. 每个画风产出的 spec 通过 validateSpec（无 error）；
 *   8. 表里的页面不含 Math.random / Date.now / performance.now / requestAnimationFrame；
 *   9. 所有映射页在 plan 里都能通过页面存在性检查。
 *
 * 退出码 0/1。零依赖。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  STYLE_PAGES, STYLE_RECIPE_IDS, GENERIC_PAGE,
  stylePageFor, styleRecipeIdFor, styleQueryFor,
} from '../templates/style-pages.mjs';
import { STYLE_IDS, nl2spec } from './nl2spec.mjs';
import { normalizeSpec, validateSpec } from '../templates/spec.mjs';
import { buildPlanFromSpec } from '../templates/plan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── 1) 枚举对齐 ─────────────────────────────────────────────────────────────

test('STYLE_PAGES 的键与 STYLE_IDS 完全一致', () => {
  const a = Object.keys(STYLE_PAGES).sort();
  const b = [...STYLE_IDS].sort();
  assert.deepEqual(a, b, `style-pages keys ${JSON.stringify(a)} != STYLE_IDS ${JSON.stringify(b)}`);
});

test('STYLE_RECIPE_IDS 覆盖同一批画风', () => {
  const a = Object.keys(STYLE_RECIPE_IDS).sort();
  const b = [...STYLE_IDS].sort();
  assert.deepEqual(a, b);
});

test('每个画风的 recipe 提示都是非空字符串', () => {
  for (const id of STYLE_IDS) {
    const r = styleRecipeIdFor(id);
    assert.equal(typeof r, 'string', `${id}: recipe id must be a string`);
    assert.ok(r.length > 0, `${id}: recipe id is empty`);
  }
});

// ── 2) 文件存在 ─────────────────────────────────────────────────────────────

test('每个映射到的页面文件都存在', () => {
  for (const [id, page] of Object.entries(STYLE_PAGES)) {
    assert.ok(fs.existsSync(path.join(ROOT, page)), `${id} → ${page} does not exist`);
  }
});

test('通用场景页存在', () => {
  assert.ok(fs.existsSync(path.join(ROOT, GENERIC_PAGE)), `${GENERIC_PAGE} missing`);
});

test('所有页面都在 templates/ 下且是 .html', () => {
  for (const [id, page] of Object.entries(STYLE_PAGES)) {
    assert.ok(page.startsWith('templates/') && page.endsWith('.html'), `${id} → ${page}`);
  }
});

// ── 3) 页面契约 ─────────────────────────────────────────────────────────────

test('每个页面都实现 renderFrame / __ready（不是静态图）', () => {
  for (const [id, page] of Object.entries(STYLE_PAGES)) {
    const src = read(page);
    assert.ok(/window\.renderFrame\s*=/.test(src), `${id} (${page}): no window.renderFrame`);
    assert.ok(/__ready/.test(src), `${id} (${page}): no __ready`);
  }
});

test('每个页面都不含非确定性 API', () => {
  const banned = ['Math.random(', 'Date.now(', 'performance.now(', 'requestAnimationFrame('];
  for (const [id, page] of Object.entries(STYLE_PAGES)) {
    const src = read(page);
    for (const b of banned) {
      // 注释里提到这些名字是允许的；只检查真正的调用
      const re = new RegExp(b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const lines = src.split('\n').filter((l) => re.test(l) && !/^\s*(\/\/|\*)/.test(l));
      assert.equal(lines.length, 0, `${id} (${page}) uses ${b}: ${lines[0]?.trim()}`);
    }
  }
});

// ── 4) 回落 ─────────────────────────────────────────────────────────────────

test('未知画风回落到通用页', () => {
  assert.equal(stylePageFor('nope'), GENERIC_PAGE);
  assert.equal(stylePageFor(''), GENERIC_PAGE);
  assert.equal(stylePageFor(null), GENERIC_PAGE);
  assert.equal(styleRecipeIdFor('nope'), null);
  assert.equal(styleQueryFor('nope'), '');
});

// ── 5) nl2spec 端到端 ───────────────────────────────────────────────────────

test('nl2spec 对每个画风产出正确的 style.page', () => {
  for (const id of STYLE_IDS) {
    const spec = nl2spec('做个宣传片', { style: id });
    const page = spec.rounds[0].style.page;
    assert.equal(page, STYLE_PAGES[id], `${id}: got ${page}, want ${STYLE_PAGES[id]}`);
  }
});

test('每个画风产出的 spec 都合法', () => {
  for (const id of STYLE_IDS) {
    const spec = nl2spec('做个宣传片', { style: id });
    const issues = validateSpec(normalizeSpec(spec)).filter((i) => i.level === 'error');
    assert.equal(issues.length, 0, `${id}: ${JSON.stringify(issues)}`);
  }
});

test('每个画风产出的 plan 页面都存在（assertPages 通过）', () => {
  for (const id of STYLE_IDS) {
    const spec = nl2spec('做个宣传片', { style: id });
    const { plan } = buildPlanFromSpec(spec, { root: ROOT });
    const stylePages = plan.segments.filter((s) => s.kind === 'style').map((s) => s.page);
    assert.ok(stylePages.length > 0, `${id}: no style segments`);
    for (const p of stylePages) {
      const bare = p.split('?')[0];
      assert.ok(fs.existsSync(path.join(ROOT, bare)), `${id}: missing ${bare}`);
      assert.ok(p.includes('recipe='), `${id}: page URL lost the recipe hint: ${p}`);
    }
  }
});

// ── 6) 不再有"画风指向占位骨架"的情况 ───────────────────────────────────────

test('除 vertical 外，没有画风落在通用占位页', () => {
  for (const id of STYLE_IDS) {
    if (id === 'vertical') continue;                // vertical 是通用竖屏卡，允许走通用页
    assert.notEqual(STYLE_PAGES[id], GENERIC_PAGE, `${id} still maps to the generic page`);
  }
});

test('segment.html 的占位骨架标记仍在（说明我们没有靠删标记来"修好"）', () => {
  const src = read(GENERIC_PAGE);
  assert.ok(/demo content|替换 drawScene/.test(src), 'generic page lost its placeholder marker');
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
