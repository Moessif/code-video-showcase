# 优化方案落地状态（v1.0 → v2.4.0）

> 对照 [BACKLOG.json](BACKLOG.json) 的 26 项，逐项说明落地情况。
> 判定口径：**已落地** = 代码 + 回归测试 + 文档齐；**部分** = 主路径可用但仍有明确缺口；**未做** = 未开始。
> 统计：**已落地 26 · 部分 0 · 未做 0**（v2.3.5 时为 15 / 7 / 4）。
> 终验：`test-all --browser --json` **28 套 / 670 passed / 0 failed**；**41s 全片 strict 全链路 BUILD=0**（v2.5.0 收官实测，
> qa-video 19/0/0、qa-audio 6/0/2、cue 对齐 97.1%、deliver 出 master+douyin）；`golden --check` **9/9 相符**；快照/校验/回滚闭环全过。

## 一、v2.4.0 补齐的 11 项

| ID | 项 | 落地位置 | 证据 |
|---|---|---|---|
| P1-03 | 品牌合规进 build | `scripts/brand.mjs`（整包 `brandKit` 快照、`brandFromSpec()`、扫描面扩到 title/description/tags/opening/ending/style.copy、apply 有 error 时 exit 1）、`templates/spec-check.mjs`（`deepValidate` 调 `checkBrand`） | `test-compiler-contract` 6 项新增：命中禁用词 build exit 10、lint 同判、apply exit 1 且仍写 spec、logo 缺失 → `E_LOGO_MISSING`、无 brandKit 不误伤 |
| P1-04 | 失败契约机器可读 | `server/api.mjs` `jobFailure()` + `jobView`（`errorCode/phase/failedSegment/failedSegments/logPath/detailPath/errorPath/artifactPath`，done 不投影失败字段）、`scripts/compile.mjs`（新构建作废旧 `error.json`）、`scripts/test-all.mjs` + `scripts/summary-parse.mjs`（统一汇总为 JSON/TAP） | `server/test-api.mjs` 22/22：done 的 `artifactPath`、渲染失败的 `errorCode/phase=render/logPath=build.log/detailPath=render-manifest.json`、陈旧 error.json 不报假红；`test-compiler-contract` 断言 `--json` 单行可解析、TAP14、计数自洽；`test-summary-parse` 13/13 |
| P1-06 | 排版 token 系统 | `templates/tokens.mjs`（4 级字阶 + `safe()`）、13 个 `templates/recipe-*.html` + `cyber-pixel.html` 全部 import 并写 `__typeProbe`、`recipes/util.js` `safePad()` 委托 `safe().x` | `scripts/test-type-tokens.mjs`：静态 30 项 + 真机 16 项；13 页 titlePx **145..148（比值 1.021）**、左右安全区逐页相等、每页落在自己声明档位的 ±15% |
| P1-07 | 跨平台/版本锁 | `scripts/golden.mjs`（manifest 记 chrome/node/platform/fonts、`--check` 先比环境、`--strict-env`、`--json`）、`scripts/bundle-fonts.mjs --lock-only` → `shared/fonts.lock.json`、`scripts/doctor.mjs` 校验字体锁 | `golden --check --json`：四项 `match:true`、3 specs / 9 stills 全等；`doctor` 新增 `shared/fonts.lock.json`（1187 files, set `410182e5b25c`） |
| P1-08 | 字幕与投放资产 | `scripts/compile.mjs`（`--burn-subtitles` / `render.burnSubtitles`、写 `.cvs/burned.json`）、`scripts/deliver.mjs`（`cover`、`subtitles{srt,vtt,cues,burnedInto}`、`--cover`） | e2e：`[subs] burning master.srt -> douyin.mp4`；`delivery.json.subtitles.burnedInto = ["out/e2e-v24/douyin.mp4"]`，master `burned=false` |
| P1-10 | 安全纵深 | `templates/timeline.mjs` `concatList(plan,{baseDir})`、`templates/concat-and-encode.sh`（清单改写 + `-safe 1`）、`scripts/compile.mjs`（相对清单 + `cwd=outDir`）、`templates/spec.mjs`（`E_ASSET_PATH`）、`templates/plan.mjs`（`E_ASSET_MISSING`） | `test-spec-security` 31/31：assets 闸门 3 项 + concat 清单 3 项（相对名、越界拒绝、源码断言不再有 `-safe 0`）；真机用旧绝对路径清单跑 `concat-and-encode.sh` EXIT=0（自动改写） |
| P1-11 | 新手入口 | `install.sh`、`install.ps1`（UTF-8 BOM）、`app/wizard/index.html` 首屏前提横幅 | 两脚本都做 Node ≥22 检查 → `npm ci` → `doctor` → 打印下一步；无 Node 时 exit 14 并给下载地址 |
| P1-12 | 品牌视觉落地 | `templates/spec.mjs`（`meta.brandKit.logo/fonts` → `meta.logo/brandFont`）、`templates/timeline.mjs`（`brandParams` 带 `logo`/`brandFont`）、`templates/segment.html` + `templates/big-card.html`（`loadBrandLogo()` / `drawBrandLogo()` / `HEAD_FONT`） | `scripts/test-brand-visual.mjs` 3/3：带 logo+brandFont 同帧 sha256 必变（segment 与 big-card 各一条）、logo 缺失渲染 exit≠0 |
| P1-13 | 审片/回滚闭环 | `scripts/versions.mjs` + `bin/cvs.mjs` `snapshot|history|verify|rollback` | `scripts/test-versioning.mjs` 9/9：10 文件逐项 sha256、v002 记录新 master、回滚核对哈希、篡改快照 verify/rollback 均 exit 13 且不动产物 |
| P2-02 | 封面版式与覆盖 | `scripts/image.mjs`（默认 card 版式、`--cover style`、默认合并保留旧批次、`--force` 清目录、清单逐图记 page/segment/at）、`scripts/compile.mjs` `--cover` | `test-image` 新增 4 项；e2e `--cover` 产出 1920×1080 card 封面 1527 KB，`delivery.json.cover` 指向它 |
| P2-03 | 跨机确定性 | 见 P1-07（同一套 manifest 环境指纹 + 字体锁 + `--json`） | `golden --selfcheck` 同机双跑；跨机不一致时不再误报视觉回归 |

