---
name: code-video-showcase
description: |
  用纯代码（HTML/Canvas/SVG/Three.js 逐帧渲染 + Python numpy/scipy 合成配乐 + FFmpeg 合成）制作 30–90 秒卡点风格展示视频的完整技能。
  适用于：复刻/仿制《Opus 5.5 视频风格展示》、DeepSeek V4.1-Flash 61s 风格样片、多风格切换卡点视频、纯代码视频、程序化视频、
  HTML/Canvas/Three.js 视频、逐帧渲染 + 节拍同步、风格展示短片；要求不使用任何视频/图像/音乐生成模型。
  包含：调用前置需求采集与主题选择、13 套主题配色 × 8 种材质（OKLCH 派生 + APCA 审计）、时间轴 JSON/plan、并行渲染农场、11 种风格配方、大字卡系统、120BPM 配乐合成、零依赖 CDP/Playwright 渲染管线、视频/音频自动质检、可选 AI 素材 lane。
  当用户提到「卡点视频」「风格展示视频」「纯代码做视频」「类似 Opus 5.5 / DeepSeek 风格展示」「逐帧渲染」「用代码做视频」
  「HTML Canvas 视频」「程序化视频」「主题配色」「换配色」「配色主题」「时间轴」「并行渲染」「视频质检」时必须触发。
license: MIT
metadata:
  domain: video-production
  reference: Opus 5.5 / DeepSeek V4.1-Flash 61s style showcase
compatibility: Node 20+ (raw-CDP path needs Node 22+ for global WebSocket) / Chrome, Edge or Chromium (Playwright optional) / FFmpeg (libx264+AAC, libvmaf optional) / Python 3.10+ (numpy, scipy; matplotlib optional). Works on Windows and WSL/Linux. No external video, image or music generation models by default; fonts must be open-source and served locally.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# 纯代码卡点视频导演技能

> 目标：不调用任何视频/图像/音乐生成模型，用**代码**逐帧画出画面、用 **numpy/scipy** 合成配乐，最后 FFmpeg 合成 MP4。
> 参考样片：61.0s / 1920×1080 / 30fps / 1830 帧 / 120 BPM / H.264+AAC，见 `assets/contact-1fps.jpg` 与 `references/reference-film-analysis.md`。

## 0.5 编译器入口（v2.1，新项目优先）

新项目不再从 timeline.json 起步，而是从 `project.spec.json`（IR）起步：

```bash
node scripts/spec-lint.mjs --spec project.spec.json --root .   # 页面/主题/APCA/结构
node templates/plan.mjs  --spec project.spec.json --root . --print
node scripts/compile.mjs --spec project.spec.json --root . --concurrency 4
```

- **spec 是唯一真相**：文字、画风、主题、时长、剧本都改 spec；不要手改 `plan.json` 或段 mp4。
- **增量**：每段带 `segmentHash`；`render-farm` 先查 `<outDir>/.cache/<hash>.mp4`。改一段只重渲一段。
- **统一入口**：`node bin/cvs.mjs <new|ref|lint|plan|build|variant|ingest|wizard|canvas|script|versions|test>`。
- **参考图**：`node bin/cvs.mjs ref poster.jpg --spec project.spec.json --out project.spec.json`（只提取色板/强调色/密度与 top-3 主题候选，不复制像素）。Wizard 也支持直接拖入参考图；结果写 `meta.reference`。
- **界面**：`app/wizard/`（5181，8 预设 + 七张卡）、`app/canvas/`（5182，圈选改参数）、`app/script/`（5183，剧本表）、`app/versions/`（5184，版本树）。
- **旧项目**：timeline v1 仍完全可用，`spec.mjs` 可自动迁移。
- **多画幅**：页面按视口自适应（横 / 竖 / 方真重排，不是裁切）；`render-segment --width 1080 --height 1920`。16:9 输出位级不变。
- **渲染**：`render-farm` 默认 batch 模式——一个 worker 一个浏览器跑一个 shard，段缓存语义不变；`--legacy` 回退逐段进程。
- **服务**：`server/api.mjs`（5190，`POST /jobs` → 编译 → `master.mp4`）、`app/review/`（5185，播放 + 帧级评论）。
- **质量闸门**：`npm run test:all`（纯 Node）、`npm run test:browser`（画布/参考图/竖屏/配方）、`npm run golden`（9 张静帧位级回归）、`npm run brand -- check …`。
- **配方 13–16**：kinetic-type / data-race / ink-wash / 8bit（`templates/recipe-*.html`）。
- **实拍素材**：`node ingest/cli.mjs --input <file|dir> --target 60 --out out/ingest` 产出 EDL + spec 草稿；选段质量是启发式，需人工审。
- **禁止**：让 LLM 直接生成 HTML/CSS/JS，或绕过 spec 直接改像素。模型只填枚举与文案。

## 0. 适用与不适用

**适用**
- 30–90 秒内快速切换多种美术风格的「风格展示 / 能力展示 / 产品宣传」短片；
- 强节拍（120 BPM）、大字卡 + 风格段交替、结尾升华的卡点结构；
- 同一套内容需要不同品牌气质（13 套主题：珊瑚暗夜 / 橙光白 / 水蓝白·莫兰迪 / 琥珀黑金 / 蓝图纸 / 石墨信号 / 青瓷白 / 绯墨剧场 / 赛博霓虹 / 纸质手账 / 暗金电影 / 冰蓝极简 / 波普酸色）；
- 用户明确要求纯代码、可复现、逐帧确定性渲染（同一 t 必出同一帧）。

