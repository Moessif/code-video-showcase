# Changelog / 更新历史

本项目的版本更新记录。版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。
每个版本同时发布在 [GitHub Releases](https://github.com/Moessif/code-video-showcase/releases)。

## [v2.3.1] - 2026-11-12 — 画风真出片（F1）+ 全仓安全加固

一次以**审计**驱动的版本：v2.3 收尾时对全仓做了一轮检查，修掉一条产品级断链（F1）、一处主题配色不合规（F2），以及 7 类安全/健壮性问题（C/H/M/L）。

### 新增
- **画风 → 渲染页 单一真值** `templates/style-pages.mjs`：`STYLE_PAGES`（12 个画风 → 页面）、`STYLE_RECIPE_IDS`（`?recipe=` 页内提示）、`stylePageFor()` / `styleRecipeIdFor()` / `styleQueryFor()`。未知画风回落**通用场景页**，不再回落占位骨架。新增配方页只需在这里加一行。
- **7 个新配方页**（都实现 `window.renderFrame` + `__ready`，零非确定性 API）：
  - `recipe-glitch.html` — 切片位移 + RGB 通道分离 + 撕裂线 + 滚动扫描带；
  - `recipe-guofeng.html` — 宣纸纤维 + 云纹弧线 + 竖排标题 + 朱印（贴在末字左侧、带边界钳制）+ 金线；
  - `recipe-whiteboard.html` — 手绘矩形/箭头/圆圈/下划线，抖动由 `hash01` 驱动（无 RNG）；
  - `recipe-threed.html` — 等距投影 `project()`（`ISO_X=cos30°`），单位坐标 + 顶面高光扫掠 + 环绕光源；
  - `recipe-screencast.html` — 编辑器面板 + 逐 token 布局 + 打字计数 + 闪烁光标；
  - `recipe-flat.html` — 预排版扁平插画，色带贴合标题宽度，`ease.outBack` 落入；
  - `recipe-minimal.html` — `fade + 12px 上浮`，规则线擦除，说明文字留在 HUD 之下。
- **测试**：`scripts/test-style-pages.mjs`（14 断言，纯 Node：枚举对齐、文件存在、页面契约、无 RNG、回落、nl2spec 端到端、plan 通过）；`scripts/test-style-pages-render.mjs`（28 断言，真机 Chrome：7 页 × 16:9/9:16 双画幅、非空白、同参确定、竖屏真重排哈希不同）。
- **死导出审计** `scripts/audit-exports.mjs`：扫描每个 `export` 的生产调用点，输出死导出清单（v2.3.1 用它确认 `motion.js` 已 0 死导出）。
- **API 跨源白名单**：`node server/api.mjs --cors <origin[,origin]>`。

### 修复
- **F1（产品级断链）**：`?recipe=` 是死参数——`segment.html` 从不读它，于是 `cyber-glitch` / `ink-wash` / `guofeng` 等所有画风出片都是占位骨架（"替换 drawScene() 开始做真正的画面"）。现在 `nl2spec` / wizard 按 `style-pages.mjs` 填 `style.page`，且 `templates/spec.mjs` 会校验页面存在。已用一条国风片端到端复核：style 段渲染的是竖排标题 + 朱印 + 云纹的真实国风页。
- **F2（配色不合规）**：`aqua-morandi` / `graphite-signal` / `claude-light` / `crimson-theater` 四主题的 accent 过不了 APCA。修在 `content/combos.json` 的 `_meta.accentFix`（含每个颜色的取值理由），`nl2spec` 从数据读取而不是再抄一份硬编码表。
- **F3（产品级断链，比 F2 更严重）**：`look.accentOverride` **从来没有到达任何页面**——页面只读 `?theme=<id>`，`themeFromURL()` 也不认 accent。后果有两个：① F2 的 accentFix 只让 lint 闭嘴，画面仍是原配色；② `cvs brand apply` 写入的品牌色在成片里根本不出现。修法：`normalizeAccentOverride()` → `specToTimeline.meta.accent` → `buildPlan` 把 `?accent=` / `?accentInk=` / `?accentSoft=` 拼进**每一类段**的 URL（opening/card/style/more/flash/ending）→ `themeFromURL()` 读回并调用 `accentOverride()`。无覆盖时 URL 不变，旧成片逐像素不变。实测同一页带/不带 `?accent=#00d4ff`：**76.6% 像素不同**（背景/辉光/HUD 都派生自 accent），确认这条通路此前是彻底断的。
- **C-1 路径逃逸**：`rounds[].id` 直接变成段文件名与 ffmpeg concat 清单的一行，`../` 可写越 `outDir`。加 `SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/`，非法报 `E_ROUND_ID`。
- **C-2 换行注入**：同一个闸门顺带挡掉 id 里的换行/引号/空格——它们会往 concat 清单里注入额外条目。
- **H-1 远程页面（SSRF）**：`*.page` 会被渲染器当 URL 直接 navigate，`http(s)://…` 可探测内网。现在默认拒绝（`E_PAGE_REMOTE`），要开须显式 `render.allowRemotePages: true`。
- **H-2 绝对路径逃逸**：`path.resolve(root, p)` 遇到 `/x` 或 `C:\x` 会忽略 root。抓 POSIX/盘符/UNC 三种形态，报 `E_PAGE_ABS`（纯正则实现，spec.mjs 可在浏览器跑）。
- **M-1 通配 CORS**：API 此前回 `Access-Control-Allow-Origin: *`，任何网页都能对 `127.0.0.1:5190` 灌任务、读 spec 与日志、下载成片。改为**默认同源**（不发 CORS 头），需要跨源用 `--cors <origin>` 白名单（带 `Vary: Origin`）；`OPTIONS` 预检只在白名单命中时回 CORS 头。
- **M-2/M-3 资源上限**：`MAX_QUEUE=32`（队满回 `429 E_QUEUE_FULL`）、`MAX_JOBS=200` + `evictOldJobs()`（只淘汰已结束的）；spec 侧 `MAX_FLASH_COUNT=256`（`E_FLASH_MAX`）、`MAX_SEGMENT_SECONDS=600`（`E_STRUCTURE_MAX`）、`MAX_TOTAL_FRAMES=18000`（`E_DURATION_MAX`）。此前 `flash.count=100000` 或 `structure.round=1e9` 能排出天文数字的段与帧。
- **M-4 绝对路径泄露**：错误响应里的本机目录替换成 `<path>`（`scrubMessage()`），既保住"是哪个文件"又不暴露目录结构。
- **L-1 点文件泄露**：`app/canvas/serve.mjs`、`app/script/serve.mjs`、`templates/render-segment.mjs` 三个静态服务器此前可 `GET /.git/config`。现在路径任一段以 `.` 开头即 404（`.` / `..` 仍放行给归一化处理）。
- **内部缺陷**：`server/api.mjs` 的 `416 Range Not Satisfiable` 分支把 `req` 传成了第 5 个参数（`{}` 占了 `req` 位），CORS 头在该分支失效。已修正实参顺序。

### 变更
- `templates/spec.mjs` 新增闸门常量导出（`MAX_FLASH_COUNT` / `MAX_SEGMENT_SECONDS` / `MAX_TOTAL_FRAMES`）、`normalizeAccentOverride()` 与 `render.allowRemotePages`（默认 `false`）。
- `templates/themes.js` 的 `themeFromURL()` 现在接受 `?accent=` / `?accentInk=` / `?accentSoft=`（只影响传入覆盖的页面；不传时逐字段原样返回）。
- `segmentHash` 加入 `accent`：换品牌色/换 accentFix 必然重渲染，缓存不会错误复用。
- **golden 基线**：`fixtures/golden/mixed` 的 2 张静帧（`02-t2.500` / `03-t4.250`）按新行为重生成——它是唯一带 `accentOverride` 的 fixture，此前那行配置被静默忽略。`card` / `cyber` 的 7 张哈希不变；`manifest.json` 里的 `page` 字段顺带补上了 v2.3 的 `?mp=standard`（元数据此前滞后，不影响哈希比对）。
- `bin/cvs.mjs` / `package.json` 测试清单加入 `test-style-pages.mjs`、`test-style-pages-render.mjs`、`test-spec-security.mjs`、`test-accent-route.mjs`。

### 实测
- **F1 端到端**：国风片编译通过，style 段帧里是真实国风画面（竖排标题 + 朱印 + 云纹），不是占位骨架。
- **F3 端到端**：同一页 `?theme=coral-noir` 与 `?theme=coral-noir&accent=%2300d4ff&accentInk=%23001016` 的静帧，**76.62% 像素不同**（`max channel-sum delta 478`），证明覆盖值真的进了渲染；`cvs brand apply` 的品牌色现在出现在每个段的 URL 与页面的 `THEME.colors.accent` 里。
- **golden**：`card` / `cyber` 7 张哈希不变，`mixed` 2 张按新行为更新（唯一带 accentOverride 的 fixture）；`npm run golden` 与 `--selfcheck` 均 9/9。
- **渲染一致性交叉验证**：同参下「静帧 PNG」与「视频帧」逐像素对齐——`coral-noir` 静帧 = 直渲视频帧 30（ink bbox `w=1600`）；`celadon-paper` 静帧 = `render-batch` 视频帧 30（`w=1552`），平均绝对差 `2.81`（x264 有损编码的正常振铃，锐边处最大 34，占比 0.004%）。批量 worker 路径与单进程路径产出一致。
- **测试**：画风页真机渲染 28 断言、画风契约 14 断言、spec 安全闸门 25 断言、强调色通路 19 断言、API 16 断言全过；`audit-exports` 确认 `motion.js` 死导出 0。

## [v2.3.0] - 2026-11-12 — 动效档位接入管线（motion profile → spec → plan → 页面）

### 新增
- **动效档位表** `templates/motion-profile.mjs`：4 档 `calm` / `standard` / `dynamic` / `maximal`，每档给出转场类型、主/次缓动、弹簧预设、stagger、动态文字模式、冲击/抖动/白闪/缓推倍率、颗粒与扫描线强度、模糊上限。档位是**乘数**，不是第二套实现。
- **自动推导**：按「视频类型 kind × 画风 style」推导档位（style 特例 > kind 默认 > 回落 standard），显式 `look.motion` 永远优先。赛博像素/赛博故障 → maximal，发布会/极简/水墨 → calm，知识科普 → standard。
- **传递管线**：`spec.look.motion` → `specToTimeline` 推导 → `meta.motion` → `buildPlan` → 每页 URL 的 `?mp=<level>`；页面按档位名自行展开参数（档位表改了旧 URL 也按新表解释）。
- **质感层上线**：`motion.js` 的 `drawGrain` / `drawScanlines` / `drawPaperTexture` 首次被生产页面调用（`segment.html` / `big-card.html`），只由档位驱动。
- **CLI**：`cvs motion list | show <level> | derive --kind --style | matrix`，可查档位与推导矩阵。
- **测试**：`scripts/test-motion-profile.mjs`（29 条）覆盖档位表结构、推导规则、URL 往返、spec 校验、plan 传递、段哈希含档位、standard 逐位等价 v2.2、nl2spec 推导。

### 变更
- **缓动统一为一份真值**：`templates/motion.js` 是唯一实现。此前 `common.js`、`recipes/util.js` 各抄了一份 `ease`（三份数值逐点相同）；现在两者都改为 re-export。`common.js` 与 `motion.js` 的 `ease` 现在是**同一个对象**。
- **spec**：`look.motion` 字段（`null` = 自动推导）；非法值报 `E_MOTION`。schema 同步。
- **段哈希**：`segmentHash` 加入 `motion`，换档位必然重渲染（缓存不会错误复用）。
- `createSegment` 的 `scale` 改写为与 v2.2 原式同构（`1.13 - 0.13 * impact * k`），避免最后一位浮点差。

### 修复
- `createSegment` 档位化后 `scale` 曾写成 `(1 + 0.13*impact) - ...`，与 v2.2 原式在最后一位不同（`1.1287850546264648` vs `...46`）。已改为同构写法，15005 个采样点逐位相同。

### 实测
- **零像素变化**：`segment.html` 与 `big-card.html` 的「无 query」与「`?mp=standard`」渲染 SHA-256 完全相同；D7 冻结基线仍成立（`test-reflow-pages` 51/51）；golden 9/9 静帧逐字节一致。
- **档位生效**：4 档在同一页产生 4 个不同哈希。
- **缓存正确性**：换档位后 5/5 段重渲染（`skipped=5`），缓存条目 5 → 10；同档位热编译 5/5 命中，1.62 s。
- **端到端**：`maximal` 档 5.5 s / 165 帧 / 1920×1080 / 30fps 编译成功。
- 测试：`npm run test:all` EXIT=0（新增 29 条）；画布 48、参考图上传 12、竖屏重排 51、配方 92、API 11 全部通过。

## [v2.2.0] - 2026-11-11 — 批渲染 / 竖屏重排 / 任务 API / 黄金回归 / 品牌包 / 配方 13–16

### 新增
- **批渲染 worker**：`templates/render-batch.mjs`；`render-farm` 默认把选中段按 shard 交给 N 个 worker，每个 worker 只付一次静态服务器 + 一次浏览器启动；`--legacy` 保留逐段进程模式；段缓存语义不变。
- **多画幅重排**：`big-card.html` / `segment.html` 按视口自适应（横 / 竖 / 方），竖屏是真正重排不是缩框；16:9 输出位级不变（基线哈希见 `docs/DECISIONS.md` D7）。`scripts/test-reflow-pages.mjs` 51 断言。
- **任务 API**：`server/api.mjs`（127.0.0.1:5190）：`POST /jobs` 校验并入队、`GET /jobs/<id>` 状态与日志尾、`GET /jobs/<id>/master.mp4`（Range）、`DELETE` 取消、`GET /health`；单队列 + 子进程编译 + `build.log`。
- **评审页**：`app/review/`（5185）播放成片、按时间码写帧级评论（localStorage）。
- **黄金视觉回归**：`fixtures/golden/`（card / cyber / mixed 三项目 × 3 帧）+ `scripts/golden.mjs`（`--update` 写基线、`--selfcheck` 同机双跑比对、默认校验）；CI 追加 `golden` job（自一致校验，避开跨机字体/Chrome 差异）。
- **品牌包**：`content/brand.schema.json`、`content/brands/{tech-dark,example}.json`、`scripts/brand.mjs`（`apply` / `check` / `list`；禁用词、accent APCA、logo 存在性与安全区）。28 测试。
- **配方 13–16**：`templates/recipe-{kinetic,datarace,inkwash,8bit}.html` + `templates/recipes/util.js`；每帧 0.5–2.6ms，92 断言。
- **测试**：`scripts/test-{brand,golden,recipes,reflow-pages,render-perf}.mjs`、`server/test-api.mjs`；`npm run test:all` 现在 206 条纯 Node 测试。

### 修复
- `render-farm` / `render-batch` 在 `outDir` 为绝对路径时与 root 二次拼接，缓存与 manifest 变成 `<root>/<root>/...`，产物与缓存写不出去（回归修复）。
- 批次 worker 的 shard 参数 `1/1` 在 0 基索引下选空段；改为 `0/1`。
- ink-wash 大幅半透明图层的非整数缩放造成帧间抗锯齿抖动；绘制几何取整（跨进程仍位级一致）。

### 实测
- **冷编译** 41s fixture（1230 帧，1080p30）：并发 4 为 **4m30s**，并发 2 为 **4m48s**（改造前逐段进程 9m34s，约 2.1×）；两者产物均 1230 帧、QA 0 fail。
- **缓存重编译**：**1.9–3.2s**，23/23 段命中（含 concat）。
- 黄金回归 9 张静帧（位级）；竖屏 51 断言；配方 92 断言；画布 48 断言；参考图上传 12 断言；纯 Node 206 测试。

## [v2.1.0] - 2026-11-11 — 编译器（spec IR / 段哈希 / 增量编译 / 画布圈选 / 入口）

### 新增
- **spec IR v1**：`schema/project.spec.schema.json` + `templates/spec.mjs`（normalize / validate / migrate / script→rounds），timeline v1 可无损迁移。所有入口只产出 spec。
- **plan 编译器**：`templates/plan.mjs` 在 timeline 帧对齐之上为每段生成 `segmentHash = sha256(plan/engine/page/frames/t0/speed/theme/brand/assets/patches)`，并输出 spec 摘要与 warnings。
- **内容寻址缓存**：`render-farm --cache`，命中 `<outDir>/.cache/<hash>.mp4` 直接复用；实测 23/23 命中时整片重编译 3.9 s。
- **一键编译**：`scripts/compile.mjs` = lint → plan → render → concat → qa；无音轨时走 video-only concat。
- **spec 闸门**：`scripts/spec-lint.mjs` 校验页面存在性、主题真实性、APCA（HUD/大字按实用阈值），并输出 JSON 报告。
- **入口**：`app/wizard/`（8 预设 + 七张卡 + 实时 spec + 下载）、`scripts/nl2spec.mjs`（确定性规则 NL→spec，20 条语料回归）、`content/presets.json`、`content/combos.json`（13×12 兼容矩阵）。
- **画布与编辑契约**：`templates/edit-bridge.mjs` + `__spec/__inspect/__inspectRect/__patch/__patchMany`；big-card 注册 6 个节点（文案/关键词/强调色/版式/编号/品牌），segment 注册 5 个（主副标题/HUD/倒计时/水印）。`app/canvas/` 支持 scrub、点选、Shift+拖拽框选、多选统一改色、schema 面板、patch 导出。48 条契约测试。
- **剧本与版本**：`app/script/` 表格编辑（就地改、超长标红、实时 JSON）、`app/versions/` localStorage 版本树 + 并排 diff + 恢复；30 条模型测试。
- **素材与批量**：`scripts/assets.mjs`（sha256 + ffprobe + 注册表）、`scripts/variants.mjs`（笛卡尔变体矩阵 + manifest）、`templates/reflow.mjs`（16:9→9:16/1:1 spec 级重排，非裁切）。
- **素材摄取**：`ingest/` 提供 ffprobe、场景切分、静音检测、可选 ASR 适配、打分选段、EDL、`edlToScript` 生成合法 spec；22 条纯函数测试。
- **第 12 套画风**：`templates/styles/cyber-pixel.js` + `templates/cyber-pixel.html`（量化/Bayer 抖动/扫描线/色差/CRT/辉光，全为 t 的纯函数）；`references/long-form.md` 41 s 单风格三幕编排规则。
- **参考图**：`scripts/from-reference.mjs`（ffmpeg 解码 + OKLab k-means + 主题色板最近邻 + APCA 闸门 + top-3 候选），支持 `--spec` 合并进 `look`；`scripts/ref-core.mjs` 抽出 Node/浏览器共用核心；Wizard 支持直接拖入/选择参考图，浏览器内采样并写 `meta.reference`。29 条真图 + 11 条核心 + 12 条端到端回归。
- **统一 CLI**：`bin/cvs.mjs`（new / ref / lint / plan / build / variant / ingest / wizard / canvas / script / versions / test / doctor），支持 `./project.spec.json` 默认值。
- **CI**：`.github/workflows/compiler.yml` 跑全部纯 Node 测试 + spec 闸门 + plan + CLI 冒烟。
- **测试入口**：`npm run test:all`（178 条零依赖测试）、`test:browser`（48 条画布契约 + 12 条参考图上传 + 赛博像素确定性）、`dev:wizard|canvas|script|versions`。

### 变更
- 默认流程仍是 timeline v1；spec v1 为新增编译层，旧项目不传 spec 时行为不变。
- `shared/fonts/`（32 MB 生成物）加入 `.gitignore`，由 `bash arm.sh` 重建。

### 实测
- 41 s fixture：1230 帧 / 1920×1080 / 30 fps；冷编译 9m34s@4（Chrome 启动争用 + 1 次瞬态 CDP 超时），缓存命中后重编译 3.9 s；QA 10 pass / 1 warn（无音轨）/ 0 fail。
- 赛博像素：3 张静帧同 t 两次渲染 PNG sha256 完全一致；1 s 段 30 帧。

## [v2.0.0] - 2026-11-11 — Studio 升级（时间轴 / 零依赖渲染 / 并行 / 质检 / OKLCH）

### 新增
- **时间轴单一真源**：`templates/timeline.mjs` 校验 `timeline.json`，按 `round(t×fps)` 吸附帧边界，生成 `out/plan.json` + `out/segments.txt` + cue sheet。30 fps 下 0.25 s 闪段自动变成 8/7/8/7 帧，11 轮示例精确 33 段 / 1830 帧 / 61.000 s。规范见 `references/timeline-schema.md`。
- **零依赖渲染回退**：`templates/cdp.mjs` 直接用 Node 内置 WebSocket 驱动系统 Chrome/Edge（`DevToolsActivePort` + flat CDP）；没有 Playwright 也能渲染。`render-segment.mjs` v2 自动选择 Playwright 或原生 CDP。
- **取帧提速**：单 canvas 全屏页面走 `canvas.toDataURL()`（快 30–50%）；DOM 叠加自动回退 `Page.captureScreenshot({optimizeForSpeed:true})`；`--capture auto|canvas|cdp`、`--format jpeg|png`、`--vars`。
- **色彩正确性**：中间片 `in_range=pc → tv`、`bt709/bt709/bt709/tv` 四元标签、`-video_track_timescale 90000`；v1 的色彩标记缺失问题修复。
- **并行渲染农场**：`templates/render-farm.mjs` 一进程/一浏览器/一段，`--concurrency`、`--retries`、`--resume`（ffprobe 帧数对账）、`--only/--kinds/--from/--to/--shard`，写入 `out/render-manifest.json`。
- **平台交付预设**：`concat-and-encode.sh` v2 支持 `master/youtube/bilibili/douyin/xiaohongshu/weixin/archive`，CRF 终编、两遍 `loudnorm`（−14 LUFS / −1 dBTP）、bt709、faststart，concat copy 失败自动归一化重编。见 `references/platform-presets.md`。
- **视频质检**：`scripts/qa-video.mjs` 检查 codec/pix_fmt/尺寸/fps/帧数/色彩/时长/黑帧/冻结（卡片/闪白白名单）/静音/LUFS/可选 VMAF+SSIM/接触表，输出 `qa/qa-video.json`。
- **音频质检**：`scripts/qa-audio.py` 用 numpy/scipy 计算峰值/削波/BS.1770 响度/自相关 BPM/拍网格相位（1/1、1/2、1/4 细分取最优）/cue ±30 ms 对齐（覆盖率计权）/8–16 kHz 高频克制/静音，输出 `qa/qa-audio.json` 与频谱图（matplotlib 可选）。
- **配乐对齐**：`templates/synth_audio.py --plan out/plan.json` 读取 `stats.duration` 与全部 `audio.cues`，生成全片长度并把每个 cue 落到鼓点上；61 s 实测 100% cue 命中 ±30 ms、BPM 120.01、网格命中 95.2%，合成耗时约 5.6 s。
- **OKLCH 色彩引擎**：`templates/color.js` 提供 sRGB↔OKLab↔OKLCH、gamut clamp、`mixOklch`、`derivePalette`、WCAG、APCA（Lc）、`readableInk`。
- **动效库**：`templates/motion.js` 提供闭式解弹簧、Manim 风格 rate function、stagger、keyframe track、`transitionParams`、CJK 避头尾排版、`fitText`、`drawKineticText`、grain/paper/scanlines/RGB split/bloom/halation。`common.js` 重新导出。
- **5 套新主题**：`cyber-neon`、`paper-journal`、`dark-gold-cinema`、`ice-minimal`、`pop-acid`，共 13 套；均通过 WCAG 审计，`theme-audit.mjs` 同时输出 APCA。
- **脚本工具**：`doctor.mjs` 环境体检、`new-project.mjs` 一键脚手架（含可渲染 segments/ timeline.json/ package.json）、`ai-lane.mjs` 可选 AI 素材校验/叠加命令、`test-core.mjs` 15 项纯函数回归测试、`determinism-check.mjs`（同一 t 两次全新浏览器渲染，字节级一致）。
- **文档**：`references/timeline-schema.md`、`motion-and-color.md`、`platform-presets.md`、`qa.md`、`ai-lane.md`；SKILL/README 全面更新。
- **CI**：`.github/workflows/render-smoke.yml` 用 Playwright 容器 + 静态 ffmpeg 渲染 2 s、合成并跑 QA。

### 变更
- `render-segment.mjs` 中间片默认 `CRF 12 / veryfast`（原 `CRF 16 / medium`），最终片由 `concat-and-encode.sh` 一次 CRF 终编，避免固定 3.4 Mbps 2-pass 的体积浪费。
- `concat-and-encode.sh` 默认 `master` 预设（CRF 21 + maxrate + loudnorm），不再固定 2-pass 3400 kbps；位置参数仍兼容。颗粒内容实测：CRF18≈31 Mbps、20≈21、22≈14、24≈9、26≈5.7，CRF24 对 CRF12 中间片 VMAF 96.4，故交付选 22–24。
- `theme-preview.mjs` 联系表按主题数量自适应网格（13 套 5×3），不再假定 4×2。
- `package.json` 升到 2.0.0，新增 `test/doctor/plan/render/qa/qa:audio/theme:audit/ai:init/new` 脚本；Playwright 变为可选。
- 默认主题 `coral-noir` 与 v1 逐值一致；不传 `?theme=` 的旧项目行为不变。

### 修复
- 修复 v1 分段 mp4 无 bt709 标记、播放器可能按 bt601 解释导致偏色。
- 主题颗粒强度从 `grain×3.2` 降到 `×1.5`：1080p 下旧值更像数字噪点，且把 CRF12 中间片推到 90 Mbps。
- 修复 0.25 s×8 闪段在 30 fps 下每段 `round` 造成 1834 帧的累计误差。
- 修复渲染器关闭时静态服务器 keep-alive 5 s 拖尾、Chrome 子进程/临时 profile 延迟退出。

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
