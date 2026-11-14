/**
 * app/script/model.mjs — C2-06 剧本表格的纯函数层。
 *
 * 设计约束：
 *   - 零依赖，不 import fs / node:crypto，不做 I/O —— 浏览器与 Node 双侧可直接加载；
 *   - 不修改 `templates/*`，但行顺序与段 id 刻意与 `templates/timeline.mjs` 的 plan 对齐
 *     （opening → 每轮 card/scene → more → flash×N → ending），后续接脏段时可一对一对上；
 *   - 所有编辑返回新 spec（不可变），原对象永不写入；
 *   - 时间轴复用 plan 的帧对齐规则：startFrame = round(cursor×fps)，
 *     末段 endFrame = round(total×fps)，因此行时长之和 === 总帧数 / fps。
 *
 * 用法：
 *   import { specToRows, applyRowEdit, validateRows, specHash, diffSpecs } from './model.mjs';
 */

export const SPEC_VERSION = 1;

/** 文案上限（按 Unicode 码点计数）。与 spec.mjs validateSpec 的推荐值一致。 */
export const COPY_LIMITS = Object.freeze({ first: 8, keyword: 12 });

/** 数值字段的合法区间。speed 必须 > 0（spec-lint E_SPEED）。 */
export const FIELD_RANGES = Object.freeze({
  t0: Object.freeze({ min: 0, max: 60, exclusiveMin: false }),
  speed: Object.freeze({ min: 0, max: 10, exclusiveMin: true }),
});

/** 每类行允许编辑的字段（白名单）。flash 行代表计数，整体只读。 */
export const EDITABLE_FIELDS = Object.freeze({
  opening: Object.freeze(['name']),
  card: Object.freeze(['name', 'first', 'keyword']),
  scene: Object.freeze(['name', 'recipe', 't0', 'speed']),
  more: Object.freeze(['name', 'first', 'keyword']),
  flash: Object.freeze([]),
  ending: Object.freeze(['name']),
});

export const ROLES = Object.freeze(['opening', 'card', 'scene', 'more', 'flash', 'ending']);

const DEFAULT_STRUCTURE = Object.freeze({
  opening: 8,
  round: 4,
  card: 1,
  ending: 6,
  moreCard: 1,
  flash: Object.freeze({ count: 8, each: 0.25 }),
});

