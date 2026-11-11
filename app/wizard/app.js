/**
 * app/wizard/app.js — 七张选择卡 → spec v1。
 *
 * 约束：
 *   1. 纯浏览器 ES module，无框架、无构建步骤；
 *   2. 只通过 serve.mjs 打开（需要导入 /templates/spec.mjs，file:// 下会被浏览器拒绝）；
 *   3. 每次生成调用一次 normalizeSpec + validateSpec，JSON 预览与下载都来自归一化后的 spec；
 *   4. 选项枚举来自 schema/project.spec.schema.json 与 content/combos.json，不手写第二份。
 */

const $ = (sel, root = document) => root.querySelector(sel);

const PAGE_SEGMENT = 'templates/segment.html';
const PAGE_CARD = 'templates/big-card.html';

const KIND_OPTIONS = [
  { id: 'promo', label: '宣传片', hint: '造势 · 预热' },
  { id: 'launch', label: '产品发布', hint: '新品 · 亮相' },
  { id: 'knowledge', label: '知识科普', hint: '讲解 · 教程' },
  { id: 'ecommerce', label: '电商带货', hint: '种草 · 转化' },
  { id: 'brand-story', label: '品牌故事', hint: '理念 · 历程' },
  { id: 'data-report', label: '数据报告', hint: '复盘 · 投研' },
  { id: 'recruiting', label: '招聘', hint: '岗位 · 团队' },
  { id: 'annual', label: '年度总结', hint: '回顾 · 年会' },
];

const STYLE_OPTIONS = [
  { id: 'cyber-pixel', label: '赛博像素', hint: '霓虹 · 抖动' },
  { id: 'cyber-glitch', label: '赛博故障', hint: 'RGB 切片' },
  { id: 'pixel-8bit', label: '8-bit 像素', hint: '街机 · 精灵' },
  { id: 'ink-wash', label: '水墨', hint: '山水 · 留白' },
  { id: 'guofeng', label: '国风', hint: '东方 · 纹样' },
  { id: 'whiteboard', label: '白板', hint: '手绘 · 标注' },
  { id: 'three-d', label: '3D', hint: '材质 · 环绕' },
  { id: 'data-viz', label: '数据可视化', hint: '条形 · 竞速' },
  { id: 'screencast', label: '录屏', hint: '代码 · 逐字' },
  { id: 'flat', label: '扁平插画', hint: '矢量 · 色块' },
  { id: 'minimal', label: '极简大字', hint: '发布会 · 克制' },
  { id: 'vertical', label: '竖屏卡片', hint: '手机 · 弹卡' },
];

const MOOD_LABEL = {
  electronic: { label: '电子', hint: '科技 · 赛博' },
  restrained: { label: '克制', hint: '高端 · 清新' },
  epic: { label: '史诗', hint: '宏大 · 年会' },
  upbeat: { label: '轻快', hint: '时尚 · 带货' },
  guofeng: { label: '国风', hint: '东方 · 水墨' },
};

const ASPECT_LABEL = {
  '16:9': { label: '16:9 横屏', hint: '1920×1080' },
  '9:16': { label: '9:16 竖屏', hint: '1080×1920' },
  '1:1': { label: '1:1 方形', hint: '1080×1080' },
};

const DURATIONS = [15, 30, 41, 60];

const KIND_CTA = {
  promo: '立即预约',
  launch: '预约体验',
  knowledge: '关注不迷路',
  ecommerce: '立即下单',
  'brand-story': '了解更多',
  'data-report': '获取完整报告',
  recruiting: '投递简历',
  annual: '明年见',
};

const KIND_COPY = {
  promo: ['想做', '宣传片？', '#ff2bd6'],
  launch: ['想开', '产品发布会？', '#a58bff'],
  knowledge: ['想做', '知识科普？', '#58c4dd'],
  ecommerce: ['想卖', '爆款商品？', '#ff5f9e'],
  'brand-story': ['想讲', '品牌故事？', '#c9a45a'],
  'data-report': ['想晒', '增长数据？', '#2456d6'],
  recruiting: ['想招', '厉害的人？', '#ff4a1f'],
  annual: ['想回顾', '这一年？', '#f2c14e'],
};

const MOOD_BPM = { electronic: 120, restrained: 90, epic: 100, upbeat: 128, guofeng: 80 };

