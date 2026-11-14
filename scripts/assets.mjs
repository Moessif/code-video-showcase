#!/usr/bin/env node
/**
 * assets.mjs — C3-01 素材注册表：sha256 + ffprobe 元数据 + spec 素材校验。
 *
 * 设计原则：
 *   1. 素材哈希是段哈希的输入（templates/plan.mjs 会读 spec.assets[].hash），
 *      任何注册/校验都必须给出与 `sha256sum` 一致的 64 位十六进制。
 *   2. content/assets.json 是路径排序、两空格缩进、末尾换行的稳定 JSON，
 *      同样输入重复运行必须字节级一致（方便 diff / 代码评审）。
 *   3. resolveAssets 只读盘：缺 hash 时补算到返回的新 spec 上，不写任何文件。
 *
 * CLI:
 *   node scripts/assets.mjs add <path...> [--id <id>] [--kind <kind>] [--file <registry>] [--root <dir>]
 *   node scripts/assets.mjs list [--file <registry>]
 *   node scripts/assets.mjs verify --spec <spec.json> [--root <dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const DEFAULT_REGISTRY = path.join(ROOT, 'content', 'assets.json');
export const ASSET_KINDS = ['image', 'video', 'audio', 'logo', 'font'];

const KIND_BY_EXT = new Map();
const addKinds = (kind, exts) => { for (const e of exts) KIND_BY_EXT.set(e, kind); };
addKinds('image', ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'ico']);
addKinds('video', ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mpg', 'mpeg']);
addKinds('audio', ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif']);
addKinds('font', ['woff', 'woff2', 'ttf', 'otf', 'eot']);
addKinds('logo', ['svg']);

// ── 基础工具 ────────────────────────────────────────────────────────────────

/** 扩展名 → schema 的 kind 枚举；未知返回 null。接受 "jpg" / ".JPG"。 */
export function kindOf(ext) {
  if (ext == null) return null;
  const e = String(ext).toLowerCase().replace(/^\.+/, '').trim();
  return e ? KIND_BY_EXT.get(e) || null : null;
}

/** 流式读取计算 sha256（大视频也不会整文件进内存）。 */
export function hashFile(file) {
  const abs = path.resolve(String(file));
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(abs, 'r');
  const buf = Buffer.allocUnsafe(1 << 20);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}

function toRate(value) {
  if (value == null || value === '') return null;
  const [a, b] = String(value).split('/').map(Number);
  const n = b ? a / b : a;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null;
}

/**
 * ffprobe 元数据：{width, height, duration, fps, codec, format}。
 * 失败（非媒体文件、ffprobe 不存在、超时）一律返回 null，不抛异常。
 */
export function probe(file, opts = {}) {
  const exe = opts.ffprobe || process.env.FFPROBE || 'ffprobe';
  const args = [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,duration,nb_frames',
    '-show_entries', 'format=duration,format_name',
    '-of', 'json',
    String(file),
  ];
  let r;
  try {
    r = spawnSync(exe, args, { encoding: 'utf8', timeout: 20000, windowsHide: true });
  } catch {
    return null;
  }
  if (!r || r.status !== 0 || !r.stdout) return null;
  let data;
  try { data = JSON.parse(r.stdout); } catch { return null; }
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const stream = streams.find((s) => s.codec_type === 'video') || streams.find((s) => s.codec_type === 'audio');
  const format = data.format || {};
  if (!stream && !format.format_name) return null;
  return {
    width: stream?.width != null ? Number(stream.width) : null,
    height: stream?.height != null ? Number(stream.height) : null,
    duration: toNumber(stream?.duration ?? format.duration),
    fps: toRate(stream?.avg_frame_rate || stream?.r_frame_rate),
    codec: stream?.codec_name || null,
    format: format.format_name || null,
  };
}

function displayPath(abs, rootDir) {
  for (const base of [rootDir, ROOT]) {
    const rel = path.relative(base, abs);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
  }
  return abs.split(path.sep).join('/');
}

function defaultId(abs, hash) {
  const base = path.basename(abs, path.extname(abs))
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'asset';
  return `${base}-${hash.slice(0, 8)}`;
}

// ── 注册 ────────────────────────────────────────────────────────────────────

/**
 * 注册单个素材。
 * @param {string} file 项目相对或绝对路径
 * @param {{id?:string, kind?:string, root?:string}} [opts]
 * @returns {{id:string, kind:string, path:string, hash:string, meta:object}}
 */
