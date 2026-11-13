---
name: code-video-showcase
description: |
  用纯代码（HTML/Canvas/SVG/Three.js 逐帧渲染 + Python numpy/scipy 合成配乐 + FFmpeg 合成）制作 30–90 秒卡点风格展示视频的完整技能。
  适用于：复刻/仿制《Opus 5.5 视频风格展示》或 DeepSeek V4.1-Flash 61s 风格样片、多风格切换卡点视频、纯代码视频、程序化视频；要求不使用任何视频/图像/音乐生成模型。
  包含：需求采集与主题选择、13 套主题 × 8 材质（OKLCH + APCA）、spec.json（IR）/ plan / 增量渲染、并行渲染农场、风格配方、大字卡、120BPM 配乐合成、CDP/Playwright 渲染管线、视频/音频质检、平台交付与封面、可选 AI 素材 lane。详见 references/ 与 SKILL 正文。
  当用户提到「卡点视频」「风格展示视频」「纯代码做视频」「类似 Opus 5.5 / DeepSeek 风格展示」「逐帧渲染」「用代码做视频」
  「HTML Canvas 视频」「程序化视频」「30 秒产品宣传片」「竖屏短视频成片」「多平台导出（抖音/B站/小红书）」「封面图」「批量变体」
  「主题配色」「换配色」「配色主题」「卡点时间轴」「并行渲染」「视频质检」时必须触发。
  不用于：AE/PR 时间轴操作、文生视频/图生视频、需要真人素材与多轨混音的整片剪辑。
license: MIT
metadata:
  domain: video-production
  version: 2.4.0
  reference: Opus 5.5 / DeepSeek V4.1-Flash 61s style showcase
compatibility: Node 22+ (raw CDP needs global WebSocket) / Chrome or Edge (Playwright optional) / FFmpeg (libx264+AAC, libvmaf optional) / Python 3.10+ (numpy, scipy; matplotlib optional) / bash. Windows (Git Bash) and WSL/Linux. No external video/image/music generation models; fonts are open-source, served locally.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# 纯代码卡点视频导演技能

> 目标：不调用任何视频/图像/音乐生成模型，用**代码**逐帧画出画面、用 **numpy/scipy** 合成配乐，最后 FFmpeg 合成 MP4。
> 参考样片：61.0s / 1920×1080 / 30fps / 1830 帧 / 120 BPM / H.264+AAC，见 `assets/contact-1fps.jpg` 与 `references/reference-film-analysis.md`。

## 0.0 AGENT 执行契约（先读这 30 行）

**唯一入口**：`project.spec.json` + `cvs lint → cvs build`。不要走 §12 的 timeline 快速启动——那是 timeline v1 兼容路线，plan 没有 `segmentHash`，增量、单段动效、品牌色覆盖会**静默失效**。
**唯一产物**：`<outDir>/master.mp4`（`final.mp4` 已废弃）。母版永远按 master 预设出 1920×1080；`--platform` 是**附加**文件。

**完成定义（缺一不可，禁止「看起来对」）**：① `out/master.mp4` 存在且 `ffprobe` 含音频流（或已显式 `--no-audio`）；② `qa/qa-video.json` `summary.fail==0` 且无 `placeholder pages` FAIL；③ `qa/qa-audio.json` `summary.fail==0`（有音轨时）；④ `render-manifest.json` 无 `failed`/`frame-mismatch`；⑤ plan 与成片参数不含 `{{BRAND}}`、`风格段标题`、`替换 drawScene()`。

**四条硬断言**：`build` 自动合成 `spec.audio`（无音轨必须显式 `--no-audio`，不静默出默片）；`--resume` 同时校验帧数 + manifest hash（`cache hit` 才代表内容没变）；`--root` 默认 **cwd**（`E_PAGE_MISSING` 多半是 root 错了）；交付态加 `--strict`（QA warning 也算失败），迭代态可不加但要知道自己在迭代。

**报错 → 唯一动作**（完整表 125 码见 `docs/ERRORS.md`）：

