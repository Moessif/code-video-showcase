---
name: code-video-showcase
description: |
  用纯代码（HTML/Canvas/SVG/Three.js 逐帧渲染 + Python numpy/scipy 合成配乐 + FFmpeg 合成）制作 30–90 秒卡点风格展示视频的完整技能。
  适用于：复刻/仿制《Opus 5.5 视频风格展示》、DeepSeek V4.1-Flash 61s 风格样片、多风格切换卡点视频、纯代码视频、程序化视频、
  HTML/Canvas/Three.js 视频、逐帧渲染 + 节拍同步、风格展示短片；要求不使用任何视频/图像/音乐生成模型。
  包含：剪辑结构公式、11 种风格配方、大字卡系统、120BPM 配乐合成、Playwright 渲染管线、质检清单与可运行模板。
  当用户提到「卡点视频」「风格展示视频」「纯代码做视频」「类似 Opus 5.5 / DeepSeek 风格展示」「逐帧渲染」「用代码做视频」
  「HTML Canvas 视频」「程序化视频」时必须触发。
license: MIT
metadata:
  domain: video-production
  reference: Opus 5.5 / DeepSeek V4.1-Flash 61s style showcase
compatibility: Node 20+ / Playwright Chromium / FFmpeg (libx264+AAC) / Python 3.10+ (numpy, scipy). Works on Windows and WSL/Linux. No external video, image or music generation models; fonts must be open-source and served locally.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# 纯代码卡点视频导演技能

> 目标：不调用任何视频/图像/音乐生成模型，用**代码**逐帧画出画面、用 **numpy/scipy** 合成配乐，最后 FFmpeg 合成 MP4。
> 参考样片：61.0s / 1920×1080 / 30fps / 1830 帧 / 120 BPM / H.264+AAC，见 `assets/contact-1fps.jpg` 与 `references/reference-film-analysis.md`。

## 0. 适用与不适用

**适用**
- 30–90 秒内快速切换多种美术风格的「风格展示 / 能力展示 / 产品宣传」短片；
- 强节拍（120 BPM）、大字卡 + 风格段交替、结尾升华的卡点结构；
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
| 音频 | 48 kHz 立体声 AAC 192 kbps |
| 视频 | H.264 High，yuv420p，libx264，2-pass 约 3.4 Mbps（成片约 26 MB） |
| 节拍 | 120 BPM：1 拍 = 0.5 s，1 小节 = 2 s |
| 品牌色 | `#d97757`（珊瑚色）；底色 `#0e0e0d` |
| 字体 | 全部 OFL：Noto Sans/Serif CJK SC、Ma Shan Zheng、Long Cang、ZCOOL KuaiLe、ZCOOL QingKe HuangYou、Press Start 2P、JetBrains Mono、Inter、Orbitron、Playfair Display |
| 字幕 | 不要底部字幕；信息都做成画面内的胶囊/HUD/注释 |
| 确定性 | 画面是 `t` 的纯函数，禁止 CSS transition/animation、rAF、Date.now、Math.random |

**每个片段必须满足**（Playwright 渲染契约）：

```js
window.DURATION = 3.0;                 // 片段时长（秒）
window.renderFrame = (t) => { /* 只依赖 t 和常量；禁止时间/随机副作用 */ };
window.__ready = false;                // 字体等资源就绪后置 true
window.__bootError = null;             // 初始化失败时写入错误字符串（渲染器立即报错）
```

---

## 2. 十阶段工作流

1. **需求定稿**：主题、品牌名（占位 `{{BRAND}}`）、时长、风格数量 N、每风格一句标题、结尾 CTA。
2. **写剪辑表**：用第 3 节公式算出每一段 `[start,end,type,style,t0,speed]`，先落成 JSON/Markdown 常量，后面所有脚本都读它。
3. **环境准备**：Node/Playwright/Chromium/FFmpeg/numpy+scipy/本地字体；参考 `references/render-pipeline.md` 的跨平台方案（WSL 下 Playwright CDN 慢时用 Chrome for Testing + `executablePath`）。
4. **工程骨架**：`common.js`（与 HTML 同目录）、`templates/segment.html`、`templates/big-card.html`、`templates/render-segment.mjs`、`templates/concat-and-encode.sh`、`templates/synth_audio.py`（渲染器内置静态服务器，无需另写）。
5. **逐段实现（外循环 11 次）**：先写场景 → 渲染 5–6 张静帧拼接触表检查构图与字体 → 再整段渲染 → `ffprobe` 核帧数。
6. **开场**：逐字打字 + 代码列上滚 + 粒子爆炸 + 闪白，8 s。
7. **大字卡**：4 套版式轮换，2 拍/张；砸入、速度线、回声字、`STYLE 0X / 11`。
8. **八连闪 + 结尾**（可选）：8×0.25 s 的微海报，接着 6 s 电影感收尾。
9. **配乐合成**：120 BPM、A 小调、与剪辑表共用同一组时间常数；生成 WAV 后先检查频谱图与卡点对齐，再做「高频克制」听感自检（§7）。
10. **合成与质检**：分段 mp4 → concat → 混音 → 2-pass → 抽帧接触表 + 频谱图 + 人工看片；输出 `成片 + 封面帧 + 参数说明`。

