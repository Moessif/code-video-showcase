#!/usr/bin/env node
/**
 * test-spec-security.mjs — spec.json 作为「不可信输入」的安全闸门回归（v2.3.1，纯 Node）。
 *
 * 背景：spec.json 可能来自用户、表单或 `POST /jobs` 的 body。它直接决定
 *   - `rounds[].id` → 段文件名 + ffmpeg concat 清单的一行；
 *   - `*.page`     → 渲染器 navigate 的 URL；
 *   - `structure`  → 段数与帧数。
 * 所以 templates/spec.mjs 同时是安全边界。本测试锁住这些闸门，防止回归：
 *   1. round.id 白名单：挡路径逃逸、换行/引号、点开头、超长；
 *   2. 合法 id 仍放行（别把闸门做成"一律拒绝"）；
 *   3. *.page 绝对 URL → E_PAGE_REMOTE，除非 render.allowRemotePages=true；
 *   4. *.page 绝对文件路径（POSIX / 盘符 / UNC）→ E_PAGE_ABS；
 *   5. 资源上限：E_FLASH_MAX / E_STRUCTURE_MAX / E_DURATION_MAX；
 *   6. 正常 spec 无 error（闸门不误伤）；
 *   7. scrubMessage() 抹掉绝对路径（server/api.mjs 用它处理错误信息）。
 *
 * 退出码 0/1。零依赖。
 */
import assert from 'node:assert/strict';
import { normalizeSpec, validateSpec, MAX_FLASH_COUNT } from '../templates/spec.mjs';
import { scrubMessage } from '../server/api.mjs';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
}

