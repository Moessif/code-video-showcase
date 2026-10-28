# 主题系统（8 套配色 × 8 种材质）

> 一句话：主题不是「换三个颜色」，而是**角色色板 + 材质 + HUD 规格 + 点缀色**四层一起换。
> 数据唯一来源：`templates/themes.js`；对比度审计：`node scripts/theme-audit.mjs`。
> 用法入口：`references/intake.md`（先问清信息、锁定主题），本文是主题的设计规范与实现说明。

---

## 1. 为什么是四层，而不是一组颜色

同一支片子里，大字卡、风格段、胶囊 HUD、片头片尾对颜色的要求完全不同：

| 层 | 解决什么 | 对应字段 |
|---|---|---|
| 角色色板 | 底色/主字/强调色/纸面/暗卡必须各有明确定义，浅色主题下尤其不能混用 | `colors.*`（14 个角色 token） |
| 材质 | 颗粒、柔光、玻璃、烫金、网格、水墨、聚光，决定「质感」而不是「色相」 | `material.*` |
| HUD 规格 | 胶囊/倒计时/水印在暗底上是浅色半透明，在浅底上必须换成深色实体，否则读不出来 | `hud.*` + `chrome(theme)` |
| 点缀色 | 11 个风格段各自有主色，需要一组和主题相容的替换色，避免风格段把整片气质带跑 | `accents[]`（4 个） |

只换主色会露馅的三个典型：浅色主题用原版胶囊（半透明黑底+浅字，在纸上像一块脏补丁）；深色主题的暗卡在白纸上消失；风格段沿用高饱和霓虹，把莫兰迪气质打穿。四层一起换才成立。

---

## 2. 8 套主题速查

| # | id | 名称 | 明暗 | 主材质 | 底色 | 强调 | 适合 |
|---|---|---|---|---|---|---|---|
| 01 | `coral-noir` | 珊瑚暗夜 | dark | 胶片颗粒 | `#0e0e0d` | `#d97757` | 默认 / 科技发布 / 产品片 |
| 02 | `claude-light` | 橙光白 | light | 纸面柔光 | `#f0eee6` | `#d97757` | 品牌 / 知识 / 生活方式 / 访谈 |
| 03 | `aqua-morandi` | 水蓝白 · 莫兰迪 | light | 液态玻璃 · 柔光 | `#f4f8f8` | `#6e9fae` | 品牌 / 美妆 / 生活方式 / 轻科技 |
| 04 | `amber-noir` | 琥珀黑金 | dark | 金属烫金 | `#0c0a08` | `#c9a45a` | 高端 / 奢品 / 电影感 / 年度片 |
| 05 | `blueprint-stone` | 蓝图纸 | light | 蓝图网格 | `#dfdedb` | `#2456d6` | 工程 / 建筑 / 数据 / 技术 |
| 06 | `graphite-signal` | 石墨信号 | dark | 哑光工业 | `#18191b` | `#ff4a1f` | 开发者 / 硬件 / 工业 / 硬核科技 |
| 07 | `celadon-paper` | 青瓷白 | light | 水墨晕染 | `#f7f9f8` | `#06525c` | 东方 / 文化 / 极简 / 品牌故事 |
| 08 | `crimson-theater` | 绯墨剧场 | dark | 舞台聚光 | `#0a0a0a` | `#b11226` | 时尚 / 艺术 / 预告 / 情绪片 |

4 深 4 浅，默认 `coral-noir` 与旧版视觉**逐值一致**，不传 `theme` 时老项目行为不变。

---

## 3. 每套主题的性格与用法

### 01 珊瑚暗夜 `coral-noir`（默认，原版）

- **调性**：温暖暗场 + 珊瑚一点；电影感来自颗粒、径向光晕和速度线，不来自花哨配色。
- **色板**：底 `#0e0e0d` / 主字 `#f5f0e8` / 强调 `#d97757` / 纸面 `#f4efe6` / 暗卡 `#0e0e0d`。
- **材质**：`grain` 颗粒 0.055 + 珊瑚径向光晕；光晕只在片头或段落之间出现，不要整片铺。
- **排印**：Noto Sans SC 900 大字卡；结尾可用衬线或细体拉情绪。
- **HUD**：`rgba(12,12,12,0.72)` 半透明胶囊 + 珊瑚编号 + 浅字。
- **风格段**：原 11 段色板全部可用（暖金/冰蓝/紫罗兰/霓虹粉是风格段的既成事实）。
- **禁忌**：珊瑚不要当整屏底色（它是强调色，不是 ground）；不要加玻璃/金属材质。

