#!/usr/bin/env node
/**
 * ingest/test-edl.mjs — 素材摄取/EDL 的合成数据单测（不依赖真实媒体、不联网）。
 *
 *   node ingest/test-edl.mjs
 *
 * 覆盖：
 *   - scoreShots：分数在 [0,1]、开头 3s 位置加权、语音加成、不修改入参；
 *   - buildEDL：min/max 约束、同源不重叠、按时间排序、target ±10%、确定性、
 *     素材不足时如实标记 withinTolerance=false；
 *   - edlToScript：script 从 0 连续覆盖到 total，scene 时长 == clip 时长，
 *     normalizeSpec + validateSpec 零 error，页面路径存在；
 *   - scene/silence 解析器（用真实 ffmpeg 输出片段做夹具）；
 *   - ASR：没有引擎时必须返回 available:false（绝不假装成功）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildEDL, scoreShots, edlToScript } from './edl.mjs';
import { parseSceneOutput, parseSilenceOutput } from './scene.mjs';
import { detectEngines, transcribe } from './asr.mjs';
import { normalizeSpec, validateSpec, specDuration } from '../templates/spec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EPS = 1e-6;

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push({ name, error: e });
    console.log(`  FAIL ${name}`);
    console.log(`       ${String(e && e.message ? e.message : e).split('\n').join('\n       ')}`);
  }
}

const near = (a, b, eps = EPS) => Math.abs(Number(a) - Number(b)) <= eps;

// ── 合成素材 ────────────────────────────────────────────────────────────────

const SRC_A = 'fixtures/shots/a.mp4';
const SRC_B = 'fixtures/shots/b.mp4';

/** 连续 N 个 3s 镜头，覆盖 0..N*3 秒 */
function contiguousShots({ src = SRC_A, count = 40, dur = 3, start = 0, motion = null } = {}) {
  return Array.from({ length: count }, (_, i) => {
    const s = start + i * dur;
    return {
      src,
      start: s,
      end: s + dur,
      // 用确定性的伪随机运动分数，避免测试依赖随机数
      motion: motion == null ? ((i * 37) % 100) / 100 : motion,
    };
  });
}

function assertNoOverlap(clips) {
  const bySrc = new Map();
  for (const c of clips) {
    if (!bySrc.has(c.src)) bySrc.set(c.src, []);
    bySrc.get(c.src).push(c);
  }
  for (const [src, list] of bySrc) {
    const sorted = [...list].sort((a, b) => a.in - b.in);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(
        sorted[i].in >= sorted[i - 1].out - EPS,
        `${src}: clip ${i} in=${sorted[i].in} overlaps previous out=${sorted[i - 1].out}`,
      );
    }
  }
}

function assertClipBounds(clips, { minShot, maxShot }) {
  for (const c of clips) {
    assert.ok(c.dur >= minShot - EPS, `clip dur ${c.dur} < minShot ${minShot} (${JSON.stringify(c)})`);
    assert.ok(c.dur <= maxShot + EPS, `clip dur ${c.dur} > maxShot ${maxShot} (${JSON.stringify(c)})`);
    assert.ok(near(c.out - c.in, c.dur), `out-in (${c.out - c.in}) != dur (${c.dur})`);
  }
}

// ── scoreShots ──────────────────────────────────────────────────────────────

test('scoreShots: 分数在 [0,1]，附带 parts，且不修改入参', () => {
  const shots = contiguousShots({ count: 8 });
  const frozen = JSON.parse(JSON.stringify(shots));
  const scored = scoreShots(shots, { speech: [{ start: 3, end: 6 }] });
  assert.equal(scored.length, shots.length);
  for (const s of scored) {
    assert.ok(Number.isFinite(s.score), `score not finite: ${JSON.stringify(s)}`);
    assert.ok(s.score >= 0 && s.score <= 1, `score out of range: ${s.score}`);
    assert.ok(s.parts && typeof s.parts === 'object', 'parts missing');
  }
  assert.deepEqual(shots, frozen, 'scoreShots must not mutate its input');
});

test('scoreShots: 开头 3 秒的位置权重高于 60s 处（其余条件相同）', () => {
  const mk = (start) => scoreShots([{ src: SRC_A, start, end: start + 3, motion: 0.5 }])[0].score;
  const head = mk(0.5);
  const late = mk(60);
  assert.ok(head > late, `expected head (${head}) > late (${late})`);
});

