/**
 * spec.mjs — project.spec.json（IR）的加载、归一化、校验与 timeline 适配。
 *
 * 设计原则：
 *   1. spec 是唯一真相；所有入口（wizard / NL / 参考图 / 剧本 / API）只产出 spec。
 *   2. 不发明第二套时间结构：spec 在结构上兼容 timeline v1，复用 buildPlan 的
 *      帧对齐逻辑，保证与 render-farm / qa-video 的兼容性。
 *   3. 纯函数、零依赖、可在浏览器与 Node 两侧运行（不 import fs）。
 *
 * 用法：
 *   import { normalizeSpec, validateSpec, specToTimeline, specDuration } from './spec.mjs';
 */
import { query } from './timeline.mjs';
import { MOTION_LEVELS, deriveMotionProfile, motionQuery } from './motion-profile.mjs';

export const SPEC_VERSION = 1;
/** 引擎版本：任何会改变逐帧像素的实现变更都必须 +1（进入段哈希）。 */
export const ENGINE_VERSION = 1;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * 段 id 白名单：round.id 会变成文件名与 ffmpeg concat 清单的一行，
 * 所以只允许「安全文件名字符」，长度上限 64。
 * 挡掉：路径逃逸（`..`、绝对路径、分隔符）、换行注入 concat 清单、
 *      Windows 保留字符、引号与空格。
 */
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** 远程页面（http/https）。渲染器会直接 navigate 过去 → 默认禁止（SSRF）。 */
const ABS_URL_RE = /^https?:\/\//i;

/**
 * 绝对文件系统路径：POSIX（/…）、Windows 盘符（C:\… / C:/…）、UNC（\\host\share）。
 * 纯正则实现——spec.mjs 要能在浏览器里跑，不能 import path/fs。
 */
const ABS_PATH_RE = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;

/** 资源上限（防止一个 spec 排出天文数字的段与帧）。 */
export const MAX_FLASH_COUNT = 256;
export const MAX_SEGMENT_SECONDS = 600;   // 单段最长 10 分钟
export const MAX_TOTAL_FRAMES = 18000;    // 30fps 下约 10 分钟成片

export const DEFAULT_STRUCTURE = {
  opening: 8,
  round: 4,
  card: 1,
  ending: 6,
  moreCard: 1,
  flash: { count: 8, each: 0.25 },
};

export const DEFAULT_PAGES = {
  opening: 'segments/00-opening.html',
  card: 'segments/big-card.html',
  style: 'segments/01.html',
  more: 'segments/big-card.html',
  flash: 'segments/flash.html',
  ending: 'segments/99-ending.html',
};

const DEFAULTS = {
  specVersion: SPEC_VERSION,
  meta: { name: 'untitled', brand: '{{BRAND}}', cta: '', locale: 'zh-CN' },
  format: { width: 1920, height: 1080, fps: 30, aspect: '16:9', duration: null },
  look: { mode: 'showcase', style: null, theme: 'coral-noir', accentOverride: null, motion: null },
  audio: { mood: 'electronic', bpm: 120, vo: null },
  structure: DEFAULT_STRUCTURE,
  opening: {},
  rounds: [],
  moreCard: {},
  flash: {},
  ending: {},
  script: null,
  assets: [],
  patches: [],
  render: { quality: 'master', preset: 'bilibili', concurrency: 4, outDir: 'out', allowRemotePages: false },
};

const PRESETS = ['bilibili', 'douyin', 'youtube', 'wechat', 'master', 'square'];
const MOODS = ['electronic', 'restrained', 'epic', 'upbeat', 'guofeng'];

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function deepMerge(base, over) {
  if (over === undefined) return clone(base);
  if (over === null || typeof over !== 'object' || Array.isArray(over)) return clone(over);
  const out = Array.isArray(base) ? [...base] : { ...(base || {}) };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base?.[k] ?? {}, v) : clone(v);
  }
  return out;
}

const isHex = (v) => typeof v === 'string' && HEX.test(v);

/**
 * 把 `look.accentOverride`（字符串或 `{accent,accentInk,accentSoft}`）规范成
 * 只含合法 #hex 的对象；一个合法键都没有时返回 null。
 * 部分覆盖是合法的（schema 允许只给 accentInk），所以不要要求必须有 accent。
 * 结果由 specToTimeline 放进 meta.accent，再下发到每页 URL 的 ?accent=…。
 */
