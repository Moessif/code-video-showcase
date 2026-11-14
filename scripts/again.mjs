#!/usr/bin/env node
/**
 * again.mjs — 「再来一版」：读上一次的 spec，改几个字段，只重编译受影响段。
 *
 *   cvs again --set look.theme=amber-noir
 *   cvs again --project out/variants/abc123 --set rounds.0.card.first=上新 --build
 *   cvs again --set look.motion=maximal --no-build --print
 *
 * 为什么需要它：段哈希 + 缓存已经让「第二次修改」在工程上很便宜，
 * 但重开项目要记住 19 个子命令、54 个 npm script 和 out 目录约定——
 * 第二次的认知成本≈第一次。这个入口把「第二次」压成一条命令。
 *
 * 退出码：0 成功；2 用法；10 spec 错误（透传 compile）；其它透传 compile。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function usage() {
  console.log(`Usage: cvs again [options]

  --project <dir>     project dir containing project.spec.json (default cwd)
  --spec <file>       explicit spec path (default <project>/project.spec.json)
  --set k=v           override a field; repeatable; dotted path, numeric indices allowed
                      values stay STRINGS unless true/false/null or explicit --set-json
                      e.g. --set look.theme=amber-noir --set rounds.0.card.first=上新
  --set-json k=<json> same path syntax, JSON-typed value (numbers, arrays, objects)
  --out <file>        write the edited spec here (default: same file)
  --no-build          only write the spec; do not compile
  --print             print the resulting spec to stdout
  --root <dir>        project root for page resolution (default cwd)
  --audio <wav>       passed through to compile
  --no-audio          passed through to compile
  --strict            passed through to compile
  --help

Exit codes: 0 ok · 2 usage · 10..14 compile phases`);
}

function parse(argv) {
  const out = { sets: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--project') out.project = argv[++i];
    else if (a === '--spec') out.spec = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--root') out.root = argv[++i];
    else if (a === '--audio') out.audio = argv[++i];
    else if (a === '--no-audio') out.noAudio = true;
    else if (a === '--strict') out.strict = true;
    else if (a === '--no-build') out.noBuild = true;
    else if (a === '--print') out.print = true;
    else if (a === '--set') out.sets.push([argv[++i], false]);
    else if (a === '--set-json') out.sets.push([argv[++i], true]);
    else throw new Error(`unknown option: ${a}`);
  }
  return out;
}

// R2-16（N04-F8）：--set 的默认语义是**字符串**。旧实现把 `2024`、`007`、`1.10`
// 静默转成 Number —— 品牌名变数字、零编号文案被改写，spec 里还看不出被改过。
// 要 JSON 类型请显式用 --set-json k=<literal>。
function parseValue(raw, jsonMode = false) {
  if (jsonMode) {
    try { return JSON.parse(raw); } catch { throw new Error(`--set-json: value is not valid JSON: ${raw}`); }
  }
  if (raw === 'true') return true;   // 布尔开关字段（format.vertical 等）保持顺手
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try { return JSON.parse(raw); } catch { return raw; }  // 像是字面量但坏了 → 原样字符串
  }
  return raw;  // 数字样式的值一律按字符串存
}

const SPEC_TOP_KEYS = new Set(['specVersion', 'meta', 'format', 'look', 'audio', 'structure',
  'opening', 'rounds', 'moreCard', 'flash', 'ending', 'assets', 'patches', 'render']);

function setPath(obj, dotted, value) {
  // R2-16：顶层键必须存在拼写检查——`--set roounds.0...` 这种错别字以前会凭空
  // 造出一个新键、lint 也不报（E_UNKNOWN_FIELD 只认已声明的 schema 节点）。
  const head = dotted.split('.')[0];
  if (!SPEC_TOP_KEYS.has(head)) {
    throw new Error(`--set ${dotted}: unknown top-level key "${head}" (spec keys: ${[...SPEC_TOP_KEYS].join(', ')})`);
  }
  if (!dotted.includes('.')) { obj[dotted] = value; return; }
  const keys = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    const isIndex = /^\d+$/.test(k);
    if (isIndex) {
      const n = Number(k);
      if (!Array.isArray(cur)) throw new Error(`--set ${dotted}: "${keys.slice(0, i + 1).join('.')}" is not an array`);
      while (cur.length <= n) cur.push({});
      if (cur[n] == null || typeof cur[n] !== 'object') cur[n] = {};
      cur = cur[n];
    } else {
      if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
      cur = cur[k];
    }
  }
  cur[keys[keys.length - 1]] = value;
}

function main() {
  let args;
  try { args = parse(process.argv.slice(2)); }
  catch (e) { console.error(`[error] [E_USAGE] ${e.message}`); usage(); process.exit(2); }
  if (args.help) { usage(); return; }

  const root = path.resolve(args.root || process.cwd());
  const projectDir = path.resolve(args.project || process.cwd());
  const specPath = path.resolve(args.spec || path.join(projectDir, 'project.spec.json'));
  if (!fs.existsSync(specPath)) {
    console.error(`[error] [E_SPEC] no spec at ${specPath}`);
    console.error(`hint: pass --spec <file>, or run "cvs new \\"...\\" --out project.spec.json" first`);
    process.exit(10);
  }

  let spec;
  try { spec = JSON.parse(fs.readFileSync(specPath, 'utf8')); }
  catch (e) { console.error(`[error] [E_JSON] ${specPath}: ${e.message}`); process.exit(10); }

  const before = JSON.stringify(spec);
  for (const [assignment, jsonMode] of args.sets) {
    const eq = assignment.indexOf('=');
    if (eq <= 0) { console.error(`[error] [E_USAGE] --set expects key=value, got "${assignment}"`); process.exit(2); }
    try {
      setPath(spec, assignment.slice(0, eq).trim(), parseValue(assignment.slice(eq + 1), jsonMode));
    } catch (e) {
      console.error(`[error] [E_USAGE] ${e.message}`);
      process.exit(2);
    }
  }
  const changed = JSON.stringify(spec) !== before;

  const outPath = path.resolve(args.out || specPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n');
  if (args.print) console.log(JSON.stringify(spec, null, 2));
  console.log(`[again] ${changed ? `applied ${args.sets.length} override(s)` : 'no overrides'} -> ${outPath}`);

  if (args.noBuild) { console.log('[again] --no-build: spec only'); return; }

  const compile = path.join(root, 'scripts', 'compile.mjs');
  const childArgs = [compile, '--spec', outPath, '--root', root];
  if (args.audio) childArgs.push('--audio', path.resolve(String(args.audio)));
  if (args.noAudio) childArgs.push('--no-audio');
  if (args.strict) childArgs.push('--strict');
  const r = spawnSync(process.execPath, childArgs, { cwd: root, stdio: 'inherit', windowsHide: true });
  process.exit(r.status ?? 1);
}

try { main(); } catch (e) { console.error(`[fatal] ${e.message}`); process.exit(1); }
