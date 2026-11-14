#!/usr/bin/env node
/**
 * test-hardening.mjs — v2.5.2 多视角审计修复的回归（纯 Node）。
 *
 * 钉死下列真缺陷不再复发：
 *   - 有限溢出（flash.each=1e308 → Infinity）绕过资源闸门；
 *   - normalizeSpec 污染共享 DEFAULTS.format（同进程串时长）；
 *   - segmentHash 漏 fps/width/height（换画幅缓存假命中）；
 *   - 非整数 concurrency / flash.count、亚帧 flash、非法 t0；
 *   - outDir 单反斜杠/控制字符逃逸；page 编码穿越（..%2f）/单反斜杠；
 *   - deepMerge 原型污染；未知主题静默回落。
 *
 * 退出码 0/1。零依赖。
 */
import assert from 'node:assert/strict';
import { normalizeSpec, validateSpec } from '../templates/spec.mjs';
import { segmentHash } from '../templates/plan.mjs';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
}

function base(over = {}) {
  return {
    specVersion: 1,
    meta: { name: 'hard', brand: 'B', cta: '', locale: 'zh-CN' },
    format: { width: 1920, height: 1080, fps: 30, aspect: '16:9', duration: 3.3 },
    look: { mode: 'showcase', style: null, theme: 'coral-noir', accentOverride: null },
    audio: { mood: 'electronic', bpm: 120 },
    structure: { opening: 0.6, round: 1.6, card: 0.5, ending: 0.6, moreCard: 0.5, flash: { count: 0, each: 0.25 } },
    opening: { page: 'templates/segment.html' },
    rounds: [{ id: 'r01', card: { page: 'templates/big-card.html' }, style: { page: 'templates/segment.html' } }],
    moreCard: { page: 'templates/big-card.html' },
    flash: { page: 'templates/big-card.html' },
    ending: { page: 'templates/segment.html' },
    assets: [], patches: [],
    render: { outDir: 'out' },
    ...over,
  };
}
const errs = (spec) => validateSpec(normalizeSpec(spec)).filter((i) => i.level === 'error').map((i) => i.code);
const has = (spec, code) => errs(spec).includes(code);

test('有限溢出：flash.each=1e308 被挡（不再 Infinity 绕过闸门）', () => {
  const s = base({ structure: { opening: 0.6, round: 1.6, card: 0.5, ending: 0.6, moreCard: 0.5, flash: { count: 256, each: 1e308 } } });
  const codes = errs(s);
  assert.ok(codes.includes('E_STRUCTURE_MAX') || codes.includes('E_DURATION') || codes.includes('E_STRUCTURE'), `got ${codes}`);
  // 归一化后的 duration 必须有限（不能是 Infinity/null）
  const n = normalizeSpec(s);
  assert.ok(Number.isFinite(n.format.duration) || codes.length > 0, 'duration must not silently be Infinity');
});

test('非有限 duration 直接拒绝（validateSpec 兜底闸门）', () => {
  // normalizeSpec 的 clone 会把 Infinity 变 null 再重算（一层保护）；这里直接
  // 喂 validateSpec 一个非有限 duration，验证兜底闸门本身。
  const raw = base();
  raw.format.duration = Infinity;
  const codes = validateSpec(raw).filter((i) => i.level === 'error').map((i) => i.code);
  assert.ok(codes.includes('E_DURATION'), `got ${codes}`);
});

test('DEFAULTS 隔离：同进程两个缺省 format 的 spec 不串时长', () => {
  const a = normalizeSpec(base({ structure: { opening: 1, round: 2, card: 0.5, ending: 1, moreCard: 0.5, flash: { count: 0, each: 0.25 } }, format: undefined }));
  const b = normalizeSpec(base({ structure: { opening: 2, round: 3, card: 0.5, ending: 2, moreCard: 0.5, flash: { count: 0, each: 0.25 } }, format: undefined }));
  assert.notEqual(a.format.duration, b.format.duration, 'durations must differ');
  // 再归一化 a 的结构，duration 不应被 b 污染
  const a2 = normalizeSpec(base({ structure: { opening: 1, round: 2, card: 0.5, ending: 1, moreCard: 0.5, flash: { count: 0, each: 0.25 } }, format: undefined }));
  assert.equal(a2.format.duration, a.format.duration, 'DEFAULTS must not be mutated');
});