const num = (v, fallback) => {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** 解析 structure，补齐与 templates/spec.mjs DEFAULT_STRUCTURE 相同的默认值。 */
export function resolveStructure(spec) {
  const s = spec?.structure || {};
  const flash = s.flash || {};
  return {
    opening: num(s.opening, DEFAULT_STRUCTURE.opening),
    round: num(s.round, DEFAULT_STRUCTURE.round),
    card: num(s.card, DEFAULT_STRUCTURE.card),
    ending: num(s.ending, DEFAULT_STRUCTURE.ending),
    moreCard: num(s.moreCard, DEFAULT_STRUCTURE.moreCard),
    flash: {
      count: Math.max(0, Math.trunc(num(flash.count, DEFAULT_STRUCTURE.flash.count))),
      each: Math.max(0, num(flash.each, DEFAULT_STRUCTURE.flash.each)),
    },
    /** 旧 timeline 允许用 structure.rounds / structure.styles 声明轮数。 */
    declaredRounds: s.rounds ?? s.styles ?? null,
  };
}

/** 按 Unicode 码点计长（CJK 一字符算 1）。 */
export function textLength(value) {
  return [...String(value ?? '')].length;
}

const cloneSpec = (spec) => JSON.parse(JSON.stringify(spec));

/**
 * spec → 表格行。
 * 每行：{ id, role, index, roundIndex, roundId, name, start, duration, startFrame,
 *        frames, nominalDuration, first, keyword, recipe, t0, speed, editable }
 */
export function specToRows(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('spec must be an object');
  const st = resolveStructure(spec);
  const fps = num(spec.format?.fps, 30) > 0 ? num(spec.format.fps, 30) : 30;
  const rounds = Array.isArray(spec.rounds) ? spec.rounds : [];
  const opening = spec.opening || {};
  const moreCard = spec.moreCard || {};
  const ending = spec.ending || {};

  /** @type {Array<object>} */
  const nominal = [];

  nominal.push({
    id: '00-opening',
    role: 'opening',
    roundIndex: null,
    roundId: null,
    name: opening.name || 'opening',
    duration: Math.max(0, st.opening),
    first: null,
    keyword: null,
    recipe: null,
    t0: null,
    speed: null,
  });

  rounds.forEach((r, i) => {
    const rid = r?.id ? String(r.id) : `r${String(i + 1).padStart(2, '0')}`;
    const card = r?.card || {};
    const style = r?.style || {};
    const roundName = r?.name || rid;
    nominal.push({
      id: `${rid}-card`,
      role: 'card',
      roundIndex: i,
      roundId: rid,
      name: roundName,
      duration: Math.max(0, st.card),
      first: card.first ?? '想做',
      keyword: card.keyword ?? r?.name ?? '风格？',
      recipe: null,
      t0: null,
      speed: null,
    });
    nominal.push({
      id: `${rid}-style`,
      role: 'scene',
      roundIndex: i,
      roundId: rid,
      name: roundName,
      duration: Math.max(0, st.round - st.card),
      first: null,
      keyword: null,
      recipe: style.recipe ?? null,
      t0: num(style.t0, 0),
      speed: num(style.speed, 1),
    });
  });

  nominal.push({
    id: '99-more',
    role: 'more',
    roundIndex: null,
    roundId: null,
    name: moreCard.name || '还有更多?',
    duration: Math.max(0, st.moreCard),
    first: moreCard.first ?? '还有',
    keyword: moreCard.keyword ?? '更多？',
    recipe: null,
    t0: null,
    speed: null,
  });

  for (let i = 0; i < st.flash.count; i++) {
    nominal.push({
      id: `f${String(i + 1).padStart(2, '0')}`,
      role: 'flash',
      roundIndex: null,
      roundId: null,
      name: `flash ${i + 1}/${st.flash.count}`,
      duration: st.flash.each,
      first: null,
      keyword: null,
      recipe: null,
      t0: null,
      speed: null,
    });
  }

  nominal.push({
    id: '99-ending',
    role: 'ending',
    roundIndex: null,
    roundId: null,
    name: ending.name || 'ending',
    duration: Math.max(0, st.ending),
    first: null,
    keyword: null,
    recipe: null,
    t0: null,
    speed: null,
  });

  const totalNominal = nominal.reduce((sum, row) => sum + row.duration, 0);
  const totalFrames = Math.max(0, Math.round(totalNominal * fps));
  let cursor = 0;

  return nominal.map((row, i) => {
    const startFrame = Math.round(cursor * fps);
    cursor += row.duration;
    const endFrame = i === nominal.length - 1 ? totalFrames : Math.round(cursor * fps);
    const frames = Math.max(0, endFrame - startFrame);
    return {
      ...row,
      index: i,
      startFrame,
      endFrame: startFrame + frames,
      frames,
      start: startFrame / fps,
      end: startFrame / fps + frames / fps,
      duration: frames / fps,
      nominalDuration: row.duration,
      editable: EDITABLE_FIELDS[row.role] || [],
    };
  });
}

/**
 * 结构公式（与 templates/spec.mjs specDuration 一致）：
 *   D = opening + N×round + moreCard + flash.count×each + ending
 * frames = round(D×fps)，duration = frames/fps（与 plan stats 一致）。
 */
export function specTotals(spec) {
  const st = resolveStructure(spec);
  const rounds = Array.isArray(spec.rounds) ? spec.rounds : [];
  const fps = num(spec.format?.fps, 30) > 0 ? num(spec.format.fps, 30) : 30;
  const nominal =
    st.opening +
    rounds.length * st.round +
    st.moreCard +
    st.flash.count * st.flash.each +
    st.ending;
  const frames = Math.max(0, Math.round(nominal * fps));
  return {
    nominal,
    duration: frames / fps,
    frames,
    fps,
    segments: 1 + rounds.length * 2 + 1 + st.flash.count + 1,
    rounds: rounds.length,
  };
}

function coerceNumber(field, value) {
  const range = FIELD_RANGES[field];
  const text = typeof value === 'number' ? value : String(value ?? '').trim();
  if (text === '') throw new RangeError(`${field} 不能为空`);
  const n = Number(text);
  if (!Number.isFinite(n)) throw new RangeError(`${field} 必须是有限数字，收到 "${value}"`);
  const lowOk = range.exclusiveMin ? n > range.min : n >= range.min;
  if (!lowOk) throw new RangeError(`${field} 必须 ${range.exclusiveMin ? '>' : '≥'} ${range.min}，收到 ${n}`);
  if (n > range.max) throw new RangeError(`${field} 必须 ≤ ${range.max}，收到 ${n}`);
  return n;
}

function coerceValue(field, value) {
  if (!(field in FIELD_RANGES)) {
    if (field === 'recipe') {
      const s = value == null ? '' : String(value).trim();
      return s === '' ? null : s;
    }
    if (field === 'name' || field === 'first' || field === 'keyword') {
      return value == null ? '' : String(value).trim();
    }
    throw new Error(`字段 "${field}" 没有归一化规则`);
  }
  return coerceNumber(field, value);
}

/**
 * 行内编辑：返回新 spec，不改原 spec。
 * @param {object} spec
 * @param {string} rowId  specToRows() 产出的行 id
 * @param {string} field  白名单字段
 * @param {unknown} value 原始输入（字符串/数字）
 * @throws {Error} 未知行、字段不在白名单、数值越界
 */
export function applyRowEdit(spec, rowId, field, value) {
  const row = specToRows(spec).find((r) => r.id === rowId);
  if (!row) throw new Error(`unknown row "${rowId}"`);
  const allowed = EDITABLE_FIELDS[row.role] || [];
  if (!allowed.includes(field)) {
    throw new Error(`not editable: 字段 "${field}" 不能在 ${row.role} 行（${rowId}）上编辑；允许：${allowed.join(', ') || '（只读）'}`);
  }
  const clean = coerceValue(field, value);
  const next = cloneSpec(spec);

  if (row.role === 'opening') {
    next.opening = { ...(next.opening || {}), [field]: clean };
    return next;
  }
  if (row.role === 'ending') {
    next.ending = { ...(next.ending || {}), [field]: clean };
    return next;
  }
  if (row.role === 'more') {
    next.moreCard = { ...(next.moreCard || {}), [field]: clean };
    return next;
  }
  if (row.role === 'card' || row.role === 'scene') {
    const i = row.roundIndex;
    if (!Array.isArray(next.rounds) || !next.rounds[i]) throw new Error(`round "${row.roundId}" 不存在`);
    const target = next.rounds[i];
    if (field === 'name') target.name = clean;
    else if (row.role === 'card') target.card = { ...(target.card || {}), [field]: clean };
    else target.style = { ...(target.style || {}), [field]: clean };
    return next;
  }
  throw new Error(`行 "${rowId}" 只读`);
}

/**
 * 表格级校验。返回 issue 列表：
 *   { rowId, field, code, message, level: 'error'|'warn' }
 * 覆盖：文案超长、轮次总时长与 structure 不一致、id 重复、speed<=0、t0 越界、
 *       总时长与 format.duration 不一致、轮数声明不一致。
 */
export function validateRows(spec) {
  const issues = [];
  const add = (rowId, field, code, message, level = 'error') =>
    issues.push({ rowId, field, code, message, level });

  if (!spec || typeof spec !== 'object') {
    add(null, null, 'E_SPEC', 'spec 不是一个对象');
    return issues;
  }

  const st = resolveStructure(spec);
  const rounds = Array.isArray(spec.rounds) ? spec.rounds : [];
  const rows = specToRows(spec);
  const totals = specTotals(spec);
  const tol = 0.5 / (totals.fps || 30);

  if (!(st.card < st.round)) {
    add(null, 'structure.card', 'E_CARD_GE_ROUND', `structure.card (${st.card}s) 必须小于 structure.round (${st.round}s)`);
  }
  if (!(st.opening > 0)) add(null, 'structure.opening', 'E_STRUCTURE', 'structure.opening 必须 > 0');
  if (!(st.ending > 0)) add(null, 'structure.ending', 'E_STRUCTURE', 'structure.ending 必须 > 0');
  if (!(st.moreCard > 0)) add(null, 'structure.moreCard', 'E_STRUCTURE', 'structure.moreCard 必须 > 0');
  if (!(st.round > 0)) add(null, 'structure.round', 'E_STRUCTURE', 'structure.round 必须 > 0');

  // id 唯一
  const seen = new Map();
  rounds.forEach((r, i) => {
    const id = r?.id == null ? '' : String(r.id);
    if (!id) {
      add(`${id || `r${i + 1}`}-card`, 'id', 'E_ROUND_ID', `第 ${i + 1} 轮缺 id`);
      return;
    }
    if (seen.has(id)) {
      add(`${id}-card`, 'id', 'E_DUP_ID', `round id 重复："${id}"（第 ${seen.get(id) + 1} 轮与第 ${i + 1} 轮）`);
    } else {
      seen.set(id, i);
    }
  });

  // 行 id 唯一（round id 重复会在这里再次暴露）
  const rowIds = new Map();
  rows.forEach((row) => {
    if (rowIds.has(row.id)) add(row.id, 'id', 'E_DUP_ROW', `行 id 重复："${row.id}"`);
    else rowIds.set(row.id, true);
  });

  // 文案长度
  for (const row of rows) {
    for (const field of ['first', 'keyword']) {
      const value = row[field];
      if (value == null) continue;
      const len = textLength(value);
      const limit = COPY_LIMITS[field];
      if (len > limit) {
        add(row.id, field, 'E_COPY_LEN', `${field} 文案 ${len} 字，超过上限 ${limit} 字："${value}"`);
      }
    }
    if ((row.role === 'card' || row.role === 'scene') && !String(row.name || '').trim()) {
      add(row.id, 'name', 'E_ROUND_NAME', '轮次名称不能为空', 'warn');
    }
  }

  // 数值字段
  for (const row of rows) {
    if (row.role !== 'scene') continue;
    if (!(Number(row.speed) > 0)) add(row.id, 'speed', 'E_SPEED', `speed 必须 > 0，当前 ${row.speed}`);
    if (!(Number(row.speed) <= FIELD_RANGES.speed.max)) add(row.id, 'speed', 'E_SPEED', `speed 必须 ≤ ${FIELD_RANGES.speed.max}，当前 ${row.speed}`);
    if (!(Number(row.t0) >= FIELD_RANGES.t0.min)) add(row.id, 't0', 'E_T0', `t0 必须 ≥ ${FIELD_RANGES.t0.min}，当前 ${row.t0}`);
    if (!(Number(row.t0) <= FIELD_RANGES.t0.max)) add(row.id, 't0', 'E_T0', `t0 必须 ≤ ${FIELD_RANGES.t0.max}，当前 ${row.t0}`);
  }

  // 每轮总时长 = card + scene，必须与 structure.round（或 round.duration 覆盖）一致
  const byRound = new Map();
  for (const row of rows) {
    if (row.roundIndex == null) continue;
    const bucket = byRound.get(row.roundIndex) || { sum: 0, firstRow: row };
    bucket.sum += row.duration;
    byRound.set(row.roundIndex, bucket);
  }
  for (const [idx, bucket] of byRound) {
    const round = rounds[idx] || {};
    const override = Number(round.duration);
    const expected = Number.isFinite(override) && override > 0 ? override : st.round;
    if (Math.abs(bucket.sum - expected) > tol) {
      add(
        bucket.firstRow.id,
        'structure.round',
        'E_ROUND_TOTAL',
        `第 ${idx + 1} 轮合计 ${round3(bucket.sum)}s，structure.round=${round3(expected)}s`,
      );
    }
  }

  // 轮数声明（旧 timeline 的 structure.rounds / structure.styles）
  if (st.declaredRounds != null && Number(st.declaredRounds) !== rounds.length) {
    add(null, 'structure.rounds', 'E_ROUND_COUNT', `structure 声明 ${st.declaredRounds} 轮，rounds[] 实际 ${rounds.length} 轮`);
  }

  // 总时长
  const declaredDuration = Number(spec.format?.duration);
  if (Number.isFinite(declaredDuration) && declaredDuration > 0) {
    if (Math.abs(declaredDuration - totals.duration) > tol) {
      add(
        null,
        'format.duration',
        'E_DURATION',
        `format.duration=${round3(declaredDuration)}s 与结构公式 ${round3(totals.duration)}s 不一致`,
      );
    }
  }

  return issues;
}

const round3 = (x) => Math.round(Number(x) * 1000) / 1000;

/** 递归稳定序列化：对象键排序、数组保序。用于哈希，不受键书写顺序影响。 */
export function stableStringify(value) {
  const norm = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(norm);
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = norm(v[k]);
    return out;
  };
  return JSON.stringify(norm(value));
}