**每段闭环（必须）**：
```
设计 -> 写 HTML -> 渲染静帧(t=0.2/0.8/1.4/2.0/2.6) -> 拼接触表检查 -> 整段渲染
     -> ffprobe 帧数 == duration*30 -> 记录到进度表 -> 下一段
```
不要一次写 11 段再统一渲染；先跑通 1 段样板再复制，错误成本最低。

---

## 3. 时间结构（通用公式）

设风格数 `N`，每轮 `R = 4s`（大字卡 1s = 2 拍，风格展示 3s = 6 拍）：

```
0 ── opening (O=8s) ── 8 ── 11 轮 ×4s = 44s ── 52 ── 大字卡 "还有更多?" (1s) ── 53
   ── 八连闪 (2s，8×0.25s) ── 55 ── 结尾 (E=6s) ── 61
```

- 总时长 = `O + N*R + 1 + 2 + E`（本片 8+44+1+2+6 = 61 s）。
- 展示段第一帧就是「啪」的卡点：style 段 `t0` 通常是 0–0.9 之间的场景内偏移，用 `t = t0 + u*speed` 把 3 s 的片段加速到 6 拍内。
- 帧数校验：每段 `round(duration*30)`，全片合计必须 `== 1830`。
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

`templates/common.js` 提供（直接复制进项目）：

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

## 5. 大字卡系统（1 s / 2 拍）

4 套版式轮换（样片实测顺序：强调色底 → 米白底 → 黑底 → 黑底；也可按任务书 `i%4` 自定义）：

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

## 6. 风格展示配方（每段 3 s / 6 拍）

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

**每段必须有的视觉锚点**：左上胶囊标签（珊瑚编号 + 风格名）、右下 3 秒倒计时/帧计数、1–2 个风格内小标签、标题或主视觉在 6 拍内完成一次完整叙事。不要底部字幕。

---

## 7. 配乐合成（120 BPM，A 小调，纯 numpy/scipy）

- 音色：kick（正弦扫频）、snare、clap、hat、crash、sub boom、噪声 riser、反向镲、whoosh、拨弦、FM 电钢、FM 钟声、超级锯齿、808、方波/三角波、笛子；
- 和弦（每段前 4 拍 / 后 2 拍）：Am/F、C/G、F/G、C/F、Am/G、Am/Em、Dm/E、C/G、Dm/G、F/G、Am/F；
- 结构：开场铺底 + 逐字键盘咔哒 → 4.55 s sub boom + 底鼓渐强 → 5.5 s 8 分踩镲 → 6.5–7.95 s 军鼓滚奏 → 7.45 s 反向镲；
- 大字卡：第 1 拍 kick+tom，第 2 拍 kick+clap+sub+whoosh，后半反向镲；音乐压到 6%；
- 风格段：6 拍律动 + 专属乐器；第一帧 kick+clap+snare+crash+sub+高频爆裂；
- 混音：kick 包络侧链（闪避 55%）、2.2 s 合成混响、tanh 软削波、归一化 -0.6 dBFS；
- **高频克制（必读）**：金属感音色（FM 钟声、拨弦、亮 saw stab、coin 音、高八度琶音）只作关键节点点缀，**全片 2–3 处**（标题揭示 / 结尾 impact / 唯一一次 resolve）；统计与数字段用 sub+tom+kick+clap 的鼓点，不用铃音代替鼓点，更不要整段高音琶音铺底；
- **高频自检**：切掉 <200 Hz 只听高频，若只剩「叮叮叮」= 点缀过量；8–16 kHz 在非点缀段应比关键点缀段低 ≥ 6 dB。细则与检测代码见 `references/audio-recipes.md` 第 7 节；
- **实测参考**：样片 120.0 BPM、相位 0.0 s、86.3% 强 onset 落在 120 BPM 网格 ±30 ms 内；8/12/16… s 的大字卡起拍能量是前 300 ms 的 8–9 倍，9/13/17… s 的风格段起拍是 2.8–3.5 倍。

