# code-video-showcase · 优化方案 v1.0

> 输入：[BETA-REPORT-v2.3.4.md](BETA-REPORT-v2.3.4.md)（76 条意见）+ `BACKLOG.json`
> 口径：26 个去重项 = 8 P0 + 13 P1 + 5 P2；工时为单人流工程日（±40%）
> 原则：**先让绿灯可信，再让默认片能交，最后才加能力。** 任何「新功能」不得插队到 P0 之前。

---

## 0. 决策摘要

### 0.1 三条路线，先选一条

| 路线 | 目标用户 | 现状 | 本轮结论 |
|---|---|---|---|
| **A · Agent 视频编译器** | 带 Claude Code / ZCode 的开发者 | 已能跑通，事实用户 | **主路线**：把契约、失败、缓存做对 |
| **B · 品牌/投放工具** | 品牌运营、市场 | 有品牌色与变体雏形，缺平台/字幕/清单/回滚 | 付费验证后再投入，先修 P0 公共项 |
| **C · 剪辑师的插入件工厂** | 职业剪辑/动效 | 有确定性渲染，缺段级控制/转场/音频 | 延后到 M2，先做 P1-02 + 段级时长 |
| **D · 小白一键出片** | 无技术创作者 | wizard 停在 spec，安装要 Node | 暂缓；要么做实，要么撤掉「小白入口」承诺 |

> **建议**：本轮只承诺 A。B/C 的缺口写进路线图，不用「半成品功能」占位。若两周内出现 ≥3 个非作者的真实成片，再评估 B。

### 0.2 本轮的三个硬目标

1. **假绿归零**：占位页、静音片、拼错主题、改文案不重渲——四类「成功但错」必须变成非零退出。
2. **默认片可交付**：`cvs new` 一句话 → `cvs build` → 有音轨、有真实标题/品牌、平台版不互相覆盖。
3. **失败可编程**：CI 能从 `errorCode` 分流，Agent 能从 SKILL 查到「报错→唯一动作」。

### 0.3 明确不做（Out of Scope）

| # | 不做 | 理由 |
|---|---|---|
| N1 | 多轨 NLE、关键帧曲线、逐帧 inpainting | 与「编译器」定位冲突；AE/PR 已覆盖 |
| N2 | 素材通道（实拍/屏录进画面） | 半成品承诺比缺失更伤；要么单独立项 XL，要么从 README 删除 |
| N3 | 小白托管版 / 安装器 | 获客成本未验证；先把 Agent 路线跑出留存 |
| N4 | 生成模型（文生视频/图生视频/克隆音） | 与「纯代码、可复现」的核心卖点互斥 |

---

## 1. 打分口径

```
ICE = impact(1-10) × frequency(1-10) × confidence(1-10) ÷ effort权重
effort权重：S=1（<0.5d）  M=2（0.5–2d）  L=4（2–5d）  XL=8（>5d）
跨角色修正：同一根因 ≥3 个角色命中 → 优先级升一级（不重复计分）
```

- **impact**：对目标用户完成核心任务的阻碍程度
- **frequency**：每次使用必踩=10，特定场景=5–7，极少=1–3
- **confidence**：有代码/实测证据=9–10，仅推理=≤5

---

## 2. 本轮必修 · P0（8 项，≈10 人日）

### P0-01 默认成片把开发者占位符交给客户

- **现象**：`cvs new` 生成的 spec，开场/结尾走 `templates/segment.html`，页面常量是 `风格段标题` / `替换 drawScene() 开始做真正的画面`；卡片 `brand` 缺省字面量 `{{BRAND}}` 并 `fillText` 上屏；`meta.cta` 写进 spec 但无模板消费。
- **量化**：fixture 10 个页面引用中 8 个是占位页；41 秒片里 32 秒是同一张占位画面。
- **证据**：`templates/segment.html:86-87`、`templates/big-card.html:67,749`、`templates/segment.html:77`、`templates/timeline.mjs:185,269`、`app/wizard/index.html:139-148`。
- **改法**：
  1. schema 增 `meta.title/description/tags`、`opening.title/sub`、`rounds[].style.copy{title,subtitle,caption}`；
  2. `plan` 把上述字段展开成段 URL 参数；页面读参数，缺省回退 `meta.name`，**绝不回退开发者常量**；
  3. `lint` 对占位标题与 `{{BRAND}}` 报 **error**（`E_TITLE_PLACEHOLDER` / `E_BRAND_PLACEHOLDER`），`build` 阻断；
  4. 第 07 张 CTA 卡：接线到 ending 或删除；lint 增 `E_CTA_UNUSED`。
