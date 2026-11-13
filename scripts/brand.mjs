#!/usr/bin/env node
/**
 * brand.mjs — 品牌包（brand kit）的加载、合入与检查。
 *
 * 设计原则：
 *   1. 品牌包只描述「品牌」：强调色、logo、字体、口吻。它不改 format/structure/rounds，
 *      所以同一份 spec 可以换品牌重出片。
 *   2. 颜色不重复造轮子：accentOverride 复用 templates/themes.js，保证与
 *      spec-lint / 渲染端算出的 override 逐值一致。
 *   3. 校验用 content/brand.schema.json 本身驱动（轻量 JSON Schema 子集），
 *      schema 是唯一真相，代码里不再维护第二份字段表。
 *   4. 纯函数 + 显式 root：applyBrand 不写盘、不改入参；CLI 才碰文件系统。
 *
 * 用法：
 *   node scripts/brand.mjs apply --spec <in.spec.json> --brand content/brands/tech-dark.json --out <out.spec.json>
 *   node scripts/brand.mjs check --spec <in.spec.json> --brand content/brands/tech-dark.json [--json]
 *   node scripts/brand.mjs list
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES, THEME_LIST, accentOverride } from '../templates/themes.js';
import { apcaLc } from '../templates/color.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 仓库根：content/、fixtures/、assets/ 的相对路径都以它为基准。 */
export const ROOT = path.resolve(HERE, '..');
const SCHEMA_PATH = path.join(ROOT, 'content', 'brand.schema.json');

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const isHex = (v) => typeof v === 'string' && HEX.test(v);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const deepClone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const round1 = (n) => Math.round(n * 10) / 10;

/* ────────────────────────────────────────────────────────────────────────────
 * 轻量 JSON Schema 校验（draft-07 子集，够 brand.schema.json 用）
 * ──────────────────────────────────────────────────────────────────────────── */

function typeName(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function matchesType(value, type) {
  switch (type) {
    case 'object': return isPlainObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return true;
  }
}

function joinPath(at, key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${at}.${key}` : `${at}[${JSON.stringify(key)}]`;
}

function validateNode(value, schema, rootSchema, at, errors) {
  if (schema === true || schema == null) return;
  if (schema === false) { errors.push(`${at}: no value is allowed here`); return; }
  if (typeof schema !== 'object') return;

  if (schema.$ref) {
    if (!String(schema.$ref).startsWith('#/')) {
      errors.push(`${at}: unsupported $ref "${schema.$ref}"`);
      return;
    }
    const target = schema.$ref.slice(2).split('/').reduce((o, k) => (o == null ? o : o[k]), rootSchema);
    if (target === undefined) {
      errors.push(`${at}: unresolved $ref "${schema.$ref}"`);
      return;
    }
    validateNode(value, target, rootSchema, at, errors);
    return;
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${at}: expected ${types.join(' | ')}, got ${typeName(value)}`);
      return; // 类型不对时后续约束没有意义
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${at}: must equal ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((v) => v === value)) {
    errors.push(`${at}: must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}; got ${JSON.stringify(value)}`);
  }

  if (typeof value === 'string') {
    const len = [...value].length;
    if (schema.minLength !== undefined && len < schema.minLength) errors.push(`${at}: must be at least ${schema.minLength} character(s)`);
    if (schema.maxLength !== undefined && len > schema.maxLength) errors.push(`${at}: must be at most ${schema.maxLength} character(s)`);
    if (schema.pattern !== undefined) {
      let re = null;
      try { re = new RegExp(schema.pattern); } catch { errors.push(`${at}: schema pattern is invalid: ${schema.pattern}`); }
      if (re && !re.test(value)) errors.push(`${at}: ${JSON.stringify(value)} does not match /${schema.pattern}/`);
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: must be >= ${schema.minimum}, got ${value}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: must be <= ${schema.maximum}, got ${value}`);
    if (schema.exclusiveMinimum !== undefined && !(value > schema.exclusiveMinimum)) errors.push(`${at}: must be > ${schema.exclusiveMinimum}, got ${value}`);
    if (schema.exclusiveMaximum !== undefined && !(value < schema.exclusiveMaximum)) errors.push(`${at}: must be < ${schema.exclusiveMaximum}, got ${value}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at}: must have at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at}: must have at most ${schema.maxItems} item(s)`);
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) errors.push(`${at}: duplicate item ${key}`);
        else seen.add(key);
      }
    }
    if (schema.items !== undefined) {
      value.forEach((item, i) => validateNode(item, schema.items, rootSchema, `${at}[${i}]`, errors));
    }
  }

  if (isPlainObject(value)) {
    const props = isPlainObject(schema.properties) ? schema.properties : {};
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${joinPath(at, key)}: required property is missing`);
    }
    for (const [key, sub] of Object.entries(props)) {
      if (key in value) validateNode(value[key], sub, rootSchema, joinPath(at, key), errors);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) errors.push(`${joinPath(at, key)}: unexpected property`);
      }
    } else if (isPlainObject(schema.additionalProperties)) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) validateNode(value[key], schema.additionalProperties, rootSchema, joinPath(at, key), errors);
      }
    }
  }
}

