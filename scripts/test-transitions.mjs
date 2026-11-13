#!/usr/bin/env node
/**
 * test-transitions.mjs — 段间转场（v2.5）的回归（纯 Node）。
 *
 * 覆盖：
 *   1. normalizeTransition：none/cut/false/缺省 → 关闭；非法名/时长 → 带码抛错；时长上限 2s；
 *   2. shiftSegments：每段渲染时长不变、起点按 i*tf 平移、总帧 = 原总帧-(N-1)*tf；
 *   3. 单一真值：xfadeOffsets[k] === 第 k+1 段平移后的 start；
 *   4. xfadeFilterGraph：节点数 = N-1、以 [vout] 收尾、offset 与 plan 一致；
 *   5. 默认关闭时 plan 逐字节不变（stats/segments/cues/hash 全等）；
 *   6. 开启后 plan.stats.duration/frames 与字幕 cue 一起平移，段哈希随之失效。
 *
 * 退出码 0/1。零依赖。
 */
import assert from 'node:assert/strict';
import {
  TRANSITIONS, TRANSITION_IDS, isTransition, normalizeTransition,
  shiftSegments, totalFrames, xfadeOffsets, xfadeFilterGraph,
} from '../templates/transitions.mjs';
import { buildPlanFromSpec } from '../templates/plan.mjs';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
}

const FPS = 30;
const segs = [
  { id: 'a', startFrame: 0, endFrame: 30, frames: 30 },
  { id: 'b', startFrame: 30, endFrame: 60, frames: 30 },
  { id: 'c', startFrame: 60, endFrame: 90, frames: 30 },
];

test('注册表非空且 token 与名字一致', () => {
  assert.ok(TRANSITION_IDS.length >= 20, `only ${TRANSITION_IDS.length} transitions`);
  for (const id of TRANSITION_IDS) assert.equal(TRANSITIONS[id].token, id);
  assert.ok(isTransition('fade') && !isTransition('nope'));
});

test('normalizeTransition：关闭形态返回 null', () => {
  for (const v of [undefined, null, '', false, 'none', 'cut']) assert.equal(normalizeTransition(v), null);
});

test('normalizeTransition：合法名 + 默认时长', () => {
  const t = normalizeTransition('fade');
  assert.equal(t.token, 'fade');
  assert.ok(t.duration > 0 && t.duration <= 2);
});

test('normalizeTransition：非法名/时长带码抛错', () => {
  assert.throws(() => normalizeTransition('bogus'), (e) => e.code === 'E_TRANSITION');
  assert.throws(() => normalizeTransition('fade', 0), (e) => e.code === 'E_TRANSITION_DURATION');
  assert.throws(() => normalizeTransition('fade', -1), (e) => e.code === 'E_TRANSITION_DURATION');
  assert.throws(() => normalizeTransition('fade', 'x'), (e) => e.code === 'E_TRANSITION_DURATION');
});

test('normalizeTransition：时长上限 2s', () => {
  assert.equal(normalizeTransition('fade', 9).duration, 2);
});

test('shiftSegments：关闭时原样返回', () => {
  assert.deepEqual(shiftSegments(segs, FPS, null), segs);
});

test('shiftSegments：起点平移、渲染时长不变、总帧收缩', () => {
  const t = { duration: 0.4 };
  const tf = Math.round(0.4 * FPS); // 12
  const out = shiftSegments(segs, FPS, t);
  assert.equal(out[0].startFrame, 0);
  assert.equal(out[1].startFrame, 30 - tf);
  assert.equal(out[2].startFrame, 60 - 2 * tf);
  for (let i = 0; i < segs.length; i++) assert.equal(out[i].frames, segs[i].frames);
  // totalFrames 接收**未平移**的段（内部自己平移）；传已平移的会二次平移。
  assert.equal(totalFrames(segs, FPS, t), 90 - 2 * tf);
  assert.equal(totalFrames(segs, FPS, null), 90);
  assert.equal(out[out.length - 1].endFrame, 90 - 2 * tf);
});