/**
 * 动效档位（v2.3）。
 * 档位表住在 templates/motion-profile.mjs（与服务端共享同一份真值）；
 * 模块没加载成功时退回 'standard'，不影响出片。
 */
const MOTION_FALLBACK = 'standard';
function deriveMotionProfile({ kind, style }) {
  if (motionApi && typeof motionApi.deriveMotionProfile === 'function') {
    return motionApi.deriveMotionProfile({ kind, style });
  }
  return MOTION_FALLBACK;
}

const CTA_QUICK = ['立即预约', '立即下单', '预约体验', '关注不迷路', '投递简历', '了解更多', '获取完整报告', '明年见'];

// ── 运行时数据 ─────────────────────────────────────────────────────────────

let specApi = null;
let refApi = null;
let motionApi = null;
let lastRef = null;
let themesDoc = null;
let schemaDoc = null;
let presets = [];
let combosDoc = null;
let combos = {};
let styleOptions = STYLE_OPTIONS;
let aspectOptions = [];
let moodOptions = [];

let lastSpec = null;
let lastIssues = [];
let ctaCustom = false;
let generateTimer = null;

const state = {
  mode: 'preset',
  presetId: null,
  kind: 'promo',
  style: 'cyber-pixel',
  theme: 'cyber-neon',
  duration: 30,
  aspect: '16:9',
  mood: 'electronic',
  brand: '{{BRAND}}',
  accent: null,
  reference: null,
  cta: KIND_CTA.promo,
  motion: 'auto',       // v2.3：'auto' = 按 kind × style 推导档位
};

// ── 通用工具 ───────────────────────────────────────────────────────────────

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const roundTo = (v, step) => Math.round(v / step) * step;
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function optionLabel(options, id) {
  const hit = options.find((o) => o.id === id);
  return hit ? hit.label : id;
}

function themeMeta(id) {
  const t = themesDoc?.THEMES?.[id];
  return {
    id,
    name: t?.name || combosDoc?._meta?.themeNames?.[id] || id,
    mode: t?.mode || combosDoc?._meta?.families?.themeMode?.[id] || '',
    bg: t?.colors?.bg || '#15171b',
    accent: t?.colors?.accent || '#d97757',
    paper: t?.colors?.paper || '#f4efe6',
  };
}

function compat(theme, style) {
  const v = combos?.[theme]?.[style];
  return v === 'recommended' || v === 'ok' || v === 'avoid' ? v : 'ok';
}

function sizeFor(aspect) {
  if (aspect === '9:16') return { width: 1080, height: 1920 };
  if (aspect === '1:1') return { width: 1080, height: 1080 };
  return { width: 1920, height: 1080 };
}

/** D = opening + N×round + moreCard + flash.count×flash.each + ending
 *  与 scripts/nl2spec.mjs 的 fitStructure 保持同一套逻辑（Node 侧有穷举回归测试）。 */
function fitStructure(duration, roundCount) {
  const D = Number(duration);
  const maxRounds = Math.max(1, Math.min(24, Math.floor(D / 3)));
  const n = clamp(roundCount || Math.round(D / 7), 1, maxRounds);

  const flash = { count: D >= 10 ? 8 : 0, each: 0.25 };
  const flashTotal = flash.count * flash.each;
  const moreCard = D >= 8 ? 1 : 0.5;
  const opening = D >= 10 ? Math.max(1, roundTo(D * 0.2, 0.5)) : Math.min(1, roundTo(D * 0.1, 0.25));
  const ending = D >= 10 ? Math.max(1, roundTo(D * 0.15, 0.5)) : Math.min(1, roundTo(D * 0.1, 0.25));

  let round = Math.max(0.75, roundTo((D - opening - ending - moreCard - flashTotal) / n, 0.25));
  let adjustedOpening = D - ending - moreCard - flashTotal - n * round;
  while (adjustedOpening < 0.25 && round > 0.75) {
    round = Number((round - 0.25).toFixed(3));
    adjustedOpening = D - ending - moreCard - flashTotal - n * round;
  }
  if (adjustedOpening < 0.25) {
    const deficit = 0.25 - adjustedOpening;
    const endingCut = Math.min(deficit, Math.max(0, ending - 0.25));
    const afterEnding = ending - endingCut;
    const moreCut = Math.min(deficit - endingCut, Math.max(0, moreCard - 0.25));
    const afterMore = moreCard - moreCut;
    adjustedOpening = D - afterEnding - afterMore - flashTotal - n * round;
    return {
      structure: {
        opening: Number(Math.max(0.1, adjustedOpening).toFixed(3)),
        round: Number(round.toFixed(3)),
        card: Number(Math.max(0.1, Math.min(1, round / 3)).toFixed(3)),
        ending: Number(afterEnding.toFixed(3)),
        moreCard: Number(afterMore.toFixed(3)),
        flash,
      },
      rounds: n,
    };
  }

  return {
    structure: {
      opening: Number(adjustedOpening.toFixed(3)),
      round: Number(round.toFixed(3)),
      card: Number(Math.max(0.25, Math.min(1, round / 3)).toFixed(3)),
      ending: Number(ending.toFixed(3)),
      moreCard,
      flash,
    },
    rounds: n,
  };
}