| 前缀 | 唯一动作 |
|---|---|
| `E_PAGE_*` | 检查 `--root`；远程页默认禁止 |
| `E_THEME_*` / `E_APCA` / `E_ACCENT` | 换主题，或改 `look.accentOverride` |
| `E_BRAND_*` / `E_TITLE_*` / `E_FORBIDDEN_WORD` | 填真实品牌/标题/文案，不要留占位符 |
| `E_UNKNOWN_FIELD` / `E_COPY` | 删拼错的字段；自定义参数放 `style.params` |
| `E_DURATION*` / `E_STRUCTURE*` / `E_ROUND_*` | 改 `structure` / `rounds`，不要手改 plan |
| `E_AUDIO_*` | 装 numpy/scipy，或传 `--audio`，或 `--no-audio` |
| `E_RENDER` / `E_CONCAT` / `E_QA_*` | 看 `error.json.failedSegments` 或 `out/qa/*.json` 的 FAIL 项 |
| `E_ASSET_PATH` / `E_ASSET_MISSING` / `E_LOGO_MISSING` | 素材/logo 必须在项目根内且真实存在 |
| `E_BURN_SUBTITLES` / `E_COVER` | 换 ffmpeg（需 libass），或去掉该开关 |
| `E_SNAPSHOT_TAMPERED` / `E_ROLLBACK_HASH` / `E_ENV_MISMATCH` | 快照被动过 / 环境与基线不同：`cvs verify`、`golden --selfcheck` |

**退出码**：0 ok · 2 用法 · 10 spec · 11 render · 12 concat · 13 qa · 14 env。

## 0.5 编译器入口（新项目优先）

新项目不再从 timeline.json 起步，而是从 `project.spec.json`（IR）起步：

```bash
node bin/cvs.mjs lint  project.spec.json --root .            # 页面/主题/APCA/占位品牌/标题
node bin/cvs.mjs plan  project.spec.json --root . --print
node bin/cvs.mjs build project.spec.json --root . --platform douyin --strict
```