- **验收**：
  - Given `cvs new "…"` 的 spec 未填 title，When `cvs lint`，Then exit 1 且含 `E_TITLE_PLACEHOLDER`；
  - Given 填好 title/brand，When `cvs build`，Then t=1s 与 t=end-1s 静帧不含 `风格段标题` / `替换 drawScene()` / `{{BRAND}}`。
- **工时**：M（1.5d） · **ICE**：500 · **跨角色**：4（T01/T02/T04/T05）
- **来源**：F-T01-03, F-T01-04, F-T02-03, F-T05-02, F-T05-05

### P0-02 静音母版也能绿灯通过

- **现象**：`compile.mjs` 只有传 `--audio` 才走 `concat-and-encode.sh`；否则 `ffmpeg -c copy` 纯视频。QA 只跑 `qa-video`、不带 `--strict`，无音轨仅 WARN，exit 0。`SKILL.md` 把 `build` 当统一入口却未提 `--audio`。
- **证据**：`scripts/compile.mjs:93,100-108,112-116`、`scripts/qa-video.mjs:116,207`、`SKILL.md:35`。
- **改法**：
  1. `spec.audio` 存在时 build 自动调 `synth_audio.py` 并 mux；
  2. 无音频必须 `--no-audio` 显式豁免，否则 `E_AUDIO_REQUIRED` exit 1；
  3. `qa-audio.py` 纳入 build 链路；
  4. SKILL 的 build 行补 `[--audio audio/mix.wav]`，§1 交付物表加「必须含 a:0 音轨」。
- **验收**：Given 无音轨 master，When `cvs build`（未加 `--no-audio`），Then exit≠0 且 stderr 含 `E_AUDIO_REQUIRED`；Given 带 `--audio`，Then `ffprobe` 有 `codec_type=audio` 且 `qa-audio.json.summary.fail==0`。
- **工时**：M（1d） · **ICE**：500 · **跨角色**：2（T01/T04）+ T05
- **来源**：F-04-01, F-T01-09

### P0-03 QA 只验容器，不验内容

- **现象**：`qa-video` 的 10 项断言全是容器级（codec/pix_fmt/size/fps/frames/colour/black/freeze/silence/loudness），不读 page、不截图比对；占位 fixture 拿 10 pass / 0 fail。音频侧 `qa-audio` 的 cue 分母只算「±0.15s 内有 onset」的 cue，最坏 16% 即可 PASS；beat grid 自适应择优。
- **证据**：`scripts/qa-video.mjs:84-164`、`scripts/qa-audio.py:320-352`、`out/mini-41s/qa/qa-video.json`（`{"pass":10,"warn":1,"fail":0}`）。
- **改法**：
  1. `plan` 阶段 `E_PLACEHOLDER_PAGE`（page 落在 `segment.html` 且 `style.recipe` 为空 → error）；
  2. `qa-video --expect-pages`：逐段断言 page basename，报告列出「未使用真实配方的段」；
  3. `qa-audio`：分母用全部 cue（缺 onset 记 miss）、网格固定为用户声明细分、峰值门限与合成器共用常量；
  4. 交付态默认 `--strict`。
- **验收**：
  - Given 当前 fixture，When `qa-video --strict`，Then exit 1 且报告含 `placeholder-page FAIL`；
  - Given 55 cue 中 20 个无 onset，When `qa-audio`，Then `align_rate ≤ 35/55` 且整体 FAIL。
- **工时**：S（0.5d） · **ICE**：1000（最高） · **跨角色**：3（T04/T01/T05）
- **来源**：F-05-02, F-05-09, F-T01-07

### P0-04 `cvs build` 不是门禁

