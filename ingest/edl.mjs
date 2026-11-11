#!/usr/bin/env node
/**
 * ingest/edl.mjs — 选段打分 / EDL 构建 / EDL→spec.script（本集群的核心，纯函数）。
 *
 *   const scored = scoreShots(shots, {speech});          // 0..1 分 + 分项
 *   const edl    = buildEDL({shots, targetDuration: 60}); // {clips:[{src,in,out,dur,score,reason}], total}
 *   const {spec} = edlToScript(edl, {round: 4});          // 可直接 normalizeSpec
 *
 * 约定：
 *   - 时间单位统一为秒（3 位小数，毫秒级）；
 *   - 同一 src 的 clips 互不重叠；
 *   - 素材不足时如实返回 withinTolerance=false + warnings，不虚报时长。
 *
 * spec v1 的结构约束（templates/spec.mjs 的 deriveFromScript/specDuration）：
 *   每一轮 = card + scene 等长，因此 edlToScript 用“card 吸收差额”的方式
 *   让每一轮等长：round = max(round, 最长 clip + minCard)，card_i = round - clip_dur_i。
 *   每个 scene 块的 t 仍然精确等于对应 clip 的时长；完整 cut 列表同时写进 spec['x-edl']。
 */
import { IngestError } from './probe.mjs';

const round3 = (x) => Math.round(Number(x) * 1000) / 1000;
const round4 = (x) => Math.round(Number(x) * 10000) / 10000;
const floor3 = (x) => Math.floor(Number(x) * 1000 + 1e-6) / 1000;
const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const VIDEO_EXT = /\.(mp4|mov|mkv|webm|m4v)$/i;

const pad2 = (n) => String(n).padStart(2, '0');

function basename(src) {
  return String(src || '').replace(/\\/g, '/').split('/').pop() || String(src || 'clip');
}

function aspectOf(w, h) {
  const r = Number(w) / Number(h);
  if (Math.abs(r - 16 / 9) < 0.01) return '16:9';
  if (Math.abs(r - 9 / 16) < 0.01) return '9:16';
  if (Math.abs(r - 1) < 0.01) return '1:1';
  return `${w}:${h}`;
}

/**
 * 语音/VAD 区间：支持 {start,end} / {t0,t1} / [start,end]。
 * 可带 src：多素材时只有同一 src 的区间参与该镜头打分。
 */
export function normalizeIntervals(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    let a;
    let b;
    if (Array.isArray(raw)) {
      [a, b] = raw.map(Number);
    } else if (raw && typeof raw === 'object') {
      a = Number(raw.start ?? raw.t0 ?? raw.in);
      b = Number(raw.end ?? raw.t1 ?? raw.out);
    }
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    const iv = { start: round3(a), end: round3(b) };
    if (raw && typeof raw === 'object' && raw.src) iv.src = String(raw.src).replace(/\\/g, '/');
    out.push(iv);
  }
  return out.sort((x, y) => x.start - y.start || x.end - y.end);
}

/** 过滤出适用于 src 的区间（无 src 的区间视为全局）。 */
export function intervalsFor(intervals, src) {
  return src === undefined ? intervals : intervals.filter((iv) => !iv.src || iv.src === src);
}

/** 区间 [a,b] 与若干区间的重叠总长。 */
export function overlapLen(a, b, intervals) {
  let sum = 0;
  for (const iv of intervals) {
    const lo = Math.max(a, iv.start);
    const hi = Math.min(b, iv.end);
    if (hi > lo) sum += hi - lo;
  }
  return sum;
}

/** [start,end] 被语音覆盖的比例 0..1（可按 src 过滤区间）。 */
export function coverage(start, end, intervals, src) {
  const len = end - start;
  if (!(len > 0)) return 0;
  return clamp01(overlapLen(start, end, intervalsFor(intervals, src)) / len);
}