**不适用**
- 需要写实镜头、真人、复杂叙事的长视频；
- 需要调用文生视频/文生图/文生音乐模型的场景（本技能明确禁止）。

---

## 1. 交付物与硬约束

| 项目 | 默认值 |
|---|---|
| 画幅/帧率 | 1920×1080，30 fps |
| 时长 | 61.0 s = 1830 帧（可按公式改） |
| 音频 | 48 kHz 立体声 AAC 192–320 kbps，EBU R128 −14 LUFS |
| 视频 | H.264 High，yuv420p，bt709，CRF 21（母版）/22–24（平台），maxrate 限峰，+faststart |
| 节拍 | 120 BPM：1 拍 = 0.5 s，1 小节 = 2 s |
| 主题配色 | 13 选 1，默认 `coral-noir`（原版：珊瑚 `#d97757` + 深底 `#0e0e0d`）；OKLCH token + APCA 审计，见 §5、`references/themes.md` |
| 字体 | 全部 OFL：Noto Sans/Serif CJK SC、Ma Shan Zheng、Long Cang、ZCOOL KuaiLe、ZCOOL QingKe HuangYou、Press Start 2P、JetBrains Mono、Inter、Orbitron、Playfair Display |
| 字幕 | 不要底部字幕；信息都做成画面内的胶囊/HUD/注释 |
| 确定性 | 画面是 `t` 的纯函数，禁止 CSS transition/animation、rAF、Date.now、Math.random |

**每个片段必须满足**（渲染契约，Playwright 与零依赖 CDP 共用）：

```js
window.DURATION = 3.0;                 // 片段时长（秒）
window.renderFrame = (t) => { /* 只依赖 t 和常量；禁止时间/随机副作用 */ };
window.__ready = false;                // 字体等资源就绪后置 true
window.__bootError = null;             // 初始化失败时写入错误字符串（渲染器立即报错）
window.__capture = 'canvas';           // 可选：强制 canvas.toDataURL 或 'cdp' 截图
```

> 单 canvas 全屏页面默认走 `canvas.toDataURL()` 取帧（快 30–50%）；有 DOM 叠加层时自动回退 `Page.captureScreenshot`。WebGL 页面必须 `preserveDrawingBuffer: true`，否则请设 `window.__capture='cdp'`。

---

## 2. 十阶段工作流

1. **需求采集 + 主题锁定**（先做，不要先写代码）：先读 `references/intake.md`；默认按 61s / 横屏 1920×1080 / 11 段 / 珊瑚暗夜 / 120BPM 电子起一版，**最多 2 轮**收齐信息——必问 4 项（题材、渠道/画幅、品牌名 `{{BRAND}}`、结尾 CTA），时长/风格数 N/主题/配乐给默认或按用户主动提调整。把主题预览图发给用户选（`theme-three-up.jpg` → `theme-contact-sheet.jpg` → 单主题图；13 套可选，先给 2–3 套短名单），锁定主题 id 后把全部答案写成项目根 `brief.json`（模板见 intake.md），后续所有页面用 `?theme=<id>` 透传。主题未锁定前不渲染成片。
2. **写时间轴 JSON**：按第 3 节公式填 `timeline.json`（`references/timeline-schema.md`），运行 `node templates/timeline.mjs --spec timeline.json --out out/plan.json --concat out/segments.txt --print`。后面渲染、合成、音频对齐、QA 全部读 `plan.json`；**不要**在别的脚本里重算时长/帧数。
3. **环境准备**：`node scripts/doctor.mjs` 一次检查 Node/Chrome/FFmpeg/numpy+scipy/字体。Playwright 不是必需：没有时自动走系统 Chrome/Edge 的原生 CDP 通道。
4. **工程骨架**：直接 `node scripts/new-project.mjs --out ../my-film --theme <id> --styles 11`（复制 `common.js / motion.js / color.js / themes.js`、`segment.html / big-card.html`、渲染/合成/QA 脚本、可渲染的 `segments/*.html` 与 `timeline.json`）。
5. **逐段实现（外循环 N 次）**：先写场景 → 渲染 5–6 张静帧拼接触表检查构图与字体 → 再整段渲染 → `ffprobe` 核帧数；或直接 `render-farm --only <id>` 单段重渲。
6. **开场**：逐字打字 + 代码列上滚 + 粒子爆炸 + 闪白，8 s。
7. **大字卡**：4 套版式轮换，2 拍/张；砸入、速度线、回声字、`STYLE 0X / 11`。
8. **八连闪 + 结尾**（可选）：8×0.25 s 的微海报，接着 6 s 电影感收尾。
9. **配乐合成**：120 BPM、A 小调、与剪辑表共用同一组时间常数；生成 WAV 后先检查频谱图与卡点对齐，再做「高频克制」听感自检（§8）。
10. **合成与质检**：`render-farm`（并行/重试/断点续渲）→ `concat-and-encode.sh --platform <平台>`（CRF/bt709/loudnorm）→ `qa-video.mjs` + `qa-audio.py`（帧数/黑帧/冻结/静音/VMAF/LUFS/节拍对齐）→ 接触表 + 频谱图 + 人工看片；输出 `成片 + 封面帧 + 参数说明`。

