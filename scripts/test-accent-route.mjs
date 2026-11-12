#!/usr/bin/env node
/**
 * test-accent-route.mjs — 强调色覆盖（brand / accentFix）真的进到画面的回归（v2.3.1，纯 Node）。
 *
 * 背景（v2.3 审计发现的第二个产品级断链）：
 *   `spec.look.accentOverride` 被 `spec-lint` 用于对比度计算、被 `cvs brand apply`
 *   写成品牌色，也会由 accentFix 写入对比度安全主色——但**从来没有任何页面收到它**。
 *   页面只读 `?theme=<id>`，于是：
 *     - 品牌色进了 spec 却不出现在成片里；
 *     - accentFix 只是让 lint 闭嘴，画面仍是原来那套不合规配色。
 *
 * 修法：spec.look.accentOverride → specToTimeline 的 meta.accent → buildPlan 把
 *   ?accent= / ?accentInk= / ?accentSoft= 拼进每个页面 URL → themes.js 的
 *   themeFromURL() 读回来并调用 accentOverride()。
 *
 * 断言：
 *   1. normalizeAccentOverride 处理 null / 字符串 / 部分对象 / 非法值；
 *   2. 没有覆盖时，plan 的 URL 不带任何 accent 参数（旧成片逐像素不变）；
 *   3. 有覆盖时，**每一类段**（opening/card/style/more/flash/ending）的 URL 都带；
 *   4. themeFromURL 真的把 accent/ink/soft 应用到主题上；
 *   5. 不带参数时 themeFromURL 返回的主题与原来逐字段相同；
 *   6. accent 覆盖进入 segmentHash（换品牌色必须重渲染）；
 *   7. brand apply 的端到端：品牌色出现在 plan URL 里。
 *
 * 退出码 0/1。零依赖。
 */
import assert from 'node:assert/strict';

import { normalizeAccentOverride, specToTimeline } from '../templates/spec.mjs';
import { buildPlanFromSpec, segmentHash } from '../templates/plan.mjs';
import { themeFromURL, getTheme } from '../templates/themes.js';
import { applyBrand } from './brand.mjs';
import { nl2spec } from './nl2spec.mjs';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
}

const ROOT = process.cwd();
const params = (page) => new URLSearchParams(String(page).split('?')[1] || '');

function spec(mutate = () => {}) {
  const s = {
    specVersion: 1,
    meta: { name: 'accent-test', brand: 'TEST', cta: '', locale: 'zh-CN' },
    format: { width: 1920, height: 1080, fps: 30, aspect: '16:9', duration: 4.5 },
    look: { mode: 'showcase', style: null, theme: 'coral-noir', accentOverride: null },
    audio: { mood: 'electronic', bpm: 120, vo: null },
    structure: { opening: 1, round: 1, card: 0.4, ending: 1, moreCard: 1, flash: { count: 2, each: 0.25 } },
    opening: { page: 'templates/segment.html', name: 'opening' },
    rounds: [{
      id: 'r01',
      name: 'accent-round',
      card: { layout: 0, first: '测试', keyword: '强调色？', page: 'templates/big-card.html' },
      style: { page: 'templates/segment.html', t0: 0.3, speed: 1.3 },
    }],
    moreCard: { page: 'templates/big-card.html', first: '还有', keyword: '更多？' },
    flash: { page: 'templates/segment.html' },
    ending: { page: 'templates/segment.html', name: 'ending' },
    assets: [],
    patches: [],
    render: { quality: 'master', preset: 'bilibili', concurrency: 2, outDir: 'out' },
  };
  mutate(s);
  return s;
}

// ── 1) normalizeAccentOverride ──────────────────────────────────────────────

test('normalizeAccentOverride: null / undefined / 非对象 → null', () => {
  assert.equal(normalizeAccentOverride(null), null);
  assert.equal(normalizeAccentOverride(undefined), null);
  assert.equal(normalizeAccentOverride(42), null);
});

test('normalizeAccentOverride: 字符串形式', () => {
  assert.deepEqual(normalizeAccentOverride('#c2410c'), { accent: '#c2410c' });
});

