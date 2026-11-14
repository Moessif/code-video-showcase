#!/usr/bin/env node
/**
 * versions.mjs — 版本快照 / 校验 / 回滚（v2.4 / P1-13）。
 *
 * 审片闭环缺的不是评论框，而是「评论针对的那一版还能找回来」：
 * 每次出片把 master / spec / plan / 清单 / 字幕 / QA 存进 `<outDir>/versions/vNNN/`，
 * 记录每个文件的 sha256；回滚时先逐文件校验，再恢复 master 与 spec。
 *
 *   node scripts/versions.mjs snapshot --spec project.spec.json [--label 初版]
 *   node scripts/versions.mjs list [--json]
 *   node scripts/versions.mjs verify v001
 *   node scripts/versions.mjs rollback v001 [--spec project.spec.json]
 *   node scripts/versions.mjs --help
 *
 * 退出码：0 ok；2 用法；13 产物缺失/校验失败/版本不存在。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) { a._.push(k); continue; }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) a[k.slice(2)] = true;
    else { a[k.slice(2)] = next; i++; }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0] || null;
const ROOT = path.resolve(String(args.root || process.cwd()));
const USAGE = `Usage:
  node scripts/versions.mjs snapshot --spec <spec.json> [--outdir <dir>] [--label <name>] [--root <dir>]
  node scripts/versions.mjs list [--spec <spec.json>] [--outdir <dir>] [--json]
  node scripts/versions.mjs verify <version> [--spec <spec.json>] [--outdir <dir>]
  node scripts/versions.mjs rollback <version> [--spec <spec.json>] [--outdir <dir>]

Artifacts: <outDir>/versions/versions.json + vNNN/{master.mp4,project.spec.json,plan.json,...}
Exit codes: 0 ok · 2 usage · 13 missing artifact / hash mismatch / unknown version.`;

if (args.help || !cmd) {
  console.log(USAGE);
  process.exit(args.help ? 0 : 2);
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const bytes = (file) => fs.statSync(file).size;
const toPosix = (p) => String(p).split(path.sep).join('/');
const nowIso = () => new Date().toISOString();

function readSpec(file) {
  const abs = path.resolve(ROOT, String(file));
  try {
    return { spec: JSON.parse(fs.readFileSync(abs, 'utf8')), path: abs };
  } catch (e) {
    console.error(`[error] [E_SPEC] cannot read ${abs}: ${e.message}`);
    process.exit(10);
  }
}

function resolveOutDir(spec, explicit) {
  const raw = explicit || spec?.render?.outDir || 'out';
  return path.resolve(ROOT, String(raw));
}

function indexPath(outDir) { return path.join(outDir, 'versions', 'versions.json'); }

function readIndex(outDir) {
  try {
    const j = JSON.parse(fs.readFileSync(indexPath(outDir), 'utf8'));
    if (j && Array.isArray(j.versions)) return j;
  } catch { /* first snapshot */ }
  return { schema: 'cvs.versions/v1', versions: [] };
}