**每段闭环（必须）**：
```
设计 -> 写 HTML -> 渲染静帧(t=0.2/0.8/1.4/2.0/2.6) -> 拼接触表检查 -> 整段渲染
     -> plan.frames 对账 -> 写回 render-manifest -> 下一段
```
不要一次写完 N 段再统一渲染；先跑通 1 段样板再复制，错误成本最低。

---

## 3. 时间结构（通用公式）

设风格数 `N`，每轮 `R = 4s`（大字卡 1s = 2 拍，风格展示 3s = 6 拍）：

```
0 ── opening (O=8s) ── 8 ── 11 轮 ×4s = 44s ── 52 ── 大字卡 "还有更多?" (1s) ── 53
   ── 八连闪 (2s，8×0.25s) ── 55 ── 结尾 (E=6s) ── 61
```

- 总时长 = `O + N*R + 1 + 2 + E`（本片 8+44+1+2+6 = 61 s）。
- 展示段第一帧就是「啪」的卡点：style 段 `t0` 通常是 0–0.9 之间的场景内偏移，用 `t = t0 + u*speed` 把 3 s 的片段加速到 6 拍内。
- 帧数校验：v2 由 `timeline.mjs` 按帧边界吸附（`startFrame=round(t*fps)`），所以 0.25 s 的闪段在 30 fps 下是 8/7/8/7… 帧；全片合计必须等于 `plan.stats.frames`（默认 1830）。不要手写 `round(duration*30)`。
- 参考样片实测：镜头切点 60 个；每轮切点 = `8+4k`（大字卡）、`9+4k`（风格段），其中风格段开头 9.0/9.033/9.067/9.1 有连续微切（卡点冲击/故障效果）。

**61s 参考剪辑表**（品牌词替换成 `{{BRAND}}` 即可复用；t0/speed 来自原任务书，也是样片验证过的值）：

| 轮 | 大字卡（行1 / 关键词+后缀 / 强调色） | 风格 | t0 | speed |
|---|---|---|---|---|
| 1 | 想做 / 科普视频？ / #ffcf5c | 扁平插画科普 | 0.35 | 1.4 |
| 2 | 想做 / 知识讲解？ / #58c4dd | 数学动画 | 0.5 | 1.45 |
| 3 | 想开 / 产品发布会？ / #a58bff | 极简发布会 | 0 | 1.0 |
| 4 | 想做 / 培训课件？ / #e0674b | 手绘白板 | 0.3 | 1.4 |
| 5 | 想做 / 炫酷预告片？ / #ff2bd6 | 赛博故障 | 0.8 | 1.3 |
| 6 | 想拍 / 国风短片？ / #e0513a | 水墨国风 | 0.5 | 1.35 |
| 7 | 想做 / 数据新闻？ / #ff5a4a | 数据可视化 | 0.4 | 1.4 |
| 8 | 想做 / 游戏视频？ / #ffd84a | 8-bit 像素 | 0.9 | 1.25 |
| 9 | 想录 / 编程教程？ / #c792ea | 代码录屏 | 0.4 | 1.4 |
| 10 | 想要 / 3D质感？ / #ff8a5c | Three.js 三维 | 0.3 | 1.3 |
| 11 | 想做 / 竖屏短视频？ / #ff5f9e | 竖屏短视频 | 0.3 | 1.45 |

---

## 4. 画面契约与公共库

`templates/common.js` 提供（直接复制进项目），并已重新导出 `motion.js` / `color.js` 的 v2 API：

- 缓动：`ease.outQuad/ease.outCubic/ease.outExpo/ease.outBack/ease.inOutCubic` 等；
- 种子随机：`mulberry32(seed)`；禁止 `Math.random`；
- value noise + fbm；
- 片段模式：解析 `?seg=1&t0=&speed=&dur=`，映射 `t = t0 + u*speed`；
- 标准角标：`drawCapsuleLabel`（左上胶囊）、`drawCountdown`（右下 3 秒倒计时）、`drawStamp`（品牌水印）；
- 卡点冲击（`u∈[0,0.4]`）：
  - 白闪 `0.85→0`，0.12 s；
  - 整体缩放 `1.13→1`，0.32 s，`outCubic`；
  - 抖动 14 px 衰减，0.16 s；
  - 之后整段缓慢推镜 `1→1.05`。
- 禁止每个 HTML 自己调用 `requestAnimationFrame`；渲染器负责每帧调用 `renderFrame(t)`。

**v2 新增**（`templates/motion.js` / `templates/color.js`，签名与配方见 `references/motion-and-color.md`）：

