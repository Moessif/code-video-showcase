# 渲染管线与环境（Windows / WSL 双平台）

本文件是「怎么把 HTML 变成 MP4」的施工说明；代码模板在 `../templates/`。

> **v2 速览**：`timeline.mjs` 生成 plan → `render-segment.mjs`（Playwright 或原生 CDP + canvas 取帧）→ `render-farm.mjs` 并行/续渲 → `concat-and-encode.sh` 平台预设 + loudnorm → `qa-video.mjs` / `qa-audio.py`。没有 Playwright 也能跑；`node scripts/doctor.mjs` 一键体检。完整字段见 `timeline-schema.md`、`qa.md`、`platform-presets.md`。

---

## 1. 环境清单

| 组件 | 要求 | 备注 |
|---|---|---|
| Node.js | ≥ 20（推荐 24） | Playwright 脚本、静态服务器 |
| npm 包 | **非必需**；`playwright`/`playwright-core` 可选（`katex` 仅公式页需要） | 原生 CDP 走 Node 内置 WebSocket |
| 浏览器 | Chromium（Playwright 自带）或系统 Chrome / Edge / Chrome for Testing | 见第 5 节 |
| FFmpeg | 带 libx264 + AAC + image2pipe | 推荐静态构建，含 ffprobe |
| Python | ≥ 3.10 + numpy + scipy | 配乐合成、音频分析 |
| 字体 | 全部 OFL、本地文件 | 见第 4 节 |

**验证命令（建议做成 `tools/doctor.mjs`）**：字体/KaTeX/Three 文件齐全、FFmpeg 有 libx264/aac、Python 能跑 scipy 合成、浏览器能启动、WebGL SwiftShader、1920×1080、CDP JPEG、image2pipe 编码、AAC、混流、ffprobe 复核。参考样片工程的自检是 29 项全绿后才开始做画面。

---

## 2. 项目结构（推荐）

```
project/
├─ segments/
│  ├─ common.js               # 与 HTML 同目录（模板里 import './common.js'）
│  ├─ 01-flat-science.html    # 每个风格段一个 HTML
│  ├─ ...
│  ├─ cards.html              # 大字卡（也可以每张一个 HTML）
│  └─ opening.html / ending.html / flashes.html
├─ tools/
│  ├─ server.mjs              # 可选：仅供浏览器预览（渲染器已内置等价服务器）
│  └─ doctor.mjs              # 可选：环境自检
├─ shared/
│  └─ fonts.css               # @font-face（本地字体）
├─ fonts/                     # 本地 OFL 字体
├─ audio/                     # synth 输出的 WAV / 分析图
├─ out/                       # 分段 mp4 + 成片 + 封面
└─ render-segment.mjs 等
```

**规则**：一个 HTML 只负责一个片段；页面之间不共享运行时状态；所有时间参数集中在 `timeline.js`/JSON 里，画面和音频都 import 它。

---

## 3. 本地服务器

```js
// 渲染器（templates/render-segment.mjs）内置同源静态服务器，渲染时无需另起服务；
// 仅当要在浏览器里手动预览时，才自己起一个（未随 templates/ 发布，按需实现）：
node tools/server.mjs --port 4600
// → http://127.0.0.1:4600
```

**若自建服务器**：
- 必须正确设置 MIME：`.mjs/.js` → text/javascript，`.ttf` → font/ttf，`.woff2` → font/woff2；
- 禁止 file:// 加载（ES module / CORS / 字体都会出问题）；
- 加 `Cache-Control: no-store`，避免改完页面还命中旧缓存；
- 处理 `/favicon.ico` 返回 204，避免 404 污染 console。

---

## 4. 字体准备

- 下载 OFL TTF/woff2 到 `fonts/`，用 `@font-face` 本地引用，**不要依赖 Google Fonts CDN**；
- CJK 字体体积大：全量 TTF 只留 1–2 个（Noto Sans SC 主力 + 一个衬线），装饰字体可用 Google Fonts `text=` 子集（woff2，几十 KB）；
- 子集字符集 = 全片文案去重字符（写脚本从 `script.json` 提取），避免缺字；
- 渲染前必须：
  ```js
  await document.fonts.load('900 170px "Noto Sans SC"', text);
  await document.fonts.ready;
  window.__ready = true;
  ```
- 变量字体（VF）声明 `font-weight: 100 900` 即可覆盖粗细；浏览器本地加载没问题。

