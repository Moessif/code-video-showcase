#!/usr/bin/env node
/**
 * test-domains.mjs — 垂直领域（kind）覆盖的回归（v2.5，纯 Node）。
 *
 * v2.5 把领域从 8 扩到 24（新增 16 个研究背书的垂直场景）。本测试保证：
 *   1. 每个 kind 都产出合法 spec，且 meta.kind 正确；
 *   2. 每个 kind 都有默认 style/theme/mood/cta，且 style/theme/mood 都是合法枚举；
 *   3. 新领域关键词能命中（健身/音乐/游戏/房产/播客/公益/美食/更新日志…）；
 *   4. 老关键词映射不被新规则抢走（教程/科普→knowledge，年度→annual，产品发布→launch…）；
 *   5. 每个 kind 都能推导出合法动效档位（KIND_MOTION 全覆盖）。
 *
 * 退出码 0/1。零依赖。
 */
import assert from 'node:assert/strict';
import { nl2spec, KIND_IDS, STYLE_IDS, THEME_IDS, MOODS } from './nl2spec.mjs';
import { normalizeSpec, validateSpec } from '../templates/spec.mjs';
import { deriveMotionProfile, isMotionLevel } from '../templates/motion-profile.mjs';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
}

test('领域数量 >= 24（8 原有 + 16 新增）', () => {
  assert.ok(KIND_IDS.length >= 24, `only ${KIND_IDS.length} kinds`);
  for (const k of ['tutorial', 'changelog', 'event', 'podcast', 'travel', 'food', 'fitness', 'realestate', 'fintech', 'healthcare', 'course', 'gaming', 'music', 'nonprofit', 'sports', 'localbiz']) {
    assert.ok(KIND_IDS.includes(k), `missing new kind ${k}`);
  }
});

test('每个 kind 产出合法 spec 且 meta.kind 正确', () => {
  for (const k of KIND_IDS) {
    const s = nl2spec('做个视频', { kind: k });
    assert.equal(s.meta.kind, k, `${k}: meta.kind`);
    const errs = validateSpec(normalizeSpec(s)).filter((i) => i.level === 'error');
    assert.equal(errs.length, 0, `${k}: ${JSON.stringify(errs)}`);
  }
});

test('每个 kind 的默认 style/theme/mood 都是合法枚举', () => {
  for (const k of KIND_IDS) {
    const s = nl2spec('做个视频', { kind: k });
    assert.ok(STYLE_IDS.includes(s.look.style), `${k}: style ${s.look.style} not in STYLE_IDS`);
    assert.ok(THEME_IDS.includes(s.look.theme), `${k}: theme ${s.look.theme} not in THEME_IDS`);
    assert.ok(MOODS.includes(s.audio.mood), `${k}: mood ${s.audio.mood} not in MOODS`);
    assert.ok(s.meta.cta && s.meta.cta.length > 0, `${k}: empty cta`);
  }
});

test('新领域关键词命中', () => {
  const cases = [
    ['健身训练视频', 'fitness'], ['新歌首发', 'music'], ['游戏神操作', 'gaming'],
    ['房产看房', 'realestate'], ['播客访谈', 'podcast'], ['公益捐赠', 'nonprofit'],
    ['美食食谱', 'food'], ['版本更新日志', 'changelog'], ['旅行攻略', 'travel'],
    ['金融理财', 'fintech'], ['健康养生', 'healthcare'], ['网课报名', 'course'],
    ['比赛集锦', 'sports'], ['探店餐厅', 'localbiz'], ['活动邀请函', 'event'],
    ['实操手把手', 'tutorial'],
  ];
  for (const [t, want] of cases) {
    const s = nl2spec(t);
    assert.equal(s.meta.kind, want, `"${t}" -> ${s.meta.kind}, want ${want}`);
  }
});

test('老关键词映射不被新规则抢走（回归）', () => {
  const cases = [
    ['知识科普短视频', 'knowledge'], ['白板手绘教程，知识科普', 'knowledge'],
    ['年度总结视频', 'annual'], ['产品发布视频', 'launch'],
    ['电商带货', 'ecommerce'], ['招聘宣传片', 'recruiting'],
    ['品牌故事', 'brand-story'], ['数据报告', 'data-report'],
    ['an explainer about fourier', 'knowledge'], ['annual recap 2025', 'annual'],
  ];
  for (const [t, want] of cases) {
    const s = nl2spec(t);
    assert.equal(s.meta.kind, want, `"${t}" -> ${s.meta.kind}, want ${want}`);
  }
});

test('每个 kind 都能推导合法动效档位', () => {
  for (const k of KIND_IDS) {
    const level = deriveMotionProfile({ kind: k });
    assert.ok(isMotionLevel(level), `${k}: bad motion level ${level}`);
  }
});

test('kind × style 推导：style 特例优先于 kind 默认', () => {
  // cyber-glitch 恒为 maximal，无论 kind
  assert.equal(deriveMotionProfile({ kind: 'podcast', style: 'cyber-glitch' }), 'maximal');
  // 无 style 时走 kind 默认
  assert.equal(deriveMotionProfile({ kind: 'fitness' }), 'maximal');
  assert.equal(deriveMotionProfile({ kind: 'healthcare' }), 'calm');
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);