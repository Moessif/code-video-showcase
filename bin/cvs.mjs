#!/usr/bin/env node
/**
 * cvs — code-video-showcase 统一入口。
 *
 *   cvs new "帮我做个赛博像素的宣传片，30秒竖屏" --out project.spec.json
 *   cvs ref poster.jpg --spec project.spec.json --out project.spec.json
 *   cvs lint project.spec.json --root .
 *   cvs build project.spec.json --platform douyin --strict
 *   cvs again --set look.theme=amber-noir
 *   cvs deliver --spec project.spec.json
 *
 * 所有命令都是对现有脚本的薄封装；不引入新依赖。
 * 退出码：0 成功；2 用法/未知命令；10 spec；11 render；12 concat；13 qa；14 env。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; }
  catch { return '0.0.0'; }
})();
const [cmd, ...rest] = process.argv.slice(2);

const node = (script, args) => spawnSync(process.execPath, [path.join(ROOT, script), ...args], {
  cwd: process.cwd(), stdio: 'inherit', windowsHide: true,
});

const hasSpec = fs.existsSync(path.join(process.cwd(), 'project.spec.json'));
const specArgs = (args) => {
  if (args.length && !args[0].startsWith('--')) return ['--spec', ...args];
  if (hasSpec) return ['--spec', 'project.spec.json', ...args];
  return args;
};

// R2-35（N01-F5）：`cvs wizard --help` 以前不打印帮助反而起服务占住 5181。
// surface 命令统一：--help/-h 只打一行用法+URL 就退出，端口绝不进入 LISTENING。
const SURFACES = { wizard: 5181, canvas: 5182, script: 5183, versions: 5184, review: 5185 };
function surface(name, port, args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`cvs ${name} — start the ${name} dev surface (static server, port ${port})
usage: cvs ${name} [--port <n>]
  URL: http://127.0.0.1:${port}/app/${name}/
  Ctrl+C stops the server. This command does not build a film; use \`cvs build\` for that.`);
    process.exit(0);
  }
  return node(`app/${name}/serve.mjs`, args);
}

const commands = {
  new:      (a) => node('scripts/nl2spec.mjs', a),
  ref:      (a) => node('scripts/from-reference.mjs', a.length && !a[0].startsWith('--') ? ['--img', ...a] : a),
  lint:     (a) => node('scripts/spec-lint.mjs', specArgs(a)),
  plan:     (a) => node('templates/plan.mjs', specArgs(a)),
  build:    (a) => node('scripts/compile.mjs', specArgs(a)),
  compile:  (a) => node('scripts/compile.mjs', specArgs(a)),
  again:    (a) => node('scripts/again.mjs', a),
  deliver:  (a) => node('scripts/deliver.mjs', specArgs(a)),
  snapshot: (a) => node('scripts/versions.mjs', ['snapshot', ...specArgs(a)]),
  rollback: (a) => node('scripts/versions.mjs', ['rollback', ...a]),
  history:  (a) => node('scripts/versions.mjs', ['list', ...a]),
  verify:   (a) => node('scripts/versions.mjs', ['verify', ...a]),
  variant:  (a) => node('scripts/variants.mjs', specArgs(a)),
  variants: (a) => node('scripts/variants.mjs', specArgs(a)),
  ingest:   (a) => node('ingest/cli.mjs', a.length && !a[0].startsWith('--') ? ['--input', ...a] : a),
  doctor:   (a) => node('scripts/doctor.mjs', a),
  errors:   (a) => node('scripts/errors.mjs', a),
  brand:    (a) => node('scripts/brand.mjs', a),
  golden:   (a) => node('scripts/golden.mjs', a),
  image:    (a) => node('scripts/image.mjs', a),
  motion:   (a) => node('scripts/motion.mjs', a),
  api:      (a) => node('server/api.mjs', a),
  wizard:   (a) => surface('wizard', SURFACES.wizard, a),
  canvas:   (a) => surface('canvas', SURFACES.canvas, a),
  script:   (a) => surface('script', SURFACES.script, a),
  versions: (a) => surface('versions', SURFACES.versions, a),
  review:   (a) => surface('review', SURFACES.review, a),
  test:     (a) => node('scripts/test-all.mjs', a),
};

function help() {
  console.log(`cvs ${VERSION} — video compiler

usage: cvs <command> [args]

  new "<text>" [--out spec.json]         natural language -> spec (deterministic rules)
  ref <image> [--spec spec] [--out f]    reference image -> theme / accent / density
  lint <spec> [--root .] [--strict]      pages / theme / APCA / placeholder gates
  plan <spec> [--print]                  spec -> plan.json with per-segment hashes
  build <spec> [--audio f|--no-audio] [--platform douyin] [--strict] [--burn-subtitles] [--cover]
               [--transition fade|wipeleft|circleopen|...] [--transition-duration 0.4]
                                         validate -> plan -> incremental render -> concat(xfade) -> qa
  again [--set k=v] [--no-build]         edit last spec + rebuild only dirty segments
  deliver [--spec f] [--json] [--cover img]  delivery.json + master.srt/.vtt + cover
  snapshot [--spec f] [--label name]     version snapshot of master/spec/plan/qa (+ review.json)
  history [--spec f] [--json]            list version snapshots in <outDir>/versions
  verify <version> [--spec f]            re-hash a snapshot against its record
  rollback <version> [--spec f]          restore a verified snapshot to outDir
  variant <spec> --axes <file> [--out d] cartesian variants + manifest (one outDir per variant)
  ingest <file|dir> --target <sec>       footage -> EDL + spec draft
  brand apply|check|list                 brand kit apply / compliance check
  motion list|show|derive|matrix         motion profile levels + kind×style derivation
  golden [--update|--selfcheck]          byte-exact still regression
  image [--spec f] [--set a,b] [--at t]  spec -> image set (cover/card/poster/story/...); --list shows presets
  api [--port 5190] [--host h] [--token t]  job-queue HTTP service (origin-checked)
  wizard | canvas | script | versions | review    start a dev surface (5181-5185)
  test [--browser]                       run all suites
  doctor                                 environment check (renderer capability probe)
  errors [--check|--write]               error-code registry / docs/ERRORS.md

default spec: ./project.spec.json when present.
exit codes: 0 ok · 2 usage · 10 spec · 11 render · 12 concat · 13 qa · 14 env`);
}

if (cmd === '--version' || cmd === '-V' || cmd === 'version') {
  console.log(VERSION);
  process.exit(0);
}

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  help();
  process.exit(0);
}

if (!commands[cmd]) {
  console.error(`[error] [E_UNKNOWN_COMMAND] ${cmd}`);
  console.error(`run "cvs --help" to see the ${Object.keys(commands).length} supported commands`);
  process.exit(2);
}

const r = commands[cmd](rest);
process.exit(r.status ?? 1);
