#!/usr/bin/env node
/**
 * vendor.mjs — 造一个可离线安装的 vendor/（发布时跑一次，需要网络）。
 *
 *   node scripts/vendor.mjs            # pack 全部 dependencies 到 vendor/
 *   node scripts/vendor.mjs --json     # 打印 manifest
 *
 * 产物：
 *   vendor/*.tgz            每个直接依赖一个 tarball
 *   vendor/manifest.json    {name, version, file, sha256} + package-lock hash
 *   vendor/npm-cache/       空的本地 cache（install 时用 npm cache add 填充）
 *
 * 离线机器上：
 *   bash arm.sh --offline
 * 它会先用 `npm cache add vendor/*.tgz` 填充本地 cache，再 `npm ci --offline --cache vendor/npm-cache`。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const VENDOR = path.join(ROOT, 'vendor');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const deps = Object.entries(pkg.dependencies || {});
const args = new Set(process.argv.slice(2));

if (!deps.length) {
  console.error('[vendor] package.json has no dependencies; nothing to vendor');
  process.exit(2);
}

fs.mkdirSync(VENDOR, { recursive: true });
fs.mkdirSync(path.join(VENDOR, 'npm-cache'), { recursive: true });

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const manifest = {
  generatedAt: new Date().toISOString(),
  node: process.versions.node,
  lockHash: fs.existsSync(path.join(ROOT, 'package-lock.json'))
    ? sha256(path.join(ROOT, 'package-lock.json'))
    : null,
  packages: [],
};

for (const [name, range] of deps) {
  const installed = path.join(ROOT, 'node_modules', name);
  const packTarget = fs.existsSync(installed) ? installed : `${name}@${range}`;
  console.log(`[vendor] packing ${name} (${range})`);
  const r = spawnSync('npm', ['pack', packTarget, '--pack-destination', VENDOR, '--silent'], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    console.error(`[vendor] failed: ${name}\n${r.stderr || r.stdout}`);
    process.exit(1);
  }
  const file = String(r.stdout).trim().split(/\r?\n/).filter(Boolean).pop();
  const abs = path.join(VENDOR, path.basename(file));
  manifest.packages.push({
    name,
    range,
    version: JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).version,
    file: path.basename(abs),
    bytes: fs.statSync(abs).size,
    sha256: sha256(abs),
  });
}

fs.writeFileSync(path.join(VENDOR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const total = manifest.packages.reduce((s, p) => s + p.bytes, 0);
console.log(`[vendor] ${manifest.packages.length} packages · ${(total / 1024 / 1024).toFixed(1)} MB -> vendor/`);
if (args.has('--json')) console.log(JSON.stringify(manifest, null, 2));