/** 最小合法 spec；用 mutate 改单一字段。 */
function spec(mutate = () => {}) {
  const s = {
    specVersion: 1,
    meta: { name: 'sec-test', brand: 'TEST', cta: '', locale: 'zh-CN' },
    format: { width: 1920, height: 1080, fps: 30, aspect: '16:9', duration: 4 },
    look: { mode: 'showcase', style: null, theme: 'coral-noir', accentOverride: null },
    audio: { mood: 'electronic', bpm: 120, vo: null },
    structure: { opening: 1, round: 1, card: 0.4, ending: 1, moreCard: 1, flash: { count: 0, each: 0.25 } },
    opening: { page: 'templates/segment.html', name: 'opening' },
    rounds: [{
      id: 'r01',
      name: 'sec-round',
      card: { layout: 0, first: '测试', keyword: '安全？', page: 'templates/big-card.html' },
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

const codes = (s) => validateSpec(normalizeSpec(s)).map((i) => i.code);
const has = (s, code) => codes(s).includes(code);

// ── 基线 ────────────────────────────────────────────────────────────────────

test('基线：正常 spec 没有 error', () => {
  const issues = validateSpec(normalizeSpec(spec()));
  const errs = issues.filter((i) => i.level === 'error');
  assert.equal(errs.length, 0, JSON.stringify(errs));
});

test('基线：合法 id 形态全部放行', () => {
  for (const id of ['r01', 'A', 'a-b_c-9', 'x'.repeat(64)]) {
    const s = spec((v) => { v.rounds[0].id = id; });
    assert.ok(!has(s, 'E_ROUND_ID'), `safe id "${id}" was rejected`);
  }
});

// ── 1/2) round.id 闸门 ──────────────────────────────────────────────────────

test('id 路径逃逸（../../etc/passwd）被拒', () => {
  assert.ok(has(spec((v) => { v.rounds[0].id = '../../etc/passwd'; }), 'E_ROUND_ID'));
});

test('id 路径逃逸（反斜杠）被拒', () => {
  assert.ok(has(spec((v) => { v.rounds[0].id = '..\\..\\windows\\system32'; }), 'E_ROUND_ID'));
});

test('id 换行注入 concat 清单被拒', () => {
  assert.ok(has(spec((v) => { v.rounds[0].id = 'ok\nfile other.mp4'; }), 'E_ROUND_ID'));
});

test('id 带引号/空格被拒', () => {
  assert.ok(has(spec((v) => { v.rounds[0].id = "a'b"; }), 'E_ROUND_ID'));
  assert.ok(has(spec((v) => { v.rounds[0].id = 'a b'; }), 'E_ROUND_ID'));
});

test('id 以点开头被拒（隐藏文件）', () => {
  assert.ok(has(spec((v) => { v.rounds[0].id = '.hidden'; }), 'E_ROUND_ID'));
});

test('id 以 - 或 _ 开头被拒', () => {
  assert.ok(has(spec((v) => { v.rounds[0].id = '-x'; }), 'E_ROUND_ID'));
  assert.ok(has(spec((v) => { v.rounds[0].id = '_x'; }), 'E_ROUND_ID'));
});

test('id 超过 64 字符被拒，恰好 64 放行', () => {
  assert.ok(has(spec((v) => { v.rounds[0].id = 'x'.repeat(65); }), 'E_ROUND_ID'));
  assert.ok(!has(spec((v) => { v.rounds[0].id = 'x'.repeat(64); }), 'E_ROUND_ID'));
});

test('id 重复仍被拒（原有行为不丢）', () => {
  const s = spec((v) => { v.rounds.push({ ...v.rounds[0] }); });
  assert.ok(has(s, 'E_ROUND_ID'));
});

// ── 3) 远程页面（SSRF） ─────────────────────────────────────────────────────

test('绝对 URL 页面默认被拒（E_PAGE_REMOTE）', () => {
  for (const p of ['http://169.254.169.254/latest/meta-data/', 'https://evil.example/x.html']) {
    assert.ok(has(spec((v) => { v.rounds[0].style.page = p; }), 'E_PAGE_REMOTE'), p);
  }
});

test('allowRemotePages=true 才放行远程页面', () => {
  const s = spec((v) => {
    v.rounds[0].style.page = 'http://127.0.0.1:8080/local.html';
    v.render.allowRemotePages = true;
  });
  assert.ok(!has(s, 'E_PAGE_REMOTE'));
});

test('远程 URL 检查覆盖 opening/ending/card/moreCard/flash', () => {
  const spots = ['opening', 'moreCard', 'flash', 'ending'];
  for (const k of spots) {
    assert.ok(has(spec((v) => { v[k].page = 'http://10.0.0.1/x.html'; }), 'E_PAGE_REMOTE'), k);
  }
  assert.ok(has(spec((v) => { v.rounds[0].card.page = 'http://10.0.0.1/x.html'; }), 'E_PAGE_REMOTE'));
});

// ── 4) 绝对文件路径 ─────────────────────────────────────────────────────────

test('POSIX 绝对路径被拒（E_PAGE_ABS）', () => {
  assert.ok(has(spec((v) => { v.rounds[0].style.page = '/etc/passwd'; }), 'E_PAGE_ABS'));
});

test('Windows 盘符绝对路径被拒（两种分隔符）', () => {
  assert.ok(has(spec((v) => { v.rounds[0].style.page = 'C:\\Windows\\win.ini'; }), 'E_PAGE_ABS'));
  assert.ok(has(spec((v) => { v.rounds[0].style.page = 'C:/Windows/win.ini'; }), 'E_PAGE_ABS'));
});

test('UNC 路径被拒', () => {
  assert.ok(has(spec((v) => { v.rounds[0].style.page = '\\\\fileserver\\share\\a.html'; }), 'E_PAGE_ABS'));
});

test('绝对路径检查忽略 ?query/#hash 后缀', () => {
  assert.ok(has(spec((v) => { v.rounds[0].style.page = 'C:/x.html?v=1#frag'; }), 'E_PAGE_ABS'));
});

test('相对路径与 query 正常放行', () => {
  for (const p of ['templates/segment.html', 'templates/segment.html?theme=x&mp=standard', './a/b.html']) {
    assert.ok(!has(spec((v) => { v.rounds[0].style.page = p; }), 'E_PAGE_ABS'), p);
    assert.ok(!has(spec((v) => { v.rounds[0].style.page = p; }), 'E_PAGE_REMOTE'), p);
  }
});

// ── 5) 资源上限 ─────────────────────────────────────────────────────────────

test('flash.count 超过上限被拒（E_FLASH_MAX）', () => {
  assert.ok(has(spec((v) => { v.structure.flash.count = MAX_FLASH_COUNT + 1; }), 'E_FLASH_MAX'));
  assert.ok(!has(spec((v) => { v.structure.flash.count = MAX_FLASH_COUNT; }), 'E_FLASH_MAX'));
});

test('单段结构长度超过上限被拒（E_STRUCTURE_MAX）', () => {
  assert.ok(has(spec((v) => { v.structure.round = 601; }), 'E_STRUCTURE_MAX'));
  assert.ok(has(spec((v) => { v.structure.opening = 1e9; }), 'E_STRUCTURE_MAX'));
});

test('总帧数超过上限被拒（E_DURATION_MAX）', () => {
  // 结构总长 700s @30fps = 21000 帧 > 18000
  const s = spec((v) => {
    v.structure = { opening: 100, round: 100, card: 0.4, ending: 90, moreCard: 10, flash: { count: 0, each: 0.25 } };
    v.rounds = Array.from({ length: 5 }, (_, i) => ({ ...v.rounds[0], id: `r0${i + 1}` }));
    v.format.duration = 700;
  });
  assert.ok(has(s, 'E_DURATION_MAX'));
});

test('恰好 10 分钟（600s @30fps = 18000 帧）的片不被误伤', () => {
  // opening 100 + 3×100 + moreCard 100 + ending 100 = 600s，每段都 ≤ 600s
  const ok = spec((v) => {
    v.structure = { opening: 100, round: 100, card: 0.4, ending: 100, moreCard: 100, flash: { count: 0, each: 0.25 } };
    v.rounds = Array.from({ length: 3 }, (_, i) => ({ ...v.rounds[0], id: `r0${i + 1}` }));
    v.format.duration = 600;
  });
  assert.ok(!has(ok, 'E_DURATION_MAX'), '600s @30fps must be allowed');
  assert.ok(!has(ok, 'E_STRUCTURE_MAX'), '100s per-segment must be allowed');
});

// ── 7) scrubMessage ────────────────────────────────────────────────────────

test('scrubMessage 抹掉 Windows / POSIX 绝对路径', () => {
  assert.equal(scrubMessage('open E:\\myzcode\\repos\\x\\plan.json failed'), 'open <path> failed');
  assert.equal(scrubMessage('cannot read /home/user/proj/plan.json'), 'cannot read <path>');
  assert.equal(scrubMessage('at /Users/chen/dev/a.mjs'), 'at <path>');
  assert.equal(scrubMessage('C:/proj/out/plan.json not found'), '<path> not found');
});

test('scrubMessage 保留有意义的相对文件名', () => {
  assert.equal(scrubMessage('plan.json: 0 frames'), 'plan.json: 0 frames');
  assert.equal(scrubMessage('segment r01-style.mp4 is empty'), 'segment r01-style.mp4 is empty');
});

test('scrubMessage 处理 null/undefined 不抛错', () => {
  assert.equal(scrubMessage(null), '');
  assert.equal(scrubMessage(undefined), '');
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
