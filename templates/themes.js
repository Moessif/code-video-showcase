/**
 * themes.js — code-video-showcase 主题系统（唯一数据源）
 * ============================================================================
 * 一个「主题」不是一组颜色，而是四件事的组合：
 *   1. 角色色板（palette roles）—— 底色 / 主字 / 强调 / 纸面 / 暗卡 …
 *   2. 材质（material）—— 颗粒、柔光、液态玻璃、烫金、蓝图网格、哑光、水墨、聚光
 *   3. HUD 规格 —— 胶囊标签 / 倒计时 / 水印在浅底和暗底上的不同画法
 *   4. 推荐点缀色（accents）+ 适用场景 —— 给 11 个风格段和 agent 的选色建议
 *
 * 默认主题 `coral-noir` 与旧版视觉逐值一致（#d97757 / #0e0e0d / #f4efe6 /
 * rgba(12,12,12,.72) 胶囊），所以老项目不传 theme 参数时行为不变。
 *
 * 用法（Canvas 页面，如 big-card.html / segment.html）：
 *   import { themeFromURL, chrome, cardColors, drawThemeBackground, loadFontsFor } from './themes.js';
 *   const theme = themeFromURL(location.search);     // ?theme=aqua-morandi / claude-light / …
 *   drawThemeBackground(ctx, theme, W, H, t);        // 底色 + 材质（确定性，只依赖 t）
 *   const hud = chrome(theme);                       // drawCapsuleLabel(..., hud.capsule)
 *   const card = cardColors(theme, layout);          // layout 0=强调底 1=纸底 2/3=暗卡
 *
 * 页面 URL 选择主题（都行）：
 *   big-card.html?theme=aqua-morandi
 *   big-card.html?theme=claude          // 别名
 *   big-card.html                       // 默认 coral-noir
 *
 * 命令行检查全部主题的对比度：
 *   node scripts/theme-audit.mjs
 * ============================================================================
 */

export const THEME_SCHEMA_VERSION = 1;

/* ────────────────────────────────────────────────────────────────────────────
 * 主题数据
 * ──────────────────────────────────────────────────────────────────────────── */

