# Changelog / 更新历史

本项目的版本更新记录。版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
每个版本同时发布在 [GitHub Releases](https://github.com/Moessif/code-video-showcase/releases)。

## [v1.1.0] - 2026-10-28 — 主题配色系统（8 套主题 / 预览 / 对比度审计）

### 新增
- `templates/themes.js`：8 套主题的唯一数据源。一套主题 = 14 个角色 token + 主材质 + HUD 规格 + 4 个点缀色，另含片头/结尾/风格段排版提示。主题：`coral-noir` 珊瑚暗夜（默认）、`claude-light` 橙光白、`aqua-morandi` 水蓝白·莫兰迪、`amber-noir` 琥珀黑金、`blueprint-stone` 蓝图纸、`graphite-signal` 石墨信号、`celadon-paper` 青瓷白、`crimson-theater` 绯墨剧场。
- `templates/themes.js` API：`getTheme()`（接受 id / 别名 / 对象，未知值回退默认）、`themeFromURL()`（读 `?theme=` 或 `?t=`）、`chrome()`（胶囊 / 倒计时 / 水印 / 闪白）、`cardColors(theme, layout)`（4 版式大字卡配色）、`drawThemeBackground()` / `drawGlassPanel()`、`cssVars()` / `applyTheme()`、`accentOverride()`（用户品牌色覆盖：自动挑 `accentInk`、算 `accentSoft`、同步材质光晕与 HUD 编号）、`auditTheme()` / `contrastRatio()`。
- `templates/theme-board.html`：单主题预览板（`?theme=<id>`，1920×1080）。
- `scripts/theme-preview.mjs`：批量渲染 8 套主题预览、全集联系表与三拼对比图。
- `scripts/theme-audit.mjs`：主题对比度审计，`--strict` 有不合格项时 exit 1（可进 CI）；当前 8 套全部通过。
- `references/themes.md`：主题系统设计规范（四层结构、8 套速查与调性、14 个 token、8 种材质、HUD、大字卡映射、选型矩阵、`accentOverride`、design-taste 对齐、QA、新增主题、相关文件）。
- `references/intake.md`：调用技能前的需求采集与主题锁定流程（最多 2 轮、必问 4 项 + 默认值、`BRIEF.json` 模板、交接与常见误用）。
- `assets/theme-previews/`：交付给用户的主题预览图（三拼 `theme-three-up.jpg`、全集 `theme-contact-sheet.jpg`、单主题 `01-coral-noir.jpg`–`08-crimson-theater.jpg`）。
- `templates/big-card.html` / `templates/segment.html`：支持 `?theme=<id 或别名>`；不传时保留旧版硬编码路径。
- `references/style-recipes.md` 新增「主题 × 风格段：换色规则」；`references/big-card-and-typography.md` 新增大字卡主题化说明（`cardColors()` 字段、浅色主题的明暗节奏、字体固定）。
- README（中英双语）新增 Themes / 主题配色 章节与主题预览图；快速开始补第 0 步 intake 与主题预览步骤、渲染示例；仓库结构补主题相关文件。
- `SKILL.md` 补充主题章节（8 选 1、`?theme=` 契约、锁定主题后再渲染）。

### 变更
- 默认视觉不变：不传 `?theme=` 时渲染原版 `coral-noir`，与旧版逐值/逐像素一致，老项目无需改动。
- 大字卡、胶囊、倒计时、水印、片头片尾配色统一由 `templates/themes.js` 派生，页面不再写死 `#d97757`。

### 备注
- 主题预览图由 `scripts/theme-preview.mjs` 生成；成片效果仍需按具体项目逐段渲染验证（本仓库不附成品视频）。

## [v1.0.4] - 2026-10-25 — README 一键安装说明

### 新增
- README 顶部新增「一键安装 / Install in one sentence」区块：一段可直接发给 Agent 的中英文安装指令，包含 `git clone` 到 `~/.dsh/skills/`（Claude Code 为 `~/.claude/skills/`，通用 Agent 为 `.agents/skills/`）以及装好后读 `SKILL.md` 自检。

### 变更
- 无代码、模板与渲染管线变更。

## [v1.0.3] - 2026-10-25 — 更新历史与发布自动化

### 新增
- `CHANGELOG.md`（本文件）：从 v1.0.0 开始补齐版本更新记录。
- `.github/workflows/sync-releases.yml`：main 推送或手动触发时，自动把 `v*` 标签按 CHANGELOG 小节同步成 GitHub Release（使用内置 `GITHUB_TOKEN`，不需要额外密钥）。
- README 顶部新增 Latest release 徽章与「Changelog / 更新历史」入口。

### 变更
- 无画面、音频与渲染管线的功能变更。

## [v1.0.2] - 2026-10-25 — README: Star History

### 新增
- README 末尾新增本仓库的 Star History 折线图（`star-history.com` 嵌入），并附上生成与嵌入方法的中文教程出处。

### 变更
- 无代码与渲染管线变更。

## [v1.0.1] - 2026-10-25 — 配乐高频克制规范

### 新增
- `references/audio-recipes.md` 第 7 节「频率克制：铃音只在关键位置点缀」：金属点缀的定义、全片 ≤3 处的分配规则、删掉高频层后用 sub/pad/低 tom 补能量的做法、可量化验收（8–16 kHz 段能量、HF 瞬态密度、频谱判读、切低频听感）与 numpy 检测片段。
- `SKILL.md`：§7 新增「高频克制（必读）」与自检；§9 音频质检新增 3 条硬指标（铃音 ≤3 处、非点缀段比关键段低 ≥6 dB、切掉低频不应只剩「叮叮叮」）；十阶段工作流第 9 步要求做高频听感自检。
- `templates/synth_audio.py`：文件头补充 frequency-restraint 说明，指向 `audio-recipes.md` 第 7 节。

### 变更
- `.gitignore` 增加 `__pycache__/` 与 `*.pyc`。

### 依据
- 来自一版 24 s 发布片的实际返工：初版在每个统计拍点都叠 FM 铃/拨弦、用法段铺高八度琶音，听感「太吵、叮叮叮」；重混后蒙太奇段 8–16 kHz 降 6.9 dB、HF 瞬态密度降 44%，全片铃音 25 → 3 处，标题与结尾 impact 两个关键节点保留。

## [v1.0.0] - 2026-10-24 — 首个公开版本

### 新增
- `SKILL.md`：十阶段工作流、确定性约束、质检清单、安装与触发说明。
- 11 种风格配方：扁平插画科普、数学动画、极简发布会、手绘白板、赛博故障、水墨国风、数据可视化、8-bit 像素、代码录屏、Three.js 三维、竖屏短视频。
- 大字卡系统（4 种版式、12 张卡）、八连闪、电影感结尾。
- 120 BPM / A 小调纯 numpy/scipy 配乐方案、音色库与卡点对齐做法。
- Playwright → CDP → FFmpeg 逐帧渲染管线与 `render-segment.mjs`；`concat-and-encode.sh` 合成脚本；`qa-check.sh` 质检脚本；`analyze-reference.sh` 参考片分析脚本。
- 6 个可运行模板：段落页面、大字卡、风格场景、渲染器、合成脚本、配乐骨架。
- 双语 README、MIT License，以及 9 张参考片拆解素材（接触表、风格帧、大字卡、频谱、切点数据等）。

### 已知限制
- 仓库不附带成品视频、第三方素材与字体；模板中的珊瑚色 `#d97757` 与文案为占位示例。