- **spec 是唯一真相**：文字、画风、主题、时长、剧本都改 spec；不要手改 `plan.json` 或段 mp4。
- **音频**：`spec.audio` 存在时 `build` 自动合成并 mux；不要音轨须显式 `--no-audio`。
- **平台版**：`spec.render.preset`（或 `--platform`）额外产出 `<outDir>/<platform>.mp4`，master 始终保留。
- **再来一版**：`cvs again --set look.theme=amber-noir` 读上次 spec、只重编译 dirty 段。
- **交付清单**：`cvs deliver` 产出 `delivery.json` + `master.srt/.vtt`。
- **增量**：每段 `segmentHash` 含页面及依赖内容哈希；`render-farm` 先查 `<outDir>/.cache/<hash>.mp4`；改页面/模板也失效。
- **内容参数**：`meta.title/description`、`opening.title/sub`、`style.copy{title,subtitle,caption}` 由 plan 下发到段 URL；页面不回退占位文案。
- **单段动效**：`rounds[].style.motion` 覆盖全局档位；未知字段报 `E_UNKNOWN_FIELD`。
- **品牌门禁**：`brand apply` 写入 `meta.brandKit`；`build`/`lint` 对禁用词/logo/品牌色对比度 error 级拦截。没有 `brandKit` 不做品牌检查。
- **字幕与封面**：`build --burn-subtitles` 只给投放版加硬字幕（母版永远干净）；`build --cover` 用 `cvs image` 出 card 版式封面；都如实记进 `delivery.json`。
- **版本闭环**：`cvs snapshot --label 首版` → `history` → `verify v001` → `rollback v001`；回滚**先校验再写盘**，快照被改过 exit 13。
- **母版契约**：`master.mp4` 永远 1920×1080（master 预设）；`--platform` 是附加文件，QA 量的始终是母版。
- **排版 token**：`templates/tokens.mjs` = 4 级字阶 + 唯一安全区 `safe()`；新页面必须 import 并写 `window.__typeProbe`，否则 `test-type-tokens.mjs` 红。
- **页面编辑契约（D3）**：编辑入口只有 `__patch` / `__patchMany`；`SPEC.params` 是 patch 的合并基座；空文本不注册命中区。细则见 `docs/DECISIONS.md` D3。
- **占位文案**：beat 缺 `copy` 时填内置缺省值并发 `W_COPY_DEFAULT`（warn）——看到就补 `beats[].copy[]`。
- **渲染器恢复**：`--timeout`(120s) 与 `--launch-timeout`(30s) 独立；页面抛错杀 ffmpeg + 浏览器进程树，重启换全新 profile——失败不挂住、不留孤儿。
- **失败对象**：`logPath` 恒指构建日志；`detailPath` 是阶段诊断产物（render/concat/deliver 各自的清单或日志）。
- **确定性检测**：`golden` manifest 记 Chrome/Node/字体指纹；环境不一致跳过哈希比对并告警（`--strict-env` 改失败）。跨机可比前提 = 同一镜像 + 同一字体锁。
- **统一入口**：`node bin/cvs.mjs`（21 个子命令，`cvs --help` 全列）。
- **参考图**：`cvs ref poster.jpg --spec project.spec.json` 只提取色板/强调色/密度与 top-3 主题候选（不复制像素），写 `meta.reference`。
- **动效档位**：`look.motion` 选 `calm|standard|dynamic|maximal`，不写按「类型 × 画风」推导；换档位改变画面并触发重渲染（进段哈希），写 `standard` 与旧成片逐像素一致。
- **画风 → 页面**：`templates/style-pages.mjs` 是唯一真值（13 画风 → 渲染页）；生成端按表填 `style.page`，未知画风回落通用场景页，新增配方页只加一行。
- **强调色覆盖**：`look.accentOverride` 展开成段 URL 的 `?accent=/accentInk=/accentSoft=`，进 `segmentHash`（换品牌色必重渲染）；没有覆盖时 URL 不变。
- **代码生图**：`cvs image --spec project.spec.json` 用同一 spec 出图集（cover/card/poster/story，`--list` 全部；默认画风段 78% 处），产物带 `image-manifest.json`（每张 sha256）。
- **spec 是不可信输入**：id 匹配 `^[A-Za-z0-9][A-Za-z0-9_-]
- **spec 是不可信输入**：id 匹配 `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`；页面路径禁绝对 URL/路径；`flash.count`≤256、单段≤600s、总帧≤18000；API 默认同源、错误信息抹本机路径。
- **界面**：`app/wizard/`(5181)、`app/canvas/`(5182)、`app/script/`(5183)、`app/versions/`(5184)、`app/review/`(5185)、`server/api.mjs`(5190)。
- **旧项目**：timeline v1 仍完全可用，`spec.mjs` 自动迁移；`render-farm` 默认 batch 模式（一个 worker 一个浏览器跑一个 shard），`--legacy` 回退逐段进程。页面按视口自适应（横/竖/方真重排），16:9 输出位级不变。
- **质量闸门**：`npm run test:all`（纯 Node）、`npm run test:browser`、`npm run golden`（静帧位级回归）、`npm run brand -- check …`。
- **配方页**：13–24 号在 `templates/recipe-*.html`（清单见 `templates/style-pages.mjs`）；**实拍素材** `cvs ingest` 出 EDL + spec 草稿（启发式，需人工审）。
- **禁止**：让 LLM 直接生成 HTML/CSS/JS，或绕过 spec 直接改像素。模型只填枚举与文案。
## 0. 适用与不适用

**适用**：30–90 s 多美术风格切换的「风格展示 / 产品宣传」短片；120 BPM 强节拍 + 大字卡与风格段交替的卡点结构；同一内容要换品牌气质（13 套主题，见 §5）；明确要求纯代码、可复现、逐帧确定性渲染。

**不适用**：写实镜头/真人/复杂叙事长视频；需要调用文生视频/图/音乐模型的场景（本技能明确禁止）。

---

## 1. 交付物与硬约束

| 项目 | 默认值 |
|---|---|
| 画幅/帧率 | 1920×1080，30 fps |
| 时长 | 61.0 s = 1830 帧（按 §3 公式改） |
| 音频 | 48 kHz 立体声 AAC 192–320 kbps，EBU R128 −14 LUFS |
| 视频 | H.264 High，yuv420p，bt709，CRF 21（母版）/22–24（平台），maxrate 限峰，+faststart |
| 节拍 | 120 BPM：1 拍 = 0.5 s，1 小节 = 2 s |
| 主题配色 | 13 选 1，默认 `coral-noir`（原版：珊瑚 `#d97757` + 深底 `#0e0e0d`）；OKLCH token + APCA 审计，见 §5、`references/themes.md` |
| 字体 | 全部 OFL（Noto Sans/Serif CJK SC、Ma Shan Zheng、ZCOOL、Press Start 2P、JetBrains Mono、Inter、Orbitron、Playfair Display…）；集合与许可见 `references/themes.md` |
| 字幕 | 不要底部字幕；信息都做成画面内的胶囊/HUD/注释 |
| 确定性 | 画面是 `t` 的纯函数，禁止 CSS transition/animation、rAF、Date.now、Math.random |