- **现象**：`bin/cvs.mjs` 宣称 `build = lint → plan → render → concat → qa`，但 `compile.mjs` 只 import `plan.mjs` / `timeline.mjs`，无任何 spec-lint / APCA 调用。实测 `look.theme=definitely-not-a-theme` 时 `build --dry-run` exit 0，`lint` exit 1。
- **证据**：`bin/cvs.mjs:102-103`、`scripts/compile.mjs:15-16`。
- **改法**：抽 `validateSpecDeep(spec,{root})`，`lint` 与 `build` 共用；build 失败输出 `[error] [E_THEME_UNKNOWN] path: message`；同步修正 help。
- **验收**：Given 非法 theme，When `cvs build spec --dry-run`，Then exit 1、stderr 含 `E_THEME_UNKNOWN`、不生成 plan。
- **工时**：S（0.5d） · **ICE**：720 · **来源**：F-03-01

### P0-05 缓存与 `--resume` 会「成功返回旧画面」

- **现象**：
  1. `segmentHash` payload 只有 page 路径、时长、theme/motion/accent/brand、assets/patches，**不含页面文件内容**；`ENGINE_VERSION` 冻在 1，HEAD 刚改过 `recipe-greatwall.html` 19 行仍未 bump → 命中旧缓存。
  2. `compile.mjs` 永远带 `--resume`；`render-batch.mjs` 在 cache miss 后仅凭帧数相等就 `skipped`，并把旧 mp4 以新 hash 写回缓存。
- **证据**：`templates/plan.mjs:24-47`、`templates/spec.mjs:18`、`scripts/compile.mjs:82`、`templates/render-batch.mjs:219-229`、`templates/render-farm.mjs:178-183`。
- **改法**：
  1. `pageHash`（页面 + `@import`/recipe 依赖的 sha256）进 `segmentHash`；
  2. resume 命中前比对缓存 meta 的 `hash` 与段 hash，不同强制重渲；
  3. 每次像素变更 bump `ENGINE_VERSION`，CI 断言版本变更；
  4. 提供 `--no-resume`。
- **验收**：
  - Given 只改模板一个字节，When 重新 plan，Then 受影响段 hash 变化且 render-farm 显示 cache miss；
  - Given 只改文案不改时长，When 再次 build，Then 该段 status ≠ skipped/cached 且帧 sha256 变化。
- **工时**：M（1.5d） · **ICE**：405 · **跨角色**：2 · **来源**：F-03-04, F-04-02

### P0-06 平台预设只写不读 + 变体互相覆盖

- **现象**：`spec.render.preset` 声明 6 平台，`compile.mjs`/`plan.mjs` 无任何消费（grep 0 命中），平台参数只存在于 `concat-and-encode.sh`；`build` 永远出 master。`expandVariants` 从不写 `render.outDir`，所有变体共用一个目录，后一条覆盖前一条 master。
- **证据**：`templates/spec.mjs:80`、`scripts/compile.mjs:93-107`、`scripts/variants.mjs:108-130,205-216`、`scripts/compile.mjs:90`。
- **改法**：
  1. `render.preset` → `--platform` 映射；`build` 增 `--platform`，输出 `<outDir>/<platform>.mp4` 且保留 master；
  2. 变体 `render.outDir = ${base}/${id}`；manifest 记 `masterPath/sha256`；
  3. 画幅与平台不匹配时报错，不静默补黑边。
- **验收**：
  - Given axes 两个 theme，When 逐个 build，Then `out/variants/<idA|idB>/master.mp4` 同时存在且 sha256 不同；
  - Given `preset=xiaohongshu`，Then concat 参数含 `--platform xiaohongshu`，ffprobe 1080×1440。
- **工时**：M（2d） · **ICE**：405 · **来源**：F-02-01, F-02-02, F-02-08, F-02-12

### P0-07 API 可被任意网页 CSRF 提交，并借 `allowRemotePages` 打内网

- **现象**：`POST /jobs` 直接 `readBody + JSON.parse`，无 Content-Type / Origin 校验；路由无 Host 白名单；spec 的 `render.allowRemotePages` 可放行任意绝对 URL，渲染器原样打开。内测在本机复现接受 `http://169.254.169.254/latest/meta-data/` 且 `errors: 0`。
- **证据**：`server/api.mjs:495-505,628-645`、`templates/spec.mjs:370`、`templates/render-segment.mjs:261`。
- **改法**：
  1. `POST /jobs` 强制 `Content-Type: application/json` + Origin/Host 白名单（仅回环）；
  2. `allowRemotePages` 改为 CLI 显式参数，spec 字段忽略；
  3. 渲染进程加 `--host-resolver-rules=MAP * ~NOTFOUND` 或容器 egress 阻断。
