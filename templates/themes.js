/**
 * themes.js — code-video-showcase 主题系统（唯一数据源）
 * ============================================================================
 * 一个「主题」不是一组颜色，而是四件事的组合：
 *   1. 角色色板（palette roles）—— 底色 / 主字 / 强调 / 纸面 / 暗卡 …
 *   2. 材质（material）—— 颗粒、柔光、液态玻璃、烫金、蓝图网格、哑光、水墨、聚光、
 *      扫描线、暮光带、焦散、织纹（v3 新增 4 种）
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

export const THEME_SCHEMA_VERSION = 3; // v3 adds four skins + four material kinds

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

  /* 9 ── 赛博霓虹（OKLCH 生成：青 × 品红）────────────────────────────── */
  'cyber-neon': {
    id: 'cyber-neon',
    name: '赛博霓虹',
    nameEn: 'Cyber Neon',
    mode: 'dark',
    tagline: '近黑底 + 电光青，品红只做第二重音',
    useFor: '科技 / 游戏 / 预告片 / 直播',
    aliases: ['cyber', 'neon', '赛博', '霓虹'],
    colors: {
      bg: '#070d1a', bgDeep: '#01030c', surface: '#0f182b',
      ink: '#ecf3f8', muted: '#9099a5',
      accent: '#00dadd', accentInk: '#111111', accentSoft: '#8cebea',
      paper: '#ecf3f8', paperInk: '#090d16', paperMuted: '#4d5566',
      cardDark: '#040915', cardDarkInk: '#e9f0f5', flash: '#ffffff',
    },
    accents: [
      { name: '电光青', hex: '#00dadd' },
      { name: '品红', hex: '#ff2bd6' },
      { name: '酸性绿', hex: '#b6ff2e' },
      { name: '电紫', hex: '#8a5cff' },
    ],
    hud: {
      capsuleBg: 'rgba(5,8,16,0.78)',
      capsuleBorder: 'rgba(0,218,221,0.35)',
      capsuleNumber: '#00dadd',
      capsuleText: '#e9f6ff',
      hudText: 'rgba(233,246,255,0.42)',
      countdown: 'rgba(233,246,255,0.7)',
    },
    cardSheen: 'rgba(0,218,221,0.08)',
    material: {
      kind: 'glow',
      name: '霓虹辉光',
      note: '青色辉光只从边角溢出，品红只做第二重音；禁止整屏渐变。',
      grain: 0.045,
      glow: { color: '#00dadd', alpha: 0.22, radius: 1100, x: 0.78, y: 0.26 },
      grid: { color: '#00dadd', alpha: 0.035, step: 96, major: 4, majorAlpha: 0.07 },
      glass: null, foil: null, tints: null, texture: 'grain',
    },
    type: {
      display: 'Noto Sans SC 900',
      accent: 'JetBrains Mono',
      note: '等宽字体承担编号/参数，标题保持黑体；不要用圆体。',
      fonts: ['Noto Sans SC', 'JetBrains Mono', 'Inter'],
    },
  },

  /* 10 ── 纸质手账（OKLCH 生成：暖纸 × 赭红）─────────────────────────── */
  'paper-journal': {
    id: 'paper-journal',
    name: '纸质手账',
    nameEn: 'Paper Journal',
    mode: 'light',
    tagline: '米白纸 + 赭红印章，像一本工作笔记',
    useFor: '知识 / 教程 / 生活 / 访谈',
    aliases: ['journal', 'paper', '手账', '纸质'],
    colors: {
      bg: '#f5f1e9', bgDeep: '#ebe4d6', surface: '#fefcf6',
      ink: '#1e130e', muted: '#635146',
      accent: '#c13e2e', accentInk: '#ffffff', accentSoft: '#f6c3ba',
      paper: '#fefcf6', paperInk: '#1e130e', paperMuted: '#635146',
      cardDark: '#1e130e', cardDarkInk: '#f5f1e9', flash: '#ffffff',
    },
    accents: [
      { name: '赭红', hex: '#c13e2e' },
      { name: '墨蓝', hex: '#2f5d8a' },
      { name: '橄榄', hex: '#6f7a4a' },
      { name: '芥末', hex: '#b8862f' },
    ],
    hud: {
      capsuleBg: 'rgba(30,19,14,0.9)',
      capsuleBorder: 'rgba(255,255,255,0.18)',
      capsuleNumber: '#f6c3ba',
      capsuleText: '#faf6ee',
      hudText: 'rgba(30,19,14,0.5)',
      countdown: 'rgba(30,19,14,0.58)',
    },
    cardSheen: 'rgba(255,255,255,0.16)',
    material: {
      kind: 'paper',
      name: '手账纸面',
      note: '暖纸 + 细纤维 + 极淡的装订线；不要光晕，不要玻璃。',
      grain: 0.035,
      glow: null,
      grid: { color: '#8a7258', alpha: 0.035, step: 64, major: 8, majorAlpha: 0.06 },
      glass: null, foil: null, tints: null, texture: 'paper',
    },
    type: {
      display: 'Noto Serif SC 900',
      accent: 'Ma Shan Zheng',
      note: '标题可用宋体/手写体；正文必须黑体，保证小字号可读。',
      fonts: ['Noto Sans SC', 'Noto Serif SC', 'Ma Shan Zheng', 'JetBrains Mono'],
    },
  },

  /* 11 ── 暗金电影（OKLCH 生成：近黑 × 旧金）─────────────────────────── */
  'dark-gold-cinema': {
    id: 'dark-gold-cinema',
    name: '暗金电影',
    nameEn: 'Dark Gold Cinema',
    mode: 'dark',
    tagline: '近黑底 + 旧金烫印，预告片质感',
    useFor: '高端 / 电影感 / 品牌年度片',
    aliases: ['dark-gold', 'cinema', '暗金', '电影'],
    colors: {
      bg: '#090503', bgDeep: '#020100', surface: '#140e09',
      ink: '#f0ebe0', muted: '#a1968b',
      accent: '#e7b643', accentInk: '#111111', accentSoft: '#f3dba9',
      paper: '#f0ebe0', paperInk: '#120c07', paperMuted: '#554b42',
      cardDark: '#050301', cardDarkInk: '#f0ebe0', flash: '#ffffff',
    },
    accents: [
      { name: '旧金', hex: '#e7b643' },
      { name: '香槟', hex: '#f3dba9' },
      { name: '牛血红', hex: '#8f2f2f' },
      { name: '祖母绿', hex: '#2f6b5a' },
    ],
    hud: {
      capsuleBg: 'rgba(8,5,3,0.82)',
      capsuleBorder: 'rgba(231,182,67,0.3)',
      capsuleNumber: '#e7b643',
      capsuleText: '#f3ead9',
      hudText: 'rgba(243,234,217,0.4)',
      countdown: 'rgba(243,234,217,0.66)',
    },
    cardSheen: 'rgba(231,182,67,0.1)',
    material: {
      kind: 'foil',
      name: '金属烫金',
      note: '金色只做烫印高光与细线，不做大面积金底；暗部保留颗粒。',
      grain: 0.05,
      glow: { color: '#e7b643', alpha: 0.16, radius: 980, x: 0.5, y: 0.3 },
      grid: null, glass: null,
      foil: { color: 'rgba(231,182,67,0.16)', angle: 24 },
      tints: null, texture: 'grain',
    },
    type: {
      display: 'Playfair Display + Noto Sans SC',
      accent: 'Playfair Display',
      note: '标题用高对比衬线，字距拉开；正文仍用黑体。',
      fonts: ['Playfair Display', 'Noto Sans SC', 'JetBrains Mono'],
    },
  },

  /* 12 ── 冰蓝极简（OKLCH 生成：冷白 × 钴蓝）────────────────────────── */
  'ice-minimal': {
    id: 'ice-minimal',
    name: '冰蓝极简',
    nameEn: 'Ice Minimal',
    mode: 'light',
    tagline: '冷白留白 + 钴蓝一条线，像实验室手册',
    useFor: 'SaaS / 数据 / 医疗 / 极简品牌',
    aliases: ['ice', 'minimal', '冰蓝', '极简'],
    colors: {
      bg: '#f5f9fc', bgDeep: '#e5edf1', surface: '#fcfefe',
      ink: '#0c121a', muted: '#51606b',
      accent: '#2171cc', accentInk: '#ffffff', accentSoft: '#b7d4f9',
      paper: '#fcfefe', paperInk: '#0c121a', paperMuted: '#51606b',
      cardDark: '#0c121a', cardDarkInk: '#f1f6f8', flash: '#ffffff',
    },
    accents: [
      { name: '钴蓝', hex: '#2171cc' },
      { name: '冰青', hex: '#8ec5e8' },
      { name: '薄荷', hex: '#7fbfa8' },
      { name: '石板', hex: '#5d6b78' },
    ],
    hud: {
      capsuleBg: 'rgba(12,18,26,0.9)',
      capsuleBorder: 'rgba(255,255,255,0.2)',
      capsuleNumber: '#b7d4f9',
      capsuleText: '#f7fbfe',
      hudText: 'rgba(12,18,26,0.48)',
      countdown: 'rgba(12,18,26,0.56)',
    },
    cardSheen: 'rgba(255,255,255,0.2)',
    material: {
      kind: 'matte',
      name: '冷白哑光',
      note: '大面积留白 + 1px 冷灰分割线；唯一彩色是钴蓝，禁止柔光球。',
      grain: 0.012,
      glow: null,
      grid: { color: '#2171cc', alpha: 0.025, step: 120, major: 6, majorAlpha: 0.05 },
      glass: null, foil: null, tints: null, texture: 'grid',
    },
    type: {
      display: 'Noto Sans SC 700',
      accent: 'Inter',
      note: '数字用 Inter tnum，中文标题 700；字距略紧，行高 1.1。',
      fonts: ['Noto Sans SC', 'Inter', 'JetBrains Mono'],
    },
  },

  /* 13 ── 波普酸色（OKLCH 生成：酸性黄绿 × 热粉）────────────────────── */
  'pop-acid': {
    id: 'pop-acid',
    name: '波普酸色',
    nameEn: 'Pop Acid',
    mode: 'dark',
    tagline: '近黑 + 酸性黄绿，热粉做第二击',
    useFor: '潮流 / 音乐 / 社交 / 青年文化',
    aliases: ['pop', 'acid', '波普', '酸色'],
    colors: {
      bg: '#0b0614', bgDeep: '#030109', surface: '#170e27',
      ink: '#f8f7ff', muted: '#a299b4',
      accent: '#dcdb00', accentInk: '#111111', accentSoft: '#ebee9f',
      paper: '#f5f4fc', paperInk: '#0b0614', paperMuted: '#534663',
      cardDark: '#07040f', cardDarkInk: '#f8f7ff', flash: '#ffffff',
    },
    accents: [
      { name: '酸性黄绿', hex: '#dcdb00' },
      { name: '热粉', hex: '#ff3d8b' },
      { name: '电青', hex: '#00e5ff' },
      { name: '橘红', hex: '#ff7a1a' },
    ],
    hud: {
      capsuleBg: 'rgba(6,3,12,0.8)',
      capsuleBorder: 'rgba(220,219,0,0.32)',
      capsuleNumber: '#dcdb00',
      capsuleText: '#f8f7ff',
      hudText: 'rgba(248,247,255,0.42)',
      countdown: 'rgba(248,247,255,0.7)',
    },
    cardSheen: 'rgba(220,219,0,0.1)',
    material: {
      kind: 'glow',
      name: '波普光斑',
      note: '酸性黄绿做单点爆闪，热粉只做第二色；黑底必须压住饱和度。',
      grain: 0.06,
      glow: { color: '#dcdb00', alpha: 0.2, radius: 900, x: 0.3, y: 0.72 },
      grid: { color: '#ff3d8b', alpha: 0.03, step: 72, major: 4, majorAlpha: 0.06 },
      glass: null, foil: null, tints: null, texture: 'grain',
    },
    type: {
      display: 'Noto Sans SC 900',
      accent: 'ZCOOL KuaiLe',
      note: '标题可以更粗更紧；数字/标签用等宽，形成反差错位。',
      fonts: ['Noto Sans SC', 'ZCOOL KuaiLe', 'JetBrains Mono'],
    },
  },

  /* 14 ── 终端磷光（v3：扫描线 CRT，开发者 / CLI / 开源发布）────────────── */
  'terminal-phosphor': {
    id: 'terminal-phosphor',
    name: '终端磷光',
    nameEn: 'Terminal Phosphor',
    mode: 'dark',
    tagline: '墨绿阴极射线 + 磷光绿，命令行发布片',
    useFor: '开发者 / CLI / 开源发布 / 终端录屏',
    aliases: ['terminal', 'phosphor', 'crt', 'cli', '终端', '磷光'],
    colors: {
      bg: '#07140d', bgDeep: '#030a06', surface: '#102318',
      ink: '#d6ffe2', muted: '#83ae92',
      accent: '#57f28f', accentInk: '#04160b', accentSoft: '#a9f7c2',
      paper: '#e9f7ec', paperInk: '#0a1c11', paperMuted: '#4b6b55',
      cardDark: '#04140b', cardDarkInk: '#dcffe6', flash: '#effff3',
    },
    accents: [
      { name: '磷光绿', hex: '#57f28f' },
      { name: '琥珀字符', hex: '#f2c14e' },
      { name: '青蓝', hex: '#5cd6d6' },
      { name: '洋红错误', hex: '#e879a6' },
    ],
    hud: {
      capsuleBg: 'rgba(3,10,6,0.84)',
      capsuleBorder: 'rgba(87,242,143,0.3)',
      capsuleNumber: '#57f28f',
      capsuleText: '#d6ffe2',
      hudText: 'rgba(214,255,226,0.42)',
      countdown: 'rgba(214,255,226,0.72)',
    },
    cardSheen: 'rgba(87,242,143,0.08)',
    material: {
      kind: 'scanline',
      name: 'CRT 扫描线',
      note: '4px 横向扫描线 + 极慢滚动的亮带 + 屏幕四角压暗；磷光绿只做辉光，不做整屏渐变。',
      grain: 0.035,
      glow: { color: '#57f28f', alpha: 0.16, radius: 820, x: 0.5, y: 0.42 },
      grid: null, glass: null, foil: null, tints: null, texture: 'grain',
      scanline: { step: 4, alpha: 0.1, band: 0.055, vignette: 0.34 },
    },
    type: {
      display: 'Noto Sans SC 900',
      accent: 'JetBrains Mono',
      note: '编号 / 参数 / 命令一律等宽；标题仍用大字卡固定字体，不换成像素字。',
      fonts: ['Noto Sans SC', 'JetBrains Mono'],
    },
  },

  /* 15 ── 落日暖丘（v3：暮光带，旅行 / 美食 / 生活方式）─────────────────── */
  'solar-dusk': {
    id: 'solar-dusk',
    name: '落日暖丘',
    nameEn: 'Solar Dusk',
    mode: 'light',
    tagline: '奶油暮色 + 陶土落日，暖调生活方式',
    useFor: '旅行 / 美食 / 生活方式 / 户外',
    aliases: ['solar', 'dusk', 'sunset', '落日', '暖丘', '暮色'],
    colors: {
      bg: '#fff3e6', bgDeep: '#f6ddc4', surface: '#fbe6d2',
      ink: '#3a2115', muted: '#8a5c43',
      accent: '#c23c14', accentInk: '#fff3e6', accentSoft: '#f6b48f',
      paper: '#fffaf2', paperInk: '#3a2115', paperMuted: '#8a6550',
      cardDark: '#331a0e', cardDarkInk: '#fff3e6', flash: '#ffffff',
    },
    accents: [
      { name: '落日橘', hex: '#c23c14' },
      { name: '陶土', hex: '#d98b5f' },
      { name: '橄榄', hex: '#7a7a3c' },
      { name: '暮紫', hex: '#8a6a9c' },
    ],
    hud: {
      capsuleBg: 'rgba(51,26,14,0.9)',
      capsuleBorder: 'rgba(246,180,143,0.35)',
      capsuleNumber: '#f6b48f',
      capsuleText: '#fff3e6',
      hudText: 'rgba(58,33,21,0.45)',
      countdown: 'rgba(58,33,21,0.72)',
    },
    cardSheen: 'rgba(255,255,255,0.16)',
    material: {
      kind: 'dusk',
      name: '落日暮光带',
      note: '底部一条暖橙 → 暮紫的水平色带 + 顶部极淡暖晕；带高只占画面约 1/3，不铺满。',
      grain: 0.025,
      glow: { color: '#f6b48f', alpha: 0.2, radius: 980, x: 0.72, y: 0.12 },
      grid: null, glass: null, foil: null, tints: null, texture: 'grain',
      dusk: { bandTop: 0.66, warm: '#e98a4a', cool: '#9a6a9c', alpha: 0.22 },
    },
    type: {
      display: 'Noto Sans SC 900',
      accent: 'Playfair Display 斜体',
      note: '片头 / 片尾可用衬线斜体拉情绪；正文保持无衬线，避免手写体。',
      fonts: ['Noto Sans SC', 'Playfair Display', 'JetBrains Mono'],
    },
  },

  /* 16 ── 深海青（v3：水下焦散，海洋 / 医疗 / 深科技）──────────────────────
   * 刻意用紫调藏青 + 天蓝，而不是青绿：与 cyber-neon（#070d1a / #00dadd）
   * 在 OKLab 色板空间太近会让「参考图反推主题」把两张预览认成同一套。      */
  'abyss-teal': {
    id: 'abyss-teal',
    name: '深海青',
    nameEn: 'Abyss Teal',
    mode: 'dark',
    tagline: '深水藏青 + 天蓝焦散，安静的高级感',
    useFor: '海洋 / 医疗 / 深科技 / 纪录 / 品牌',
    aliases: ['abyss', 'ocean', 'deep', '深海', '藏青', '深海青'],
    colors: {
      bg: '#0a1226', bgDeep: '#040918', surface: '#16263f',
      ink: '#f0f2ff', muted: '#93a2c2',
      accent: '#7fb8ef', accentInk: '#04121a', accentSoft: '#c9e2f8',
      paper: '#eef1fb', paperInk: '#0a1424', paperMuted: '#4c5f78',
      cardDark: '#050d1e', cardDarkInk: '#f0f2ff', flash: '#f8faff',
    },
    accents: [
      { name: '天蓝', hex: '#7fb8ef' },
      { name: '水母蓝', hex: '#6a9bd8' },
      { name: '珊瑚', hex: '#e08a72' },
      { name: '浮游绿', hex: '#8fd6a8' },
    ],
    hud: {
      capsuleBg: 'rgba(4,9,24,0.86)',
      capsuleBorder: 'rgba(127,184,239,0.3)',
      capsuleNumber: '#7fb8ef',
      capsuleText: '#f0f2ff',
      hudText: 'rgba(240,242,255,0.42)',
      countdown: 'rgba(240,242,255,0.72)',
    },
    cardSheen: 'rgba(127,184,239,0.08)',
    material: {
      kind: 'caustics',
      name: '水下焦散',
      note: '两三条缓慢漂移的天蓝光脊从上方渗入 + 底部深水渐暗；焦散只走正弦亮线，不画气泡。',
      grain: 0.04,
      glow: { color: '#7fb8ef', alpha: 0.14, radius: 1080, x: 0.36, y: 0.08 },
      grid: null, glass: null, foil: null, tints: null, texture: 'grain',
      caustics: { color: '#a9d3f5', alpha: 0.075, ridges: 3, depth: 0.2 },
    },
    type: {
      display: 'Noto Sans SC 900',
      accent: 'Noto Serif SC',
      note: '标题字重略轻、字距略松；编号用等宽，营造仪器读数感。',
      fonts: ['Noto Sans SC', 'Noto Serif SC', 'JetBrains Mono'],
    },
  },

  /* 17 ── 亚麻宣纸（v3：织纹，出版 / 教育 / 人文）────────────────────────── */
  'sand-linen': {
    id: 'sand-linen',
    name: '亚麻宣纸',
    nameEn: 'Sand Linen',
    mode: 'light',
    tagline: '本色亚麻 + 靛蓝，编辑部与讲义',
    useFor: '出版 / 教育 / 人文 / 访谈 / 播客',
    aliases: ['linen', 'sand', 'fabric', '亚麻', '宣纸', '本色'],
    colors: {
      bg: '#f3ede1', bgDeep: '#e7ddca', surface: '#eae1cf',
      ink: '#2d2a22', muted: '#6e6554',
      accent: '#3f5a8a', accentInk: '#f7f4ea', accentSoft: '#aebbd4',
      paper: '#fbf8ef', paperInk: '#2d2a22', paperMuted: '#6b6252',
      cardDark: '#26241e', cardDarkInk: '#f7f4ea', flash: '#ffffff',
    },
    accents: [
      { name: '靛蓝', hex: '#3f5a8a' },
      { name: '赭石', hex: '#b06a3c' },
      { name: '苔绿', hex: '#6b7a4a' },
      { name: '绛红', hex: '#9c4a4a' },
    ],
    hud: {
      capsuleBg: 'rgba(38,36,30,0.9)',
      capsuleBorder: 'rgba(247,244,234,0.2)',
      capsuleNumber: '#aebbd4',
      capsuleText: '#f7f4ea',
      hudText: 'rgba(45,42,34,0.45)',
      countdown: 'rgba(45,42,34,0.72)',
    },
    cardSheen: 'rgba(255,255,255,0.14)',
    material: {
      kind: 'linen',
      name: '亚麻织纹',
      note: '极淡的经纬双向细线（12px / 10px）+ 纸边压色；不要玻璃、金属、光晕。',
      grain: 0.02,
      glow: null,
      grid: null, glass: null, foil: null, tints: null, texture: 'grain',
      linen: { warp: '#8a7c60', weft: '#a99a7c', alpha: 0.045, warpStep: 12, weftStep: 10, edge: 0.05 },
    },
    type: {
      display: 'Noto Sans SC 900',
      accent: 'Noto Serif SC',
      note: '标题可用宋体，章节号用等宽；正文禁用手写体，保持讲义的克制。',
      fonts: ['Noto Sans SC', 'Noto Serif SC', 'JetBrains Mono'],
    },
  },
};