export const THEMES = {
  /* 1 ── 原版：暗场 + 珊瑚。所有值与原模板一致，是默认值。──────────────── */
  'coral-noir': {
    id: 'coral-noir',
    name: '珊瑚暗夜',
    nameEn: 'Coral Noir',
    mode: 'dark',
    tagline: '温暖暗场 + 珊瑚一点，原版电影感',
    useFor: '默认 / 科技发布 / 产品片',
    aliases: ['coral', 'noir', 'original', 'default', '默认', '原版'],
    colors: {
      bg: '#0e0e0d',
      bgDeep: '#060605',
      surface: '#1a1917',
      ink: '#f5f0e8',
      muted: '#8f8981',
      accent: '#d97757',
      accentInk: '#0e0e0d',
      accentSoft: '#f0b49c',
      paper: '#f4efe6',
      paperInk: '#141311',
      paperMuted: '#6f6a61',
      cardDark: '#0e0e0d',
      cardDarkInk: '#f5f0e8',
      flash: '#ffffff',
    },
    accents: [
      { name: '暖金', hex: '#ffcf5c' },
      { name: '冰蓝', hex: '#58c4dd' },
      { name: '紫罗兰', hex: '#a58bff' },
      { name: '霓虹粉', hex: '#ff2bd6' },
    ],
    hud: {
      capsuleBg: 'rgba(12,12,12,0.72)',
      capsuleBorder: 'rgba(255,255,255,0.18)',
      capsuleNumber: '#d97757',
      capsuleText: '#f5f0e8',
      hudText: 'rgba(245,240,232,0.42)',
      countdown: 'rgba(245,240,232,0.72)',
    },
    cardSheen: 'rgba(255,255,255,0.06)',
    material: {
      kind: 'grain',
      name: '胶片颗粒',
      note: '暗场保留颗粒与珊瑚径向光晕；光晕只在片头和风格段落之间出现。',
      grain: 0.055,
      glow: { color: '#d97757', alpha: 0.3, radius: 1040, x: 0.74, y: 0.3 },
      grid: null,
      glass: null,
      foil: null,
      tints: null,
      texture: 'grain',
    },
    type: {
      display: 'Noto Sans SC 900',
      accent: 'Playfair Display 斜体',
      note: '沿用原版排印，不要换字体；珊瑚只做强调，不做大面积背景。',
      fonts: ['Noto Sans SC', 'JetBrains Mono'],
    },
  },

  /* 2 ── 橙光白（Claude 品牌自有色）────────────────────────────────────── */
  'claude-light': {
    id: 'claude-light',
    name: '橙光白',
    nameEn: 'Claude Light',
    mode: 'light',
    tagline: '暖纸底 + 陶土橙，像一页印好的信',
    useFor: '品牌 / 知识 / 生活方式 / 访谈',
    aliases: ['claude', 'orange-light', 'cream', '橙光白'],
    colors: {
      bg: '#f0eee6',
      bgDeep: '#e7e3d7',
      surface: '#e8e4d8',
      ink: '#1f1e1d',
      muted: '#6b675e',
      accent: '#d97757',
      accentInk: '#1f1e1d',
      accentSoft: '#f2c7b5',
      paper: '#fbfaf6',
      paperInk: '#1f1e1d',
      paperMuted: '#6b675e',
      cardDark: '#1f1e1d',
      cardDarkInk: '#f0eee6',
      flash: '#ffffff',
    },
    accents: [
      { name: '陶土橙', hex: '#d97757' },
      { name: '赭黄', hex: '#c9a45a' },
      { name: '鼠尾草', hex: '#8a9a8b' },
      { name: '灰蓝', hex: '#7c9aa6' },
    ],
    hud: {
      capsuleBg: 'rgba(31,30,29,0.9)',
      capsuleBorder: 'rgba(255,255,255,0.2)',
      capsuleNumber: '#f2c7b5',
      capsuleText: '#f7f4ec',
      hudText: 'rgba(31,30,29,0.52)',
      countdown: 'rgba(31,30,29,0.58)',
    },
    cardSheen: 'rgba(255,255,255,0.14)',
    material: {
      kind: 'paper',
      name: '纸面柔光',
      note: '暖纸底 + 陶土橙色场；光只做极轻的暖晕，不叠加玻璃或金属。',
      grain: 0.03,
      glow: { color: '#f2c7b5', alpha: 0.24, radius: 1280, x: 0.82, y: 0.12 },
      grid: null,
      glass: null,
      foil: null,
      tints: null,
      texture: 'paper',
    },
    type: {
      display: 'Noto Sans SC 900',
      accent: 'Playfair Display 斜体',
      note: '这是 Claude 品牌自有色，属于 design-taste 里「品牌自有例外」：用整段色场和严格排印压住奶油底的 AI 味，不要加渐变光球。',
      fonts: ['Noto Sans SC', 'Playfair Display', 'JetBrains Mono'],
    },
  },

  /* 3 ── 水蓝白 · 莫兰迪（柔光 + 淡绿/淡粉 + 液态玻璃）────────────────── */
  'aqua-morandi': {
    id: 'aqua-morandi',
    name: '水蓝白 · 莫兰迪',
    nameEn: 'Aqua Morandi',
    mode: 'light',
    tagline: '雾面水色，淡绿与淡粉只从光里透出来',
    useFor: '品牌 / 美妆 / 生活方式 / 轻科技',
    aliases: ['aqua', 'water', 'morandi', '水蓝白', '莫兰迪'],
    colors: {
      bg: '#f4f8f8',
      bgDeep: '#e6f0f1',
      surface: '#eaf2f2',
      ink: '#2f3a3c',
      muted: '#617376',
      accent: '#6e9fae',
      accentInk: '#223134',
      accentSoft: '#a9c9d3',
      paper: '#fbfcfc',
      paperInk: '#2a3537',
      paperMuted: '#617376',
      cardDark: '#2f3a3c',
      cardDarkInk: '#f0f6f6',
      flash: '#ffffff',
    },
    accents: [
      { name: '淡绿', hex: '#a8c3a0' },
      { name: '淡粉', hex: '#e6c2c6' },
      { name: '暖沙', hex: '#d9cbb8' },
      { name: '雾蓝', hex: '#a9c9d3' },
    ],
    hud: {
      capsuleBg: 'rgba(47,58,60,0.88)',
      capsuleBorder: 'rgba(255,255,255,0.28)',
      capsuleNumber: '#a9c9d3',
      capsuleText: '#f0f6f6',
      hudText: 'rgba(47,58,60,0.44)',
      countdown: 'rgba(47,58,60,0.52)',
    },
    cardSheen: 'rgba(255,255,255,0.22)',
    material: {
      kind: 'glass',
      name: '液态玻璃 · 柔光',
      note: '雾面水色底上浮三团柔光（淡绿 / 淡粉 / 雾蓝），信息卡用液态玻璃：半透明白、1px 高光边、斜向高光。莫兰迪靠明度差分层，不靠高对比。',
      grain: 0.018,
      glow: { color: '#a9c9d3', alpha: 0.26, radius: 1100, x: 0.28, y: 0.22 },
      grid: null,
      glass: {
        fill: 'rgba(255,255,255,0.42)',
        border: 'rgba(255,255,255,0.78)',
        sheen: 'rgba(255,255,255,0.92)',
        tint: 'rgba(168,195,160,0.1)',
      },
      foil: null,
      tints: ['#a8c3a0', '#e6c2c6', '#a9c9d3'],
      texture: 'grain',
    },
    type: {
      display: 'Noto Sans SC 500 / 700',
      accent: 'Noto Serif SC',
      note: '字重比原版轻一档、留白更多；淡绿/淡粉只出现在光和玻璃高光里，不要拿它们当大面积底色。',
      fonts: ['Noto Sans SC', 'Noto Serif SC', 'JetBrains Mono'],
    },
  },

  /* 4 ── 琥珀黑金 ──────────────────────────────────────────────────────── */
  'amber-noir': {
    id: 'amber-noir',
    name: '琥珀黑金',
    nameEn: 'Amber Noir',
    mode: 'dark',
    tagline: '近黑与旧金，片头字幕的质地',
    useFor: '高端 / 奢品 / 电影感 / 年度片',
    aliases: ['amber', 'gold', '琥珀', '黑金'],
    colors: {
      bg: '#0c0a08',
      bgDeep: '#060504',
      surface: '#181512',
      ink: '#ffffff',
      muted: '#8f8a84',
      accent: '#c9a45a',
      accentInk: '#0c0a08',
      accentSoft: '#e3c98f',
      paper: '#efe7d8',
      paperInk: '#191512',
      paperMuted: '#6f675c',
      cardDark: '#0c0a08',
      cardDarkInk: '#ffffff',
      flash: '#fff3dd',
    },
    accents: [
      { name: '旧金', hex: '#c9a45a' },
      { name: '古铜', hex: '#8f6b3d' },
      { name: '橄榄', hex: '#5e6b5a' },
      { name: '酒红', hex: '#9a5b4a' },
    ],
    hud: {
      capsuleBg: 'rgba(10,8,6,0.78)',
      capsuleBorder: 'rgba(255,255,255,0.16)',
      capsuleNumber: '#c9a45a',
      capsuleText: '#ffffff',
      hudText: 'rgba(255,255,255,0.4)',
      countdown: 'rgba(255,255,255,0.66)',
    },
    cardSheen: 'rgba(255,226,170,0.1)',
    material: {
      kind: 'foil',
      name: '金属烫金',
      note: '烫金斜光只擦过标题和细线，不铺满画面；近黑底保持安静。',
      grain: 0.04,
      glow: { color: '#c9a45a', alpha: 0.24, radius: 980, x: 0.68, y: 0.24 },
      grid: null,
      glass: null,
      foil: { angle: -24, color: 'rgba(255,226,170,0.12)' },
      tints: null,
      texture: 'grain',
    },
    type: {
      display: 'Playfair Display + Noto Sans SC',
      accent: 'Playfair Display',
      note: '衬线大标题、字距略收紧；HUD 用 JetBrains Mono 拉出奢侈品目录感。',
      fonts: ['Playfair Display', 'Noto Sans SC', 'JetBrains Mono'],
    },
  },

  /* 5 ── 蓝图纸 ────────────────────────────────────────────────────────── */
  'blueprint-stone': {
    id: 'blueprint-stone',
    name: '蓝图纸',
    nameEn: 'Blueprint Stone',
    mode: 'light',
    tagline: '石色纸 + 蓝图钴蓝，工程档案',
    useFor: '工程 / 建筑 / 数据 / 技术',
    aliases: ['blueprint', 'stone', '蓝图', '图纸'],
    colors: {
      bg: '#dfdedb',
      bgDeep: '#d3d2ce',
      surface: '#d3d2ce',
      ink: '#26251e',
      muted: '#5f5d55',
      accent: '#2456d6',
      accentInk: '#f7f8fa',
      accentSoft: '#9db4ee',
      paper: '#f3f2ef',
      paperInk: '#26251e',
      paperMuted: '#5f5d55',
      cardDark: '#26251e',
      cardDarkInk: '#dfdedb',
      flash: '#ffffff',
    },
    accents: [
      { name: '钴蓝', hex: '#2456d6' },
      { name: '砖红', hex: '#c2452d' },
      { name: '墨绿', hex: '#4c6b4f' },
      { name: '赭石', hex: '#8a7a50' },
    ],
    hud: {
      capsuleBg: 'rgba(38,37,30,0.9)',
      capsuleBorder: 'rgba(255,255,255,0.22)',
      capsuleNumber: '#9db4ee',
      capsuleText: '#f3f2ef',
      hudText: 'rgba(38,37,30,0.48)',
      countdown: 'rgba(38,37,30,0.56)',
    },
    cardSheen: 'rgba(255,255,255,0.1)',
    material: {
      kind: 'grid',
      name: '蓝图网格',
      note: '石色纸上叠 80px 蓝图细网格；没有光晕，靠网格、色块和等宽标注讲结构。',
      grain: 0.02,
      glow: null,
      grid: { color: '#2456d6', alpha: 0.055, step: 80, major: 5, majorAlpha: 0.1 },
      glass: null,
      foil: null,
      tints: null,
      texture: 'grid',
    },
    type: {
      display: 'Noto Sans SC 700',
      accent: 'JetBrains Mono',
      note: '工程档案感：编号、坐标、标注一律等宽；中文标题保持粗黑，不要用衬线。',
      fonts: ['Noto Sans SC', 'JetBrains Mono'],
    },
  },

  /* 6 ── 石墨信号 ──────────────────────────────────────────────────────── */
  'graphite-signal': {
    id: 'graphite-signal',
    name: '石墨信号',
    nameEn: 'Graphite Signal',
    mode: 'dark',
    tagline: '石墨灰 + 安全橙，工业硬核，没有光晕',
    useFor: '开发者 / 硬件 / 工业 / 硬核科技',
    aliases: ['graphite', 'signal', '石墨', '工业'],
    colors: {
      bg: '#18191b',
      bgDeep: '#101113',
      surface: '#222427',
      ink: '#eff0f1',
      muted: '#9c9ea3',
      accent: '#ff4a1f',
      accentInk: '#18191b',
      accentSoft: '#ffb199',
      paper: '#e9eaeb',
      paperInk: '#17181a',
      paperMuted: '#5d5f63',
      cardDark: '#18191b',
      cardDarkInk: '#eff0f1',
      flash: '#ffffff',
    },
    accents: [
      { name: '安全橙', hex: '#ff4a1f' },
      { name: '工业蓝', hex: '#3d68ff' },
      { name: '警示黄', hex: '#f2c14e' },
      { name: '中灰', hex: '#9c9ea3' },
    ],
    hud: {
      capsuleBg: 'rgba(20,21,23,0.82)',
      capsuleBorder: 'rgba(255,255,255,0.16)',
      capsuleNumber: '#ff4a1f',
      capsuleText: '#eff0f1',
      hudText: 'rgba(239,240,241,0.4)',
      countdown: 'rgba(239,240,241,0.66)',
    },
    cardSheen: 'rgba(255,255,255,0.05)',
    material: {
      kind: 'matte',
      name: '哑光工业',
      note: '哑光工业灰 + 安全橙；禁止柔光和投影，所有面都是平的，只在边角留一条橙色警示线。',
      grain: 0.03,
      glow: null,
      grid: { color: '#eff0f1', alpha: 0.03, step: 120, major: 0, majorAlpha: 0 },
      glass: null,
      foil: null,
      tints: null,
      texture: 'grid',
    },
    type: {
      display: 'Noto Sans SC 900',
      accent: 'JetBrains Mono',
      note: '更紧的字距、更硬的边；参数、编号、单位都用等宽字体。',
      fonts: ['Noto Sans SC', 'JetBrains Mono'],
    },
  },

  /* 7 ── 青瓷白（单色青）──────────────────────────────────────────────── */
  'celadon-paper': {
    id: 'celadon-paper',
    name: '青瓷白',
    nameEn: 'Celadon Paper',
    mode: 'light',
    tagline: '整片只有一种深青，像瓷器上的釉',
    useFor: '东方 / 文化 / 极简 / 品牌故事',
    aliases: ['celadon', 'teal', '青瓷', '青'],
    colors: {
      bg: '#f7f9f8',
      bgDeep: '#e9f0ee',
      surface: '#ebf0ee',
      ink: '#06525c',
      muted: '#2f737d',
      accent: '#06525c',
      accentInk: '#f7f9f8',
      accentSoft: '#8fb9bc',
      paper: '#ffffff',
      paperInk: '#06525c',
      paperMuted: '#2f737d',
      cardDark: '#03343a',
      cardDarkInk: '#f7f9f8',
      flash: '#ffffff',
    },
    accents: [
      { name: '深青', hex: '#06525c' },
      { name: '湖青', hex: '#0b7a7f' },
      { name: '粉青', hex: '#8fb9bc' },
      { name: '月白', hex: '#c9dad7' },
    ],
    hud: {
      capsuleBg: 'rgba(6,82,92,0.9)',
      capsuleBorder: 'rgba(255,255,255,0.24)',
      capsuleNumber: '#8fb9bc',
      capsuleText: '#f7f9f8',
      hudText: 'rgba(6,82,92,0.5)',
      countdown: 'rgba(6,82,92,0.58)',
    },
    cardSheen: 'rgba(255,255,255,0.16)',
    material: {
      kind: 'ink',
      name: '水墨晕染',
      note: '单色青水墨：没有黑色，所有层次由同一支青的浓淡晕开；留白就是构图。',
      grain: 0.02,
      glow: { color: '#8fb9bc', alpha: 0.18, radius: 1200, x: 0.24, y: 0.18 },
      grid: null,
      glass: null,
      foil: null,
      tints: null,
      texture: 'paper',
    },
    type: {
      display: 'Noto Serif SC',
      accent: 'Noto Serif SC',
      note: '标题用宋体、正文黑体；留白极大，像册页；不要出现第二个彩色。',
      fonts: ['Noto Serif SC', 'Noto Sans SC', 'JetBrains Mono'],
    },
  },

  /* 8 ── 绯墨剧场 ──────────────────────────────────────────────────────── */
  'crimson-theater': {
    id: 'crimson-theater',
    name: '绯墨剧场',
    nameEn: 'Crimson Theater',
    mode: 'dark',
    tagline: '近黑与绯红，舞台聚光的戏剧',
    useFor: '时尚 / 艺术 / 预告 / 情绪片',
    aliases: ['crimson', 'theater', '绯墨', '剧场'],
    colors: {
      bg: '#0a0a0a',
      bgDeep: '#050505',
      surface: '#151515',
      ink: '#efefef',
      muted: '#8c8c8c',
      accent: '#b11226',
      accentInk: '#ffffff',
      accentSoft: '#e06a75',
      paper: '#efefef',
      paperInk: '#0a0a0a',
      paperMuted: '#5c5c5c',
      cardDark: '#0a0a0a',
      cardDarkInk: '#efefef',
      flash: '#ffffff',
    },
    accents: [
      { name: '绯红', hex: '#b11226' },
      { name: '暗酒红', hex: '#7d0c14' },
      { name: '骨白', hex: '#e2e2e2' },
      { name: '近黑', hex: '#0a0a0a' },
    ],
    hud: {
      capsuleBg: 'rgba(8,8,8,0.78)',
      capsuleBorder: 'rgba(255,255,255,0.14)',
      capsuleNumber: '#e06a75',
      capsuleText: '#efefef',
      hudText: 'rgba(239,239,239,0.38)',
      countdown: 'rgba(239,239,239,0.64)',
    },
    cardSheen: 'rgba(255,255,255,0.06)',
    material: {
      kind: 'glow',
      name: '舞台聚光',
      note: '绯红从顶部打下来、四周压暗；装饰极少，靠聚光和一两个大字。',
      grain: 0.05,
      glow: { color: '#b11226', alpha: 0.3, radius: 900, x: 0.5, y: 0.34 },
      grid: null,
      glass: null,
      foil: null,
      tints: null,
      texture: 'grain',
    },
    type: {
      display: 'Playfair Display + Noto Sans SC',
      accent: 'Playfair Display',
      note: '电影预告质感：极致居中、字距拉开、字号敢大。',
      fonts: ['Playfair Display', 'Noto Sans SC', 'JetBrains Mono'],
    },
  },
};

