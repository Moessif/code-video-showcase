#!/usr/bin/env node
/**
 * new-project.mjs — scaffold a runnable showcase project from the skill.
 *
 *   node scripts/new-project.mjs --out ../my-film --name my-film --theme coral-noir --styles 11
 *
 * Copies the runtime (templates + browser helpers + QA scripts), creates
 * segments/00-opening.html … 99-ending.html, a timeline.json wired to those
 * pages, BRIEF.json and a package.json with the usual commands.
 *
 * Fonts: by default only shared/fonts.css is copied; pass --fonts to copy the
 * whole shared/fonts directory (≈60 MB), or point the CSS at your own fonts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (!next || next.startsWith('--')) args[a.slice(2)] = true;
  else { args[a.slice(2)] = next; i++; }
}
const num = (k, d) => (args[k] === undefined ? d : Number(args[k]));

if (args.help || !args.out) {
  console.log(`Usage: node scripts/new-project.mjs --out <dir> [options]
  --name <slug>       project name, default basename(out)
  --theme <id>        default coral-noir
  --styles <n>        number of style rounds, default 11
  --fps <n>           default 30
  --bpm <n>           default 120
  --brand <text>      default {{BRAND}}
  --fonts             copy shared/fonts (≈60 MB)
  --force             allow writing into a non-empty directory`);
  process.exit(args.help ? 0 : 1);
}

const OUT = path.resolve(String(args.out));
const NAME = String(args.name || path.basename(OUT));
const THEME = String(args.theme || 'coral-noir');
const STYLES = Math.max(1, Math.min(99, num('styles', 11)));
const FPS = num('fps', 30);
const BPM = num('bpm', 120);
const BRAND = String(args.brand || '{{BRAND}}');

if (fs.existsSync(OUT) && fs.readdirSync(OUT).length && !args.force) {
  console.error(`[abort] ${OUT} is not empty; pass --force to scaffold into it`);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
for (const d of ['segments', 'audio', 'out', 'shared', 'scripts', 'qa', 'templates']) fs.mkdirSync(path.join(OUT, d), { recursive: true });

function copy(rel, destDir = OUT) {
  const src = path.join(REPO, rel);
  if (!fs.existsSync(src)) { console.warn(`[warn] missing ${rel}`); return false; }
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, path.join(destDir, path.basename(rel)));
  return true;
}

// runtime browser modules go next to the segment HTML
// v2.3：common.js 会 import motion-profile.mjs（档位表），少复制一个页面就 404。
for (const f of ['common.js', 'motion.js', 'motion-profile.mjs', 'color.js', 'themes.js']) {
  copy(path.join('templates', f), path.join(OUT, 'segments'));
  copy(path.join('templates', f), path.join(OUT, 'templates'));
}
// segment pages
copy('templates/segment.html', path.join(OUT, 'segments'));
fs.copyFileSync(path.join(OUT, 'segments/segment.html'), path.join(OUT, 'segments/00-opening.html'));
fs.copyFileSync(path.join(OUT, 'segments/segment.html'), path.join(OUT, 'segments/flash.html'));
fs.copyFileSync(path.join(OUT, 'segments/segment.html'), path.join(OUT, 'segments/99-ending.html'));
for (let i = 1; i <= STYLES; i++) {
  fs.copyFileSync(path.join(OUT, 'segments/segment.html'), path.join(OUT, `segments/${String(i).padStart(2, '0')}.html`));
}
copy('templates/big-card.html', path.join(OUT, 'segments'));

// pipeline
for (const f of ['timeline.mjs', 'render-segment.mjs', 'render-farm.mjs', 'cdp.mjs', 'concat-and-encode.sh', 'synth_audio.py', 'timeline.example.json']) {
  copy(path.join('templates', f), path.join(OUT, 'templates'));
}
for (const f of ['qa-video.mjs', 'qa-audio.py', 'theme-audit.mjs', 'doctor.mjs', 'determinism-check.mjs']) {
  copy(path.join('scripts', f), path.join(OUT, 'scripts'));
}
copy('shared/fonts.css', path.join(OUT, 'shared'));
if (args.fonts) {
  fs.cpSync(path.join(REPO, 'shared/fonts'), path.join(OUT, 'shared/fonts'), { recursive: true });
} else {
  fs.mkdirSync(path.join(OUT, 'shared/fonts'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'shared/fonts/README.md'),
    `Copy the WOFF2 files from ${path.join(REPO, 'shared/fonts')} here,\n` +
    'or run `node scripts/build-fonts.mjs` in a checkout of code-video-showcase.\n');
}

// timeline.json
const styleNames = ['扁平插画科普', '数学动画', '极简发布会', '手绘白板', '赛博故障', '水墨国风', '数据可视化',
  '8-bit 像素', '代码录屏', 'Three.js 三维', '竖屏短视频'];
const cards = [
  ['想做', '科普视频？', '#ffcf5c'], ['想做', '知识讲解？', '#58c4dd'], ['想开', '产品发布会？', '#a58bff'],
  ['想做', '培训课件？', '#e0674b'], ['想做', '炫酷预告片？', '#ff2bd6'], ['想拍', '国风短片？', '#e0513a'],
  ['想做', '数据新闻？', '#ff5a4a'], ['想做', '游戏视频？', '#ffd84a'], ['想录', '编程教程？', '#c792ea'],
  ['想要', '3D质感？', '#ff8a5c'], ['想做', '竖屏短视频？', '#ff5f9e'],
];
const rounds = Array.from({ length: STYLES }, (_, i) => {
  const c = cards[i % cards.length];
  return {
    id: `r${String(i + 1).padStart(2, '0')}`,
    name: styleNames[i % styleNames.length],
    card: { layout: i % 4, first: c[0], keyword: c[1], color: c[2] },
    style: { page: `segments/${String(i + 1).padStart(2, '0')}.html`, t0: [0.35, 0.5, 0, 0.3][i % 4], speed: [1.4, 1.45, 1, 1.3][i % 4] },
  };
});
const timeline = {
  version: 1,
  meta: { title: NAME, brand: BRAND, theme: THEME, bpm: BPM, fps: FPS, width: 1920, height: 1080, outDir: 'out' },
  structure: { opening: 8, round: 4, card: 1, ending: 6, moreCard: 1, flash: { count: 8, each: 0.25 } },
  opening: { page: 'segments/00-opening.html' },
  rounds,
  moreCard: { page: 'segments/big-card.html', layout: 3, first: '还有', keyword: '更多？', color: '#ffcf5c' },
  flash: { page: 'segments/flash.html' },
  ending: { page: 'segments/99-ending.html' },
};
fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(timeline, null, 2));
fs.writeFileSync(path.join(OUT, 'BRIEF.json'), JSON.stringify({
  topic: '', channel: '1920x1080 横屏', brand: BRAND, cta: '',
  theme: THEME, duration: 8 + STYLES * 4 + 1 + 2 + 6, fps: FPS, bpm: BPM, styles: STYLES,
}, null, 2));
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify({
  name: NAME.replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'code-video-project',
  private: true, type: 'module', version: '0.1.0',
  scripts: {
    plan: 'node templates/timeline.mjs --spec timeline.json --out out/plan.json --concat out/segments.txt --print',
    render: 'node templates/render-farm.mjs --plan out/plan.json --resume',
    concat: 'bash templates/concat-and-encode.sh out/segments.txt audio/mix.wav out/final.mp4',
    qa: 'node scripts/qa-video.mjs out/final.mp4 --plan out/plan.json',
    'qa:audio': 'python scripts/qa-audio.py audio/mix.wav --plan out/plan.json',
    doctor: 'node scripts/doctor.mjs',
    determinism: 'node scripts/determinism-check.mjs --page "segments/01.html" --t 0.5',
    'theme:audit': 'node scripts/theme-audit.mjs --strict',
  },
}, null, 2));
fs.writeFileSync(path.join(OUT, 'README.md'), `# ${NAME}

Pure-code showcase project scaffolded by code-video-showcase.

\`\`\`bash
# 1. put fonts into shared/fonts/ (or rerun the scaffolder with --fonts)
# 2. edit timeline.json + segments/*.html + BRIEF.json
npm run doctor
npm run plan
npm run render
# 3. synthesize audio aligned to the timeline cues, then refine the arrangement
python templates/synth_audio.py --plan out/plan.json --out audio/mix.wav
npm run concat
npm run qa
\`\`\`

Theme: \`${THEME}\` · ${STYLES} style rounds · ${FPS} fps · ${BPM} BPM · ${8 + STYLES * 4 + 1 + 2 + 6}s
`);

console.log(`✓ project scaffolded: ${OUT}`);
console.log(`  ${STYLES} style rounds, ${FPS}fps, ${BPM} BPM, theme=${THEME}`);
console.log('  next: npm run doctor && npm run plan && npm run render');