- **验收**：Given 服务默认启动，When 从 `http://evil.example` 发 `text/plain` POST，Then 403 且不创建 job；Given spec 带 `allowRemotePages`，Then lint 报 `E_PAGE_REMOTE`。
- **工时**：M（1.5d） · **ICE**：270，但为**安全硬阻断**，强制 P0 · **来源**：F-T06-02

### P0-08 离线/内网装不上，字体与许可不随仓库走

- **现象**：
  1. `arm.sh` 用无版本 `npm i`，无 `.npmrc`/`vendor/`；断网第一步即挂。
  2. `shared/fonts/` 被 `.gitignore` 忽略：`git ls-files` = 0，本机 1187 个 woff2，fresh clone 1187 个 404；`fonts.css` 里字体悄悄回退系统字体。
  3. `shared/` 下 OFL/LICENSE 文本 0 个，7 个 OFL 字族不可对外分发。
  4. `engines: >=20`，但 CDP fallback 需 Node 22（`cdp.mjs:102`）；无 `.nvmrc`/Dockerfile。
- **证据**：`arm.sh:67,73`、`.gitignore:27`、`scripts/build-fonts.mjs:20,48,71-75`、`package.json` engines、`templates/cdp.mjs:102`。
- **改法**：
  1. 发布 `vendor/`（8 个 tgz + integrity）或 `npm pack` 产物；`arm.sh` 改 `npm ci --offline`，失败即退出；
  2. 字体作为**发布产物**（`fonts-bundle.tar.zst` + sha256）而非 git 内容；`new-project` 缺字体时失败而非静默；
  3. `build-fonts` 复制各包 LICENSE 到 `shared/fonts/licenses/`，新增 `THIRD-PARTY-NOTICES.md`；
  4. 加 `.nvmrc` + `Dockerfile`（Node/Chrome/FFmpeg/Python 固定版本）；doctor `--json` 输出精确版本。
- **验收**：
  - Given 断网机器 + `vendor/`，When `bash arm.sh`，Then 全程无外网且 exit 0；
  - Given fresh clone，Then `shared/fonts` ≥1 woff2 且 1187 个请求 0 个 404；
  - Given 发布包，Then `find shared/fonts -iname "OFL*" | wc -l ≥ 7`。
- **工时**：M（1.5d） · **ICE**：500 · **跨角色**：2（T06/T03）
- **来源**：F-T06-01, F-T06-03, F-T06-04, F-T06-10, F-03-05, F-03-11

---

## 3. 下一里程碑 · P1（13 项，≈21.5 人日）

| # | 优化项 | 工时 | ICE | 验收一句话 | 来源 |
|---|---|---|---|---|---|
| P1-01 | `--root` 默认统一为 cwd，报错回显 `root=` 并提示 | S 0.5d | **720** | spec 在子目录不带 `--root` 也能 lint 通过，或错误含解析出的 root | F-T01-08, F-04-04 |
| P1-02 | 单段动效档位 + 未知字段拒绝 | S 0.5d | **640** | 只有该段 URL 带 `mp=maximal`，其余逐字符不变 | F-05-04 |
| P1-03 | 品牌合规进 build（占位/禁用词/品牌包校验） | S 0.5d | **540** | 含禁用词或 `{{BRAND}}` 时 build exit≠0 | F-02-05, F-T01-07 |
| P1-04 | 机器可读失败契约：错误码注册表 + exit 分层 + `--json` | M 2d | 365 | 缺 spec + `--json` 时 stdout 可 `JSON.parse`，`ok=false` | F-03-02/03/07/10, F-04-05/06 |
| P1-05 | 文档契约收口：单入口/单产物/完成断言/错误→动作 | M 1.5d | 360 | 只按 Quick Start 能产出 `plan.segments[0].hash`；SKILL ≤25KB | F-04-03/05/06/09/11/12, F-T01-11 |
| P1-06 | 排版 token 系统（4 级字阶 + 单一安全区） | M 1.5d | 350 | 任意两配方页 title 像素高比值 ∈[0.9,1.1] | F-05-10 |
| P1-07 | 跨平台与版本锁（Node 20/22、bash、`CHROME_EXE`、镜像） | M 1d | 324 | Node 20 + 无内置浏览器时 `doctor --strict` exit 1 | F-03-05, F-03-09, F-T06-10 |
| P1-08 | 字幕与投放资产（srt/vtt + `cvs deliver` + 封面版式） | M 1.5d | 288 | `delivery.json` 每行 file 存在、sha 与磁盘一致、含 cover/title | F-02-09/10/11 |
| P1-09 | 度量与「再来一版」：`runs.jsonl` + `cvs again` | M 1.5d | 288 | 第二次 build 命令长度 ≤ 第一次；10 分钟内可算出二次修改率 | P-02, P-05 |
| P1-10 | 安全纵深（outDir/no-sandbox/文档反转/绝对路径/`--host`/`-safe 0`） | M 1.5d | 252 | `outDir=../../escape` → exit 1 无落盘；README 安全声明与测试一一对应 | F-T06-05/06/07/08/09/11/12 |
| P1-11 | 新手入口：要么做实（安装器 + 出片按钮），要么撤承诺 | L 3d | 225 | 无 Node 机器 5 分钟内看到 wizard，或首屏明确「需要 Node」 | F-T01-01/02/05/06/10/12 |
| P1-12 | 品牌视觉落地（logo / 品牌字体 / 3:4、6:7 画幅） | L 3d | 144 | logo 进画面后同帧 sha 变化；aspect=3:4 输出 1080×1440 不补边 | F-02-04, F-02-08 |
| P1-13 | 审片与回滚闭环（本地 mp4 / review.json / 版本快照） | L 3d | 126 | 回滚 v1 后 `out/versions/v1/master.mp4` sha 等于记录值 | F-02-06/07, F-05-11 |