export const THEME_IDS = Object.keys(THEMES);
export const THEME_LIST = THEME_IDS.map((id) => THEMES[id]);
export const DEFAULT_THEME = 'coral-noir';

/* ────────────────────────────────────────────────────────────────────────────
 * 查询 / URL
 * ──────────────────────────────────────────────────────────────────────────── */

/** 取主题：接受 id、别名、已展开的主题对象；未知值回退默认主题并警告。 */
export function getTheme(ref) {
  if (ref && typeof ref === 'object' && ref.colors) return ref;
  if (ref == null || ref === '') return THEMES[DEFAULT_THEME];
  const key = String(ref).trim().toLowerCase();
  if (THEMES[key]) return THEMES[key];
  for (const theme of THEME_LIST) {
    if (theme.aliases && theme.aliases.some((a) => String(a).toLowerCase() === key)) return theme;
  }
  console.warn(`[themes] unknown theme "${ref}", falling back to "${DEFAULT_THEME}"`);
  return THEMES[DEFAULT_THEME];
}

/** 从 location.search 读主题：?theme=aqua / ?theme=claude-light */
export function themeFromURL(search) {
  let q = search;
  if (q == null && typeof location !== 'undefined') q = location.search;
  const params = new URLSearchParams(q || '');
  return getTheme(params.get('theme') || params.get('t') || DEFAULT_THEME);
}

