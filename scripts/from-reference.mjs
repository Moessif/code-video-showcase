#!/usr/bin/env node
/**
 * from-reference.mjs — 参考图 → 主题 + 强调色 + 版式密度（结构化提取，不复制像素）。
 *
 *   node scripts/from-reference.mjs --img ref.jpg --out out/look.json
 *   node scripts/from-reference.mjs --img ref.jpg --spec project.spec.json --out patched.spec.json
 *   node scripts/from-reference.mjs --img ref.jpg --json
 *
 * 依赖：系统 ffmpeg + scripts/ref-core.mjs（Node/浏览器共用同一套算法）。零 npm 包。
 * 确定性：固定 96×96 采样、确定性初始质心、固定迭代次数。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { analyzePixels, REF_SAMPLE } from './ref-core.mjs';

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

function decode(file) {
  const buf = execFileSync('ffmpeg', [
    '-v', 'error', '-i', file,
    '-vf', `scale=${REF_SAMPLE}:${REF_SAMPLE}:flags=area`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { maxBuffer: 64 * 1024 * 1024 });
  const px = [];
  for (let i = 0; i + 2 < buf.length; i += 3) {
    px.push({ r: buf[i] / 255, g: buf[i + 1] / 255, b: buf[i + 2] / 255 });
  }
  if (!px.length) throw new Error(`no pixels decoded from ${file}`);
  return px;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const img = arg('img');
if (!img || img === true) {
  console.error(`usage:
  node scripts/from-reference.mjs --img <image> [--out look.json] [--k 6] [--json]
  node scripts/from-reference.mjs --img <image> --spec project.spec.json --out patched.spec.json`);
  process.exit(2);
}

let result;
try {
  result = analyzePixels(decode(path.resolve(String(img))), { k: Number(arg('k', 6)) });
  result.source = String(img);
} catch (e) {
  console.error(`[from-reference] ${e.message}`);
  process.exit(1);
}

const specPath = arg('spec');
const out = arg('out');

if (specPath && specPath !== true) {
  const spec = JSON.parse(fs.readFileSync(path.resolve(String(specPath)), 'utf8'));
  spec.look = spec.look || {};
  spec.look.theme = result.theme.id;
  spec.look.accentOverride = result.theme.accentOverride;
  if (result.hints.density) spec.look.density = result.hints.density;
  spec.meta = spec.meta || {};
  spec.meta.lookSource = {
    image: String(img),
    confidence: result.theme.confidence,
    candidates: result.theme.candidates,
    at: new Date().toISOString(),
  };
  const merged = JSON.stringify(spec, null, 2) + '\n';
  if (out && out !== true) {
    fs.mkdirSync(path.dirname(path.resolve(String(out))), { recursive: true });
    fs.writeFileSync(path.resolve(String(out)), merged);
    console.log(`[from-reference] theme=${result.theme.id} → ${out}`);
  } else {
    console.log(merged);
  }
} else if (out && out !== true) {
  fs.mkdirSync(path.dirname(path.resolve(String(out))), { recursive: true });
  fs.writeFileSync(path.resolve(String(out)), JSON.stringify(result, null, 2) + '\n');
  console.log(`[from-reference] theme=${result.theme.id} (${result.theme.name}) confidence=${result.theme.confidence}${result.warning ? ` !! ${result.warning}` : ''} → ${out}`);
} else {
  console.log(JSON.stringify(result, null, 2));
}
