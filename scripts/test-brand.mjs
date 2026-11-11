#!/usr/bin/env node
/**
 * test-brand.mjs — M-BRAND 品牌包（load / apply / check / CLI）回归测试。
 *
 *   node scripts/test-brand.mjs
 *
 * 覆盖：schema 校验（缺字段 / 非法 hex / 未知 OFL 字族 / 未知键）、
 * apply 的不可变性、meta.brand / brandKit / accentOverride / CTA 覆盖规则、
 * APCA 门槛、禁用词（中文包含 + ASCII 大小写不敏感）、logo 存在性与安全区、
 * 品牌名不一致警告、normalize+validate 复检、三个 CLI 子命令与退出码。
 *
 * 退出码：0 → 打印 "✓ brand"；有失败 → 1。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e.stack || e.message}`);
    process.exitCode = 1;
  }
}

const TMP = path.join(ROOT, 'out', `test-brand-${process.pid}`);
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
process.on('exit', () => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
});

const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
  return p;
};
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const clone = (v) => JSON.parse(JSON.stringify(v));

// 被测模块：brand.mjs 尚不存在时这里就会抛错（Red 阶段的真实失败点）。
const brandmod = await load('scripts/brand.mjs');
const { normalizeSpec, validateSpec } = await load('templates/spec.mjs');
const { THEMES, accentOverride } = await load('templates/themes.js');
const { apcaLc } = await load('templates/color.js');

const TECH_PATH = path.join(ROOT, 'content/brands/tech-dark.json');
const WARM_PATH = path.join(ROOT, 'content/brands/example.json');
const FIXTURE = readJson(path.join(ROOT, 'fixtures/mini-41s/spec.json'));
const SCRIPT = path.join(ROOT, 'scripts/brand.mjs');

const tech = brandmod.loadBrand(TECH_PATH);
const warm = brandmod.loadBrand(WARM_PATH);

const fieldsOf = (issue) => Object.keys(issue).sort().join(',');
const hasIssue = (issues, code, at) => issues.some((i) => i.code === code && (!at || i.path === at));

// ── loadBrand / schema ──────────────────────────────────────────────────────

test('loadBrand 读取 tech-dark 与 example 的 id/name/colors', () => {
  assert.equal(tech.id, 'tech-dark');
  assert.equal(tech.name, 'Tech Dark');
  assert.equal(tech.colors.accent.toLowerCase(), '#00d4ff');
  assert.equal(warm.id, 'example');
  assert.match(warm.colors.accent, /^#[0-9a-fA-F]{6}$/);
  assert.ok(Array.isArray(tech.voice.forbiddenWords) && tech.voice.forbiddenWords.length > 0);
});

test('loadBrand 拒绝未知 OFL 字族，错误信息指向 fonts.heading', () => {
  const bad = clone(tech);
  bad.fonts.heading = 'Comic Sans MS';
  const p = writeJson(path.join(TMP, 'bad-font.json'), bad);
  assert.throws(() => brandmod.loadBrand(p), /fonts\.heading/);
});

test('loadBrand 拒绝非法 hex 与缺失必填字段', () => {
  const badHex = clone(tech);
  badHex.colors.accent = '#12345';
  assert.throws(() => brandmod.loadBrand(writeJson(path.join(TMP, 'bad-hex.json'), badHex)), /colors\.accent/);

  const noCta = clone(tech);
  delete noCta.voice.cta;
  assert.throws(() => brandmod.loadBrand(writeJson(path.join(TMP, 'no-cta.json'), noCta)), /voice\.cta/);
});

test('loadBrand 拒绝未知顶层键（additionalProperties:false）', () => {
  const bad = clone(tech);
  bad.unexpectedField = true;
  assert.throws(() => brandmod.loadBrand(writeJson(path.join(TMP, 'extra-key.json'), bad)), /unexpectedField/);
});

// ── applyBrand ─────────────────────────────────────────────────────────────

test('applyBrand 不修改传入的 spec 与 brand（不可变）', () => {
  const specBefore = JSON.stringify(FIXTURE);
  const brandBefore = JSON.stringify(tech);
  const applied = brandmod.applyBrand(FIXTURE, tech);
  assert.equal(JSON.stringify(FIXTURE), specBefore);
  assert.equal(JSON.stringify(tech), brandBefore);
  assert.notEqual(applied, FIXTURE);
  assert.notEqual(applied.meta, FIXTURE.meta);
  assert.notEqual(applied.look, FIXTURE.look);
  assert.notEqual(applied.rounds, FIXTURE.rounds);
});

test('applyBrand 写入 meta.brand / meta.brandKit / look.accentOverride', () => {
  const applied = brandmod.applyBrand(FIXTURE, tech);
  assert.equal(applied.meta.brand, tech.name);
  assert.deepEqual(applied.meta.brandKit, { id: tech.id, logo: tech.logo, fonts: tech.fonts });
  assert.deepEqual(applied.look.accentOverride, accentOverride(THEMES['coral-noir'], tech.colors).override);
  assert.equal(applied.look.accentOverride.accent.toLowerCase(), '#00d4ff');
});

test('applyBrand 仅在 CTA 为空或占位时写入品牌 CTA', () => {
  const empty = brandmod.applyBrand({ ...clone(FIXTURE), meta: { ...FIXTURE.meta, cta: '' } }, tech);
  assert.equal(empty.meta.cta, tech.voice.cta);
  const placeholder = brandmod.applyBrand({ ...clone(FIXTURE), meta: { ...FIXTURE.meta, cta: '{{CTA}}' } }, tech);
  assert.equal(placeholder.meta.cta, tech.voice.cta);
  const kept = brandmod.applyBrand(FIXTURE, tech);
  assert.equal(kept.meta.cta, FIXTURE.meta.cta);
});

test('applyBrand 不改 format / structure / rounds', () => {
  const applied = brandmod.applyBrand(FIXTURE, tech);
  assert.deepEqual(applied.format, FIXTURE.format);
  assert.deepEqual(applied.structure, FIXTURE.structure);
  assert.deepEqual(applied.rounds, FIXTURE.rounds);
});

test('两套品牌 apply 后 accent/bg 与 accentInk/accent 的 APCA 均达标', () => {
  for (const brand of [tech, warm]) {
    const applied = brandmod.applyBrand(FIXTURE, brand);
    const theme = THEMES[applied.look.theme];
    const o = applied.look.accentOverride;
    const lcBg = Math.abs(apcaLc(o.accent, theme.colors.bg));
    const lcInk = Math.abs(apcaLc(o.accentInk, o.accent));
    assert.ok(lcBg >= 30, `${brand.id}: accent/bg Lc=${lcBg}`);
    assert.ok(lcInk >= 45, `${brand.id}: accentInk/accent Lc=${lcInk}`);
  }
});

test('apply 后 normalizeSpec + validateSpec 无 error（两套品牌）', () => {
  for (const brand of [tech, warm]) {
    const normalized = normalizeSpec(brandmod.applyBrand(FIXTURE, brand));
    const errors = validateSpec(normalized).filter((i) => i.level === 'error');
    assert.deepEqual(errors, [], `${brand.id}: ${JSON.stringify(errors)}`);
    assert.equal(normalized.meta.brand, brand.name);
    assert.ok(normalized.meta.brandKit);
  }
});

// ── checkBrand ─────────────────────────────────────────────────────────────

test('checkBrand 的 issue 形状是 {level, code, path, message}', () => {
  const issues = brandmod.checkBrand(FIXTURE, tech, { root: ROOT });
  assert.ok(Array.isArray(issues));
  for (const i of issues) assert.equal(fieldsOf(i), 'code,level,message,path');
});

test('checkBrand 捕获 rounds[].card.first/keyword 的禁用词（中文直接包含）', () => {
  const spec = brandmod.applyBrand(FIXTURE, tech);
  spec.rounds[0].card.first = '史上最好用';
  spec.rounds[1].card.keyword = '顶级方案';
  const issues = brandmod.checkBrand(spec, tech, { root: ROOT });
  assert.ok(hasIssue(issues, 'E_FORBIDDEN_WORD', 'rounds[0].card.first'), JSON.stringify(issues));
  assert.ok(hasIssue(issues, 'E_FORBIDDEN_WORD', 'rounds[1].card.keyword'), JSON.stringify(issues));
  assert.ok(issues.filter((i) => i.code === 'E_FORBIDDEN_WORD').every((i) => i.level === 'error'));
});

test('checkBrand 的禁用词匹配大小写不敏感（ASCII）', () => {
  const spec = brandmod.applyBrand(FIXTURE, tech);
  spec.rounds[2].card.keyword = 'FREE trial';
  const issues = brandmod.checkBrand(spec, tech, { root: ROOT });
  assert.ok(hasIssue(issues, 'E_FORBIDDEN_WORD', 'rounds[2].card.keyword'), JSON.stringify(issues));
});

test('checkBrand 扫描 moreCard 与 meta.cta 的禁用词', () => {
  const spec = brandmod.applyBrand(FIXTURE, tech);
  spec.moreCard.keyword = '永久免费';
  spec.meta.cta = '限时免费领取';
  const issues = brandmod.checkBrand(spec, tech, { root: ROOT });
  assert.ok(hasIssue(issues, 'E_FORBIDDEN_WORD', 'moreCard.keyword'), JSON.stringify(issues));
  assert.ok(hasIssue(issues, 'E_FORBIDDEN_WORD', 'meta.cta'), JSON.stringify(issues));
});

test('checkBrand 捕获 accent/bg 对比不足（E_BRAND_ACCENT_APCA）', () => {
  const brand = clone(tech);
  brand.colors = { accent: '#101010' };
  const issues = brandmod.checkBrand(brandmod.applyBrand(FIXTURE, tech), brand, { root: ROOT });
  const hit = issues.find((i) => i.code === 'E_BRAND_ACCENT_APCA' && i.path === 'colors.accent');
  assert.ok(hit, JSON.stringify(issues));
  assert.equal(hit.level, 'error');
  assert.match(hit.message, /APCA/);
});

test('checkBrand 捕获声明的 accentInk/accent 对比不足', () => {
  const brand = clone(tech);
  brand.colors.accentInk = '#00d4ff';
  const issues = brandmod.checkBrand(brandmod.applyBrand(FIXTURE, brand), brand, { root: ROOT });
  assert.ok(hasIssue(issues, 'E_BRAND_ACCENT_APCA', 'colors.accentInk'), JSON.stringify(issues));
});

test('checkBrand 捕获 logo 缺失（E_LOGO_MISSING）', () => {
  const brand = clone(tech);
  brand.logo.path = 'assets/definitely-missing-logo.png';
  const issues = brandmod.checkBrand(brandmod.applyBrand(FIXTURE, tech), brand, { root: ROOT });
  const hit = issues.find((i) => i.code === 'E_LOGO_MISSING');
  assert.ok(hit, JSON.stringify(issues));
  assert.equal(hit.level, 'error');
  assert.equal(hit.path, 'logo.path');
});

test('checkBrand 拒绝逃出仓库根的 logo 路径', () => {
  const brand = clone(tech);
  brand.logo.path = '../outside-the-repo.png';
  const issues = brandmod.checkBrand(brandmod.applyBrand(FIXTURE, tech), brand, { root: ROOT });
  const hit = issues.find((i) => i.code === 'E_LOGO_MISSING');
  assert.ok(hit, JSON.stringify(issues));
  assert.match(hit.message, /escapes the project root/);
});

test('checkBrand 不把根目录内以 ".." 开头的文件名误判为越界', () => {
  const rootDir = path.join(TMP, 'root');
  fs.mkdirSync(rootDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, '..foo-logo.png'), 'not-a-real-image');
  const brand = clone(tech);
  brand.logo.path = '..foo-logo.png';
  const issues = brandmod.checkBrand(brandmod.applyBrand(FIXTURE, tech), brand, { root: rootDir });
  assert.ok(!issues.some((i) => i.code === 'E_LOGO_MISSING'), JSON.stringify(issues));
});

test('checkBrand 对 safeArea < 24px 给出 W_LOGO_SAFE_AREA 警告', () => {
  const brand = clone(tech);
  brand.logo.safeArea = { top: 12, right: 40, bottom: 32, left: 40 };
  const issues = brandmod.checkBrand(brandmod.applyBrand(FIXTURE, brand), brand, { root: ROOT });
  const hit = issues.find((i) => i.code === 'W_LOGO_SAFE_AREA');
  assert.ok(hit, JSON.stringify(issues));
  assert.equal(hit.level, 'warn');
  assert.match(hit.message, /top=12/);
});

test('checkBrand 对 meta.brand 与 brand.name 不一致给出警告', () => {
  const applied = brandmod.applyBrand(FIXTURE, tech);
  applied.meta.brand = 'Some Other Brand';
  const issues = brandmod.checkBrand(applied, tech, { root: ROOT });
  const hit = issues.find((i) => i.code === 'W_BRAND_NAME_MISMATCH');
  assert.ok(hit, JSON.stringify(issues));
  assert.equal(hit.level, 'warn');
  assert.equal(hit.path, 'meta.brand');
});

test('checkBrand 对已 apply 的干净 spec 不产生 error（两套品牌）', () => {
  for (const brand of [tech, warm]) {
    const issues = brandmod.checkBrand(brandmod.applyBrand(FIXTURE, brand), brand, { root: ROOT });
    const errors = issues.filter((i) => i.level === 'error');
    assert.deepEqual(errors, [], `${brand.id}: ${JSON.stringify(errors)}`);
  }
});

// ── CLI ────────────────────────────────────────────────────────────────────

const runCli = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' });

test('CLI apply 写出 spec 且退出码 0', () => {
  const out = path.join(TMP, 'nested', 'cli-applied.spec.json');
  const r = runCli(['apply', '--spec', path.join(ROOT, 'fixtures/mini-41s/spec.json'), '--brand', TECH_PATH, '--out', out]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const applied = readJson(out);
  assert.equal(applied.meta.brand, tech.name);
  assert.equal(applied.look.accentOverride.accent.toLowerCase(), '#00d4ff');
});

test('CLI apply 对非法品牌退出码 1 且不写文件', () => {
  const bad = clone(tech);
  bad.fonts.body = 'Not A Real Font';
  const badPath = writeJson(path.join(TMP, 'bad-brand.json'), bad);
  const out = path.join(TMP, 'should-not-exist.spec.json');
  const r = runCli(['apply', '--spec', path.join(ROOT, 'fixtures/mini-41s/spec.json'), '--brand', badPath, '--out', out]);
  assert.equal(r.status, 1, r.stdout);
  assert.equal(fs.existsSync(out), false);
});

test('CLI check 对干净 spec 退出码 0', () => {
  const applied = writeJson(path.join(TMP, 'clean.spec.json'), brandmod.applyBrand(FIXTURE, tech));
  const r = runCli(['check', '--spec', applied, '--brand', TECH_PATH]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /0 error/);
});

test('CLI check 有 error 时退出码 1 并打印 E_FORBIDDEN_WORD', () => {
  const spec = brandmod.applyBrand(FIXTURE, tech);
  spec.rounds[0].card.first = '最好用';
  const p = writeJson(path.join(TMP, 'forbidden.spec.json'), spec);
  const r = runCli(['check', '--spec', p, '--brand', TECH_PATH]);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /E_FORBIDDEN_WORD/);
});

test('CLI check --json 输出可解析的 JSON 报告', () => {
  const applied = writeJson(path.join(TMP, 'json.spec.json'), brandmod.applyBrand(FIXTURE, tech));
  const r = runCli(['check', '--spec', applied, '--brand', TECH_PATH, '--json']);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const report = JSON.parse(r.stdout);
  assert.equal(report.errors, 0);
  assert.ok(Array.isArray(report.issues));
  assert.equal(report.brand, tech.id);
});

test('CLI list 列出 content/brands 下两套品牌的 id/name', () => {
  const r = runCli(['list']);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /tech-dark/);
  assert.match(r.stdout, /Tech Dark/);
  assert.match(r.stdout, /example/);
});

const total = passed + failed;
console.log(`\nRan ${total} tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log('✓ brand');
