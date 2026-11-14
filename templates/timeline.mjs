#!/usr/bin/env node
/**
 * timeline.mjs — one declarative timeline → validated plan → render commands.
 *
 * The timeline JSON is the single source of truth for structure, durations,
 * frame counts, cue points and output paths. The renderer, audio QA and concat
 * step all read the generated plan instead of re-deriving the 8 + 11×4 + 1 + 2 + 6
 * formula in five different scripts (a class of bug Remotion/Editly solve with a
 * composition + render plan).
 *
 *   node templates/timeline.mjs --spec timeline.json \
 *        --out out/plan.json --concat out/segments.txt --print
 *
 *   node templates/timeline.mjs --spec timeline.json --check    # CI gate
 *
 * Segment mode is preserved: every style segment still renders through
 * render-segment.mjs with ?seg=1&t0=&speed=&dur= appended.
 *
 * Schema (all durations in seconds):
 * {
 *   "version": 1,
 *   "meta": { "title": "...", "brand": "{{BRAND}}", "theme": "coral-noir",
 *             "bpm": 120, "fps": 30, "width": 1920, "height": 1080,
 *             "outDir": "out" },
 *   "structure": { "opening": 8, "round": 4, "card": 1, "ending": 6,
 *                  "moreCard": 1, "flash": { "count": 8, "each": 0.25 } },
 *   "opening": { "page": "segments/00-opening.html" },
 *   "rounds": [{ "id": "r01", "name": "扁平插画科普",
 *                "card":  { "page": "segments/big-card.html", "layout": 0, "first": "想做", "keyword": "科普视频？", "color": "#ffcf5c" },
 *                "style": { "page": "segments/01.html", "t0": 0.35, "speed": 1.4 } }],
 *   "moreCard": { "page": "segments/big-card.html", "first": "还有", "keyword": "更多？" },
 *   "flash":    { "page": "segments/flash.html" },
 *   "ending":   { "page": "segments/99-ending.html" }
 * }
 */
import fs from 'node:fs';
import path from 'node:path';
import { shiftSegments } from './transitions.mjs';

const DEFAULT_STRUCTURE = {
  opening: 8,
  round: 4,
  card: 1,
  ending: 6,
  moreCard: 1,
  // R2-04（N08-F1）：旧默认 8×0.25s = 3.75Hz 全画面白闪，违反 WCAG 2.3.1
  // （>3 次/秒）。改 4×0.5s = 2Hz（120BPM 下一整拍），总时长仍 2s。
  flash: { count: 4, each: 0.5 },
};

// R2-25（N07-F2）：flash 间距默认由**拍**派生（一整拍 = 60/bpm），保证任意
// BPM 下闪段都落在拍网格上——旧版固定 0.25s 与 BPM 无关，90BPM 下 beat grid
// 崩到 31.4%。显式 structure.flash.each 优先（用户意图），否则取一整拍。
function resolveFlashEach(spec) {
  const explicit = spec.structure?.flash?.each;
  if (explicit != null && Number(explicit) > 0) return Number(explicit);
  const bpm = Number(spec.audio?.bpm) || 120;
  return 60 / bpm;
}
export { resolveFlashEach };

const DEFAULT_PAGES = {
  opening: 'segments/00-opening.html',
  card: 'segments/big-card.html',
  more: 'segments/big-card.html',
  flash: 'segments/flash.html',
  ending: 'segments/99-ending.html',
};

// ── helpers ─────────────────────────────────────────────────────────────────

export function query(page, params = {}) {
  const [p, q = ''] = String(page).split('?');
  const sp = new URLSearchParams(q);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `${p}?${s}` : p;
}

export function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base?.[k] ?? {}, v) : v;
  }
  return out;
}

const isHex = (v) => typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);

// ── validation ──────────────────────────────────────────────────────────────