**每个片段必须满足**（渲染契约，Playwright 与零依赖 CDP 共用）：`window.DURATION`（秒）、`window.renderFrame(t)`（只依赖 t 和常量；禁止时间/随机副作用）、`window.__ready`（资源就绪置 true）、`window.__bootError`（初始化失败写错误串，渲染器立即报错）、`window.__capture`（可选 `'canvas'`/`'cdp'`）。单 canvas 默认 `toDataURL()`（快 30–50%），有 DOM 叠加自动回退 `Page.captureScreenshot`；WebGL 必须 `preserveDrawingBuffer:true` 或设 `__capture='cdp'`。

---

## 2. 十阶段工作流

1. **需求采集 + 主题锁定**（先做，不要先写代码）：读 `references/intake.md`；默认 61s / 横屏 1920×1080 / 11 段 / 珊瑚暗夜 / 120BPM 电子，**最多 2 轮**收齐信息——必问 4 项（题材、渠道/画幅、品牌名、结尾 CTA）。主题预览图给用户选（先 2–3 套短名单），锁定 id 后写项目根 `brief.json`；主题未锁定前不渲染成片。
2. **写 spec**：按 §0.5 主线填 `project.spec.json`；渲染/合成/音频/QA 全部读 plan，不要在别的脚本里重算时长/帧数。
3. **环境准备**：`node scripts/doctor.mjs`（Node/Chrome/FFmpeg/numpy+scipy/字体）。Playwright 不是必需。
4. **工程骨架**：`node scripts/new-project.mjs --out ../my-film --theme <id> --styles 11`。
5. **逐段实现**：场景 → 5–6 张静帧接触表检查构图与字体 → 整段渲染 → `ffprobe` 核帧数（或 `render-farm --only <id>`）。
6. **开场**：逐字打字 + 代码列上滚 + 粒子爆炸 + 闪白，8 s。
7. **大字卡**：4 套版式轮换，2 拍/张（§6）。
8. **八连闪 + 结尾**（可选）：8×0.25 s 微海报 + 6 s 电影感收尾。
9. **配乐合成**：§8；生成 WAV 后查频谱与卡点，再做高频听感自检。
10. **合成与质检**：`render-farm` → `concat-and-encode.sh --platform <平台>` → `qa-video` + `qa-audio` → 接触表 + 人工看片 → 成片 + 封面 + 参数说明。

**每段闭环（必须）**：`设计 → 写 HTML → 静帧(t=0.2/0.8/1.4/2.0/2.6) → 接触表检查 → 整段渲染 → 帧数对账 → 写回 manifest → 下一段`；先跑通 1 段样板再复制，不要一次写完 N 段。

---

## 3. 时间结构（通用公式）

设风格数 `N`，每轮 `R = 4s`（大字卡 1s = 2 拍，风格展示 3s = 6 拍）：

```
0 ── opening (O=8s) ── 8 ── N 轮 ×4s ── 大字卡"还有更多?"(1s) ── 八连闪(2s) ── 结尾 (E=6s)
```

- 总时长 = `O + N*R + 1 + 2 + E`。
- 展示段第一帧就是「啪」的卡点：`t0` 是场景内偏移（0–0.9），`t = t0 + u*speed` 把 3 s 加速到 6 拍。
- 帧边界由 `timeline.mjs` 吸附（`startFrame=round(t*fps)`），全片合计必须等于 `plan.stats.frames`；不要手写 `round(duration*30)`。
- 61 s 参考剪辑表（含每轮文案/强调色/t0/speed 实测值）见 `references/reference-film-analysis.md` 末节。

---

## 4. 画面契约与公共库

`templates/common.js`（复制进项目，并已重新导出 `motion.js` / `color.js` 的 v2 API）提供：缓动（`ease.outExpo` 等）、种子随机 `mulberry32`（**禁止 `Math.random`**）、value noise + fbm、片段模式（解析 `?seg=&t0=&speed=&dur=` → `t = t0 + u*speed`）、标准角标 `drawCapsuleLabel / drawCountdown / drawStamp`、卡点冲击（白闪 0.12 s / 缩放 1.13→1 / 抖动 14 px / 之后推镜 1→1.05）。**禁止每个 HTML 自己 `requestAnimationFrame`**；渲染器每帧调 `renderFrame(t)`。

