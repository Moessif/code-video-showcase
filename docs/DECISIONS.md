# 冻结决策（C0 之后）

> 集群并行期间，以下接口不得改动。需要变更时先改本文件并在集成时统一处理。

## D1 spec 是唯一真相

- 入口：`schema/project.spec.schema.json` + `templates/spec.mjs`
- 所有入口只产出 spec；`templates/plan.mjs` 是唯一 spec→plan 编译点。
- spec 结构兼容 timeline v1（`version:1` 会自动迁移）。

## D2 段哈希与缓存

- 每段 `segmentHash = sha256(plan/engine/page/frames/t0/speed/theme/brand/assets/patches)`，截 16 位。
- 缓存路径 `<outDir>/.cache/<hash>.mp4` + `.json`（frames）。
- 任何改变逐帧像素的实现变更必须递增 `ENGINE_VERSION`（`templates/spec.mjs`）。

## D3 编辑契约

页面必须实现（仅 canvas 页需要）：

```js
window.__spec    = () => specSnapshot;
window.__inspect = (x, y) => ({ id, role, rect, props, schema } | null);
window.__patch   = (id, props) => diff;   // 改内存 spec → renderFrame(currentT) → 返回 diff
```

- `big-card.html` / `segment.html` 是 Canvas 绘制，**不要用 DOM 命中测试**；在 `renderFrame` 里把可编辑区域注册进 hit map。
- `__patch` 只能改 spec/参数，不得直接改 DOM 或 canvas 像素后不管；必须能通过重新 `renderFrame` 复现。
- 不调用 `__inspect/__patch` 时，行为与现在完全一致。

## D4 文件所有权（并行期间）

| 路径 | 归属 |
|---|---|
| `app/wizard/` `content/presets.json` `content/combos.json` `scripts/nl2spec.mjs` | Wizard |
| `app/canvas/` `templates/edit-bridge.mjs` `templates/big-card.html` `templates/segment.html` `scripts/test-inspect.mjs` | Canvas |
| `app/script/` `app/versions/` `scripts/test-script.mjs` | Script |
| `scripts/assets.mjs` `scripts/variants.mjs` `templates/reflow.mjs` | Assets |
| `ingest/` | Ingest |
| `templates/styles/` `templates/cyber-pixel.html` `references/long-form.md` `references/style-recipes.md` | Content |

**任何人不得修改**：`package.json`、`templates/spec.mjs`、`templates/plan.mjs`、`templates/timeline.mjs`、`templates/render-farm.mjs`、`templates/themes.js`、`scripts/compile.mjs`、`scripts/spec-lint.mjs`、`schema/`。

## D5 零依赖

并行任务不执行 `npm install`；只用 Node 20+ 内置模块与仓库已有文件。浏览器渲染通过系统 Chrome（`CHROME_EXE`）。

## D6 验收

每个任务必须在 Windows Git Bash 下跑通自己的测试命令，并把命令与输出摘要写回报告。测试不得依赖网络。

## D7 多画幅页面契约（v2.2）

- 页面**不得**再硬编码 `1920×1080`。画布尺寸取 `window.innerWidth` / `window.innerHeight`（取整、偶数），缺省回退 1920×1080。
- 布局按 `W/H > 1`（横）、`< 1`（竖）、`= 1`（方）分支；竖屏必须重排，不许把横屏画面整体缩进竖框。
- 默认 16:9（1920×1080）输出必须逐字节不变。基线（**v2.4 重定**，`render-segment --still` 的 JPG SHA-256，jpeg/q92）：
  - `templates/big-card.html` @ t=0.5 → `af48254753aeaa0758b2489b285e259e50d8b876460d43e2ab22b63ba298dc0c`
  - `templates/segment.html` @ t=1.2 → `b39be97209eba14714bd57b9d313779eb3882d4d371c74d6c43aab08bfd8f08e`
  - `templates/big-card.html?first=契约&keyword=基线？&brand=CVS` @ t=0.5 → `416a84f63e44e33266c12f9f7c548ecf10a4ce5b9b246e575c3bc0e6610988d3`
  - `templates/segment.html?title=契约基线&sub=副标题&brand=CVS` @ t=1.2 → `cd9142a5fe5499e316914318ff1b30d769a7235970722117eaec0fd1b1c19641`