export function registerAsset(file, opts = {}) {
  if (typeof file !== 'string' || !file.trim()) throw new Error('asset path must be a non-empty string');
  const rootDir = path.resolve(opts.root || ROOT);
  const abs = path.isAbsolute(file) ? path.normalize(file) : path.resolve(rootDir, file);
  if (!fs.existsSync(abs)) throw new Error(`asset not found: ${file}`);
  const stat = fs.statSync(abs);
  if (!stat.isFile()) throw new Error(`asset is not a file: ${file}`);

  const ext = path.extname(abs).slice(1).toLowerCase();
  const kind = opts.kind || kindOf(ext);
  if (!kind) throw new Error(`unsupported asset type ".${ext}" (${file})`);
  if (!ASSET_KINDS.includes(kind)) {
    throw new Error(`unknown asset kind "${kind}"; expected one of ${ASSET_KINDS.join(', ')}`);
  }

  const hash = hashFile(abs);
  const probed = probe(abs);
  const meta = {
    ext,
    bytes: stat.size,
    width: probed?.width ?? null,
    height: probed?.height ?? null,
    duration: probed?.duration ?? null,
    fps: probed?.fps ?? null,
    codec: probed?.codec ?? null,
    format: probed?.format ?? null,
  };

  return {
    id: String(opts.id || defaultId(abs, hash)),
    kind,
    path: displayPath(abs, rootDir),
    hash,
    meta,
  };
}

/**
 * 注册一组素材并写注册表（默认 content/assets.json）。
 * 输出按 path 排序、去重、稳定缩进，重复运行字节级一致。
 * @param {string[]} files
 * @param {{file?:string, root?:string, kind?:string, id?:string, merge?:boolean}} [opts]
 *   merge=true 时先读入已有注册表，同 path 更新、其余保留（CLI add 的语义）；
 *   默认 false 只写本次给出的素材。
 */
export function registerAll(files, opts = {}) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('registerAll(paths): paths must be a non-empty array');
  if (opts.id && files.length > 1) throw new Error('registerAll: opts.id is only valid with a single path');
  const file = path.resolve(opts.file || DEFAULT_REGISTRY);
  const byPath = new Map();
  if (opts.merge) {
    for (const rec of loadRegistry(file)) {
      if (rec && typeof rec.path === 'string') byPath.set(rec.path, rec);
    }
  }
  for (const f of files) {
    const rec = registerAsset(f, opts);
    byPath.set(rec.path, rec);
  }
  const records = [...byPath.values()].sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(records, null, 2)}\n`);
  return records;
}

/** 读取注册表；文件不存在返回 []。 */
export function loadRegistry(file = DEFAULT_REGISTRY) {
  const abs = path.resolve(String(file));
  if (!fs.existsSync(abs)) return [];
  const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!Array.isArray(data)) throw new Error(`registry must be a JSON array: ${abs}`);
  return data;
}

// ── spec 素材校验 ──────────────────────────────────────────────────────────

/**
 * 完整报告：校验 spec.assets 的 path 存在、hash 匹配；缺 hash 时在返回的
 * spec 副本上补算。不写盘。
 * @returns {{ok:boolean, spec:object, issues:object[], updated:boolean, resolved:object[]}}
 */
export function resolveAssetsReport(spec, opts = {}) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error('spec must be an object');
  const rootDir = path.resolve(opts.root || ROOT);
  const next = JSON.parse(JSON.stringify(spec));
  const list = Array.isArray(next.assets) ? next.assets : [];
  const issues = [];
  const resolved = [];
  let updated = false;

  if (next.assets != null && !Array.isArray(next.assets)) {
    issues.push({ code: 'E_ASSETS_TYPE', path: 'assets', message: 'spec.assets must be an array', level: 'error' });
  }

  list.forEach((asset, i) => {
    const at = `assets[${i}]`;
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
      issues.push({ code: 'E_ASSET_ENTRY', path: at, message: 'asset entry must be an object', level: 'error' });
      return;
    }
    if (typeof asset.path !== 'string' || !asset.path.trim()) {
      issues.push({ code: 'E_ASSET_PATH', path: `${at}.path`, message: 'asset.path is required', level: 'error' });
      return;
    }
    if (/^https?:\/\//i.test(asset.path)) {
      issues.push({ code: 'E_ASSET_REMOTE', path: `${at}.path`, message: `remote URLs are not resolved locally: ${asset.path}`, level: 'error' });
      return;
    }
    const abs = path.isAbsolute(asset.path) ? asset.path : path.resolve(rootDir, asset.path);
    let stat = null;
    try { stat = fs.statSync(abs); } catch { stat = null; }
    if (!stat || !stat.isFile()) {
      issues.push({ code: 'E_ASSET_MISSING', path: `${at}.path`, message: `asset not found: ${asset.path}`, level: 'error' });
      return;
    }
    const hash = hashFile(abs);
    if (asset.hash == null || asset.hash === '') {
      asset.hash = hash;
      updated = true;
    } else if (String(asset.hash).toLowerCase() !== hash) {
      issues.push({
        code: 'E_ASSET_HASH',
        path: `${at}.hash`,
        message: `hash mismatch for ${asset.path}: spec has ${asset.hash}, file is ${hash}`,
        expected: String(asset.hash),
        actual: hash,
        level: 'error',
      });
    }
    resolved.push({
      id: asset.id ?? null,
      kind: asset.kind || kindOf(path.extname(abs)),
      path: asset.path,
      hash,
      bytes: stat.size,
    });
  });

  return { ok: issues.length === 0, spec: next, issues, updated, resolved };
}

/**
 * 校验并返回新 spec（补算缺失 hash）。诊断信息挂在非枚举的 `_assets` 上，
 * 不会进入 JSON.stringify / 写盘：
 *   spec._assets = { ok, issues, updated, resolved }
 */
export function resolveAssets(spec, opts = {}) {
  const report = resolveAssetsReport(spec, opts);
  Object.defineProperty(report.spec, '_assets', {
    value: { ok: report.ok, issues: report.issues, updated: report.updated, resolved: report.resolved },
    enumerable: false,
    configurable: true,
  });
  return report.spec;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else { flags[key] = next; i++; }
  }
  return { flags, positional };
}

function usage() {
  console.log(`Usage: node scripts/assets.mjs <command> [options]