function normalizeShot(raw, index) {
  if (!raw || typeof raw !== 'object') throw new IngestError(`shot[${index}] must be an object`, 'E_SHOT');
  const src = String(raw.src ?? raw.path ?? raw.file ?? `shot-${index}`).replace(/\\/g, '/');
  const start = Number(raw.start ?? raw.in ?? raw.t ?? 0);
  const end = Number(raw.end ?? raw.out ?? (Number.isFinite(Number(raw.dur)) ? start + Number(raw.dur) : NaN));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new IngestError(
      `shot[${index}] (${src}) has an invalid interval: start=${raw.start ?? raw.in} end=${raw.end ?? raw.out}`,
      'E_SHOT',
    );
  }
  return {
    src,
    start: round3(start),
    end: round3(end),
    dur: round3(end - start),
    motion: raw.motion ?? raw.scene ?? (raw.score !== undefined ? Number(raw.score) : 0.5),
    speech: raw.speech,
    label: raw.label ?? null,
  };
}

/**
 * 给镜头打分（0..1）。
 * 分项：motion（清晰度/运动占位）、duration（是否接近理想镜头长）、
 *       speech（与语音区间重合比例）、position（开头 openingWindow 秒权重高）。
 *
 * @param {Array<{src:string,start:number,end:number,dur?:number,motion?:number,speech?:boolean}>} shots
 * @param {{speech?:Array, weights?:object, idealShot?:number, openingWindow?:number}} opts
 */
export function scoreShots(shots, opts = {}) {
  const list = Array.isArray(shots) ? shots : [];
  const speech = normalizeIntervals(opts.speech || []);
  const weights = { motion: 0.4, duration: 0.25, speech: 0.2, position: 0.15, ...(opts.weights || {}) };
  const weightSum = ['motion', 'duration', 'speech', 'position'].reduce((s, k) => s + (Number(weights[k]) || 0), 0) || 1;
  const ideal = Number(opts.idealShot ?? 3) > 0 ? Number(opts.idealShot ?? 3) : 3;
  const window = Number(opts.openingWindow ?? 3) > 0 ? Number(opts.openingWindow ?? 3) : 3;

  return list.map((raw, i) => {
    const shot = normalizeShot(raw, i);
    const motionScore = clamp01(Number(shot.motion ?? 0.5));
    const durationScore = clamp01(1 - Math.min(1, Math.abs(shot.dur - ideal) / ideal));
    const speechScore = shot.speech === true
      ? 1
      : shot.speech === false
        ? 0
        : coverage(shot.start, shot.end, speech, shot.src);
    const positionScore = clamp01(Math.exp(-Math.max(0, shot.start) / window));

    const score =
      ((Number(weights.motion) || 0) * motionScore +
        (Number(weights.duration) || 0) * durationScore +
        (Number(weights.speech) || 0) * speechScore +
        (Number(weights.position) || 0) * positionScore) /
      weightSum;

    return {
      ...shot,
      score: round4(score),
      parts: {
        motion: round4(motionScore),
        duration: round4(durationScore),
        speech: round4(speechScore),
        position: round4(positionScore),
      },
    };
  });
}

/** 超长镜头取中间 window；否则整段可用。 */
function trimWindow(shot, maxShot) {
  if (shot.dur <= maxShot + 1e-9) return [shot.start, shot.end];
  const start = shot.start + (shot.dur - maxShot) / 2;
  return [round3(start), round3(start + maxShot)];
}

/** 在 [a,b] 内找不与 used 重叠的最长空档。 */
function largestFreeGap(a, b, used) {
  const sorted = [...(used || [])].sort((p, q) => p[0] - q[0]);
  let cursor = a;
  let best = null;
  for (const [s, e] of sorted) {
    if (e <= cursor) continue;
    if (s >= b) break;
    if (s > cursor) {
      const len = s - cursor;
      if (!best || len > best.len) best = { start: cursor, end: s, len };
    }
    cursor = Math.max(cursor, e);
  }
  if (cursor < b - 1e-9) {
    const len = b - cursor;
    if (!best || len > best.len) best = { start: cursor, end: b, len };
  }
  return best && best.len > 1e-9 ? best : null;
}