test('单一真值：xfadeOffsets(已平移段)[k] === 第 k+1 段 start', () => {
  const t = { duration: 0.4 };
  const shifted = shiftSegments(segs, FPS, t);
  // xfade* 接收已平移段（plan.segments），不再内部平移。
  const off = xfadeOffsets(shifted, FPS, t);
  assert.equal(off.length, segs.length - 1);
  for (let k = 0; k < off.length; k++) assert.equal(off[k], Number(shifted[k + 1].start.toFixed(6)));
  // 回归：offset 必须严格递增且非负（二次平移会产生 0/负值，xfade 链塌缩）。
  for (let k = 0; k < off.length; k++) {
    assert.ok(off[k] >= 0, `offset[${k}]=${off[k]} must be >= 0`);
    if (k > 0) assert.ok(off[k] > off[k - 1], 'offsets must strictly increase');
  }
});

test('xfadeFilterGraph：N-1 个节点、[vout] 收尾、含 offset', () => {
  const t = { duration: 0.4, token: 'fade' };
  const shifted = shiftSegments(segs, FPS, t);
  assert.equal(xfadeFilterGraph(segs, FPS, null), null);
  assert.equal(xfadeFilterGraph(shifted.slice(0, 1), FPS, t), null);
  const g = xfadeFilterGraph(shifted, FPS, t);
  assert.equal((g.match(/xfade=/g) || []).length, 2);
  assert.ok(g.endsWith('[vout]'));
  assert.ok(g.includes('transition=fade'));
  assert.ok(g.includes(`offset=${xfadeOffsets(shifted, FPS, t)[0]}`));
});

// ── plan 集成 ───────────────────────────────────────────────────────────────
function spec(render = {}) {
  return {
    specVersion: 1,
    meta: { name: 'tr-test', brand: 'TEST', cta: '', locale: 'zh-CN' },
    format: { width: 1920, height: 1080, fps: FPS, aspect: '16:9', duration: 3.3 },
    look: { mode: 'showcase', style: null, theme: 'coral-noir', accentOverride: null },
    audio: { mood: 'electronic', bpm: 120, vo: null },
    structure: { opening: 0.6, round: 1.6, card: 0.5, ending: 0.6, moreCard: 0.5, flash: { count: 0, each: 0.25 } },
    opening: { page: 'templates/segment.html', name: 'o' },
    rounds: [{ id: 'r01', name: 'r', card: { layout: 0, first: '测', keyword: '试？', page: 'templates/big-card.html' }, style: { page: 'templates/segment.html', t0: 0.3, speed: 1.3 } }],
    moreCard: { page: 'templates/big-card.html', first: '还', keyword: '有？' },
    flash: { page: 'templates/segment.html' },
    ending: { page: 'templates/segment.html', name: 'e' },
    assets: [], patches: [],
    render: { quality: 'master', preset: 'master', concurrency: 1, outDir: 'out', ...render },
  };
}

test('默认关闭：plan 与不写 transition 逐字节一致', () => {
  const a = buildPlanFromSpec(spec(), { root: process.cwd(), checkPages: false }).plan;
  const b = buildPlanFromSpec(spec({ transition: 'none' }), { root: process.cwd(), checkPages: false }).plan;
  assert.equal(JSON.stringify(a.segments), JSON.stringify(b.segments));
  assert.equal(JSON.stringify(a.stats), JSON.stringify(b.stats));
  assert.equal(JSON.stringify(a.audio.cues), JSON.stringify(b.audio.cues));
});

