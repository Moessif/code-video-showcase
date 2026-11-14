#!/usr/bin/env node
/**
 * motion.mjs — 动效档位的查看与推导（v2.3）。
 *
 *   node scripts/motion.mjs                       # 列出全部档位
 *   node scripts/motion.mjs list
 *   node scripts/motion.mjs show dynamic          # 看某个档位的完整参数
 *   node scripts/motion.mjs derive --kind promo --style cyber-pixel
 *   node scripts/motion.mjs derive --kind launch --style minimal --json
 *   node scripts/motion.mjs matrix                # kind × style 推导矩阵
 *
 * 退出码 0/1。纯 Node，无浏览器。
 */
import {
  MOTION_LEVELS, MOTION_PROFILES, deriveMotionProfile, motionParams, motionSummary,
} from '../templates/motion-profile.mjs';
import { KIND_IDS, STYLE_IDS } from './nl2spec.mjs';

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
const cmd = args._[0] || 'list';

// 从单一真值导入，避免矩阵展示与真实推导表漂移（v2.5.2 审计 F2）。
const KINDS = KIND_IDS;
const STYLES = STYLE_IDS;

function showProfile(level, asJson) {
  const p = motionParams(level);
  if (asJson) {
    console.log(JSON.stringify(p, null, 2));
    return;
  }
  console.log(`${p.label}（${p.level}）`);
  console.log(`  ${p.description}`);
  console.log('');
  const rows = [
    ['transition', p.transition], ['ease', p.ease], ['easeOut', p.easeOut], ['spring', p.spring],
    ['kineticMode', p.kineticMode], ['texture', p.texture],
    ['stagger', p.stagger], ['impact', p.impact], ['blur', p.blur],
    ['grain', p.grain], ['scanlines', p.scanlines],
    ['shake', p.shake], ['flash', p.flash], ['push', p.push],
  ];
  for (const [k, v] of rows) console.log(`  ${k.padEnd(12)} ${v}`);
}

function listProfiles(asJson) {
  if (asJson) {
    console.log(JSON.stringify(MOTION_LEVELS.map((l) => motionParams(l)), null, 2));
    return;
  }
  console.log('动效档位（v2.3）\n');
  for (const l of MOTION_LEVELS) {
    const p = motionParams(l);
    console.log(`  ${l.padEnd(9)} ${p.label.padEnd(4)}  ${p.description}`);
  }
  console.log('\n用法：cvs new "..." --motion <calm|standard|dynamic|maximal>');
}

function derive(args) {
  const kind = args.kind ? String(args.kind) : null;
  const style = args.style ? String(args.style) : null;
  const level = deriveMotionProfile({ kind, style, level: args.level && args.level !== true ? String(args.level) : null });
  if (args.json) {
    console.log(JSON.stringify({ kind, style, level, profile: motionParams(level) }, null, 2));
    return;
  }
  console.log(`kind=${kind || '(未指定)'} × style=${style || '(未指定)'}`);
  console.log(`→ ${motionSummary(level)}`);
}

function matrix() {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`kind \\ style`.padEnd(16) + STYLES.map((s) => pad(s.slice(0, 6), 7)).join(''));
  for (const k of KINDS) {
    console.log(pad(k, 16) + STYLES.map((s) => pad(deriveMotionProfile({ kind: k, style: s }), 7)).join(''));
  }
}

switch (cmd) {
  case 'list':
    listProfiles(!!args.json);
    break;
  case 'show': {
    const level = args._[1];
    if (!level || !MOTION_LEVELS.includes(level)) {
      console.error(`unknown level "${level || ''}"; expected one of ${MOTION_LEVELS.join('|')}`);
      process.exit(1);
    }
    showProfile(level, !!args.json);
    break;
  }
  case 'derive':
    derive(args);
    break;
  case 'matrix':
    matrix();
    break;
  default:
    console.error(`unknown command "${cmd}"; expected list | show | derive | matrix`);
    process.exit(1);
}
