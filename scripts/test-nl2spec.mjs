#!/usr/bin/env node
/**
 * test-nl2spec.mjs — C1-03 验收：自然语言 → spec v1，20 条中英文语料。
 *
 * 断言：
 *   1. specVersion === 1；
 *   2. validateSpec(normalizeSpec(out)) 无 error；
 *   3. 所有枚举值合法（延迟读取 schema 与 themes.js，不硬编码副本）；
 *   4. 同一输入连续两次输出逐字节一致；
 *   5. 未命中的维度以默认值补齐，并在 meta.notes / meta.defaults 留下 default 标记。
 *
 * 退出码：0 = 全部通过并打印 ✓ 20/20；1 = 任一失败。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { nl2spec, fitStructure, KIND_IDS, STYLE_IDS, THEME_IDS } from './nl2spec.mjs';
import { normalizeSpec, validateSpec } from '../templates/spec.mjs';
import { THEME_IDS as REAL_THEME_IDS, accentOverride } from '../templates/themes.js';
import { auditApca } from '../templates/color.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', 'project.spec.schema.json'), 'utf8'));
const COMBOS = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'combos.json'), 'utf8'));

const allowed = (def) => {
  // 支持 definitions/enum、oneOf 里的 enum，取第一处 enum 作为白名单
  if (Array.isArray(def.enum)) return def.enum;
  for (const branch of def.oneOf || []) if (Array.isArray(branch.enum)) return branch.enum;
  return null;
};

const ENUMS = {
  aspect: allowed(SCHEMA.properties.format.properties.aspect),
  mood: allowed(SCHEMA.properties.audio.properties.mood),
  preset: allowed(SCHEMA.properties.render.properties.preset),
  quality: allowed(SCHEMA.properties.render.properties.quality),
  mode: allowed(SCHEMA.properties.look.properties.mode),
};

const CASES = [
  {
    text: '帮我做个赛博像素的宣传片，30秒竖屏',
    want: { kind: 'promo', style: 'cyber-pixel', theme: 'cyber-neon', duration: 30, aspect: '9:16' },
    label: '赛博像素 / 竖屏 / 30s',
  },
  {
    text: '做一支产品发布视频，16:9，60秒',
    want: { kind: 'launch', duration: 60, aspect: '16:9' },
    label: '产品发布 / 横屏 / 60s',
  },
  {
    text: '知识科普短视频，讲清楚为什么有四季',
    want: { kind: 'knowledge' },
    label: '知识科普',
  },
  {
    text: '电商带货，抖音竖屏，15秒',
    want: { kind: 'ecommerce', aspect: '9:16', duration: 15 },
    label: '电商竖屏 / 15s',
  },
  {
    text: '招聘宣传片，60秒横屏',
    want: { kind: 'recruiting', duration: 60, aspect: '16:9' },
    label: '招聘 / 横屏 / 60s',
  },
  {
    text: '年度总结视频',
    want: { kind: 'annual' },
    label: '年度总结',
  },
  {
    text: '品牌故事，水墨国风，青瓷质感',
    want: { kind: 'brand-story', style: 'ink-wash', theme: 'celadon-paper' },
    label: '品牌故事 / 水墨 / 青瓷',
  },
  {
    text: '数据报告，蓝图纸风格',
    want: { kind: 'data-report', theme: 'blueprint-stone' },
    label: '数据报告 / 蓝图',
  },
  {
    text: 'Make a cyberpunk promo video, 30 seconds, vertical',
    want: { kind: 'promo', style: 'cyber-pixel', duration: 30, aspect: '9:16' },
    label: 'EN cyberpunk promo',
  },
  {
    text: 'product launch film, 41s, 16:9, minimal',
    want: { kind: 'launch', duration: 41, aspect: '16:9', style: 'minimal' },
    label: 'EN launch / 41s',
  },
  {
    text: 'an explainer about fourier series',
    want: { kind: 'knowledge' },
    label: 'EN explainer',
  },
  {
    text: 'recruiting video for engineers, 30s',
    want: { kind: 'recruiting', duration: 30 },
    label: 'EN recruiting',
  },
  {
    text: 'annual recap 2025, one minute',
    want: { kind: 'annual', duration: 60 },
    label: 'EN annual / 1min',
  },
  {
    text: '白板手绘教程，知识科普',
    want: { kind: 'knowledge', style: 'whiteboard' },
    label: '白板 / 科普',
  },
  {
    text: '3D 产品发布，科技感',
    want: { kind: 'launch', style: 'three-d', styleFamily: 'tech' },
    label: '3D / 发布会 / 科技',
  },
  {
    text: '数据可视化年度报告',
    want: { kind: 'annual', style: 'data-viz' },
    label: '数据可视化 / 年度',
  },
  {
    text: '代码录屏教程',
    want: { style: 'screencast' },
    label: '代码录屏',
  },
  {
    text: '国风品牌故事，东方气质',
    want: { kind: 'brand-story', style: 'guofeng', mood: 'guofeng' },
    label: '国风 / 东方',
  },
  {
    text: '8-bit 像素风格的招聘片',
    want: { kind: 'recruiting', style: 'pixel-8bit' },
    label: '8-bit / 招聘',
  },
  {
    text: '随便做一个视频',
    want: { allDefaults: true },
    label: '无关键词 / 全默认',
  },
];

let passed = 0;
const failures = [];

for (const [index, c] of CASES.entries()) {
  const where = `case ${String(index + 1).padStart(2, '0')} (${c.label})`;
  try {
    // 4) 确定性：同一输入两次输出逐字节一致
    const once = nl2spec(c.text);
    const twice = nl2spec(c.text);
    const bytesA = JSON.stringify(once);
    const bytesB = JSON.stringify(twice);
    assert.equal(bytesA, bytesB, `${where}: same input produced different bytes`);

    // 1) specVersion
    assert.equal(once.specVersion, 1, `${where}: specVersion must be 1`);

    // 2) normalize + validate 无 error
    const normalized = normalizeSpec(once);
    const issues = validateSpec(normalized);
    const errors = issues.filter((i) => i.level === 'error');
    assert.equal(
      errors.length,
      0,
      `${where}: validateSpec errors: ${errors.map((e) => `${e.code} ${e.path}: ${e.message}`).join(' | ')}`,
    );

    // 3) 枚举合法（对照 schema 与 themes.js）
    assert.ok(ENUMS.aspect.includes(once.format.aspect), `${where}: illegal aspect ${once.format.aspect}`);
    assert.ok(ENUMS.mood.includes(once.audio.mood), `${where}: illegal mood ${once.audio.mood}`);
    assert.ok(ENUMS.preset.includes(once.render.preset), `${where}: illegal render.preset ${once.render.preset}`);
    assert.ok(ENUMS.quality.includes(once.render.quality), `${where}: illegal render.quality ${once.render.quality}`);
    assert.ok(ENUMS.mode.includes(once.look.mode), `${where}: illegal look.mode ${once.look.mode}`);
    assert.ok(STYLE_IDS.includes(once.look.style), `${where}: unknown style ${once.look.style}`);
    assert.ok(THEME_IDS.includes(once.look.theme), `${where}: unknown theme ${once.look.theme}`);
    assert.ok(REAL_THEME_IDS.includes(once.look.theme), `${where}: theme ${once.look.theme} not in templates/themes.js`);
    assert.ok(KIND_IDS.includes(once.meta.kind), `${where}: unknown kind ${once.meta.kind}`);

    // 时长公式成立
    const total =
      once.structure.opening +
      once.rounds.length * once.structure.round +
      once.structure.moreCard +
      once.structure.flash.count * once.structure.flash.each +
      once.structure.ending;
    assert.ok(
      Math.abs(total - once.format.duration) < 0.05,
      `${where}: structure total ${total} != duration ${once.format.duration}`,
    );

    // 5) 未命中项有 default 标记；命中项不应冒领
    const defaults = once.meta.defaults || [];
    const notes = once.meta.notes || [];
    assert.ok(Array.isArray(notes), `${where}: meta.notes must be an array`);
    if (c.want.allDefaults) {
      assert.ok(defaults.length >= 5, `${where}: expected several default dimensions, got [${defaults}]`);
      assert.ok(
        notes.some((n) => String(n).startsWith('default:')),
        `${where}: meta.notes must carry a "default:" marker`,
      );
    }
    for (const dim of ['kind', 'style', 'theme', 'format', 'mood', 'brand', 'cta']) {
      const isDefault = defaults.includes(dim);
      if (isDefault) {
        assert.ok(
          notes.some((n) => String(n).includes(`default:${dim}`)),
          `${where}: dimension ${dim} is default but has no note marker`,
        );
      }
    }

    // 语义期望
    const w = c.want;
    if (w.kind) assert.equal(once.meta.kind, w.kind, `${where}: kind ${once.meta.kind} != ${w.kind}`);
    if (w.style) assert.equal(once.look.style, w.style, `${where}: style ${once.look.style} != ${w.style}`);
    if (w.theme) assert.equal(once.look.theme, w.theme, `${where}: theme ${once.look.theme} != ${w.theme}`);
    if (w.duration) assert.equal(once.format.duration, w.duration, `${where}: duration ${once.format.duration} != ${w.duration}`);
    if (w.aspect) assert.equal(once.format.aspect, w.aspect, `${where}: aspect ${once.format.aspect} != ${w.aspect}`);
    if (w.mood) assert.equal(once.audio.mood, w.mood, `${where}: mood ${once.audio.mood} != ${w.mood}`);
    if (w.styleFamily === 'tech') {
      assert.ok(['three-d', 'data-viz', 'screencast'].includes(once.look.style), `${where}: expected a tech style`);
    }

    // 每轮页面必须真实存在（spec-lint 的页面检查）
    const pages = new Set([
      once.opening.page,
      ...once.rounds.flatMap((r) => [r.card.page, r.style.page]),
      once.moreCard.page,
      once.flash.page,
      once.ending.page,
    ]);
    for (const page of pages) {
      const p = String(page).split('?')[0];
      assert.ok(fs.existsSync(path.join(ROOT, p)), `${where}: page does not exist: ${p}`);
    }

    passed++;
  } catch (e) {
    failures.push(`${where}: ${e.message}`);
  }
}

// 结构公式穷举：任意 4–600s 与任意显式轮数，D 必须精确成立（回归：4s 曾多出 0.5s）
try {
  for (let D = 4; D <= 600; D++) {
    for (const rc of [undefined, 1, 2, 3, 6, 12, 24]) {
      const { structure, rounds } = fitStructure(D, rc);
      const total =
        structure.opening +
        rounds * structure.round +
        structure.moreCard +
        structure.flash.count * structure.flash.each +
        structure.ending;
      assert.ok(Math.abs(total - D) < 0.01, `fit ${D}s rounds=${rc}: total ${total}`);
      for (const k of ['opening', 'round', 'card', 'ending', 'moreCard']) {
        assert.ok(structure[k] > 0, `fit ${D}s rounds=${rc}: ${k}=${structure[k]}`);
      }
      assert.ok(structure.card < structure.round, `fit ${D}s rounds=${rc}: card ${structure.card} >= round ${structure.round}`);
      assert.ok(rounds >= 1 && rounds <= 24, `fit ${D}s rounds=${rc}: n=${rounds}`);
    }
  }
} catch (e) {
  failures.push(`fitStructure: ${e.message}`);
}

// APCA 回归：combos._meta.accentFix 覆盖的两套主题，必须真的过 spec-lint 的 45/30 门槛
try {
  const fix = COMBOS?._meta?.accentFix || {};
  assert.ok(Object.keys(fix).length >= 2, 'combos._meta.accentFix must cover the low-contrast themes');
  for (const theme of Object.keys(fix)) {
    const spec = nl2spec('', { theme, style: 'flat' });
    assert.deepEqual(
      spec.look.accentOverride,
      { accent: fix[theme].accent, accentInk: fix[theme].accentInk },
      `accentFix drift for ${theme}`,
    );
    const themed = accentOverride(spec.look.theme, spec.look.accentOverride);
    for (const row of auditApca(themed)) {
      const practical = { 'accentInk / accent': 45, 'muted / bg': 30, 'paperMuted / paper': 30, 'accent / bg': 30 };
      const need = practical[row.pair] ?? row.need;
      assert.ok(row.lc >= need, `APCA ${theme} ${row.pair} = ${row.lc} < ${need}`);
    }
  }
} catch (e) {
  failures.push(`accentFix: ${e.message}`);
}

// 品牌 / CTA 抽取：不能把后面的整句吞进品牌名，也不能把 CTA 写成默认值
try {
  const b = nl2spec('品牌：青瓷实验室 的宣传片，结尾 CTA：预约参观');
  assert.equal(b.meta.brand, '青瓷实验室');
  assert.equal(b.meta.cta, '预约参观');
  assert.ok(!b.meta.defaults.includes('brand'), 'explicit brand must not be marked default');
  assert.ok(!b.meta.defaults.includes('cta'), 'explicit CTA must not be marked default');
} catch (e) {
  failures.push(`brand/cta: ${e.message}`);
}

// 非法时长 / 0 秒：必须回落到默认值并留下 default / ignored 标记
try {
  const zero = nl2spec('0秒宣传片');
  assert.equal(zero.format.duration, 30);
  assert.ok(zero.meta.defaults.includes('format'), '0s must be treated as unmatched duration');
  const bad = nl2spec('宣传片', { duration: 'abc' });
  assert.equal(bad.format.duration, 30);
  assert.ok(bad.meta.notes.some((n) => n.includes('ignored:duration')), 'invalid duration override must be reported');
  assert.ok(bad.meta.defaults.includes('format'), 'invalid override must fall back to default format');
} catch (e) {
  failures.push(`bad duration: ${e.message}`);
}

// overrides 优先级（不计入 20 条，但属于契约）
try {
  const o = nl2spec('宣传片', { duration: 15, aspect: '9:16', theme: 'ice-minimal', brand: 'ACME', cta: '立即体验' });
  assert.equal(o.format.duration, 15);
  assert.equal(o.format.aspect, '9:16');
  assert.equal(o.format.width, 1080);
  assert.equal(o.format.height, 1920);
  assert.equal(o.look.theme, 'ice-minimal');
  assert.equal(o.meta.brand, 'ACME');
  assert.equal(o.meta.cta, '立即体验');
  assert.deepEqual(validateSpec(normalizeSpec(o)).filter((i) => i.level === 'error'), []);
} catch (e) {
  failures.push(`overrides: ${e.message}`);
}

if (failures.length) {
  console.error(`✗ ${passed}/${CASES.length} passed, ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`✓ ${passed}/${CASES.length}`);