- `spring({stiffness,damping,mass,v0})`：闭式解弹簧，`t` 秒 → 0..1（可过冲）；
- `stagger(n,{lagRatio})`、`track([[t,v,ease],…])`、`rateFunc('smooth'|'rushFrom'|…)`、`transitionParams('slam'|'whip'|'glitch'|'fade',p)`；
- `splitGraphemes()`、`layoutCJK(ctx,text,w)`（避头尾）、`fitText()`、`drawKineticText()`（rise/clip/wipe/blur/scale）；
- `drawGrain/drawPaperTexture/drawScanlines/drawRGBSplit/drawBloom/drawHalation`；
- `toOklch/toHex/mixOklch/gamut/derivePalette/apcaLc/contrastRatio/readableInk`。

2D 片段的推荐骨架：

```js
const seg = createSegment();          // 读取 URL 参数 + DURATION
window.DURATION = seg.duration;
window.renderFrame = (u) => {
  const { t, fx } = seg.sample(u);    // t = t0 + u*speed；fx = { scale, shakeX, shakeY, flash, push }
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,W,H);
  ctx.save();
  applyImpact2D(ctx, fx);             // 缩放/抖动/缓慢推镜
  drawScene(ctx, t, u);               // 只依赖 t/u
  ctx.restore();
  drawFlash(ctx, fx.flash);           // 白闪盖在最上层
};
```

Three.js 片段：`renderer` 必须 `{ preserveDrawingBuffer: true }`；启动参数
`--use-angle=swiftshader --enable-webgl --ignore-gpu-blocklist --enable-unsafe-swiftshader`。
镜头动画写 `camera.position`，不要依赖 `Date.now`。

---

## 5. 主题系统（13 套配色 × 8 种材质 + OKLCH/APCA）

主题不是换三个颜色，而是**角色色板 + 材质 + HUD 规格 + 点缀色**四层一起换。数据唯一来源 `templates/themes.js`，完整规范（材质画法、token 阈值、推荐矩阵、加主题步骤）见 `references/themes.md`。

| # | id | 名称 | 明暗 | 主材质 | 一句话 |
|---|---|---|---|---|---|
| 01 | `coral-noir` | 珊瑚暗夜 | dark | 胶片颗粒 | 默认，原版逐值一致 |
| 02 | `claude-light` | 橙光白 | light | 纸面柔光 | 暖纸 + 陶土橙，品牌/知识 |
| 03 | `aqua-morandi` | 水蓝白 · 莫兰迪 | light | 液态玻璃 · 柔光 | 雾面水色 + 淡绿/淡粉，品牌/生活方式 |
| 04 | `amber-noir` | 琥珀黑金 | dark | 金属烫金 | 近黑 + 旧金，高端/电影感 |
| 05 | `blueprint-stone` | 蓝图纸 | light | 蓝图网格 | 石色纸 + 钴蓝，工程/数据 |
| 06 | `graphite-signal` | 石墨信号 | dark | 哑光工业 | 石墨灰 + 安全橙，开发者/硬件 |
| 07 | `celadon-paper` | 青瓷白 | light | 水墨晕染 | 单色青 + 宋体，东方/文化 |
| 08 | `crimson-theater` | 绯墨剧场 | dark | 舞台聚光 | 近黑 + 绯红，时尚/艺术 |
| 09 | `cyber-neon` | 赛博霓虹 | dark | 霓虹辉光 + 网格 | 近黑 + 电光青，科技/游戏/预告 |
| 10 | `paper-journal` | 纸质手账 | light | 纸面 + 细网格 | 米白 + 赭红，知识/教程/生活 |
| 11 | `dark-gold-cinema` | 暗金电影 | dark | 烫金 + 颗粒 | 近黑 + 旧金，高端/电影感 |
| 12 | `ice-minimal` | 冰蓝极简 | light | 冷白哑光 | 冷白 + 钴蓝，SaaS/数据/医疗 |
| 13 | `pop-acid` | 波普酸色 | dark | 光斑 + 颗粒 | 近黑 + 酸性黄绿，潮流/音乐/社交 |

默认 `coral-noir` 与旧版逐值一致：**不传 `theme` 时老项目行为完全不变**。模板按 URL 选主题，也接受中英文别名：

```text
/segments/01.html?theme=aqua-morandi
/segments/big-card.html?theme=水蓝白&layout=1      # 别名同样有效
```

```js
// 页面里读取主题（big-card.html / segment.html 已内置）
const theme = themeFromURL(location.search);        // ?theme=xxx / ?t=xxx → 主题对象
drawThemeBackground(ctx, theme, W, H, t);           // 底色 + 材质 + 颗粒（确定性）
const hud = chrome(theme);                          // 胶囊/倒计时/水印配色
drawCapsuleLabel(ctx, seg.index, name, category, hud.capsule);
const c = cardColors(theme, layout);                // 大字卡 4 版式：{ field, bg, ink, sub, keyword, echo, grid, sheen }
drawGlassPanel(ctx, theme, { x, y, w, h });         // 仅 glass 主题的信息面板
```

**铁律**