## 二、v2.3.5 已落地的 15 项（摘要）

P0-01 占位内容上屏 · P0-02 静音母版 · P0-03 内容级 QA · P0-04 build 门禁 ·
P0-05 缓存/`--resume` · P0-06 平台/变体 · P0-07 API CSRF→SSRF · P0-08 离线/字体/OFL ·
P1-01 `--root` · P1-02 单段动效 · P1-05 文档契约 · P1-09 度量 + `again` · P2-01 安装体积/CI ·
P2-04 doctor · P2-05 版本漂移。证据见 v2.3.5 版 CHANGELOG 与 `test-compiler-contract` 前 17 项。

## 三、v2.4 期间新发现并修掉的缺陷

| 缺陷 | 现象 | 修法 | 证据 |
|---|---|---|---|
| 母版被平台预设污染 | `build --platform douyin` 的 `master.mp4` 是 1080×1920，`qa-video size` FAIL | `encode()` 显式收 preset，master 恒用 `master` | e2e 修复前 18 pass/1 fail → 修复后 19/0/0 |
| screencast 标题压 HUD | 加主标题后与 `STYLE 21 / 23` 重叠 | 标题移到卡片上方，并从可用高度里先扣掉 | 重出图目视确认 |
| `cvs image` 默认封面是正片帧 | 带编号胶囊/倒计时，不适合当封面 | 默认取第一条 `card` 段 | `test-image` 封面 4 项 |
| cyber-pixel 标题字阶错档 | 街机大标题按 `title` 档算，比同片其他页小 | 改用 `display` 档并按画布换算 | `test-type-tokens` 档位断言 |
| `deliver` 找不到封面 | `cover: null` | 三处候选路径 + `--cover` | e2e `delivery.json.cover` 非空 |
| **玻璃主题副标题被占位文案顶掉** | `theme=aqua-morandi&sub=SUBTEXT` 时画面仍是「半透明白 · 1px 高光边 …」，用户副标题被静默丢弃 | `eff()` 以 `{...SPEC.params.*}` 为 `mergePatches` 基座（原来传 `{}`，params 是装饰品）；删掉玻璃 `DEF.subText` 占位文案；`big-card` 同修 | 真机探针三态对比 + `test-inspect`「玻璃主题下 ?sub= 真的进画面」「scope 级 `__patch(title,{sub})` 覆盖 params」 |
| **失败页面让流水线空等 141.7s** | 页面抛错 → 重启浏览器烧满 120s → 报 `renderer is not running`（误导），并留下 8 个孤儿 chrome | 删旧 `DevToolsActivePort`；`taskkill /T /F` 收进程树 + `close()` 等进程消失；`--launch-timeout` 与 `--timeout` 分离；`restart()` 换新 profile | 时间戳实测 **141.7s → 27.3s**、重启成功、真实错误栈、孤儿 8→0；`test-renderer-recovery` 17/17 |
| **抓帧失败 ffmpeg 不死** | `render-batch` 打印 `[batch] done` 后挂住不退出（API 测试 120s 超时） | `launchFfmpeg` 暴露 `kill()`，catch 里 kill 后消费掉必然 reject 的 `done` | 失败 batch 从 EXIT=124（挂死）变 EXIT=1；`test-api` 21/21 |
| **D3 宣告零宽编辑目标** | 无 `?title/?brand` 时 `__hit` 里有宽度 0 的 `title.main`/`hud.stamp`，改颜色看不到变化 | `addTextHit`/`addStampHit` 空文本直接返回（对齐 `util.js drawTopMeta`） | `test-inspect`「无内容时不注册 title.main/title.sub」「命中区里没有零宽/零高矩形」 |
| **`image --at` 在短段上失效** | cover 改用卡片段后 auto 与 `--at 1.0` 夹到同一帧 | 按每张图自己的源算时间并夹到该源时长；清单记 `at`/`atRequested`/`sourceDuration` | `test-image` 7 项（style/card 两源、越界夹取、请求值留痕） |
| **`logPath` 同名两义** | API `jobView.logPath` 指向 `render-manifest.json` 而非构建日志 | CLI 改写 `detailPath`；`logPath` 恒指 `build.log`，兼容旧 `error.json` | `test-api` 断言 `logPath` 匹配 `build.log$`、`detailPath` 匹配 `render-manifest.json$` |
| **`test-all` 少报总数** | `34 tests: 32 passed, 2 failed` 被读成 total=32 | `Ran` 前缀改可选 + `total===passed+failed` 自洽兜底 | `test-compiler-contract` 新增计数自洽断言 |
| **占位文案静默进成片** | beat 缺 `copy` 时填「想做 / 视频？」，无任何提示 | 两处回退共用 `CARD_COPY_DEFAULT`；`validateSpec` 发 `W_COPY_DEFAULT`（warn） | `test-spec-security` 新增 3 项 |
| **D7 基线陈旧（不是回归）** | 两个冻结哈希对不上 | 先验证 HEAD 页面仍复现旧哈希、本轮修复零像素漂移，再重定；另补带内容基线 | `docs/DECISIONS.md` D7 附注 + `test-reflow-pages` 4 条基线（55/55） |
| **失败 WebSocket 泄漏 → 进程不退出** | `[batch] done` 已打印、错误正确，但 farm/compile 永远等，API job 卡 `running` 到 120s 超时 | `connect()` catch 里 `close()`（+`terminate`），`Cdp.close()` 同理 | `test-renderer-recovery`「抛错页面的渲染进程真的退出了」11.8s/status=1；`test-api` 22/22 |
| **成功 job 顶旧错误码（假红）** | 上次失败的 `error.json` 留在成功产物旁，`jobView` 不看状态就投影 | 新构建开始即删旧记录；`status==='done'` 不投影失败字段 | `test-api`「done job 不受陈旧 error.json 影响」 |
| **报告少报失败断言** | `N passed, M failed` 被读成 failed=0；用例名里的格式样本被当成汇总 | 每种格式显式标语义 + 从后往前逐行扫；抽成 `summary-parse.mjs` 纯模块 | `test-summary-parse` 13/13；`test-all --json` 逐套计数与子进程输出一致 |
| **`history`/`verify` 忽略 `--spec`** | `cvs verify v001 --spec X` 跑去 `out/` 找，报 `E_VERSION_UNKNOWN` | `list`/`verify` 与 `snapshot`/`rollback` 统一支持 `--spec`/`--outdir` | `test-versioning` 10/10（新增非默认 outDir 用例）；e2e `history/verify/rollback --spec` 全过 |
| **重启后卡住日志全静默** | 页面 ready 等待静默到 120s 才报错，看起来像挂死 | `cdp waitFor` 超 30s 先告警一次（`warnAfter`/`warn`） | 日志出现 `[wait] … still pending`；失败 job 测试预算改为 300s（实测 75s，负载下翻倍） |
| **golden 2/9 张因删占位文案而变（有意）** | aqua-morandi 的 `mixed/02`/`03` 哈希对不上 | 目视对照 HEAD 与新版确认变化只是副标题，再 `--update` 重定 | 重定后 `golden --check --json` 9/9 相符、环境四项 match；其余 7 张逐字节不变 |
| **浏览器测试负载下瞬时失败** | 全套并发时 Chrome 冷启动超 30s，`test-wizard-ref` 偶发 exit 1 | `cdp.mjs` 新增 `launchRetry()`（2 次），4 个直接调 launch 的测试改用 | 单跑 12/12；全套复跑验证 |

