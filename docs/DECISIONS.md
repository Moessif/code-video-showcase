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
- 默认 16:9（1920×1080）输出必须逐字节不变。基线：
  - `templates/big-card.html` @ t=0.5 → `6915e0bf21ce229725c577f45bdddfe4599b423187553b7f641fde36f477eff0`
  - `templates/segment.html` @ t=1.2 → `16cadad4252c12462cdc92a1c6ca502293e5aed99fc8a595707011c362641905`
  （`render-segment --still` 的 JPG SHA-256）
- 命中表 rect 必须跟随新布局；`__inspect` 在竖屏下仍能点中。
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
