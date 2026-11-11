#!/usr/bin/env node
/**
 * cvs — code-video-showcase 统一入口。
 *
 *   cvs new "帮我做个赛博像素的宣传片，30秒竖屏" --out project.spec.json
 *   cvs ref poster.jpg --spec project.spec.json --out project.spec.json
 *   cvs lint project.spec.json --root .
 *   cvs build project.spec.json --concurrency 4
 *   cvs variant project.spec.json --axes axes.json --out out/variants
 *   cvs ingest ./footage --target 60 --out out/ingest
 *   cvs wizard | canvas | script | versions
 *   cvs test [--browser]
 *
 * 所有命令都是对现有脚本的薄封装；不引入新依赖。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

const commands = {
  new:      (a) => node('scripts/nl2spec.mjs', a),
  ref:      (a) => node('scripts/from-reference.mjs', a.length && !a[0].startsWith('--') ? ['--img', ...a] : a),
  lint:     (a) => node('scripts/spec-lint.mjs', specArgs(a)),
  plan:     (a) => node('templates/plan.mjs', specArgs(a)),
  build:    (a) => node('scripts/compile.mjs', specArgs(a)),
  compile:  (a) => node('scripts/compile.mjs', specArgs(a)),
  variant:  (a) => node('scripts/variants.mjs', specArgs(a)),
  variants: (a) => node('scripts/variants.mjs', specArgs(a)),
  ingest:   (a) => node('ingest/cli.mjs', a.length && !a[0].startsWith('--') ? ['--input', ...a] : a),
  doctor:   (a) => node('scripts/doctor.mjs', a),
  brand:    (a) => node('scripts/brand.mjs', a),
  golden:   (a) => node('scripts/golden.mjs', a),
  api:      (a) => node('server/api.mjs', a),
  wizard:   () => node('app/wizard/serve.mjs', []),
  canvas:   () => node('app/canvas/serve.mjs', []),
  script:   () => node('app/script/serve.mjs', []),
  versions: () => node('app/versions/serve.mjs', []),
  review:   () => node('app/review/serve.mjs', []),
  test:     (a) => {
    const suites = [
      'scripts/test-core.mjs',
      'scripts/test-nl2spec.mjs',
      'scripts/test-script.mjs',
      'scripts/test-assets.mjs',
      'scripts/test-variants.mjs',
      'scripts/test-reflow.mjs',
      'scripts/test-ref-core.mjs',
      'scripts/test-from-reference.mjs',
      'scripts/test-brand.mjs',
      'ingest/test-edl.mjs',
    ];
    if (a.includes('--browser')) {
      suites.push(
        'scripts/test-inspect.mjs',
        'scripts/test-wizard-ref.mjs',
        'scripts/test-reflow-pages.mjs',
        'scripts/still-cyber-pixel.mjs',
        'scripts/test-recipes.mjs',
        'server/test-api.mjs',
      );
    }
    for (const s of suites) {
      console.log(`\n=== ${s} ===`);
      const r = node(s, []);
      if (r.status !== 0) process.exit(r.status || 1);
    }
  },
};

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h' || !commands[cmd]) {
  console.log(`cvs — video compiler

usage: cvs <command> [args]

  new "<text>" [--out spec.json]         natural language -> spec (deterministic rules)
  ref <image> [--spec spec] [--out f]    reference image -> theme / accent / density
  lint <spec> [--root .]                 pages / theme / APCA / structure gates
  plan <spec> [--print]                  spec -> plan.json with per-segment hashes
  build <spec> [--audio f] [--concurrency n] [--no-qa]
                                         lint -> plan -> incremental render -> concat -> qa
  variant <spec> --axes <file> [--out d] cartesian variants + manifest
  ingest <file|dir> --target <sec>       footage -> EDL + spec draft
  brand apply|check|list                 brand kit apply / compliance check
  golden [--update|--selfcheck]          byte-exact still regression
  api [--port 5190]                      job-queue HTTP service
  wizard | canvas | script | versions | review    start a dev surface (5181-5185)
  test [--browser]                       run all suites
  doctor                                 environment check

default spec: ./project.spec.json when present.`);
  process.exit(cmd && cmd !== 'help' && cmd !== '--help' && cmd !== '-h' ? 2 : 0);
}

const r = commands[cmd](rest);
process.exit(r.status ?? 1);