### 3.1 前五项要点

**P1-01 `--root`**
`plan.mjs:73`（库默认 cwd）与 `:142`（CLI 默认 `dirname(spec)`）自相矛盾；`compile.mjs:46`、`spec-lint.mjs:45` 跟随后者。spec 放 `fixtures/` 不带 `--root` 会得到 16 条 `E_PAGE_MISSING`，且不回显 root，用户第一反应是去复制页面。改：三处统一 `process.cwd()`；`E_PAGE_MISSING` 回显 `root=` 并给可复制命令；SKILL 明写「spec 不在项目根必须 `--root`」。

**P1-02 单段动效**
schema 的 `style` 只有 `page/recipe/t0/speed`，写 `motion:'maximal'` 被静默吞掉（未开 `additionalProperties:false`）；URL 只拼全局 `mp`。改：`style.motion` 按段下发 `mp`，schema 加 `additionalProperties:false` + `E_UNKNOWN_FIELD`。**这是「静默失效」类缺陷的最小样板，先修它建立模式。**

**P1-03 品牌合规**
`brand apply` 无条件 `return 0`；`forbiddenWords` 只被 `brand.mjs` 自己读；`{{BRAND}}` 只 warn。改：build 在 spec 有 `brandKit` 时调 `checkBrand`；占位品牌与禁用词升级为 error；`brand apply` 有 error 时 exit 1。广告法风险，成本 0.5 天。

**P1-04 失败契约**
这是「机器能不能接」的总闸。四件事一次做完：
1. `schema/errors.json` + 生成 `docs/ERRORS.md`，CI 断言所有 `E_*` 字面量在册且 `(code,phase)` 唯一；
2. exit 分层：10 spec / 11 render / 12 concat / 13 qa / 14 env；
3. 失败对象 `{phase, code, failedSegment, logPath, artifactPath}`，API `jobView` 同步；
4. `--json` 在致命错误时也输出一行可解析 JSON；`cvs --version`；未知命令 stderr + exit 2。
> 顺带统一四种测试汇总格式（`cvs test --json` 或 TAP14），否则 CI 仍要人肉 grep。

**P1-05 文档契约**
`SKILL.md` 是导演手册，不是执行契约。四刀：
1. §13 Quick Start 改为 spec 主线，timeline 路线降级到 `references/legacy-timeline.md`；
2. 增「验收契约」5 行（见 §9 DoD），产物统一 `master.mp4`；
3. 增「错误码前缀 → 唯一动作」12 行表；
4. §11 文件地图（3.9KB/50 行）与 §12 样片摘要移出，目标 ≤25KB。

---

## 4. 打磨池 · P2（5 项，≈3.5 人日）