export function normalizeAccentOverride(input) {
  if (input == null) return null;
  const a = typeof input === 'string' ? { accent: input } : input;
  if (!a || typeof a !== 'object') return null;
  const out = {};
  for (const k of ['accent', 'accentInk', 'accentSoft']) if (isHex(a[k])) out[k] = a[k];
  return Object.keys(out).length ? out : null;
}

const cjkLength = (s) => [...String(s ?? '')].length;
const aspectOf = (w, h) => (Math.abs(w / h - 16 / 9) < 0.01 ? '16:9' : Math.abs(w / h - 9 / 16) < 0.01 ? '9:16' : Math.abs(w / h - 1) < 0.01 ? '1:1' : `${w}:${h}`);

/** timeline v1（旧格式）→ spec v1 */
export function migrateTimeline(raw) {
  const w = Number(raw.meta?.width ?? 1920);
  const h = Number(raw.meta?.height ?? 1080);
  return {
    specVersion: SPEC_VERSION,
    meta: {
      name: raw.meta?.title || raw.meta?.name || 'untitled',
      brand: raw.meta?.brand || '{{BRAND}}',
      cta: raw.meta?.cta || '',
      locale: 'zh-CN',
    },
    format: {
      width: w, height: h,
      fps: Number(raw.meta?.fps ?? 30),
      aspect: aspectOf(w, h),
      duration: null,
    },
    look: { mode: 'showcase', style: null, theme: raw.meta?.theme || 'coral-noir', accentOverride: null, motion: null },
    audio: { mood: 'electronic', bpm: Number(raw.meta?.bpm ?? 120), vo: null },
    structure: raw.structure || {},
    opening: raw.opening || {},
    rounds: raw.rounds || [],
    moreCard: raw.moreCard || {},
    flash: raw.flash || {},
    ending: raw.ending || {},
    assets: raw.assets || [],
    patches: raw.patches || [],
    render: { outDir: raw.meta?.outDir || 'out', quality: 'master', preset: 'bilibili', concurrency: 4 },
  };
}

/**
 * 剧本块 → rounds。仅在显式提供 script 且没有 rounds 时使用。
 * 支持的 role：opening / card / scene / more / flash / ending。
 * card 与紧随其后的 scene 配对成一轮；未配对的 card 会被忽略并在 validate 中告警。
 */
export function deriveFromScript(script, base = {}) {
  const blocks = [...script].sort((a, b) => (a.t?.[0] ?? 0) - (b.t?.[0] ?? 0));
  const structure = { ...DEFAULT_STRUCTURE, ...(base.structure || {}), flash: { ...DEFAULT_STRUCTURE.flash, ...(base.structure?.flash || {}) } };
  const opening = {};
  const ending = {};
  const moreCard = {};
  const flash = { ...(base.flash || {}) };
  const rounds = [];
  let pendingCard = null;
  let orphanCards = 0;

  for (const b of blocks) {
    const dur = Array.isArray(b.t) ? Number(b.t[1]) - Number(b.t[0]) : Number(b.duration || 0);
    switch (b.role) {
      case 'opening':
        opening.page = b.page || DEFAULT_PAGES.opening;
        if (dur > 0) structure.opening = dur;
        break;
      case 'card':
        pendingCard = b;
        if (dur > 0) structure.card = dur;
        break;
      case 'scene': {
        if (!pendingCard) { orphanCards++; break; }
        const cardDur = Number(pendingCard.t ? pendingCard.t[1] - pendingCard.t[0] : structure.card) || structure.card;
        const sceneDur = dur > 0 ? dur : Math.max(0.5, structure.round - cardDur);
        const roundDur = Math.round((cardDur + sceneDur) * 1000) / 1000;
        if (roundDur > 0) structure.round = roundDur;
        rounds.push({
          id: b.id ? String(b.id).replace(/^s/, 'c') : `r${String(rounds.length + 1).padStart(2, '0')}`,
          name: b.name || b.recipe || `round ${rounds.length + 1}`,
          card: {
            page: pendingCard.page || DEFAULT_PAGES.card,
            layout: pendingCard.layout,
            first: (pendingCard.copy || [])[0] ?? '想做',
            keyword: (pendingCard.copy || [])[1] ?? (pendingCard.copy || [])[0] ?? '视频？',
            color: pendingCard.color,
          },
          style: {
            page: b.page || DEFAULT_PAGES.style,
            recipe: b.recipe || null,
            t0: b.t0 ?? 0.3,
            speed: b.speed ?? 1.3,
          },
        });
        pendingCard = null;
        break;
      }
      case 'more':
        moreCard.page = b.page || DEFAULT_PAGES.more;
        if (dur > 0) structure.moreCard = dur;
        if (Array.isArray(b.copy)) { moreCard.first = b.copy[0]; moreCard.keyword = b.copy[1] ?? b.copy[0]; }
        break;
      case 'flash':
        structure.flash.count = (structure.flash.count || 0) + 1;
        if (dur > 0) structure.flash.each = dur;
        break;
      case 'ending':
        ending.page = b.page || DEFAULT_PAGES.ending;
        if (dur > 0) structure.ending = dur;
        break;
      default:
        break;
    }
  }
  if (pendingCard) orphanCards++;

  return { structure, opening, rounds, moreCard, flash, ending, orphanCards };
}