// ── 纯 JS SHA-256（浏览器 / Node 通用，避免 node:crypto 依赖） ───────────────
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x, n) => (x >>> n) | (x << (32 - n));
const utf8 = (s) => new TextEncoder().encode(String(s));

/** SHA-256 十六进制摘要。 */
export function sha256Hex(message) {
  const data = utf8(message);
  const bitLen = data.length * 8;
  const padded = new Uint8Array(((data.length + 9 + 63) >>> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** spec 的内容哈希：稳定序列化 + sha256 前 12 位。 */
export function specHash(spec) {
  return sha256Hex(stableStringify(spec)).slice(0, 12);
}

const n3 = (x) => String(Math.round(Number(x) * 1000) / 1000);
const show = (v) => (v == null ? '' : String(v));

/** 供 diff 使用的规范化行视图：头部元信息 + 每段一行。 */
export function specToLines(spec) {
  const st = resolveStructure(spec);
  const totals = specTotals(spec);
  const fmt = spec.format || {};
  const look = spec.look || {};
  const audio = spec.audio || {};
  const meta = spec.meta || {};
  const lines = [
    `meta.name=${show(meta.name)} | brand=${show(meta.brand)} | cta=${show(meta.cta)}`,
    `format=${show(fmt.width)}x${show(fmt.height)} @${show(fmt.fps)}fps ${show(fmt.aspect)} duration=${n3(totals.duration)}s frames=${totals.frames}`,
    `look: mode=${show(look.mode)} style=${show(look.style)} theme=${show(look.theme)}`,
    `audio: mood=${show(audio.mood)} bpm=${show(audio.bpm)}`,
    `structure: opening=${n3(st.opening)} round=${n3(st.round)} card=${n3(st.card)} moreCard=${n3(st.moreCard)} flash=${st.flash.count}x${n3(st.flash.each)} ending=${n3(st.ending)}`,
  ];
  for (const row of specToRows(spec)) {
    lines.push(
      `${row.id} | ${row.role} | ${n3(row.start)}s+${n3(row.duration)}s` +
        ` | name=${show(row.name)}` +
        ` | first=${show(row.first)}` +
        ` | keyword=${show(row.keyword)}` +
        ` | recipe=${show(row.recipe)}` +
        ` | t0=${row.t0 == null ? '' : n3(row.t0)}` +
        ` | speed=${row.speed == null ? '' : n3(row.speed)}`,
    );
  }
  return lines;
}

/**
 * 通用 unified diff（LCS）。
 * @returns {string} 无差异时返回 ''，否则返回 `---`/`+++`/`@@` 文本。
 */
export function unifiedDiff(aLines, bLines, { context = 3, from = 'a/spec', to = 'b/spec' } = {}) {
  const n = aLines.length;
  const m = bLines.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      ops.push({ t: ' ', s: aLines[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: '-', s: aLines[i] });
      i++;
    } else {
      ops.push({ t: '+', s: bLines[j] });
      j++;
    }
  }
  while (i < n) ops.push({ t: '-', s: aLines[i++] });
  while (j < m) ops.push({ t: '+', s: bLines[j++] });

  const changed = ops.map((o, k) => (o.t === ' ' ? -1 : k)).filter((k) => k >= 0);
  if (!changed.length) return '';

  // 每行在旧/新文件中的 0-based 起始位置
  let oldNo = 0;
  let newNo = 0;
  const pos = ops.map((o) => {
    const p = { old: oldNo, new: newNo };
    if (o.t !== '+') oldNo++;
    if (o.t !== '-') newNo++;
    return p;
  });

  const groups = [];
  let start = changed[0];
  let last = changed[0];
  for (const k of changed.slice(1)) {
    if (k - last > context * 2) {
      groups.push([start, last]);
      start = k;
    }
    last = k;
  }
  groups.push([start, last]);

  const out = [`--- ${from}`, `+++ ${to}`];
  for (const [s, e] of groups) {
    const from0 = Math.max(0, s - context);
    const to0 = Math.min(ops.length, e + context + 1);
    const chunk = ops.slice(from0, to0);
    const oldStart = pos[from0].old;
    const newStart = pos[from0].new;
    const oldCount = chunk.filter((o) => o.t !== '+').length;
    const newCount = chunk.filter((o) => o.t !== '-').length;
    const header = (count, lineNo) => (count === 0 ? `${Math.max(0, lineNo)},0` : `${lineNo + 1},${count}`);
    out.push(`@@ -${header(oldCount, oldStart)} +${header(newCount, newStart)} @@`);
    for (const o of chunk) out.push(o.t + o.s);
  }
  return out.join('\n') + '\n';
}

/** 两个 spec 的行级 unified diff。 */
export function diffSpecs(a, b, options = {}) {
  return unifiedDiff(specToLines(a), specToLines(b), options);
}
