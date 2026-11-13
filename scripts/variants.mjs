#!/usr/bin/env node
/**
 * variants.mjs — C4-04 变体矩阵：文案 × 主题 × 画幅的笛卡尔积。
 *
 * 产物：
 *   out/variants/<id>/project.spec.json   每个变体一份合法 spec
 *   out/variants/manifest.json             id / 轴取值 / specPath / outDir / specHash
 *
 * id 是变体 spec 内容 sha256 的前 10 位（内容相同才可能撞；撞了加 -2 保证唯一）。
 * 画幅轴变化时走 templates/reflow.mjs 的 spec 级重排，不做裁切。
 *
 * CLI:
 *   node scripts/variants.mjs --spec <spec> --axes <axes.json> --out out/variants [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeSpec } from '../templates/spec.mjs';
import { reflowSpec, SUPPORTED_ASPECTS } from '../templates/reflow.mjs';

export const DEFAULT_OUT = 'out/variants';

const COPY_AXES = new Set(['first', 'copy', 'cards', 'card']);
const MOODS = ['electronic', 'restrained', 'epic', 'upbeat', 'guofeng'];
const MODES = ['showcase', 'single'];
const PRESETS = ['bilibili', 'douyin', 'youtube', 'wechat', 'master', 'square'];
const SUPPORTED_AXES = [
  'aspect', 'bpm', 'brand', 'card', 'cards', 'copy', 'cta', 'first',
  'mode', 'mood', 'name', 'preset', 'style', 'theme',
];

// ── 稳定序列化 / 哈希 ──────────────────────────────────────────────────────

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stableValue(value[key]);
    return out;
  }
  return value;
}

/** 键排序后的 JSON：同一对象不同键序得到同一字符串。 */
export function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

/** 变体 spec 的内容哈希（sha256，64 位十六进制）。非枚举元数据不参与。 */
export function specHashOf(spec) {
  // 变体身份只由内容决定：render.outDir 是「写到哪」，不是「是什么」。
  // 每个变体现在有自己的 outDir（防止互相覆盖），不能让它污染 specHash。
  const content = clone(spec);
  if (content && content.render) delete content.render.outDir;
  return crypto.createHash('sha256').update(canonicalJson(content)).digest('hex');
}

// ── 轴值解析 ────────────────────────────────────────────────────────────────

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function parseCopyValue(value, axisName) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`axis "${axisName}" copy value must be a string pair or a list of pairs`);
  }
  if (Array.isArray(value[0])) {
    const pairs = value.map((pair, i) => {
      if (!Array.isArray(pair) || pair.length < 1 || pair.length > 2) {
        throw new Error(`axis "${axisName}" pair[${i}] must be [first, keyword]`);
      }
      const first = pair[0];
      const keyword = pair.length > 1 ? pair[1] : pair[0];
      if (typeof first !== 'string' || typeof keyword !== 'string') {
        throw new Error(`axis "${axisName}" pair[${i}] must contain strings`);
      }
      return [first, keyword];
    });
    return { pairs, rotate: pairs.length > 1 };
  }
  if (value.length > 2 || typeof value[0] !== 'string') {
    throw new Error(`axis "${axisName}" must be ["first", "keyword"] or [[...], [...]]`);
  }
  const first = value[0];
  const keyword = value.length > 1 ? value[1] : value[0];
  if (typeof keyword !== 'string') throw new Error(`axis "${axisName}" keyword must be a string`);
  return { pairs: [[first, keyword]], rotate: false };
}

function applyCopy(spec, parsed) {
  const rounds = Array.isArray(spec.rounds) ? spec.rounds : [];
  rounds.forEach((round, i) => {
    const pair = parsed.pairs[parsed.rotate ? i % parsed.pairs.length : 0];
    round.card = { ...(round.card || {}), first: pair[0], keyword: pair[1] };
  });
  // 片头/结尾读 meta.title：copy 轴必须同时改它，否则 A/B 两版片头一模一样。
  if (!spec.meta) spec.meta = {};
  const firstPair = parsed.pairs[0];
  spec.meta.title = String(firstPair[1] || firstPair[0]).slice(0, 24);
}

function applyAspect(spec, value) {
  if (typeof value !== 'string' || !SUPPORTED_ASPECTS.includes(value.trim())) {
    throw new Error(`axis "aspect" values must be one of ${SUPPORTED_ASPECTS.join(', ')}; got ${JSON.stringify(value)}`);
  }
  const target = value.trim();
  return target === spec.format.aspect ? spec : reflowSpec(spec, target);
}

function asNonEmptyString(value, axisName) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`axis "${axisName}" values must be non-empty strings`);
  return value;
}