- **v2.4 重定的理由（不是回归）**：v2.3.5 有意删掉开发者占位文案（"风格段标题 / 替换 drawScene()"），v2.4 引入排版 token（`templates/tokens.mjs`）改了标题字号。两者都**有意**改变 16:9 像素。重定前做过两步验证：① 用 `git show HEAD:` 取出旧页面渲染，仍能逐字节复现旧哈希 `6915e0bf…` / `16cadad4…`，说明漂移全部来自工作区的有意改动；② 本轮 D3 接线修复（`eff()` 以 `SPEC.params` 为合并基座）对基线**零像素漂移**。
  - 旧基线（v2.2–v2.3.4，仅作历史）：big-card `6915e0bf21ce229725c577f45bdddfe4599b423187553b7f641fde36f477eff0`、segment `16cadad4252c12462cdc92a1c6ca502293e5aed99fc8a595707011c362641905`。
- **为什么加带内容的基线**：旧基线渲染的是**无 `?title/?sub`** 的页面。v2.3.5 之后这一形态几乎只剩 HUD 与背景，冻结它等于冻结一张近乎空白的帧——守不住标题排版，而标题排版正是 D7 要保护的东西。因此每个页面各冻两条：无内容形态 + 带内容形态。
- 命中表 rect 必须跟随新布局；`__inspect` 在竖屏下仍能点中。
- **空文本不注册命中区**（v2.4）：`addTextHit` / `addStampHit` 对空字符串直接返回。否则 D3 会对外宣告一个宽度 0、没有像素的「可编辑目标」，用户改它的颜色看不到任何变化。与 `templates/recipes/util.js` `drawTopMeta` 的既有约定一致。
- `app/canvas` 的 iframe 视口仍是 1920×1080，行为不变。

## D8 渲染核心所有权（v2.2）

- `M-PERF` 独占：`templates/render-segment.mjs`、`templates/render-farm.mjs`、`templates/cdp.mjs`。
- 兼容契约：CLI 参数语义不变（`--page/--out/--duration/--still/--width/--height/--t0/--speed`）；页面 URL 继续追加 `seg/t0/speed/dur`；`--still` 输出文件名不变；段缓存 `<outDir>/.cache/<hash>.mp4` 语义不变。
- 允许新增内部批量/worker 入口，但必须仍能单段调用。
- 其他任务不得修改这三个文件。

## D9 第二轮目录所有权

| 路径 | 归属 |
|---|---|
| `templates/render-segment.mjs` `templates/render-farm.mjs` `templates/cdp.mjs` | M-PERF |
| `templates/big-card.html` `templates/segment.html` `scripts/test-reflow-pages.mjs` | M-REFLOW |
| `server/` `app/review/` | M-API |
| `fixtures/golden/` `scripts/golden.mjs` `scripts/test-golden.mjs` | M-GOLDEN |
| `content/brand.schema.json` `content/brands/` `scripts/brand.mjs` `scripts/test-brand.mjs` | M-BRAND |
| `templates/recipes/` `templates/recipe-*.html` `scripts/test-recipes.mjs` | M-RECIPES |

其余文件（`package.json`、`docs/`、README/SKILL/CHANGELOG）由集成者统一修改。

## D10 批渲染与路径规则（v2.2 定稿）