**WSL/Windows 网络注意**：Playwright/Chromium 的官方 CDN 在大陆网络可能极慢（实测 ~17 KB/s）。可用方案：
1. Windows：用系统 Edge（`channel: 'msedge'`）；
2. WSL/Linux：下载 **Chrome for Testing**（与 Playwright 期望版本一致，源 `storage.googleapis.com/chrome-for-testing-public/`），解压后 `executablePath` 指过去；
3. 若缺 `libnss3/libnspr4/libasound2` 且无 root：`apt-get download` 下载 deb → `dpkg-deb -x` 解到 `~/.local/opt/chromium-libs` → `LD_LIBRARY_PATH`；
4. 启动参数必须含 `--no-sandbox`（容器/WSL 无 setuid sandbox 时）。

---

## 5. 浏览器启动（跨平台）

```js
// templates/render-segment.mjs 的候选顺序（每个候选用同一份 { headless, args } 启动，失败自动试下一个）
const candidates = [
  { label: 'CHROME_EXE',         opts: { executablePath: process.env.CHROME_EXE } },
  { label: 'chrome-for-testing', opts: { executablePath: '~/.local/opt/chrome-for-testing/chrome-linux64/chrome' } }, // Linux
  { label: 'playwright bundled', opts: {} },
  { label: 'channel:msedge',     opts: { channel: 'msedge' } },    // Windows
  { label: 'channel:chromium',   opts: { channel: 'chromium' } },  // Linux
];
```

WebGL 参数（必须）：
```
--use-angle=swiftshader --enable-webgl --ignore-gpu-blocklist
--enable-unsafe-swiftshader --disable-gpu-sandbox --hide-scrollbars --mute-audio
```
页面里的 Three.js 渲染器必须 `{ preserveDrawingBuffer: true, antialias: true }`，否则 CDP 截图可能是黑帧。

---

## 6. 逐帧渲染（核心）

渲染器对相对路径页面会自动附加 `?seg=1&t0=&speed=&dur=`（对应 `--t0/--speed/--duration`），页面用 `common.js` 的 `createSegment()` 读取，所以 `--duration 3 --t0 0.35 --speed 1.4` 会把片段本地时间映射到场景时间 `0.35 + u*1.4`；`--page` 也可以直接给带查询串的完整 URL。

流程：

```
for i in 0..frames-1:
    await page.evaluate(t => window.renderFrame(t), i / fps);   // 同步绘制
    const { data } = await cdp.send('Page.captureScreenshot', {format:'jpeg', quality:95, fromSurface:true});
    ffmpeg.stdin.write(Buffer.from(data, 'base64'));            // 背压：drain
ffmpeg.stdin.end();
```

ffmpeg 参数（分段）：
```
-f image2pipe -framerate 30 -i pipe:0
-c:v libx264 -preset medium -crf 16 -pix_fmt yuv420p -movflags +faststart out/01.mp4
```

**性能建议**
- 帧率固定 30；每帧 `evaluate` 前不要额外等待，渲染完立即截图；
- 输出 JPEG q95 比 PNG 快 2–3×，体积够小；
- 每段独立渲染（10–30 s 一段），失败重跑成本低；
- 渲染前先出静帧（`--still 0.2,0.8,...`）检查构图，避免整段白跑；
- 大分辨率渲染时关闭 DevTools 面板/扩展；`--hide-scrollbars`。

**帧数校验**
```bash
ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=nb_read_frames -of csv=p=0 out/01.mp4
# 应等于 round(duration*30)
```

---

## 7. 拼接、混音、最终编码

**拼接**（各段编码参数一致时可直接 copy）：
```bash
# segments.txt:
file 'out/00-opening.mp4'
file 'out/01-card.mp4'
...
ffmpeg -y -f concat -safe 0 -i segments.txt -c copy out/concat.mp4
```

**混音 + 最终编码**（v2 默认 CRF + maxrate；脚本已封装平台预设与两遍 loudnorm）：
```bash
bash templates/concat-and-encode.sh --platform master \
  out/segments.txt audio/mix.wav out/final.mp4 61 30
```
等价的单条 ffmpeg（母版，CRF 21 / maxrate 18M / −14 LUFS）：
```bash
ffmpeg -y -i out/concat.mp4 -i audio/mix.wav \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p" \
  -r 30 -fps_mode cfr -c:v libx264 -preset slow -crf 21 -maxrate 18M -bufsize 36M \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -c:a aac -b:a 320k -ar 48000 -ac 2 -shortest -t 61 -movflags +faststart out/final.mp4
```
- 容器时长会比视频长十几毫秒（AAC priming），用 `-t 61.0` 或 `-shortest` 截到 61.000；
- 压完 `ffprobe` 复核：1920×1080、30/1、1830 帧、h264+aac、bt709；
- 平台硬码率/固定体积时才用 2-pass `-b:v`，CRF 在颗粒内容上通常更省。