### 02 橙光白 `claude-light`

- **调性**：暖纸底 + 陶土橙，像一页印好的信；安静、可信、有人味。
- **色板**：底 `#f0eee6` / 主字 `#1f1e1d` / 强调 `#d97757` / 纸面 `#fbfaf6` / 暗卡 `#1f1e1d`。
- **材质**：`paper` 纸面柔光；只有极轻的暖晕，**不要**玻璃、金属、光球。
- **排印**：大字卡仍是 Noto Sans SC 900；结尾可用 Playfair Display 斜体。
- **HUD**：深墨胶囊（`rgba(31,30,29,0.9)`）+ 浅粉橙编号 `#f2c7b5` + 米白字。
- **风格段**：推荐替换为陶土橙/赭黄/鼠尾草/灰蓝；高饱和霓虹段要压暗或换成同明度暖色。
- **为什么可以「奶油底+赤陶橙」**：design-taste 把这对组合列为 AI 味重灾区，但 Claude 品牌本身就拥有 `#d97757 + 暖纸`。这里按「品牌自有例外」处理：整段色场（不只做小按钮）、严格排印、零渐变光球、留白充足。**其它主题不得模仿这对组合。**

### 03 水蓝白 · 莫兰迪 `aqua-morandi`

- **调性**：雾面水色；淡绿与淡粉不直接上墙，只从柔光和玻璃高光里透出来。
- **色板**：底 `#f4f8f8` / 主字 `#2f3a3c` / 强调 `#6e9fae` / 纸面 `#fbfcfc` / 暗卡 `#2f3a3c`；点缀 淡绿 `#a8c3a0`、淡粉 `#e6c2c6`、暖沙 `#d9cbb8`、雾蓝 `#a9c9d3`。
- **材质**：`glass` 液态玻璃 · 柔光 —— 背景三团柔光（淡绿/淡粉/雾蓝）+ 极淡虹彩；信息卡用 `drawGlassPanel`（半透明白、1px 高光边、斜向高光）。
- **排印**：字重比原版轻一档（500/700），留白更多；标题可用 Noto Serif SC。
- **HUD**：深青灰胶囊（`rgba(47,58,60,0.88)`）+ 雾蓝编号 `#a9c9d3`。
- **风格段**：推荐 01 扁平 / 04 白板 / 10 3D 用淡绿/淡粉/雾蓝替换主色；赛博/8-bit 段要么跳过，要么整体降饱和后加 6–8% 水蓝染色。
- **禁忌**：淡绿/淡粉不要当大面积底色；不要在暗卡以外的区域用纯白；不要高对比黑字。
- 参考图：`assets/theme-previews/03-aqua-morandi.jpg`。

### 04 琥珀黑金 `amber-noir`

- **调性**：近黑与旧金，片头字幕的质地；安静、贵、不喧哗。
- **色板**：底 `#0c0a08` / 主字 `#ffffff` / 强调 `#c9a45a` / 纸面 `#efe7d8` / 暗卡 `#0c0a08`。
- **材质**：`foil` 金属烫金 —— 一条 -24° 的斜向金 sheen 擦过标题，不铺满。
- **排印**：Playfair Display 大标题 + Noto Sans SC 正文；HUD 用等宽拉出奢侈品目录感。
- **风格段**：推荐用旧金/古铜/橄榄替换暖色段；冷色段降到同一明度。
- **禁忌**：金色不要做成渐变大面积背景（会像廉价年会）；闪白要克制成 `#fff3dd`。

### 05 蓝图纸 `blueprint-stone`