- 浅色主题的胶囊/倒计时/水印必须用 `chrome(theme)`（深墨实体胶囊 + 浅字）；照搬原版半透明黑胶囊会在纸上变成脏补丁。
- 每套主题（含浅色）都有 `cardDark`：大字卡 layout 2/3 仍是深色卡，整片才有明暗节奏。
- 大字卡字体固定 Noto Sans SC 900（卡是节拍器）；主题 `type` 的字体只用于片头/结尾/风格段。
- 风格段主色按主题 `accents` 替换；青瓷白保持单色青，橙光白禁止渐变光球，水蓝白柔光/玻璃是主角但只做局部。
- 用户只给品牌色时，用 `accentOverride` 改 4 个值并校验对比度，不要自创第 14 套主题（见 `references/themes.md` §9）。
- 改完主题必须 `node scripts/theme-audit.mjs --strict` 全绿（当前 13 套 WCAG 全通过；APCA 只对暗底 muted 给提醒）。
- 新增主题优先用 `derivePalette({mode, accent})`（`templates/color.js`）生成 14 角色，再按材质微调；不要手调十几个 hex。
- 暗底细字用 APCA 判断：正文 ≥60 Lc、小字 ≥75、大字 ≥45；WCAG 只作兼容兜底。细则见 `references/motion-and-color.md`。

调性与禁忌、按内容类型选主题的矩阵见 `references/themes.md`；预览图在 `assets/theme-previews/`（单主题 8 张 + 联系表 + 三拼对比）。

---

## 6. 大字卡系统（1 s / 2 拍）

4 套版式轮换（样片实测顺序：强调色底 → 米白底 → 黑底 → 黑底；也可按任务书 `i%4` 自定义）：

> 下表颜色是默认主题 `coral-noir` 的实际值；换主题后底/字/关键词来自 `cardColors(theme, layout)`，版式结构不变（见 §5）。

| 版式 | 底 | 字 | 关键词 |
|---|---|---|---|
| A 强调色底 | 卡片的强调色 | 黑 | 黑色下划线 |
| B 米白底 | `#f4efe6` | 黑 | 强调色下划线，文字遮罩上推 |
| C 黑底 | `#0e0e0d` | 白 | 强调色字 |
| D 黑底 | `#0e0e0d` | 白 | 强调色字（换排版/位置） |

- 第 1 拍 `t=0`：第一行 150 px 砸入；第 2 拍 `t=0.5`：关键词+后缀 280 px（Noto Sans Black）砸入。150/280 是任务书理论值；样片实测偏海报比例（约 70/170 px），模板用 76/190 px 并按宽度自动缩放，以「最多 8 个汉字放得下」为准，详见 `references/big-card-and-typography.md` 第 4 节。
- **砸入**：缩放 `1.7→1`、模糊 `16→0`，时长 0.11 s，`outExpo`；伴随强调色速度线 + 径向光晕 + 画面抖动 6 px / 12 px。
- 背景：600 px 描边回声大字横向漂移；右下角 `STYLE 0X / 11`；样片还有细线网格/流线背景。
- 卡片期间配乐 drop-out（音乐压到 6%），只保留 2 拍打击；卡片结束接风格段「啪」。
- 细节与观测偏差见 `references/big-card-and-typography.md`。

---

## 7. 风格展示配方（每段 3 s / 6 拍）

11 种风格是「视觉美术 + 技术实现 + 音色」三件套，完整参数见 **`references/style-recipes.md`**。
速查：

| # | 风格 | 核心手法 | 关键元素 | 专属音色 |
|---|---|---|---|---|
| 01 | 扁平插画科普 | Canvas 2D 分层圆/三角/虚线轨道 | 太阳、地球、光束、标签胶囊 | 马林巴 |
| 02 | 数学动画 | Canvas + 傅里叶（DFT 本轮） | 金色心形、KaTeX 公式、N/θ | FM 电钢琶音 + 铺底 |
| 03 | 极简发布会 | Canvas 大字 + Three.js LatheGeometry | 金属戒指、LED 环、Nova Ring | 逐拍重低音 + 钟声 |
| 04 | 手绘白板 | SVG stroke-dashoffset + turbulence | 灯泡→代码→视频、红圈 | 尤克里里 + 笔摩擦 |
| 05 | 赛博故障 | Canvas 渐变/透视网格 + RGB 分离 | 条纹落日、城市、故障切片 | 失真锯齿 16 分 + 四拍底鼓 |
| 06 | 水墨国风 | Canvas fbm 山峦 + 宣纸纹理 | 三远山、红日、渔舟、竖排书法 | 古筝五声 + 太鼓 + 笛 |
| 07 | 数据可视化 | Canvas 条形赛跑 + CSS3D 透视 | 条图、年份、玻璃卡 | 方波琶音 + 滴答 |
| 08 | 8-bit 像素 | 240×135 低分辨率 + pixelated | 机器人、金币、史莱姆、HUD | 芯片音乐 + 跳跃/金币 |
| 09 | 代码录屏 | Canvas 编辑器 + 逐字代码 | 文件树、行号、实时预览 | lo-fi 电钢 + 黑胶噪声 |
| 10 | Three.js 三维 | Lathe/TorusKnot + PhysicalMaterial | 粘土影棚、玻璃球、金属球 | 钟声琶音 + 弹跳 |
| 11 | 竖屏短视频 | Canvas 手机壳 + 弹出动画 | 9:16、步骤卡、评论/点赞 | 808 + 超级锯齿 + trap 镲 |

**每段必须有的视觉锚点**：左上胶囊标签（主题化编号，默认主题为珊瑚 + 风格名）、右下 3 秒倒计时/帧计数、1–2 个风格内小标签、标题或主视觉在 6 拍内完成一次完整叙事。不要底部字幕。

