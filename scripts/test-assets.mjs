#!/usr/bin/env node
/**
 * test-assets.mjs — C3-01 素材注册表的回归测试。
 *
 *   node scripts/test-assets.mjs
 *
 * 覆盖：sha256、扩展名分类、ffprobe 元数据、单文件注册、重复注册稳定、
 * 路径排序的稳定注册表、缺 hash 补算、hash 不匹配/文件缺失的校验、
 * resolveAssets 不写盘、非媒体文件 probe 返回 null。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e.stack || e.message}`);
    process.exitCode = 1;
  }
}

const assets = await load('scripts/assets.mjs');

const IMG_REL = 'assets/theme-previews/01-coral-noir.jpg';
const IMG_ABS = path.join(ROOT, ...IMG_REL.split('/'));
const IMG_SHA256 = '987e1cc41e3144a7b8d8313995057181e61cfc7d005a1b7824e0541d55c6ec14';

const TMP = path.join(ROOT, 'out', `test-assets-${process.pid}`);
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
process.on('exit', () => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ── hash / kind / probe ─────────────────────────────────────────────────────

test('hashFile 返回稳定的 64 位 sha256', () => {
  const h = assets.hashFile(IMG_ABS);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, IMG_SHA256);
  assert.equal(assets.hashFile(IMG_ABS), h);
});

test('kindOf 按扩展名分类且大小写/点号不敏感', () => {
  const cases = [
    ['jpg', 'image'], ['.JPG', 'image'], ['jpeg', 'image'], ['png', 'image'], ['webp', 'image'],
    ['gif', 'image'], ['avif', 'image'], ['bmp', 'image'], ['tiff', 'image'], ['heic', 'image'],
    ['mp4', 'video'], ['MOV', 'video'], ['webm', 'video'], ['mkv', 'video'], ['m4v', 'video'],
    ['mp3', 'audio'], ['WAV', 'audio'], ['m4a', 'audio'], ['flac', 'audio'], ['ogg', 'audio'], ['opus', 'audio'],
    ['woff', 'font'], ['woff2', 'font'], ['ttf', 'font'], ['otf', 'font'],
    ['svg', 'logo'],
    ['txt', null], ['json', null], ['', null],
  ];
  for (const [ext, kind] of cases) assert.equal(assets.kindOf(ext), kind, `kindOf(${ext})`);
});

test('probe 读取图片的 width/height/duration/fps/codec', () => {
  const p = assets.probe(IMG_ABS);
  assert.ok(p, 'probe returned null');
  assert.equal(p.width, 1920);
  assert.equal(p.height, 1080);
  assert.equal(p.codec, 'mjpeg');
  assert.equal(typeof p.duration, 'number');
  assert.equal(typeof p.fps, 'number');
  assert.ok(p.fps > 0, `fps=${p.fps}`);
});

test('probe 对非媒体文件返回 null（不抛异常）', () => {
  assert.equal(assets.probe(path.join(ROOT, 'package.json')), null);
});

// ── registerAsset ──────────────────────────────────────────────────────────

const record = assets.registerAsset(IMG_REL, { root: ROOT });

test('registerAsset 返回 {id, kind, path, hash, meta} 且图片元数据完整', () => {
  assert.match(record.id, /^[a-z0-9][a-z0-9-]*$/);
  assert.equal(record.kind, 'image');
  assert.equal(record.path, IMG_REL);
  assert.equal(record.hash, IMG_SHA256);
  assert.equal(record.meta.ext, 'jpg');
  assert.equal(record.meta.bytes, fs.statSync(IMG_ABS).size);
  assert.equal(record.meta.width, 1920);
  assert.equal(record.meta.height, 1080);
  assert.equal(record.meta.codec, 'mjpeg');
});

test('重复注册同一文件结果完全一致（稳定输出）', () => {
  const again = assets.registerAsset(IMG_REL, { root: ROOT });
  assert.deepEqual(again, record);
});

test('registerAsset 支持显式 id 与 kind', () => {
  const r = assets.registerAsset(IMG_REL, { id: 'hero-still', kind: 'image', root: ROOT });
  assert.equal(r.id, 'hero-still');
  assert.equal(r.kind, 'image');
});

test('registerAsset 拒绝不存在的文件与未知扩展名', () => {
  assert.throws(() => assets.registerAsset('assets/nope.png', { root: ROOT }), /not found/i);
  assert.throws(() => assets.registerAsset('package.json', { root: ROOT }), /unsupported/i);
});

test('DEFAULT_REGISTRY 指向 content/assets.json', () => {
  assert.equal(path.resolve(assets.DEFAULT_REGISTRY), path.join(ROOT, 'content', 'assets.json'));
});

// ── registerAll ────────────────────────────────────────────────────────────

test('registerAll 按 path 排序写盘，重复运行字节级稳定', () => {
  const file = path.join(TMP, 'assets.json');
  const paths = ['assets/theme-previews/09-cyber-neon.jpg', IMG_REL];
  const records = assets.registerAll([...paths].reverse(), { file, root: ROOT });

  assert.deepEqual(records.map((r) => r.path), [...paths].sort());
  assert.ok(records.every((r) => /^[0-9a-f]{64}$/.test(r.hash)));
  assert.ok(records.every((r) => r.meta.width > 0 && r.meta.height > 0));

  const first = fs.readFileSync(file, 'utf8');
  assert.ok(first.startsWith('[\n'), 'registry should be a pretty JSON array');
  assert.ok(first.endsWith('\n'), 'registry should end with a newline');
  assert.deepEqual(JSON.parse(first), records);

  assets.registerAll([...paths].reverse(), { file, root: ROOT });
  assert.equal(fs.readFileSync(file, 'utf8'), first, 'second run must be byte-identical');
});

test('registerAll 对同一 path 去重', () => {
  const file = path.join(TMP, 'dedupe.json');
  const records = assets.registerAll([IMG_REL, IMG_REL], { file, root: ROOT });
  assert.equal(records.length, 1);
});

test('registerAll merge=true 保留已有素材，默认模式只写本次输入', () => {
  const file = path.join(TMP, 'merge.json');
  assets.registerAll([IMG_REL], { file, root: ROOT });
  const merged = assets.registerAll(['assets/theme-previews/09-cyber-neon.jpg'], { file, root: ROOT, merge: true });
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((r) => r.path), [IMG_REL, 'assets/theme-previews/09-cyber-neon.jpg'].sort());

  const overwritten = assets.registerAll([IMG_REL], { file, root: ROOT });
  assert.equal(overwritten.length, 1, 'without merge the registry is exactly the input list');
});

test('registerAll 拒绝多个文件共用同一 id', () => {
  const file = path.join(TMP, 'same-id.json');
  assert.throws(
    () => assets.registerAll([IMG_REL, 'assets/theme-previews/09-cyber-neon.jpg'], { id: 'same', file, root: ROOT }),
    /single path/i,
  );
  assert.equal(fs.existsSync(file), false, 'invalid call must not write the registry');
});

// ── resolveAssets ──────────────────────────────────────────────────────────

test('resolveAssets 补算缺失 hash 并返回新 spec（原对象不动）', () => {
  const spec = {
    specVersion: 1,
    assets: [
      { id: 'hero', kind: 'image', path: IMG_REL },
      { id: 'filler', kind: 'image', path: IMG_REL, hash: IMG_SHA256 },
    ],
  };
  const out = assets.resolveAssets(spec, { root: ROOT });

  assert.notEqual(out, spec);
  assert.equal(out.assets[0].hash, IMG_SHA256);
  assert.equal(out.assets[1].hash, IMG_SHA256);
  assert.equal(spec.assets[0].hash, undefined, 'input spec must not be mutated');
  assert.equal(out._assets.ok, true);
  assert.equal(out._assets.updated, true);
  assert.equal(out._assets.resolved.length, 2);
  assert.ok(!JSON.stringify(out).includes('_assets'), '_assets must be non-enumerable');
});

test('resolveAssets 对已正确的 hash 报告未更新', () => {
  const spec = { specVersion: 1, assets: [{ id: 'hero', path: IMG_REL, hash: IMG_SHA256 }] };
  const out = assets.resolveAssets(spec, { root: ROOT });
  assert.equal(out._assets.ok, true);
  assert.equal(out._assets.updated, false);
});

test('resolveAssets 对 hash 不匹配报告 E_ASSET_HASH', () => {
  const spec = { specVersion: 1, assets: [{ id: 'hero', path: IMG_REL, hash: '0'.repeat(64) }] };
  const out = assets.resolveAssets(spec, { root: ROOT });
  assert.equal(out._assets.ok, false);
  assert.ok(out._assets.issues.some((i) => i.code === 'E_ASSET_HASH'), JSON.stringify(out._assets.issues));
});

test('resolveAssets 对缺失文件报告 E_ASSET_MISSING', () => {
  const spec = { specVersion: 1, assets: [{ id: 'ghost', kind: 'image', path: 'assets/definitely-missing.png' }] };
  const out = assets.resolveAssets(spec, { root: ROOT });
  assert.equal(out._assets.ok, false);
  assert.ok(out._assets.issues.some((i) => i.code === 'E_ASSET_MISSING'));
});

test('resolveAssets 对非数组 assets 报告 E_ASSETS_TYPE', () => {
  const out = assets.resolveAssets({ specVersion: 1, assets: { id: 'x' } }, { root: ROOT });
  assert.equal(out._assets.ok, false);
  assert.ok(out._assets.issues.some((i) => i.code === 'E_ASSETS_TYPE'));
});

test('resolveAssets 不写任何文件（哨兵文件保持不变）', () => {
  const sentinel = path.join(TMP, 'sentinel.json');
  fs.writeFileSync(sentinel, 'SENTINEL-DO-NOT-TOUCH');
  const spec = { specVersion: 1, assets: [{ id: 'hero', path: IMG_REL }] };
  assets.resolveAssets(spec, { root: ROOT });
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'SENTINEL-DO-NOT-TOUCH');
});

test('resolveAssets 对补算后的 spec 再次校验通过且不重复更新', () => {
  const spec = { specVersion: 1, assets: [{ id: 'hero', path: IMG_REL }] };
  const once = assets.resolveAssets(spec, { root: ROOT });
  const twice = assets.resolveAssets(once, { root: ROOT });
  assert.equal(twice._assets.ok, true);
  assert.equal(twice._assets.updated, false);
});

const total = passed + failed;
console.log(`\nRan ${total} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