v2 动效/颜色 API：`spring / stagger / track / rateFunc / transitionParams / drawKineticText / drawGrain / drawRGBSplit / drawBloom / toOklch / derivePalette / apcaLc / readableInk` —— 签名与配方见 `references/motion-and-color.md`。

2D 片段骨架（`createSegment()` 读 URL 参数，`applyImpact2D` 做冲击变换，`drawFlash` 盖最上层）：

```js
window.renderFrame = (u) => {
  const { t, fx } = seg.sample(u);
  ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,W,H); ctx.save();
  applyImpact2D(ctx, fx);
  drawScene(ctx, t, u);               // 只依赖 t/u
  ctx.restore();
  drawFlash(ctx, fx.flash);
};
```

Three.js 片段：`renderer` 必须 `{ preserveDrawingBuffer: true }`；启动参数 `--use-angle=swiftshader --enable-webgl --ignore-gpu-blocklist --enable-unsafe-swiftshader`；镜头动画写 `camera.position`，禁 `Date.now`。

---

## 5. 主题系统（13 套配色 × 8 种材质 + OKLCH/APCA）

主题 = **角色色板 + 材质 + HUD 规格 + 点缀色**四层一起换。数据唯一来源 `templates/themes.js`；材质画法、token 阈值、推荐矩阵、加主题步骤见 `references/themes.md`。

| id | 明暗 | 一句话 |
|---|---|---|
| `coral-noir` | dark | **默认**，原版逐值一致（珊瑚 + 胶片颗粒） |
| `claude-light` | light | 暖纸 + 陶土橙，品牌/知识 |
| `aqua-morandi` | light | 雾面水色 + 淡绿/淡粉，品牌/生活方式 |
| `amber-noir` | dark | 近黑 + 旧金，高端/电影感 |
| `blueprint-stone` | light | 石色纸 + 钴蓝，工程/数据 |
| `graphite-signal` | dark | 石墨灰 + 安全橙，开发者/硬件 |
| `celadon-paper` | light | 单色青 + 宋体，东方/文化 |
| `crimson-theater` | dark | 近黑 + 绯红，时尚/艺术 |
| `cyber-neon` | dark | 近黑 + 电光青，科技/游戏/预告 |
| `paper-journal` | light | 米白 + 赭红，知识/教程/生活 |
| `dark-gold-cinema` | dark | 近黑 + 旧金，高端/电影感 |
| `ice-minimal` | light | 冷白 + 钴蓝，SaaS/数据/医疗 |
| `pop-acid` | dark | 近黑 + 酸性黄绿，潮流/音乐/社交 |

不传 `theme` 时行为与旧版逐值一致；页面按 URL 选主题，接受中英文别名（`?theme=aqua-morandi`、`?theme=水蓝白`）。页面 API（`themeFromURL / drawThemeBackground / chrome / cardColors / drawGlassPanel`）见 `references/themes.md`。

**铁律**
- 浅色主题的胶囊/倒计时/水印必须用 `chrome(theme)`（深墨实体胶囊）；每套主题（含浅色）都有 `cardDark`，大字卡 layout 2/3 仍是深色卡。
- 大字卡字体固定 Noto Sans SC 900（卡是节拍器）；主题 `type` 字体只用于片头/结尾/风格段。
- 用户只给品牌色时用 `accentOverride` 改 4 个值并校验对比度，不自创第 14 套主题。
- 改完主题必须 `node scripts/theme-audit.mjs --strict` 全绿；暗底细字用 APCA（正文 ≥60 Lc、小字 ≥75、大字 ≥45）；新增主题优先 `derivePalette({mode, accent})` 生成 14 角色，不手调十几个 hex。

调性与禁忌、按内容类型选主题的矩阵见 `references/themes.md`；预览图在 `assets/theme-previews/`。

---

## 6. 大字卡系统（1 s / 2 拍）

4 套版式轮换（样片实测顺序：强调色底 → 米白底 → 黑底 → 黑底换排版；也可按任务书 `i%4`）。颜色来自 `cardColors(theme, layout)`，版式结构不随主题变（见 §5）。

- **砸入**：缩放 `1.7→1`、模糊 `16→0`，0.11 s `outExpo`，伴随强调色速度线 + 径向光晕 + 画面抖动 6/12 px。第 1 拍第一行、第 2 拍关键词（280 px 理论值；模板用 76/190 px 并按宽度自动缩放，以「最多 8 个汉字放得下」为准）。
- 背景 600 px 描边回声大字漂移 + 右下 `STYLE 0X / 11`；卡片期间配乐压到 6%，结束接风格段「啪」。尺寸推导与逐版式参数见 `references/big-card-and-typography.md`。