Commands:
  add <path...>            register files into content/assets.json (sha256 + ffprobe)
  list                     list the registry
  verify --spec <spec>     check every spec.assets path exists and hash matches

Options:
  --file <registry>        registry path (default content/assets.json)
  --root <dir>             project root for relative asset paths (default cwd)
  --id <id>                explicit asset id (add, single path only)
  --kind <kind>            explicit kind: ${ASSET_KINDS.join('|')}
  --json                   machine-readable output (list/verify)`);
}

function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const command = positional[0];

  if (!command || flags.help) { usage(); process.exit(command ? 0 : 1); }

  if (command === 'add') {
    const files = positional.slice(1);
    if (!files.length) { console.error('add: at least one path is required'); process.exit(1); }
    if (flags.id && files.length > 1) { console.error('add: --id is only valid with a single path'); process.exit(1); }
    const file = flags.file ? path.resolve(String(flags.file)) : DEFAULT_REGISTRY;
    let records;
    try {
      records = registerAll(files, {
        file,
        root: flags.root ? String(flags.root) : process.cwd(),
        merge: true,
        ...(flags.id ? { id: String(flags.id) } : {}),
        ...(flags.kind ? { kind: String(flags.kind) } : {}),
      });
    } catch (e) {
      console.error(`[fatal] ${e.message}`);
      process.exit(1);
    }
    console.log(`[registry] ${file}`);
    console.log(`✓ ${records.length} assets registered (sha256, path-sorted)`);
    for (const r of records) console.log(`  ${r.hash.slice(0, 12)}  ${r.kind.padEnd(5)}  ${r.path}`);
    return;
  }

  if (command === 'list') {
    const file = flags.file ? path.resolve(String(flags.file)) : DEFAULT_REGISTRY;
    let records;
    try { records = loadRegistry(file); } catch (e) { console.error(`[fatal] ${e.message}`); process.exit(1); }
    if (flags.json) { console.log(JSON.stringify(records, null, 2)); return; }
    console.log(`[registry] ${file}`);
    if (!records.length) { console.log('(empty — run: node scripts/assets.mjs add <path...>)'); return; }
    for (const r of records) {
      const dims = r.meta && r.meta.width ? ` ${r.meta.width}x${r.meta.height}` : '';
      console.log(`  ${r.hash.slice(0, 12)}  ${String(r.kind).padEnd(5)}${dims}  ${r.path}  (${r.id})`);
    }
    console.log(`${records.length} assets`);
    return;
  }

  if (command === 'verify') {
    if (!flags.spec) { console.error('verify: --spec <spec.json> is required'); process.exit(1); }
    const specPath = path.resolve(String(flags.spec));
    let spec;
    try { spec = JSON.parse(fs.readFileSync(specPath, 'utf8')); }
    catch (e) { console.error(`[fatal] cannot read spec ${specPath}: ${e.message}`); process.exit(1); }
    const root = flags.root ? path.resolve(String(flags.root)) : process.cwd();
    const report = resolveAssetsReport(spec, { root });
    if (flags.json) {
      console.log(JSON.stringify({ ok: report.ok, updated: report.updated, issues: report.issues, assets: report.resolved }, null, 2));
    } else {
      console.log(`[spec] ${specPath}`);
      console.log(`[root] ${root}`);
      for (const a of report.resolved) console.log(`  ✓ ${a.kind || '?'} ${a.path} ${a.hash.slice(0, 12)}`);
      for (const i of report.issues) console.error(`  [${i.level}] [${i.code}] ${i.path}: ${i.message}`);
      if (report.updated) console.log('  note: some hashes were computed in memory; spec file was NOT modified');
    }
    if (!report.ok) process.exit(1);
    console.log(`✓ ${report.resolved.length} assets verified`);
    return;
  }

  console.error(`unknown command: ${command}`);
  usage();
  process.exit(1);
}

const invokedDirectly = process.argv[1] && path.basename(process.argv[1]) === 'assets.mjs';
if (invokedDirectly) {
  try { main(); } catch (e) { console.error('[fatal]', e.stack || e); process.exit(1); }
}