/** 在空档里挑 take 秒的起点：优先覆盖语音，其次居中。 */
function chooseWindow(gapStart, gapLen, take, speech) {
  const slack = Math.max(0, gapLen - take);
  if (slack <= 1e-9) return gapStart;

  const offsets = new Set([slack / 2, 0, slack]);
  for (const iv of speech) {
    offsets.add(Math.max(0, Math.min(slack, iv.start - gapStart)));
    offsets.add(Math.max(0, Math.min(slack, iv.end - gapStart - take)));
  }
  let bestOffset = slack / 2;
  let bestCover = -1;
  for (const off of [...offsets].sort((x, y) => x - y)) {
    const cover = overlapLen(gapStart + off, gapStart + off + take, speech);
    if (cover > bestCover + 1e-9) {
      bestCover = cover;
      bestOffset = off;
    }
  }
  return gapStart + bestOffset;
}

function reasonOf(shot, take, trimmed) {
  const p = shot.parts;
  const t = trimmed ? `, trimmed to ${round3(take)}s` : '';
  return (
    `score ${round4(shot.score)} · motion ${p.motion} · dur ${p.duration} · ` +
    `speech ${p.speech} · pos ${p.position}${t}`
  );
}

/**
 * 选段并生成 EDL。按分数贪心，凑到 target ±10%；同源不重叠，最终按时间排序。
 *
 * @param {{shots:Array, targetDuration:number, minShot?:number, maxShot?:number, speech?:Array,
 *          idealShot?:number, weights?:object, openingWindow?:number}} input
 * @returns {{clips:Array<{src:string,in:number,out:number,dur:number,score:number,reason:string}>,
 *            total:number, target:number, withinTolerance:boolean, coverage:number, warnings:string[]}}
 */