/** 读取文件/对象 → 归一化 spec。不触碰文件系统。 */
export function normalizeSpec(input) {
  if (!input || typeof input !== 'object') throw new Error('spec must be an object');
  let raw;
  if (input.specVersion === SPEC_VERSION) raw = clone(input);
  else if (input.version === 1) raw = migrateTimeline(input);
  else if (input.format || input.look) raw = clone(input); // 宽松：按 spec 处理，交给 validate
  else throw new Error(`unsupported spec: expected specVersion=${SPEC_VERSION} or timeline version=1`);

  const spec = deepMerge(DEFAULTS, raw);

  // script → rounds（仅当没有显式 rounds）
  if ((!spec.rounds || spec.rounds.length === 0) && Array.isArray(spec.script) && spec.script.length) {
    const derived = deriveFromScript(spec.script, spec);
    spec.structure = derived.structure;
    spec.opening = { ...spec.opening, ...derived.opening };
    spec.rounds = derived.rounds;
    spec.moreCard = { ...spec.moreCard, ...derived.moreCard };
    spec.flash = { ...spec.flash, ...derived.flash };
    spec.ending = { ...spec.ending, ...derived.ending };
    spec.meta.orphanCards = derived.orphanCards;
  }

  // 轮次默认值
  spec.rounds = (spec.rounds || []).map((r, i) => {
    const id = r.id || `r${String(i + 1).padStart(2, '0')}`;
    const card = { page: DEFAULT_PAGES.card, ...(r.card || {}) };
    const style = { page: DEFAULT_PAGES.style, t0: 0.3, speed: 1.3, ...(r.style || {}) };
    return {
      id,
      name: r.name || style.recipe || id,
      card: {
        layout: card.layout ?? i % 4,
        index: card.index ?? i + 1,
        total: card.total ?? spec.rounds.length,
        first: card.first ?? '想做',
        keyword: card.keyword ?? '视频？',
        color: card.color ?? '#ffcf5c',
        ...card,
      },
      style: { ...style, recipe: style.recipe || null },
    };
  });

  // 页面默认值
  spec.opening = { page: DEFAULT_PAGES.opening, ...spec.opening };
  spec.moreCard = { page: DEFAULT_PAGES.more, ...spec.moreCard };
  spec.flash = { ...spec.flash, page: spec.flash?.page || DEFAULT_PAGES.flash };
  spec.ending = { page: DEFAULT_PAGES.ending, ...spec.ending };

  // 时长
  if (!Number.isFinite(Number(spec.format.duration)) || Number(spec.format.duration) <= 0) {
    spec.format.duration = specDuration(spec);
  }
  spec.format.aspect = spec.format.aspect || aspectOf(spec.format.width, spec.format.height);

  Object.defineProperty(spec, '_authoredBy', {
    value: Array.isArray(input.script) && !input.rounds?.length ? 'script' : 'rounds',
    enumerable: false,
  });
  return spec;
}