function writeIndex(outDir, index) {
  const file = indexPath(outDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function slug(label) {
  return String(label || '').trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/** 快照要收的文件：交付与追责所需，不含平台大文件（需要时另行拷贝）。 */
const SNAPSHOT_FILES = [
  'master.mp4', 'delivery.json', 'plan.json', 'render-manifest.json',
  'master.srt', 'master.vtt', 'qa/qa-video.json', 'qa/qa-audio.json', 'review.json',
];

function snapshot() {
  if (!args.spec) {
    console.error('[error] [E_SPEC] snapshot needs --spec <project.spec.json>');
    process.exit(2);
  }
  const { spec, path: specPath } = readSpec(args.spec);
  const outDir = resolveOutDir(spec, args.outdir);
  const master = path.join(outDir, 'master.mp4');
  if (!fs.existsSync(master)) {
    console.error(`[error] [E_NO_MASTER] ${master} not found; run \`cvs build\` first`);
    process.exit(13);
  }
  const index = readIndex(outDir);
  const n = index.versions.length + 1;
  const version = `v${String(n).padStart(3, '0')}`;
  const label = slug(args.label);
  const dirName = label ? `${version}-${label}` : version;
  const dir = path.join(outDir, 'versions', dirName);
  fs.mkdirSync(dir, { recursive: true });

  const files = {};
  for (const rel of SNAPSHOT_FILES) {
    const src = path.join(outDir, rel);
    if (!fs.existsSync(src)) {
      if (rel === 'review.json') {
        const review = { schema: 'cvs.review/v1', version, comments: [] };
        fs.writeFileSync(path.join(dir, 'review.json'), JSON.stringify(review, null, 2) + '\n');
        files['review.json'] = { sha256: sha256(path.join(dir, 'review.json')), bytes: bytes(path.join(dir, 'review.json')) };
      }
      continue;
    }
    const dst = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    files[toPosix(rel)] = { sha256: sha256(dst), bytes: bytes(dst) };
  }
  // spec 一起进快照：没有它，回滚出来的 master 无法再编译。
  fs.copyFileSync(specPath, path.join(dir, 'project.spec.json'));
  files['project.spec.json'] = { sha256: sha256(path.join(dir, 'project.spec.json')), bytes: bytes(path.join(dir, 'project.spec.json')) };

  const entry = {
    version: dirName,
    label: String(args.label || ''),
    createdAt: nowIso(),
    specHash: crypto.createHash('sha256').update(JSON.stringify(spec)).digest('hex').slice(0, 12),
    masterSha256: files['master.mp4'] ? files['master.mp4'].sha256 : null,
    sourceOutDir: toPosix(path.relative(ROOT, outDir)),
    files,
  };
  index.versions.push(entry);
  writeIndex(outDir, index);

  console.log(`✓ snapshot ${dirName} · ${Object.keys(files).length} files · master ${entry.masterSha256.slice(0, 12)}`);
  console.log(`  ${toPosix(path.relative(ROOT, dir))}`);
  for (const [f, meta] of Object.entries(files)) console.log(`  ${f.padEnd(26)} ${meta.sha256.slice(0, 12)}  ${meta.bytes} B`);
}

function loadEntry(outDir, version) {
  const index = readIndex(outDir);
  const entry = index.versions.find((v) => v.version === version || v.version.startsWith(`${version}-`));
  if (!entry) {
    console.error(`[error] [E_VERSION_UNKNOWN] ${version} not found in ${toPosix(path.relative(ROOT, indexPath(outDir)))}`);
    process.exit(13);
  }
  return { index, entry, dir: path.join(outDir, 'versions', entry.version) };
}

function verifyEntry(entry, dir) {
  const bad = [];
  for (const [rel, meta] of Object.entries(entry.files || {})) {
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) { bad.push(`${rel}: missing`); continue; }
    if (sha256(file) !== meta.sha256) bad.push(`${rel}: sha256 mismatch`);
    if (bytes(file) !== meta.bytes) bad.push(`${rel}: size mismatch`);
  }
  return bad;
}

function verify() {
  const version = args._[1];
  if (!version) { console.error('[error] [E_VERSION] verify needs <version>'); process.exit(2); }
  // 与 snapshot/rollback 一致：--spec 也能定位 outDir。以前只认 --outdir，
  // 于是 `cvs verify v001 --spec X` 会静默跑去 out/ 找，报 E_VERSION_UNKNOWN。
  const specHint = args.spec ? readSpec(args.spec).spec : null;
  const outDir = resolveOutDir(specHint, args.outdir);
  const { entry, dir } = loadEntry(outDir, version);
  const bad = verifyEntry(entry, dir);
  if (bad.length) {
    console.error(`✗ ${entry.version}: ${bad.length} problem(s)`);
    for (const b of bad) console.error(`  ${b}`);
    process.exit(13);
  }
  console.log(`✓ ${entry.version}: ${Object.keys(entry.files).length} files match the recorded sha256`);
}

function list() {
  const specHint = args.spec ? readSpec(args.spec).spec : null;
  const outDir = resolveOutDir(specHint, args.outdir);
  const index = readIndex(outDir);
  if (args.json) {
    console.log(JSON.stringify(index, null, 2));
    return;
  }
  if (!index.versions.length) {
    console.log(`(no snapshots in ${toPosix(path.relative(ROOT, outDir))}/versions)`);
    return;
  }
  for (const v of index.versions) {
    console.log(`${v.version.padEnd(28)} ${v.createdAt}  master=${String(v.masterSha256 || '').slice(0, 12)}  ${v.label || ''}`);
  }
}

function rollback() {
  const version = args._[1];
  if (!version) { console.error('[error] [E_VERSION] rollback needs <version>'); process.exit(2); }
  const specHint = args.spec ? readSpec(args.spec).spec : null;
  const outDir = resolveOutDir(specHint, args.outdir);
  const { entry, dir } = loadEntry(outDir, version);

  // 先校验收回的对象没被动过：回滚到被篡改的版本比不回滚更危险。
  const bad = verifyEntry(entry, dir);
  if (bad.length) {
    console.error(`[error] [E_SNAPSHOT_TAMPERED] ${entry.version} failed verification:`);
    for (const b of bad) console.error(`  ${b}`);
    process.exit(13);
  }

  const restored = [];
  for (const rel of ['master.mp4', 'delivery.json', 'plan.json', 'master.srt', 'master.vtt']) {
    const src = path.join(dir, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const tmp = `${dst}.rollback-${process.pid}`;
    fs.copyFileSync(src, tmp);
    fs.renameSync(tmp, dst);
    restored.push(rel);
  }
  // spec：优先回滚到 --spec 指定的位置，否则放一份 project.spec.json 供下次 build。
  const specDst = args.spec ? path.resolve(ROOT, String(args.spec)) : path.join(outDir, 'project.spec.json');
  fs.mkdirSync(path.dirname(specDst), { recursive: true });
  fs.copyFileSync(path.join(dir, 'project.spec.json'), specDst);
  restored.push(toPosix(path.relative(ROOT, specDst)));

  const master = path.join(outDir, 'master.mp4');
  const got = fs.existsSync(master) ? sha256(master) : null;
  if (got !== entry.masterSha256) {
    console.error(`[error] [E_ROLLBACK_HASH] restored master sha ${got} != recorded ${entry.masterSha256}`);
    process.exit(13);
  }
  const receipt = {
    schema: 'cvs.rollback/v1',
    at: nowIso(),
    version: entry.version,
    label: entry.label,
    restored,
    masterSha256: got,
  };
  fs.writeFileSync(path.join(outDir, 'rollback.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(`✓ rolled back to ${entry.version} (${restored.length} files) · master sha ${got.slice(0, 12)}`);
  console.log(`  receipt: ${toPosix(path.relative(ROOT, path.join(outDir, 'rollback.json')))}`);
}

switch (cmd) {
  case 'snapshot': snapshot(); break;
  case 'list': list(); break;
  case 'verify': verify(); break;
  case 'rollback': rollback(); break;
  default:
    console.error(`[error] [E_COMMAND] unknown command "${cmd}"\n\n${USAGE}`);
    process.exit(2);
}