function buildRounds(count, kind, style) {
  const [first, keyword, color] = KIND_COPY[kind] || KIND_COPY.promo;
  return Array.from({ length: count }, (_, i) => ({
    id: `r${String(i + 1).padStart(2, '0')}`,
    name: `${optionLabel(KIND_OPTIONS, kind)} / ${optionLabel(styleOptions, style)}`,
    card: {
      page: PAGE_CARD,
      layout: i % 4,
      index: i + 1,
      total: count,
      first,
      keyword,
      color,
    },
    style: {
      page: PAGE_SEGMENT,
      recipe: style,
      t0: [0.3, 0.5, 0, 0.3][i % 4],
      speed: [1.4, 1.45, 1, 1.3][i % 4],
    },
  }));
}

function buildSpec(s) {
  const fitted = fitStructure(s.duration);
  const { width, height } = sizeFor(s.aspect);
  const kindLabel = optionLabel(KIND_OPTIONS, s.kind);
  const styleLabel = optionLabel(styleOptions, s.style);
  const brand = String(s.brand || '').trim() || '{{BRAND}}';
  const cta = String(s.cta || '').trim() || KIND_CTA[s.kind] || '了解更多';
  // 用户显式选色优先；否则用 combos._meta.accentFix 的对比度安全值（spec-lint APCA >= 45）。
  const accentFix = combosDoc?._meta?.accentFix?.[s.theme];
  const accent =
    s.accent && HEX.test(s.accent)
      ? String(s.accent).toLowerCase()
      : accentFix
        ? { accent: accentFix.accent, accentInk: accentFix.accentInk }
        : null;
  const name = brand === '{{BRAND}}' ? `${kindLabel} · ${styleLabel}` : `${brand} · ${kindLabel}`;
  const preset = s.aspect === '9:16' ? 'douyin' : s.aspect === '1:1' ? 'square' : 'bilibili';

  return {
    specVersion: 1,
    meta: {
      name,
      brand,
      cta,
      locale: 'zh-CN',
      kind: s.kind,
      source: 'wizard',
      ...(s.reference ? { reference: s.reference } : {}),
      notes: [],
      defaults: [],
    },
    format: { width, height, fps: 30, aspect: s.aspect, duration: Number(s.duration) },
    look: {
      mode: 'showcase',
      style: s.style,
      theme: s.theme,
      accentOverride: accent,
      // v2.3：动效档位。s.motion 为 'auto' 时按 kind × style 推导。
      motion: s.motion && s.motion !== 'auto'
        ? s.motion
        : deriveMotionProfile({ kind: s.kind, style: s.style }),
      ...(s.reference?.density ? { density: s.reference.density } : {}),
    },
    audio: { mood: s.mood, bpm: MOOD_BPM[s.mood] || 120, vo: null },
    structure: fitted.structure,
    opening: { page: PAGE_SEGMENT, name: 'opening' },
    rounds: buildRounds(fitted.rounds, s.kind, s.style),
    moreCard: { page: PAGE_CARD, layout: 3, first: '还有', keyword: '更多？' },
    flash: { page: PAGE_CARD },
    ending: { page: PAGE_SEGMENT, name: 'ending' },
    assets: [],
    patches: [],
    render: { quality: 'master', preset, concurrency: 4, outDir: 'out' },
  };
}

// ── 渲染：预设卡 ───────────────────────────────────────────────────────────