/**
 * 用户品牌色覆盖：只改强调色相关的值，返回新主题对象（不污染 THEMES）。
 *
 *   const theme = accentOverride('coral-noir', '#00a3a3');
 *   const theme = accentOverride(theme, { accentSoft: '#9fd8d8' });
 *
 * - `accentInk` 未给时，自动从主题的 ink / paper / bg、纯白、近黑里挑与 accent 对比度 ≥ 4.5 的；
 * - `accentSoft` 未给时用 `mix(accent, paper, 0.45)`；
 * - 材质层的 `material.glow.color` 同步跟随新 accent；
 * - HUD 编号：深色主题用 accent，浅色主题用 accentSoft（保证胶囊上的可读性）；
 * - 返回值带 `override` 字段，原样写进 brief.json 的 `theme.accentOverride` 即可复现。
 */
export function accentOverride(themeRef, input) {
  const base = getTheme(themeRef);
  const req = typeof input === 'string' ? { accent: input } : input || {};
  const valid = (v) => {
    try {
      hexToRgb(v);
      return true;
    } catch {
      return false;
    }
  };
  const accent = valid(req.accent) ? req.accent : base.colors.accent;
  const candidates = [
    req.accentInk,
    base.colors.accentInk,
    base.colors.paper,
    base.colors.bg,
    '#ffffff',
    '#0e0e0d',
  ].filter(valid);
  const accentInk = candidates.find((h) => contrastRatio(h, accent) >= 4.5) || candidates[0] || '#ffffff';
  const accentSoft = valid(req.accentSoft) ? req.accentSoft : mix(accent, base.colors.paper, 0.45);

  let material = base.material || null;
  if (material && material.glow && material.glow.color) {
    material = { ...material, glow: { ...material.glow, color: accent } };
  }

  return {
    ...base,
    colors: { ...base.colors, accent, accentInk, accentSoft },
    hud: { ...base.hud, capsuleNumber: base.mode === 'light' ? accentSoft : accent },
    material,
    override: { accent, accentInk, accentSoft },
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * DOM 模板：CSS 变量
 * ──────────────────────────────────────────────────────────────────────────── */

/** 角色 token → CSS 变量名（供 HTML/CSS 模板使用）。 */
export function cssVars(themeRef) {
  const t = getTheme(themeRef);
  const c = t.colors;
  return {
    '--bg': c.bg,
    '--bg-deep': c.bgDeep,
    '--surface': c.surface,
    '--ink': c.ink,
    '--muted': c.muted,
    '--accent': c.accent,
    '--accent-ink': c.accentInk,
    '--accent-soft': c.accentSoft,
    '--paper': c.paper,
    '--paper-ink': c.paperInk,
    '--paper-muted': c.paperMuted,
    '--card-dark': c.cardDark,
    '--card-dark-ink': c.cardDarkInk,
    '--flash': c.flash,
    '--hud-bg': t.hud.capsuleBg,
    '--hud-border': t.hud.capsuleBorder,
    '--hud-number': t.hud.capsuleNumber,
    '--hud-text': t.hud.capsuleText,
  };
}

/** 把主题写成 CSS 变量并标记 data-theme；返回主题对象。 */
export function applyTheme(themeRef, root) {
  const t = getTheme(themeRef);
  const el = root || (typeof document !== 'undefined' ? document.documentElement : null);
  if (!el) return t;
  for (const [k, v] of Object.entries(cssVars(t))) el.style.setProperty(k, v);
  el.setAttribute('data-theme', t.id);
  el.setAttribute('data-theme-mode', t.mode);
  if (typeof document !== 'undefined' && document.body) document.body.style.background = t.colors.bg;
  return t;
}

/* ────────────────────────────────────────────────────────────────────────────
 * HUD（胶囊 / 倒计时 / 水印）与卡片版式
 * ──────────────────────────────────────────────────────────────────────────── */

/** common.js 的绘制函数所需的主题化 opts。 */
export function chrome(themeRef) {
  const t = getTheme(themeRef);
  return {
    theme: t,
    capsule: {
      numberColor: t.hud.capsuleNumber,
      textColor: t.hud.capsuleText,
      bg: t.hud.capsuleBg,
      border: t.hud.capsuleBorder,
    },
    countdown: { color: t.hud.countdown },
    stamp: { color: t.hud.hudText },
    flash: t.colors.flash,
  };
}

/**
 * 大字卡配色。layout: 0=强调底 / 1=纸底 / 2、3=暗卡底。
 * 返回 { bg, ink, sub, keyword, echo, grid, sheen, field }，可直接喂给 big-card.html。
 */
export function cardColors(themeRef, layout = 0) {
  const t = getTheme(themeRef);
  const c = t.colors;
  const sheen = t.cardSheen || 'rgba(255,255,255,0.06)';
  // 关键词色必须能从底色里跳出来；最低 2.2（大字卡关键词是 190px 级特大字，
  // 不按正文 4.5 要求）。celadon 这类「accent ≈ cardDark」的单色主题会退到 accentSoft。
  const readable = (preferred, bg, fallbacks, min = 2.2) => {
    const cands = [preferred, ...fallbacks].filter(Boolean);
    return cands.find((hex) => contrastRatio(hex, bg) >= min) || cands[0];
  };
  if (layout === 0) {
    return {
      field: 'accent',
      bg: c.accent,
      ink: c.accentInk,
      sub: hexToRgba(c.accentInk, 0.55),
      keyword: c.accentInk,
      echo: hexToRgba(c.accentInk, 0.07),
      grid: hexToRgba(c.accentInk, 0.05),
      sheen,
    };
  }
  if (layout === 1) {
    return {
      field: 'paper',
      bg: c.paper,
      ink: c.paperInk,
      sub: hexToRgba(c.paperInk, 0.52),
      keyword: readable(c.accent, c.paper, [c.paperInk]),
      echo: hexToRgba(c.paperInk, 0.06),
      grid: hexToRgba(c.paperInk, 0.045),
      sheen: 'rgba(255,255,255,0.18)',
    };
  }
  return {
    field: 'dark',
    bg: c.cardDark,
    ink: c.cardDarkInk,
    sub: hexToRgba(c.cardDarkInk, 0.46),
    keyword: readable(c.accent, c.cardDark, [c.accentSoft, c.cardDarkInk]),
    echo: hexToRgba(c.cardDarkInk, 0.07),
    grid: hexToRgba(c.cardDarkInk, 0.05),
    sheen,
  };
}

/** 需要加载的字体族（可直接传给 common.js 的 loadFonts）。 */
export function loadFontsFor(themeRef) {
  const t = getTheme(themeRef);
  return (t.type && t.type.fonts) || ['Noto Sans SC'];
}

/* ────────────────────────────────────────────────────────────────────────────
 * 颜色工具
 * ──────────────────────────────────────────────────────────────────────────── */

export function hexToRgb(hex) {
  const h = String(hex).replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n) || full.length !== 6) throw new Error(`bad hex: ${hex}`);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function hexToRgba(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function mix(hexA, hexB, t = 0.5) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const c = (x, y) => Math.round(x + (y - x) * t);
  const to = (v) => v.toString(16).padStart(2, '0');
  return `#${to(c(a.r, b.r))}${to(c(a.g, b.g))}${to(c(a.b, b.b))}`;
}

export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 对比度，返回 1..21。 */
export function contrastRatio(hexA, hexB) {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Canvas 材质绘制（确定性：只依赖 t，不使用 Math.random / Date）
 * ──────────────────────────────────────────────────────────────────────────── */

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function radial(ctx, cx, cy, radius, color, alpha) {
  if (radius <= 0) return;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g.addColorStop(0, hexToRgba(color, alpha));
  g.addColorStop(0.55, hexToRgba(color, alpha * 0.45));
  g.addColorStop(1, hexToRgba(color, 0));
  const keep = ctx.fillStyle;
  ctx.fillStyle = g;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.fillStyle = keep;
}

/** 确定性伪随机（与 common.js 的 mulberry32 同款，独立实现避免循环依赖）。 */
function seeded(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _grainCache = new Map();
function grainTile(mode) {
  if (typeof document === 'undefined') return null;
  if (_grainCache.has(mode)) return _grainCache.get(mode);
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  const img = g.createImageData(size, size);
  const rand = seeded(mode === 'dark' ? 0x5eed1234 : 0x0f0f0f0f);
  const base = mode === 'dark' ? 255 : 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const v = rand();
    img.data[i] = base;
    img.data[i + 1] = base;
    img.data[i + 2] = base;
    img.data[i + 3] = Math.floor(v * v * 255);
  }
  g.putImageData(img, 0, 0);
  _grainCache.set(mode, canvas);
  return canvas;
}

/** 胶片颗粒 / 纸纹。t 只决定颗粒的整数漂移，保证逐帧确定性。 */
export function drawGrain(ctx, themeRef, W, H, t = 0) {
  const theme = getTheme(themeRef);
  const m = theme.material;
  if (!m.grain) return;
  const tile = grainTile(theme.mode);
  if (!tile) return;
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return;
  const ox = Math.round(((t * 30) % 256 + 256) % 256);
  const oy = Math.round(((t * 47) % 256 + 256) % 256);
  ctx.save();
  ctx.globalAlpha = Math.min(0.5, m.grain * 3.2);
  ctx.translate(-ox, -oy);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, W + 256, H + 256);
  ctx.restore();
}

/** 暗角；alpha=0 时跳过。 */
export function drawVignette(ctx, W, H, alpha = 0.5, inner = 0.42, outer = 0.86) {
  if (!alpha) return;
  const g = ctx.createRadialGradient(W / 2, H * 0.46, Math.min(W, H) * inner, W / 2, H * 0.46, Math.max(W, H) * outer);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${alpha})`);
  const keep = ctx.fillStyle;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = keep;
}

/**
 * 画主题背景：底色 + 材质。所有内容都只由 t 决定，可安全用于逐帧渲染。
 * @param {CanvasRenderingContext2D} ctx
 * @param {object|string} themeRef
 * @param {number} W @param {number} H
 * @param {number} t 秒
 */
export function drawThemeBackground(ctx, themeRef, W = 1920, H = 1080, t = 0) {
  const theme = getTheme(themeRef);
  const c = theme.colors;
  const m = theme.material;
  ctx.save();

  // 1) 底色：主色 → 深色 的极轻竖直渐变
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, c.bg);
  base.addColorStop(1, c.bgDeep || c.bg);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // 2) 材质：每种主题一种主材质
  if (m.kind === 'glass') {
    // 莫兰迪柔光：淡绿 / 淡粉 / 雾蓝三团，缓慢呼吸（确定性）
    const tints = m.tints || [c.accentSoft, c.paper];
    tints.forEach((color, i) => {
      const cx = W * (0.16 + 0.3 * i) + Math.sin(t * 0.55 + i * 2.1) * W * 0.05;
      const cy = H * (0.24 + 0.2 * i) + Math.cos(t * 0.47 + i * 1.7) * H * 0.06;
      const radius = W * (0.26 + 0.07 * i);
      radial(ctx, cx, cy, radius, color, 0.42 - i * 0.07);
    });
    // 液态玻璃的虹彩：极淡的横向色带
    const irid = ctx.createLinearGradient(0, 0, W, H);
    irid.addColorStop(0, 'rgba(168,195,160,0.07)');
    irid.addColorStop(0.45, 'rgba(230,194,198,0.05)');
    irid.addColorStop(0.75, 'rgba(169,201,211,0.08)');
    irid.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = irid;
    ctx.fillRect(0, 0, W, H);
  }

  if (m.glow) {
    const g = m.glow;
    const breathe = 0.92 + 0.08 * Math.sin(t * 0.8);
    radial(ctx, W * g.x, H * g.y, g.radius, g.color, g.alpha * breathe);
  }

  if (m.kind === 'foil' && m.foil) {
    const angle = (m.foil.angle * Math.PI) / 180;
    const cx = W / 2;
    const cy = H / 2;
    const dx = Math.cos(angle) * W;
    const dy = Math.sin(angle) * H;
    const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    g.addColorStop(0, 'rgba(255,226,170,0)');
    g.addColorStop(0.42, m.foil.color);
    g.addColorStop(0.5, 'rgba(255,244,214,0.16)');
    g.addColorStop(0.58, m.foil.color);
    g.addColorStop(1, 'rgba(255,226,170,0)');
    const keep = ctx.globalAlpha;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = keep;
  }

  if (m.kind === 'ink') {
    // 单色水墨：同一支青在四角与底边晕开
    radial(ctx, W * 0.76, H * 0.2, W * 0.5, c.accent, 0.1);
    radial(ctx, W * 0.18, H * 0.82, W * 0.42, c.accent, 0.07);
    const wash = ctx.createLinearGradient(0, H * 0.72, 0, H);
    wash.addColorStop(0, 'rgba(6,82,92,0)');
    wash.addColorStop(1, 'rgba(6,82,92,0.08)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, H * 0.72, W, H * 0.28);
  }

  if (m.kind === 'glow') {
    // 舞台聚光：顶部一束、四周压暗
    const spot = ctx.createRadialGradient(W * 0.5, H * 0.18, 0, W * 0.5, H * 0.18, H * 0.9);
    spot.addColorStop(0, hexToRgba(c.accent, 0.24));
    spot.addColorStop(0.5, hexToRgba(c.accent, 0.06));
    spot.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, W, H);
    drawVignette(ctx, W, H, 0.55, 0.3, 0.92);
  }

  if (m.grid) {
    const { step = 80, color = c.ink, alpha = 0.05, major = 0, majorAlpha = 0 } = m.grid;
    ctx.save();
    ctx.lineWidth = 1;
    for (let x = 0, i = 0; x <= W; x += step, i++) {
      const isMajor = major > 0 && i % major === 0;
      ctx.strokeStyle = hexToRgba(color, isMajor ? majorAlpha || alpha * 1.8 : alpha);
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, H);
      ctx.stroke();
    }
    for (let y = 0, i = 0; y <= H; y += step, i++) {
      const isMajor = major > 0 && i % major === 0;
      ctx.strokeStyle = hexToRgba(color, isMajor ? majorAlpha || alpha * 1.8 : alpha);
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (m.kind === 'paper') {
    // 暖纸：大块极淡的暖斑 + 边缘压色
    radial(ctx, W * 0.84, H * 0.1, W * 0.55, c.accentSoft, 0.16);
    radial(ctx, W * 0.1, H * 0.92, W * 0.45, '#d9cbb8', 0.1);
    const edge = ctx.createLinearGradient(0, 0, 0, H);
    edge.addColorStop(0, 'rgba(31,30,29,0.035)');
    edge.addColorStop(0.3, 'rgba(31,30,29,0)');
    edge.addColorStop(1, 'rgba(31,30,29,0.05)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, W, H);
  }

  // 3) 颗粒 / 纸纹
  drawGrain(ctx, theme, W, H, t);
  ctx.restore();
}

/**
 * 液态玻璃面板：半透明填充 + 斜向高光 + 1px 亮边。
 * 非 glass 主题也可以用（自动回退到白色玻璃），但推荐只在水蓝白等 glass 主题里用。
 */
export function drawGlassPanel(ctx, themeRef, { x = 0, y = 0, w = 400, h = 240, r = 32, alpha = 1 } = {}) {
  const theme = getTheme(themeRef);
  const g = theme.material.glass || {
    fill: 'rgba(255,255,255,0.32)',
    border: 'rgba(255,255,255,0.72)',
    sheen: 'rgba(255,255,255,0.9)',
    tint: 'rgba(168,195,160,0.08)',
  };
  ctx.save();
  ctx.globalAlpha = alpha;
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = g.fill;
  ctx.fill();

  // 内部斜向高光（左上亮 → 右下淡）
  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();
  const sheen = ctx.createLinearGradient(x, y, x + w, y + h);
  sheen.addColorStop(0, g.sheen);
  sheen.addColorStop(0.32, 'rgba(255,255,255,0.12)');
  sheen.addColorStop(0.62, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(255,255,255,0.16)');
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, w, h);
  if (g.tint) {
    const tint = ctx.createRadialGradient(x + w * 0.2, y + h * 0.15, 0, x + w * 0.2, y + h * 0.15, w * 0.8);
    tint.addColorStop(0, g.tint);
    tint.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = tint;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();

  // 1px 亮边 + 顶部高光线
  roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = g.border;
  ctx.stroke();
  const edge = ctx.createLinearGradient(x, y, x, y + h * 0.5);
  edge.addColorStop(0, 'rgba(255,255,255,0.75)');
  edge.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.lineWidth = 1;
  ctx.strokeStyle = edge;
  ctx.stroke();
  ctx.restore();
}

/* ────────────────────────────────────────────────────────────────────────────
 * 主题审计（scripts/theme-audit.mjs 使用；也可在页面里自检）
 * ──────────────────────────────────────────────────────────────────────────── */

const AUDIT_PAIRS = [
  ['ink', 'bg', 7, '主字 / 底'],
  ['ink', 'bgDeep', 7, '主字 / 深底'],
  ['muted', 'bg', 4.5, '次要字 / 底'],
  ['accentInk', 'accent', 4.5, '强调底上的字'],
  ['accent', 'bg', 2.5, '强调 / 底（大面积色场，非正文）'],
  ['paperInk', 'paper', 7, '纸底上的字'],
  ['paperMuted', 'paper', 4.5, '纸底次要字'],
  ['cardDarkInk', 'cardDark', 7, '暗卡上的字'],
  ['flash', 'bg', 1, '闪白 / 底'],
];

/** 审计一套主题的对比度，返回逐项结果。 */
export function auditTheme(themeRef) {
  const t = getTheme(themeRef);
  return AUDIT_PAIRS.map(([a, b, min, label]) => {
    const ratio = contrastRatio(t.colors[a], t.colors[b]);
    return { pair: `${a} / ${b}`, label, ratio: Math.round(ratio * 100) / 100, min, pass: ratio >= min };
  });
}

/** 预览/文档用的色板行。 */
export function paletteRows(themeRef) {
  const t = getTheme(themeRef);
  const c = t.colors;
  return [
    { role: 'bg', label: '底色', hex: c.bg },
    { role: 'bgDeep', label: '深底', hex: c.bgDeep },
    { role: 'surface', label: '表面', hex: c.surface },
    { role: 'ink', label: '主字', hex: c.ink },
    { role: 'muted', label: '次要字', hex: c.muted },
    { role: 'accent', label: '强调', hex: c.accent },
    { role: 'accentInk', label: '强调底字', hex: c.accentInk },
    { role: 'accentSoft', label: '浅强调', hex: c.accentSoft },
    { role: 'paper', label: '纸面', hex: c.paper },
    { role: 'paperInk', label: '纸面字', hex: c.paperInk },
    { role: 'paperMuted', label: '纸面次字', hex: c.paperMuted },
    { role: 'cardDark', label: '暗卡', hex: c.cardDark },
    { role: 'cardDarkInk', label: '暗卡字', hex: c.cardDarkInk },
    { role: 'flash', label: '闪白', hex: c.flash },
  ];
}