let _schema = null;
function loadSchema() {
  if (_schema) return _schema;
  let text;
  try {
    text = fs.readFileSync(SCHEMA_PATH, 'utf8');
  } catch (e) {
    throw new Error(`[brand] cannot read brand schema ${SCHEMA_PATH}: ${e.message}`);
  }
  try {
    _schema = JSON.parse(text);
  } catch (e) {
    throw new Error(`[brand] brand schema is not valid JSON (${SCHEMA_PATH}): ${e.message}`);
  }
  return _schema;
}

/* ────────────────────────────────────────────────────────────────────────────
 * loadBrand
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 读取并校验一个品牌包。非法时抛 Error，message 里逐条列出字段路径。
 * @param {string} file
 * @returns {object} 校验通过的品牌包（深拷贝）
 */
export function loadBrand(file) {
  if (!file) throw new Error('[brand] loadBrand: brand file path is required');
  const abs = path.resolve(String(file));
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    throw new Error(`[brand] cannot read brand kit ${abs}: ${e.message}`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`[brand] brand kit is not valid JSON (${abs}): ${e.message}`);
  }

  const schema = loadSchema();
  const errors = [];
  validateNode(raw, schema, schema, '$', errors);
  if (errors.length) {
    const err = new Error(`[brand] invalid brand kit ${abs}:\n  - ${errors.join('\n  - ')}`);
    err.code = 'E_BRAND_SCHEMA';
    err.issues = errors;
    throw err;
  }
  return deepClone(raw);
}