function renderPresets() {
  const grid = $('#preset-grid');
  grid.replaceChildren();

  for (const p of presets) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-card';
    btn.dataset.preset = p.id;
    if (state.mode === 'preset' && state.presetId === p.id) btn.classList.add('active');

    const name = document.createElement('span');
    name.className = 'preset-name';
    name.textContent = p.name;

    const meta = document.createElement('span');
    meta.className = 'preset-meta';

    const t = themeMeta(p.theme);
    const swatchTag = document.createElement('span');
    swatchTag.className = 'tag swatch-tag';
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = `linear-gradient(135deg, ${t.bg} 0 52%, ${t.accent} 52% 100%)`;
    swatchTag.append(sw, document.createTextNode(t.name));
    meta.append(swatchTag);

    for (const text of [
      optionLabel(KIND_OPTIONS, p.kind),
      optionLabel(styleOptions, p.style),
      `${p.duration}s`,
      p.aspect,
    ]) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = text;
      meta.append(tag);
    }

    const desc = document.createElement('span');
    desc.className = 'preset-desc';
    desc.textContent = p.description || '';

    btn.append(name, meta, desc);
    btn.addEventListener('click', () => {
      applyPreset(p);
      renderPresets();
      renderCustom();
      generateNow();
    });
    grid.append(btn);
  }
}

// ── 渲染：七张卡 ───────────────────────────────────────────────────────────

function makeChip({ label, hint, value, selected, disabled, disabledReason, recommended, swatch, mode, onPick }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip';
  btn.dataset.value = value;
  btn.setAttribute('aria-pressed', selected ? 'true' : 'false');

  if (swatch) {
    const dot = document.createElement('span');
    dot.className = 'swatch';
    dot.style.background = swatch;
    btn.append(dot);
  }

  const text = document.createElement('span');
  text.textContent = label;
  btn.append(text);

  if (hint) {
    const h = document.createElement('span');
    h.className = 'chip-hint';
    h.textContent = hint;
    btn.append(h);
  }

  if (mode) {
    const m = document.createElement('span');
    m.className = 'theme-mode';
    m.textContent = mode;
    btn.append(m);
  }

  if (recommended && !disabled) {
    const r = document.createElement('span');
    r.className = 'rec-dot';
    r.title = '推荐组合';
    btn.append(r);
  }

  if (disabled) {
    btn.disabled = true;
    btn.classList.add('is-avoid');
    if (disabledReason) btn.title = disabledReason;
  }

  btn.addEventListener('click', () => {
    if (!btn.disabled) onPick(value);
  });
  return btn;
}

function fillGroup(selector, chips) {
  const host = $(selector);
  host.replaceChildren(...chips);
}