/** Validate a timeline spec. Returns { errors, warnings }. */
export function validateComposition(spec) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (!spec || typeof spec !== 'object') return { errors: ['timeline must be a JSON object'], warnings };
  if (spec.version !== undefined && spec.version !== 1) warn(`unknown version ${spec.version}, assuming 1`);

  const meta = spec.meta || {};
  const fps = Number(meta.fps ?? 30);
  if (!Number.isFinite(fps) || fps <= 0 || fps > 120) err(`meta.fps must be 1..120, got ${meta.fps}`);
  if (fps % 1 !== 0) warn(`meta.fps=${fps} is not an integer; frame rounding will drift`);
  const bpm = Number(meta.bpm ?? 120);
  if (!Number.isFinite(bpm) || bpm <= 0) err(`meta.bpm must be > 0, got ${meta.bpm}`);
  if (bpm && ![60, 80, 90, 100, 110, 120, 128, 130, 140, 150, 160, 170, 174, 180].includes(bpm)) {
    warn(`bpm=${bpm} is unusual; beat cue math still works but check the edit table`);
  }

  const rounds = spec.rounds;
  if (!Array.isArray(rounds) || rounds.length === 0) err('rounds[] must be a non-empty array');
  else {
    rounds.forEach((r, i) => {
      const id = r.id || `r${String(i + 1).padStart(2, '0')}`;
      // round.id 会变成段文件名并进 concat 清单；与 spec 路径同规则（SAFE_ID_RE）。
      if (r.id !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(String(r.id))) {
        err(`rounds[${i}].id "${r.id}" must be a safe filename (letters/digits/dash/underscore, <=64 chars)`);
      }
      if (!r.style || !r.style.page) err(`rounds[${i}] (${id}) missing style.page`);
      if (!r.card) warn(`rounds[${i}] (${id}) has no card; a default card page will be used`);
      if (r.card && r.card.color && !isHex(r.card.color)) warn(`rounds[${i}].card.color "${r.card.color}" is not #rrggbb`);
      if (r.style && r.style.speed !== undefined && !(Number(r.style.speed) > 0)) err(`rounds[${i}].style.speed must be > 0`);
    });
    const ids = rounds.map((r, i) => r.id || `r${String(i + 1).padStart(2, '0')}`);
    if (new Set(ids).size !== ids.length) err('round ids must be unique');
    if (spec.structure?.styles !== undefined && spec.structure.styles !== rounds.length) {
      err(`structure.styles=${spec.structure.styles} but rounds.length=${rounds.length}`);
    }
  }

  const st = { ...DEFAULT_STRUCTURE, ...(spec.structure || {}), flash: { ...DEFAULT_STRUCTURE.flash, ...(spec.structure?.flash || {}) } };
  for (const k of ['opening', 'round', 'card', 'ending', 'moreCard']) {
    if (!(Number(st[k]) > 0)) err(`structure.${k} must be > 0, got ${st[k]}`);
  }
  if (!(Number(st.flash.count) >= 0)) err('structure.flash.count must be >= 0');
  if (!(Number(st.flash.each) > 0)) err('structure.flash.each must be > 0');
  if (Number(st.card) >= Number(st.round)) err('structure.card must be smaller than structure.round');

  if (rounds && Array.isArray(rounds)) {
    const total = totalDuration(spec);
    if (Math.abs(total - Math.round(total)) > 1e-9) warn(`total duration ${total}s is not an integer second`);
  }
  return { errors, warnings };
}

export function totalDuration(spec) {
  const st = { ...DEFAULT_STRUCTURE, ...(spec.structure || {}), flash: { ...DEFAULT_STRUCTURE.flash, ...(spec.structure?.flash || {}) } };
  const n = Array.isArray(spec.rounds) ? spec.rounds.length : Number(spec.structure?.styles ?? 0);
  return Number(st.opening) + n * Number(st.round) + Number(st.moreCard) + Number(st.flash.count) * resolveFlashEach(spec) + Number(st.ending);
}

// ── plan builder ────────────────────────────────────────────────────────────

/**
 * Build the render plan. Every segment gets integer frame boundaries so the
 * sum of segment frames equals the total frame count exactly (important when a
 * duration like 0.25 s is not an integer number of frames at 30 fps).
 */