const APPLIERS = {
  theme: (spec, value) => { spec.look.theme = asNonEmptyString(value, 'theme'); },
  style: (spec, value) => { spec.look.style = value === null ? null : asNonEmptyString(value, 'style'); },
  mode: (spec, value) => {
    if (!MODES.includes(value)) throw new Error(`axis "mode" values must be one of ${MODES.join(', ')}`);
    spec.look.mode = value;
  },
  mood: (spec, value) => {
    if (!MOODS.includes(value)) throw new Error(`axis "mood" values must be one of ${MOODS.join(', ')}`);
    spec.audio.mood = value;
  },
  bpm: (spec, value) => {
    const bpm = Number(value);
    if (!(bpm > 0)) throw new Error(`axis "bpm" values must be > 0; got ${JSON.stringify(value)}`);
    spec.audio.bpm = bpm;
  },
  preset: (spec, value) => {
    if (!PRESETS.includes(value)) throw new Error(`axis "preset" values must be one of ${PRESETS.join(', ')}`);
    spec.render.preset = value;
  },
  cta: (spec, value) => { spec.meta.cta = String(value); },
  brand: (spec, value) => { spec.meta.brand = asNonEmptyString(value, 'brand'); },
  name: (spec, value) => { spec.meta.name = asNonEmptyString(value, 'name'); },
};

// ── 展开 ────────────────────────────────────────────────────────────────────

function axisNames(axes) {
  if (!axes || typeof axes !== 'object' || Array.isArray(axes)) throw new Error('axes must be an object');
  const names = Object.keys(axes).sort();
  if (!names.length) throw new Error('axes must define at least one axis');
  for (const name of names) {
    if (!SUPPORTED_AXES.includes(name)) {
      throw new Error(`unsupported axis "${name}"; supported: ${SUPPORTED_AXES.join(', ')}`);
    }
    const values = axes[name];
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(`axis "${name}" must be a non-empty array of values`);
    }
  }
  return names;
}

function product(names, axes) {
  const combos = [];
  const walk = (i, acc) => {
    if (i === names.length) { combos.push({ ...acc }); return; }
    const name = names[i];
    for (const value of axes[name]) walk(i + 1, { ...acc, [name]: value });
  };
  walk(0, {});
  return combos;
}

/**
 * 笛卡尔积展开成变体 spec 数组。
 *
 * 轴：
 *   first / copy / cards / card  文案：["first","keyword"] 应用到所有轮；
 *                                [["a","A"],["b","B"]] 按轮次轮换；
 *   theme / style / mode          look.*
 *   mood / bpm                    audio.*
 *   cta / brand / name            meta.*
 *   preset                        render.preset
 *   aspect                        16:9 / 9:16 / 1:1；变化时 reflowSpec 重排
 *
 * 返回的每个 spec 额外带非枚举元数据（不写进 JSON）：
 *   v.id, v.axes, v.outDir, v.specPath, v.specHash, v._variant
 *
 * @param {object} input spec v1
 * @param {object} axes
 * @param {{outDir?:string}} [opts]
 */
export function expandVariants(input, axes, opts = {}) {
  const names = axisNames(axes);
  const baseOut = String(opts.outDir || DEFAULT_OUT).replace(/\\/g, '/').replace(/\/+$/, '');
  const base = normalizeSpec(input);
  const combos = product(names, axes);
  const variants = [];
  const used = new Set();
  const warnings = [];

  for (const assignment of combos) {
    let spec = normalizeSpec(base);
    for (const name of names) {
      const value = assignment[name];
      if (COPY_AXES.has(name)) applyCopy(spec, parseCopyValue(value, name));
      else if (name === 'aspect') spec = applyAspect(spec, value);
      else APPLIERS[name](spec, value);
      if (name === 'theme' && spec.look?.accentOverride) {
        warnings.push({
          code: 'W_AXIS_ACCENT_CONFLICT',
          message: 'theme axis changes the theme, but look.accentOverride still overrides the accent colour — clear it if the theme accent should win',
        });
      }
    }
    spec = normalizeSpec(spec);

    // 段哈希只反映内容，不反映输出路径——先算 hash，再写 outDir。
    const specHash = specHashOf(spec);
    let id = specHash.slice(0, 10);
    let n = 2;
    while (used.has(id)) id = `${specHash.slice(0, 10)}-${n++}`;
    used.add(id);

    const outDir = `${baseOut}/${id}`;
    const specPath = `${outDir}/project.spec.json`;
    // v2.3.5：每个变体有自己的输出目录。以前所有变体共用 spec.render.outDir，
    // 后一条 build 会覆盖前一条的 master.mp4（发错片的硬伤）。
    spec.render = { ...(spec.render || {}), outDir };
    const axisValues = {};
    for (const name of names) axisValues[name] = clone(assignment[name]);

    Object.defineProperty(spec, 'id', { value: id, enumerable: false, configurable: true });
    Object.defineProperty(spec, 'axes', { value: axisValues, enumerable: false, configurable: true });
    Object.defineProperty(spec, 'outDir', { value: outDir, enumerable: false, configurable: true });
    Object.defineProperty(spec, 'specPath', { value: specPath, enumerable: false, configurable: true });
    Object.defineProperty(spec, 'specHash', { value: specHash, enumerable: false, configurable: true });
    Object.defineProperty(spec, '_variant', {
      value: { id, axes: clone(axisValues), outDir, specPath, specHash },
      enumerable: false,
      configurable: true,
    });

    variants.push(spec);
  }
  Object.defineProperty(variants, 'warnings', { value: warnings, enumerable: false });
  return variants;
}

