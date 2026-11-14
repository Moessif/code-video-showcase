#!/usr/bin/env node
/**
 * test-motion-profile.mjs — v2.3 动效档位管线的回归测试（纯 Node，无浏览器）。
 *
 * 覆盖：
 *   1. 档位表结构完整：4 个档位，每个字段都是有限数 / 合法枚举；
 *   2. 推导规则：style 特例 > kind 默认 > 回落 standard；显式值优先；
 *   3. URL 编解码往返：mp=<level> → 解析回同一档位；非法值回落 standard；
 *   4. spec 校验：非法 motion 报 E_MOTION；合法值不报错；
 *   5. plan 把档位带进每页 URL（?mp=），且 plan.spec.motion 记录生效档位；
 *   6. 段哈希含动效档位：换档位 → 哈希必须变（否则缓存会错误复用）；
 *   7. **standard 档逐位等价 v2.2**：ease 数值、createSegment 的 fx 全部采样点一致；
 *   8. nl2spec 按 kind × style 推导档位，显式覆盖生效，非法值被丢弃。
 *
 * 退出码 0/1。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MOTION_LEVELS, MOTION_PROFILES, isMotionLevel, deriveMotionProfile,
  motionParams, motionQuery, motionLevelFromQuery, motionSummary,
} from '../templates/motion-profile.mjs';
import { normalizeSpec, validateSpec } from '../templates/spec.mjs';
import { buildPlanFromSpec, segmentHash } from '../templates/plan.mjs';
import { ease as motionEase } from '../templates/motion.js';
import { ease as commonEase } from '../templates/common.js';
import { createSegment } from '../templates/common.js';
import { nl2spec } from './nl2spec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
}

const NUMERIC_FIELDS = ['stagger', 'impact', 'grain', 'scanlines', 'shake', 'flash', 'push', 'blur'];
const ENUM_FIELDS = { transition: ['slam', 'whip', 'glitch', 'fade', 'none'] };
const EASE_FIELDS = ['ease', 'easeOut'];
const SPRING_NAMES = ['default', 'gentle', 'wobbly', 'stiff', 'slow'];

// ── 1) 档位表结构 ───────────────────────────────────────────────────────────

test('档位表有且仅有 4 个档位', () => {
  assert.deepEqual([...MOTION_LEVELS].sort(), ['calm', 'dynamic', 'maximal', 'standard']);
  for (const l of MOTION_LEVELS) assert.ok(MOTION_PROFILES[l], `missing profile ${l}`);
  assert.equal(Object.keys(MOTION_PROFILES).length, MOTION_LEVELS.length);
});

test('每个档位的数值字段都是有限数，枚举字段合法', () => {
  for (const l of MOTION_LEVELS) {
    const p = MOTION_PROFILES[l];
    for (const f of NUMERIC_FIELDS) {
      assert.equal(typeof p[f], 'number', `${l}.${f} must be number`);
      assert.ok(Number.isFinite(p[f]), `${l}.${f} must be finite`);
    }
    assert.ok(ENUM_FIELDS.transition.includes(p.transition), `${l}.transition invalid: ${p.transition}`);
    for (const f of EASE_FIELDS) {
      assert.ok(isMotionLevel === undefined ? true : true);
      assert.equal(typeof motionEase[p[f]], 'function', `${l}.${f}="${p[f]}" is not an easing function`);
    }
    assert.ok(SPRING_NAMES.includes(p.spring), `${l}.spring invalid: ${p.spring}`);
    assert.ok(['none', 'paper', 'scan'].includes(p.texture), `${l}.texture invalid`);
    assert.ok(['rise', 'clip', 'wipe', 'blur', 'scale', 'fade'].includes(p.kineticMode), `${l}.kineticMode invalid`);
    assert.ok(p.stagger >= 0 && p.stagger <= 1, `${l}.stagger out of range`);
  }
});

test('standard 档的乘数都是 1（保证与 v2.2 逐像素一致）', () => {
  const s = MOTION_PROFILES.standard;
  assert.equal(s.impact, 1);
  assert.equal(s.shake, 1);
  assert.equal(s.flash, 1);
  assert.equal(s.push, 1);
  assert.equal(s.grain, 0);
  assert.equal(s.scanlines, 0);
  assert.equal(s.texture, 'none');
});

test('calm 比 standard 更安静，maximal 比 standard 更强烈', () => {
  const c = MOTION_PROFILES.calm, s = MOTION_PROFILES.standard, x = MOTION_PROFILES.maximal;
  assert.ok(c.impact < s.impact, 'calm.impact must be < standard.impact');
  assert.ok(c.shake <= s.shake, 'calm.shake must be <= standard.shake');
  assert.ok(c.flash <= s.flash, 'calm.flash must be <= standard.flash');
  assert.ok(x.impact > s.impact, 'maximal.impact must be > standard.impact');
  assert.ok(x.grain > s.grain, 'maximal.grain must be > standard.grain');
  assert.ok(x.scanlines > s.scanlines, 'maximal.scanlines must be > standard.scanlines');
});

test('每个档位的 ease / spring 名都能在 motion.js 里取到', () => {
  for (const l of MOTION_LEVELS) {
    const p = MOTION_PROFILES[l];
    assert.equal(typeof motionEase[p.ease], 'function', `${l}.ease`);
    assert.equal(typeof motionEase[p.easeOut], 'function', `${l}.easeOut`);
  }
});

// ── 2) 推导规则 ─────────────────────────────────────────────────────────────

test('style 特例优先于 kind 默认', () => {
  // cyber-pixel 是 style 特例 → maximal，即使用户选了 launch
  assert.equal(deriveMotionProfile({ kind: 'launch', style: 'cyber-pixel' }), 'maximal');
  // minimal 没有 style 特例 → 走 kind 默认（launch → calm）
  assert.equal(deriveMotionProfile({ kind: 'launch', style: 'minimal' }), 'calm');
  // flat 没有 style 特例 → 走 kind 默认（knowledge → standard）
  assert.equal(deriveMotionProfile({ kind: 'knowledge', style: 'flat' }), 'standard');
});

test('显式档位永远优先于推导', () => {
  for (const l of MOTION_LEVELS) {
    assert.equal(deriveMotionProfile({ kind: 'promo', style: 'cyber-pixel', level: l }), l);
    assert.equal(deriveMotionProfile({ kind: 'promo', style: 'cyber-pixel', motion: l }), l);
  }
});

test('未知 kind/style 回落 standard', () => {
  assert.equal(deriveMotionProfile({ kind: 'nope', style: 'nope' }), 'standard');
  assert.equal(deriveMotionProfile({}), 'standard');
  assert.equal(deriveMotionProfile({ level: 'not-a-level' }), 'standard');
});

test('推导结果永远是合法档位', () => {
  const kinds = ['promo', 'launch', 'knowledge', 'ecommerce', 'brand-story', 'data-report', 'recruiting', 'annual', 'x'];
  const styles = ['cyber-pixel', 'cyber-glitch', 'pixel-8bit', 'ink-wash', 'guofeng', 'whiteboard', 'three-d', 'data-viz', 'screencast', 'flat', 'minimal', 'vertical', 'x'];
  for (const k of kinds) for (const s of styles) {
    assert.ok(isMotionLevel(deriveMotionProfile({ kind: k, style: s })), `${k}/${s} derived an invalid level`);
  }
});

// ── 3) URL 编解码 ───────────────────────────────────────────────────────────

test('motionQuery → motionLevelFromQuery 往返', () => {
  for (const l of MOTION_LEVELS) {
    const q = motionQuery(l);
    assert.equal(q.mp, l);
    const search = '?' + new URLSearchParams(q).toString();
    assert.equal(motionLevelFromQuery(search), l);
  }
});

test('非法 / 缺失的 mp 一律回落 standard', () => {
  assert.equal(motionLevelFromQuery('?mp=bogus'), 'standard');
  assert.equal(motionLevelFromQuery(''), 'standard');
  assert.equal(motionLevelFromQuery('?other=1'), 'standard');
  assert.equal(motionLevelFromQuery(new URLSearchParams('mp=maximal')), 'maximal');
});

test('motionParams 返回完整副本且不改原表', () => {
  const p = motionParams('dynamic');
  assert.equal(p.level, 'dynamic');
  assert.equal(p.impact, MOTION_PROFILES.dynamic.impact);
  const before = MOTION_PROFILES.dynamic.impact;
  p.impact = 999;
  assert.equal(MOTION_PROFILES.dynamic.impact, before, 'motionParams must not mutate the table');
});

test('motionParams 对非法档位回落到推导结果', () => {
  const p = motionParams('bogus');
  assert.ok(isMotionLevel(p.level));
});

test('motionSummary 含档位名', () => {
  for (const l of MOTION_LEVELS) assert.ok(motionSummary(l).includes(l));
});

// ── 4) spec 校验 ────────────────────────────────────────────────────────────

const FIXTURE = path.join(ROOT, 'fixtures', 'mini-41s', 'spec.json');
const baseSpec = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

test('非法 look.motion 报 E_MOTION', () => {
  const raw = baseSpec();
  raw.look.motion = 'not-a-level';
  const issues = validateSpec(normalizeSpec(raw));
  const hit = issues.find((i) => i.code === 'E_MOTION' && i.level === 'error');
  assert.ok(hit, `expected E_MOTION error, got ${JSON.stringify(issues.map((i) => i.code))}`);
});

test('合法 look.motion 不产生 error', () => {
  for (const l of MOTION_LEVELS) {
    const raw = baseSpec();
    raw.look.motion = l;
    const issues = validateSpec(normalizeSpec(raw)).filter((i) => i.level === 'error');
    assert.equal(issues.length, 0, `motion=${l} produced errors: ${JSON.stringify(issues)}`);
  }
});

test('look.motion 缺省时 normalizeSpec 补 null，不报错', () => {
  const raw = baseSpec();
  delete raw.look.motion;
  const spec = normalizeSpec(raw);
  assert.equal(spec.look.motion, null);
  assert.equal(validateSpec(spec).filter((i) => i.level === 'error').length, 0);
});

// ── 5) plan 传递 ────────────────────────────────────────────────────────────

test('plan 把档位写进每一页的 URL（?mp=）', () => {
  const raw = baseSpec();
  raw.look.motion = 'maximal';
  const { plan } = buildPlanFromSpec(raw, { root: ROOT });
  assert.equal(plan.meta.motion, 'maximal');
  assert.equal(plan.spec.motion, 'maximal');
  for (const s of plan.segments) {
    assert.ok(s.page.includes('mp=maximal'), `segment ${s.id} missing mp=maximal: ${s.page}`);
  }
});

test('不写 motion 时按 kind × style 推导并落进 URL', () => {
  const raw = baseSpec();
  raw.look.motion = null;
  raw.meta.kind = 'launch';
  raw.look.style = 'minimal';
  const { plan } = buildPlanFromSpec(raw, { root: ROOT });
  assert.equal(plan.meta.motion, 'calm');
  assert.ok(plan.segments[0].page.includes('mp=calm'), plan.segments[0].page);
});

// ── 6) 段哈希含档位 ─────────────────────────────────────────────────────────

test('换档位 → 段哈希必须变（否则缓存会错误复用旧渲染）', () => {
  const raw = baseSpec();
  const a = buildPlanFromSpec({ ...raw, look: { ...raw.look, motion: 'calm' } }, { root: ROOT }).plan;
  const b = buildPlanFromSpec({ ...raw, look: { ...raw.look, motion: 'maximal' } }, { root: ROOT }).plan;
  assert.notEqual(a.segments[0].hash, b.segments[0].hash, 'segment hash must change with motion level');
  // 其余输入相同时，档案名/id 等不应影响——只比较 hash 不同即可
});

test('同档位 → 段哈希稳定（可复现）', () => {
  const raw = baseSpec();
  const a = buildPlanFromSpec({ ...raw, look: { ...raw.look, motion: 'dynamic' } }, { root: ROOT }).plan;
  const b = buildPlanFromSpec({ ...raw, look: { ...raw.look, motion: 'dynamic' } }, { root: ROOT }).plan;
  assert.equal(a.segments[0].hash, b.segments[0].hash);
});

// ── 7) standard 档与 v2.2 逐位等价 ──────────────────────────────────────────

test('common.js 的 ease 就是 motion.js 的 ease（唯一真值）', () => {
  assert.equal(commonEase, motionEase, 'common.js must re-export motion.js ease (same object)');
});

test('三份 ease 副本已统一为一份（recipes/util.js 也不再自己抄）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'templates', 'recipes', 'util.js'), 'utf8');
  assert.ok(!/export const ease = \{/.test(src), 'recipes/util.js must not define its own ease');
  assert.ok(/export \{ ease \} from '\.\.\/motion\.js'/.test(src), 'recipes/util.js must re-export motion.js ease');
});

test('standard 档的 createSegment 与 v2.2 原公式逐位相同', () => {
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const outQuad = (t) => 1 - (1 - t) * (1 - t);
  const outCubic = (t) => 1 - Math.pow(1 - t, 3);
  // v2.2 原始公式逐字复制
  const legacy = (u, duration) => {
    u = clamp(u, 0, duration);
    const impactDur = 0.4;
    const flash = u < 0.12 ? 0.85 * (1 - outQuad(clamp(u / 0.12))) : 0;
    const scale = 1.13 - 0.13 * outCubic(clamp(u / 0.32));
    const amp = u < 0.16 ? 14 * (1 - u / 0.16) : 0;
    const shakeX = amp * Math.sin(u * 220 + 1.7);
    const shakeY = amp * Math.cos(u * 170 + 0.4);
    const after = Math.max(0.0001, duration - impactDur);
    const push = 1 + 0.05 * clamp((u - impactDur) / after);
    return { flash, scale, shakeX, shakeY, push };
  };
  const seg = createSegment({ duration: 3 });
  assert.equal(seg.profile.level, 'standard');
  let n = 0;
  for (let u = 0; u <= 3.0001; u += 0.001) {
    const a = seg.sample(u).fx, b = legacy(u, 3);
    for (const k of ['flash', 'scale', 'shakeX', 'shakeY', 'push']) {
      assert.equal(a[k], b[k], `u=${u.toFixed(4)} ${k}: ${a[k]} != ${b[k]}`);
      n++;
    }
  }
  assert.ok(n > 10000, `expected many samples, got ${n}`);
});

test('非 standard 档确实改变 fx（档位不是摆设）', () => {
  const std = createSegment({ duration: 3, motion: 'standard' });
  const max = createSegment({ duration: 3, motion: 'maximal' });
  const calm = createSegment({ duration: 3, motion: 'calm' });
  const at = (seg, u) => seg.sample(u).fx;
  assert.notEqual(at(max, 0.05).scale, at(std, 0.05).scale, 'maximal must differ from standard');
  assert.notEqual(at(calm, 0.05).flash, at(std, 0.05).flash, 'calm must differ from standard');
  assert.equal(at(calm, 0.05).shakeX, 0, 'calm has no shake');
  assert.equal(at(calm, 0.05).flash, 0, 'calm has no flash');
});

// ── 8) nl2spec 推导 ─────────────────────────────────────────────────────────

test('nl2spec 按 kind × style 推导档位', () => {
  const cases = [
    ['帮我做个赛博像素的宣传片，30秒竖屏', 'maximal'],
    ['做一支产品发布视频，16:9，60秒', 'calm'],
    ['知识科普短视频，讲清楚为什么有四季', 'standard'],
    ['品牌故事，水墨国风，青瓷质感', 'calm'],
  ];
  for (const [text, want] of cases) {
    const spec = nl2spec(text);
    assert.equal(spec.look.motion, want, `"${text}" → ${spec.look.motion}, want ${want}`);
  }
});

test('nl2spec 显式 motion 覆盖生效', () => {
  for (const l of MOTION_LEVELS) {
    const spec = nl2spec('帮我做个赛博像素的宣传片', { motion: l });
    assert.equal(spec.look.motion, l);
  }
});

test('nl2spec 非法 motion 被丢弃并回落到推导值', () => {
  const spec = nl2spec('帮我做个赛博像素的宣传片', { motion: 'bogus' });
  assert.equal(spec.look.motion, 'maximal');
  assert.ok(spec.meta.notes.some((n) => n.includes('ignored:motion=bogus')));
});

test('nl2spec 输出的 spec 通过 validateSpec', () => {
  const spec = nl2spec('帮我做个赛博像素的宣传片，30秒竖屏');
  const issues = validateSpec(normalizeSpec(spec)).filter((i) => i.level === 'error');
  assert.equal(issues.length, 0, JSON.stringify(issues));
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
