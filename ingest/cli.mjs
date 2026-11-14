#!/usr/bin/env node
/**
 * ingest/cli.mjs — 素材 → 分析 → EDL → spec 的一条命令。
 *
 *   node ingest/cli.mjs --input <file|dir> --target 60 --out out/ingest
 *
 * 步骤：1) probe  2) 场景切点  3) 静音  4) 可选 ASR  5) buildEDL  6) 写
 *       <out>/edl.json 与 <out>/project.spec.json（script 作者模式）。
 *
 * 退出码：0 成功；1 运行失败（含生成的 spec 校验不过）；2 用法/没有输入文件。
 */
import fs from 'node:fs';
import path from 'node:path';

import { probe, collectMedia, IngestError } from './probe.mjs';
import { detectScenes, detectSilence, voicedIntervals } from './scene.mjs';
import { detectEngines, transcribe } from './asr.mjs';
import { buildEDL, edlToScript } from './edl.mjs';
import { normalizeSpec, validateSpec, specDuration } from '../templates/spec.mjs';

const USAGE = `Usage: node ingest/cli.mjs --input <file|dir> --target 60 --out out/ingest [options]

  --input <path>      素材文件或目录（mp4/mov/mkv/webm/m4v/mp3/wav/m4a）
  --target <sec>      目标片长，默认 60
  --out <dir>         输出目录，默认 out/ingest
  --threshold <n>     场景切分阈值 0..1，默认 0.35
  --noise <db>        静音阈值（负数 dB），默认 -35
  --min-dur <sec>     最短静音，默认 0.6
  --min-shot <sec>    单镜头下限，默认 1.2
  --max-shot <sec>    单镜头上限，默认 6
  --round <sec>       spec 每轮时长下限，默认 4
  --opening <sec>     片头时长，默认 3      --ending <sec> 片尾，默认 2.5
  --more <sec>        “还有更多”卡时长，默认 1
  --theme <id>        主题 id，默认 coral-noir
  --name <str>        spec.meta.name，默认取输入名
  --asr / --no-asr    是否尝试词级转写（默认 auto：有引擎就跑）
  --model <name>      ASR 模型，默认 small     --lang <code> 语言，默认 zh
  --help              显示本帮助

示例：
  node ingest/cli.mjs --input out/demo.mp4 --target 3 --out out/ingest-demo
  node ingest/cli.mjs --input footage/ --target 60 --threshold 0.3 --no-asr`;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function usage(code) {
  const log = code === 0 ? console.log : console.error;
  log(USAGE);
  process.exit(code);
}

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const fmt = (n, digits = 2) => Number(n).toFixed(digits);
const baseName = (p) => path.basename(String(p).replace(/[\\/]+$/, '')) || 'ingest';

