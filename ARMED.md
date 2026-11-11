# ARMED — code-video-showcase 本机落地手册

上游：[Moessif/code-video-showcase](https://github.com/Moessif/code-video-showcase)（MIT）。
本文件只记录**在这台机器上实测过的东西**，以及我们为跑通它做的改动。上游 README/SKILL.md 仍是权威工作流文档。

验证时间：2026-11-11（v2.0.0）· 平台：Windows 10 (22631) + Git Bash · 结论：**端到端跑通（零 Playwright 依赖）**。

---

## 1. 状态

| 组件 | 实测 | 判定 |
|---|---|---|
| Node / npm | v24.22.1 / 11.19.1 | ok（要求 ≥20） |
| FFmpeg / ffprobe | 7.0.2-full_build（`F:\ffmpeg-7.0.2-full_build`），含 libx264 | ok |
| Python | 3.12.9（`E:\Anaconda3\python.exe`），numpy 2.5.4 + scipy 1.18.1 | ok |
| 浏览器 | Chrome `C:\Program Files\Google\Chrome\Application\chrome.exe`（另有 Edge） | ok |
| Playwright | **未装**；渲染器走系统 Chrome + 原生 CDP（`templates/cdp.mjs`） | ok |
| 字体 | `shared/fonts.css` + 1187 个 woff2（28.8 MB），7 个 OFL 字族 | ok，404 归零 |
| 画面管线 | 1920×1080 / 30fps / H.264 High / yuv420p / bt709 | ok |
| 音频管线 | `synth_audio.py` → 8.00s 48kHz 立体声，峰值 −0.6 dBFS | ok |
| 拼接出片 | concat → 混音 → CRF17 + 两遍 loudnorm → bt709/faststart | ok |
| 时间轴 | `timeline.mjs`：11 轮示例 → 33 段 / 1830 帧 / 61.000 s | ok |
| 质检 | `qa-video.mjs` 13 PASS / `qa-audio.py` 3 PASS（demo） | ok |
| 主题审计 | `theme-audit.mjs --strict` 13 套主题 WCAG 全 PASS | ok |

实测性能（v2，canvas 取帧）：30 帧（1s 段）渲染约 **4.3 s**（≈7 fps），进程收尾约 3 s；90 帧（3s 段）约 **27 s**。`render-farm --concurrency 4` 渲染 61 s 成片约 **3–5 分钟**。

## 2. 一键自检

```bash
bash arm.sh              # 依赖检查 + 装依赖 + 建字体 + 冒烟渲染 + ffprobe 校验
SKIP_SMOKE=1 bash arm.sh # 只查不渲染
```

任何 `[FAIL]` 都会让它以非 0 退出。**关键环境变量**：`CHROME_EXE`（渲染器用它定位浏览器；不设则依次尝试 Playwright 自带 Chromium → `msedge` channel）。`arm.sh` 会自动导出 Chrome 路径。

## 3. 日常命令

```bash
export CHROME_EXE="C:/Program Files/Google/Chrome/Application/chrome.exe"

# 单段静帧（拼接触表，先看构图再整段渲染——上游硬要求）
node templates/render-segment.mjs --page templates/segment.html \
     --still 0.2,0.8,1.4,2.0,2.6 --outdir out/stills/01

# 整段渲染（3s = 90 帧）
node templates/render-segment.mjs --page templates/segment.html --out out/01.mp4 --duration 3

# 换主题（v2.0.0）：13 套 id 见 templates/themes.js
node templates/render-segment.mjs --page "templates/big-card.html?theme=amber-noir" --out out/01b.mp4 --duration 3

# 时间轴 → 计划 → 并行渲染（v2）
node templates/timeline.mjs --spec templates/timeline.example.json --check
node templates/render-farm.mjs --plan out/_scaffold/out/plan.json --only r01-style

# 主题预览板 / 批量预览 / WCAG+APCA 审计
node scripts/theme-audit.mjs --strict
node scripts/theme-preview.mjs --root . --themes cyber-neon --out out/_preview

# 配乐（必须用 python = Anaconda；不要用 python3）
python templates/synth_audio.py --out audio/demo.wav

# 分段质检（帧数 == duration*fps）
bash scripts/qa-check.sh out/e2e

# 拼接 + 混音 + 2-pass 出片
printf "file '00.mp4'\nfile '01.mp4'\n" > out/e2e/segments.txt
bash templates/concat-and-encode.sh out/e2e/segments.txt audio/demo.wav out/e2e/final.mp4 6 30
```

`segments.txt` 用相对路径时，**路径相对该清单文件所在目录**（concat demuxer 规则），不是相对项目根。

## 4. 我们加的改动

新增（上游没有）：

- `arm.sh` — 上述一键自检。含 libx264 编码器检测、浏览器自动定位、假绿防护（见下）。
- `scripts/build-fonts.mjs` — 把 `@fontsource` 的 OFL 字体摊平为自包含 `shared/fonts.css` + `shared/fonts/*.woff2`，保留 `unicode-range` 子集切分（CJK 关键）。要加字族改脚本里的 `FAMILIES` 再重跑。
- `shared/fonts.css` + `shared/fonts/` — 上游不附带字体（README 明说），模板却硬引用 `/shared/fonts.css`，此前每次渲染都有 404。

上游脚本的 Windows 可移植性修复（**这三处是上游 bug，非本机问题**）：

1. `scripts/qa-check.sh` — 上游按 WSL/Linux 写（LF）。本机 native `ffprobe` 与 MSYS Python 的 stdout **都是 CRLF**，导致 `$dur` 带上回车、`float('3.000000\r')` 抛错，脚本对每个正常文件都误报 `FRAMES` 失败并以 1 退出。修法：在 shell 边界统一 `tr -d '\r'`。
2. `templates/concat-and-encode.sh` — 同样原因使 `FRAMES` 与 `EXPECTED` 比较恒不相等，每次出片都打假警告；`SIZE_BYTES` 也带 CR 进 awk。同样剥 CR。
3. `arm.sh` 的 Python 检查 — 只 `import scipy` 是**惰性**的，会假绿；必须 `import scipy.signal, scipy.io.wavfile`（`synth_audio.py` 真正用到的）。

## 5. 已知坑与未验证项

- **`python3` ≠ `python`**。Git Bash 里 `python3` 指向 `/c/msys64/mingw64/bin/python3`（**无 numpy/scipy**）；`python` 指向 Anaconda（有）。跑配乐就是 `python templates/synth_audio.py`，或 `PYTHON=python`。
- **scipy 偶发 `_fblas` DLL 加载失败**：在同一次 shell 调用里先跑 MSYS `python3`、再跑 Anaconda `python` 时出现过一次（`ImportError: DLL load failed while importing _fblas: 句柄无效`），重跑即恢复。遇到就重跑，或把两类调用分开。
- **上游仓库不含成品样片**，README 明说模板是脚手架。真正的活儿是逐段写 `segments/*.html`，每段必须实现 `window.DURATION` / `window.renderFrame(t)` / `window.__ready` / `window.__bootError`，且 `renderFrame` 只能是 `t` 的纯函数（禁 CSS 动画、rAF、`Date.now`、`Math.random`）。
- **`synth_audio.py` 只带 8 s demo**：61 s 编排要自己扩 `build_arrangement()`。
- 未验证：`scripts/theme-preview.mjs` 批量渲染、WSL/Linux 路径下的行为、`analyze-reference.sh`（依赖参考片素材）。
- 技能包已装到 `C:\Users\chen\.agents\skills\code-video-showcase`，ZCode 会在「卡点视频 / 风格展示视频 / 纯代码做视频 / 逐帧渲染」等触发词上自动加载。上游更新时需重新同步，并把本文件的改动重新应用。

## 6. 文件地图

```
SKILL.md               27KB 权威工作流（中文）
README.md              43KB 中英双语总览
references/            7 篇设计规范（取色/排版/音频/渲染管线/参考片分析/采集）
templates/
  render-segment.mjs   逐帧渲染器：CDP 截图 → ffmpeg image2pipe → libx264
  common.js            segment 公共库（HUD/胶囊/loadFonts/SAFE）
  segment.html         风格段模板
  big-card.html        大字卡模板（4 版式）
  theme-board.html     单主题预览板
  theme-sheet.html     主题全集
  themes.js            13 套主题唯一数据源
  synth_audio.py       numpy/scipy 配乐工具包 + 8s demo
  concat-and-encode.sh 拼接 + 混音 + 2-pass【已修 CRLF】
scripts/
  qa-check.sh          分段质检【已修 CRLF】
  theme-audit.mjs      主题对比度审计（--strict 可进 CI）
  theme-preview.mjs    批量主题预览【未验证】
  analyze-reference.sh 参考片分析【未验证】
  build-fonts.mjs      【新增】字体摊平
arm.sh                 【新增】一键自检
shared/fonts.css       【新增】本地字体（1187 @font-face）
out/                   gitignore；渲染产物与冒烟测试都在这里
```
