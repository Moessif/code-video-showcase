#!/usr/bin/env node
/**
 * bundle-fonts.mjs — 把 shared/fonts 打成一个可发布的字体包（发布时跑一次）。
 *
 *   node scripts/bundle-fonts.mjs             # -> dist/fonts-bundle.tar.zst + sha256
 *   node scripts/bundle-fonts.mjs --tar       # 没有 zstd 时退回 .tar.gz
 *
 * 为什么：shared/fonts 有 ~1187 个 woff2（约 160 MB），不适合放进 git；
 * 但 fresh clone 缺字体时，pages 会静默回退系统字体，成片用哪套字不可证。
 * 发布物应该是：仓库 + 字体包（sha256 可校验），而不是「仓库里没有」。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'shared', 'fonts');
const DIST = path.join(ROOT, 'dist');
const useTar = process.argv.includes('--tar');

if (!fs.existsSync(SRC)) {
  console.error('[bundle-fonts] shared/fonts not found; run `node scripts/build-fonts.mjs` first');
  process.exit(2);
}
const files = fs.readdirSync(SRC).filter((f) => /\.(woff2?|ttf|otf)$/i.test(f));
if (!files.length) {
  console.error('[bundle-fonts] shared/fonts is empty; run `node scripts/build-fonts.mjs` first');
  process.exit(2);
}

fs.mkdirSync(DIST, { recursive: true });

// 字体锁（v2.4 / P1-07）：把「这一版用的是哪套字体字节」固定成可提交的小文件。
// 只存文件名+字节数+整体内容哈希；1187 个 woff2 的清单不会进 git。
const lockRows = files.sort().map((name) => {
  const buf = fs.readFileSync(path.join(SRC, name));
  return { name, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
});
const setSha256 = crypto.createHash('sha256')
  .update(lockRows.map((r) => `${r.name}\t${r.bytes}\t${r.sha256}`).join('\n'))
  .digest('hex');
const lock = {
  schema: 'cvs.fonts.lock/v1',
  generatedBy: 'scripts/bundle-fonts.mjs',
  count: lockRows.length,
  totalBytes: lockRows.reduce((n, r) => n + r.bytes, 0),
  setSha256,
  files: lockRows.map(({ name, bytes }) => ({ name, bytes })),
};
fs.writeFileSync(path.join(ROOT, 'shared', 'fonts.lock.json'), JSON.stringify(lock, null, 2) + '\n', 'utf8');
console.log(`[bundle-fonts] font lock -> shared/fonts.lock.json (${lock.count} files, set ${setSha256.slice(0, 12)})`);
if (process.argv.includes('--lock-only')) {
  console.log('[bundle-fonts] --lock-only: bundle skipped');
  process.exit(0);
}

const out = path.join(DIST, useTar ? 'fonts-bundle.tar.gz' : 'fonts-bundle.tar.zst');
const tarArgs = useTar
  ? ['-czf', out, '-C', path.join(ROOT, 'shared'), 'fonts']
  : ['--zstd', '-cf', out, '-C', path.join(ROOT, 'shared'), 'fonts'];
const r = spawnSync('tar', tarArgs, { encoding: 'utf8', windowsHide: true });
if (r.status !== 0) {
  console.error(`[bundle-fonts] tar failed: ${r.stderr || r.stdout}`);
  console.error('hint: use --tar (gzip) if zstd is unavailable');
  process.exit(1);
}

const bytes = fs.statSync(out).size;
const sha = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex');
fs.writeFileSync(`${out}.sha256`, `${sha}  ${path.basename(out)}\n`);
console.log(`[bundle-fonts] ${files.length} files -> ${out}`);
console.log(`[bundle-fonts] ${(bytes / 1024 / 1024).toFixed(1)} MB  sha256 ${sha}`);
console.log('[bundle-fonts] install: tar -xf fonts-bundle.tar.zst -C .   # writes shared/fonts');
