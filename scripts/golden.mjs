#!/usr/bin/env node
/**
 * golden.mjs — byte-level regression baselines for whole project specs.
 *
 * For each fixture in fixtures/golden/<name>/spec.json it:
 *   1. compiles the spec through templates/plan.mjs (same path as compile.mjs),
 *   2. picks the 15% / 50% / 85% points of the authored duration,
 *   3. maps each point to the plan segment that owns it and renders one still
 *      with templates/render-segment.mjs --still (page + t0/speed/dur + local u),
 *   4. hashes the resulting PNG with SHA-256.
 *
 *   node scripts/golden.mjs --update                  # write fixtures/golden/manifest.json
 *   node scripts/golden.mjs                           # re-render and compare to that manifest
 *   node scripts/golden.mjs --filter cyber            # one project only
 *   node scripts/golden.mjs --manifest out/x.json     # alternate manifest (used by tests)
 *
 * The manifest stores specHash (stable, key-sorted JSON), ENGINE_VERSION, git
 * short hash, Chrome version, and per-still t/hash/bytes/segment/page/local.
 * Check mode exits 1 and prints expected vs actual for every mismatch.
 *
 * Nothing here writes to templates/ or pages; the only renderer invocation is
 * templates/render-segment.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPlanFromSpec } from '../templates/plan.mjs';
import { ENGINE_VERSION } from '../templates/spec.mjs';
import { browserCandidates } from '../templates/cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) a[k.slice(2)] = true;
    else { a[k.slice(2)] = next; i++; }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: node scripts/golden.mjs [options]
  --update                (re)write the manifest instead of comparing
  --selfcheck             render twice and compare against this run's own manifest (CI)
  --manifest <file>       manifest path, default fixtures/golden/manifest.json
  --filter <name>         only the project fixtures/golden/<name>
  --outdir <dir>          still output root, default out/golden
  --root <dir>            repository root, default this repo
  --format <png|jpeg>     still format, default png
  --width/--height <n>    viewport, default 1920x1080
  --json                  machine-readable report (one JSON line)
  --strict-env            fail when Chrome/fonts differ from the committed manifest
  --timeout <ms>          page-ready timeout per still, default 180000`);
  process.exit(0);
}

const ROOT = path.resolve(String(args.root || REPO));
const OUT_ROOT = path.resolve(ROOT, String(args.outdir || 'out/golden'));
// --selfcheck：先渲染一遍写临时 manifest，再渲染一遍逐字节比对。
// 用于 CI / 换机器时验证「本机可复现」，不依赖提交的固定哈希（字体/Chrome 版本会变）。
const SELFCHECK = !!args.selfcheck;
const MANIFEST = path.resolve(ROOT, String(args.manifest
  || (SELFCHECK ? 'out/golden/manifest.selfcheck.json' : 'fixtures/golden/manifest.json')));
const FIXTURES = path.join(ROOT, 'fixtures', 'golden');
const RENDERER = path.join(ROOT, 'templates', 'render-segment.mjs');
const UPDATE = !!args.update;
const STRICT_ENV = !!args['strict-env'];
const JSON_OUT = !!args.json;
const FILTER = args.filter ? String(args.filter) : null;
const FORMAT = String(args.format || 'png').toLowerCase() === 'jpeg' ? 'jpeg' : 'png';
const WIDTH = Number(args.width || 1920);
const HEIGHT = Number(args.height || 1080);
const TIMEOUT = Number(args.timeout || 180000);
const PARENT_TIMEOUT = Math.max(300000, TIMEOUT * 3);
const PCTS = [0.15, 0.5, 0.85];
const EXT = FORMAT === 'jpeg' ? 'jpg' : 'png';

// ── small helpers ───────────────────────────────────────────────────────────

const toPosix = (p) => String(p).replace(/\\/g, '/');
const round3 = (n) => Math.round(Number(n) * 1000) / 1000;
const fixed3 = (n) => round3(n).toFixed(3);

/** Key-sorted JSON, so the spec hash ignores formatting and line endings. */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = stable(value[k]);
    return out;
  }
  return value;
}

const stableJson = (value) => JSON.stringify(stable(value));

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(stable(value), null, 2) + '\n', { encoding: 'utf8' });
  fs.renameSync(tmp, file);
}