test('scoreShots: 有语音的镜头分数更高', () => {
  const noSpeech = scoreShots([{ src: SRC_A, start: 40, end: 43, motion: 0.5 }])[0].score;
  const withSpeech = scoreShots(
    [{ src: SRC_A, start: 40, end: 43, motion: 0.5 }],
    { speech: [{ start: 40, end: 43 }] },
  )[0].score;
  assert.ok(withSpeech > noSpeech, `expected speech (${withSpeech}) > no speech (${noSpeech})`);
});

// ── buildEDL ────────────────────────────────────────────────────────────────

test('buildEDL: 60s 目标命中 ±10%，min/max、无重叠、按时间排序', () => {
  const shots = contiguousShots({ count: 40 }); // 0..120s
  const edl = buildEDL({ shots, targetDuration: 60, minShot: 1.2, maxShot: 6 });
  assert.ok(edl.clips.length > 0, 'no clips selected');
  assertClipBounds(edl.clips, { minShot: 1.2, maxShot: 6 });
  assertNoOverlap(edl.clips);
  assert.ok(edl.total >= 60 * 0.9 && edl.total <= 60 * 1.1, `total ${edl.total} outside 60±10%`);
  assert.equal(edl.withinTolerance, true);
  assert.ok(near(edl.total, edl.clips.reduce((s, c) => s + c.dur, 0), 1e-6), 'total != sum(dur)');

  // 按时间排序（同源按 in 升序）
  for (let i = 1; i < edl.clips.length; i++) {
    const a = edl.clips[i - 1];
    const b = edl.clips[i];
    assert.ok(a.src < b.src || (a.src === b.src && a.in <= b.in), `clips not time-ordered at ${i}`);
  }
  // 片段必须落在素材范围内
  for (const c of edl.clips) {
    assert.ok(c.in >= 0 && c.out <= 120 + EPS, `clip outside source 0..120: ${JSON.stringify(c)}`);
    assert.ok(typeof c.reason === 'string' && c.reason.length > 0, 'reason missing');
    assert.ok(Number.isFinite(c.score), 'score missing');
    assert.deepEqual(Object.keys(c).sort(), ['dur', 'in', 'out', 'reason', 'score', 'src']);
  }
});

test('buildEDL: 同样的输入两次结果一致（确定性）', () => {
  const shots = contiguousShots({ count: 40 });
  const a = buildEDL({ shots, targetDuration: 60 });
  const b = buildEDL({ shots, targetDuration: 60 });
  assert.deepEqual(a, b);
});

test('buildEDL: 过短镜头被丢弃，过长镜头被裁到 maxShot', () => {
  const shots = [
    { src: SRC_A, start: 0, end: 0.4, motion: 0.9 }, // 太短，不可用
    { src: SRC_A, start: 2, end: 14, motion: 0.9 }, // 12s → 裁到 6s
    { src: SRC_A, start: 20, end: 21.5, motion: 0.1 },
  ];
  const edl = buildEDL({ shots, targetDuration: 6, minShot: 1.2, maxShot: 6 });
  assertClipBounds(edl.clips, { minShot: 1.2, maxShot: 6 });
  assertNoOverlap(edl.clips);
  for (const c of edl.clips) assert.ok(!(c.in < 0.4 && c.out <= 0.4), 'selected a too-short shot');
  assert.ok(edl.clips.some((c) => near(c.dur, 6)), `expected a 6s clip, got ${JSON.stringify(edl.clips)}`);
});

test('buildEDL: 多来源不互相重叠，且不同 src 各自计时', () => {
  const shots = [
    ...contiguousShots({ src: SRC_A, count: 10, start: 0 }),
    // B 的 5 个镜头运动分更高 → 先被选中；A 用剩余名额补足 target
    ...contiguousShots({ src: SRC_B, count: 5, start: 0, motion: 1 }),
  ];
  const edl = buildEDL({ shots, targetDuration: 30 });
  assertNoOverlap(edl.clips);
  assert.ok(edl.clips.some((c) => c.src === SRC_A) && edl.clips.some((c) => c.src === SRC_B), 'both sources should be used');
  // 不同 src 的 in/out 是各自的时间轴，允许相同
  const fromB = edl.clips.filter((c) => c.src === SRC_B);
  assert.ok(fromB.length > 0 && fromB.every((c) => c.in >= 0 && c.out <= 15 + EPS));
});

