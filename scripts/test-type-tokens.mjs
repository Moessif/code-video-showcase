#!/usr/bin/env node
/**
 * test-type-tokens.mjs — 排版 token 的静态 + 真机验收（v2.4 / P1-06）。
 *
 *   CHROME_EXE="C:/Program Files/Google/Chrome/Application/chrome.exe" node scripts/test-type-tokens.mjs
 *
 * 静态：
 *   1. tokens.mjs 恰好 4 级字阶（display/title/body/caption），且按短边归一；
 *   2. 每个配方页都 import tokens 并在布局时写 window.__typeProbe；
 *   3. safePad() 与 safe().x 同值（单一安全区真值）。
 * 真机（有 Chrome 时）：
 *   4. 13 个配方页在 1920×1080 下 titlePx 的最大/最小比值 ≤ 1.1；
 *   5. 每页左右安全区相等；
 *   6. 同一页两次渲染的 probe 值稳定（确定性）。
 *
 * 退出码 0/1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withRenderer } from '../templates/render-segment.mjs';
import { TYPE_SCALE, safe, typeSize } from '../templates/tokens.mjs';
import { safePad } from '../templates/recipes/util.js';
import { STYLE_PAGES } from '../templates/style-pages.mjs';
import { browserCandidates } from '../templates/cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
// 与其它浏览器套件一致：CHROME_EXE 优先，否则自动发现（不再因缺 env 静默跳过）。
const CHROME = process.env.CHROME_EXE || browserCandidates()[0] || '';

// 从 STYLE_PAGES 单一真值派生，新增风格不会漏检（v2.5.2 审计：旧硬编码漏了 6 个）。
const THEME_FOR = {
  'cyber-pixel': 'cyber-neon', 'cyber-glitch': 'cyber-neon', 'pixel-8bit': 'cyber-neon',
  'ink-wash': 'celadon-paper', guofeng: 'celadon-paper', 'great-wall': 'dark-gold-cinema',
  whiteboard: 'paper-journal', 'three-d': 'cyber-neon', 'data-viz': 'cyber-neon',
  screencast: 'coral-noir', flat: 'coral-noir', minimal: 'coral-noir', kinetic: 'coral-noir',
  swiss: 'ice-minimal', editorial: 'paper-journal', brutalist: 'pop-acid',
  vaporwave: 'cyber-neon', blueprint: 'blueprint-stone', risograph: 'paper-journal',
};
const PAGES = Object.entries(STYLE_PAGES)
  .filter(([id]) => id !== 'vertical') // 通用场景页不在字阶契约内
  .map(([id, page]) => ({ id, page, theme: THEME_FOR[id] || 'coral-noir' }));

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (ok) passed++; else failed++;
  return ok;
}

// ── 静态 ───────────────────────────────────────────────────────────────────

const roles = Object.keys(TYPE_SCALE);
check('字阶恰好 4 级 display/title/body/caption', roles.length === 4
  && ['display', 'title', 'body', 'caption'].every((r) => roles.includes(r)), roles.join(','));
check('字阶按短边归一（1920×1080 与 1080×1920 的 title 同值）',
  typeSize('title', 1920, 1080) === typeSize('title', 1080, 1920),
  `${typeSize('title', 1920, 1080)} vs ${typeSize('title', 1080, 1920)}`);
check('safe() 左右相等', safe(1920, 1080).left === safe(1920, 1080).right
  && safe(1080, 1920).left === safe(1080, 1920).right);
check('safePad() 委托 tokens.safe()', safePad(1920, 1080) === safe(1920, 1080).x);

for (const p of PAGES) {
  const src = fs.readFileSync(path.join(ROOT, p.page), 'utf8');
  check(`${p.id}: imports tokens.mjs`, /from '\.\/tokens\.mjs'/.test(src));
  check(`${p.id}: writes window.__typeProbe`, /probe\('(?:title|display)'/.test(src));
}

// ── 真机 ───────────────────────────────────────────────────────────────────

if (!CHROME) {
  console.log('\n(no CHROME_EXE; skipped the browser half)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

const TITLE = '标题测试';
async function measure(ctx, p) {
  const url = `${p.page}?theme=${p.theme}&title=${encodeURIComponent(TITLE)}`;
  // openPage() 内部已经等 __ready / __bootError；返回对象只有 ev / shot / close。
  const page = await ctx.openPage({ page: url, width: 1920, height: 1080, duration: 3, timeout: 90000 });
  try {
    const probe = await page.ev(() => window.__typeProbe || null);
    if (!probe) throw new Error('window.__typeProbe missing');
    return probe;
  } finally {
    await page.close().catch(() => {});
  }
}

try {
  await withRenderer({ root: ROOT, width: 1920, height: 1080, quiet: true }, async (ctx) => {
    const rows = [];
    for (const p of PAGES) {
      try {
        const probe = await measure(ctx, p);
        const again = await measure(ctx, p);
        rows.push({ id: p.id, ...probe });
        check(`${p.id}: titlePx 稳定`, probe.titlePx === again.titlePx, `${probe.titlePx} vs ${again.titlePx}`);
      } catch (e) {
        failed += 1;
        console.error(`FAIL  ${p.id}: ${String(e.message || e).split('\n')[0]}`);
      }
    }
    if (rows.length >= 2) {
      // 真不变量：每页实际标题 = 它声明那一级的 token（±15%，低分辨率画布有栅格量化）。
      const off = rows.map((r) => {
        const want = typeSize(r.role === 'display' ? 'display' : 'title', 1920, 1080);
        return { id: r.id, role: r.role, px: r.titlePx, want, ratio: r.titlePx / want };
      });
      const bad = off.filter((o) => !(o.ratio >= 0.85 && o.ratio <= 1.15));
      check('每页标题 = 其声明档位的 token（±15%）', bad.length === 0,
        bad.map((o) => `${o.id}:${o.px}/${o.want}=${o.ratio.toFixed(2)}`).join(' ') || 'all within band');

      // 同一档（title）的页面之间必须看齐：这是「像个片子」的判据。
      const titles = off.filter((o) => o.role !== 'display').map((o) => o.px);
      const min = Math.min(...titles);
      const max = Math.max(...titles);
      check('同档 title 页之间 titlePx 最大/最小 ≤ 1.1', max / min <= 1.1,
        `${min}..${max} (ratio ${(max / min).toFixed(3)})`);
      check('所有页左右安全区相等', rows.every((r) => r.safe && r.safe.left === r.safe.right));
    }
  });
} catch (e) {
  failed += 1;
  console.error(`FAIL  browser: ${String(e.message || e).split('\n')[0]}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failed ? 1 : 0);