export function buildEDL({
  shots = [],
  targetDuration,
  minShot = 1.2,
  maxShot = 6,
  speech = [],
  idealShot,
  weights,
  openingWindow,
} = {}) {
  const target = Number(targetDuration);
  if (!Number.isFinite(target) || target <= 0) {
    throw new IngestError(`buildEDL: targetDuration must be > 0, got ${targetDuration}`, 'E_ARG');
  }
  const minD = Number(minShot);
  const maxD = Number(maxShot);
  if (!Number.isFinite(minD) || minD <= 0) throw new IngestError(`buildEDL: minShot must be > 0, got ${minShot}`, 'E_ARG');
  if (!Number.isFinite(maxD) || maxD <= 0 || maxD < minD) {
    throw new IngestError(`buildEDL: minShot (${minShot}) must be <= maxShot (${maxShot})`, 'E_ARG');
  }

  const warnings = [];
  const speechIv = normalizeIntervals(speech);

  // 1) 清洗：非法/过短镜头记警告后丢弃
  const usable = [];
  const rawShots = Array.isArray(shots) ? shots : [];
  rawShots.forEach((raw, i) => {
    let shot;
    try {
      shot = normalizeShot(raw, i);
    } catch (e) {
      warnings.push(`shot[${i}] skipped: ${e.message}`);
      return;
    }
    if (shot.dur < minD - 1e-9) {
      warnings.push(`shot[${i}] ${shot.src}@${shot.start}s skipped: ${round3(shot.dur)}s < minShot ${minD}s`);
      return;
    }
    usable.push({ ...shot, order: i });
  });

  if (!usable.length) {
    warnings.push('no usable shots');
    return {
      clips: [],
      total: 0,
      target,
      minShot: minD,
      maxShot: maxD,
      withinTolerance: false,
      coverage: 0,
      warnings,
    };
  }

  // 2) 打分 + 每个镜头的可用窗口（超长裁到 maxShot）
  const pool = scoreShots(usable, { speech: speechIv, idealShot, weights, openingWindow, minShot: minD })
    .map((s, i) => {
      const [wStart, wEnd] = trimWindow(s, maxD);
      return { ...s, order: usable[i].order, winStart: wStart, winEnd: wEnd, winLen: round3(wEnd - wStart) };
    })
    .filter((s) => {
      if (s.winLen >= minD - 1e-9) return true;
      warnings.push(`shot[${s.order}] window ${s.winLen}s < minShot; skipped`);
      return false;
    })
    .sort((a, b) => b.score - a.score || a.order - b.order);

  if (!pool.length) {
    warnings.push('no shootable window after min/max trim');
    return {
      clips: [], total: 0, target, minShot: minD, maxShot: maxD,
      withinTolerance: false, coverage: 0, warnings,
    };
  }

  // 3) 贪心填时长：先到 target，且绝不超过 target*1.1
  const upper = target * 1.1;
  const used = new Map(); // src → [[in,out], …]
  const selected = [];
  let total = 0;

  while (total < target - 1e-9) {
    const remainingUpper = upper - total;
    if (remainingUpper < minD - 1e-9) break;

    let best = null;
    for (const shot of pool) {
      if (shot.taken) continue;
      const gaps = used.get(shot.src) || [];
      const gap = largestFreeGap(shot.winStart, shot.winEnd, gaps);
      if (!gap || gap.len < minD - 1e-9) continue;
      const take = floor3(Math.min(gap.len, maxD, remainingUpper));
      if (take < minD - 1e-9) continue;
      const fill = Math.min(take, Math.max(0, target - total));
      const key = shot.score + 1e-6 * fill; // 分数主导，fill 只做同分时优先
      if (!best || key > best.key + 1e-12) best = { shot, gap, take, key };
    }
    if (!best) break;

    const trimmed = best.shot.dur > maxD + 1e-9;
    const start = chooseWindow(best.gap.start, best.gap.len, best.take, intervalsFor(speechIv, best.shot.src));
    const inT = floor3(start);
    const outT = floor3(inT + best.take);
    const durT = round3(outT - inT);
    if (durT < minD - 1e-9) break;

    best.shot.taken = true;
    selected.push({
      src: best.shot.src,
      in: inT,
      out: outT,
      dur: durT,
      score: round4(best.shot.score),
      reason: reasonOf(best.shot, durT, trimmed),
    });
    if (!used.has(best.shot.src)) used.set(best.shot.src, []);
    used.get(best.shot.src).push([inT, outT]);
    total = round3(total + durT);
  }

  // 4) 按时间排序（同源按 in）；来源顺序取素材首次出现顺序
  const srcOrder = new Map();
  rawShots.forEach((raw, i) => {
    const s = String(raw?.src ?? raw?.path ?? raw?.file ?? `shot-${i}`).replace(/\\/g, '/');
    if (!srcOrder.has(s)) srcOrder.set(s, srcOrder.size);
  });
  const clips = selected.sort(
    (a, b) => (srcOrder.get(a.src) ?? 999) - (srcOrder.get(b.src) ?? 999) || a.in - b.in,
  );
  total = round3(clips.reduce((s, c) => s + c.dur, 0));

  if (total < target * 0.9 - 1e-9) {
    warnings.push(
      `material short: selected ${total}s of target ${target}s ` +
      `(pool ${usable.length} shot(s)); add more footage or lower --target`,
    );
  }

  return {
    clips,
    total,
    target,
    minShot: minD,
    maxShot: maxD,
    withinTolerance: Math.abs(total - target) <= target * 0.1 + 1e-9,
    coverage: round3(total / target),
    pool: { shots: rawShots.length, usable: usable.length, selected: clips.length },
    warnings,
  };
}

// ── EDL → spec.script ───────────────────────────────────────────────────────