---

## 7. 风格展示配方（每段 3 s / 6 拍）

11 种风格是「视觉美术 + 技术实现 + 音色」三件套；逐页参数见 `references/style-recipes.md`，配方页映射见 §0.5。

| 风格 | 一句话 | 音色 |
|---|---|---|
| 扁平插画科普 | 分层圆/三角/虚线轨道 | 马林巴 |
| 数学动画 | 傅里叶心形 + KaTeX 公式 | FM 电钢琶音 |
| 极简发布会 | 大字 + Three.js 金属戒指 | 重低音 + 钟声 |
| 手绘白板 | SVG 描边 + turbulence + 红圈 | 尤克里里 + 笔摩擦 |
| 赛博故障 | 透视网格 + RGB 分离 | 失真锯齿 16 分 + 四拍底鼓 |
| 水墨国风 | fbm 山峦 + 宣纸纹理 + 竖排书法 | 古筝五声 + 太鼓 + 笛 |
| 数据可视化 | 条形赛跑 + CSS3D 玻璃卡 | 方波琶音 + 滴答 |
| 8-bit 像素 | 240×135 低分辨率 + pixelated | 芯片音乐 + 跳跃/金币 |
| 代码录屏 | Canvas 编辑器 + 逐字代码 | lo-fi 电钢 + 黑胶噪声 |
| Three.js 三维 | 粘土影棚 + 玻璃/金属球 | 钟声琶音 + 弹跳 |
| 竖屏短视频 | 手机壳 + 步骤卡/评论点赞 | 808 + 超级锯齿 + trap 镲 |

**每段必须有的视觉锚点**：左上胶囊标签（主题化编号 + 风格名）、右下 3 秒倒计时/帧计数、1–2 个风格内小标签、6 拍内完成一次完整叙事。不要底部字幕。

---

## 8. 配乐合成（120 BPM，A 小调，纯 numpy/scipy）

- 可运行骨架 `templates/synth_audio.py`：无参 = 8 s demo；`--plan out/plan.json` = 全片长度，并把每个 `audio.cues` 落成鼓点（61 s 实测 cue 命中 100% ±30 ms）。
- 结构：开场铺底 + 逐字键盘咔哒 → 4.55 s sub boom + 底鼓渐强 → 军鼓滚奏 → 反向镲；大字卡 drop-out（音乐压到 6%）；风格段 6 拍律动 + 专属乐器。
- 混音链：kick 侧链（闪避 55%）→ 2.2 s 合成混响 → tanh 软削波 → 母版峰值 −1.5 dBFS（留余量给 loudnorm 与 QA 门限）。
- **高频克制（必读）**：金属音色（FM 钟声/拨弦/亮 stab/coin/高八度琶音）只作关键节点点缀，**全片 2–3 处**；统计与数字段用 sub+tom+kick+clap，不用铃音代替鼓点；切掉 <200 Hz 只剩「叮叮叮」= 过量；8–16 kHz 非点缀段应比点缀段低 ≥6 dB。
- 音色公式、和弦进行表、编排、混音函数与 numpy 检测代码见 `references/audio-recipes.md`。

---

## 9. 渲染管线（v2）

主线：`spec → plan`（`templates/timeline.mjs`，**plan 是唯一真源**）→ 并行渲染（`render-farm.mjs --concurrency N --resume`，缓存按 `segmentHash`）→ 合成（`concat-and-encode.sh --platform …`，CRF 终编 + loudnorm −14 LUFS / −1 dBTP + bt709）→ 质检（§10）→ 交付（`cvs deliver`）。

要点：
- 浏览器：Playwright（若装）或系统 Chrome/Edge **原生 CDP**（`templates/cdp.mjs`，零 npm 依赖）；等 `document.fonts.ready` + `window.__ready` 再取帧。单 canvas 用 `toDataURL()`（快 30–50%），DOM/WebGL 回退 `Page.captureScreenshot({optimizeForSpeed:true})`。
- 中间片 `-crf 12 -preset veryfast`、yuv420p、bt709 四元标签、timescale 90000。
- 帧直接进 ffmpeg stdin 不落盘；进程退出调 `server.closeAllConnections()`，避免 5 s keep-alive 拖尾。
- Three.js 必须 `preserveDrawingBuffer:true`、`setPixelRatio(1)`、`renderer.compile()`、关自动动画循环；Canvas 2D 不要每帧 `ctx.filter=blur()`。
- WSL 下 ffmpeg 放 Linux 侧、取帧留 Windows 侧；Chrome 路径用 `CHROME_EXE`。