公式、编排表与混音函数见 **`references/audio-recipes.md`**，可运行骨架见 `templates/synth_audio.py`（模板默认输出 8 s demo，按编排表扩展到 61 s）。

---

## 8. 渲染管线

1. 本地静态服务器：`render-segment.mjs` 内置同源服务器（服务 `--root` 目录，默认 cwd）；字体/KaTeX/Three 全部同源，禁止 `file://`。
2. `render-segment.mjs`：把 `--t0/--speed/--duration` 拼成 `?seg=1&t0=&speed=&dur=` 附加到相对路径页面 URL → 启动无头 Chromium → `goto(url)` → 等 `document.fonts.ready` 与 `window.__ready`（或 `window.__bootError`）→ 逐帧
   `page.evaluate(t => renderFrame(t), i/fps)` → CDP `Page.captureScreenshot({format:'jpeg', quality:95})` → stdin 管道给
   `ffmpeg -f image2pipe -framerate 30 -i pipe:0 -c:v libx264 -preset medium -crf 16 -pix_fmt yuv420p`。
3. `concat-and-encode.sh`：segment mp4 → concat（`-f concat -safe 0 -c copy`）→ 与音轨合成 → 2-pass 3.4 Mbps。
4. 每段渲染后 `ffprobe -count_frames` 校验帧数；全片合计 1830。

**跨平台要点**（WSL 实测）
- Playwright 自带浏览器下载可能极慢（本机 ~17 KB/s）→ 用 Chrome for Testing + `executablePath`；
- WSL 跑 Chromium 需补齐 `libnss3/libnspr4/libasound2`，可用 `apt-get download` + `dpkg-deb -x` 解到 `~/.local/opt/chromium-libs` 并设置 `LD_LIBRARY_PATH`，无需 root；
- 项目在 `/mnt/e` 时小文件写入很慢（2000 个文件约 4.9 s），venv/浏览器缓存放 Linux home；渲染帧直接管道，不落盘。

详见 **`references/render-pipeline.md`**；可运行模板在 `templates/`。

---

## 9. 质检清单（必须全绿）

**画面**
- [ ] 浏览器 console 无错误、无 404（favicon 也要处理）；
- [ ] 所有字体 `document.fonts.check()` 为 true，CJK 不缺字；
- [ ] 每个风格段抽 5–6 帧拼接触表检查构图；全片抽 1 fps 接触表；
- [ ] 无 CSS 动画/rAF/Date.now/Math.random（grep 检查）；
- [ ] 不用逐帧 `ctx.filter blur` / 大量 shadowBlur（模糊层预渲染再交叉淡化）；
- [ ] 镜头 transform 下不依赖 `getBoundingClientRect`（先缓存坐标）；
- [ ] 1920×1080 @1x，`preserveDrawingBuffer: true`，WebGL 用 SwiftShader。

**音频**
- [ ] 频谱图检查每个卡点：鼓点与剪辑表时间误差 < 30 ms；
- [ ] 大字卡有 drop-out，风格段第一帧有「啪」；
- [ ] 结尾 5.5–6.0 s 淡出；峰值 -0.6 dBFS 不削波（tanh 后归一化）；
- [ ] 高频铃音点缀 ≤ 3 处且只落在关键节点；统计/数字段是低频鼓点，不是「叮叮叮」（`references/audio-recipes.md` §7）；
- [ ] 8–16 kHz 非点缀段比关键点缀段低 ≥ 6 dB；频谱图无连续亮高频竖条或水平泛音线；
- [ ] 切掉低频（<200 Hz）听一遍：不应只剩「叮叮叮」；铃音之间留白 ≥ 1 拍。

**合成**
- [ ] 每段帧数 = duration×30，全片 1830 帧；
- [ ] 音轨与视频对齐（`-shortest`，必要时 `-t 61`）；
- [ ] 2-pass 3.4 Mbps，H.264 yuv420p + AAC 48 kHz，体积约 26 MB；
- [ ] 抽 6 帧出封面图；写一页参数说明（帧率/时长/风格数/字体/工具链）。

---

## 10. 文件地图