function resolvePair(cardCopy, i, clip) {
  const fallback = [`片段 ${pad2(i + 1)}`, `${round3(clip.dur)}s 素材`];
  let v;
  if (typeof cardCopy === 'function') v = cardCopy(clip, i);
  else if (Array.isArray(cardCopy)) v = cardCopy[i];
  else if (cardCopy && typeof cardCopy === 'object') v = cardCopy[i] ?? cardCopy;
  if (v === undefined || v === null) return fallback;

  if (typeof v === 'string') return [v, fallback[1]];
  if (Array.isArray(v)) return [String(v[0] ?? fallback[0]), String(v[1] ?? fallback[1])];
  if (typeof v === 'object') {
    const first = String(v.first ?? v.copy?.[0] ?? fallback[0]);
    const keyword = String(v.keyword ?? v.copy?.[1] ?? fallback[1]);
    return [first, keyword];
  }
  return fallback;
}

/**
 * EDL → spec（script 作者模式）。
 *
 * 每个 clip 产生一对 card + scene 块；scene 的时长精确等于 clip 时长，
 * card 吸收 (round - clip.dur) 的差额，使 spec v1 的“等长轮次”成立。
 * 前后各补 opening / more / ending 块，保证 script 从 0 连续覆盖到 total。
 *
 * @returns {{spec:object, script:Array, structure:object, total:number, round:number,
 *            clips:Array, warnings:string[]}}
 */