- **调性**：石色纸 + 蓝图钴蓝，工程档案。
- **色板**：底 `#dfdedb` / 主字 `#26251e` / 强调 `#2456d6` / 纸面 `#f3f2ef` / 暗卡 `#26251e`。
- **材质**：`grid` 蓝图网格 —— 80px 细网格（alpha 0.055），每 5 格加粗；没有光晕。
- **排印**：中文粗黑 + 编号/坐标/标注一律 JetBrains Mono。
- **风格段**：推荐 07 数据 / 09 代码 / 01 扁平；主色换成钴蓝/砖红/墨绿/赭石。
- **禁忌**：不要柔光、不要玻璃、不要圆角过大；网格上不要压高饱和渐变。

### 06 石墨信号 `graphite-signal`

- **调性**：石墨灰 + 安全橙，工业硬核；没有光晕，只有结构。
- **色板**：底 `#18191b` / 主字 `#eff0f1` / 强调 `#ff4a1f` / 纸面 `#e9eaeb` / 暗卡 `#18191b`。
- **材质**：`matte` 哑光工业 + 120px 极淡网格；禁止柔光和投影，所有面都是平的。
- **排印**：更紧的字距、更硬的边；参数/编号/单位用等宽。
- **风格段**：推荐 07 数据 / 08 8-bit / 09 代码；主色换安全橙/工业蓝/警示黄。
- **禁忌**：不要圆角胶囊改风格、不要水墨、不要大渐变。

### 07 青瓷白 `celadon-paper`

- **调性**：整片只有一种深青，像瓷器上的釉；留白就是构图。
- **色板**：底 `#f7f9f8` / 主字 `#06525c` / 强调 `#06525c` / 纸面 `#ffffff` / 暗卡 `#06525c`。
- **材质**：`ink` 水墨晕染 —— 同一支青在四角与底边晕开，没有第二个彩色。
- **排印**：标题 Noto Serif SC、正文 Noto Sans SC；字号克制、留白极大。
- **风格段**：全部降为青色系单色（浓/中/淡三段），或只保留 06 水墨 / 04 白板 / 01 扁平三段，其余跳过。
- **禁忌**：不要出现第二个彩色；不要纯黑；不要大字号叠满。

### 08 绯墨剧场 `crimson-theater`

- **调性**：近黑与绯红，舞台聚光；装饰极少，靠一两个大字。
- **色板**：底 `#0a0a0a` / 主字 `#efefef` / 强调 `#b11226` / 纸面 `#efefef` / 暗卡 `#0a0a0a`。
- **材质**：`glow` 舞台聚光 —— 绯红从顶部打下来（alpha 0.3）+ 四周压暗 0.55。
- **排印**：Playfair Display + Noto Sans SC，极致居中、字距拉开、字号敢大。
- **风格段**：推荐 05 赛博 / 06 水墨 / 11 竖屏；主色换绯红/暗酒红/骨白；其他段降到近黑。
- **禁忌**：不要正红堆满屏；不要金色；闪白只做 1–2 帧。

---

## 4. 角色 token 与使用规则

| token | 含义 | 使用位置 | 规则 |
|---|---|---|---|
| `bg` | 页面底色 | 全屏背景 | 必须占画面 70–90% |
| `bgDeep` | 更深一档的底 | 背景渐变末端、暗角 | 和 bg 差 ≤ 8% 明度 |
| `surface` | 面板表面 | 信息板、次级卡片 | 与 bg 靠 tone 区分，不加投影 |
| `ink` | 主字 | 标题、正文 | 对比 bg ≥ 7:1 |
| `muted` | 次要字 | 说明、标签、HUD 小字 | 对比 bg ≥ 4.5:1 |
| `accent` | 强调 | 色块、关键词、编号 | 面积 < 5%，不写长正文 |
| `accentInk` | 强调底上的字 | 强调色底上的文字 | 对比 accent ≥ 4.5:1 |
| `accentSoft` | 浅强调 | 光晕、下划线、编号（浅底时） | 不承载正文 |
| `paper` | 纸面 | layout 1 纸卡底 | 与 bg 区分，不能等于 bg |
| `paperInk` | 纸面字 | 纸卡上的字 | 对比 paper ≥ 7:1 |
| `paperMuted` | 纸面次字 | 纸卡说明 | 对比 paper ≥ 4.5:1 |
| `cardDark` | 暗卡底 | layout 2/3 深色卡 | 浅色主题必须仍是深色 |
| `cardDarkInk` | 暗卡字 | 深色卡上的字 | 对比 cardDark ≥ 7:1 |
| `flash` | 闪白 | 转场闪白 | 深色主题用纯白，浅色主题用更亮的暖白 |

