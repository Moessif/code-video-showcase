#!/usr/bin/env node
/**
 * test-core.mjs — dependency-free regression tests for the pure modules.
 *   node scripts/test-core.mjs
 * Runs in CI and before a release. No browser, no ffmpeg.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
}

const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const color = await load('templates/color.js');
const motion = await load('templates/motion.js');
const themes = await load('templates/themes.js');
const { buildPlan, validateComposition, totalDuration } = await load('templates/timeline.mjs');

test('hex → oklch → hex round-trips', () => {
  for (const hex of ['#d97757', '#0e0e0d', '#f4efe6', '#00dadd', '#dcdb00']) {
    assert.equal(color.toHex(color.toOklch(hex)), hex);
  }
});

test('white/black luminance and WCAG ratio', () => {
  assert.equal(Math.round(color.contrastRatio('#ffffff', '#000000')), 21);
  assert.ok(color.relativeLuminance('#ffffff') > 0.999);
  assert.ok(color.relativeLuminance('#000000') < 1e-6);
});

test('APCA polarity and magnitude', () => {
  const darkOnLight = color.apcaLc('#000000', '#ffffff');
  const lightOnDark = color.apcaLc('#ffffff', '#000000');
  assert.ok(darkOnLight > 100, `expected >100, got ${darkOnLight}`);
  assert.ok(lightOnDark < -100, `expected <-100, got ${lightOnDark}`);
  assert.ok(Math.abs(color.apcaLc('#000000', '#ffffff')) > Math.abs(color.apcaLc('#888888', '#ffffff')));
});

test('OKLCH gamut clamp keeps every derived palette valid', () => {
  for (const [l, c, h] of [[0.5, 0.5, 20], [0.95, 0.4, 140], [0.2, 0.3, 270]]) {
    const g = color.gamut({ l, c, h });
    assert.ok(g.c <= c + 1e-9);
    const hex = color.toHex(g);
    assert.match(hex, /^#[0-9a-f]{6}$/);
  }
});

test('mixOklch midpoint between black and white is mid-lightness', () => {
  const mid = color.toOklch(color.mixOklch('#000000', '#ffffff', 0.5));
  assert.ok(Math.abs(mid.l - 0.5) < 0.03, `got L=${mid.l}`);
});

test('derivePalette returns all 14 roles', () => {
  const p = color.derivePalette({ mode: 'dark', accent: '#d97757' });
  for (const k of ['bg', 'bgDeep', 'surface', 'ink', 'muted', 'accent', 'accentInk', 'accentSoft', 'paper', 'paperInk', 'paperMuted', 'cardDark', 'cardDarkInk', 'flash']) {
    assert.match(p[k], /^#[0-9a-f]{6}$/, `${k} missing`);
  }
});

test('spring starts at 0, settles at 1, overshoots', () => {
  const f = motion.spring({ stiffness: 170, damping: 12 });
  assert.equal(f(0), 0);
  assert.ok(Math.abs(f(10) - 1) < 1e-6);
  let max = 0;
  for (let t = 0; t < 2; t += 0.005) max = Math.max(max, f(t));
  assert.ok(max > 1.02, `expected overshoot, got ${max}`);
});

test('track interpolates and clamps', () => {
  const f = motion.track([[0, 0], [1, 10, 'linear'], [2, 0]]);
  assert.equal(f(-1), 0);
  assert.equal(f(0.5), 5);
  assert.equal(f(3), 0);
});

test('stagger is monotonic and inside lagRatio', () => {
  const s = motion.stagger(5, { lagRatio: 0.2 });
  assert.equal(s.length, 5);
  assert.ok(s.every((v, i) => i === 0 || v >= s[i - 1]));
  assert.ok(s[4] <= 0.2 + 1e-9);
});

test('transitionParams is deterministic and bounded', () => {
  for (const name of ['slam', 'whip', 'glitch', 'fade', 'none']) {
    const a = motion.transitionParams(name, 0.2);
    const b = motion.transitionParams(name, 0.2);
    assert.deepEqual(a, b);
  }
});

test('timeline example validates and plans exactly 1830 frames', () => {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/timeline.example.json'), 'utf8'));
  const v = validateComposition(spec);
  assert.equal(v.errors.length, 0, v.errors.join('; '));
  assert.equal(totalDuration(spec), 61);
  const plan = buildPlan(spec, { root: ROOT });
  assert.equal(plan.stats.frames, 1830);
  assert.equal(plan.segments.length, 33);
  assert.equal(plan.segments.reduce((s, x) => s + x.frames, 0), 1830);
  assert.equal(plan.segments[0].start, 0);
  assert.equal(plan.segments.at(-1).end, 61);
  assert.ok(plan.audio.cues.length > 33);
});

test('timeline rejects a broken structure', () => {
  const bad = { version: 1, meta: { fps: 30 }, rounds: [{ style: {} }] };
  assert.ok(validateComposition(bad).errors.length > 0);
});

test('themes: 13 themes, all have 14 colour roles and HUD', () => {
  assert.equal(themes.THEME_LIST.length, 13);
  const roles = ['bg', 'bgDeep', 'surface', 'ink', 'muted', 'accent', 'accentInk', 'accentSoft', 'paper', 'paperInk', 'paperMuted', 'cardDark', 'cardDarkInk', 'flash'];
  for (const t of themes.THEME_LIST) {
    for (const r of roles) assert.match(t.colors[r], /^#[0-9a-f]{6}$/i, `${t.id}.${r}`);
    for (const k of ['capsuleBg', 'capsuleNumber', 'capsuleText', 'hudText', 'countdown']) assert.ok(t.hud[k], `${t.id}.hud.${k}`);
    assert.ok(t.material && t.material.kind, `${t.id}.material`);
  }
});

test('theme lookup accepts aliases and falls back', () => {
  assert.equal(themes.getTheme('cyber').id, 'cyber-neon');
  assert.equal(themes.getTheme('冰蓝').id, 'ice-minimal');
  assert.equal(themes.getTheme('nope').id, 'coral-noir');
});

test('accentOverride keeps contrast on a brand colour', () => {
  const t = themes.accentOverride('coral-noir', '#00a3a3');
  assert.equal(t.colors.accent, '#00a3a3');
  assert.ok(color.contrastRatio(t.colors.accentInk, t.colors.accent) >= 4.5);
});

console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