| # | 优化项 | 工时 | ICE | 说明 |
|---|---|---|---|---|
| P2-01 | 安装体积与 CI 缓存：去掉 `npm ci \|\| npm install`、加 `cache: npm`、lock 版本对齐 | S 0.5d | 504 | 188 MB × 2 job × 每次 push；`\|\| npm install` 会掩盖锁文件漂移 |
| P2-02 | 封面版式与 `cvs image` 覆盖策略：默认 card 版式、`--force` 才清目录 | S 0.5d | 480 | 现在给的是带编号胶囊的正片截图，且第二次出图删掉第一批 |
| P2-03 | 跨机确定性：固定镜像 + committed golden manifest + `--json` | M 1.5d | 252 | `README:141`「any machine」目前不成立；golden 绑 Chrome 157 |
| P2-04 | `doctor` 真实能力探测 + `--strict` 语义 + `fix` 字段 | S 0.5d | 180 | `--strict` 现在是空操作；Node 20 会误报绿 |
| P2-05 | 版本与数量漂移：SKILL v2.1/11 风格/13 画风/命令 13 vs 19 | S 0.5d | 150 | 统一到 `metadata.version`，命令表从 `--help` 生成 |

---

## 5. 路线分支（选 A 后，其他路线的增量）

| 路线 | 已有 | 缺口（按依赖顺序） | 增量工时 |
|---|---|---|---|
| **A · Agent 编译器**（主） | spec→plan→增量渲染→QA、13 主题、品牌色、图片集 | P0 全部 + P1-01/04/05/09 | ≈16 人日 |
| **B · 品牌/投放** | accent 全链路、变体矩阵、封面帧 | P1-03 → P1-08 → P1-12 → P1-13 | +10 人日 |
| **C · 剪辑师工具** | 确定性渲染、segmentHash、多画幅 | **段级时长（L）** → P1-02 → 转场（XL）→ 音频 VO/ducking（L） | +12 人日 |
| **D · 小白出片** | wizard 七卡、8 预设、参考图取色 | P1-11（安装器 + 出片按钮 + 文案卡 + 预览） | +5 人日 |

### 5.1 C 路线的第一块砖：段级时长

`timeline.mjs:219` 所有 style 段共用 `structure.round`，`spec.mjs:363-365` 要求总长严格等于公式；写 45s 被 `E_DURATION` 拒，script 模式 3s+9s 被折叠成单一 round。**没有段级时长，转场没有位置、素材没有入出点、配乐没有 conform、审片意见没有可写回的字段。** 若决定走 C，这是第一个 L 项，先于任何动效/音频工作。

---

## 6. 四周执行序列

| 周 | 主题 | 任务 | 出口断言（必须机械通过） |
|---|---|---|---|
| **W1** | 让绿灯可信 | P0-03（0.5）+ P0-04（0.5）+ P0-02（1）+ P0-05（1.5）+ fixture 迁移（1.5） | 旧 fixture 跑 `build --strict` 必红；新 fixture 全绿且静帧无占位串；改文案必重渲 |
| **W2** | 让默认片能交 | P0-01（1.5）+ P0-06（2）+ P1-01（0.5）+ P1-03（0.5） | `cvs new` 一句话 → build：有音轨、有真实标题/品牌、竖屏平台版、两变体不覆盖 |
| **W3** | 让机器能接 | P0-07（1.5）+ P0-08（1.5）+ P1-04（2）+ P1-05（1.5） | CI 能按 `errorCode` 分流；断网 + `vendor/` 可装；SKILL ≤25KB 且单入口 |
| **W4** | 让第二版更快 | P1-09（1.5）+ P1-02（0.5）+ P1-06（1.5）+ P2-01/02（1） | `runs.jsonl` 能算出二次修改率；第二次 build 命令长度 ≤ 第一次 |

> 合计 ≈ **20.5 人日**（W1 5 + W2 4.5 + W3 6.5 + W4 4.5）。2–3 条 Agent 并行可压到 2 周；单人串行约 4 周。

### 6.1 每周的「不许做」

- W1 不许加任何新主题/新配方/新 GUI；
- W2 不许改渲染引擎核心（除 P0-05 的 hash）；
- W3 不许改 `SKILL.md` 的章节结构（只做删减与统一）；
- W4 不许引入新依赖。