test('开启转场：总帧 = 原总帧-(N-1)*tf，字幕 cue 平移，段哈希失效', () => {
  const base = buildPlanFromSpec(spec(), { root: process.cwd(), checkPages: false }).plan;
  const tr = buildPlanFromSpec(spec({ transition: 'fade', transitionDuration: 0.4 }), { root: process.cwd(), checkPages: false }).plan;
  const tf = Math.round(0.4 * FPS);
  const n = base.segments.length;
  assert.equal(tr.stats.frames, base.stats.frames - (n - 1) * tf);
  assert.ok(Math.abs(tr.stats.duration - (base.stats.duration - (n - 1) * 0.4)) < 1 / FPS + 1e-9);
  // 每段渲染时长不变
  for (let i = 0; i < n; i++) assert.equal(tr.segments[i].frames, base.segments[i].frames);
  // 起点平移
  for (let i = 0; i < n; i++) assert.equal(tr.segments[i].startFrame, base.segments[i].startFrame - i * tf);
  // 字幕 cue 跟随平移
  assert.equal(tr.audio.cues[0].frame, base.audio.cues[0].frame);
  const lastBase = base.audio.cues[base.audio.cues.length - 1];
  const lastTr = tr.audio.cues[tr.audio.cues.length - 1];
  assert.ok(lastTr.frame < lastBase.frame, 'later cues must shift earlier');
  // 段哈希必须变（缓存失效）
  assert.notEqual(tr.segments[1].hash, base.segments[1].hash);
  // meta.transition 下发
  assert.equal(tr.meta.transition.token, 'fade');
});

test('回归：compile 路径 xfadeOffsets(plan.segments) 不得二次平移', () => {
  // compile.mjs 直接把 plan.segments（已平移）喂给 xfadeOffsets。
  // 旧实现内部又 shiftSegments 一次 → 负 offset → 成片塌缩成最后一段（18f 而非 66f）。
  const tr = buildPlanFromSpec(spec({ transition: 'fade', transitionDuration: 0.3 }), { root: process.cwd(), checkPages: false }).plan;
  const off = xfadeOffsets(tr.segments, tr.stats.fps, tr.meta.transition);
  assert.equal(off.length, tr.segments.length - 1);
  // 与「段起点平移」单一真值逐位一致
  for (let k = 0; k < off.length; k++) assert.equal(off[k], Number(tr.segments[k + 1].start.toFixed(6)));
  // 必须严格递增、非负、且首个 offset == 一个转场时长（第一段时长 - tf 后的第二段起点）
  for (let k = 0; k < off.length; k++) {
    assert.ok(off[k] >= 0, `offset[${k}]=${off[k]} >= 0`);
    if (k > 0) assert.ok(off[k] > off[k - 1], 'strictly increasing');
  }
  // 滤镜链节点数 = N-1，且不含负 offset
  const g = xfadeFilterGraph(tr.segments, tr.stats.fps, tr.meta.transition);
  assert.equal((g.match(/xfade=/g) || []).length, tr.segments.length - 1);
  assert.ok(!/offset=-/.test(g), 'no negative offsets in graph');
});

test('非法转场在 validateSpec 报 E_TRANSITION（不静默硬切）', () => {
  assert.throws(() => buildPlanFromSpec(spec({ transition: 'bogus' }), { root: process.cwd(), checkPages: false }), /E_TRANSITION/);
  assert.throws(() => buildPlanFromSpec(spec({ transition: 'fade', transitionDuration: 5 }), { root: process.cwd(), checkPages: false }), /E_TRANSITION_DURATION/);
});

test('转场长于最短段 → plan 阶段报 E_TRANSITION_DURATION（xfade 约束）', () => {
  // 测试 spec 最短段 = 0.5s（15f）。0.6s（18f）>= 15f → 该段会被重叠吃光，必须挡住。
  assert.throws(
    () => buildPlanFromSpec(spec({ transition: 'fade', transitionDuration: 0.6 }), { root: process.cwd(), checkPages: false }),
    /E_TRANSITION_DURATION/,
  );
  // 0.4s（12f）< 15f → 合法。
  assert.doesNotThrow(() => buildPlanFromSpec(spec({ transition: 'fade', transitionDuration: 0.4 }), { root: process.cwd(), checkPages: false }));
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);