/** 结构公式：D = opening + N×round + moreCard + flash.count×each + ending */
export function specDuration(spec) {
  const st = spec.structure || DEFAULT_STRUCTURE;
  const n = Array.isArray(spec.rounds) ? spec.rounds.length : Number(st.rounds || 0);
  const flash = Number(st.flash?.count ?? 0) * Number(st.flash?.each ?? 0);
  return Number(st.opening) + n * Number(st.round) + Number(st.moreCard) + flash + Number(st.ending);
}

/**
 * 校验 spec。返回 [{code, path, message, level}]。
 * 纯逻辑校验；页面/素材是否存在由 spec-lint.mjs 补齐。
 */
export function validateSpec(spec) {
  const issues = [];
  const err = (code, path, message) => issues.push({ code, path, message, level: 'error' });
  const warn = (code, path, message) => issues.push({ code, path, message, level: 'warn' });

  if (spec.specVersion !== SPEC_VERSION) err('E_VERSION', 'specVersion', `expected ${SPEC_VERSION}, got ${spec.specVersion}`);

  const { width, height, fps, aspect, duration } = spec.format;
  if (!Number.isInteger(Number(fps)) || Number(fps) < 1 || Number(fps) > 120) err('E_FPS', 'format.fps', `fps must be an integer 1..120, got ${fps}`);
  if (!(Number(width) > 0) || !(Number(height) > 0)) err('E_SIZE', 'format', 'width/height must be > 0');
  if (Number(width) % 2 || Number(height) % 2) warn('W_ODD_SIZE', 'format', 'odd width/height breaks yuv420p; use even numbers');
  const expectedAspect = aspectOf(Number(width), Number(height));
  if (aspect && aspect !== expectedAspect) warn('W_ASPECT', 'format.aspect', `aspect ${aspect} != ${expectedAspect} from ${width}x${height}`);

  if (!Array.isArray(spec.rounds) || spec.rounds.length === 0) err('E_ROUNDS', 'rounds', 'rounds[] must be non-empty');
  if (spec.rounds.length > 24) err('E_ROUNDS_MAX', 'rounds', 'more than 24 rounds is not supported in one film');

  const st = spec.structure;
  for (const k of ['opening', 'round', 'card', 'ending', 'moreCard']) {
    if (!(Number(st[k]) > 0)) err('E_STRUCTURE', `structure.${k}`, `${k} must be > 0, got ${st[k]}`);
  }
  if (!(Number(st.card) < Number(st.round))) err('E_CARD_GE_ROUND', 'structure.card', `card (${st.card}) must be smaller than round (${st.round})`);
  if (!(Number(st.flash.count) >= 0)) err('E_FLASH', 'structure.flash.count', 'flash.count must be >= 0');
  if (Number(st.flash.count) > 0 && !(Number(st.flash.each) > 0)) err('E_FLASH', 'structure.flash.each', 'flash.each must be > 0');
  if (Number(st.flash.count) > 16) warn('W_FLASH_MAX', 'structure.flash', 'more than 16 flashes is visually noisy');

  // 资源上限：structure 直接决定段数与帧数。
  // flash.count=100000 → 10 万段；structure.round=1e9 → 300 亿帧。
  // 两者都会把巨大的 plan 写盘并交给 N 个渲染 worker，必须挡住。
  if (Number(st.flash.count) > MAX_FLASH_COUNT) {
    err('E_FLASH_MAX', 'structure.flash.count', `flash.count must be <= ${MAX_FLASH_COUNT}, got ${st.flash.count}`);
  }
  for (const k of ['opening', 'round', 'card', 'ending', 'moreCard']) {
    if (Number(st[k]) > MAX_SEGMENT_SECONDS) {
      err('E_STRUCTURE_MAX', `structure.${k}`, `${k} must be <= ${MAX_SEGMENT_SECONDS}s, got ${st[k]}`);
    }
  }
  // 总帧数上限（30 fps 下约 10 分钟成片）
  if (Number.isFinite(Number(duration)) && Number(duration) * Number(fps) > MAX_TOTAL_FRAMES) {
    err('E_DURATION_MAX', 'format.duration',
      `duration ${duration}s @ ${fps}fps exceeds the ${MAX_TOTAL_FRAMES}-frame limit (~${Math.round(MAX_TOTAL_FRAMES / Number(fps))}s)`);
  }

  const ids = new Set();
  spec.rounds.forEach((r, i) => {
    const at = `rounds[${i}]`;
    if (!r.id) {
      err('E_ROUND_ID', at, 'round.id is required');
    } else if (ids.has(r.id)) {
      err('E_ROUND_ID', `${at}.id`, `duplicate round id "${r.id}"`);
    } else if (!SAFE_ID_RE.test(r.id)) {
      // round.id 会变成段文件名（<outDir>/<id>-card.mp4）并进 ffmpeg concat 清单，
      // 所以必须限制成安全的文件名字符：挡掉路径逃逸（../）与换行注入 concat 清单。
      err('E_ROUND_ID', `${at}.id`,
        `round.id must match ${SAFE_ID_RE} (letters, digits, dash, underscore; <= 64 chars) — it becomes a segment filename`);
    } else {
      ids.add(r.id);
    }
    if (!r.style?.page && !r.style?.recipe) err('E_STYLE_PAGE', `${at}.style`, 'style.page or style.recipe is required');
    if (r.style?.speed !== undefined && !(Number(r.style.speed) > 0)) err('E_SPEED', `${at}.style.speed`, 'speed must be > 0');
    if (r.card?.color && !isHex(r.card.color)) warn('W_CARD_COLOR', `${at}.card.color`, `"${r.card.color}" is not #rgb/#rrggbb`);
    if (cjkLength(r.card?.first) > 8) warn('W_COPY_LEN', `${at}.card.first`, `first copy is ${cjkLength(r.card.first)} chars (recommended <= 8)`);
    if (cjkLength(r.card?.keyword) > 12) warn('W_COPY_LEN', `${at}.card.keyword`, `keyword is ${cjkLength(r.card.keyword)} chars (recommended <= 12)`);
  });

  const computed = specDuration(spec);
  if (Number.isFinite(Number(duration)) && Math.abs(Number(duration) - computed) > 0.5 / Number(fps)) {
    err('E_DURATION', 'format.duration', `duration ${duration}s != structure total ${computed}s (opening + N×round + more + flashes + ending)`);
  }

  // 页面路径闸门：page 会被渲染器当成 URL 打开（http://127.0.0.1:<port>/<page>），
  // 所以绝对 URL（SSRF）与绝对文件路径（越出项目根）都必须挡掉。
  // 远程页面只有显式 opt-in（render.allowRemotePages）才允许。
  const allowRemote = spec.render?.allowRemotePages === true;
  const pageEntries = [
    ['opening.page', spec.opening?.page],
    ...spec.rounds.flatMap((r, i) => [
      [`rounds[${i}].card.page`, r.card?.page],
      [`rounds[${i}].style.page`, r.style?.page],
    ]),
    ['moreCard.page', spec.moreCard?.page],
    ['flash.page', spec.flash?.page],
    ['ending.page', spec.ending?.page],
  ];
  for (const [label, page] of pageEntries) {
    if (!page) continue;
    const raw = String(page);
    if (ABS_URL_RE.test(raw)) {
      if (!allowRemote) {
        err('E_PAGE_REMOTE', label,
          `remote page "${raw}" is not allowed; set render.allowRemotePages=true to opt in`);
      }
      continue;
    }
    // 绝对文件系统路径：path.resolve(root, p) 会忽略 root
    const bare = raw.split('?')[0].split('#')[0];
    if (ABS_PATH_RE.test(bare)) {
      err('E_PAGE_ABS', label,
        `absolute page path "${bare}" escapes the project root; use a path relative to the project root`);
    }
  }

  if (!spec.look?.theme) err('E_THEME', 'look.theme', 'theme id is required');
  if (spec.look?.motion != null && !MOTION_LEVELS.includes(spec.look.motion)) {
    err('E_MOTION', 'look.motion', `motion must be one of ${MOTION_LEVELS.join('|')}, got ${spec.look.motion}`);
  }
  if (spec.look?.accentOverride != null) {
    const a = spec.look.accentOverride;
    const bad = typeof a === 'string' ? !isHex(a) : !['accent', 'accentInk', 'accentSoft'].some((k) => isHex(a?.[k]));
    if (bad) err('E_ACCENT', 'look.accentOverride', 'accentOverride must be #hex or {accent,accentInk,accentSoft}');
  }
  if (!(Number(spec.audio?.bpm) > 0)) err('E_BPM', 'audio.bpm', 'bpm must be > 0');
  if (spec.audio?.mood && !MOODS.includes(spec.audio.mood)) err('E_MOOD', 'audio.mood', `mood must be one of ${MOODS.join('|')}`);
  if (spec.render?.preset && !PRESETS.includes(spec.render.preset)) err('E_PRESET', 'render.preset', `preset must be one of ${PRESETS.join('|')}`);
  if (spec.render?.concurrency !== undefined && !(Number(spec.render.concurrency) >= 1 && Number(spec.render.concurrency) <= 16)) {
    err('E_CONCURRENCY', 'render.concurrency', 'concurrency must be 1..16');
  }

  // 剧本覆盖校验（仅 script 作者模式）
  if (spec._authoredBy === 'script' && Array.isArray(spec.script)) {
    const blocks = [...spec.script].sort((a, b) => (a.t?.[0] ?? 0) - (b.t?.[0] ?? 0));
    let cursor = 0;
    for (const [i, b] of blocks.entries()) {
      if (!Array.isArray(b.t) || b.t.length !== 2) { err('E_SCRIPT_T', `script[${i}].t`, 't must be [start,end]'); continue; }
      const [s, e] = b.t.map(Number);
      if (!(e > s)) err('E_SCRIPT_T', `script[${i}].t`, `end must be > start (${s}..${e})`);
      if (Math.abs(s - cursor) > 1e-6) err('E_SCRIPT_GAP', `script[${i}].t`, `gap/overlap at ${s}s, expected ${cursor}s`);
      cursor = e;
    }
    if (Math.abs(cursor - computed) > 0.5 / Number(fps)) err('E_SCRIPT_COVER', 'script', `script ends at ${cursor}s but structure totals ${computed}s`);
    if (spec.meta?.orphanCards) warn('W_ORPHAN_CARD', 'script', `${spec.meta.orphanCards} card block(s) not followed by a scene; ignored`);
  }

  if (spec.meta?.brand === '{{BRAND}}') warn('W_BRAND', 'meta.brand', 'brand is still the {{BRAND}} placeholder');
  if (!String(spec.meta?.name || '').trim()) warn('W_NAME', 'meta.name', 'meta.name is empty');

  return issues;
}

