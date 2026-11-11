#!/usr/bin/env node
/**
 * ingest/probe.mjs — 素材摄取的第一层：ffprobe 元数据 + 目录扫描。
 *
 * 纯 Node（node:child_process），零 npm 依赖。所有错误都带 code，方便 CLI
 * 区分“文件不存在 / 没装 ffprobe / ffprobe 解析失败”。
 *
 *   import { probe, listMedia } from './probe.mjs';
 *   probe('clip.mp4')  // → {path, duration, width, height, fps, codec, hasAudio, ...}
 *   listMedia('footage/') // → ['footage/a.mp4', ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** 支持的扩展名（小写，带点）。 */
export const MEDIA_EXTENSIONS = Object.freeze([
  '.mp4', '.mov', '.mkv', '.webm', '.m4v',
  '.mp3', '.wav', '.m4a',
]);

export class IngestError extends Error {
  constructor(message, code = 'E_INGEST', detail = null) {
    super(message);
    this.name = 'IngestError';
    this.code = code;
    this.detail = detail;
  }
}

export const ffprobeBin = () => process.env.FFPROBE_PATH || 'ffprobe';
export const ffmpegBin = () => process.env.FFMPEG_PATH || 'ffmpeg';

const round3 = (x) => Math.round(Number(x) * 1000) / 1000;
const tail = (s, n = 800) => {
  const text = String(s || '').trim();
  return text.length > n ? `…${text.slice(-n)}` : text;
};

/** "30000/1001" | "30" → 29.97…（保留 3 位） */
export function parseRate(value) {
  if (value === undefined || value === null || value === '') return 0;
  const raw = String(value);
  const [num, den] = raw.split('/').map(Number);
  if (Number.isFinite(num) && Number.isFinite(den) && den > 0) return round3(num / den);
  const single = Number(raw);
  return Number.isFinite(single) ? round3(single) : 0;
}

/** 跑一条 ffprobe，返回解析后的 JSON。 */
function runFfprobe(file, extraArgs = []) {
  const args = ['-v', 'error', '-print_format', 'json', ...extraArgs, file];
  const r = spawnSync(ffprobeBin(), args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (r.error) {
    if (r.error.code === 'ENOENT') {
      throw new IngestError(
        `ffprobe not found (tried "${ffprobeBin()}"). Install ffmpeg or set FFPROBE_PATH.`,
        'E_NO_FFPROBE',
      );
    }
    throw new IngestError(`failed to start ffprobe: ${r.error.message}`, 'E_FFPROBE', r.error);
  }
  if (r.status !== 0) {
    throw new IngestError(`ffprobe failed for ${file} (exit ${r.status}): ${tail(r.stderr)}`, 'E_FFPROBE', r.stderr);
  }
  try {
    return JSON.parse(r.stdout);
  } catch (e) {
    throw new IngestError(`ffprobe returned non-JSON for ${file}: ${e.message}`, 'E_FFPROBE_JSON', r.stdout);
  }
}

/**
 * 读取单个媒体文件的元数据。
 * @param {string} file 文件路径（相对 cwd 或绝对）
 * @returns {{path:string, duration:number, width:number, height:number, fps:number,
 *            codec:string|null, hasAudio:boolean, hasVideo:boolean, bitrate:number,
 *            format:string|null, size:number}}
 */
export function probe(file) {
  if (!file) throw new IngestError('probe(file): file path is required', 'E_ARG');
  const abs = path.resolve(String(file));

  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new IngestError(`file not found: ${abs}`, 'E_NOT_FOUND');
  }
  if (!stat.isFile()) throw new IngestError(`not a file: ${abs}`, 'E_NOT_FILE');

  const json = runFfprobe(abs, ['-show_format', '-show_streams']);
  return normalizeProbe(abs, json, stat.size);
}

/** ffprobe JSON → 扁平的 probe 结果（导出以便单测）。 */
export function normalizeProbe(abs, json, size = 0) {
  const streams = Array.isArray(json?.streams) ? json.streams : [];
  const format = json?.format && typeof json.format === 'object' ? json.format : {};

  const video = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1) || null;
  const audio = streams.find((s) => s.codec_type === 'audio') || null;

  const durationCandidates = [format.duration, video?.duration, audio?.duration]
    .map(Number)
    .filter((v) => Number.isFinite(v) && v > 0);
  const duration = durationCandidates.length ? round3(Math.max(...durationCandidates)) : 0;

  const fps = video ? parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate) : 0;
  const bitrateCandidates = [format.bit_rate, ...streams.map((s) => s.bit_rate)]
    .map(Number)
    .filter((v) => Number.isFinite(v) && v > 0);
  const bitrate = bitrateCandidates.length ? Math.round(Math.max(...bitrateCandidates)) : 0;

  const codec = video?.codec_name || audio?.codec_name || null;

  return {
    path: abs,
    duration,
    width: video ? Number(video.width) || 0 : 0,
    height: video ? Number(video.height) || 0 : 0,
    fps,
    codec,
    hasAudio: Boolean(audio),
    hasVideo: Boolean(video),
    bitrate,
    format: format.format_name ? String(format.format_name).split(',')[0] : null,
    size: Number(size) || 0,
  };
}

/** 文件名是否属于支持的媒体类型。 */
export function isMediaFile(file) {
  return MEDIA_EXTENSIONS.includes(path.extname(String(file)).toLowerCase());
}

/**
 * 列目录下的媒体文件（不递归，按文件名排序）。
 * @param {string} dir
 * @returns {string[]} 绝对路径
 */
export function listMedia(dir) {
  if (!dir) throw new IngestError('listMedia(dir): directory is required', 'E_ARG');
  const abs = path.resolve(String(dir));

  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new IngestError(`directory not found: ${abs}`, 'E_NOT_FOUND');
  }
  if (!stat.isDirectory()) throw new IngestError(`not a directory: ${abs}`, 'E_NOT_DIR');

  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter(isMediaFile)
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((name) => path.join(abs, name));
}

/**
 * CLI 入口：接受文件或目录，统一展开成媒体文件列表。
 * 目录按 listMedia 展开；文件则校验扩展名。
 */
export function collectMedia(input) {
  if (!input) throw new IngestError('collectMedia(input): path is required', 'E_ARG');
  const abs = path.resolve(String(input));
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new IngestError(`input not found: ${abs}`, 'E_NOT_FOUND');
  }
  if (stat.isDirectory()) return listMedia(abs);
  if (!isMediaFile(abs)) {
    throw new IngestError(
      `unsupported media type "${path.extname(abs) || '(none)'}" — supported: ${MEDIA_EXTENSIONS.join(' ')}`,
      'E_UNSUPPORTED',
    );
  }
  return [abs];
}