test('buildEDL: 语音区间让选段偏向有语音的镜头', () => {
  const shots = [
    { src: SRC_A, start: 30, end: 33, motion: 0.6 },
    { src: SRC_A, start: 40, end: 43, motion: 0.6 },
  ];
  const edl = buildEDL({ shots, targetDuration: 3, speech: [{ start: 40, end: 43 }] });
  assert.equal(edl.clips.length, 1);
  assert.ok(near(edl.clips[0].in, 40), `expected the speech shot at 40s, got in=${edl.clips[0].in}`);
});

test('buildEDL: 带 src 的语音区间按来源匹配（Windows 反斜杠路径也匹配）', () => {
  const shots = [
    { src: 'C:\\footage\\A.mp4', start: 0, end: 3, motion: 0.5 },
    { src: 'C:\\footage\\B.mp4', start: 0, end: 3, motion: 0.5 },
  ];
  // 只有 B 的 0..3 有语音；A 不能因此加分
  const edl = buildEDL({ shots, targetDuration: 3, speech: [{ src: 'C:\\footage\\B.mp4', start: 0, end: 3 }] });
  assert.equal(edl.clips.length, 1);
  assert.ok(/B\.mp4$/.test(edl.clips[0].src), `expected B, got ${edl.clips[0].src}`);
  assert.ok(!edl.clips[0].src.includes('\\'), 'clip src should be normalized to forward slashes');
});

test('buildEDL: 空素材返回空 EDL，不抛错', () => {
  const edl = buildEDL({ shots: [], targetDuration: 60 });
  assert.deepEqual(edl.clips, []);
  assert.equal(edl.total, 0);
  assert.equal(edl.withinTolerance, false);
});

test('buildEDL: 素材不足时如实标记，不伪造时长', () => {
  const shots = contiguousShots({ count: 3 }); // 只有 9s 可用
  const edl = buildEDL({ shots, targetDuration: 60 });
  assert.ok(edl.total <= 9 + EPS, `total ${edl.total} exceeds available material`);
  assert.equal(edl.withinTolerance, false);
  assert.ok(Array.isArray(edl.warnings) && edl.warnings.length > 0, 'expected an honest warning');
});

test('buildEDL: 非法参数给出清晰错误', () => {
  assert.throws(() => buildEDL({ shots: [], targetDuration: 0 }), /targetDuration/);
  assert.throws(() => buildEDL({ shots: [], targetDuration: 10, minShot: 5, maxShot: 2 }), /minShot/);
});

// ── edlToScript ─────────────────────────────────────────────────────────────

function assertContiguous(blocks, total) {
  assert.ok(blocks.length > 0, 'script is empty');
  assert.equal(blocks[0].t[0], 0, `first block must start at 0, got ${blocks[0].t[0]}`);
  for (let i = 1; i < blocks.length; i++) {
    assert.ok(
      near(blocks[i].t[0], blocks[i - 1].t[1]),
      `gap/overlap between block ${i - 1} (end ${blocks[i - 1].t[1]}) and ${i} (start ${blocks[i].t[0]})`,
    );
  }
  assert.ok(near(blocks[blocks.length - 1].t[1], total), `last block ends at ${blocks[blocks.length - 1].t[1]}, total=${total}`);
}

