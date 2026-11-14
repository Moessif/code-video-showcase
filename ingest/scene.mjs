#!/usr/bin/env node
/**
 * ingest/scene.mjs — 场景切点与静音检测（ffmpeg 滤镜输出解析）。
 *
 *   detectScenes('clip.mp4', 0.35)   // → [{t:0, score:0}, {t:12.4, score:0.62}, …, {t:61.2, score:0}]
 *   detectSilence('clip.mp4', {noiseDb:-35, minDur:0.6}) // → [{start, end, dur}]
 *
 * 设计：
 *   - 切点用 `select='gt(scene,THRESH)',metadata=print`，同时拿到 pts_time 与
 *     lavfi.scene_score（ffmpeg ≥ 4 即可）；旧构建没有 metadata 滤镜时回退 showinfo。
 *   - 没有音轨/视频轨时返回空数组，不报错（静音/场景对纯音频/纯视频各自无意义）。
 *   - 解析函数单独导出，便于用真实 ffmpeg 输出片段做离线单测。
 */
import { spawnSync } from 'node:child_process';
import { probe, ffmpegBin, IngestError } from './probe.mjs';

const round3 = (x) => Math.round(Number(x) * 1000) / 1000;
const tail = (s, n = 700) => {
  const text = String(s || '').trim();
  return text.length > n ? `…${text.slice(-n)}` : text;
};

/**
 * 解析 `select=…,metadata=print`（或 showinfo）的 stderr。
 * @returns {{t:number, score:number}[]} score 是 lavfi.scene_score；无 score 时记 0
 */
export function parseSceneOutput(text) {
  const out = [];
  let pending = null;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const timeMatch = /pts_time:\s*([0-9]+(?:\.[0-9]+)?)/.exec(line);
    if (timeMatch) {
      if (pending) out.push(pending);
      pending = { t: round3(Number(timeMatch[1])), score: 0 };
      continue;
    }
    const scoreMatch = /lavfi\.scene_score\s*=\s*([0-9]+(?:\.[0-9]+)?)/.exec(line);
    if (scoreMatch && pending) pending.score = round3(Number(scoreMatch[1]));
  }
  if (pending) out.push(pending);
  return out;
}

/**
 * 解析 silencedetect 的输出。
 * @returns {{start:number, end:number|null, dur:number|null}[]} 结尾未闭合的静音 end=null
 */
export function parseSilenceOutput(text) {
  const out = [];
  let start = null;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const startMatch = /silence_start:\s*(-?[0-9]+(?:\.[0-9]+)?)/.exec(line);
    if (startMatch) {
      if (start !== null) out.push({ start, end: null, dur: null });
      start = round3(Math.max(0, Number(startMatch[1])));
      continue;
    }
    const endMatch = /silence_end:\s*(-?[0-9]+(?:\.[0-9]+)?)(?:\s*\|\s*silence_duration:\s*([0-9]+(?:\.[0-9]+)?))?/.exec(line);
    if (endMatch && start !== null) {
      const end = round3(Math.max(start, Number(endMatch[1])));
      const dur = endMatch[2] !== undefined ? round3(Number(endMatch[2])) : round3(end - start);
      out.push({ start, end, dur });
      start = null;
    }
  }
  if (start !== null) out.push({ start, end: null, dur: null });
  return out;
}

function runFfmpeg(args) {
  return spawnSync(ffmpegBin(), ['-hide_banner', ...args], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });
}

function ffmpegFailure(label, r) {
  if (r.error?.code === 'ENOENT') {
    return new IngestError(
      `ffmpeg not found (tried "${ffmpegBin()}"). Install ffmpeg or set FFMPEG_PATH.`,
      'E_NO_FFMPEG',
      r.error,
    );
  }
  return new IngestError(`${label} failed (exit ${r.status}): ${tail(r.stderr)}`, 'E_FFMPEG', r.stderr);
}

const NO_STREAM = /matches no streams|does not contain any stream|Stream map .* matches no streams/i;

/**
 * 检测场景切点，结果一定包含 0 与 duration 两个边界点。
 * @param {string} file
 * @param {number} threshold scene 阈值 (0,1]，越高切点越少
 */