完整施工说明、故障排查与平台预设见 `references/render-pipeline.md`、`references/qa.md`、`references/platform-presets.md`。

---

## 10. 质检清单（自动 + 人工）

**一条命令**
```bash
node scripts/qa-video.mjs out/master.mp4 --plan out/plan.json  # 三档：FAIL 拦 / WARN strict 拦 / ADVISORY 永不拦
python scripts/qa-audio.py audio/mix.wav --plan out/plan.json --strict
node scripts/theme-audit.mjs --strict
node scripts/determinism-check.mjs --page "segments/01.html?theme=coral-noir" --t 0.5
```
自动覆盖（工具强制，阈值表见 `references/qa.md`）：帧数/尺寸/fps/bt709 四元标签；黑帧、冻结、静音；−14 ±1 LUFS / TP ≤ −1 dBTP / LRA ≤ 14；cue 对齐 ≥80% ±30 ms、BPM 误差 ≤2、网格命中 ≥70%；高频克制 ≥6 dB；13 套主题 WCAG 全绿。

**人工看片（仍必须）**
- [ ] 浏览器 console 无错误/404；CJK 字体 `document.fonts.check()` 全 true；
- [ ] 每个风格段抽 5–6 帧接触表；无 CSS 动画/rAF/Date.now/Math.random；无逐帧大范围 `filter blur`/`shadowBlur`；
- [ ] 浅色主题胶囊/倒计时/水印是深墨实体；大字卡 4 版式明暗节奏成立；
- [ ] 默认主题「不传 theme」与旧版基线像素对比仍一致；
- [ ] 切掉 <200 Hz 听一遍不应只剩「叮叮叮」；抽帧出封面 + 一页参数说明。

---

## 11. 文件地图（关键入口）

| 你要改什么 | 去哪里 |
|---|---|
| spec 模型 / plan / 深度校验 | `templates/spec.mjs`、`templates/plan.mjs`、`templates/spec-check.mjs` |
| 渲染 / 合成 / 质检 | `templates/render-segment.mjs`、`render-farm.mjs`、`cdp.mjs`、`concat-and-encode.sh`、`synth_audio.py`、`scripts/qa-video.mjs`、`qa-audio.py` |
| CLI / again / deliver / 版本 | `bin/cvs.mjs`、`scripts/again.mjs`、`scripts/deliver.mjs`、`scripts/versions.mjs` |
| 错误码 / 离线 / 完整目录树 | `schema/errors.json`→`docs/ERRORS.md`、`docs/OFFLINE.md`、`references/repo-map.md` |

参考样片：61.013 s / 1080p30 / 1830 帧 / 60 切点。完整拆解（镜头表/锚点/音频/配色/频谱）见 `references/reference-film-analysis.md`，图片在 `assets/`。


---

## 12. 快速启动（v2 · 仅限 timeline v1 旧项目）

> **新项目请走 §0.5 的 spec 主线。** 这条路生成的 `timeline.json` 没有 `segmentHash`，增量缓存 / 单段动效 / 品牌色覆盖会静默失效；只为兼容存量项目保留。

```bash
node scripts/doctor.mjs                                                  # 体检
node scripts/new-project.mjs --out ../my-film --theme cyber-neon --styles 11    # 脚手架
node templates/timeline.mjs --spec timeline.json --out out/plan.json --concat out/segments.txt  # 计划
node templates/render-farm.mjs --plan out/plan.json --concurrency 4 --resume    # 并行渲染
python templates/synth_audio.py --plan out/plan.json --out audio/mix.wav
bash templates/concat-and-encode.sh --platform master out/segments.txt audio/mix.wav out/master.mp4 61 30
node scripts/qa-video.mjs out/master.mp4 --plan out/plan.json && node scripts/theme-audit.mjs --strict
```

写任务书直接复制 `references/original-brief.txt` 替换品牌词/风格/文案；主题按 `references/intake.md` 锁定；结构与渲染全由 plan 驱动。
