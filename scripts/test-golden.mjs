#!/usr/bin/env node
/**
 * test-golden.mjs — end-to-end acceptance for scripts/golden.mjs.
 *
 * What it proves (all with real renders, no mocks):
 *   1. --update writes a manifest for the 3 golden projects: 9 stills total.
 *   2. Every still on disk hashes to the value recorded in that manifest.
 *   3. Default mode re-renders and exits 0 against the fresh manifest.
 *   4. A single tampered hash makes default mode exit 1 and name the file.
 *   5. The checked-in baseline (fixtures/golden/manifest.json) passes.
 *
 *   CHROME_EXE="C:/Program Files/Google/Chrome/Application/chrome.exe" node scripts/test-golden.mjs
 *
 * Exit 0 only when every assertion above holds. Any swallowed assertion would
 * turn a broken golden pipeline into a false green, so failures throw.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const GOLDEN = path.join(ROOT, 'scripts', 'golden.mjs');
const TMP_MANIFEST = 'out/golden/manifest.test.json';
const BAD_MANIFEST = 'out/golden/manifest.bad.json';
const BASELINE = 'fixtures/golden/manifest.json';

let passed = 0;
let failed = 0;

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function test(name, fn) {
  process.stdout.write(`- ${name} ... `);
  try {
    fn();
    passed++;
    console.log('ok');
  } catch (e) {
    failed++;
    console.log('FAIL');
    console.error(String(e && e.stack || e).replace(/^/gm, '    '));
  }
}

function golden(args, extra = {}) {
  const r = spawnSync(process.execPath, [GOLDEN, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...extra },
    encoding: 'utf8',
    timeout: 20 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return { status: r.status, signal: r.signal, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}

function failOutput(label, r) {
  return `${label}: exit=${r.status} signal=${r.signal || '-'} error=${r.error ? r.error.message : '-'}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readManifest(rel) {
  return JSON.parse(fs.readFileSync(path.resolve(ROOT, rel), 'utf8'));
}

// ── 1) baseline generation into a throw-away manifest ───────────────────────

fs.rmSync(path.resolve(ROOT, TMP_MANIFEST), { force: true });
const updated = golden(['--update', '--manifest', TMP_MANIFEST]);
assert(updated.status === 0, failOutput('golden --update failed', updated));
assert(fs.existsSync(path.resolve(ROOT, TMP_MANIFEST)), `golden --update did not write ${TMP_MANIFEST}`);

const manifest = readManifest(TMP_MANIFEST);

test('manifest covers card/cyber/mixed with 3 stills each (9 total)', () => {
  assert(Array.isArray(manifest.specs), 'manifest.specs must be an array');
  const names = manifest.specs.map((s) => s.name);
  assert(JSON.stringify(names) === JSON.stringify(['card', 'cyber', 'mixed']), `unexpected spec names: ${JSON.stringify(names)}`);
  let count = 0;
  for (const s of manifest.specs) {
    assert(Array.isArray(s.stills) && s.stills.length === 3, `${s.name}: expected 3 stills, got ${s.stills?.length}`);
    count += s.stills.length;
  }
  assert(count === 9, `expected 9 stills total, got ${count}`);
});

test('every manifest still exists and hashes to its recorded value', () => {
  for (const s of manifest.specs) {
    for (const still of s.stills) {
      assert(/^[0-9a-f]{64}$/.test(still.hash), `${s.name}/${still.file}: malformed hash`);
      assert(Number.isInteger(still.bytes) && still.bytes > 1000, `${s.name}/${still.file}: implausible byte count ${still.bytes}`);
      const abs = path.resolve(ROOT, 'out/golden', still.file);
      assert(fs.existsSync(abs), `missing rendered still: ${abs}`);
      assert(fs.statSync(abs).size === still.bytes, `${s.name}/${still.file}: size ${fs.statSync(abs).size} != manifest ${still.bytes}`);
      const actual = sha256File(abs);
      assert(actual === still.hash, `${s.name}/${still.file}: sha256 ${actual} != manifest ${still.hash}`);
    }
  }
});

test('engine version is recorded and all spec hashes are distinct', () => {
  assert(Number.isInteger(manifest.engineVersion), 'manifest.engineVersion must be an integer');
  const hashes = manifest.specs.map((s) => s.specHash);
  assert(hashes.every((h) => /^[0-9a-f]{64}$/.test(h)), 'specHash must be a sha256 hex digest');
  assert(new Set(hashes).size === hashes.length, 'specHash values must differ between golden projects');
});

// ── 2) check mode against the fresh manifest ────────────────────────────────

test('default mode re-renders and exits 0 against the fresh manifest', () => {
  const r = golden(['--manifest', TMP_MANIFEST]);
  assert(r.status === 0, failOutput('golden check failed on fresh manifest', r));
  assert(/golden manifest matches/i.test(r.stdout), `check output did not confirm a match:\n${r.stdout}`);
});

// ── 3) corruption must be caught ────────────────────────────────────────────

test('a tampered hash makes check exit 1 and names the file', () => {
  const bad = JSON.parse(JSON.stringify(manifest));
  const still = bad.specs[0].stills[0];
  still.hash = (still.hash[0] === '0' ? '1' : '0') + still.hash.slice(1);
  const badAbs = path.resolve(ROOT, BAD_MANIFEST);
  fs.mkdirSync(path.dirname(badAbs), { recursive: true });
  fs.writeFileSync(badAbs, JSON.stringify(bad, null, 2) + '\n', 'utf8');

  const r = golden(['--manifest', BAD_MANIFEST]);
  assert(r.status === 1, `tampered manifest must exit 1, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  const combined = r.stdout + r.stderr;
  assert(combined.includes(still.file), `output does not name the mismatched file ${still.file}:\n${combined}`);
  assert(/MISMATCH/i.test(combined), `output does not mark a MISMATCH:\n${combined}`);
});

// ── 4) the committed baseline ───────────────────────────────────────────────

test('checked-in fixtures/golden/manifest.json is present and passes', () => {
  assert(fs.existsSync(path.resolve(ROOT, BASELINE)), `missing baseline ${BASELINE}; run node scripts/golden.mjs --update`);
  const r = golden(['--manifest', BASELINE]);
  assert(r.status === 0, failOutput('baseline check failed', r));
});

console.log(`\nRan ${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