/** 由场景切点生成候选镜头（纯音频则用有声区间）。 */
function shotsFor(info, scenes, silence) {
  if (info.hasVideo) {
    if (scenes.length < 2) {
      return info.duration > 0 ? [{ src: info.path, start: 0, end: info.duration, motion: 0.5 }] : [];
    }
    return scenes
      .slice(0, -1)
      .map((cut, i) => ({
        src: info.path,
        start: cut.t,
        end: scenes[i + 1].t,
        // 切入该镜头的画面变化量：变化越大越可能是动作/转场，作为运动分占位
        motion: Number(cut.score) || 0,
      }))
      .filter((s) => s.end > s.start + 1e-6);
  }
  const voiced = voicedIntervals(silence, info.duration);
  if (voiced.length) return voiced.map((v) => ({ src: info.path, start: v.start, end: v.end, motion: 0.5 }));
  return info.duration > 0 ? [{ src: info.path, start: 0, end: info.duration, motion: 0.5 }] : [];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) usage(0);
  if (!args.input) {
    console.error('[error] --input is required');
    usage(2);
  }

  const target = num(args.target, 60);
  if (!(target > 0)) {
    console.error(`[error] --target must be > 0, got ${args.target}`);
    usage(2);
  }

  let files;
  try {
    files = collectMedia(String(args.input));
  } catch (e) {
    console.error(`[error] ${e.message}`);
    usage(2);
  }
  if (!files.length) {
    console.error(`[error] no media files found in ${path.resolve(String(args.input))}`);
    usage(2);
  }

  const outDir = path.resolve(String(args.out || 'out/ingest'));
  fs.mkdirSync(outDir, { recursive: true });

  const threshold = num(args.threshold, 0.35);
  const noiseDb = num(args.noise, -35);
  const minDur = num(args['min-dur'], 0.6);
  const minShot = num(args['min-shot'], 1.2);
  const maxShot = num(args['max-shot'], 6);

  const wantAsr = args['no-asr'] ? false : true; // auto：有引擎就跑
  const asrStatus = detectEngines();

  const sources = [];
  const sceneReport = [];
  const silenceReport = [];
  const asrReport = [];
  const shots = [];
  const speech = [];

  console.log(`[input]  ${files.length} file(s) → ${outDir}`);

  for (const file of files) {
    const info = probe(file);
    sources.push(info);
    console.log(
      `[probe]  ${info.path}  ${fmt(info.duration)}s  ${info.width}x${info.height}  ` +
      `${fmt(info.fps)}fps  ${info.codec || '?'}  audio=${info.hasAudio ? 'yes' : 'no'}`,
    );

    const scenes = detectScenes(file, threshold);
    const cutCount = Math.max(0, scenes.length - 2);
    sceneReport.push({ path: info.path, threshold, cuts: scenes, shots: cutCount + (info.hasVideo ? 1 : 0) });
    console.log(`[scene]  ${info.path}  ${info.hasVideo ? cutCount + 1 : 0} shot(s), ${cutCount} cut(s)`);

    const silence = detectSilence(file, { noiseDb, minDur });
    silenceReport.push({ path: info.path, noiseDb, minDur, silence });
    console.log(
      info.hasAudio
        ? `[silence] ${info.path}  ${silence.length} silent span(s)` +
          (silence.length ? ` (${silence.map((s) => `${fmt(s.start)}–${fmt(s.end)}`).join(', ')})` : '')
        : `[silence] ${info.path}  no audio track → 0 span(s)`,
    );

    // 可选 ASR：失败不冒充成功，退回 VAD 代理（有声区间）
    let asr = null;
    if (wantAsr && asrStatus.available) {
      try {
        asr = transcribe(file, {
          model: args.model || 'small',
          lang: args.lang || 'zh',
          outDir: path.join(outDir, 'asr'),
        });
      } catch (e) {
        asr = { available: true, ok: false, error: e.message };
        console.error(`[asr]    ${info.path}  failed: ${e.message}`);
      }
    }
    if (!asr) {
      asr = { available: false, reason: asrStatus.reason, skipped: !wantAsr ? 'disabled by --no-asr' : 'no engine' };
    }
    asrReport.push({
      path: info.path,
      available: asr.available,
      ok: Boolean(asr.ok),
      engine: asr.engine || null,
      json: asr.json || null,
      wordLevel: Boolean(asr.wordLevel),
      segments: asr.segments ? asr.segments.length : 0,
      error: asr.error,
      reason: asr.reason,
    });

    if (asr.ok) {
      for (const s of asr.segments) speech.push({ src: info.path, start: s.t0, end: s.t1 });
      console.log(`[asr]    ${info.path}  ${asr.engine} · ${asr.segments.length} segment(s) · wordLevel=${asr.wordLevel}`);
    } else if (info.hasAudio) {
      for (const v of voicedIntervals(silence, info.duration)) speech.push({ src: info.path, start: v.start, end: v.end });
      console.log(`[asr]    ${info.path}  unavailable (${asr.reason || asr.error}) → VAD 代理（有声区间）`);
    } else {
      console.log(`[asr]    ${info.path}  unavailable (${asr.reason || asr.error}) → 无音轨，speech=[]`);
    }

    const localShots = shotsFor(info, scenes, silence);
    shots.push(...localShots);
    console.log(`[shots]  ${info.path}  ${localShots.length} candidate shot(s)`);
  }

  const edl = buildEDL({ shots, targetDuration: target, minShot, maxShot, speech });
  for (const w of edl.warnings || []) console.warn(`[warn] ${w}`);
  console.log(
    `[edl]    ${edl.clips.length} clip(s) · ${fmt(edl.total)}s / target ${fmt(target)}s ` +
    `(${Math.round((edl.coverage || 0) * 100)}%)${edl.withinTolerance ? '' : ' — outside ±10%'}`,
  );
  if (!edl.clips.length) {
    console.error('[error] EDL is empty: no usable shots (try a lower --min-shot or more footage)');
    process.exit(1);
  }

  const firstVideo = sources.find((s) => s.hasVideo) || null;
  const rawName = baseName(args.input);
  const stripped = path.extname(rawName) ? path.basename(rawName, path.extname(rawName)) : rawName;
  const title = String(args.name || stripped);
  const outRel = path.relative(process.cwd(), outDir).replace(/\\/g, '/') || 'out/ingest';

  const built = edlToScript(edl, {
    round: num(args.round, 4),
    opening: num(args.opening, 3),
    ending: num(args.ending, 2.5),
    more: num(args.more, 1),
    fps: firstVideo && firstVideo.fps > 0 ? firstVideo.fps : 30,
    width: firstVideo && firstVideo.width > 0 ? firstVideo.width : 1920,
    height: firstVideo && firstVideo.height > 0 ? firstVideo.height : 1080,
    theme: args.theme || 'coral-noir',
    title,
    outDir: outRel,
  });
  for (const w of built.warnings || []) console.warn(`[warn] ${w}`);

  const normalized = normalizeSpec(built.spec);
  const issues = validateSpec(normalized);
  const errors = issues.filter((i) => i.level === 'error');
  for (const i of issues) console[i.level === 'error' ? 'error' : 'warn'](`[${i.level}] [${i.code}] ${i.path}: ${i.message}`);
  if (errors.length) {
    console.error(`[error] generated spec has ${errors.length} validation error(s); not writing project.spec.json`);
    process.exit(1);
  }

  const edlPath = path.join(outDir, 'edl.json');
  const specPath = path.join(outDir, 'project.spec.json');

  fs.writeFileSync(edlPath, JSON.stringify({
    version: 1,
    generatedBy: 'ingest/cli.mjs',
    generatedAt: new Date().toISOString(),
    target,
    total: edl.total,
    withinTolerance: edl.withinTolerance,
    coverage: edl.coverage,
    minShot: edl.minShot,
    maxShot: edl.maxShot,
    clips: edl.clips,
    sources,
    analysis: {
      scenes: sceneReport,
      silence: silenceReport,
      asr: asrReport,
      shots: shots.length,
    },
    warnings: edl.warnings || [],
  }, null, 2));

  fs.writeFileSync(specPath, `${JSON.stringify(built.spec, null, 2)}\n`);

  console.log(`[write]  ${edlPath}`);
  console.log(`[write]  ${specPath}`);
  console.log(
    `[spec]   ${normalized.meta.name} · ${normalized.format.width}x${normalized.format.height} · ` +
    `${fmt(specDuration(normalized))}s · ${normalized.rounds.length} rounds · ${normalized.look.theme} · ` +
    `${normalized.script.length} script block(s)`,
  );
}

try {
  main();
} catch (e) {
  if (e instanceof IngestError) console.error(`[error] [${e.code}] ${e.message}`);
  else console.error(`[fatal] ${e && e.stack ? e.stack : e}`);
  process.exit(1);
}