test('edlToScript: script 连续覆盖 [0,total]，spec 通过 normalizeSpec + validateSpec', () => {
  const shots = contiguousShots({ count: 40 });
  const edl = buildEDL({ shots, targetDuration: 60 });
  const out = edlToScript(edl, {
    round: 4,
    cardCopy: (clip, i) => ({ first: `想做${i + 1}`, keyword: '这个效果？' }),
  });

  assertContiguous(out.script, out.total);
  assert.equal(out.script[0].role, 'opening');
  assert.equal(out.script[out.script.length - 1].role, 'ending');

  const cards = out.script.filter((b) => b.role === 'card');
  const scenes = out.script.filter((b) => b.role === 'scene');
  assert.equal(cards.length, edl.clips.length, 'one card per clip');
  assert.equal(scenes.length, edl.clips.length, 'one scene per clip');

  // 每个 scene 的时长 == 对应 clip 的时长
  scenes.forEach((b, i) => {
    assert.ok(near(b.t[1] - b.t[0], edl.clips[i].dur), `scene ${i} dur ${b.t[1] - b.t[0]} != clip ${edl.clips[i].dur}`);
    assert.ok(b.source && b.source.src === edl.clips[i].src, 'scene must carry its source');
    assert.ok(near(b.source.in, edl.clips[i].in) && near(b.source.out, edl.clips[i].out), 'scene source in/out mismatch');
  });

  // card 文案来自 cardCopy
  assert.deepEqual(cards[0].copy, ['想做1', '这个效果？']);

  const spec = normalizeSpec(out.spec);
  assert.equal(spec._authoredBy, 'script', 'spec must be script-authored');
  assert.equal(spec.rounds.length, edl.clips.length);
  assert.ok(near(specDuration(spec), out.total), `specDuration ${specDuration(spec)} != total ${out.total}`);

  const issues = validateSpec(spec);
  const errors = issues.filter((i) => i.level === 'error');
  assert.equal(errors.length, 0, `validateSpec errors: ${JSON.stringify(errors)}`);
  const warns = issues.filter((i) => i.level === 'warn');
  assert.equal(warns.length, 0, `unexpected warnings: ${JSON.stringify(warns)}`);
  assert.equal(spec.meta.orphanCards, 0);
});