export const THEME_IDS = Object.keys(THEMES);
export const THEME_LIST = THEME_IDS.map((id) => THEMES[id]);
export const DEFAULT_THEME = 'coral-noir';

/**
 * 别名歧义自检：getTheme() 按顺序线性匹配，重复别名会让后注册的主题永远
 * 解析不到（例如 `teal` 曾同时属于 celadon-paper 和 abyss-teal）。
 * 返回全部冲突；test-core.mjs 断言它为空，新增主题时不会静默埋雷。
 */
export function aliasConflicts() {
  const seen = new Map();
  const conflicts = [];
  for (const theme of THEME_LIST) {
    for (const raw of theme.aliases || []) {
      const key = String(raw).toLowerCase();
      if (seen.has(key)) conflicts.push({ alias: key, first: seen.get(key), second: theme.id });
      else seen.set(key, theme.id);
    }
  }
  return conflicts;
}

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
  const theme = getTheme(params.get('theme') || params.get('t') || DEFAULT_THEME);
  // `?accent=` / `?accentInk=` / `?accentSoft=`：由 `spec.look.accentOverride` 下发
  // （品牌色 `cvs brand apply`、以及 accentFix 给出的对比度安全主色）。
  // 页面读不到 spec，所以覆盖值必须走 URL；不传 → 原样返回主题，逐像素不变。
  const accent = params.get('accent');
  const accentInk = params.get('accentInk');
  const accentSoft = params.get('accentSoft');
  if (!accent && !accentInk && !accentSoft) return theme;
  return accentOverride(theme, {
    accent: accent || undefined,
    accentInk: accentInk || undefined,
    accentSoft: accentSoft || undefined,
  });
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
  // 关键词色必须能从底色里跳出来；最低 3.0（WCAG 大字 AA；旧值 2.2 低于标准，
  // N08-F3）。celadon 这类「accent ≈ cardDark」的单色主题会退到 accentSoft。
  const readable = (preferred, bg, fallbacks, min = 3.0) => {
    const cands = [preferred, ...fallbacks].filter(Boolean);
    return cands.find((hex) => contrastRatio(hex, bg) >= min) || cands[0];
  };
  if (layout === 0) {
    // R2-05：强调底上的 ink 也要极性兜底——浅色 accent（或 ?color= 覆盖）
    // 配近白 accentInk 会白字白底。候选含暗/亮两端，挑达标者。
    const ink0 = readable(c.accentInk, c.accent, [c.cardDarkInk, c.paperInk, '#0e0e0d', '#f7f4ea']);
    return {
      field: 'accent',
      bg: c.accent,
      ink: ink0,
      sub: hexToRgba(ink0, 0.55),
      keyword: ink0,
      echo: hexToRgba(ink0, 0.07),
      grid: hexToRgba(ink0, 0.05),
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
  // v2: 1.8× instead of 3.2× — the old value read as digital noise at 1080p and
  // pushed CRF intermediates past 90 Mbps. 0.10 alpha still reads as film grain.
  ctx.globalAlpha = Math.min(0.5, m.grain * 1.5);
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
 * 静态材质烘焙缓存：linen / dusk / scanline 的静态层（织纹 / 色带 / 扫描线 +
 * 压角）与 t 无关，逐帧重画在 1080p 下要 300–1100 次 canvas 调用。
 * 这里把它们烘成一张**透明**离屏画布，逐帧只做一次 drawImage。
 *
 * 为什么透明：原绘制顺序是「不透明底色 → glow 呼吸 → 静态层 → 动态层 → 颗粒」。
 * 静态层全是 source-over，而 source-over 满足结合律，所以把它们先合成到透明画布、
 * 再整体盖到「底色 + glow」上，与逐层直接画逐值一致；若把底色也烘进去，glow
 * 就会被盖到静态层之后，顺序错了。
 *
 * 动态层（scanline 亮带、caustics 光脊、grain）不烘焙，仍按 t 在主循环里绘制。
 */
const _staticMatCache = new Map();
const BAKED_KINDS = new Set(['linen', 'dusk', 'scanline']);
// ?noBake=1 只查一次：这个函数逐帧调用，不缓存就等于每帧 new URLSearchParams。
let _noBakeFlag = null;
function bakeDisabled() {
  if (_noBakeFlag === null) {
    _noBakeFlag = false;
    try {
      if (typeof location !== 'undefined' && typeof URLSearchParams !== 'undefined') {
        _noBakeFlag = new URLSearchParams(location.search).get('noBake') === '1';
      }
    } catch { /* location 不可读时按未禁用处理 */ }
  }
  return _noBakeFlag;
}
function staticMaterialTile(theme, W, H, c, m) {
  if (typeof document === 'undefined' || !BAKED_KINDS.has(m.kind)) return null;
  // ?noBake=1：强制走原来的逐层绘制，用于像素级等价回归与问题定位。
  if (bakeDisabled()) return null;
  const key = `${theme.id}:${W}x${H}`;
  if (_staticMatCache.has(key)) return _staticMatCache.get(key);
  let cv;
  try {
    cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
  } catch { return null; }
  const g = cv.getContext('2d');
  if (!g) return null;
  // 不填底色：保持透明，让贴图能正确叠在「底色 + glow」之上。

  if (m.kind === 'linen' && m.linen) {
    const l = m.linen;
    const warp = l.warpStep || 12, weft = l.weftStep || 10;
    g.lineWidth = 1;
    g.strokeStyle = hexToRgba(l.warp, l.alpha ?? 0.045);
    for (let x = 0; x <= W; x += warp) {
      g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke();
    }
    g.strokeStyle = hexToRgba(l.weft, (l.alpha ?? 0.045) * 0.8);
    for (let y = 0; y <= H; y += weft) {
      g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke();
    }
    const edge = g.createLinearGradient(0, 0, 0, H);
    edge.addColorStop(0, hexToRgba(c.paperInk, l.edge ?? 0.05));
    edge.addColorStop(0.18, hexToRgba(c.paperInk, 0));
    edge.addColorStop(0.82, hexToRgba(c.paperInk, 0));
    edge.addColorStop(1, hexToRgba(c.paperInk, l.edge ?? 0.05));
    g.fillStyle = edge;
    g.fillRect(0, 0, W, H);
  }

  if (m.kind === 'dusk' && m.dusk) {
    const d = m.dusk;
    const top = H * (d.bandTop ?? 0.66);
    const band = g.createLinearGradient(0, top, 0, H);
    band.addColorStop(0, hexToRgba(d.warm, 0));
    band.addColorStop(0.28, hexToRgba(d.warm, (d.alpha ?? 0.22) * 0.8));
    band.addColorStop(1, hexToRgba(d.cool, d.alpha ?? 0.22));
    g.save();
    g.globalAlpha = 0.9;
    g.fillStyle = band;
    g.fillRect(0, top, W, H - top);
    g.restore();
    g.fillStyle = hexToRgba(d.warm, 0.1);
    g.fillRect(0, top, W, 1);
  }

  if (m.kind === 'scanline' && m.scanline) {
    const s = m.scanline;
    g.fillStyle = hexToRgba(c.ink, s.alpha ?? 0.1);
    for (let y = 0; y < H; y += (s.step || 4)) g.fillRect(0, y, W, 1);
    drawVignette(g, W, H, s.vignette ?? 0.34, 0.34, 0.92);
  }

  if (_staticMatCache.size > 32) _staticMatCache.clear();
  _staticMatCache.set(key, cv);
  return cv;
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

  // 1) 底色：主色 → 深色 的极轻竖直渐变（始终逐帧画，保证不透明基底）。
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, c.bg);
  base.addColorStop(1, c.bgDeep || c.bg);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // 静态材质贴图（透明层），Node / 无 document 时为 null，自动走原来的逐层绘制。
  const baked = staticMaterialTile(theme, W, H, c, m);

  // 2) 材质：每种主题一种主材质
  if (m.glow) {
    const g = m.glow;
    const breathe = 0.92 + 0.08 * Math.sin(t * 0.8);
    radial(ctx, W * g.x, H * g.y, g.radius, g.color, g.alpha * breathe);
  }

  // 烘焙贴图插在 glow 之后、动态层之前，与原逐层顺序一致。
  if (baked) ctx.drawImage(baked, 0, 0);

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

  /* v3 材质：每种都是 t 的纯函数，逐帧确定性，不消耗模块级 RNG。
   * baked 存在时静态层已由贴图一次盖上，这里只画动态部分。 */
  if (m.kind === 'scanline' && m.scanline) {
    const s = m.scanline;
    if (!baked) {
      ctx.save();
      ctx.fillStyle = hexToRgba(c.ink, s.alpha ?? 0.1);
      for (let y = 0; y < H; y += (s.step || 4)) ctx.fillRect(0, y, W, 1);
      ctx.restore();
      drawVignette(ctx, W, H, s.vignette ?? 0.34, 0.34, 0.92);
    }
    // CRT：极慢下移的亮带（动态）。
    const bandY = (((t * 26) % (H + 240)) + H + 240) % (H + 240) - 120;
    const band = ctx.createLinearGradient(0, bandY - 90, 0, bandY + 90);
    band.addColorStop(0, hexToRgba(s.bandColor || c.accent, 0));
    band.addColorStop(0.5, hexToRgba(s.bandColor || c.accent, s.band ?? 0.055));
    band.addColorStop(1, hexToRgba(s.bandColor || c.accent, 0));
    ctx.fillStyle = band;
    ctx.fillRect(0, bandY - 90, W, 180);
  }

  if (m.kind === 'dusk' && m.dusk && !baked) {
    // 暮光：地平线以下一条暖→冷的水平色带，顶部渐隐，不铺满全屏。
    const d = m.dusk;
    const top = H * (d.bandTop ?? 0.66);
    const band = ctx.createLinearGradient(0, top, 0, H);
    band.addColorStop(0, hexToRgba(d.warm, 0));
    band.addColorStop(0.28, hexToRgba(d.warm, (d.alpha ?? 0.22) * 0.8));
    band.addColorStop(1, hexToRgba(d.cool, d.alpha ?? 0.22));
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = band;
    ctx.fillRect(0, top, W, H - top);
    ctx.restore();
    // 地平线细线：让色带收口，避免像一整块渐变背景。
    ctx.fillStyle = hexToRgba(d.warm, 0.1);
    ctx.fillRect(0, top, W, 1);
  }

  if (m.kind === 'caustics' && m.caustics) {
    // 水下焦散：三条正弦光脊从上方渗入，随 t 缓慢漂移；底部压深。
    const k = m.caustics;
    const ridges = k.ridges ?? 3;
    const alpha = k.alpha ?? 0.075;
    ctx.save();
    ctx.lineWidth = 2;
    for (let i = 0; i < ridges; i++) {
      const phase = t * (0.22 + i * 0.07) + i * 1.9;
      const amp = H * (0.035 + i * 0.012);
      const baseY = H * (0.12 + i * 0.1);
      const grad = ctx.createLinearGradient(0, baseY - amp, 0, H * 0.78);
      grad.addColorStop(0, hexToRgba(k.color, alpha * (1 - i * 0.22)));
      grad.addColorStop(1, hexToRgba(k.color, 0));
      ctx.strokeStyle = grad;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 24) {
        const y = baseY + Math.sin(x / (260 + i * 90) + phase) * amp
          + Math.sin(x / 620 + phase * 0.6) * amp * 0.4;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
    const depth = ctx.createLinearGradient(0, H * 0.62, 0, H);
    depth.addColorStop(0, hexToRgba(c.bgDeep, 0));
    depth.addColorStop(1, hexToRgba(c.bgDeep, k.depth ?? 0.2));
    ctx.fillStyle = depth;
    ctx.fillRect(0, H * 0.62, W, H * 0.38);
  }

  if (m.kind === 'linen' && m.linen && !baked) {
    // 织纹：经纬双向极淡细线 + 纸边压色；线宽固定 1px，不随 t 变化。
    const l = m.linen;
    const warp = l.warpStep || 12, weft = l.weftStep || 10;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = hexToRgba(l.warp, l.alpha ?? 0.045);
    for (let x = 0; x <= W; x += warp) {
      ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke();
    }
    ctx.strokeStyle = hexToRgba(l.weft, (l.alpha ?? 0.045) * 0.8);
    for (let y = 0; y <= H; y += weft) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
    }
    ctx.restore();
    const edge = ctx.createLinearGradient(0, 0, 0, H);
    edge.addColorStop(0, hexToRgba(c.paperInk, l.edge ?? 0.05));
    edge.addColorStop(0.18, hexToRgba(c.paperInk, 0));
    edge.addColorStop(0.82, hexToRgba(c.paperInk, 0));
    edge.addColorStop(1, hexToRgba(c.paperInk, l.edge ?? 0.05));
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