---

## 7. 北极星与度量

### 7.1 定义

**二次修改会话率** = 同一 `project` 在 10 分钟窗口内出现 ≥2 条 `specHash` 不同且 `exit=0` 的构建记录，占全部首次构建会话的比例。

### 7.2 最小埋点（本地、可关闭）

`out/.cvs/runs.jsonl`，每次 build 追加一行：

```json
{"ts":"2026-11-12T22:41:07+08:00","cliVersion":"2.3.5","project":"fixtures/mini-41s","specHash":"a1b2c3","dirtySegments":3,"totalSegments":23,"phase":"done","exit":0,"qaPass":true,"durationMs":41200}
```

- **不记录**：文案内容、品牌名、绝对路径、任何用户身份。
- **可关闭**：`CVS_NO_TELEMETRY=1`；加入 `.gitignore`。
- **先跑两周基线**，再决定 60% 是否现实；不要先立 KPI 再找数据。

### 7.3 质量护栏（与北极星同时看）

| 指标 | 定义 | 目标 |
|---|---|---|
| 假绿率 | QA pass 但存在占位页/无音轨/未 lint 的构建占比 | **0** |
| 自助修复率 | 非作者用户遇到 `E_*` 后 10 分钟内自行解决的占比 | ≥80% |
| 首次出片时长 | 从 `cvs new` 到可播放 master 的中位时长 | ≤15 分钟 |
| 缓存正确率 | 改动后重渲段数 == 预期 dirty 段数 | 100% |

---

## 8. 风险与回滚

| 风险 | 触发点 | 缓解 |
|---|---|---|
| **fixture 迁移打红 CI** | W1 把 8 个占位段换成真实 recipe 页 | 先保留旧 fixture 为 `fixtures/legacy-placeholder` 作负样本；新 fixture 单独提交 + golden 更新 |
| **缓存全失效一次** | P0-05 bump `ENGINE_VERSION` | 选在发布前一次性 bump；文档注明「首次 build 会全量重渲」；提供 `--no-cache` |
| **平台接线改变编码参数** | P0-06 接 `render.preset` | 默认仍出 master；平台版为附加产物；golden 只断言 master |
| **QA 变严导致历史构建红** | P0-03 默认 `--strict` | 只对新构建生效；调试用 `--no-strict`；文档写清「交付态 vs 迭代态」 |
| **字体/OFL 体积** | P0-08 打包 1187 woff2（≈160MB） | 不发 git，发 `fonts-bundle.tar.zst` + sha；只打包实际用到的字族子集 |
| **安全收紧影响本地开发** | P0-07 Origin/Host 校验 | 仅回环白名单；`--allow-origin <origin>` 显式放行；文档给 curl 示例 |

---

## 9. 完成定义（DoD，可直接抄进 SKILL）

一次 build 只有同时满足以下 5 条，才允许输出「完成」：

1. `out/master.mp4` 存在，且 `ffprobe` 含 `codec_type=audio`；
2. `out/qa/qa-video.json` 的 `summary.fail == 0`，且无 `placeholder-page` FAIL；
3. `out/qa/qa-audio.json` 的 `summary.fail == 0`（无音轨则必须显式 `--no-audio`）；
4. `out/render-manifest.json` 中无 `"status": "failed"`，且无段被 `skipped` 却有 dirty 标记；
5. 成片与 plan 中不含 `{{BRAND}}`、`风格段标题`、`替换 drawScene()`。

> 任一不满足 → 非零退出。**禁止把「缓存命中」当作「改动已生效」，禁止把「QA 0 fail」当作「内容正确」。**

---

## 附录 · `BACKLOG.json` 字段

| 字段 | 含义 |
|---|---|
| `id` | 优化项 ID（P0-01 … P2-05） |
| `title` | 一句话 |
| `severity` | P0/P1/P2 |
| `cluster` | A–H 根因聚类 |
| `routes` | 影响的路线（A/B/C/D） |
| `effort` | S/M/L/XL + 人日 |
| `impact` / `frequency` / `confidence` | 1–10 |
| `ice` | 计算值 |
| `cross_roles` | 命中角色数 |
| `sources` | 原始意见 ID 列表 |
| `evidence` | `path:line` 或命令 |
| `acceptance` | Given-When-Then |
| `depends_on` | 前置项 |