function toolVersion(cmd, argv, cwd) {
  try {
    const r = spawnSync(cmd, argv, { cwd, encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (r.status !== 0) return null;
    return `${r.stdout || ''}${r.stderr || ''}`.trim().split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

/**
 * 当前渲染环境指纹（v2.4 / P2-03）。
 * committed golden 只有在「同一 Chrome + 同一字体字节」下才可比；
 * 跨机直接比哈希会把字体替换当成视觉回归。
 */
function fontSetHash() {
  try {
    const lock = readJson(path.join(ROOT, 'shared', 'fonts.lock.json'));
    return lock.setSha256 || null;
  } catch {
    return null;
  }
}

function currentEnv() {
  return {
    // R2-12：探测与渲染器同源（browserCandidates = CHROME_EXE→PATH→标准安装位），
    // 不再只认 CHROME_EXE 一个环境变量——否则不显式设它时 probe 恒为 null。
    chrome: (() => {
      try {
        const exe = browserCandidates()[0];
        return exe ? toolVersion(exe, ['--version'], ROOT) : null;
      } catch { return null; }
    })(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    fonts: fontSetHash(),
  };
}

function emitJson(payload) {
  if (args.json) process.stdout.write(JSON.stringify(payload) + '\n');
}

function listFixtures() {
  if (!fs.existsSync(FIXTURES)) throw new Error(`no fixture directory: ${FIXTURES}`);
  return fs.readdirSync(FIXTURES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .filter((name) => !FILTER || name === FILTER)
    .map((name) => ({ name, specPath: path.join(FIXTURES, name, 'spec.json') }))
    .filter((f) => {
      if (!fs.existsSync(f.specPath)) return false;
      return true;
    });
}

function segmentAt(plan, t) {
  const segs = plan.segments;
  for (const s of segs) {
    if (t >= s.start - 1e-9 && t < s.end - 1e-9) return s;
  }
  return segs[segs.length - 1];
}

function localTime(segment, t) {
  return Math.min(Math.max(0, t - segment.start), segment.duration);
}

// ── render one still through the frozen renderer CLI ────────────────────────

function renderStill({ specName, index, globalT, segment }) {
  const local = round3(localTime(segment, globalT));
  const rawDir = path.join(OUT_ROOT, specName, `.tmp-${index}`);
  fs.rmSync(rawDir, { recursive: true, force: true });
  fs.mkdirSync(rawDir, { recursive: true });

  const argv = [
    RENDERER,
    '--page', segment.page,
    '--still', String(local),
    '--outdir', rawDir,
    '--root', ROOT,
    '--width', String(WIDTH),
    '--height', String(HEIGHT),
    '--duration', String(round3(segment.duration)),
    '--t0', String(round3(segment.t0 ?? 0)),
    '--speed', String(segment.speed ?? 1),
    '--format', FORMAT,
    '--timeout', String(TIMEOUT),
  ];

  if (!JSON_OUT) process.stdout.write(`[render] ${specName} #${index + 1} t=${fixed3(globalT)} segment=${segment.id} local=${fixed3(local)}\n`);

  // Chrome 冷启动偶发 CDP Page.navigate 超时（同一命令重跑就过）。黄金回归
  // 不能把这种抖动当像素回归，所以失败先退避重试；三次都失败才是真失败。
  let r = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    r = spawnSync(process.execPath, argv, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: PARENT_TIMEOUT,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    if (r.status === 0) break;
    if (attempt < 3) {
      const why = `${r.stderr || r.stdout || ''}`.trim().split(/\r?\n/).pop() || `exit ${r.status}`;
      if (!JSON_OUT) console.log(`[retry]  ${specName} #${index + 1} failed (${why}); retrying ${attempt}/2`);
      spawnSync(process.execPath, ['-e', `setTimeout(()=>{}, ${900 * attempt})`], { windowsHide: true });
      fs.rmSync(rawDir, { recursive: true, force: true });
      fs.mkdirSync(rawDir, { recursive: true });
    }
  }
  if (!r || r.status !== 0) {
    throw new Error(
      `render failed for ${specName} t=${fixed3(globalT)} (exit=${r && r.status}, signal=${(r && r.signal) || '-'})\n` +
      `  page: ${segment.page}\n--- stdout ---\n${(r && r.stdout) || ''}\n--- stderr ---\n${(r && r.stderr) || ''}`,
    );
  }

  const produced = fs.readdirSync(rawDir).filter((f) => f.startsWith('still-'));
  if (produced.length !== 1) {
    throw new Error(`expected exactly one still in ${rawDir}, got ${JSON.stringify(produced)}`);
  }

  const finalName = `${String(index + 1).padStart(2, '0')}-t${fixed3(globalT)}.${EXT}`;
  const finalDir = path.join(OUT_ROOT, specName);
  fs.mkdirSync(finalDir, { recursive: true });
  const finalPath = path.join(finalDir, finalName);
  fs.rmSync(finalPath, { force: true });
  fs.renameSync(path.join(rawDir, produced[0]), finalPath);
  fs.rmSync(rawDir, { recursive: true, force: true });

  const buf = fs.readFileSync(finalPath);
  const sceneT = segment.kind === 'style'
    ? round3(Number(segment.t0 ?? 0) + local * Number(segment.speed ?? 1))
    : local;

  return {
    t: round3(globalT),
    file: toPosix(path.relative(OUT_ROOT, finalPath)),
    hash: sha256(buf),
    bytes: buf.length,
    segment: segment.id,
    kind: segment.kind,
    page: segment.page,
    local,
    sceneT,
  };
}

// ── build fresh results for every selected fixture ──────────────────────────

function buildResults() {
  const fixtures = listFixtures();
  if (FILTER && fixtures.length === 0) throw new Error(`no fixture named "${FILTER}" under ${FIXTURES}`);
  if (fixtures.length === 0) throw new Error(`no spec.json found under ${FIXTURES}`);

  const results = [];
  for (const fx of fixtures) {
    const raw = readJson(fx.specPath);
    const specHash = sha256(Buffer.from(stableJson(raw), 'utf8'));
    const { plan } = buildPlanFromSpec(raw, { root: ROOT });
    const duration = plan.spec.duration;
    const times = PCTS.map((pct) => round3(duration * pct));

    const stills = times.map((t, index) => renderStill({
      specName: fx.name,
      index,
      globalT: t,
      segment: segmentAt(plan, t),
    }));

    results.push({
      name: fx.name,
      spec: toPosix(path.relative(ROOT, fx.specPath)),
      specHash,
      duration: round3(duration),
      theme: plan.spec.look.theme,
      rounds: raw.rounds.length,
      stills,
    });
  }
  return results;
}

// ── update ──────────────────────────────────────────────────────────────────

function doUpdate() {
  const fresh = buildResults();
  let specs = fresh;

  // --filter merges into the existing manifest so a targeted regen keeps the rest.
  if (FILTER && fs.existsSync(MANIFEST)) {
    try {
      const old = readJson(MANIFEST);
      const kept = (old.specs || []).filter((s) => s.name !== FILTER);
      specs = [...kept, ...fresh];
    } catch {
      specs = fresh;
    }
  }
  specs.sort((a, b) => a.name.localeCompare(b.name));

  const env = currentEnv();
  const manifest = {
    manifestVersion: 1,
    generatedBy: 'scripts/golden.mjs',
    engineVersion: ENGINE_VERSION,
    git: toolVersion('git', ['rev-parse', '--short', 'HEAD'], ROOT),
    chrome: env.chrome,
    node: env.node,
    platform: env.platform,
    arch: env.arch,
    fonts: env.fonts,
    format: FORMAT,
    viewport: { width: WIDTH, height: HEIGHT },
    times: PCTS,
    specs,
  };
  writeJsonAtomic(MANIFEST, manifest);

  const stillCount = specs.reduce((n, s) => n + s.stills.length, 0);
  if (!JSON_OUT) {
    for (const s of specs) {
      for (const st of s.stills) console.log(`[hash]   ${s.name}/${st.file}  ${st.hash}  ${st.bytes} bytes`);
    }
    console.log(`[write]  ${toPosix(path.relative(ROOT, MANIFEST))} (${specs.length} specs, ${stillCount} stills)`);
  }
  emitJson({
    ok: true, mode: SELFCHECK ? 'selfcheck' : 'update',
    env, manifest: toPosix(path.relative(ROOT, MANIFEST)), specs: specs.length, stills: stillCount,
  });
}

// ── check ───────────────────────────────────────────────────────────────────

function doCheck() {
  if (!fs.existsSync(MANIFEST)) {
    throw new Error(`manifest not found: ${MANIFEST}\n  run: node scripts/golden.mjs --update`);
  }
  const manifest = readJson(MANIFEST);
  const env = currentEnv();
  const envCompare = {
    chrome: {
      expected: manifest.chrome ?? null,
      actual: env.chrome ?? null,
      // R2-12（N09-F2）：旧逻辑 `!env.chrome → match:true` 让探测失败变假绿灯。
      // manifest 记了版本而本机探不到 = 环境**未知**，必须按不匹配处理
      // （非 strict 下打 W_ENV_MISMATCH 并跳过哈希比对，而不是拿它当相符）。
      match: !manifest.chrome || (env.chrome != null && manifest.chrome === env.chrome),
      reason: !manifest.chrome ? 'not-recorded' : (env.chrome == null ? 'probe-failed' : (manifest.chrome === env.chrome ? 'equal' : 'differs')),
    },
    fonts: {
      expected: manifest.fonts ?? null,
      actual: env.fonts ?? null,
      match: !manifest.fonts || (env.fonts != null && manifest.fonts === env.fonts),
      reason: !manifest.fonts ? 'not-recorded' : (env.fonts == null ? 'probe-failed' : (manifest.fonts === env.fonts ? 'equal' : 'differs')),
    },
    node: { expected: manifest.node ?? null, actual: env.node },
    platform: { expected: manifest.platform ?? null, actual: env.platform },
  };
  const envMatch = envCompare.chrome.match && envCompare.fonts.match;
  if (!envMatch) {
    const detail = {
      chrome: `${envCompare.chrome.expected} != ${envCompare.chrome.actual}`,
      fonts: `${String(envCompare.fonts.expected).slice(0, 12)} != ${String(envCompare.fonts.actual).slice(0, 12)}`,
    };
    if (STRICT_ENV) {
      console.error(`[fail] [E_ENV_MISMATCH] chrome ${detail.chrome} · fonts ${detail.fonts}`);
      emitJson({ ok: false, mode: 'check', code: 'E_ENV_MISMATCH', env: envCompare, mismatches: [detail] });
      process.exitCode = 1;
      return;
    }
    console.warn(`[warn] [W_ENV_MISMATCH] chrome ${detail.chrome} · fonts ${detail.fonts}`);
    console.warn('       committed golden hashes are machine-bound; hash comparison skipped (use --strict-env to fail, or --selfcheck on this machine)');
    emitJson({ ok: true, mode: 'check', skipped: 'env-mismatch', env: envCompare, mismatches: [] });
    return;
  }
  const expected = new Map((manifest.specs || []).map((s) => [s.name, s]));
  const fresh = buildResults();
  const freshNames = new Set(fresh.map((s) => s.name));
  const mismatches = [];
  let checked = 0;

  for (const spec of fresh) {
    const exp = expected.get(spec.name);
    if (!exp) {
      mismatches.push(`${spec.name}: project missing from manifest`);
      continue;
    }
    if (exp.specHash !== spec.specHash) {
      mismatches.push(`${spec.name}: specHash expected ${exp.specHash} actual ${spec.specHash} (run --update if the spec change is intentional)`);
    }
    const expStills = new Map((exp.stills || []).map((s) => [fixed3(s.t), s]));
    for (const st of spec.stills) {
      const e = expStills.get(fixed3(st.t));
      checked++;
      if (!e) {
        mismatches.push(`${spec.name}/${st.file}: still t=${fixed3(st.t)} missing from manifest`);
        continue;
      }
      if (e.hash !== st.hash || Number(e.bytes) !== st.bytes) {
        mismatches.push(
          `MISMATCH ${spec.name}/${st.file}\n` +
          `    expected ${e.hash} (${e.bytes} bytes)\n` +
          `    actual   ${st.hash} (${st.bytes} bytes)`,
        );
      }
      expStills.delete(fixed3(st.t));
    }
    for (const e of expStills.values()) {
      mismatches.push(`${spec.name}/${e.file}: manifest still t=${fixed3(e.t)} was not rendered`);
    }
  }

  if (!FILTER) {
    for (const name of expected.keys()) {
      if (!freshNames.has(name)) mismatches.push(`${name}: manifest project has no fixture spec`);
    }
  }

  if (mismatches.length) {
    if (!JSON_OUT) {
      for (const m of mismatches) console.error(`[fail] ${m}`);
      console.error(`\n✗ golden check failed: ${mismatches.length} mismatch(es) across ${fresh.length} project(s)`);
    }
    emitJson({ ok: false, mode: 'check', env: envCompare, specs: fresh.length, checked, mismatches });
    process.exitCode = 1;
    return;
  }
  if (!JSON_OUT) console.log(`✓ golden manifest matches: ${fresh.length} specs, ${checked} stills`);
  emitJson({ ok: true, mode: 'check', env: envCompare, specs: fresh.length, checked, mismatches: [] });
}

try {
  if (SELFCHECK) {
    doUpdate();
    if (!JSON_OUT) console.log('[selfcheck] re-rendering to verify this machine reproduces its own hashes…');
    doCheck();
  } else if (UPDATE) doUpdate();
  else doCheck();
} catch (e) {
  console.error(`[fatal] ${e && e.stack || e}`);
  process.exit(1);
}