export function buildPlan(spec, { root = process.cwd(), outDir } = {}) {
  const { errors } = validateComposition(spec);
  if (errors.length) throw new Error('invalid timeline:\n  - ' + errors.join('\n  - '));

  const meta = {
    title: 'untitled',
    brand: '{{BRAND}}',
    theme: '',
    bpm: 120,
    fps: 30,
    width: 1920,
    height: 1080,
    outDir: 'out',
    ...(spec.meta || {}),
  };
  meta.outDir = outDir || meta.outDir;
  const fps = Number(meta.fps);
  const bpm = Number(meta.bpm);
  const st = { ...DEFAULT_STRUCTURE, ...(spec.structure || {}), flash: { ...DEFAULT_STRUCTURE.flash, ...(spec.structure?.flash || {}) } };
  const rounds = spec.rounds || [];
  const themeParams = meta.theme ? { theme: meta.theme } : {};
  // 动效档位（v2.3）：与 theme 一样按页下发，页面自己按档位名展开参数。
  // 没写 motion 时不传 → 页面回退 standard → 与 v2.2 逐像素一致。
  const motionParams = meta.motion ? { mp: meta.motion } : {};
  // 强调色覆盖（品牌色 / accentFix）：theme 只给 id，页面拿不到 spec 里的覆盖值，
  // 所以把实际颜色一并下发。没覆盖时为空 → URL 不变。部分覆盖（只给 accentInk）也是合法的。
  const accentParams = meta.accent
    ? {
        ...(meta.accent.accent ? { accent: meta.accent.accent } : {}),
        ...(meta.accent.accentInk ? { accentInk: meta.accent.accentInk } : {}),
        ...(meta.accent.accentSoft ? { accentSoft: meta.accent.accentSoft } : {}),
      }
    : {};
  // v2.3.5：spec 路径下把内容参数下发到页面。timeline v1 没有 specMode，
  // 因此旧项目的段 URL 逐字符不变（golden 兼容）。
  const specMode = !!meta.specMode;
  const copyParams = specMode && meta.copyTitle ? { title: meta.copyTitle } : {};
  // 品牌视觉（v2.4 / P1-12）：meta.logo / meta.brandFont 由 specToTimeline 展开，
  // 页面只读 URL —— 与 theme/accent 同一条下发路径。
  const brandParams = specMode && meta.brand
    ? {
        brand: meta.brand,
        ...(meta.logo ? { logo: meta.logo } : {}),
        ...(meta.brandFont ? { brandFont: meta.brandFont } : {}),
      }
    : {};

  // 1) nominal segments in order
  const nominal = [];
  const opening = spec.opening || {};
  nominal.push({
    id: '00-opening', kind: 'opening', index: 0, label: opening.name || 'opening',
    page: query(opening.page || DEFAULT_PAGES.opening, {
      ...themeParams, ...motionParams, ...accentParams, ...copyParams, ...brandParams,
      ...(specMode && meta.copySub ? { sub: meta.copySub } : {}),
      ...(opening.capsule ? { capsule: opening.capsule } : {}),
    }),
    duration: Number(st.opening),
  });

  rounds.forEach((r, i) => {
    const idx = i + 1;
    const rid = r.id || `r${String(idx).padStart(2, '0')}`;
    const totalRounds = rounds.length;
    const card = r.card || {};
    const cardParams = {
      ...themeParams,
      ...motionParams,
      ...accentParams,
      layout: card.layout ?? i % 4,
      index: card.index ?? idx,
      total: card.total ?? totalRounds,
      first: card.first ?? '想做',
      keyword: card.keyword ?? r.name ?? '风格？',
      // R2-05：不再硬编 #ffcf5c 黄底——未指定 color 时省略该参数，让 big-card
      // 用主题 accent + inkFor 极性择色（旧默认黄底配浅色主题 accentInk = 白字白底）。
      ...(card.color ? { color: card.color } : {}),
      brand: meta.brand,
      seconds: Number(st.card),
      ...(card.params || {}),
    };
    nominal.push({
      id: `${rid}-card`, kind: 'card', index: idx, label: `${r.name || rid} · card`,
      page: query(card.page || DEFAULT_PAGES.card, cardParams),
      duration: Number(st.card),
      card: { ...cardParams },
    });

    const style = r.style || {};
    const styleCopy = style.copy || {};
    const styleTitle = String(styleCopy.title || style.name || r.name || '').trim();
    const styleSub = String(styleCopy.subtitle || '').trim();
    const styleCaption = String(styleCopy.caption || '').trim();
    nominal.push({
      id: `${rid}-style`, kind: 'style', index: idx, label: style.name || r.name || rid,
      page: query(style.page, {
        ...themeParams, ...motionParams, ...accentParams, ...brandParams,
        // 单段动效覆盖全局档位（style.motion），写错不再是静默无效。
        ...(style.motion ? { mp: style.motion } : {}),
        ...(specMode && styleTitle ? { title: styleTitle } : {}),
        ...(specMode && styleSub ? { sub: styleSub } : {}),
        ...(specMode && styleCaption ? { caption: styleCaption } : {}),
      }),
      duration: Number(st.round) - Number(st.card),
      t0: Number(style.t0 ?? 0),
      speed: Number(style.speed ?? 1),
      motion: style.motion || meta.motion || null,
      copy: styleCopy,
    });
  });

  const more = spec.moreCard || {};
  const totalRounds = rounds.length;
  nominal.push({
    id: '99-more', kind: 'more', index: totalRounds + 1, label: more.name || '还有更多?',
    page: query(more.page || DEFAULT_PAGES.more, {
      ...themeParams,
      ...motionParams,
      ...accentParams,
      layout: more.layout ?? (totalRounds + 1) % 4,
      index: totalRounds + 1,
      total: totalRounds + 1,
      first: more.first ?? '还有',
      keyword: more.keyword ?? '更多？',
      ...(more.color ? { color: more.color } : {}),
      brand: meta.brand,
      seconds: Number(st.moreCard),
    }),
    duration: Number(st.moreCard),
  });

  const flashCount = Number(st.flash.count);
  if (flashCount > 0) {
    const flash = spec.flash || {};
    const flashEach = resolveFlashEach(spec);
    const flashTotal = Number(st.flash.count) * flashEach;
    for (let i = 0; i < flashCount; i++) {
      nominal.push({
        id: `f${String(i + 1).padStart(2, '0')}`, kind: 'flash', index: i, label: `flash ${i + 1}/${flashCount}`,
        page: query(flash.page || DEFAULT_PAGES.flash, {
          ...themeParams,
          ...motionParams,
          ...accentParams,
          item: i,
          count: flashCount,
          ...(flash.params || {}),
        }),
        duration: flashEach,
        flashTotal,
      });
    }
  }

  const ending = spec.ending || {};
  nominal.push({
    id: '99-ending', kind: 'ending', index: nominal.length, label: ending.name || 'ending',
    page: query(ending.page || DEFAULT_PAGES.ending, {
      ...themeParams, ...motionParams, ...accentParams, ...copyParams, ...brandParams,
      // CTA 进结尾页（以前 meta.cta 只写进 spec，画面里没有）。
      ...(specMode && (meta.copyCta || meta.copySub) ? { sub: meta.copyCta || meta.copySub } : {}),
      ...(ending.capsule ? { capsule: ending.capsule } : {}),
    }),
    duration: Number(st.ending),
  });

  // 2) snap to integer frame boundaries
  const nominalTotal = nominal.reduce((s, x) => s + x.duration, 0);
  const baseTotalFrames = Math.round(nominalTotal * fps);
  let cursor = 0;
  let segments = nominal.map((s, i) => {
    const startFrame = Math.round(cursor * fps);
    cursor += s.duration;
    const endFrame = i === nominal.length - 1 ? baseTotalFrames : Math.round(cursor * fps);
    const frames = endFrame - startFrame;
    return {
      ...s,
      startFrame,
      endFrame,
      frames,
      start: startFrame / fps,
      end: endFrame / fps,
      duration: frames / fps,
      out: path.join(meta.outDir, `${s.id}.mp4`).replace(/\\/g, '/'),
    };
  });

  // 2.5) 转场（v2.5）：每段渲染时长不变，起点按 xfade 重叠平移。
  // 关闭时 shiftSegments 原样返回 → totalFrames/actualDuration/cue 与旧版逐字节一致。
  // 平移后的段起点同时是 concat 的 xfade offset（单一真值，见 transitions.mjs）。
  const transition = meta.transition || null;
  // xfade 要求每段都比转场长：否则该段被两侧重叠吃光，起点平移后非单调，
  // offset 出现 0/负值，成片塌缩成最后一段。这里在 plan 阶段就挡住（exit 10）。
  if (transition && segments.length >= 2) {
    const tf = Math.round(transition.duration * fps);
    const shortest = segments.reduce((m, s) => Math.min(m, s.frames), Infinity);
    // 亚帧转场（round(t*fps)=0）：shiftSegments 会原样返回，但 concat 仍收到
    // 非零 duration 的 xfade → 帧数失配。至少要有 1 帧重叠。
    if (tf < 1) {
      const e = new Error(
        `[E_TRANSITION_DURATION] render.transition: transition ${transition.duration}s rounds to 0 frames ` +
        `at ${fps}fps; use at least ${(1 / fps).toFixed(4)}s (1 frame)`,
      );
      e.code = 'E_TRANSITION_DURATION';
      throw e;
    }
    if (tf >= shortest) {
      const e = new Error(
        `[E_TRANSITION_DURATION] render.transition: transition ${transition.duration}s (${tf}f) must be shorter ` +
        `than the shortest segment (${shortest}f = ${(shortest / fps).toFixed(3)}s); reduce transitionDuration or lengthen segments`,
      );
      e.code = 'E_TRANSITION_DURATION';
      throw e;
    }
  }
  segments = shiftSegments(segments, fps, transition);
  const totalFrames = segments.length ? segments[segments.length - 1].endFrame : baseTotalFrames;
  const actualDuration = totalFrames / fps;

  // 3) render CLI args (relative --page; renderer appends seg/t0/speed/dur)
  for (const s of segments) {
    const a = ['--page', s.page, '--out', s.out, '--duration', String(s.duration), '--fps', String(fps)];
    if (s.kind === 'style') a.push('--t0', String(s.t0), '--speed', String(s.speed));
    s.renderArgs = a;
  }

  // 4) cues: segment starts + card second beat + style downbeat
  const beat = 60 / bpm;
  const cues = [];
  for (const s of segments) {
    cues.push({ t: s.start, frame: s.startFrame, beat: s.start / beat, kind: s.kind, id: s.id, label: `start:${s.id}` });
    if (s.kind === 'card') {
      cues.push({ t: s.start + beat, frame: Math.round((s.start + beat) * fps), beat: s.start / beat + 1, kind: 'card-keyword', id: s.id, label: `keyword:${s.id}` });
    }
    if (s.kind === 'style') {
      cues.push({ t: s.start + beat, frame: Math.round((s.start + beat) * fps), beat: s.start / beat + 1, kind: 'style-beat2', id: s.id, label: `beat2:${s.id}` });
    }
  }

  const plan = {
    version: 1,
    generatedBy: 'templates/timeline.mjs',
    meta: { ...meta, root: path.resolve(root) },
    structure: { ...st, styles: rounds.length },
    stats: {
      nominalDuration: nominalTotal,
      duration: actualDuration,
      frames: totalFrames,
      fps,
      segments: segments.length,
      beats: actualDuration / beat,
      bars: actualDuration / (4 * beat),
    },
    // R2-25：subdiv 声明合成床的拍细分——synth 每半拍铺 hat，音乐网格是 1/2 拍。
    // qa-audio 优先用此声明值锚定拍网格（比从画面 cue 间距推断更准，任意 BPM 一致）。
    audio: { bpm, beat, bar: 4 * beat, subdiv: 2, cues },
    segments,
  };

  return plan;
}

