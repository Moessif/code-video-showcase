#!/usr/bin/env node
/**
 * nl2spec.mjs — C1-03：自然语言 → spec v1（纯规则、确定性、零依赖）。
 *
 * 设计：
 *   1. 只做「填表」：关键词命中 → 枚举值；未命中 → 默认值 + meta.notes 的 default 标记。
 *   2. 绝不追问；同一输入永远得到同一字节序列（无随机、无时间、无网络）。
 *   3. 生成后立刻用 templates/spec.mjs 的 normalizeSpec + validateSpec 自检；
 *      万一不合法，回退到 content/presets.json 的第一组（仍是合法 spec）。
 *   4. 页面只用仓库里真实存在的 templates/segment.html 与 templates/big-card.html，
 *      保证 spec-lint 的页面存在性检查能过。
 *
 * 用法：
 *   import { nl2spec } from './scripts/nl2spec.mjs';
 *   const spec = nl2spec('帮我做个赛博像素的宣传片，30秒竖屏');
 *
 *   node scripts/nl2spec.mjs "帮我做个赛博像素的宣传片" --out out/spec.json
 */
import fs from 'node:fs';

import { normalizeSpec, validateSpec } from '../templates/spec.mjs';
import { MOTION_LEVELS, deriveMotionProfile } from '../templates/motion-profile.mjs';
import { stylePageFor, styleRecipeIdFor } from '../templates/style-pages.mjs';

// ── 冻结的枚举（与 schema / templates/themes.js 对齐）───────────────────────

export const KIND_IDS = [
  'promo', 'launch', 'knowledge', 'ecommerce', 'brand-story', 'data-report', 'recruiting', 'annual',
  // v2.5：16 个新增垂直领域（研究背书：产品广告 9 品类 + 内容创作者常见场景）
  'tutorial', 'changelog', 'event', 'podcast', 'travel', 'food', 'fitness', 'realestate',
  'fintech', 'healthcare', 'course', 'gaming', 'music', 'nonprofit', 'sports', 'localbiz',
];

export const STYLE_IDS = [
  'cyber-pixel',
  'cyber-glitch',
  'pixel-8bit',
  'ink-wash',
  'guofeng',
  'great-wall',
  'whiteboard',
  'three-d',
  'data-viz',
  'screencast',
  'flat',
  'minimal',
  'vertical',
  'kinetic',
  'swiss',
  'editorial',
  'brutalist',
  'vaporwave',
  'blueprint',
  'risograph',
];

/** 与 templates/themes.js 的 17 个真实 id 一致（测试会交叉校验）。 */
export const THEME_IDS = [
  'coral-noir',
  'claude-light',
  'aqua-morandi',
  'amber-noir',
  'blueprint-stone',
  'graphite-signal',
  'celadon-paper',
  'crimson-theater',
  'cyber-neon',
  'paper-journal',
  'dark-gold-cinema',
  'ice-minimal',
  'pop-acid',
  'terminal-phosphor',
  'solar-dusk',
  'abyss-teal',
  'sand-linen',
];

export const ASPECTS = ['16:9', '9:16', '1:1', '3:4', '6:7'];
export const MOODS = ['electronic', 'restrained', 'epic', 'upbeat', 'guofeng'];

/** 动效档位（v2.3）：与 templates/motion-profile.mjs 的档位表一致。 */
export { MOTION_LEVELS };

/**
 * 读 content/combos.json 的 `_meta.accentFix`（对比度安全的主色对）。
 * 文件读不到时回落到空表——nl2spec 仍然能出 spec，只是那几套主题
 * 会让 spec-lint 报 APCA（而不是静默产出不可用的主色）。
 */