- `render-farm` 默认 **batch**：把选中段按 shard 分给 `min(concurrency, 段数)` 个 `render-batch.mjs` worker，每个 worker 一个静态服务器 + 一个浏览器；`--legacy` 回退逐段进程。
- worker 启动错峰 `--stagger <ms>`（默认 600，0 关闭），避免 N 个 Chrome 同时冷启动导致 CDP `Page.navigate` 超时。
- 路径规则：`--outdir/--manifest/--cache/--profile-dir` 若为**绝对路径必须原样使用**；只有相对路径才相对 `outDir` 解析。`plan.meta.outDir` 可能是绝对路径，任何 `path.join(root, outDir)` 都是 bug。
- shard 是 0 基索引，合法值 `0/n .. n-1/n`；临时 plan 已按 shard 切好时，worker 一律用 `0/1`。
- 段缓存 `<outDir>/.cache/<hash>.mp4` + `<hash>.json`；命中需帧数一致；`--resume` 与缓存可叠加。
- 黄金回归有两种模式：`--update` 写基线（本地，字体/Chrome 绑定）；`--selfcheck` 同机双跑比对（CI 用，跨机哈希不作判据）。

## D11 动效档位（v2.3 定稿）

- **唯一真值**：`templates/motion.js` 是缓动/弹簧/排版/质感的唯一实现。v2.3 之前 `common.js`、`recipes/util.js` 各抄了一份 `ease`（三份数值逐点相同）；现在三者都改为从 `motion.js` re-export，**零像素变化**。
- **档位表**：`templates/motion-profile.mjs` 提供 4 档 —— `calm` / `standard` / `dynamic` / `maximal`。档位是**乘数**，不是第二套实现。
- **standard = v2.2 行为**：所有乘数为 1（impact/shake/flash/push = 1，grain/scanlines = 0，texture = none）。因此：
  - 不传 `?mp=` → 页面回退 standard → 与 v2.2 **逐像素一致**；
  - `?mp=standard` 与「无 query」的渲染哈希必须相同（已实测）；
  - `createSegment` 的 `scale` 必须写成 `1.13 - 0.13 * impact * k`，不能写成 `(1 + 0.13*impact) - ...` —— 后者会产生最后一位的浮点差。
- **传递路径**：`spec.look.motion` → `specToTimeline` 推导 → `meta.motion` → `buildPlan` 的 `motionParams` → 每页 URL 的 `?mp=<level>`。页面按档位名自行展开（档位表改了旧 URL 也按新表解释，不会两套参数各说各话）。
- **推导规则**：`style` 特例 > `kind` 默认 > 回落 `standard`；显式 `look.motion` 永远优先。非法值报 `E_MOTION`（spec 校验）或被丢弃（nl2spec）。
- **进哈希**：`motion` 进入 `segmentHash`，所以换档位必须重渲染，缓存不会错误复用（已实测：换档位后 5/5 段重渲染，缓存条目 5 → 10）。
- **不动 16:9 基线**：D7 冻结哈希在 v2.3 仍然成立（`test-reflow-pages` 51/51、golden 9/9 逐字节一致）。


## D12 画风→页面 与 spec 不可信输入（v2.3.1 定稿）