test('normalizeAccentOverride: 部分对象只保留合法键', () => {
  assert.deepEqual(normalizeAccentOverride({ accentInk: '#151d1f' }), { accentInk: '#151d1f' });
  assert.deepEqual(
    normalizeAccentOverride({ accent: '#d33a40', accentInk: 'not-a-color', accentSoft: '#ff9aa0' }),
    { accent: '#d33a40', accentSoft: '#ff9aa0' },
  );
});

test('normalizeAccentOverride: 一个合法键都没有 → null', () => {
  assert.equal(normalizeAccentOverride({ accent: 'red' }), null);
  assert.equal(normalizeAccentOverride({ accentSoft: 'rgb(0,0,0)' }), null);
});

test('normalizeAccentOverride: 3 位 hex 也接受', () => {
  assert.deepEqual(normalizeAccentOverride('#abc'), { accent: '#abc' });
});

// ── 2) 没有覆盖 → URL 不变 ──────────────────────────────────────────────────

test('没有 accentOverride 时，plan 的每个 URL 都不带 accent 参数', () => {
  const { plan } = buildPlanFromSpec(spec(), { root: ROOT });
  for (const seg of plan.segments) {
    const q = params(seg.page);
    for (const k of ['accent', 'accentInk', 'accentSoft']) {
      assert.equal(q.get(k), null, `${seg.id} unexpectedly carries ${k}`);
    }
  }
});

test('没有覆盖时 meta.accent 是 null，plan.spec.accent 也是 null', () => {
  const { plan } = buildPlanFromSpec(spec(), { root: ROOT });
  assert.equal(plan.meta.accent, null);
  assert.equal(plan.spec.accent, null);
});

// ── 3) 有覆盖 → 每一类段都带 ────────────────────────────────────────────────

test('有 accentOverride 时，opening/card/style/more/flash/ending 全部带上', () => {
  const { plan } = buildPlanFromSpec(
    spec((s) => { s.look.accentOverride = { accent: '#00d4ff', accentInk: '#001016' }; }),
    { root: ROOT },
  );
  const kinds = new Set();
  for (const seg of plan.segments) {
    kinds.add(seg.kind);
    const q = params(seg.page);
    assert.equal(q.get('accent'), '#00d4ff', `${seg.id} (${seg.kind}) lost accent`);
    assert.equal(q.get('accentInk'), '#001016', `${seg.id} (${seg.kind}) lost accentInk`);
  }
  assert.deepEqual([...kinds].sort(), ['card', 'ending', 'flash', 'more', 'opening', 'style']);
});

test('只给 accentInk 的部分覆盖只下发 accentInk', () => {
  const { plan } = buildPlanFromSpec(
    spec((s) => { s.look.accentOverride = { accentInk: '#151d1f' }; }),
    { root: ROOT },
  );
  for (const seg of plan.segments) {
    const q = params(seg.page);
    assert.equal(q.get('accentInk'), '#151d1f', `${seg.id} lost accentInk`);
    assert.equal(q.get('accent'), null, `${seg.id} invented an accent`);
  }
});

test('accentSoft 只在给出时才下发', () => {
  const { plan } = buildPlanFromSpec(
    spec((s) => { s.look.accentOverride = { accent: '#00d4ff', accentSoft: '#9fe9ff' }; }),
    { root: ROOT },
  );
  const q = params(plan.segments[0].page);
  assert.equal(q.get('accentSoft'), '#9fe9ff');
  assert.equal(q.get('accentInk'), null);
});

// ── 4/5) themeFromURL 真的应用了覆盖 ───────────────────────────────────────

test('themeFromURL 应用 accent + accentInk', () => {
  const t = themeFromURL('?theme=coral-noir&accent=%2300d4ff&accentInk=%23001016');
  assert.equal(t.colors.accent, '#00d4ff');
  assert.equal(t.colors.accentInk, '#001016');
  assert.deepEqual(t.override, { accent: '#00d4ff', accentInk: '#001016', accentSoft: t.colors.accentSoft });
});

test('themeFromURL 应用 accentSoft', () => {
  const t = themeFromURL('?theme=cyber-neon&accentSoft=%239fe9ff');
  assert.equal(t.colors.accentSoft, '#9fe9ff');
  assert.equal(t.colors.accent, getTheme('cyber-neon').colors.accent);
});

