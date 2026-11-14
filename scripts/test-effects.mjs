#!/usr/bin/env node
/**
 * test-effects.mjs — 共享确定性效果库（v2.5）的回归（纯 Node）。
 *
 * 覆盖：
 *   1. effectProbe 自检全绿；
 *   2. 目录完整性：分类齐全、core/draw 引用真实存在；
 *   3. 纯核确定性：同一 (t,seed) 逐位一致；不同 t 会变化（不是冻帧）；
 *   4. 值域 / 端点 / 单调性（粒子 alpha∈0..1、kenBurns 端点、vignette 中心亮边缘暗…）；
 *   5. 文字揭示：typewriter 半程、scramble 全解码、splitFlap 单调。
 *
 * 退出码 0/1。零依赖（不碰 DOM）。
 */
import assert from 'node:assert/strict';
import {
  EFFECTS, EFFECT_IDS, EFFECT_CATEGORIES, isEffect,
  typewriterText, scrambleText, splitFlapProgress, particleField,
  kenBurns, cameraShake, parallaxOffset, beatPulse, spectrumBins,
  vignetteFactor, halftoneRadius, effectProbe, hash01,
} from '../templates/effects.mjs';
import * as motion from '../templates/motion.js';
import * as effects from '../templates/effects.mjs';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
}

test('effectProbe 自检全绿', () => {
  const r = effectProbe();
  const bad = r.checks.filter((c) => !c.ok);
  assert.ok(r.ok, `probe failed: ${bad.map((b) => b.name).join(', ')}`);
  assert.ok(r.checks.length >= 20, `only ${r.checks.length} probe checks`);
});

test('目录完整性：分类齐全、引用真实存在', () => {
  assert.ok(EFFECT_IDS.length >= 24, `only ${EFFECT_IDS.length} effects`);
  for (const c of EFFECT_CATEGORIES) assert.ok(EFFECT_IDS.some((id) => EFFECTS[id].category === c), `missing category ${c}`);
  for (const id of EFFECT_IDS) {
    const e = EFFECTS[id];
    assert.ok(['text', 'particle', 'post', 'camera', 'audio'].includes(e.category), `${id} bad category`);
    assert.ok(e.label, `${id} no label`);
    if (e.core) assert.equal(typeof effects[e.core], 'function', `${id} core ${e.core} missing`);
    // 页面统一从 effects.mjs import 目录里的效果，所以每个 draw 目标都必须由
    // effects.mjs 自己导出（含 re-export 的 motion.js 原语）。只查 motion 会漏掉
    // 「import 了但没 re-export → 页面拿到 undefined」这类启动期 TypeError。
    if (e.draw) assert.equal(typeof effects[e.draw], 'function', `${id} draw ${e.draw} not exported by effects.mjs`);
  }
  assert.ok(isEffect('vignette') && !isEffect('nope'));
});

test('hash01 确定性且值域 0..1', () => {
  for (let i = 0; i < 50; i++) {
    const v = hash01(i, 7);
    assert.ok(v >= 0 && v < 1);
    assert.equal(v, hash01(i, 7));
  }
  assert.notEqual(hash01(1, 7), hash01(2, 7));
});

test('typewriter：半程 / 全程 / 空', () => {
  assert.equal(typewriterText('abcd', 0.5), 'ab');
  assert.equal(typewriterText('abcd', 1), 'abcd');
  assert.equal(typewriterText('abcd', 0), '');
  assert.equal(typewriterText('你好世界', 0.5), '你好');
});

test('scramble：未解码是乱码、全解码还原、空格保留、确定性', () => {
  const full = scrambleText('ABC DEF', 1, { seed: 3 });
  assert.equal(full, 'ABC DEF');
  const mid = scrambleText('ABCDEF', 0.5, { seed: 3, t: 0.5 });
  assert.equal(mid.slice(0, 3), 'ABC'); // 前一半已解码
  assert.notEqual(mid.slice(3), 'DEF'); // 后一半是乱码
  assert.equal(scrambleText('A B', 0, { seed: 1 })[1], ' '); // 空格不扰码
  assert.equal(mid, scrambleText('ABCDEF', 0.5, { seed: 3, t: 0.5 }));
  // 时间推进 → 乱码闪烁（不同 t 不同输出）
  assert.notEqual(scrambleText('ABCDEF', 0.2, { seed: 3, t: 0 }), scrambleText('ABCDEF', 0.2, { seed: 3, t: 1 }));
});

test('splitFlap：每字符进度单调非减、首字符先到', () => {
  const a = splitFlapProgress('abcde', 0.3);
  const b = splitFlapProgress('abcde', 0.8);
  for (let i = 0; i < a.length; i++) {
    assert.ok(a[i] >= 0 && a[i] <= 1);
    assert.ok(b[i] >= a[i], `char ${i} must advance`);
  }
  assert.ok(a[0] >= a[a.length - 1], 'first char leads');
});