- **画风→页面是唯一真值**：`templates/style-pages.mjs` 的 `STYLE_PAGES` 决定「某画风用哪个页面渲染」。生成端（`scripts/nl2spec.mjs`、`app/wizard/app.js`）只从这里取页面并填 `style.page`；`?recipe=` 降级为**页内提示**，不参与页面选择。理由：v2.3 审计发现 `?recipe=` 是死参数——`segment.html` 从不读它，于是所有画风都渲染占位骨架（"替换 drawScene()"）。让「谁决定页面」只有一个答案，这类断链才不会再出现。
- **新增画风/配方页的流程**：① 在 `templates/recipe-*.html` 加页面（必须实现 `window.renderFrame` + `window.__ready`，且不含 `Math.random`/`Date.now`/`performance.now`/`requestAnimationFrame`）；② 在 `style-pages.mjs` 的 `STYLE_PAGES`/`STYLE_RECIPE_IDS` 各加一行；③ `node scripts/test-style-pages.mjs` 与 `node scripts/test-style-pages-render.mjs` 必须全过。忘加第 ② 步会被测试抓住。
- **未知画风回落通用场景页**（`GENERIC_PAGE = templates/segment.html`），**不回落占位骨架**。`vertical` 是有意走通用页的例外。
- **spec 是不可信输入**：`spec.json` 可来自用户、表单或 API body，所以 `templates/spec.mjs` 同时是安全边界：
  - `rounds[].id` → 段文件名 + ffmpeg concat 清单的一行 ⇒ 必须匹配 `/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/`（挡 `../` 路径逃逸与 `\n` 清单注入），非法报 `E_ROUND_ID`；
  - `*.page` → 渲染器直接 navigate ⇒ 绝对 URL 默认拒绝（`E_PAGE_REMOTE`，须 `render.allowRemotePages:true`），绝对文件路径拒绝（`E_PAGE_ABS`，POSIX/盘符/UNC 三形态，纯正则以便 spec.mjs 在浏览器跑）；
  - 资源上限 ⇒ `MAX_FLASH_COUNT=256`（`E_FLASH_MAX`）、`MAX_SEGMENT_SECONDS=600`（`E_STRUCTURE_MAX`）、`MAX_TOTAL_FRAMES=18000`（`E_DURATION_MAX`）。上限只挡病态输入，正常片远低于。
- **服务端**：`server/api.mjs` 默认**同源** CORS（`--cors <origin>` 显式放行，带 `Vary: Origin`）；`MAX_QUEUE=32`（队满 `429 E_QUEUE_FULL`）、`MAX_JOBS=200` + `evictOldJobs()`；错误信息经 `scrubMessage()` 抹掉本机绝对路径。理由：API 只监听回环，但通配 CORS 让**任意网页**都能对它灌任务、读 spec/日志、下载成片。
- **静态服务**：`app/canvas/serve.mjs`、`app/script/serve.mjs`、`templates/render-segment.mjs` 的静态服务器对任何以 `.` 开头的路径段返回 404（此前可 `GET /.git/config`）。`.` / `..` 仍放行给现有的归一化+前缀检查处理。
- **强调色覆盖必须走 URL（v2.3.1 新增，修 F3）**：页面只读 `?theme=<id>`，读不到 spec，所以 `spec.look.accentOverride` 必须被 plan 展开成 `?accent=/#…&accentInk=/#…&accentSoft=/#…` 下发：
  - `spec.look.accentOverride`（字符串或部分对象）→ `normalizeAccentOverride()` → `specToTimeline.meta.accent` → `buildPlan` 的 `accentParams` → **每一类段**（opening / card / style / more / flash / ending）的 URL；
  - `themeFromURL()` 读回三个参数并调用 `accentOverride()`；不传时逐字段原样返回主题（旧成片逐像素不变）；
  - `accent` 进 `segmentHash`，换品牌色必然重渲染。
  - 反例（v2.3 之前的真实状态）：`cvs brand apply` 写 `look.accentOverride`、`spec-lint` 拿它算 APCA，但没有任何页面收到它——品牌色在成片里完全不出现，accentFix 只是让 lint 闭嘴。测试 `scripts/test-accent-route.mjs` 锁死这条通路（19 断言）。

## D13 代码生图（v2.3.2 定稿）