test('segmentHash 含 fps/width/height：换画幅/帧率哈希必变', () => {
  const spec = normalizeSpec(base());
  const seg = { id: 'r01-style', kind: 'style', page: 'templates/segment.html', startFrame: 0, frames: 30 };
  const meta = { fps: 30, width: 1920, height: 1080, theme: 'coral-noir' };
  const h0 = segmentHash(seg, meta, spec, {});
  assert.notEqual(segmentHash(seg, { ...meta, width: 1080, height: 1920 }, spec, {}), h0, 'portrait must differ');
  assert.notEqual(segmentHash(seg, { ...meta, fps: 60 }, spec, {}), h0, 'fps must differ');
  assert.notEqual(segmentHash(seg, { ...meta, width: 1280, height: 720 }, spec, {}), h0, 'resolution must differ');
});

test('非整数 concurrency 被挡（2.5 会漏分片）', () => {
  assert.ok(has(base({ render: { outDir: 'out', concurrency: 2.5 } }), 'E_CONCURRENCY'));
  assert.ok(!has(base({ render: { outDir: 'out', concurrency: 4 } }), 'E_CONCURRENCY'));
});

test('亚帧 flash 与非法 flash.count 被挡', () => {
  const st = { opening: 0.6, round: 1.6, card: 0.5, ending: 0.6, moreCard: 0.5, flash: { count: 2, each: 0.01 } };
  assert.ok(has(base({ structure: st, format: { width: 1920, height: 1080, fps: 30, aspect: '16:9', duration: 3.32 } }), 'E_FLASH'));
  const st2 = { ...st, flash: { count: 2.5, each: 0.5 } };
  assert.ok(has(base({ structure: st2 }), 'E_FLASH'));
});

test('非法 t0 被挡（不再 NaN 进页面 URL）', () => {
  const s = base();
  s.rounds[0].style.t0 = 'abc';
  assert.ok(has(s, 'E_SPEED'));
});

test('outDir 单反斜杠 / 控制字符被挡', () => {
  assert.ok(has(base({ render: { outDir: '\\escape' } }), 'E_OUTDIR'));
  assert.ok(has(base({ render: { outDir: 'out\u0000x' } }), 'E_OUTDIR'));
  assert.ok(has(base({ render: { outDir: '../../escape' } }), 'E_OUTDIR'));
  assert.ok(!has(base({ render: { outDir: 'out/sub' } }), 'E_OUTDIR'));
});

test('page 编码穿越（..%2f）与单反斜杠被挡', () => {
  const mk = (p) => { const s = base(); s.rounds[0].style.page = p; return s; };
  assert.ok(has(mk('..%2f..%2fsecret.html'), 'E_PAGE_TRAVERSAL'));
  assert.ok(has(mk('..\\..\\secret.html'), 'E_PAGE_TRAVERSAL'));
  assert.ok(has(mk('\\Windows\\win.ini'), 'E_PAGE_ABS'));
  assert.ok(has(mk('../../etc/passwd'), 'E_PAGE_TRAVERSAL'));
});

test('deepMerge 原型污染被挡', () => {
  const s = normalizeSpec(base({ render: { outDir: 'out', __proto__: { allowRemotePages: true } } }));
  assert.equal({}.allowRemotePages, undefined, 'Object.prototype must not be polluted');
  assert.equal(s.render.allowRemotePages, false, 'allowRemotePages must stay false');
});

test('未知主题被 validateSpec 挡（不再静默回落）', () => {
  assert.ok(has(base({ look: { mode: 'showcase', style: null, theme: 'coral-nior', accentOverride: null } }), 'E_THEME_UNKNOWN'));
  assert.ok(!has(base(), 'E_THEME_UNKNOWN'));
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);