export function detectScenes(file, threshold = 0.35) {
  const th = Number(threshold);
  if (!Number.isFinite(th) || th <= 0 || th > 1) {
    throw new IngestError(`detectScenes: threshold must be in (0,1], got ${threshold}`, 'E_ARG');
  }

  const info = probe(file);
  if (!info.hasVideo) return []; // 纯音频：没有画面可切
  const duration = Number(info.duration) || 0;

  let r = runFfmpeg([
    '-nostats', '-i', info.path, '-an',
    '-filter:v', `select='gt(scene,${th})',metadata=print`,
    '-f', 'null', '-',
  ]);

  // 极老的 ffmpeg 没有 metadata 滤镜：退回 showinfo（只有时间，没有 score）
  if (r.status !== 0 && /metadata/i.test(String(r.stderr)) && !NO_STREAM.test(String(r.stderr))) {
    r = runFfmpeg([
      '-nostats', '-i', info.path, '-an',
      '-filter:v', `select='gt(scene,${th})',showinfo`,
      '-f', 'null', '-',
    ]);
  }
  if (r.status !== 0) {
    if (NO_STREAM.test(String(r.stderr))) return [];
    throw ffmpegFailure(`scene detection on ${info.path}`, r);
  }

  const cuts = parseSceneOutput(r.stderr)
    .filter((c) => c.t > 0)
    .filter((c) => !duration || c.t < duration - 1e-3)
    .sort((a, b) => a.t - b.t);

  // 同一时刻的重复切点合并（保留更高的 score）
  const merged = [];
  for (const c of cuts) {
    const prev = merged[merged.length - 1];
    if (prev && Math.abs(prev.t - c.t) <= 1e-3) prev.score = Math.max(prev.score, c.score);
    else merged.push({ ...c });
  }

  const points = [{ t: 0, score: 0 }, ...merged];
  if (duration > 0) points.push({ t: round3(duration), score: 0 });
  return points;
}

/**
 * 检测静音段。
 * @param {string} file
 * @param {{noiseDb?:number, minDur?:number}} opts noiseDb 阈值(dB，负数)，minDur 最短静音(秒)
 */
export function detectSilence(file, { noiseDb = -35, minDur = 0.6 } = {}) {
  const db = Number(noiseDb);
  const dur = Number(minDur);
  if (!Number.isFinite(db) || db >= 0) throw new IngestError(`detectSilence: noiseDb must be negative, got ${noiseDb}`, 'E_ARG');
  if (!Number.isFinite(dur) || dur <= 0) throw new IngestError(`detectSilence: minDur must be > 0, got ${minDur}`, 'E_ARG');

  const info = probe(file);
  if (!info.hasAudio) return []; // 无音轨：静音检测无意义，返回空数组
  const total = Number(info.duration) || 0;

  const r = runFfmpeg([
    '-nostats', '-i', info.path, '-vn',
    '-af', `silencedetect=noise=${db}dB:d=${dur}`,
    '-f', 'null', '-',
  ]);
  if (r.status !== 0) {
    if (NO_STREAM.test(String(r.stderr))) return [];
    throw ffmpegFailure(`silence detection on ${info.path}`, r);
  }

  const silence = parseSilenceOutput(r.stderr).map((s) => {
    const end = s.end === null ? round3(total) : s.end;
    return { start: s.start, end, dur: round3(Math.max(0, end - s.start)) };
  });
  return silence
    .filter((s) => s.dur >= dur - 1e-3)
    .filter((s) => total <= 0 || s.start < total - 1e-3)
    .sort((a, b) => a.start - b.start);
}

/** 静音段取补集 → 有声区间（ASR 不可用时的 VAD 代理）。 */
export function voicedIntervals(silence, duration) {
  const total = Number(duration) || 0;
  const out = [];
  let cursor = 0;
  for (const s of [...silence].sort((a, b) => a.start - b.start)) {
    if (s.start > cursor + 1e-3) out.push({ start: round3(cursor), end: round3(s.start) });
    cursor = Math.max(cursor, s.end ?? total);
  }
  if (total > 0 && total > cursor + 1e-3) out.push({ start: round3(cursor), end: round3(total) });
  return out.filter((v) => v.end - v.start > 1e-3);
}