test('themeFromURL 无 accent 参数时与旧行为逐字段一致', () => {
  const a = themeFromURL('?theme=aqua-morandi');
  const b = getTheme('aqua-morandi');
  assert.equal(a.colors.accent, b.colors.accent);
  assert.equal(a.colors.accentInk, b.colors.accentInk);
  assert.equal(a.colors.accentSoft, b.colors.accentSoft);
  assert.equal(a.override, undefined, 'no override should be recorded');
});

test('themeFromURL 的覆盖结果与 getTheme 的默认值不同（真的生效了）', () => {
  const t = themeFromURL('?theme=coral-noir&accent=%2300d4ff');
  assert.notEqual(t.colors.accent, getTheme('coral-noir').colors.accent);
});

// ── 6) 进哈希 ──────────────────────────────────────────────────────────────

test('accent 覆盖进入 segmentHash（换品牌色必须重渲染）', () => {
  const a = spec();
  const b = spec((s) => { s.look.accentOverride = { accent: '#00d4ff' }; });
  const pa = buildPlanFromSpec(a, { root: ROOT }).plan;
  const pb = buildPlanFromSpec(b, { root: ROOT }).plan;
  assert.notEqual(pa.segments[0].hash, pb.segments[0].hash, 'hash did not change with accent');
  // 同输入必须同哈希
  const pc = buildPlanFromSpec(a, { root: ROOT }).plan;
  assert.equal(pa.segments[0].hash, pc.segments[0].hash, 'hash is not deterministic');
});

test('segmentHash 直接调用时也覆盖 accent', () => {
  const seg = { id: 'x', kind: 'style', page: 'templates/segment.html', startFrame: 0, frames: 30, t0: 0, speed: 1 };
  const base = { theme: 'coral-noir', motion: 'standard', brand: 'B' };
  const h1 = segmentHash(seg, { ...base, accent: null }, {});
  const h2 = segmentHash(seg, { ...base, accent: { accent: '#00d4ff' } }, {});
  assert.notEqual(h1, h2);
});

// ── 7) brand apply 端到端 ──────────────────────────────────────────────────

test('cvs brand apply 的品牌色出现在 plan URL 里', () => {
  const s = spec();
  const brand = {
    name: 'TestBrand',
    colors: { accent: '#00d4ff' },
    bannedWords: [],
  };
  const applied = applyBrand(s, brand);
  assert.ok(applied.look.accentOverride, 'applyBrand did not write accentOverride');
  const { plan } = buildPlanFromSpec(applied, { root: ROOT });
  const q = params(plan.segments[0].page);
  assert.equal(String(q.get('accent')).toLowerCase(), '#00d4ff', 'brand accent never reached the page URL');
  // 页面侧真的解析出品牌色
  const t = themeFromURL(String(plan.segments[0].page).split('?')[1]);
  assert.equal(String(t.colors.accent).toLowerCase(), '#00d4ff');
});

// ── accentFix 真的改变画面参数（对比度安全主色） ─────────────────────────────

test('nl2spec 的 accentFix 会经 plan 下发到页面', () => {
  const s = nl2spec('做一条宣传片', { theme: 'claude-light' });
  assert.ok(s.look.accentOverride?.accent, 'nl2spec produced no accentFix');
  const { plan } = buildPlanFromSpec(s, { root: ROOT });
  const q = params(plan.segments[0].page);
  assert.equal(String(q.get('accent')).toLowerCase(), String(s.look.accentOverride.accent).toLowerCase());
  const t = themeFromURL(String(plan.segments[0].page).split('?')[1]);
  assert.equal(String(t.colors.accent).toLowerCase(), String(s.look.accentOverride.accent).toLowerCase());
});

test('specToTimeline 的 meta.accent 与 plan 一致', () => {
  const s = spec((v) => { v.look.accentOverride = { accent: '#d33a40', accentInk: '#ffffff' }; });
  const timeline = specToTimeline(s, { root: ROOT });
  assert.deepEqual(timeline.meta.accent, { accent: '#d33a40', accentInk: '#ffffff' });
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