所有值由 `scripts/theme-audit.mjs` 自动校验，`--strict` 可进 CI。当前 8 套全部通过。

```bash
node scripts/theme-audit.mjs            # 全部
node scripts/theme-audit.mjs aqua-morandi --strict
```

---

## 5. 材质系统

| kind | 名称 | 画面特征 | 使用要点 |
|---|---|---|---|
| `grain` | 胶片颗粒 | 底上细噪点 + 径向光晕 | 颗粒静止（逐帧确定性），光晕只做局部 |
| `paper` | 纸面柔光 | 暖纸底 + 极轻暖晕 + 压边 | 不加玻璃/金属/光球 |
| `glass` | 液态玻璃 · 柔光 | 三团莫兰迪柔光 + 虹彩 + 玻璃面板 | 面板用于信息卡，不铺满全屏 |
| `foil` | 金属烫金 | 斜向金 sheen + 旧金强调 | sheen 只擦标题和细线 |
| `grid` | 蓝图网格 | 80px 细网格 + 钴蓝 | 无光晕；标注用等宽 |
| `matte` | 哑光工业 | 平灰面 + 极淡网格 + 安全橙 | 禁止柔光和投影 |
| `ink` | 水墨晕染 | 同一支青在边角晕开 | 不出现第二个彩色 |
| `glow` | 舞台聚光 | 顶部聚光 + 四周压暗 | 装饰极少，靠大字 |

材质统一由 `drawThemeBackground(ctx, theme, W, H, t)` 画出（确定性，只依赖 `t`）：

```js
import { drawThemeBackground } from './themes.js';
drawThemeBackground(ctx, theme, W, H, t);   // 底色渐变 → 材质 → 颗粒
```

玻璃主题额外用 `drawGlassPanel`：

```js
import { drawGlassPanel } from './themes.js';
drawGlassPanel(ctx, theme, { x: 1180, y: 160, w: 600, h: 760, r: 32 });
```

---

## 6. HUD（胶囊 / 倒计时 / 水印）

浅色主题和深色主题的 HUD 必须换画法。用 `chrome(theme)` 取出 opts，直接喂给 `common.js`：

```js
import { chrome } from './themes.js';
const hud = chrome(theme);

drawCapsuleLabel(ctx, 1, '扁平插画', '科普', { ...hud.capsule });
drawCountdown(ctx, u, duration, hud.countdown);
drawStamp(ctx, 'STYLE 01 / 11', hud.stamp);
```

| 主题类型 | 胶囊 | 编号 | 文字 | 倒计时/水印 |
|---|---|---|---|---|
| 深色（coral / amber / graphite / crimson） | 半透明深底 + 浅色亮边 | `accent` 或 `accentSoft` | 浅色 `ink` | `ink` 40–70% 透明度 |
| 浅色（claude / aqua / blueprint / celadon） | 深墨实体胶囊 + 浅内边 | `accentSoft` 或 `accent` 亮色 | 纸白 | `ink` 45–60% 透明度 |

**判断口诀**：胶囊永远「反着页面底色走」；编号永远比文字亮一档。

---

## 7. 大字卡：主题怎么落到 4 个版式上

`cardColors(theme, layout)` 返回 `{ field, bg, ink, sub, keyword, echo, grid, sheen }`，与旧模板的 4 个版式一一对应：

| layout | field | 底色 | 主字 | 关键词/下划线 | 说明 |
|---|---|---|---|---|---|
| 0 | `accent` | `accent` | `accentInk` | `accentInk` | 整张强调色场，冲击力最强 |
| 1 | `paper` | `paper` | `paperInk` | `accent` | 纸面静止卡，留白节奏 |
| 2 | `dark` | `cardDark` | `cardDarkInk` | `accent` | 暗卡居中，关键词上色 |
| 3 | `dark` | `cardDark` | `cardDarkInk` | `accent` | 暗卡左对齐（与 2 同色，构图不同） |