/**
 * concat-demuxer 文本。
 *
 * 默认写绝对路径（便于任意 cwd 手动调试）；`baseDir` 指定时改写为相对该目录的
 * 安全路径，配合 `ffmpeg -f concat -safe 1` 使用：没有绝对路径、没有 `..`、
 * 没有盘符/UNC，清单里的一行无法把 ffmpeg 引到项目外。
 */
export function concatList(plan, { absolute = true, baseDir = null } = {}) {
  const root = plan.meta.root;
  return plan.segments.map((s) => {
    if (baseDir) {
      const abs = path.resolve(root, s.out);
      let rel = path.relative(path.resolve(baseDir), abs);
      if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
        throw new Error(`concatList: segment ${s.id} is outside baseDir (${abs})`);
      }
      rel = rel.split(path.sep).join('/');
      if (rel.includes("'") || rel.includes('\n') || rel.includes('\r') || /^[A-Za-z]:/.test(rel)) {
        throw new Error(`concatList: unsafe segment path for concat: ${rel}`);
      }
      return `file '${rel}'`;
    }
    const f = absolute ? path.resolve(root, s.out).replace(/\\/g, '/') : s.out;
    // 绝对模式也要挡换行：否则 s.out 里的 \n 会往 concat 清单注入额外行。
    if (/[\n\r]/.test(f)) throw new Error(`concatList: segment path contains a newline: ${s.id}`);
    return `file '${f.replace(/'/g, "'\\''")}'`;
  }).join('\n') + '\n';
}