export function edlToScript(edl, opts = {}) {
  const clips = Array.isArray(edl?.clips) ? edl.clips : [];
  if (!clips.length) throw new IngestError('edlToScript: edl.clips is empty — nothing to script', 'E_EMPTY_EDL');

  const round = Number(opts.round ?? 4);
  const minCard = Number(opts.minCard ?? 0.6);
  const opening = Number(opts.opening ?? 3);
  const ending = Number(opts.ending ?? 2.5);
  const more = Number(opts.more ?? 1);
  const fps = Number(opts.fps ?? 30);
  const maxRounds = Math.max(1, Number(opts.maxRounds ?? 24));

  for (const [name, value] of Object.entries({ round, minCard, opening, ending, more, fps, maxRounds })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new IngestError(`edlToScript: ${name} must be > 0, got ${opts[name]}`, 'E_ARG');
    }
  }

  const warnings = [];
  let picked = clips;
  if (picked.length > maxRounds) {
    const keep = [...picked].sort((a, b) => Number(b.score) - Number(a.score)).slice(0, maxRounds);
    const keepSet = new Set(keep);
    picked = picked.filter((c) => keepSet.has(c));
    warnings.push(`spec v1 supports <= ${maxRounds} rounds; kept the top ${maxRounds} clips by score (edl.json keeps all)`);
  }

  const durs = picked.map((c) => round3(Number(c.dur ?? Number(c.out) - Number(c.in))));
  durs.forEach((d, i) => {
    if (!(d > 0)) throw new IngestError(`edlToScript: clip[${i}] has a non-positive duration (${d})`, 'E_ARG');
  });
  const omitted = clips.length - picked.length;

  const maxClip = Math.max(...durs);
  const R = floor3(Math.max(round, maxClip + minCard));
  if (!(R > maxClip)) throw new IngestError(`edlToScript: round (${R}) must exceed longest clip (${maxClip})`, 'E_ARG');

  const cardPages = opts.cardPage || 'templates/big-card.html';
  const scenePages = opts.scenePage || 'templates/segment.html';

  const blocks = [];
  let t = 0;
  const push = (block, dur) => {
    const d = round3(dur);
    blocks.push({ ...block, t: [t, round3(t + d)] });
    t = round3(t + d);
  };

  const title = String(opts.title || '素材剪辑');
  const brand = String(opts.brand || 'INGEST');
  const cta = String(opts.cta || '看完整版');
  const theme = String(opts.theme || 'coral-noir');

  push(
    { id: 's00', role: 'opening', page: scenePages, name: opts.openingName || 'opening', copy: [title] },
    opening,
  );

  picked.forEach((clip, i) => {
    const dur = durs[i];
    const cardDur = round3(R - dur);
    const [first, keyword] = resolvePair(opts.cardCopy, i, { ...clip, dur });
    const cardBlock = { id: `c${pad2(i + 1)}`, role: 'card', page: cardPages, copy: [first, keyword] };
    if (opts.cardColor) cardBlock.color = opts.cardColor;
    push(cardBlock, cardDur);
    push(
      {
        id: `s${pad2(i + 1)}`,
        role: 'scene',
        page: scenePages,
        recipe: clip.recipe ?? opts.recipe ?? null,
        name: clip.name || (clip.recipe ? String(clip.recipe) : basename(clip.src)),
        copy: [],
        reason: clip.reason ?? null,
        source: {
          src: clip.src,
          in: round3(clip.in),
          out: round3(clip.out),
          dur: round3(clip.dur ?? dur),
        },
      },
      dur,
    );
  });

  push(
    {
      id: 's97',
      role: 'more',
      page: cardPages,
      copy: [opts.moreFirst || '还有', opts.moreKeyword || '更多？'],
    },
    more,
  );
  push({ id: 's99', role: 'ending', page: scenePages, name: 'ending', copy: [cta] }, ending);

  const total = round3(t);
  const lastCard = round3(R - durs[durs.length - 1]);

  const structure = {
    opening: round3(opening),
    round: R,
    card: lastCard,
    ending: round3(ending),
    moreCard: round3(more),
    flash: { count: 0, each: 0.25 },
  };

  // 素材清单：同一 src 只登记一次
  const assets = [];
  const seen = new Set();
  for (const clip of picked) {
    const src = String(clip.src);
    if (seen.has(src)) continue;
    seen.add(src);
    assets.push({
      id: `a${pad2(assets.length + 1)}`,
      kind: VIDEO_EXT.test(src) ? 'video' : 'audio',
      path: src.replace(/\\/g, '/'),
      hash: clip.hash ?? null,
      loop: false,
    });
  }

  const width = Number(opts.width ?? 1920);
  const height = Number(opts.height ?? 1080);

  const spec = {
    specVersion: 1,
    meta: {
      name: title,
      brand,
      cta,
      locale: String(opts.locale || 'zh-CN'),
    },
    format: {
      width,
      height,
      fps,
      aspect: aspectOf(width, height),
      duration: null,
    },
    look: {
      mode: 'single',
      style: opts.style ?? null,
      theme,
      accentOverride: null,
    },
    audio: { mood: opts.mood || 'electronic', bpm: Number(opts.bpm ?? 120), vo: null },
    structure,
    opening: { page: scenePages, name: 'opening' },
    moreCard: { page: cardPages, ...(opts.moreCard || { first: '还有', keyword: '更多？' }) },
    flash: { page: cardPages },
    ending: { page: scenePages, name: 'ending' },
    script: blocks,
    assets,
    patches: [],
    render: {
      quality: 'master',
      preset: 'bilibili',
      concurrency: 4,
      outDir: opts.outDir || 'out/ingest',
    },
    'x-edl': {
      version: 1,
      edlTotal: round3(Number(edl.total ?? clips.reduce((s, c) => s + Number(c.dur ?? 0), 0))),
      cutTotal: round3(durs.reduce((s, d) => s + d, 0)),
      omitted,
      clips: clips.map((c) => ({
        src: String(c.src).replace(/\\/g, '/'),
        in: round3(c.in),
        out: round3(c.out),
        dur: round3(c.dur),
        score: Number.isFinite(Number(c.score)) ? round4(c.score) : null,
        reason: c.reason,
      })),
    },
  };

  return {
    spec,
    script: blocks,
    structure,
    total,
    round: R,
    clips: picked,
    warnings,
  };
}