规则：

- **字体不换**：大字卡固定 Noto Sans SC 900 —— 卡是节拍器，换字体就换掉了系统识别。主题的 `type` 只用于片头/结尾/风格段。
- **明暗节奏不换**：浅色主题的 layout 2/3 仍是 `cardDark` 深色卡，整片的明暗交替才成立。
- **sheen / echo / grid** 是主题材质在卡上的残留：浅色主题给一点白色高光，暗色主题给一点低透明度回声字；不要加投影。

```js
import { cardColors } from './themes.js';
const c = cardColors(theme, layout);
// c.bg / c.ink / c.sub / c.keyword / c.echo / c.grid / c.sheen
```

---

## 8. 怎么给用户选主题

| 内容类型 | 推荐 | 备选 | 理由 |
|---|---|---|---|
| 科技发布 / 产品宣传 | 珊瑚暗夜 | 石墨信号 | 原版最稳；硬核科技换石墨 |
| 品牌 / 知识 / 访谈 | 橙光白 | 青瓷白 | 纸面可信、信息密度友好 |
| 美妆 / 生活方式 / 轻科技 | 水蓝白·莫兰迪 | 橙光白 | 柔和、非攻击性、适合人物与产品 |
| 高端 / 奢品 / 年度片 | 琥珀黑金 | 绯墨剧场 | 近黑 + 金属，质感来自留白 |
| 工程 / 建筑 / 数据 / 技术 | 蓝图纸 | 石墨信号 | 网格/等宽自带「图纸」语义 |
| 东方 / 文化 / 极简 | 青瓷白 | 珊瑚暗夜 | 单色青 + 宋体，克制 |
| 时尚 / 艺术 / 预告 / 情绪片 | 绯墨剧场 | 琥珀黑金 | 聚光 + 大字，戏剧张力 |
| 用户没主意 | 珊瑚暗夜（默认） | 橙光白 / 水蓝白 | 原版最安全；暖/冷各给一个 |

展示时先给三张主推对比图（`theme-three-up.jpg`：原版 / 橙光白 / 水蓝白），再给全集联系表（`theme-contact-sheet.jpg`），最后按需给单主题大图。选择用 `references/intake.md` 的流程锁定。

---

## 9. 覆盖主色（用户有品牌色时）

允许用户只换「强调色」，不要鼓励自创第 9 套主题。`themes.js` 提供 `accentOverride(themeRef, input)`，返回新主题对象（不污染 `THEMES`），自动处理 accentInk 对比度、accentSoft 与材质光晕：

```js
import { accentOverride, auditTheme } from './themes.js';

const theme = accentOverride('coral-noir', '#00a3a3');   // 字符串 = 只换 accent
// 或显式指定其它槽位
const theme2 = accentOverride('claude-light', { accent: '#2f7d6d', accentSoft: '#bcded6' });

const rows = auditTheme(theme);                          // 覆盖后仍需审计通过
```

`accentOverride` 的行为：

- `accentInk` 未给时，自动在主题 `ink` / `paper` / `bg`、纯白、近黑中挑与 `accent` 对比度 ≥ 4.5 的那个；
- `accentSoft` 未给时 = `mix(accent, paper, 0.45)`；
- `material.glow.color` 同步跟随新 accent（grain / glow 主题的光晕不会留在旧色）；
- HUD 编号：深色主题用 `accent`，浅色主题用 `accentSoft`；
- 返回值带 `override: { accent, accentInk, accentSoft }`，原样写进 `brief.json` 的 `theme.accentOverride` 即可复现。

规则：

- 只改 `accent / accentInk / accentSoft / hud.capsuleNumber` 四个值；
- 改完必须跑 `contrastRatio` 校验（accentInk vs accent ≥ 4.5）；
- 覆盖值写进 `brief.json` 的 `theme.accentOverride`，并在项目 README 记一行，方便复现；
- 浅色主题（claude/aqua/blueprint/celadon）不要换成深色重色，会把整片拉脏。