---

## 8. 配乐合成（120 BPM，A 小调，纯 numpy/scipy）

- 音色：kick（正弦扫频）、snare、clap、hat、crash、sub boom、噪声 riser、反向镲、whoosh、拨弦、FM 电钢、FM 钟声、超级锯齿、808、方波/三角波、笛子；
- 和弦（每段前 4 拍 / 后 2 拍）：Am/F、C/G、F/G、C/F、Am/G、Am/Em、Dm/E、C/G、Dm/G、F/G、Am/F；
- 结构：开场铺底 + 逐字键盘咔哒 → 4.55 s sub boom + 底鼓渐强 → 5.5 s 8 分踩镲 → 6.5–7.95 s 军鼓滚奏 → 7.45 s 反向镲；
- 大字卡：第 1 拍 kick+tom，第 2 拍 kick+clap+sub+whoosh，后半反向镲；音乐压到 6%；
- 风格段：6 拍律动 + 专属乐器；第一帧 kick+clap+snare+crash+sub+高频爆裂；
- 混音：kick 包络侧链（闪避 55%）、2.2 s 合成混响、tanh 软削波、归一化 -0.6 dBFS；
- **高频克制（必读）**：金属感音色（FM 钟声、拨弦、亮 saw stab、coin 音、高八度琶音）只作关键节点点缀，**全片 2–3 处**（标题揭示 / 结尾 impact / 唯一一次 resolve）；统计与数字段用 sub+tom+kick+clap 的鼓点，不用铃音代替鼓点，更不要整段高音琶音铺底；
- **高频自检**：切掉 <200 Hz 只听高频，若只剩「叮叮叮」= 点缀过量；8–16 kHz 在非点缀段应比关键点缀段低 ≥ 6 dB。细则与检测代码见 `references/audio-recipes.md` 第 7 节；
- **实测参考**：样片 120.0 BPM、相位 0.0 s、86.3% 强 onset 落在 120 BPM 网格 ±30 ms 内；8/12/16… s 的大字卡起拍能量是前 300 ms 的 8–9 倍，9/13/17… s 的风格段起拍是 2.8–3.5 倍。

公式、编排表与混音函数见 **`references/audio-recipes.md`**。可运行骨架 `templates/synth_audio.py`：不带参数输出 8 s demo；带 `--plan out/plan.json` 时输出全片长度，并把每个 `audio.cues` 落成鼓点（61 s 实测 cue 命中 100% ±30 ms、BPM 120.01）。

---

## 9. 渲染管线（v2）

1. **计划**：`node templates/timeline.mjs --spec timeline.json --out out/plan.json --concat out/segments.txt`。plan 是唯一真源（帧边界/页面参数/输出路径/cue）。
2. **单段**：`templates/render-segment.mjs` 内置同源静态服务器 → 启动无头浏览器 → 等 `document.fonts.ready` + `window.__ready` → 逐帧 `renderFrame(t)` → 取帧 → stdin 管道给 ffmpeg。
   - 浏览器：Playwright（若安装）或**系统 Chrome/Edge 的原生 CDP**（`templates/cdp.mjs`，零 npm 依赖）。
   - 取帧：单 canvas 全屏页面用 `canvas.toDataURL()`（快 30–50%）；DOM 叠加/WebGL 读回失败自动回退 `Page.captureScreenshot({optimizeForSpeed:true})`。
   - 编码：`-crf 12 -preset veryfast` 中间片、`yuv420p`、`scale=in_range=pc:out_range=tv:out_color_matrix=bt709`、bt709 四元标签、`-video_track_timescale 90000`。
3. **并行**：`node templates/render-farm.mjs --plan out/plan.json --concurrency 4 --resume`。每段一个进程/浏览器；`--resume` 用 ffprobe 帧数对账；失败重试并写 `out/render-manifest.json`。
4. **合成**：`templates/concat-and-encode.sh [--platform master|youtube|bilibili|douyin|xiaohongshu|weixin|archive]`。先 `-c copy` concat（失败自动归一化重编），再一次 CRF 终编 + 两遍 `loudnorm`（−14 LUFS / −1 dBTP）+ bt709 + faststart。预设见 `references/platform-presets.md`。
5. **质检**：`scripts/qa-video.mjs`（帧数/色彩/黑帧/冻结/静音/LUFS/VMAF/接触表）与 `scripts/qa-audio.py`（BPM/拍网格/cue ±30 ms/削波/高频克制/频谱图）。见 `references/qa.md`。

**性能要点**
- 取帧与编码流水线化：帧直接进 ffmpeg stdin，不落盘；单段进程关闭时调用 `server.closeAllConnections()`，避免 5 s keep-alive 拖尾。
- 并行上限约为物理核数；每个进程一个浏览器实例，避免共享 GPU 上下文。
- WSL 下只把 ffmpeg 放 Linux 侧，取帧留 Windows 侧可避开 `/mnt/c` 往返；Chrome for Testing 路径可用 `--browser`/`CHROME_EXE` 指定。
- Three.js 必须 `preserveDrawingBuffer:true`、`setPixelRatio(1)`、`renderer.compile()`、关闭自动动画循环；Canvas 2D 不要每帧 `ctx.filter=blur()`。