---

## 8. 性能与磁盘（WSL 实测）

| 位置 | 顺序写 | 2000 个小文件 |
|---|---|---|
| `/mnt/e`（Windows 盘） | ~198 MB/s | ~4.9 s |
| `/home`（ext4） | ~1.6 GB/s | ~0.05 s |

- 源码/成片放项目目录没问题；**venv、node_modules、浏览器缓存、临时帧放 Linux home**；
- 逐帧渲染直接管道给 ffmpeg，不落盘，规避小文件慢的问题；
- 若必须落帧，先写 `/tmp` 再 concat。

---

## 9. 常见故障速查

| 现象 | 原因 | 修复 |
|---|---|---|
| 截图全黑 | WebGL 没开 `preserveDrawingBuffer`，或没等一帧 | renderer 加 preserveDrawingBuffer，截图前先 render |
| 首帧字体回退/缺字 | 没等 fonts.ready | 渲染前 `fonts.load` 全部字体 |
| WebGL 创建失败 | 缺 SwiftShader 参数 / WSL 缺库 | 加 `--use-angle=swiftshader --enable-unsafe-swiftshader`；补 libnss 等 |
| 浏览器启动失败 | Playwright 浏览器未安装 / WSL sandbox | 用 `executablePath` 指向 CFT；加 `--no-sandbox` |
| 渲染极慢 | 每帧 `ctx.filter` / 大 shadowBlur / DOM 重排 | 预渲染模糊层、限制 shadow 区域、用 Canvas |
| 帧数少 1–2 | 页面 `DURATION` 与 `--duration` 不一致 | 统一从 timeline 读取 |
| 音画不同步 | 用了 `setTimeout`/音频事件而非时间表 | 所有事件从样本索引/时间表生成 |
| 成片结尾多 13 ms | AAC priming | `-t 61` / `-shortest` |
| 404 污染 console | favicon | server 返回 204 |

---

## 10. v2 管线（推荐默认）

```bash
node scripts/doctor.mjs
node templates/timeline.mjs --spec timeline.json --out out/plan.json --concat out/segments.txt --print
node templates/render-farm.mjs --plan out/plan.json --concurrency 4 --resume
bash templates/concat-and-encode.sh --platform master out/segments.txt audio/mix.wav out/final.mp4 61 30
node scripts/qa-video.mjs out/final.mp4 --plan out/plan.json
python scripts/qa-audio.py audio/mix.wav --plan out/plan.json --strict
```

### 10.1 取帧路径

| 条件 | 路径 | 说明 |
|---|---|---|
| 单 canvas 全屏、无 `[data-dom-overlay]` | `canvas.toDataURL()` | 页内 JPEG 编码，通常快 30–50% |
| 多 canvas / DOM 叠加 / 页面设 `__capture='cdp'` | `Page.captureScreenshot` | 加 `optimizeForSpeed:true`、`clip` |
| WebGL | canvas 路径要求 `preserveDrawingBuffer:true` | 否则读回黑帧，自动回退 CDP |

### 10.2 浏览器分辨率

1. 环境变量 `CHROME_EXE` / `--browser`；
2. Linux 下 `~/.local/opt/chrome-for-testing/chrome-linux64/chrome`；
3. Windows 下 Program Files/LocalAppData 的 Chrome/Edge；
4. 最后才尝试 Playwright 自带浏览器。

原生 CDP 启动参数已包含：`--headless=new --remote-debugging-port=0 --run-all-compositor-stages-before-draw --disable-frame-rate-limit --force-color-profile=srgb --enable-unsafe-swiftshader --use-angle=swiftshader`。

### 10.3 颜色

- 输入帧是全范围（JPEG/PNG `pc`），ffmpeg 里显式 `scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p`；
- 输出打 `-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv`；
- `-video_track_timescale 90000` 保证分段拼接时间基一致。

### 10.4 关闭与清理

- 每段结束调用 `server.closeAllConnections()`，避免 HTTP keep-alive 5 s 拖尾；
- Chrome stderr 写临时文件而非管道，profile 交给 detached 进程删除；
- `render-farm --resume` 用 ffprobe 帧数对账，坏段不会进入 concat。

### 10.5 实测（Windows 10 / Chrome 141 / 1920×1080）

| 场景 | 结果 |
|---|---|
| 30 帧（1 s）单段 | 渲染约 4.3 s（≈7 fps），进程收尾约 3 s |
| 90 帧（3 s）单段 | 约 27 s |
| 2 段并发 | 各自 ~6 s 渲染，总墙钟 ~12 s |
| 61 s / 1830 帧（估算，并发 4） | 约 3–5 分钟 |