---

## 10. 与 design-taste-frontend 的对齐

本机 skill `design-taste-frontend` 的 `references/colour.md` 给了几条硬规则，这里逐条落地：

- **角色 token**：`--bg/--surface/--ink/--muted/--accent/--accent-ink` 与本文件的 14 个 token 同构，DOM 模板可用 `cssVars(theme)` / `applyTheme(theme)` 直接写 CSS 变量。
- **面积比例**：ground 70–90%，accent < 5%。本系统里唯一「accent 大面积」的情况是大字卡 layout 0（整卡即色场）—— 这是卡片作为节拍器的功能需要，且卡上文字用 `accentInk` 另行校验。
- **不靠 1px 线和投影分层**：Canvas 里靠色块与 tone；HUD 胶囊的 1.5px 半透明亮边属于「系统元件」例外。
- **深色页 muted 必须 ≥ 4.5:1**：已由审计脚本强制。
- **禁止「奶油底 + 赤陶橙」**：仅橙光白主题例外（Claude 品牌自有色，见 §3-02）；其它主题禁止复刻。
- **禁止 violet / indigo**：新主题不引入紫；珊瑚暗夜 `accents` 里的紫罗兰 `#a58bff` 是原版赛博/数据风格段的既成事实，只作为风格段点缀保留，不作为主题主色。
- **浅色主题也必须有明暗节奏**：所以每个浅色主题都有 `cardDark`，大字卡 layout 2/3 和结尾落版靠它压住。

---

## 11. 主题 QA 清单

- [ ] `node scripts/theme-audit.mjs --strict` 全绿；
- [ ] 抽 4 张：默认、橙光白、水蓝白、青瓷白，确认「不传 theme」与旧版逐像素一致（PSNR 对比）；
- [ ] 浅色主题里没有半透明黑胶囊直怼浅底；
- [ ] 大字卡 4 版式在所选主题里明暗交替成立（2/3 仍是深卡）；
- [ ] 水蓝白：玻璃面板可见、淡绿/淡粉只从光里出来、没有脏灰；
- [ ] 青瓷白：画面里没有第二个彩色；
- [ ] 石墨/蓝图纸：没有柔光或投影；
- [ ] 橙光白：没有渐变光球、没有小圆角按钮式强调；
- [ ] 风格段没有被主题带成同一色（保留各段识别度）；
- [ ] 结尾 CTA 与主题对比度 ≥ 4.5。

---

## 12. 新增第 9 套主题

1. 在 `templates/themes.js` 的 `THEMES` 里加一个条目：14 个角色 token、`hud`、`material`（选一种主材质）、4 个 `accents`、`type`、`tagline/useFor/aliases`。
2. `node scripts/theme-audit.mjs <id>` 调到全绿（必要时加深 muted / 换 accentInk）。
3. `node scripts/theme-preview.mjs --root <project> --themes <id>` 出图，用 `read_image` 检查，不合格就改。
4. 更新本文 §2 速查表、§3 详述、§8 推荐矩阵，以及 `assets/theme-previews/` 里的预览资产。
5. 更新 `SKILL.md` 的主题数量与预览图引用。

> 不要为「临时一个片子」新增主题；先看能不能用现有主题 + `accentOverride` 解决。

---

## 13. 相关文件

| 文件 | 作用 |
|---|---|
| `templates/themes.js` | 主题数据 + 全部 API（唯一数据源） |
| `templates/theme-board.html` | 单主题预览板（?theme=<id>，1920×1080） |
| `scripts/theme-preview.mjs` | 批量渲染 8 套预览 + 联系表 + 三拼对比图 |
| `scripts/theme-audit.mjs` | 对比度审计（`--strict` 可进 CI） |
| `assets/theme-previews/` | 交付给用户的预览图（01–08、联系表、三拼） |
| `references/intake.md` | 调用前先收信息、锁定主题的流程 |
| `references/big-card-and-typography.md` | 大字卡排印（含主题化说明） |
| `references/style-recipes.md` | 11 种风格配方（含主题换色规则） |