function readAccentFix() {
  try {
    const url = new URL('../content/combos.json', import.meta.url);
    const doc = JSON.parse(fs.readFileSync(url, 'utf8'));
    const fix = doc?._meta?.accentFix;
    if (!fix || typeof fix !== 'object') return {};
    const out = {};
    for (const [theme, v] of Object.entries(fix)) {
      if (v && typeof v.accent === 'string' && typeof v.accentInk === 'string') {
        out[theme] = { accent: v.accent, accentInk: v.accentInk };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 四套主题的默认 accentInk/accent 组合过不了 spec-lint 的 APCA 门槛
 * （accentInk/accent ≥ 45、accent/bg ≥ 30）。
 *
 * 真值在 content/combos.json 的 `_meta.accentFix`——wizard 也读同一份，
 * 这里不再抄第二份（v2.3.1 起；测试会交叉校验两边一致）。
 * 用户显式 --accent / 语料里的 #hex 永远优先。
 */
export const THEME_ACCENT_FIX = readAccentFix();

const PAGES = {
  segment: 'templates/segment.html',
  card: 'templates/big-card.html',
};

const KIND_LABEL = {
  promo: '宣传片',
  launch: '产品发布',
  knowledge: '知识科普',
  ecommerce: '电商带货',
  'brand-story': '品牌故事',
  'data-report': '数据报告',
  recruiting: '招聘',
  annual: '年度总结',
  tutorial: '教程教学',
  changelog: '版本更新',
  event: '活动邀请',
  podcast: '播客音频',
  travel: '旅行目的地',
  food: '美食食谱',
  fitness: '健身训练',
  realestate: '房产展示',
  fintech: '金融科普',
  healthcare: '健康养生',
  course: '课程教育',
  gaming: '游戏高光',
  music: '音乐发行',
  nonprofit: '公益影响',
  sports: '体育战报',
  localbiz: '本地商家',
};

const STYLE_LABEL = {
  'cyber-pixel': '赛博像素',
  'cyber-glitch': '赛博故障',
  'pixel-8bit': '8-bit 像素',
  'ink-wash': '水墨',
  guofeng: '国风',
  'great-wall': '长城',
  whiteboard: '白板',
  'three-d': '3D',
  'data-viz': '数据可视化',
  screencast: '录屏',
  flat: '扁平插画',
  minimal: '极简大字',
  vertical: '竖屏卡片',
  kinetic: '动态字体',
  swiss: '瑞士网格',
  editorial: '报纸编辑',
  brutalist: '新粗野主义',
  vaporwave: '蒸汽波',
  blueprint: '工程蓝图',
  risograph: '孔版印刷',
};

const KIND_DEFAULT_STYLE = {
  promo: 'cyber-pixel',
  launch: 'minimal',
  knowledge: 'flat',
  ecommerce: 'vertical',
  'brand-story': 'ink-wash',
  'data-report': 'data-viz',
  recruiting: 'whiteboard',
  annual: 'three-d',
  tutorial: 'screencast',
  changelog: 'kinetic',
  event: 'brutalist',
  podcast: 'editorial',
  travel: 'ink-wash',
  food: 'flat',
  fitness: 'brutalist',
  realestate: 'minimal',
  fintech: 'blueprint',
  healthcare: 'flat',
  course: 'swiss',
  gaming: 'cyber-glitch',
  music: 'vaporwave',
  nonprofit: 'editorial',
  sports: 'kinetic',
  localbiz: 'risograph',
};

const KIND_DEFAULT_THEME = {
  promo: 'coral-noir',
  launch: 'coral-noir',
  knowledge: 'paper-journal',
  ecommerce: 'aqua-morandi',
  'brand-story': 'celadon-paper',
  'data-report': 'blueprint-stone',
  recruiting: 'graphite-signal',
  annual: 'amber-noir',
  tutorial: 'blueprint-stone',
  changelog: 'coral-noir',
  event: 'pop-acid',
  podcast: 'paper-journal',
  travel: 'celadon-paper',
  food: 'paper-journal',
  fitness: 'pop-acid',
  realestate: 'ice-minimal',
  fintech: 'blueprint-stone',
  healthcare: 'aqua-morandi',
  course: 'ice-minimal',
  gaming: 'cyber-neon',
  music: 'cyber-neon',
  nonprofit: 'paper-journal',
  sports: 'coral-noir',
  localbiz: 'paper-journal',
};

const STYLE_DEFAULT_THEME = {
  'cyber-pixel': 'cyber-neon',
  'cyber-glitch': 'cyber-neon',
  'pixel-8bit': 'cyber-neon',
  'ink-wash': 'celadon-paper',
  guofeng: 'celadon-paper',
  'great-wall': 'dark-gold-cinema',
  whiteboard: 'paper-journal',
  'three-d': 'amber-noir',
  'data-viz': 'blueprint-stone',
  screencast: 'blueprint-stone',
  flat: 'paper-journal',
  minimal: 'coral-noir',
  vertical: 'aqua-morandi',
  kinetic: 'coral-noir',
  swiss: 'ice-minimal',
  editorial: 'paper-journal',
  brutalist: 'pop-acid',
  vaporwave: 'cyber-neon',
  blueprint: 'blueprint-stone',
  risograph: 'paper-journal',
};

const KIND_DEFAULT_DURATION = {
  promo: 30,
  launch: 41,
  knowledge: 41,
  ecommerce: 15,
  'brand-story': 60,
  'data-report': 30,
  recruiting: 30,
  annual: 60,
  tutorial: 41,
  changelog: 20,
  event: 20,
  podcast: 30,
  travel: 30,
  food: 25,
  fitness: 20,
  realestate: 30,
  fintech: 35,
  healthcare: 30,
  course: 41,
  gaming: 15,
  music: 20,
  nonprofit: 30,
  sports: 15,
  localbiz: 20,
};

const KIND_DEFAULT_MOOD = {
  promo: 'electronic',
  launch: 'restrained',
  knowledge: 'restrained',
  ecommerce: 'upbeat',
  'brand-story': 'guofeng',
  'data-report': 'electronic',
  recruiting: 'upbeat',
  annual: 'epic',
  tutorial: 'restrained',
  changelog: 'electronic',
  event: 'upbeat',
  podcast: 'restrained',
  travel: 'guofeng',
  food: 'upbeat',
  fitness: 'upbeat',
  realestate: 'restrained',
  fintech: 'restrained',
  healthcare: 'restrained',
  course: 'restrained',
  gaming: 'electronic',
  music: 'electronic',
  nonprofit: 'restrained',
  sports: 'epic',
  localbiz: 'upbeat',
};

const KIND_DEFAULT_CTA = {
  promo: '立即预约',
  launch: '预约体验',
  knowledge: '关注不迷路',
  ecommerce: '立即下单',
  'brand-story': '了解更多',
  'data-report': '获取完整报告',
  recruiting: '投递简历',
  annual: '明年见',
  tutorial: '跟着做',
  changelog: '立即升级',
  event: '立即报名',
  podcast: '订阅收听',
  travel: '出发吧',
  food: '收藏食谱',
  fitness: '开始训练',
  realestate: '预约看房',
  fintech: '了解更多',
  healthcare: '咨询医生',
  course: '立即报名',
  gaming: '关注主播',
  music: '立即预存',
  nonprofit: '支持我们',
  sports: '看下一场',
  localbiz: '到店体验',
};

const KIND_COPY = {
  promo: ['想做', '宣传片？', '#ff2bd6'],
  launch: ['想开', '产品发布会？', '#a58bff'],
  knowledge: ['想做', '知识科普？', '#58c4dd'],
  ecommerce: ['想卖', '爆款商品？', '#ff5f9e'],
  'brand-story': ['想讲', '品牌故事？', '#c9a45a'],
  'data-report': ['想晒', '增长数据？', '#2456d6'],
  recruiting: ['想招', '厉害的人？', '#ff4a1f'],
  annual: ['想回顾', '这一年？', '#f2c14e'],
  tutorial: ['想学', '实操教程？', '#58c4dd'],
  changelog: ['想看', '更新日志？', '#a58bff'],
  event: ['想办', '一场活动？', '#ff4a1f'],
  podcast: ['想听', '播客精华？', '#c9a45a'],
  travel: ['想去', '远方看看？', '#7fb8a4'],
  food: ['想做', '这道菜？', '#ff8a5c'],
  fitness: ['想练', '好身材？', '#ff4a1f'],
  realestate: ['想看', '理想家？', '#6fd3ff'],
  fintech: ['想懂', '理财逻辑？', '#2456d6'],
  healthcare: ['想问', '健康问题？', '#7fb8a4'],
  course: ['想学', '一门课？', '#e2231a'],
  gaming: ['想看', '神操作？', '#ff2bd6'],
  music: ['想听', '新歌首发？', '#ff2bd6'],
  nonprofit: ['想帮', '一个故事？', '#9e2b25'],
  sports: ['想看', '比赛集锦？', '#ff4a1f'],
  localbiz: ['想逛', '宝藏小店？', '#ff48a4'],
};

const MOOD_BPM = { electronic: 120, restrained: 90, epic: 100, upbeat: 128, guofeng: 80 };

// ── 关键词表（顺序 = 优先级）───────────────────────────────────────────────

const KIND_RULES = [
  // 高优先复合词消歧：跨领域短语里「更具体的领域」胜出（first-match-wins）。
  // 没有它们时：游戏攻略→travel(攻略)、健身活动→event(活动)、新歌发布会→launch(发布)、
  // 音乐访谈→podcast(访谈)、餐厅美食→localbiz(餐厅)。这些复合词必须排在通用词之前。
  ['gaming', ['游戏攻略', '游戏解说', '游戏高光', '电竞比赛', '电竞选手']],
  ['music', ['新歌发布', '新歌首发', '专辑发布', '单曲首发', '音乐访谈', '音乐发行']],
  ['fitness', ['健身活动', '健身训练', '训练计划', '健身挑战']],
  ['food', ['餐厅美食', '美食探店', '美食食谱']],
  ['annual', ['年度', '年终', '年会', '全年', '总结', '年度总结', 'recap', 'annual', 'year in review', 'year-end']],
  ['recruiting', ['招聘', '招人', '招募', '校招', '社招', '内推', 'hiring', 'recruit', 'careers', 'job opening']],
  [
    'data-report',
    ['数据报告', '数据新闻', '季度报告', '财报', '投研', '报表', '复盘', '数据', '报告', 'dashboard', 'data report', 'quarterly report', 'analytics report'],
  ],
  ['brand-story', ['品牌故事', '品牌片', '品牌理念', '品牌历程', 'brand story', 'brand film', 'about us', 'origin story']],
  [
    'ecommerce',
    ['电商', '带货', '卖货', '商品', '种草', '促销', '下单', '转化', 'ecommerce', 'e-commerce', 'product ad', 'sale video'],
  ],
  ['launch', ['发布', '发布会', '新品', '上市', '亮相', '产品', 'launch', 'unveil', 'keynote', 'reveal']],
  [
    'knowledge',
    ['科普', '知识', '教程', '讲解', '原理', '课程', '教学', '为什么', 'explainer', 'tutorial', 'knowledge', 'science', 'how to', 'fourier'],
  ],
  // v2.5 新增垂直领域。放在 knowledge 之后（'教程/课程/科普' 仍归 knowledge）、
  // promo 兜底之前；关键词刻意避开既有规则的子串，防止抢走老用例。
  ['tutorial', ['实操', '手把手', '步骤演示', '操作指南', 'how-to', 'step by step']],
  ['course', ['网课', '教育培训', '培训班', '慕课', 'course', 'enroll']],
  ['changelog', ['更新日志', '版本更新', '更新内容', 'changelog', 'release notes']],
  ['music', ['新歌', '专辑', '单曲', '音乐', 'music', 'presave', '发行']],
  ['event', ['活动', '邀请函', '峰会', '沙龙', 'meetup', 'event']],
  ['podcast', ['播客', '音频节目', '访谈', 'podcast', 'audiogram', '电台']],
  ['travel', ['旅行', '旅游', '目的地', '攻略', 'travel', 'destination', '自驾']],
  ['food', ['食谱', '做菜', '美食', '烹饪', '菜谱', 'recipe', 'food']],
  ['fitness', ['健身', '训练', '燃脂', '增肌', 'workout', 'fitness']],
  ['realestate', ['房产', '楼盘', '看房', '户型', '买房', 'real estate', 'property']],
  ['fintech', ['金融', '理财', '基金', '保险', 'fintech', 'finance']],
  ['healthcare', ['健康', '养生', '医疗', '症状', 'health', 'wellness']],
  ['gaming', ['游戏', '电竞', '神操作', 'gaming', 'gameplay']],
  ['sports', ['比赛', '赛事', '集锦', '比分', '球队', 'sports', 'match']],
  ['nonprofit', ['公益', '慈善', '捐赠', '志愿', 'nonprofit', 'charity', 'donate']],
  ['localbiz', ['门店', '小店', '餐厅', '商家', '到店', '探店', 'local business', 'restaurant']],
  ['promo', ['宣传', '推广', '广告', '预热', '造势', '片头', 'promo', 'advertising', 'campaign', 'trailer', 'teaser']],
];

const STYLE_RULES = [
  ['cyber-glitch', ['赛博故障', '故障', 'glitch', 'datamosh', '信号干扰']],
  ['cyber-pixel', ['赛博像素', '赛博朋克', '赛博', 'cyberpunk', 'cyber pixel', 'cyber-pixel', 'neon pixel']],
  ['pixel-8bit', ['8-bit', '8bit', '8 bit', '八位', '像素风', '像素', 'pixel art', 'pixel-art', '街机', 'arcade', '游戏画面']],
  // v2.5 新增画风关键词（具体词优先于通用 flat/minimal）
  ['vaporwave', ['蒸汽波', '蒸气波', '复古未来', 'retrowave', 'vaporwave', 'synthwave', '赛博黄昏', '霓虹落日']],
  ['brutalist', ['粗野', '粗野主义', '新粗野', 'brutalist', 'brutalism', 'neo-brutalist', '撞色', '硬投影', '反精致']],
  ['risograph', ['孔版', '孔版印刷', 'risograph', 'riso', '专色', '套印', '套色', '印刷感', '丝网']],
  ['blueprint', ['蓝图', '工程图', '施工图', '图纸', 'blueprint', 'technical drawing', '尺寸标注', '制图']],
  ['editorial', ['报纸', '编辑', '报刊', '杂志', 'editorial', 'newspaper', 'magazine', '衬线', '专栏', '版面']],
  ['swiss', ['瑞士', '国际主义', '网格', 'swiss', 'international style', 'helvetica', '栅格', '排版']],
  ['kinetic', ['动态字体', '动态字', 'kinetic', 'kinetic typography', '文字动画', '大字动画', '字体动画']],
  ['whiteboard', ['白板', '手绘', '手写', '涂鸦', 'whiteboard', 'hand-drawn', 'hand drawn', 'doodle']],
  ['ink-wash', ['水墨', '墨色', '山水', '宣纸', 'ink wash', 'ink-wash', 'sumi']],
  ['guofeng', ['国风', '古风', '东方', '中国风', 'guofeng', 'oriental', 'chinese style']],
  ['great-wall', ['长城', '关隘', '边塞', '山海关', '嘉峪关', '万里长城', 'great wall', 'great-wall', 'fortress', 'rampart']],
  ['three-d', ['3d', '3 d', '三维', '立体', 'three.js', 'threejs', 'c4d', '粘土', 'clay', 'cinema4d']],
  ['data-viz', ['数据可视化', '数据', '图表', '条形', '竞速', '可视化', 'data viz', 'dataviz', 'data-viz', 'chart', 'infographic']],
  ['screencast', ['录屏', '代码', '编程', 'screencast', 'screen recording', 'programming', 'coding', 'developer']],
  ['vertical', ['竖屏', '竖版', '9:16', '9：16', '抖音', '快手', '小红书', 'tiktok', 'reels', 'shorts', 'vertical']],
  ['minimal', ['极简', '简约', '大字', 'minimal', 'minimalist', 'keynote style']],
  ['flat', ['扁平', '插画', 'flat', 'illustration', '矢量', 'vector']],
];

const THEME_RULES = [
  ['coral-noir', ['珊瑚', 'coral']],
  ['claude-light', ['橙光', 'claude']],
  ['aqua-morandi', ['莫兰迪', '水蓝', 'morandi']],
  ['amber-noir', ['琥珀', 'amber']],
  ['blueprint-stone', ['蓝图', 'blueprint']],
  ['graphite-signal', ['石墨', 'graphite']],
  ['celadon-paper', ['青瓷', 'celadon']],
  ['crimson-theater', ['绯墨', '剧场', 'crimson']],
  ['cyber-neon', ['赛博霓虹', '霓虹', 'cyber neon']],
  ['paper-journal', ['纸页', '纸质', '手账', 'paper journal', 'journal paper']],
  ['dark-gold-cinema', ['暗金', '黑金电影', 'dark gold']],
  ['ice-minimal', ['冰蓝', 'ice minimal']],
  ['pop-acid', ['波普', '酸色', 'pop acid']],
  ['terminal-phosphor', ['终端', '磷光', '命令行', 'terminal', 'phosphor', 'crt']],
  ['solar-dusk', ['落日', '暖丘', '暮色', 'solar dusk', 'sunset']],
  ['abyss-teal', ['深海', '藏青', 'abyss', 'teal', 'ocean']],
  ['sand-linen', ['亚麻', '宣纸', '本色', 'linen', 'sand']],
];

const ASPECT_RULES = [
  ['9:16', ['竖屏', '竖版', '9:16', '9：16', '抖音', '快手', '小红书', '视频号', 'tiktok', 'reels', 'shorts', 'vertical', 'portrait']],
  ['1:1', ['方形', '正方形', '1:1', '1：1', 'square']],
  ['16:9', ['横屏', '横版', '16:9', '16：9', 'bilibili', '哔哩哔哩', 'youtube', 'landscape', 'widescreen']],
];

const MOOD_RULES = [
  ['guofeng', ['东方', '国风', '古风', '水墨', '中国风', 'guofeng', 'oriental']],
  ['epic', ['史诗', '燃', '震撼', '宏大', '大气', '年会', 'epic', 'cinematic', 'blockbuster']],
  ['upbeat', ['时尚', '轻快', '活泼', '快节奏', '欢快', '动感', 'upbeat', 'energetic', 'lively', 'trendy']],
  ['restrained', ['高端', '奢华', '高级', '克制', '沉稳', '静谧', '清新', 'premium', 'luxury', 'refined', 'restrained', 'calm']],
  ['electronic', ['科技', '电子', '未来', '赛博', '数码', '工业', 'tech', 'electronic', 'futuristic', 'cyber', 'industrial']],
];

const KNOWN_CTAS = [
  '立即购买',
  '立即下单',
  '立即预约',
  '立即体验',
  '马上体验',
  '预约体验',
  '扫码关注',
  '关注我们',
  '私信',
  '联系我们',
  '了解更多',
  '投递简历',
  '获取报告',
  '下载白皮书',
  '现在就试',
  '现在下单',
  '明年见',
];

// ── helpers ────────────────────────────────────────────────────────────────

const lower = (s) => String(s ?? '').toLowerCase();
const hasAny = (text, words) => words.some((w) => text.includes(lower(w)));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const roundTo = (v, step) => Math.round(v / step) * step;

function matchRules(text, rules) {
  for (const [id, words] of rules) if (hasAny(text, words)) return id;
  return null;
}

function parseDuration(text) {
  if (/半分钟|half a minute|half-minute/.test(text)) return 30;
  if (/一分钟|one minute|1\s*(?:minute|min)\b/.test(text)) return 60;
  const minute = text.match(/(\d+(?:\.\d+)?)\s*(?:分钟|分\b|minutes?\b|mins?\b)/);
  if (minute) return Number(minute[1]) * 60;
  const second = text.match(/(\d+(?:\.\d+)?)\s*(?:秒|seconds?\b|secs?\b|s\b)/);
  if (second) return Number(second[1]);
  return null;
}

function parseBrand(text) {
  const m =
    text.match(/(?:品牌|brand)\s*[：:=]\s*([^\s，,。；;：:]{1,24})/i) ||
    text.match(/(?:品牌叫|品牌是|brand is|brand called)\s*([^\s，,。；;：:]{1,24})/i);
  return m ? m[1].trim() : null;
}

function parseCta(text) {
  const m = text.match(/(?:结尾\s*cta|cta|行动号召|片尾)\s*[：:=]?\s*(?:是|为|用)?\s*([^\s，,。；;]{2,16})/i);
  if (m) return m[1].trim();
  return KNOWN_CTAS.find((c) => text.includes(lower(c))) || null;
}

function parseAccent(text) {
  const m = text.match(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/i);
  return m ? m[0].toLowerCase() : null;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function sizeFor(aspect) {
  if (aspect === '9:16') return { width: 1080, height: 1920 };
  if (aspect === '1:1') return { width: 1080, height: 1080 };
  if (aspect === '3:4') return { width: 1080, height: 1440 };
  if (aspect === '6:7') return { width: 1080, height: 1260 };
  return { width: 1920, height: 1080 };
}

/**
 * 把任意目标时长切成结构公式可精确复现的 (opening, round, card, ending, moreCard, flash, rounds)。
 * D = opening + N×round + moreCard + flash.count×flash.each + ending
 */
export function fitStructure(duration, roundCount) {
  const D = Number(duration);
  // 轮数按 ~7s 一轮，且不超过「每轮至少 3s」的可行上限；显式 roundCount 也会被夹住。
  const maxRounds = Math.max(1, Math.min(24, Math.floor(D / 3)));
  const n = clamp(roundCount || Math.round(D / 7), 1, maxRounds);

  // 4–9s 的短片去掉闪白、缩小 moreCard，避免固定开销吃掉整条片子。
  const flash = { count: D >= 10 ? 8 : 0, each: 0.25 };
  const flashTotal = flash.count * flash.each;
  const moreCard = D >= 8 ? 1 : 0.5;
  const opening = D >= 10 ? Math.max(1, roundTo(D * 0.2, 0.5)) : Math.min(1, roundTo(D * 0.1, 0.25));
  const ending = D >= 10 ? Math.max(1, roundTo(D * 0.15, 0.5)) : Math.min(1, roundTo(D * 0.1, 0.25));

  let round = Math.max(0.75, roundTo((D - opening - ending - moreCard - flashTotal) / n, 0.25));
  let adjustedOpening = D - ending - moreCard - flashTotal - n * round;
  // 收尾：opening 至少 0.25s；不够就把 round 降一档。
  while (adjustedOpening < 0.25 && round > 0.75) {
    round = Number((round - 0.25).toFixed(3));
    adjustedOpening = D - ending - moreCard - flashTotal - n * round;
  }
  if (adjustedOpening < 0.25) {
    // 理论上到不了这里（n 已被 D/3 夹住）；保底仍让公式精确成立。
    const deficit = 0.25 - adjustedOpening;
    const endingCut = Math.min(deficit, Math.max(0, ending - 0.25));
    const afterEnding = ending - endingCut;
    const moreCut = Math.min(deficit - endingCut, Math.max(0, moreCard - 0.25));
    const afterMore = moreCard - moreCut;
    adjustedOpening = D - afterEnding - afterMore - flashTotal - n * round;
    return {
      structure: {
        opening: Number(Math.max(0.1, adjustedOpening).toFixed(3)),
        round: Number(round.toFixed(3)),
        card: Number(Math.max(0.1, Math.min(1, round / 3)).toFixed(3)),
        ending: Number(afterEnding.toFixed(3)),
        moreCard: Number(afterMore.toFixed(3)),
        flash,
      },
      rounds: n,
    };
  }

  const card = Math.max(0.25, Math.min(1, round / 3));
  return {
    structure: {
      opening: Number(adjustedOpening.toFixed(3)),
      round: Number(round.toFixed(3)),
      card: Number(card.toFixed(3)),
      ending: Number(ending.toFixed(3)),
      moreCard,
      flash,
    },
    rounds: n,
  };
}

function buildRounds(count, kind, style) {
  const [first, keyword, color] = KIND_COPY[kind];
  // v2.3.1：画风必须落到真实页面（templates/style-pages.mjs 是唯一真值）。
  // 之前固定写 templates/segment.html，导致选任何画风都渲染占位骨架。
  const page = stylePageFor(style);
  const recipe = styleRecipeIdFor(style) || style;
  return Array.from({ length: count }, (_, i) => ({
    id: `r${String(i + 1).padStart(2, '0')}`,
    name: `${KIND_LABEL[kind]} / ${STYLE_LABEL[style]}`,
    card: {
      page: PAGES.card,
      layout: i % 4,
      index: i + 1,
      total: count,
      first,
      keyword,
      color,
    },
    style: {
      page,
      recipe,
      t0: [0.3, 0.5, 0, 0.3][i % 4],
      speed: [1.4, 1.45, 1, 1.3][i % 4],
    },
  }));
}

// ── 主函数 ─────────────────────────────────────────────────────────────────

/**
 * @param {string} text 中文/英文自然语言
 * @param {object} overrides 显式覆盖：kind/style/theme/duration/aspect/mood/brand/cta/name/accent/bpm/quality/preset/outDir
 * @returns {object} 合法 spec v1（已 normalize，未写文件）
 */
export function nl2spec(text, overrides = {}) {
  const source = String(text ?? '');
  const t = lower(source);
  const notes = [];
  const defaults = [];

  const ov = overrides && typeof overrides === 'object' ? overrides : {};
  const ignored = [];
  const takeEnum = (value, list, dim) => {
    if (value === undefined || value === null) return null;
    const v = String(value);
    if (list.includes(v)) return v;
    ignored.push(`${dim}=${v}`);
    return null;
  };

  // 1) kind
  const matchedKind = matchRules(t, KIND_RULES);
  const kindOverride = takeEnum(ov.kind, KIND_IDS, 'kind');
  const kind = kindOverride || matchedKind || 'promo';
  if (!kindOverride && !matchedKind) {
    defaults.push('kind');
    notes.push(`default:kind=${kind}（未识别「做什么片」，用默认值）`);
  }

  // 2) style
  const matchedStyle = matchRules(t, STYLE_RULES);
  const styleOverride = takeEnum(ov.style, STYLE_IDS, 'style');
  const style = styleOverride || matchedStyle || KIND_DEFAULT_STYLE[kind];
  const styleIsDefault = !styleOverride && !matchedStyle;
  if (styleIsDefault) {
    defaults.push('style');
    notes.push(`default:style=${style}（未识别画风，按 kind=${kind} 的推荐值）`);
  }

  // 3) theme
  const matchedTheme = matchRules(t, THEME_RULES);
  const themeOverride = takeEnum(ov.theme, THEME_IDS, 'theme');
  const theme = themeOverride || matchedTheme || (styleIsDefault ? KIND_DEFAULT_THEME[kind] : STYLE_DEFAULT_THEME[style]);
  const themeIsDefault = !themeOverride && !matchedTheme && styleIsDefault;
  if (themeIsDefault) {
    defaults.push('theme');
    notes.push(`default:theme=${theme}（未识别气质主题，按 kind=${kind} 的推荐值）`);
  } else if (!themeOverride && !matchedTheme) {
    notes.push(`derived:theme=${theme}（由 style=${style} 推导）`);
  }

  // 4) format
  const parsedRaw = parseDuration(t);
  const parsedDuration = parsedRaw && parsedRaw > 0 ? parsedRaw : null;
  const overrideRaw = ov.duration === undefined || ov.duration === null ? null : Number(ov.duration);
  const durationOverride = Number.isFinite(overrideRaw) && overrideRaw > 0 ? overrideRaw : null;
  if (ov.duration !== undefined && ov.duration !== null && durationOverride === null) {
    notes.push(`ignored:duration=${ov.duration}（不是正数）`);
  }
  let duration = durationOverride || parsedDuration || KIND_DEFAULT_DURATION[kind];
  const clampedDuration = clamp(duration, 4, 600);
  if (clampedDuration !== duration) notes.push(`clamped:duration=${duration}→${clampedDuration}（支持 4–600 秒）`);
  duration = clampedDuration;

  const matchedAspect = matchRules(t, ASPECT_RULES);
  const aspectOverride = takeEnum(ov.aspect, ASPECTS, 'aspect');
  const aspect = aspectOverride || matchedAspect || (kind === 'ecommerce' ? '9:16' : '16:9');

  const durationIsDefault = durationOverride === null && parsedDuration === null;
  const aspectIsDefault = !aspectOverride && !matchedAspect;
  if (durationIsDefault) {
    defaults.push('format');
    notes.push(`default:format.duration=${duration}（未识别时长，按 kind=${kind} 的推荐值）`);
  }
  if (aspectIsDefault) {
    if (!defaults.includes('format')) defaults.push('format');
    notes.push(`default:format.aspect=${aspect}（未识别画幅，按 kind=${kind} 的推荐值）`);
  }

  // 5) mood
  const matchedMood = matchRules(t, MOOD_RULES);
  const moodOverride = takeEnum(ov.mood, MOODS, 'mood');
  const mood = moodOverride || matchedMood || KIND_DEFAULT_MOOD[kind];
  if (!moodOverride && !matchedMood) {
    defaults.push('mood');
    notes.push(`default:mood=${mood}（未识别节奏/气质，按 kind=${kind} 的推荐值）`);
  }

  // 6) brand / accent / cta
  const name = String(ov.name || `${KIND_LABEL[kind]} · ${STYLE_LABEL[style]}`).trim();
  const parsedBrand = parseBrand(source);
  // 未提供品牌时用项目名兜底，而不是留下 {{BRAND}}：
  // 默认路径必须能直接 build，占位符由 lint 当 error 拦截（v2.3.5）。
  const brand = String(ov.brand || parsedBrand || name).trim() || name;
  if (!ov.brand && !parsedBrand) {
    defaults.push('brand');
    notes.push(`default:brand=${brand}（未提供品牌，用项目名兜底）`);
  }

  const accentInput = ov.accent ? String(ov.accent) : parseAccent(source);
  const accent = accentInput && HEX.test(accentInput) ? accentInput.toLowerCase() : null;
  if (accentInput && !accent) notes.push(`ignored:accent=${accentInput}（不是 #rgb/#rrggbb）`);
  const accentFix = accent || !THEME_ACCENT_FIX[theme] ? null : THEME_ACCENT_FIX[theme];
  if (accentFix) {
    notes.push(`apca:look.accentOverride=${theme}（默认主色组合 APCA < 45，已改用对比度安全值）`);
  }

  const parsedCta = parseCta(source);
  const cta = String(ov.cta || parsedCta || KIND_DEFAULT_CTA[kind]).trim();
  if (!ov.cta && !parsedCta) {
    defaults.push('cta');
    notes.push(`default:cta=${cta}（未识别结尾 CTA，按 kind=${kind} 的推荐值）`);
  }

  // 6.5) 动效档位（v2.3）：显式指定优先，否则按 kind × style 推导。
  const motionOverride = takeEnum(ov.motion, MOTION_LEVELS, 'motion');
  const motion = motionOverride || deriveMotionProfile({ kind, style });
  if (motionOverride) {
    notes.push(`motion:look.motion=${motion}（显式指定）`);
  } else {
    notes.push(`derived:motion=${motion}（由 kind=${kind} × style=${style} 推导）`);
  }

  // 7) structure + rounds
  const fitted = fitStructure(duration, ov.rounds ? Number(ov.rounds) : undefined);
  const { width, height } = sizeFor(aspect);
  const bpm = Number(ov.bpm) > 0 ? Number(ov.bpm) : MOOD_BPM[mood];

  const raw = {
    specVersion: 1,
    meta: {
      name,
      title: name,
      brand,
      cta,
      locale: 'zh-CN',
      kind,
      notes,
      defaults,
      source: 'nl2spec',
    },
    format: { width, height, fps: 30, aspect, duration },
    look: {
      mode: 'showcase',
      style,
      theme,
      accentOverride: accent || (accentFix ? { accent: accentFix.accent, accentInk: accentFix.accentInk } : null),
      motion,
    },
    audio: { mood, bpm, vo: null },
    structure: fitted.structure,
    opening: { page: PAGES.segment, name: 'opening' },
    rounds: buildRounds(fitted.rounds, kind, style),
    moreCard: { page: PAGES.card, layout: 3, first: '还有', keyword: '更多？' },
    flash: { page: PAGES.card },
    ending: { page: PAGES.segment, name: 'ending' },
    assets: [],
    patches: [],
    render: {
      quality: takeEnum(ov.quality, ['master', 'delivery', 'draft'], 'quality') || 'master',
      preset: takeEnum(ov.preset, ['bilibili', 'douyin', 'youtube', 'wechat', 'weixin', 'xiaohongshu', 'master', 'square'], 'preset')
        || (aspect === '9:16' ? 'douyin' : aspect === '1:1' ? 'square' : aspect === '3:4' ? 'xiaohongshu' : aspect === '6:7' ? 'weixin' : 'bilibili'),
      concurrency: 4,
      outDir: String(ov.outDir || 'out'),
    },
  };
  if (ignored.length) raw.meta.notes.push(`ignored:${ignored.join(',')}（越界枚举已丢弃）`);

  // 8) 自检；不合法 → 回退到 presets.json 第一组
  try {
    const normalized = normalizeSpec(raw);
    const errors = validateSpec(normalized).filter((i) => i.level === 'error');
    if (!errors.length) return normalized;
    return fallbackSpec(normalized, errors);
  } catch (e) {
    return fallbackSpec(raw, [{ code: 'E_EXCEPTION', message: String(e.message || e) }]);
  }
}

// ── 回退 ───────────────────────────────────────────────────────────────────

const EMBEDDED_PRESETS = [
  {
    id: 'promo-cyber-pixel',
    kind: 'promo',
    style: 'cyber-pixel',
    theme: 'cyber-neon',
    duration: 30,
    aspect: '16:9',
    mood: 'electronic',
  },
];

let presetCache = null;

function readFirstPreset() {
  if (presetCache) return presetCache;
  try {
    const url = new URL('../content/presets.json', import.meta.url);
    const doc = JSON.parse(fs.readFileSync(url, 'utf8'));
    presetCache = Array.isArray(doc.presets) && doc.presets.length ? doc.presets : EMBEDDED_PRESETS;
  } catch {
    presetCache = EMBEDDED_PRESETS;
  }
  return presetCache;
}

function fallbackSpec(raw, errors) {
  const p = readFirstPreset()[0];
  const fitted = fitStructure(Number(p.duration) || 30);
  const { width, height } = sizeFor(p.aspect || '16:9');
  const fallback = {
    specVersion: 1,
    meta: {
      name: String(p.name || 'fallback'),
      title: String(p.name || 'fallback'),
      brand: raw?.meta?.brand || String(p.name || 'fallback'),
      cta: raw?.meta?.cta || KIND_DEFAULT_CTA[p.kind] || '现在就试试',
      locale: 'zh-CN',
      kind: p.kind || 'promo',
      source: 'nl2spec-fallback',
      notes: [
        ...((raw?.meta?.notes || []).filter((n) => typeof n === 'string')),
        `fallback:${p.id || 'preset[0]'}（生成结果未通过 validateSpec，${errors.map((e) => e.code || 'error').join(',')}）`,
      ],
      defaults: raw?.meta?.defaults || [],
    },
    format: { width, height, fps: 30, aspect: p.aspect || '16:9', duration: Number(p.duration) || 30 },
    look: {
      mode: 'showcase',
      style: p.style || 'cyber-pixel',
      theme: p.theme || 'cyber-neon',
      accentOverride: null,
      motion: deriveMotionProfile({ kind: p.kind || 'promo', style: p.style || 'cyber-pixel' }),
    },
    audio: { mood: p.mood || 'electronic', bpm: MOOD_BPM[p.mood] || 120, vo: null },
    structure: fitted.structure,
    opening: { page: PAGES.segment, name: 'opening' },
    rounds: buildRounds(fitted.rounds, p.kind || 'promo', p.style || 'cyber-pixel'),
    moreCard: { page: PAGES.card, layout: 3, first: '还有', keyword: '更多？' },
    flash: { page: PAGES.card },
    ending: { page: PAGES.segment, name: 'ending' },
    assets: [],
    patches: [],
    render: { quality: 'master', preset: 'bilibili', concurrency: 4, outDir: String(raw?.render?.outDir || 'out') },
  };
  const normalized = normalizeSpec(fallback);
  const errs = validateSpec(normalized).filter((i) => i.level === 'error');
  if (errs.length) {
    throw new Error(`nl2spec fallback is invalid: ${errs.map((e) => `${e.code} ${e.path}`).join(', ')}`);
  }
  return normalized;
}

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const flags = {};
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      words.push(a);
      continue;
    }
    const key = a.slice(2);
    if (key === 'help') {
      flags.help = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  }
  return { flags, text: words.join(' ').trim() };
}

function main() {
  const { flags, text } = parseArgs(process.argv.slice(2));
  if (flags.help || !text) {
    console.log(`Usage: node scripts/nl2spec.mjs "<自然语言>" [options]
  --out <file>        写出 spec JSON（默认只打印摘要）
  --brand <name>      覆盖品牌
  --accent <#hex>     覆盖主色
  --kind <id>         ${KIND_IDS.join('|')}
  --style <id>        ${STYLE_IDS.join('|')}
  --theme <id>        ${THEME_IDS.join('|')}
  --duration <sec>    覆盖时长
  --aspect <a>        ${ASPECTS.join('|')}
  --mood <m>          ${MOODS.join('|')}
  --motion <level>    ${MOTION_LEVELS.join('|')}（动效档位，默认按 kind×style 推导）
  --name <name>       覆盖项目名
  --json              把 spec 打印到 stdout`);
    process.exit(flags.help ? 0 : 1);
  }

  const overrides = {};
  for (const k of ['brand', 'accent', 'kind', 'style', 'theme', 'duration', 'aspect', 'mood', 'name', 'quality', 'preset', 'outDir', 'bpm', 'rounds', 'motion']) {
    if (flags[k] !== undefined && flags[k] !== true) overrides[k] = flags[k];
  }

  const spec = nl2spec(text, overrides);
  if (flags.out && flags.out !== true) {
    const outPath = String(flags.out);
    const dir = outPath.includes('/') || outPath.includes('\\') ? outPath.replace(/[\\/][^\\/]+$/, '') : '.';
    fs.mkdirSync(dir || '.', { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n');
    console.log(`[nl2spec] ${outPath}`);
  }
  if (flags.json) console.log(JSON.stringify(spec, null, 2));
  console.log(
    `[spec] ${spec.meta.name} · ${spec.format.width}×${spec.format.height} · ${spec.format.duration}s · ` +
      `${spec.rounds.length} rounds · ${spec.look.theme} / ${spec.look.style} · kind=${spec.meta.kind}`,
  );
  if (spec.meta.defaults?.length) console.log(`[defaults] ${spec.meta.defaults.join(', ')}`);
  if (spec.meta.notes?.length) for (const n of spec.meta.notes) console.log(`  note: ${n}`);
}

const invokedDirectly =
  process.argv[1] && String(process.argv[1]).split(/[\\/]/).pop().toLowerCase() === 'nl2spec.mjs';
if (invokedDirectly) {
  try {
    main();
  } catch (e) {
    console.error('[fatal]', e.stack || e.message || e);
    process.exit(1);
  }
}