function renderCustom() {
  // 01 kind
  fillGroup(
    '#chips-kind',
    KIND_OPTIONS.map((o) =>
      makeChip({
        label: o.label,
        hint: o.hint,
        value: o.id,
        selected: state.kind === o.id,
        onPick: (v) => {
          state.kind = v;
          if (!ctaCustom) state.cta = KIND_CTA[v] || state.cta;
          setModeCustom();
          renderCustom();
          renderPresets();
          generateNow();
        },
      }),
    ),
  );

  // 02 style — avoid 组合不可选
  fillGroup(
    '#chips-style',
    styleOptions.map((o) => {
      const verdict = compat(state.theme, o.id);
      return makeChip({
        label: o.label,
        hint: o.hint,
        value: o.id,
        selected: state.style === o.id,
        disabled: verdict === 'avoid',
        disabledReason: `与「${themeMeta(state.theme).name}」不兼容（combos = avoid）`,
        recommended: verdict === 'recommended',
        onPick: (v) => {
          state.style = v;
          if (compat(state.theme, v) === 'avoid') {
            const next = styleOptions.find((s) => compat(state.theme, s.id) === 'recommended');
            if (next) state.style = next.id;
          }
          setModeCustom();
          renderCustom();
          renderPresets();
          generateNow();
        },
      });
    }),
  );

  // 03 theme — 13 个 id 来自 themes.js；矩阵缺行时不渲染（正常不会发生）
  const themeIds = (themesDoc?.THEME_IDS || Object.keys(combos)).filter((id) => combos[id]);
  fillGroup(
    '#chips-theme',
    themeIds.map((id) => {
      const t = themeMeta(id);
      const verdict = compat(id, state.style);
      return makeChip({
        label: t.name,
        mode: t.mode,
        value: id,
        selected: state.theme === id,
        swatch: `linear-gradient(135deg, ${t.bg} 0 52%, ${t.accent} 52% 100%)`,
        disabled: verdict === 'avoid',
        disabledReason: `与「${optionLabel(styleOptions, state.style)}」不兼容（combos = avoid）`,
        recommended: verdict === 'recommended',
        onPick: (v) => {
          state.theme = v;
          if (compat(v, state.style) === 'avoid') {
            const next = styleOptions.find((s) => compat(v, s.id) === 'recommended');
            if (next) state.style = next.id;
          }
          setModeCustom();
          renderCustom();
          renderPresets();
          generateNow();
        },
      });
    }),
  );

  // 04 duration + aspect
  fillGroup(
    '#chips-duration',
    DURATIONS.map((d) =>
      makeChip({
        label: `${d}s`,
        value: String(d),
        selected: Number(state.duration) === d,
        onPick: (v) => {
          state.duration = Number(v);
          setModeCustom();
          renderCustom();
          renderPresets();
          generateNow();
        },
      }),
    ),
  );
  fillGroup(
    '#chips-aspect',
    aspectOptions.map((o) =>
      makeChip({
        label: o.label,
        hint: o.hint,
        value: o.id,
        selected: state.aspect === o.id,
        onPick: (v) => {
          state.aspect = v;
          setModeCustom();
          renderCustom();
          renderPresets();
          generateNow();
        },
      }),
    ),
  );

  // 05 mood
  fillGroup(
    '#chips-mood',
    moodOptions.map((o) =>
      makeChip({
        label: o.label,
        hint: o.hint,
        value: o.id,
        selected: state.mood === o.id,
        onPick: (v) => {
          state.mood = v;
          setModeCustom();
          renderCustom();
          renderPresets();
          generateNow();
        },
      }),
    ),
  );

  // 07 CTA 快捷
  fillGroup(
    '#chips-cta',
    CTA_QUICK.map((c) =>
      makeChip({
        label: c,
        value: c,
        selected: state.cta === c,
        onPick: (v) => {
          state.cta = v;
          ctaCustom = true;
          setModeCustom();
          renderCustom();
          renderPresets();
          generateNow();
        },
      }),
    ),
  );

  // 表单回填
  const brandInput = $('#brand-input');
  brandInput.value = state.brand === '{{BRAND}}' ? '' : state.brand;

  const ctaInput = $('#cta-input');
  ctaInput.value = state.cta || '';

  const durationInput = $('#duration-input');
  durationInput.value = String(state.duration);

  const accentHex = $('#accent-hex');
  const fix = combosDoc?._meta?.accentFix?.[state.theme];
  accentHex.textContent = state.accent || (fix ? `主题安全值 ${fix.accent}` : '不指定');
  const shownAccent = state.accent && HEX.test(state.accent) ? state.accent : fix?.accent;
  if (shownAccent) $('#accent-input').value = shownAccent;
}

function setModeCustom() {
  state.mode = 'custom';
  state.presetId = null;
}

// ── 参考图（C1） ───────────────────────────────────────────────────────────

function setRefStatus(text, bad = false) {
  const el = $('#ref-status');
  if (!el) return;
  el.textContent = text;
  el.style.color = bad ? '#ff6b6b' : '';
}

