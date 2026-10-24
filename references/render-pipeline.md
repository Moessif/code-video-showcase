# 渲染管线与环境（Windows / WSL 双平台）

本文件是「怎么把 HTML 变成 MP4」的施工说明；代码模板在 `../templates/`。

---

## 1. 环境清单

| 组件 | 要求 | 备注 |
|---|---|---|
| Node.js | ≥ 20（推荐 24） | Playwright 脚本、静态服务器 |
| npm 包 | `playwright`（含 playwright-core）、`katex` | 纯 JS，Windows/Linux 可共用同一 `node_modules` |
| 浏览器 | Chromium（Playwright 自带）或 Chrome for Testing / Edge | 见第 5 节 |
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

**混音 + 最终 2-pass**（约 3.4 Mbps；也可直接用 `templates/concat-and-encode.sh` 封装好的这两步）：
```bash
# pass 1（-f null - 跨平台；Windows 上不要写 /dev/null）
ffmpeg -y -i out/concat.mp4 -i audio/mix.wav -c:v libx264 -preset slow -b:v 3400k \
  -pass 1 -passlogfile out/passlog -an -f null -
# pass 2
ffmpeg -y -i out/concat.mp4 -i audio/mix.wav -c:v libx264 -preset slow -b:v 3400k \
  -pass 2 -passlogfile out/passlog -pix_fmt yuv420p -c:a aac -b:a 192k \
  -shortest -movflags +faststart -t 61 out/final.mp4
```
- 容器时长会比视频长十几毫秒（样片 +13 ms，AAC priming），用 `-t 61.0` 或 `-shortest` 截到 61.000；
- 压完 `ffprobe` 复核：1920×1080、30/1、1830 帧、h264+aac。

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