- **生图不是新渲染器**：管线本来就是「页面自绘 → Chrome 抓帧 → PNG/JPEG」，`render-segment.mjs --still` 与 golden 回归一直在用这条路。`cvs image` 只是把它变成**产品入口**（命令 + 成套尺寸 + 清单），不引入第二套渲染实现。新增图片能力时必须继续复用 `withRenderer` / `ctx.stills()`，不要另写抓帧逻辑。
- **图与视频同源**：`scripts/image.mjs` 取 **plan 里那条段的 URL**（含 `?theme=` / `?mp=` / `?accent=` / `?recipe=`），不自己拼页面参数。好处是图与成片必然是同一画面（同一份 theme/motion/accent 展开逻辑），也自动获得 F1/F3 的修复。默认段 = 第一条 `style` 段，`--from <segId>` 可指定。
- **帧时间**：`--at auto` = 段落时长的 **78%**（`HERO_FRACTION`），下界 0.2s、上界 `duration - 0.05s`；理由是要"画面已稳、还没收尾"的时刻——太早是入场缩放/白闪，太晚有些页开始收尾。`heroTime()` 是纯函数，有单测。
- **一个浏览器渲所有尺寸**：`ctx.stills({ ..., width, height, outdir })` 每次开新 page（`newPage({width,height})` 换视口），4 张约 16.5s。失败时 `ctx.restart()` 后重试一次（Chrome 冷启动抖动的既有对策）。**不要**为每个尺寸起一次 `render-segment` 进程。
- **空帧判据**：输出 < 8 KB 判为疑似空帧，告警 + 非 0 退出（1080p 纯色 PNG 约 3–12 KB，正常插画 200 KB+）。这是无图像库依赖下的可用近似，不是像素级判据。
- **尺寸是数据不是枚举**：`PRESETS` 是唯一真值；加一个平台尺寸只在这里加一行。spec 的 `format.aspect` 也是由 width/height 反推（`aspectOf`），不是白名单——任意比例都能渲。
- **缓存键**：`image-manifest.json` 记 `segmentHash` + `at` + `width/height` + `format`，这四者构成一张图的内容身份；改了 spec、换了帧时间或尺寸，sha256 必然不同（已有单测）。

## D14 母版、投放版与字幕（v2.4 定稿）

- **母版永远是 master 预设**：`compile.mjs` 的 `encode(scripted, outFile, preset)` 显式收 preset；`master.mp4` 恒用 `master`（1920×1080），平台版用平台预设。之前两者共用同一个 `platform` 变量，`build --platform douyin` 会把母版写成 1080×1920，随后 `qa-video size` 报 FAIL —— **看起来是质检的问题，其实是母版被写错了**。QA 永远量母版。
- **硬字幕只进投放版**：`--burn-subtitles`（或 `render.burnSubtitles`）给平台版烧 `master.srt`；没有平台版时产出 `master-burned.mp4`。烧完写 `<outDir>/.cvs/burned.json`，`delivery.json.subtitles.burnedInto` 据此如实标注。母版保持软字幕。
- **封面是 card 版式**：`cvs image` 的 `cover` 默认取第一条 `card` 段（大卡：first/keyword/brand，无编号/倒计时）；`--cover style` 才回退正片风格帧。`cvs build --cover` 复用同一条路径写到 `<outDir>/images`。
- **覆盖策略是「合并」不是「清空」**：`cvs image` 默认只替换本次请求的尺寸，`--force` 才整目录重出；清单按 preset 合并，每张图记自己的 `page/segment/at`。

## D15 排版 token（v2.4 定稿）

- **唯一真值 `templates/tokens.mjs`**：4 级字阶（`display 0.19` / `title 0.135` / `body 0.034` / `caption 0.019` × 画布短边）+ 单一 `safe()`（左右相等，`x=0.075`，与旧 `safePad` 对齐）。
- **页面只允许「降级」，不允许自定档**：`fitTextSize({ maxSize: typeSize('title', W, H) })` 可以因长标题收缩，但不能把 `maxSize` 写成自己的 `H*0.15`。低分辨率画布（8bit / cyber-pixel）按 `lh/H` 或 `/SCALE` 换算后再量宽。
- **自报探针**：每个页面在布局时调用 `probe(role, px, safe(W,H))` 写 `window.__typeProbe`；`scripts/test-type-tokens.mjs` 用它断言「每页落在自己声明档位 ±15%」与「同档页之间比值 ≤1.1」。
- **`recipes/util.js` 的 `safePad()` 只是 re-export**：改安全区只改 `tokens.mjs`，否则 13 个页面又会各有一套。
- **统一的是字阶与安全区，不是版式**：标题位置（竖排/横排/居中/靠左）属于各页设计差异，不在 token 范围内。