function renderRefCandidates(result, activeId) {
  const box = $('#ref-candidates');
  if (!box) return;
  box.replaceChildren();
  for (const c of result.theme.candidates) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${c.id === activeId ? '✓ ' : ''}${themeMeta(c.id).name} · ${c.score}`;
    b.style.cssText = `padding:4px 10px;border-radius:999px;border:1px solid ${c.id === activeId ? '#d97757' : 'rgba(255,255,255,.25)'};background:transparent;color:${c.id === activeId ? '#d97757' : 'inherit'};cursor:pointer;font-size:12px`;
    b.addEventListener('click', () => applyReferenceResult(result, c.id));
    box.append(b);
  }
}

function renderRefPreview(bitmap) {
  const thumb = $('#ref-thumb');
  if (!thumb || !bitmap) return;
  const ctx = thumb.getContext('2d');
  ctx.clearRect(0, 0, thumb.width, thumb.height);
  const s = Math.max(thumb.width / bitmap.width, thumb.height / bitmap.height);
  const w = bitmap.width * s;
  const h = bitmap.height * s;
  ctx.drawImage(bitmap, (thumb.width - w) / 2, (thumb.height - h) / 2, w, h);
}

function applyReferenceResult(result, themeId) {
  const theme = themeId || result.theme.id;
  state.theme = theme;
  state.accent = result.theme.accentOverride?.accent || null;
  state.reference = {
    source: 'upload',
    theme,
    confidence: result.theme.confidence,
    candidates: result.theme.candidates,
    palette: result.palette.slice(0, 4),
    density: result.hints?.density || null,
  };
  setModeCustom();
  renderCustom();
  renderPresets();
  renderRefCandidates(result, theme);
  const meta = themeMeta(theme);
  setRefStatus(`识别：${meta.name}（置信度 ${result.theme.confidence.toFixed(2)}）${result.warning ? ' · 低置信，建议点候选换一个' : ''}`);
  generateNow();
}

async function applyReferenceFile(file) {
  if (!refApi) { setRefStatus('参考图模块未加载（请通过 serve.mjs 打开）', true); return null; }
  if (!file || !/^image\//.test(file.type || '')) { setRefStatus('请选择图片文件（JPG/PNG）', true); return null; }

  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch (e) { setRefStatus(`图片解码失败：${e.message || e}`, true); return null; }

  const size = refApi.REF_SAMPLE || 96;
  const off = document.createElement('canvas');
  off.width = size;
  off.height = size;
  const ctx = off.getContext('2d', { willReadFrequently: true });
  // 与 from-reference.mjs 的 ffmpeg `scale=96:96` 保持一致：整图拉伸采样，不裁切。
  ctx.drawImage(bitmap, 0, 0, size, size);

  let result;
  try {
    result = refApi.analyzeImageData(ctx.getImageData(0, 0, size, size), { k: 6 });
  } catch (e) {
    setRefStatus(`参考图分析失败：${e.message || e}`, true);
    return null;
  }
  lastRef = result;
  renderRefPreview(bitmap);
  applyReferenceResult(result);
  return result;
}

// ── 状态变更 ───────────────────────────────────────────────────────────────

function applyPreset(p) {
  state.mode = 'preset';
  state.presetId = p.id;
  state.kind = p.kind;
  state.style = p.style;
  state.theme = p.theme;
  state.duration = Number(p.duration);
  state.aspect = p.aspect;
  state.mood = p.mood;
  state.accent = null;
  state.reference = null;
  lastRef = null;
  const cand = $('#ref-candidates');
  if (cand) cand.replaceChildren();
  setRefStatus('拖入或点击选择一张参考图（JPG/PNG）。识别后可一键套用主题与主色。');
  if (!ctaCustom) state.cta = KIND_CTA[p.kind] || state.cta;
}

function scheduleGenerate(immediate = false) {
  if (generateTimer) clearTimeout(generateTimer);
  if (immediate) {
    generateNow();
    return;
  }
  generateTimer = setTimeout(generateNow, 120);
}

// ── 生成 + 校验 + 预览 ─────────────────────────────────────────────────────

function generateNow() {
  const raw = buildSpec(state);
  let spec = raw;
  let issues = [];

  if (specApi) {
    try {
      spec = specApi.normalizeSpec(raw);
      issues = specApi.validateSpec(spec);
    } catch (e) {
      issues = [{ level: 'error', code: 'E_NORMALIZE', path: 'spec', message: String(e.message || e) }];
    }
  } else {
    issues = [
      {
        level: 'error',
        code: 'E_VALIDATOR',
        path: 'spec',
        message: '校验器未加载：请用 node app/wizard/serve.mjs 打开本页（file:// 下无法导入 /templates/spec.mjs）',
      },
    ];
  }

  lastSpec = spec;
  lastIssues = issues;

  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');

  const json = $('#spec-json');
  json.textContent = JSON.stringify(spec, null, 2);

  const badge = $('#spec-badge');
  badge.textContent = specApi ? `spec v1 · ${spec.rounds.length} rounds` : 'spec v1 · 未校验';

  $('#summary').textContent =
    `${spec.meta.name} · ${spec.format.width}×${spec.format.height} · ${spec.format.duration}s · ` +
    `${spec.rounds.length} rounds · ${spec.look.theme} / ${spec.look.style}`;

  const status = $('#validation');
  status.classList.remove('ok', 'warn', 'bad');
  if (!specApi) {
    status.textContent = '✗ 校验器未加载，请通过 serve.mjs 打开';
    status.classList.add('bad');
  } else if (errors.length) {
    status.textContent = `✗ normalizeSpec + validateSpec：${errors.length} error · ${warns.length} warning`;
    status.classList.add('bad');
  } else if (warns.length) {
    status.textContent = `✓ normalizeSpec + validateSpec：0 error · ${warns.length} warning`;
    status.classList.add('warn');
  } else {
    status.textContent = '✓ normalizeSpec + validateSpec：0 error · 0 warning';
    status.classList.add('ok');
  }

  const list = $('#issues');
  list.replaceChildren(
    ...issues.slice(0, 8).map((i) => {
      const li = document.createElement('li');
      li.className = i.level;
      li.textContent = `[${i.level}] [${i.code}] ${i.path}: ${i.message}`;
      return li;
    }),
  );

  const blocked = !specApi || errors.length > 0;
  $('#download').disabled = blocked;
  $('#copy').disabled = blocked;
}

// ── 复制 / 下载 ────────────────────────────────────────────────────────────

function flashButton(btn, text) {
  const original = btn.dataset.label || btn.textContent;
  btn.dataset.label = original;
  btn.textContent = text;
  setTimeout(() => {
    btn.textContent = original;
    delete btn.dataset.label;
  }, 1400);
}

async function copySpec(btn) {
  if (!lastSpec) return;
  const text = JSON.stringify(lastSpec, null, 2);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  flashButton(btn, '已复制');
}

function downloadSpec() {
  if (!lastSpec) return;
  const blob = new Blob([JSON.stringify(lastSpec, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'project.spec.json';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── 启动 ───────────────────────────────────────────────────────────────────

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

function fatal(message) {
  const grid = document.querySelector('#preset-grid');
  if (grid) {
    grid.replaceChildren();
    const p = document.createElement('p');
    p.className = 'fatal';
    p.textContent = message;
    grid.append(p);
  }
  const status = document.querySelector('#validation');
  if (status) {
    status.textContent = `✗ ${message}`;
    status.classList.add('bad');
  }
}

function bindEvents() {
  const toggle = $('#custom-toggle');
  const panel = $('#custom-panel');
  toggle.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) renderCustom();
  });

  $('#brand-input').addEventListener('input', (e) => {
    state.brand = e.target.value.trim() || '{{BRAND}}';
    setModeCustom();
    renderPresets();
    scheduleGenerate();
  });

  $('#cta-input').addEventListener('input', (e) => {
    state.cta = e.target.value;
    ctaCustom = true;
    setModeCustom();
    renderPresets();
    scheduleGenerate();
  });

  $('#duration-input').addEventListener('change', (e) => {
    const n = Number(e.target.value);
    if (!Number.isFinite(n)) {
      e.target.value = String(state.duration);
      return;
    }
    state.duration = clamp(Math.round(n), 4, 600);
    setModeCustom();
    renderCustom();
    renderPresets();
    generateNow();
  });

  $('#accent-input').addEventListener('input', (e) => {
    state.accent = e.target.value;
    setModeCustom();
    renderPresets();
    scheduleGenerate();
  });

  $('#accent-clear').addEventListener('click', () => {
    state.accent = null;
    setModeCustom();
    renderCustom();
    renderPresets();
    generateNow();
  });

  $('#reset-preset').addEventListener('click', () => {
    if (!presets.length) return;
    ctaCustom = false;
    applyPreset(presets[0]);
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    renderPresets();
    renderCustom();
    generateNow();
    document.querySelector('#presets-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#copy').addEventListener('click', (e) => copySpec(e.currentTarget));
  $('#download').addEventListener('click', downloadSpec);

  const refDrop = $('#ref-drop');
  const refInput = $('#ref-input');
  if (refDrop && refInput) {
    refDrop.addEventListener('click', (e) => {
      if (e.target.closest('#ref-candidates')) return;
      refInput.click();
    });
    refInput.addEventListener('change', async () => {
      const f = refInput.files && refInput.files[0];
      if (f) await applyReferenceFile(f);
      refInput.value = '';
    });
    refDrop.addEventListener('dragover', (e) => {
      e.preventDefault();
      refDrop.style.borderColor = '#d97757';
    });
    refDrop.addEventListener('dragleave', () => {
      refDrop.style.borderColor = 'rgba(255,255,255,.22)';
    });
    refDrop.addEventListener('drop', async (e) => {
      e.preventDefault();
      refDrop.style.borderColor = 'rgba(255,255,255,.22)';
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) await applyReferenceFile(f);
    });
  }
}

async function boot() {
  const [specLoaded, themesLoaded, refLoaded, schemaLoaded, presetsLoaded, combosLoaded, motionLoaded] = await Promise.allSettled([
    import('/templates/spec.mjs'),
    import('/templates/themes.js'),
    import('/scripts/ref-core.mjs'),
    fetchJson('/schema/project.spec.schema.json'),
    fetchJson('/content/presets.json'),
    fetchJson('/content/combos.json'),
    import('/templates/motion-profile.mjs'),
  ]);

  if (specLoaded.status === 'fulfilled') specApi = specLoaded.value;
  if (themesLoaded.status === 'fulfilled') themesDoc = themesLoaded.value;
  if (refLoaded.status === 'fulfilled') refApi = refLoaded.value;
  if (schemaLoaded.status === 'fulfilled') schemaDoc = schemaLoaded.value;
  if (motionLoaded.status === 'fulfilled') motionApi = motionLoaded.value;

  if (presetsLoaded.status !== 'fulfilled' || combosLoaded.status !== 'fulfilled') {
    const why = [presetsLoaded, combosLoaded]
      .filter((r) => r.status === 'rejected')
      .map((r) => String(r.reason?.message || r.reason))
      .join(' · ');
    fatal(`加载 content/ 失败：${why}。请确认通过 node app/wizard/serve.mjs 打开仓库根目录。`);
    return;
  }

  presets = presetsLoaded.value.presets || [];
  combosDoc = combosLoaded.value;
  combos = combosDoc.combos || {};

  // 枚举以 schema 为准（缺失时用已知值兜底）
  const schemaEnums = (schemaDoc || {}).properties || {};
  const aspectIds = schemaEnums.format?.properties?.aspect?.enum || Object.keys(ASPECT_LABEL);
  const moodIds = schemaEnums.audio?.properties?.mood?.enum || Object.keys(MOOD_LABEL);

  aspectOptions = aspectIds.map((id) => ({ id, ...(ASPECT_LABEL[id] || { label: id, hint: '' }) }));
  moodOptions = moodIds.map((id) => ({ id, ...(MOOD_LABEL[id] || { label: id, hint: '' }) }));

  // 画风以 combos 的列为准（12 个），标签来自本地表
  const comboStyleIds = Object.keys(combos[Object.keys(combos)[0]] || {});
  if (comboStyleIds.length) {
    styleOptions = comboStyleIds.map((id) => {
      const found = STYLE_OPTIONS.find((s) => s.id === id);
      return found || { id, label: combosDoc?._meta?.styleNames?.[id] || id, hint: '' };
    });
  }

  if (!presets.length) {
    fatal('content/presets.json 里没有 presets 数组。');
    return;
  }

  bindEvents();
  ctaCustom = false;
  applyPreset(presets[0]);
  renderPresets();
  renderCustom();
  generateNow();

  // 自动化/调试钩子（不参与渲染）
  window.__wizard = {
    get state() {
      return { ...state };
    },
    get spec() {
      return lastSpec;
    },
    get issues() {
      return lastIssues;
    },
    get combos() {
      return combos;
    },
    get reference() {
      return lastRef;
    },
    applyReferenceDataUrl: async (url) => {
      const resp = await fetch(url);
      const blob = await resp.blob();
      return applyReferenceFile(blob);
    },
    applyReferenceTheme(id) {
      if (!lastRef) return false;
      applyReferenceResult(lastRef, id);
      return true;
    },
    generate: generateNow,
    applyPresetById(id) {
      const p = presets.find((x) => x.id === id);
      if (!p) return false;
      applyPreset(p);
      renderPresets();
      renderCustom();
      generateNow();
      return true;
    },
  };
}

boot().catch((e) => {
  console.error(e);
  fatal(`启动失败：${e.message || e}`);
});