// ── manifest ────────────────────────────────────────────────────────────────

function rowFrom(entry, index) {
  const meta = entry && entry._variant;
  if (meta) {
    return {
      id: meta.id,
      axes: clone(meta.axes),
      specPath: meta.specPath,
      outDir: meta.outDir,
      specHash: meta.specHash,
    };
  }
  // 也接受普通记录 {id, axes, specPath, outDir, specHash, spec?}
  const spec = entry && entry.spec;
  const specHash = entry && entry.specHash ? entry.specHash : spec ? specHashOf(spec) : null;
  const id = entry && entry.id ? entry.id : specHash ? specHash.slice(0, 10) : null;
  if (!id || !specHash) throw new Error(`writeManifest: entry ${index} has neither _variant nor id/specHash`);
  return {
    id,
    axes: clone(entry.axes || {}),
    specPath: entry.specPath || `${DEFAULT_OUT}/${id}/project.spec.json`,
    outDir: entry.outDir || `${DEFAULT_OUT}/${id}`,
    specHash,
  };
}

/**
 * 写 manifest.json。返回写出的对象。
 * @param {object[]} variants expandVariants 的返回（或 {id,axes,specPath,outDir,specHash} 记录）
 */
export function writeManifest(variants, outPath) {
  if (!Array.isArray(variants)) throw new Error('writeManifest(variants, outPath): variants must be an array');
  const rows = variants.map(rowFrom);
  const manifest = {
    version: 1,
    generatedBy: 'scripts/variants.mjs',
    count: rows.length,
    variants: rows,
  };
  const abs = path.resolve(String(outPath));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else { flags[key] = next; i++; }
  }
  return { flags, positional };
}

function formatAxisValue(value) {
  if (Array.isArray(value)) {
    if (value.some((v) => Array.isArray(v))) {
      return value.map((v) => (Array.isArray(v) ? v.join('/') : String(v))).join('|');
    }
    return value.join('/');
  }
  return String(value);
}

function usage() {
  console.log(`Usage: node scripts/variants.mjs --spec <spec> --axes <axes.json> [options]

  --out <dir>        variant base directory, default ${DEFAULT_OUT}
  --manifest <file>  default <out>/manifest.json
  --dry-run          print count + matrix, write nothing
  --json             print the generated manifest to stdout
  --help             this text`);
}

function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  if (flags.help || !flags.spec || !flags.axes) { usage(); process.exit(flags.help ? 0 : 1); }

  const specPath = path.resolve(String(flags.spec));
  const axesPath = path.resolve(String(flags.axes));
  let spec;
  let axes;
  try {
    spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    axes = JSON.parse(fs.readFileSync(axesPath, 'utf8'));
  } catch (e) {
    console.error(`[fatal] cannot read spec/axes: ${e.message}`);
    process.exit(1);
  }

  const outBase = String(flags.out || DEFAULT_OUT).replace(/\\/g, '/').replace(/\/+$/, '');
  const dryRun = !!flags['dry-run'];
  let variants;
  try {
    variants = expandVariants(spec, axes, { outDir: outBase });
  } catch (e) {
    console.error(`[fatal] ${e.message}`);
    process.exit(1);
  }

  const normalized = normalizeSpec(spec);
  console.log(`[variants] base: ${normalized.meta.name} · ${normalized.format.width}x${normalized.format.height} · ${normalized.format.duration}s · ${normalized.rounds.length} rounds · ${normalized.look.theme}`);
  for (const w of variants.warnings || []) console.warn(`[warn] [${w.code}] ${w.message}`);
  for (const name of Object.keys(axes).sort()) {
    console.log(`[axes] ${name} (${axes[name].length}): ${axes[name].map(formatAxisValue).join(', ')}`);
  }

  if (dryRun) {
    console.log(`[matrix] ${variants.length} variants`);
    variants.forEach((v, i) => {
      const axisText = Object.keys(v.axes).sort().map((k) => `${k}=${formatAxisValue(v.axes[k])}`).join('  ');
      console.log(`  ${String(i + 1).padStart(3)}. ${axisText}  -> ${v.specPath}`);
    });
    console.log(`[dry-run] 0 files written (would write ${variants.length} specs + manifest under ${outBase})`);
    return;
  }

  const manifestPath = flags.manifest ? path.resolve(String(flags.manifest)) : path.resolve(outBase, 'manifest.json');
  for (const v of variants) {
    const dir = path.resolve(v.outDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'project.spec.json'), `${JSON.stringify(v, null, 2)}\n`);
  }
  const manifest = writeManifest(variants, manifestPath);
  if (flags.json) console.log(JSON.stringify(manifest, null, 2));
  console.log(`✓ ${variants.length} variants written to ${outBase}`);
  console.log(`[manifest] ${manifestPath}`);
}

const invokedDirectly = process.argv[1] && path.basename(process.argv[1]) === 'variants.mjs';
if (invokedDirectly) {
  try { main(); } catch (e) { console.error('[fatal]', e.stack || e); process.exit(1); }
}