/** content/brands/*.json 的 id/name 列表；单个文件非法时标记但不中断。 */
export function listBrands({ root = ROOT } = {}) {
  const dir = path.join(root, 'content', 'brands');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch (e) {
    throw new Error(`[brand] cannot read ${dir}: ${e.message}`);
  }
  return files.map((file) => {
    const abs = path.join(dir, file);
    try {
      const brand = loadBrand(abs);
      return { file, path: abs, id: brand.id, name: brand.name, valid: true };
    } catch (e) {
      return { file, path: abs, id: null, name: null, valid: false, error: e.message };
    }
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * applyBrand
 * ──────────────────────────────────────────────────────────────────────────── */

/** 主题 id/别名 → 主题对象；未知返回 null（不回退默认主题，避免静默换皮）。 */
export function resolveTheme(ref) {
  if (isPlainObject(ref) && ref.colors) return ref;
  const key = String(ref ?? '').trim().toLowerCase();
  if (!key) return null;
  if (THEMES[key]) return THEMES[key];
  for (const t of THEME_LIST) {
    if ((t.aliases || []).some((a) => String(a).toLowerCase() === key)) return t;
  }
  return null;
}

const isPlaceholderCta = (v) => {
  if (v === undefined || v === null) return true;
  const s = String(v).trim();
  return s === '' || /^\{\{[^{}]*\}\}$/.test(s);
};

/**
 * 把品牌包合入 spec，返回新 spec（深拷贝，入参不被修改）。
 *
 *   meta.brand              = brand.name
 *   meta.brandKit           = { id, logo, fonts }
 *   look.accentOverride     = accentOverride(spec.look.theme, brand.colors).override
 *   meta.cta                = brand.voice.cta（仅当原值空/占位）
 *
 * format / structure / rounds 原样保留。
 * @param {object} spec
 * @param {object} brand  loadBrand() 的返回值
 * @returns {object}
 */
export function applyBrand(spec, brand) {
  if (!isPlainObject(spec)) throw new Error('[brand] applyBrand: spec must be an object');
  if (!isPlainObject(brand) || typeof brand.name !== 'string' || !brand.name) {
    throw new Error('[brand] applyBrand: brand must be a loaded brand kit (missing name)');
  }

  const out = deepClone(spec);
  if (!isPlainObject(out.meta)) out.meta = {};
  if (!isPlainObject(out.look)) out.look = {};

  out.meta.brand = brand.name;
  // 整包快照，而不是只存 id：build 必须能在没有 content/brands 的机器上
  // 独立执行「禁用词 + logo + 对比度」检查（v2.4：P1-03 进 build 门禁）。
  out.meta.brandKit = {
    id: brand.id,
    name: brand.name,
    colors: deepClone(brand.colors),
    logo: deepClone(brand.logo),
    fonts: deepClone(brand.fonts),
    voice: deepClone(brand.voice),
  };

  const theme = resolveTheme(out.look.theme);
  if (theme && isHex(brand.colors?.accent)) {
    out.look.accentOverride = accentOverride(theme, brand.colors).override;
  }

  if (isPlaceholderCta(out.meta.cta) && typeof brand.voice?.cta === 'string' && brand.voice.cta.trim()) {
    out.meta.cta = brand.voice.cta;
  }

  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
 * checkBrand
 * ──────────────────────────────────────────────────────────────────────────── */

/** 会被禁用词扫描的文案字段（v2.4：覆盖所有会上屏的文案面）。 */
function copyFields(spec) {
  const fields = [
    ['meta.title', spec?.meta?.title],
    ['meta.description', spec?.meta?.description],
    ['meta.tags', Array.isArray(spec?.meta?.tags) ? spec.meta.tags.join(' ') : spec?.meta?.tags],
    ['meta.cta', spec?.meta?.cta],
    ['opening.title', spec?.opening?.title],
    ['opening.sub', spec?.opening?.sub],
  ];
  if (isPlainObject(spec?.moreCard)) {
    fields.push(['moreCard.name', spec.moreCard.name]);
    fields.push(['moreCard.first', spec.moreCard.first]);
    fields.push(['moreCard.keyword', spec.moreCard.keyword]);
  }
  if (isPlainObject(spec?.ending)) {
    fields.push(['ending.name', spec.ending.name]);
    fields.push(['ending.title', spec.ending.title]);
    fields.push(['ending.sub', spec.ending.sub]);
    fields.push(['ending.capsule', spec.ending.capsule]);
  }
  const rounds = Array.isArray(spec?.rounds) ? spec.rounds : [];
  rounds.forEach((r, i) => {
    fields.push([`rounds[${i}].name`, r?.name]);
    fields.push([`rounds[${i}].card.first`, r?.card?.first]);
    fields.push([`rounds[${i}].card.keyword`, r?.card?.keyword]);
    fields.push([`rounds[${i}].style.copy.title`, r?.style?.copy?.title]);
    fields.push([`rounds[${i}].style.copy.subtitle`, r?.style?.copy?.subtitle]);
    fields.push([`rounds[${i}].style.copy.caption`, r?.style?.copy?.caption]);
  });
  return fields.filter(([, v]) => typeof v === 'string' && v.trim() !== '');
}

/**
 * 从 spec 里取回可检查的品牌包。
 *
 * v2.4 起 `brand apply` 会把整包写进 `meta.brandKit`，所以 build 不依赖
 * content/brands 是否有这个 id；老 spec 只存了 id 时再按 id 回查仓库。
 * @param {object} spec
 * @param {{root?: string}} [opts]
 * @returns {object|null}
 */
export function brandFromSpec(spec, { root = ROOT } = {}) {
  const kit = spec?.meta?.brandKit;
  if (!isPlainObject(kit)) return null;
  // 整包快照：至少要有 logo/voice 之一，才值得跑 checkBrand。
  if (isPlainObject(kit.logo) || isPlainObject(kit.voice) || isPlainObject(kit.colors)) {
    return {
      id: kit.id || 'inline',
      name: kit.name || spec?.meta?.brand || '',
      colors: isPlainObject(kit.colors) ? kit.colors : {},
      logo: isPlainObject(kit.logo) ? kit.logo : {},
      fonts: isPlainObject(kit.fonts) ? kit.fonts : {},
      voice: isPlainObject(kit.voice) ? kit.voice : {},
    };
  }
  if (typeof kit.id !== 'string' || !kit.id) return null;
  const file = path.join(path.resolve(root), 'content', 'brands', `${kit.id}.json`);
  if (!fs.existsSync(file)) return null;
  try { return loadBrand(file); } catch { return null; }
}

/**
 * 检查已合入（或待合入）的 spec 是否符合品牌包。
 * @param {object} spec
 * @param {object} brand
 * @param {{root?: string}} [opts] root 用于解析 logo.path（默认仓库根）
 * @returns {Array<{level:'error'|'warn', code:string, path:string, message:string}>}
 */
export function checkBrand(spec, brand, { root = ROOT } = {}) {
  const issues = [];
  const push = (level, code, at, message) => issues.push({ level, code, path: at, message });
  const rootAbs = path.resolve(root);

  // 1) 禁用词：大小写不敏感；中文按子串包含
  const words = (brand?.voice?.forbiddenWords || []).filter((w) => typeof w === 'string' && w.length > 0);
  for (const [at, text] of copyFields(spec)) {
    const hay = text.toLowerCase();
    for (const word of words) {
      const needle = word.toLowerCase();
      if (needle && hay.includes(needle)) {
        push('error', 'E_FORBIDDEN_WORD', at, `forbidden word "${word}" appears in "${text}"`);
      }
    }
  }

  // 2) APCA：与 apply 写入的 override 逐值一致
  const theme = resolveTheme(spec?.look?.theme);
  const accent = brand?.colors?.accent;
  if (theme && isHex(accent)) {
    const effective = accentOverride(theme, brand.colors).override;
    const bg = theme.colors.bg;

    const lcAccentBg = Math.abs(apcaLc(effective.accent, bg));
    if (lcAccentBg < 30) {
      push(
        'error', 'E_BRAND_ACCENT_APCA', 'colors.accent',
        `accent ${effective.accent} on theme bg ${bg} (${theme.id}) is APCA |Lc| ${round1(lcAccentBg)} < 30`,
      );
    }

    const declaredInk = isHex(brand?.colors?.accentInk) ? brand.colors.accentInk : null;
    const ink = declaredInk || effective.accentInk;
    const lcInk = Math.abs(apcaLc(ink, effective.accent));
    if (lcInk < 45) {
      push(
        'error', 'E_BRAND_ACCENT_APCA', declaredInk ? 'colors.accentInk' : 'colors.accent',
        `${declaredInk ? 'declared accentInk' : 'derived accentInk'} ${ink} on accent ${effective.accent} is APCA |Lc| ${round1(lcInk)} < 45`,
      );
    }
  }

  // 3) logo：必须存在（相对仓库根），且不得逃出根目录
  const logoRel = brand?.logo?.path;
  if (typeof logoRel !== 'string' || !logoRel.trim()) {
    push('error', 'E_LOGO_MISSING', 'logo.path', 'brand kit has no logo.path');
  } else {
    const logoAbs = path.resolve(rootAbs, logoRel);
    const rel = path.relative(rootAbs, logoAbs);
    const outside = rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
    if (outside) {
      push('error', 'E_LOGO_MISSING', 'logo.path', `logo.path "${logoRel}" escapes the project root ${rootAbs}`);
    } else if (!fs.existsSync(logoAbs) || !fs.statSync(logoAbs).isFile()) {
      push('error', 'E_LOGO_MISSING', 'logo.path', `logo not found: ${logoRel} (root: ${rootAbs})`);
    }
  }

  // 4) 安全区：任一边 < 24px 视为过窄（警告，不阻断）
  const safeArea = brand?.logo?.safeArea;
  if (isPlainObject(safeArea)) {
    const thin = ['top', 'right', 'bottom', 'left'].filter((side) => !(Number(safeArea[side]) >= 24));
    if (thin.length) {
      push(
        'warn', 'W_LOGO_SAFE_AREA', 'logo.safeArea',
        `safe area too tight: ${thin.map((s) => `${s}=${safeArea[s]}px`).join(', ')} (< 24px)`,
      );
    }
  }

  // 5) 品牌名同步：apply 之前 meta.brand 仍是旧值/占位
  if (typeof brand?.name === 'string' && brand.name) {
    const actual = spec?.meta?.brand;
    if (actual !== brand.name) {
      push(
        'warn', 'W_BRAND_NAME_MISMATCH', 'meta.brand',
        `spec meta.brand is ${JSON.stringify(actual ?? null)} but brand.name is ${JSON.stringify(brand.name)}; run \`brand.mjs apply\` to sync`,
      );
    }
  }

  return issues;
}

/* ────────────────────────────────────────────────────────────────────────────
 * CLI
 * ──────────────────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key.slice(2)] = true;
    else { out[key.slice(2)] = next; i++; }
  }
  return out;
}

function usage() {
  return `Usage:
  node scripts/brand.mjs apply --spec <in.spec.json> --brand <brand.json> --out <out.spec.json>
  node scripts/brand.mjs check --spec <in.spec.json> --brand <brand.json> [--json] [--root <dir>]
  node scripts/brand.mjs list

Exit codes: check → 1 when any level=error issue is found; apply/list → 1 only on failure.`;
}

function readSpec(file) {
  const abs = path.resolve(String(file));
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    throw new Error(`[brand] cannot read spec ${abs}: ${e.message}`);
  }
  if (!isPlainObject(raw)) throw new Error(`[brand] spec ${abs} must be a JSON object`);
  return raw;
}

function writeSpec(file, spec) {
  const abs = path.resolve(String(file));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  return abs;
}

function cmdApply(args) {
  for (const key of ['spec', 'brand', 'out']) {
    if (!args[key] || args[key] === true) throw new Error(`[brand] apply: --${key} is required`);
  }
  const brand = loadBrand(args.brand);
  const spec = readSpec(args.spec);
  const applied = applyBrand(spec, brand);
  const outAbs = writeSpec(args.out, applied);

  const accent = applied.look?.accentOverride?.accent ?? '(unchanged)';
  console.log(`✓ applied ${brand.id} (${brand.name}) → ${path.relative(process.cwd(), outAbs) || outAbs}`);
  console.log(`  meta.brand=${applied.meta.brand} · accent=${accent} · cta=${JSON.stringify(applied.meta.cta ?? '')}`);

  // apply 顺带执行检查；有 error 时退出码为 1（v2.4/P1-03）。
  // 先写盘再报错：用户要的是「合入后的 spec + 明确的失败原因」，而不是半途而废。
  const issues = checkBrand(applied, brand, { root: ROOT });
  for (const issue of issues) {
    console.log(`[${issue.level}] [${issue.code}] ${issue.path}: ${issue.message}`);
  }
  const errors = issues.filter((i) => i.level === 'error').length;
  if (errors) {
    console.error(`[error] [E_BRAND_CHECK] ${errors} brand error(s); the applied spec will fail \`cvs build\` until fixed`);
    return 1;
  }
  return 0;
}

function cmdCheck(args) {
  if (!args.spec || args.spec === true) throw new Error('[brand] check: --spec is required');
  if (!args.brand || args.brand === true) throw new Error('[brand] check: --brand is required');
  const brand = loadBrand(args.brand);
  const spec = readSpec(args.spec);
  const root = args.root && args.root !== true ? path.resolve(String(args.root)) : ROOT;
  const issues = checkBrand(spec, brand, { root });
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warn');

  if (args.json) {
    console.log(JSON.stringify({
      spec: path.resolve(String(args.spec)),
      brand: brand.id,
      errors: errors.length,
      warnings: warnings.length,
      issues,
    }, null, 2));
  } else {
    for (const i of issues) console.log(`[${i.level}] [${i.code}] ${i.path}: ${i.message}`);
    console.log(`${errors.length ? '✗' : '✓'} ${brand.id} (${brand.name}) — ${errors.length} error(s), ${warnings.length} warning(s)`);
  }
  return errors.length ? 1 : 0;
}

function cmdList() {
  const rows = listBrands({ root: ROOT });
  if (!rows.length) {
    console.log('(no brand kits in content/brands)');
    return 0;
  }
  for (const row of rows) {
    if (row.valid) console.log(`${row.id}\t${row.name}\t${path.relative(ROOT, row.path)}`);
    else console.log(`[invalid] ${row.file}\t${String(row.error).split('\n')[0]}`);
  }
  return 0;
}

function main(argv) {
  const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : null;
  const args = parseArgs(cmd ? argv.slice(1) : argv);

  if (args.help || !cmd) {
    console.log(usage());
    return args.help ? 0 : 1;
  }
  switch (cmd) {
    case 'apply': return cmdApply(args);
    case 'check': return cmdCheck(args);
    case 'list': return cmdList();
    default:
      console.error(`[error] [E_BRAND] unknown command "${cmd}"\n\n${usage()}`);
      return 1;
  }
}

const sameFile = (a, b) => (process.platform === 'win32'
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  : path.resolve(a) === path.resolve(b));

if (process.argv[1] && sameFile(process.argv[1], fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`[error] [E_BRAND] ${e.message}`);
    process.exitCode = 1;
  }
}