详见 **`references/render-pipeline.md`**；可运行模板在 `templates/`。

---

## 10. 质检清单（自动 + 人工）

**一条命令**
```bash
node scripts/qa-video.mjs out/final.mp4 --plan out/plan.json
python scripts/qa-audio.py audio/mix.wav --plan out/plan.json --strict
node scripts/theme-audit.mjs --strict
node scripts/determinism-check.mjs --page "segments/01.html?theme=coral-noir" --t 0.5
```
`qa-video.mjs` 硬失败：pix_fmt/尺寸/帧数/VMAF（给了 `--ref` 时）。其余为 WARN，`--strict` 升级为失败。
阈值表与 JSON 结构见 `references/qa.md`。

**自动覆盖**
- [ ] 帧数 = `plan.stats.frames`（默认 1830）；尺寸/fps/色彩标记 `bt709/bt709/bt709/tv`；
- [ ] 黑帧 ≤ max(0.5 s, 1%)；卡片/闪白窗口外无 >1 s 冻结；片中无 >1 s 静音；
- [ ] −14 ±1 LUFS、true peak ≤ −1 dBTP、LRA ≤ 14；
- [ ] cue 对齐 ≥80% 在 ±30 ms；BPM 误差 ≤2；onset 网格命中 ≥70%；
- [ ] 8–16 kHz 关键窗口比其余高 ≥6 dB（高频克制）；
- [ ] 13 套主题 WCAG 全绿、APCA 无明显不可读项。

**人工看片（仍必须）**
- [ ] 浏览器 console 无错误/404；CJK 字体 `document.fonts.check()` 全 true；
- [ ] 每个风格段抽 5–6 帧接触表；全片 1 fps 接触表；
- [ ] 无 CSS 动画/rAF/Date.now/Math.random；无逐帧大范围 `filter blur`/`shadowBlur`；
- [ ] 浅色主题胶囊/倒计时/水印是深墨实体；大字卡 4 版式明暗节奏成立；
- [ ] 默认主题「不传 theme」与旧版基线做 PSNR/像素差对比仍一致；
- [ ] 切掉 <200 Hz 听一遍：不应只剩「叮叮叮」；铃音之间留白 ≥1 拍；
- [ ] 抽 6 帧出封面；写一页参数说明（帧率/时长/风格数/字体/工具链）。

---

## 11. 文件地图

```
code-video-showcase/
├─ SKILL.md                              ← 本文件（工作流/约束/索引）
├─ README.md / CHANGELOG.md              ← 仓库首页 / 版本记录
├─ package.json                          ← npm scripts（test/doctor/plan/render/qa/theme:audit）
├─ .github/workflows/render-smoke.yml    ← CI：2 s 渲染 + 合成 + QA
├─ references/
│  ├─ timeline-schema.md                 ← v2：timeline.json → plan.json 全字段与帧吸附
│  ├─ motion-and-color.md                ← v2：弹簧/缓动/CJK 排版/OKLCH/APCA/转场配方
│  ├─ platform-presets.md                ← v2：各平台分辨率/CRF/LUFS/命令
│  ├─ qa.md                              ← v2：视频/音频质检阈值与 JSON
│  ├─ ai-lane.md                         ← v2：可选 AI 素材 lane、模型表、License 红线
│  ├─ themes.md                          ← 13 套主题的调性/材质/token/HUD/推荐矩阵
│  ├─ style-recipes.md                   ← 11 种风格的美术+技术+音色配方
│  ├─ big-card-and-typography.md         ← 大字卡 4 版式、字体/字号/砸入参数
│  ├─ audio-recipes.md                   ← 120BPM 编曲、音色合成公式、混音链
│  ├─ render-pipeline.md                 ← 浏览器/FFmpeg/跨平台环境与命令
│  ├─ intake.md / original-brief.txt     ← 需求采集 / 原始任务书
│  └─ reference-film-analysis.md         ← 61s 样片的实测拆解
├─ templates/
│  ├─ color.js                           ← v2：OKLCH/OKLab、APCA、主题派生
│  ├─ motion.js                          ← v2：弹簧/缓动/stagger/CJK 排版/质感/转场
│  ├─ common.js                          ← 缓动/种子随机/noise/片段模式/卡点冲击（re-export v2）
│  ├─ themes.js                          ← 13 套主题 + 材质/卡片/HUD API（唯一数据源）
│  ├─ timeline.mjs                       ← v2：时间轴校验 + plan + segments.txt
│  ├─ render-segment.mjs                 ← 逐帧渲染 → ffmpeg（Playwright/原生 CDP）
│  ├─ cdp.mjs                            ← v2：零依赖 Chrome DevTools Protocol 驱动
│  ├─ render-farm.mjs                    ← v2：并行/重试/断点续渲 + manifest
│  ├─ concat-and-encode.sh               ← v2：平台预设 + CRF + loudnorm + bt709
│  ├─ synth_audio.py                     ← numpy/scipy 音色库 + 编排骨架
│  ├─ timeline.example.json              ← 61s / 11 轮示例
│  ├─ segment.html / big-card.html       ← 风格段 / 大字卡骨架
│  └─ theme-board.html / theme-sheet.html← 主题预览
├─ scripts/
│  ├─ qa-video.mjs                       ← v2：容器/帧数/黑帧/冻结/静音/LUFS/VMAF/接触表
│  ├─ qa-audio.py                        ← v2：BPM/拍网格/cue 对齐/削波/高频/频谱
│  ├─ doctor.mjs                         ← v2：环境体检
│  ├─ new-project.mjs                    ← v2：一键脚手架
│  ├─ ai-lane.mjs                        ← v2：AI 素材校验/叠加命令
│  ├─ test-core.mjs                      ← v2：纯函数回归测试
│  ├─ determinism-check.mjs              ← v2：同一 t 两次渲染字节比对
│  ├─ theme-audit.mjs                    ← WCAG + APCA 审计（--strict 可进 CI）
│  ├─ theme-preview.mjs                  ← 批量渲染 13 套主题预览
│  ├─ analyze-reference.sh               ← 任意参考片 → 接触表/切点/频谱
│  └─ qa-check.sh                        ← 旧版段级质检（保留）
└─ assets/                               ← 样片接触表、频谱、切点、配色数据、模板截图
```