## D16 版本快照与回滚（v2.4 定稿）

- **产物层闭环**：`scripts/versions.mjs` 把 `<outDir>` 里的 master / spec / plan / 清单 / 字幕 / QA / `review.json` 复制进 `<outDir>/versions/vNNN[-label]/`，逐文件记 `sha256 + bytes`，索引写 `versions.json`。
- **回滚先校验再写盘**：`rollback` 先跑与 `verify` 相同的逐文件校验；任何不符 → exit 13 `E_SNAPSHOT_TAMPERED`，**一个字节都不写**。恢复后核对 master sha 等于记录值，不符则 `E_ROLLBACK_HASH`，并写 `rollback.json` 作为回执。
- **审片意见必须能落盘**：`app/review` 的「导出 review.json」把 localStorage 里的评论下载成文件；放进 `<outDir>/` 后 `cvs snapshot` 会收进版本。评论只活在浏览器里等于没有审片闭环。

## D17 页面参数接线与渲染器恢复（v2.4 定稿）

本轮把 4 个「测试红」逐个查到底，发现其中 3 个底下是**真产品缺陷**，不是陈旧夹具。记录契约以免再犯。

- **`SPEC.params` 必须是 patch 的合并基座**。`mergePatches(patches, scope, id, out)` 只叠加 patch，**不读 spec**；传 `{}` 等于让 `params` 变成装饰品。`segment.html` 的 `eff()` 曾从 `hud.title` / `hud.sub` 取值，而这两个字段在 `params.hud` 里根本不存在（副标题存在 `params.title.sub`），于是一路回退到模块常量。非玻璃主题**碰巧**正确（常量恰好等于 URL 参数），玻璃主题的 `DEF.subText` 是材质描述占位文案，导致用户传的 `?sub=` 被静默丢弃、成片上出现「半透明白 · 1px 高光边 …」。修法：`mergePatches(P, 'hud', null, { ...SPEC.params.hud })` + 同理的 `ttl`，并删掉玻璃占位文案。`big-card.html` 同一修法（值逐项相同，像素不变）。
- **`__spec()` 是深拷贝快照，不是活引用**（`edit-bridge.mjs`）。编辑入口只有 `__patch` / `__patchMany`。因此「params 是真相」的可观测断言是：scope 级 `__patch('title', { sub })` 必须覆盖 params，且 `clearPatches()` 后回到 params 值——而不是去改 `__spec()` 的返回值。
- **占位文案不许静默进成片**。`spec.mjs` 在 beat 缺 `copy` 时会填 `CARD_COPY_DEFAULT`（"想做 / 视频？"）。这不是用户内容，所以 `validateSpec` 发 `W_COPY_DEFAULT`（warn 级）把它暴露出来。两处回退必须共用同一个常量，否则文案与警告会各自漂移。
- **浏览器启动超时与页面 ready 超时必须分开**。`--timeout`（默认 120s）是页面预算；`--launch-timeout`（默认 30s）是启动预算。一个起不来的浏览器不该继承页面预算，把失败路径拖成两分钟空等。
- **Windows 上必须杀整棵进程树**。`proc.kill()` 只 TerminateProcess 父进程，renderer/GPU 子进程会活下来占住 `--user-data-dir` 的 singleton 锁。`cdp.mjs` 用 `taskkill /T /F`，并在 `close()` 里等进程真的消失（上限 2s）再返回。
- **复用 persistent profile 前必须删掉旧 `DevToolsActivePort`**。否则等待循环第一轮就读到**上一轮的端口**，立刻 break，然后 `connect()` 对着已死的 ws 重试满 timeout。这是「重启浏览器既失败又慢」的直接原因。
- **`restart()` 换用全新 profile 目录**（`<base>-r<N>`）。崩溃的浏览器可能留下半写的 `Local State`；恢复路径不该押在「上一次死得够干净」上。profile 只是浏览器状态，帧缓存是 `.cache`，换目录不损失任何复用。
- **失败对象的 `logPath` 恒指构建日志**；阶段诊断产物走 `detailPath`（render→`render-manifest.json`、concat→concat 日志、deliver→`delivery.json`）。CLI 独立运行时并没有 `build.log`（那是 API 重定向 stdout 才有的），两个语义共用一个名字会让 `jobView.logPath` 指向 manifest。
- **抓帧失败必须杀掉 ffmpeg**。页面在 `renderFrame` 里抛错时，ffmpeg 仍活着并持有 stdin 管道，`render-batch` 会打印 `[batch] done` 然后**挂住不退出**。`launchFfmpeg` 暴露 `kill()`，`renderVideo` 的 catch 里先 kill 再消费掉必然 reject 的 `done`（否则成为未处理拒绝）。
- **`image --at` 按每张图自己的源算时间**。cover 走卡片段、其余走正片段，时长不同；统一用正片时长算一个 `at` 再套到所有图上，会让 auto 与显式 `--at` 在短段上夹到同一帧。清单逐图记 `at` / `atRequested` / `sourceDuration`。
- **失败的 WebSocket 必须收掉**。`cdp.mjs` `connect()` 的重试循环里，失败的 `new WebSocket()` 从不关闭；留在 CONNECTING/CLOSING 的 socket 会一直持有事件循环句柄，于是进程打印完 `[batch] done` 也退不出去，父进程 farm/compile 永远等下去（API job 卡在 `running`）。catch 里必须 `close()`（有 `terminate` 也调）。`Cdp.close()` 同理。
- **成功构建必须作废旧的 `error.json`**。`compile.mjs` 在 outDir 建好后就删掉上一次的失败记录；`jobView` 也只在 `status !== 'done'` 时投影失败字段。否则成功的 job 会顶着旧错误码（假红）。
- **机器可读报告不许少报失败**。`parseSummary` 两个教训：① 不要用 `m.length` 猜捕获组语义——`N passed, M failed` 只有 2 组，曾被当成「只有 passed」，`failed` 丢成 0；② 不要整段尾部取第一个匹配——测试用例名本身可能含汇总格式字符串，必须**从后往前逐行**找。解析器抽成 `scripts/summary-parse.mjs` 纯模块以便单测（`test-all.mjs` 有顶层副作用，import 就会跑全套）。
- **golden 基线随之重定 2/9 张**：`mixed/02`（aqua-morandi、无 `sub`）与 `mixed/03`（aqua-morandi、`sub=现在就试试`）。重定前目视对照 HEAD 版与新版渲染，确认变化**只是**副标题：02 从材质描述变为无、03 从材质描述变回用户内容；其余 7 张逐字节不变。重定后 `--check` 9/9 相符。**删占位文案必然改像素，这类基线要重定而不是把代码改回去。**
- **浏览器测试启动要重试**：`cdp.mjs` `launchRetry()`（默认 2 次）。全套并发负载下 Chrome 冷启动可能超过单次 30s 预算；「起不来」重试一次通常就好，「页面坏了」重试也没用。与 `renderStill` 的两次尝试约定一致。
- 效果（真机实测）：一个故意抛错的页面，整条失败路径从 **141.7s → 27.3s**，重启从「失败」变成「成功」，报错从误导性的 `renderer is not running` 变成真实页面错误栈，孤儿 chrome 进程从 8 个变成 0 个；失败渲染子进程 **11.8s 退出（status=1）**。回归见 `scripts/test-renderer-recovery.mjs`（21 项）与 `scripts/test-summary-parse.mjs`（13 项）。