test('edlToScript: 所有 block 的 page 都真实存在', () => {
  const shots = contiguousShots({ count: 6 });
  const edl = buildEDL({ shots, targetDuration: 18 });
  const out = edlToScript(edl, { round: 4, cardCopy: [['想做', '实录？']] });
  for (const b of out.script) {
    assert.ok(b.page, `block ${b.id} has no page`);
    assert.ok(fs.existsSync(path.join(ROOT, b.page.split('?')[0])), `page not found: ${b.page}`);
  }
  // 允许的 role 白名单（spec schema）
  const allowed = new Set(['opening', 'card', 'scene', 'more', 'flash', 'ending']);
  for (const b of out.script) assert.ok(allowed.has(b.role), `bad role ${b.role}`);
  // id 唯一
  const ids = out.script.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate block ids: ${ids}`);
});

test('edlToScript: 时长差异很大的 clip 也能得到合法 spec（round 统一、card 吸收余量）', () => {
  const shots = [
    { src: SRC_A, start: 0, end: 1.2, motion: 0.9 },
    { src: SRC_A, start: 10, end: 16, motion: 0.9 },
    { src: SRC_A, start: 30, end: 32.7, motion: 0.9 },
  ];
  const edl = buildEDL({ shots, targetDuration: 10, minShot: 1.2, maxShot: 6 });
  const out = edlToScript(edl, { round: 4, cardCopy: [['想做', '一'], ['想做', '二'], ['想做', '三']] });
  assertContiguous(out.script, out.total);
  const spec = normalizeSpec(out.spec);
  const errors = validateSpec(spec).filter((i) => i.level === 'error');
  assert.equal(errors.length, 0, JSON.stringify(errors));
  const scenes = out.script.filter((b) => b.role === 'scene');
  for (const b of scenes) {
    const dur = b.t[1] - b.t[0];
    assert.ok(dur >= 1.2 - EPS, `scene shorter than minShot: ${dur}`);
  }
  // 每一轮（card+scene）等长
  const lens = [];
  for (let i = 1; i + 1 < out.script.length; i += 2) {
    if (out.script[i].role !== 'card' || out.script[i + 1].role !== 'scene') break;
    lens.push(
      Number((out.script[i].t[1] - out.script[i].t[0]).toFixed(6)) +
      Number((out.script[i + 1].t[1] - out.script[i + 1].t[0]).toFixed(6)),
    );
  }
  assert.equal(lens.length, edl.clips.length, `expected ${edl.clips.length} rounds, walked ${lens.length}`);
  const first = lens[0];
  for (const l of lens) assert.ok(near(l, first, 1e-6), `round lengths differ: ${JSON.stringify(lens)}`);
});

test('edlToScript: 空 EDL 抛错（不允许静默产出空片）', () => {
  assert.throws(() => edlToScript({ clips: [], total: 0 }), /clips/);
});

test('edlToScript: 超过 24 轮时裁到上限、发出警告，spec 仍合法', () => {
  const edl = buildEDL({ shots: contiguousShots({ count: 40 }), targetDuration: 90 });
  assert.ok(edl.clips.length > 24, `expected > 24 clips, got ${edl.clips.length}`);
  const out = edlToScript(edl, { round: 4 });
  const spec = normalizeSpec(out.spec);
  assert.equal(spec.rounds.length, 24);
  assert.ok(out.warnings.some((w) => /24 rounds/.test(w)), `missing cap warning: ${JSON.stringify(out.warnings)}`);
  assert.equal(out.spec['x-edl'].omitted, edl.clips.length - 24);
  assert.equal(validateSpec(spec).filter((i) => i.level === 'error').length, 0);
});

// ── ffmpeg 输出解析器（真实输出片段做夹具，不跑媒体） ────────────────────────

const SCENE_SAMPLE = `
Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'cuts.mp4':
[Parsed_metadata_1 @ 00000271ad71d7c0] frame:0    pts:15360   pts_time:1
[Parsed_metadata_1 @ 00000271ad71d7c0] lavfi.scene_score=0.400000
[Parsed_metadata_1 @ 00000271ad71d7c0] frame:1    pts:30720   pts_time:2
[Parsed_metadata_1 @ 00000271ad71d7c0] lavfi.scene_score=0.400000
[Parsed_metadata_1 @ 00000271ad71d7c0] frame:2    pts:49152   pts_time:3.2
[Parsed_metadata_1 @ 00000271ad71d7c0] lavfi.scene_score=1.000000
`;

test('parseSceneOutput: 解析 pts_time + scene_score', () => {
  const cuts = parseSceneOutput(SCENE_SAMPLE);
  assert.equal(cuts.length, 3);
  assert.deepEqual(cuts[0], { t: 1, score: 0.4 });
  assert.deepEqual(cuts[2], { t: 3.2, score: 1 });
});

test('parseSceneOutput: 只有 showinfo（无 score）时仍给出切点', () => {
  const cuts = parseSceneOutput('[showinfo] n: 0 pts: 15360 pts_time:1.5 duration: 512 s:320x180\n');
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0].t, 1.5);
  assert.equal(cuts[0].score, 0);
});

const SILENCE_SAMPLE = `
  Duration: 00:00:03.20, start: 0.000000, bitrate: 129 kb/s
[silencedetect @ 000001cadc704d40] silence_start: 0.999955
[silencedetect @ 000001cadc704d40] silence_end: 2.000045 | silence_duration: 1.000091
[silencedetect @ 000001cadc704d40] silence_start: 3.5
`;

test('parseSilenceOutput: 解析 silence_start/end，尾段保留 end=null', () => {
  const sil = parseSilenceOutput(SILENCE_SAMPLE);
  assert.equal(sil.length, 2);
  assert.ok(near(sil[0].start, 1) && near(sil[0].end, 2));
  assert.ok(near(sil[0].dur, 1, 1e-3));
  assert.equal(sil[1].start, 3.5);
  assert.equal(sil[1].end, null);
});

test('parseSilenceOutput: 空输出返回 []', () => {
  assert.deepEqual(parseSilenceOutput(''), []);
});

// ── ASR：没有引擎必须如实报告 ───────────────────────────────────────────────

test('ASR: 无引擎时 available=false，transcribe 不假装成功', () => {
  const status = detectEngines();
  if (status.available) {
    assert.ok(status.engine && status.engine.path, 'engine reported without path');
    assert.ok(fs.existsSync(status.engine.path), `engine path does not exist: ${status.engine.path}`);
  } else {
    assert.equal(status.available, false);
    assert.equal(typeof status.reason, 'string');
    assert.ok(status.reason.length > 0);
    const r = transcribe(path.join(ROOT, 'ingest', 'cli.mjs'), { model: 'small', lang: 'zh' });
    assert.equal(r.available, false);
    assert.equal(typeof r.reason, 'string');
  }
});

// ── 汇总 ────────────────────────────────────────────────────────────────────

if (failures.length) {
  console.error(`\n✗ edl — ${failures.length} failed, ${passed} passed`);
  for (const f of failures) {
    console.error(`\n[${f.name}]`);
    console.error(String(f.error && f.error.stack ? f.error.stack : f.error));
  }
  process.exit(1);
}

console.log(`\n✓ edl — ${passed} tests passed`);