### 模板实测记录

v2 已实测：`render-segment.mjs` 走**系统 Chrome + 原生 CDP + canvas 取帧**（无需 Playwright）渲染 1920×1080@30fps；`render-farm.mjs` 双段并发 + `--resume` 帧数对账通过；`concat-and-encode.sh --platform master` 输出 bt709/AAC 48 kHz；`qa-video.mjs` 与 `qa-audio.py` 实跑；`timeline.mjs` 对 11 轮示例产出 33 段 / 1830 帧 / 61.000 s；13 套主题 WCAG 全通过；`new-project.mjs` 脚手架可渲染。
截图证据：`assets/template-demo-segment.jpg`、`assets/template-demo-card.jpg`。

---

## 12. 参考样片拆解摘要（实测）

- 成片：61.013 s（视频 61.000 / 1830 帧）、1920×1080、30 fps、H.264 + AAC 48 kHz stereo、26.9 MB、~3.53 Mbps 总码率（视频流 3.32 Mbps + 音频 197 kbps）；样片把品牌换成了 `DeepSeek V4.1-Flash`，其余结构/技巧与任务书一致。
- 镜头：60 个切点；开场 0–8 s 打字 6 行；8–52 s 每 4 s 一轮（1 s 卡 + 3 s 风格）；53–55 s 八连闪；55–61 s 结尾。
- 画面锚点：左上胶囊「01 扁平插画 · 科普」、右下 3 秒倒计时、卡片右下 `STYLE 0X / 11`、风格内 HUD/小标签、结尾上下 138 px 黑边。
- 大字卡：样片采用「强调色底 → 米白底 → 黑底 → 黑底」4 循环（不是任务书的 i%4 顺序），文字左中/居中排版两种。
- 音频：120.0 BPM、相位 0 s、86.3% 强 onset 在 ±30 ms 内；开头 0–0.56 s 与结尾 60.38–61.0 s 为近静音。
- 详细逐段观察与偏差见 `references/reference-film-analysis.md`，图片证据在 `assets/`。

---

## 13. 快速启动（v2）

```bash
# 0) 环境体检（Node/Chrome/FFmpeg/numpy+scipy/字体）
node scripts/doctor.mjs

# 1) 脚手架：复制运行时 + 生成 segments/*.html + timeline.json + BRIEF.json
node scripts/new-project.mjs --out ../my-film --theme cyber-neon --styles 11 --fonts
cd ../my-film

# 2) 计划：校验时间轴并生成 plan.json / segments.txt（33 段 / 1830 帧 / 61s）
node templates/timeline.mjs --spec timeline.json --out out/plan.json --concat out/segments.txt --print

# 3) 先看静帧（不编码）
node templates/render-segment.mjs --page "segments/01.html?theme=cyber-neon" \
  --still 0.2,0.8,1.4,2.0,2.6 --outdir out/stills

# 4) 单段 / 并行渲染（--resume 断点续渲）
node templates/render-segment.mjs --page "segments/01.html?theme=cyber-neon" \
  --out out/r01-style.mp4 --duration 3 --t0 0.35 --speed 1.4
node templates/render-farm.mjs --plan out/plan.json --concurrency 4 --resume

# 5) 配乐（--plan 让每个 cue 落在时间轴上；再按 references/audio-recipes.md 精修）
python templates/synth_audio.py --plan out/plan.json --out audio/mix.wav

# 6) 合成 + 平台预设
bash templates/concat-and-encode.sh --platform master out/segments.txt audio/mix.wav out/final.mp4 61 30

# 7) 质检
node scripts/qa-video.mjs out/final.mp4 --plan out/plan.json
python scripts/qa-audio.py audio/mix.wav --plan out/plan.json --strict
node scripts/theme-audit.mjs --strict

# 8) 可选：AI lane 初始化（默认关闭）
node scripts/ai-lane.mjs init
```

**写任务书时直接复制 `references/original-brief.txt`，替换品牌词、风格清单与文案即可**；结构、渲染、合成、QA 都由 plan 驱动，无需改脚本。主题按 `references/intake.md` 锁定。