## 四、诚实边界

1. **41 秒全片 e2e 已真跑通过（v2.5.1 终态）**：`build fixtures/mini-41s/spec.json --platform douyin --strict --concurrency 4` **EXIT=0**。qa-video **19/0/0**（1230 帧、41.000s、bt709、黑帧/冻结/静音全零）；**qa-audio 8 pass / 0 warn / 0 advisory / 0 fail**（beat grid 76.7%、HF restraint +9.26 dB、cue 35/35=100%、peak −1.36 dBFS、−13.84 LUFS）；`cvs deliver` 出 master+douyin+14 条字幕 cue，`runs.jsonl` 记 `exit:0, qaPass:true`。**v2.5.0 时的两条 advisory（beat grid 47.4%、HF −1.93 dB）已清零**（详见 v2.5.1 CHANGELOG）。
2. **跨机确定性是「可检测」，不是「已保证」**：manifest 记录 Chrome/字体指纹，环境不一致时跳过哈希比对并告警。真正跨机逐字节一致仍需固定镜像（`docker/Dockerfile` 已就位，未在第二台机器实测）。
3. **字体锁只记集合哈希**：`shared/fonts.lock.json` 记 1187 个文件名与字节数、整套 set sha256；不逐文件记 sha256（体积考虑）。
4. **字幕烧录依赖 libass**：ffmpeg 未编译 `subtitles` 滤镜时 exit 13 `E_BURN_SUBTITLES`，不会静默跳过。
5. **13 页统一的是字阶与安全区，不是版式**：标题位置（竖排/横排/居中/靠左）是各页设计差异。
6. **`SKILL.md` 39.5KB → 25.6KB**（目标 25KB）：§5–§9/§12 压缩为速查 + 指针；完整表格与铁律在 `references/`（themes/style-recipes/audio-recipes/render-pipeline/big-card 均验证承载；61s 剪辑表迁入 `reference-film-analysis.md` 末节）。
7. **频谱图零依赖**：v2.5.1 起用纯 numpy + stdlib `zlib` 写 PNG，不再依赖 matplotlib（原 Anaconda/NumPy 2.x ABI 冲突导致的 skip 告警已消除）。
8. **未 commit**：所有改动在工作区，`git status` 可查。
9. **重启后首页慢的根因未定位**：浏览器重启后的第一个页面在负载下偶尔迟迟不 ready。已做到「可观测（30s 告警）+ 安全失败（`--timeout` 后报错，不挂死）」，但**为什么慢**还没查清。失败 job 测试预算因此从 120s 提到 300s（独立实测 75s，负载下翻倍；旧预算恰好等于渲染器 `--timeout`，两者同时到点，看起来像挂死）。
10. **D7 基线重定过一次**：属有意变更（v2.3.5 删占位文案 + v2.4 排版 token）。重定前验证 HEAD 页面仍复现旧哈希、本轮 D3 修复零像素漂移；旧哈希留在 DECISIONS D7 作历史。另补了带内容的基线，因为无参数形态在 v2.3.5 后几乎只剩 HUD，守不住标题排版。
11. **GitHub 上游仓无写权限**：本机 gh 两个账号（NaIWaniubi / curry66666666）对 `Moessif/code-video-showcase` 均为 READ。已 fork 到 NaIWaniubi 并推全部分支、开 PR #1；上游合并需 owner 操作。gitee 为主线同步远程。