/** spec → timeline v1（供 buildPlan 复用帧对齐逻辑） */
export function specToTimeline(spec, { root, outDir } = {}) {
  // 动效档位：显式写死就用它；没写就按 kind × style 推导。
  // 推导结果会进 meta.motion → buildPlan 的 themeParams 邻居 → 每页 URL 的 ?mp=
  const motion = MOTION_LEVELS.includes(spec.look?.motion)
    ? spec.look.motion
    : deriveMotionProfile({ kind: spec.meta?.kind, style: spec.look?.style });

  const meta = {
    title: spec.meta.name,
    brand: spec.meta.brand,
    theme: spec.look.theme,
    // 强调色覆盖（品牌色 / accentFix）：页面读不到 spec，必须由 plan 下发到 URL 的
    // ?accent= / ?accentInk= / ?accentSoft=。没有覆盖时保持 null → URL 不带这些参数。
    accent: normalizeAccentOverride(spec.look?.accentOverride),
    motion,
    bpm: spec.audio.bpm,
    fps: spec.format.fps,
    width: spec.format.width,
    height: spec.format.height,
    outDir: outDir || spec.render?.outDir || 'out',
  };
  if (root) meta.root = root;

  const rounds = spec.rounds.map((r) => ({
    id: r.id,
    name: r.name,
    card: { ...r.card },
    style: {
      ...r.style,
      page: query(r.style.page, r.style.recipe ? { recipe: r.style.recipe } : {}),
    },
  }));

  return {
    version: 1,
    meta,
    structure: spec.structure,
    opening: spec.opening,
    rounds,
    moreCard: spec.moreCard,
    flash: spec.flash,
    ending: spec.ending,
  };
}

/** 供 UI/CLI 展示的一行摘要 */
export function specSummary(spec) {
  return `${spec.meta.name} · ${spec.format.width}×${spec.format.height} · ${spec.format.duration}s · ${spec.rounds.length} rounds · ${spec.look.theme}${spec.look.style ? ` / ${spec.look.style}` : ''}`;
}