/** Human-readable plan table. */
export function formatPlan(plan) {
  const rows = plan.segments.map((s) => [
    s.id.padEnd(12),
    s.kind.padEnd(8),
    `${s.start.toFixed(3)}-${s.end.toFixed(3)}`.padEnd(15),
    String(s.frames).padStart(5),
    s.kind === 'style' ? `t0=${s.t0} ×${s.speed}` : '',
    s.page,
  ].join('  '));
  const st = plan.stats;
  return [
    `title   ${plan.meta.title}   theme=${plan.meta.theme || '(default)'}   ${st.fps}fps  ${pllan(plan)}`,
    `length  ${st.duration.toFixed(3)}s = ${st.frames} frames = ${st.beats.toFixed(1)} beats @ ${plan.audio.bpm} BPM`,
    `segs    ${st.segments}`,
    '─'.repeat(100),
    ...rows,
  ].join('\n');
}
const pllan = (plan) => `${plan.meta.width}×${plan.meta.height}`;

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) a[k.slice(2)] = true;
    else { a[k.slice(2)] = next; i++; }
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.spec) {
    console.log(`Usage: node templates/timeline.mjs --spec <timeline.json> [options]
  --out <plan.json>      write the render plan (default: <outDir>/plan.json)
  --concat <list.txt>    write the ffmpeg concat list (default: <outDir>/segments.txt)
  --root <dir>           project root used to resolve pages/outputs (default: spec dir or cwd)
  --outdir <dir>         override meta.outDir
  --check                validate only; exit 1 on errors
  --print                print the segment table
  --json                 print the plan JSON to stdout`);
    process.exit(args.help ? 0 : 1);
  }

  const specPath = path.resolve(String(args.spec));
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const root = path.resolve(String(args.root || spec.meta?.root || process.cwd()));
  const outDir = args.outdir ? String(args.outdir) : spec.meta?.outDir;

  if (args.check) {
    const { errors, warnings } = validateComposition(spec);
    for (const w of warnings) console.log(`[warn] ${w}`);
    for (const e of errors) console.error(`[error] ${e}`);
    if (errors.length) process.exit(1);
    const total = totalDuration(spec);
    console.log(`✓ timeline valid: ${spec.rounds.length} rounds, ${total}s @ ${spec.meta?.fps ?? 30}fps`);
    return;
  }

  let plan;
  try {
    plan = buildPlan(spec, { root, outDir });
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(1);
  }
  for (const w of validateComposition(spec).warnings) console.error(`[warn] ${w}`);

  const planPath = path.resolve(String(args.out || path.join(root, plan.meta.outDir, 'plan.json')));
  const concatPath = path.resolve(String(args.concat || path.join(root, plan.meta.outDir, 'segments.txt')));
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.mkdirSync(path.dirname(concatPath), { recursive: true });
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
  fs.writeFileSync(concatPath, concatList(plan));

  if (args.print) console.log(formatPlan(plan));
  if (args.json) console.log(JSON.stringify(plan, null, 2));
  console.log(`[plan]  ${planPath}`);
  console.log(`[concat] ${concatPath}`);
  console.log(`[stats] ${plan.stats.duration.toFixed(3)}s / ${plan.stats.frames} frames / ${plan.stats.segments} segments`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('timeline.mjs')) {
  main().catch((e) => { console.error('[fatal]', e.stack || e); process.exit(1); });
}