test('particle：五种粒子确定性 + 值域 + 随 t 运动', () => {
  for (const kind of ['confetti', 'sparks', 'snow', 'bubbles', 'embers']) {
    const a = particleField(kind, 1.0, { seed: 5, count: 50 });
    const b = particleField(kind, 1.0, { seed: 5, count: 50 });
    assert.deepEqual(a, b, `${kind} deterministic`);
    assert.equal(a.length, 50);
    for (const p of a) {
      assert.ok(p.alpha >= 0 && p.alpha <= 1, `${kind} alpha`);
      assert.ok(p.r > 0 && Number.isFinite(p.x) && Number.isFinite(p.y), `${kind} finite`);
    }
    const c = particleField(kind, 2.0, { seed: 5, count: 50 });
    assert.notDeepEqual(a, c, `${kind} must move with t`);
    // 不同种子 → 不同布局
    assert.notDeepEqual(a, particleField(kind, 1.0, { seed: 6, count: 50 }));
  }
});

test('kenBurns：端点精确、中点插值、确定性', () => {
  const from = { scale: 1, x: 0, y: 0 }, to = { scale: 1.2, x: 40, y: -20 };
  const k0 = kenBurns(0, { dur: 4, from, to });
  const k4 = kenBurns(4, { dur: 4, from, to });
  assert.ok(Math.abs(k0.scale - 1) < 1e-9 && Math.abs(k0.x) < 1e-9);
  assert.ok(Math.abs(k4.scale - 1.2) < 1e-9 && Math.abs(k4.x - 40) < 1e-9 && Math.abs(k4.y + 20) < 1e-9);
  const k2 = kenBurns(2, { dur: 4, from, to });
  assert.ok(k2.scale > 1 && k2.scale < 1.2);
  assert.deepEqual(k2, kenBurns(2, { dur: 4, from, to }));
});

test('cameraShake：t=0 幅值上限、随 t 衰减、确定性', () => {
  const s0 = cameraShake(0, { amp: 20, seed: 2 });
  assert.ok(Math.abs(s0.x) <= 20 && Math.abs(s0.y) <= 20);
  const s5 = cameraShake(5, { amp: 20, seed: 2, decay: 6 });
  assert.ok(Math.hypot(s5.x, s5.y) < 0.01, 'must decay to ~0');
  assert.deepEqual(cameraShake(0.3, { seed: 2 }), cameraShake(0.3, { seed: 2 }));
});

test('parallax：深度比例', () => {
  assert.deepEqual(parallaxOffset(100, 50, 0.5), { x: 50, y: 25 });
  assert.deepEqual(parallaxOffset(100, 50, 0), { x: 0, y: 0 });
  assert.deepEqual(parallaxOffset(100, 50, 1), { x: 100, y: 50 });
});

test('beatPulse：拍点=1、拍间衰减、确定性', () => {
  assert.equal(beatPulse(0, 120), 1);
  assert.equal(beatPulse(0.5, 120), 1); // 120bpm → 每 0.5s 一拍
  assert.ok(beatPulse(0.25, 120) < 0.3);
  assert.equal(beatPulse(0.7, 120), beatPulse(0.7, 120));
});

test('spectrum：bin 数 / 值域 / 低频更强 / 确定性 / 随 t 变化', () => {
  const bins = spectrumBins(0.8, { seed: 2, n: 32 });
  assert.equal(bins.length, 32);
  assert.ok(bins.every((v) => v >= 0 && v <= 1));
  assert.deepEqual(bins, spectrumBins(0.8, { seed: 2, n: 32 }));
  assert.notDeepEqual(bins, spectrumBins(1.3, { seed: 2, n: 32 }));
  // 低频（前 1/4）平均能量高于高频（后 1/4）
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(avg(bins.slice(0, 8)) > avg(bins.slice(24)), 'low freq stronger');
});

test('vignette：中心=1、边缘<1、强度单调', () => {
  assert.equal(vignetteFactor(0, 0, 0.6), 1);
  assert.ok(vignetteFactor(1, 1, 0.6) < vignetteFactor(0.5, 0.5, 0.6));
  assert.ok(vignetteFactor(1, 1, 0.9) < vignetteFactor(1, 1, 0.3));
  assert.ok(vignetteFactor(1, 1, 0) === 1);
});

test('halftone：暗处网点大、亮处小', () => {
  assert.ok(halftoneRadius(0, 10) > halftoneRadius(0.5, 10));
  assert.ok(halftoneRadius(0.5, 10) > halftoneRadius(1, 10));
  assert.equal(halftoneRadius(1, 10), 0);
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);