```
code-video-showcase/
├─ SKILL.md                              ← 本文件（工作流/约束/索引）
├─ README.md                             ← 仓库首页：安装、快速上手、完整清单
├─ LICENSE                               ← MIT 许可证
├─ .gitignore / .gitattributes           ← 忽略构建产物 / 强制 LF 行尾
├─ references/
│  ├─ original-brief.txt                 ← 参考样片的原始任务书（可直接改品牌复用）
│  ├─ reference-film-analysis.md         ← 61s 样片的实测拆解（切点/画面/音频/偏差）
│  ├─ style-recipes.md                   ← 11 种风格的美术+技术+音色配方
│  ├─ big-card-and-typography.md         ← 大字卡 4 版式、字体/字号/砸入参数
│  ├─ audio-recipes.md                   ← 120BPM 编曲、音色合成公式、混音链
│  └─ render-pipeline.md                 ← Playwright/FFmpeg/跨平台环境与命令
├─ templates/
│  ├─ common.js                          ← 缓动/种子随机/noise/片段模式/卡点冲击
│  ├─ segment.html                       ← 风格段 HTML 骨架（Canvas + Three 可扩展）
│  ├─ big-card.html                      ← 大字卡骨架（4 版式 + 砸入 + 回声字）
│  ├─ render-segment.mjs                 ← 逐帧渲染 → ffmpeg 管道（内置静态服务器）
│  ├─ concat-and-encode.sh               ← concat + 混音 + 2-pass
│  └─ synth_audio.py                     ← numpy/scipy 音色库 + 编排骨架
├─ scripts/
│  ├─ analyze-reference.sh               ← 任意参考片 → 接触表/切点/频谱/音频分析
│  └─ qa-check.sh                        ← 分段 MP4 质检（编码/尺寸/帧数）
└─ assets/                               ← 样片接触表、频谱、切点、配色数据、模板截图
```

### 模板实测记录

`templates/segment.html` 与 `templates/big-card.html` 已用 `templates/render-segment.mjs` 实际渲染出 1920×1080@30fps 片段；`templates/synth_audio.py` 输出 48 kHz 立体声 WAV（峰值 -0.6 dBFS）；`scripts/qa-check.sh`、`scripts/analyze-reference.sh`、`templates/concat-and-encode.sh`（concat + 2-pass + AAC）均实跑通过。
截图证据：`assets/template-demo-segment.jpg`、`assets/template-demo-card.jpg`。

---

## 11. 参考样片拆解摘要（实测）

- 成片：61.013 s（视频 61.000 / 1830 帧）、1920×1080、30 fps、H.264 + AAC 48 kHz stereo、26.9 MB、~3.53 Mbps 总码率（视频流 3.32 Mbps + 音频 197 kbps）；样片把品牌换成了 `DeepSeek V4.1-Flash`，其余结构/技巧与任务书一致。
- 镜头：60 个切点；开场 0–8 s 打字 6 行；8–52 s 每 4 s 一轮（1 s 卡 + 3 s 风格）；53–55 s 八连闪；55–61 s 结尾。
- 画面锚点：左上胶囊「01 扁平插画 · 科普」、右下 3 秒倒计时、卡片右下 `STYLE 0X / 11`、风格内 HUD/小标签、结尾上下 138 px 黑边。
- 大字卡：样片采用「强调色底 → 米白底 → 黑底 → 黑底」4 循环（不是任务书的 i%4 顺序），文字左中/居中排版两种。
- 音频：120.0 BPM、相位 0 s、86.3% 强 onset 在 ±30 ms 内；开头 0–0.56 s 与结尾 60.38–61.0 s 为近静音。
- 详细逐段观察与偏差见 `references/reference-film-analysis.md`，图片证据在 `assets/`。

---

## 12. 快速启动

```bash
# 1) 复制模板到新项目（把 common.js 与 HTML 放同一目录，如 segments/）
cp -r templates/* <project>/
# 2) 渲染一个片段（渲染器自带同源静态服务器，无需另起服务）
node render-segment.mjs --page /segments/01.html --out out/01.mp4 --duration 3
#    按剪辑表给风格段传场景偏移/速度（自动拼成 ?seg=1&t0=&speed=&dur=）：
node render-segment.mjs --page /segments/01.html --out out/09.mp4 --duration 3 --t0 0.35 --speed 1.4
# 3) 先出静帧接触表（不编码）
node render-segment.mjs --page /segments/01.html --still 0.2,0.8,1.4,2.0,2.6 --outdir out/stills
# 4) 合成
./concat-and-encode.sh segments.txt audio.wav out/final.mp4
```

**写任务书时直接复制 `references/original-brief.txt`，替换品牌词、风格清单与文案即可**；结构公式、技术管线、QA 无需改。
