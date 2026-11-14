#!/usr/bin/env node
/**
 * ingest/asr.mjs — 可选 ASR 适配层（本仓库不安装、不调用网络）。
 *
 * 只做两件事：
 *   1. 在 PATH 上找 whisper / faster-whisper / whisper-ctranslate2；
 *   2. 找到就用它跑一遍，返回带词级时间戳的 JSON 路径与规整后的 segments/words。
 *
 * 找不到时返回 {available:false, reason} —— 绝不假装成功，绝不返回空转写当结果。
 *
 *   const st = detectEngines();
 *   if (st.available) transcribe('clip.mp4', {model:'small', lang:'zh', outDir:'out/asr'});
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { IngestError } from './probe.mjs';

/** 引擎优先级：先 ctranslate2（CPU 快），再 faster-whisper，最后官方 whisper。 */
export const ASR_ENGINES = Object.freeze([
  { id: 'whisper-ctranslate2', cmd: 'whisper-ctranslate2', kind: 'whisper', label: 'Whisper (ctranslate2)' },
  { id: 'faster-whisper', cmd: 'faster-whisper', kind: 'whisper', label: 'faster-whisper' },
  { id: 'whisper', cmd: 'whisper', kind: 'whisper', label: 'openai-whisper' },
]);

const tail = (s, n = 700) => {
  const text = String(s || '').trim();
  return text.length > n ? `…${text.slice(-n)}` : text;
};

function isExecutable(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return false;
    if (process.platform === 'win32') return true; // .exe/.cmd/.bat 由 PATHEXT 保证
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 在 PATH 上找可执行文件（Windows 会按 PATHEXT 补扩展名）。
 * @returns {string|null}
 */
export function findExecutable(cmd, { pathEnv = process.env.PATH || '', pathext = process.env.PATHEXT } = {}) {
  if (!cmd) return null;
  const sep = process.platform === 'win32' ? ';' : ':';
  const dirs = String(pathEnv)
    .split(sep)
    .map((d) => d.replace(/^"|"$/g, '').trim())
    .filter(Boolean);
  const exts = process.platform === 'win32'
    ? String(pathext || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      if (isExecutable(candidate)) return path.resolve(candidate);
    }
  }
  return null;
}

/**
 * 探测本机可用的 ASR 引擎。
 * @returns {{available:boolean, engine:{id,cmd,kind,label,path}|null, engines:Array, reason:string}}
 */
export function detectEngines(opts = {}) {
  const engines = [];
  for (const e of ASR_ENGINES) {
    const p = findExecutable(e.cmd, opts);
    if (p) engines.push({ ...e, path: p });
  }
  const engine = engines[0] || null;
  const reason = engine
    ? ''
    : `no ASR engine on PATH (looked for ${ASR_ENGINES.map((e) => e.cmd).join(', ')}); ` +
      'install faster-whisper / whisper-ctranslate2 / openai-whisper, or skip ASR';
  return { available: Boolean(engine), engine, engines, reason };
}

/** 统一整理 whisper 系 JSON：segments + words（词级时间戳可能没有）。 */
export function parseAsrJson(json) {
  const rawSegments = Array.isArray(json?.segments) ? json.segments : [];
  const segments = [];
  const words = [];
  for (const s of rawSegments) {
    const t0 = Number(s.start);
    const t1 = Number(s.end);
    segments.push({
      t0: Number.isFinite(t0) ? Math.round(t0 * 1000) / 1000 : 0,
      t1: Number.isFinite(t1) ? Math.round(t1 * 1000) / 1000 : 0,
      text: String(s.text ?? '').trim(),
    });
    if (Array.isArray(s.words)) {
      for (const w of s.words) {
        const a = Number(w.start);
        const b = Number(w.end);
        const text = String(w.word ?? w.text ?? '').trim();
        if (!text) continue;
        words.push({
          w: text,
          t0: Number.isFinite(a) ? Math.round(a * 1000) / 1000 : 0,
          t1: Number.isFinite(b) ? Math.round(b * 1000) / 1000 : 0,
        });
      }
    }
  }
  return { segments, words, wordLevel: words.length > 0 };
}

function buildArgs(engine, file, { model, lang, outDir }) {
  const args = [
    file,
    '--model', String(model),
    '--language', String(lang),
    '--output_format', 'json',
    '--output_dir', outDir,
    '--word_timestamps', 'True',
  ];
  if (engine.kind === 'whisper' && engine.id === 'faster-whisper') {
    // faster-whisper 的 CLI 默认就是 ctranslate2；显式指定避免落到 torch 后端
    args.push('--device', 'auto');
  }
  return args;
}

/**
 * 转写一个媒体文件。没有引擎时返回 {available:false, reason}。
 * 有引擎但执行失败时抛 IngestError（不返回半成品）。
 *
 * @param {string} file
 * @param {{model?:string, lang?:string, outDir?:string, engineId?:string, timeoutMs?:number}} opts
 */
export function transcribe(file, opts = {}) {
  const { model = 'small', lang = 'zh', outDir, engineId, timeoutMs = 0 } = opts;
  const status = detectEngines();
  if (!status.available) {
    return { available: false, reason: status.reason, engines: status.engines, segments: [], words: [] };
  }
  const engine = engineId ? status.engines.find((e) => e.id === engineId) : status.engine;
  if (!engine) {
    return {
      available: false,
      reason: `requested ASR engine "${engineId}" not found; available: ${status.engines.map((e) => e.id).join(', ') || '(none)'}`,
      engines: status.engines,
      segments: [],
      words: [],
    };
  }

  if (!file) throw new IngestError('transcribe(file): file path is required', 'E_ARG');
  const abs = path.resolve(String(file));
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new IngestError(`file not found: ${abs}`, 'E_NOT_FOUND');
  }
  if (!stat.isFile()) throw new IngestError(`not a file: ${abs}`, 'E_NOT_FILE');

  const out = path.resolve(String(outDir || path.join(os.tmpdir(), 'cvs-asr')));
  fs.mkdirSync(out, { recursive: true });

  const args = buildArgs(engine, abs, { model, lang, outDir: out });
  const r = spawnSync(engine.path, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    timeout: Number(timeoutMs) > 0 ? Number(timeoutMs) : undefined,
  });
  if (r.error) {
    throw new IngestError(`failed to run ${engine.id}: ${r.error.message}`, 'E_ASR_FAILED', r.error);
  }
  if (r.status !== 0) {
    throw new IngestError(
      `ASR failed (engine=${engine.id}, exit ${r.status}): ${tail(r.stderr)}`,
      'E_ASR_FAILED',
      r.stderr,
    );
  }

  const jsonPath = path.join(out, `${path.basename(abs, path.extname(abs))}.json`);
  if (!fs.existsSync(jsonPath)) {
    throw new IngestError(
      `ASR produced no JSON at ${jsonPath} (engine=${engine.id}); stderr: ${tail(r.stderr)}`,
      'E_ASR_NO_OUTPUT',
      r.stderr,
    );
  }
  let json;
  try {
    json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    throw new IngestError(`ASR JSON is not valid JSON: ${jsonPath}: ${e.message}`, 'E_ASR_BAD_JSON');
  }

  const parsed = parseAsrJson(json);
  return {
    available: true,
    ok: true,
    engine: engine.id,
    enginePath: engine.path,
    model: String(model),
    lang: String(lang),
    json: jsonPath,
    ...parsed,
  };
}
