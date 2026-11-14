# T04 · Agent 用户（Claude Code / ZCode 装载技能）内测报告

基线：v2.3.4（`package.json:3`），SKILL.md 464 行 / 37,050 B / 24,197 字符 / 5,098 汉字。
方法：只读审计 + 只写临时目录的真实命令（`%TEMP%/cvsprobe`），未改仓库、未 commit、未做真实渲染。仓库 `git status` 仅 `?? .cluster/ ?? docs/feedback/`。

## 0. 必答：Agent 读完 SKILL.md 后最可能做错的一件事

**跑 `node bin/cvs.mjs build project.spec.json`（不带 `--audio`），拿到一个没有音轨的 `out/master.mp4`，QA 仍然 exit 0，然后宣布完成。**

链路证据（全部可复核）：
- `SKILL.md:35` 把 `build` 列为「统一入口」，全文没有一处说明 `build` 要传 `--audio`；`SKILL.md:96-105`、`SKILL.md:427-462` 都是「先手工 synth_audio，再手工 concat」的另一条路。
- `scripts/compile.mjs:93` 只有传了 `--audio` 才走 `concat-and-encode.sh`；否则 `scripts/compile.mjs:100-108` 直接 `ffmpeg -c copy` 视频流。
- `scripts/compile.mjs:112-116` 调 `qa-video` 时**没有** `--strict`；`scripts/qa-video.mjs:116` 对无音轨只记 `WARN`；`scripts/qa-video.mjs:207` 只在 FAIL（或 strict+WARN）时 exit 1。
- `scripts/compile.mjs:126-128` 打印 `[done] <master>`，退出码 0。`grep -c qa-audio scripts/compile.mjs` = **0**，音频质检根本不在 build 里。

这比「入口选错」更常见：入口选错还能看到报错，静音母版是**沉默的绿灯**。

## 1. 可跑性实测（真实输出，逐条）

| 文档里的命令 | 结果 |
|---|---|
| `node bin/cvs.mjs --help` | exit 0，打印 19 个命令 |
| `node scripts/spec-lint.mjs --spec fixtures/mini-41s/spec.json --root .` | exit 0：`✓ mini-41s · 1920×1080 · 41s · 6 rounds · coral-noir — 0 error(s), 1 warning(s)` |
| `node scripts/doctor.mjs` | exit 0：node/ffmpeg/libx264/aac/loudnorm/ffprobe 全 ✓ |
| `node bin/cvs.mjs motion matrix` / `image --list` | exit 0，推导表与 6 个尺寸预设正常 |
| `node scripts/compile.mjs --spec <tmp>/mini.json --root . --outdir <tmp>/out --dry-run` | exit 0：`[compile] mini-41s · 41s · 1230 frames · 23 segments` |
| `node bin/cvs.mjs new "做一个30秒的编程科普短视频" --out <tmp>/gen.spec.json` | exit 0，4 rounds，落盘 `meta.brand: "{{BRAND}}"` |

补充：`cvs new` 产出的 spec 再跑 lint 仍是 **exit 0**（只有 `W_BRAND` 警告），也就是说「默认无人值守生成」可以一路绿灯把 `{{BRAND}}` 渲染进成片。

## 2. 触发词覆盖（frontmatter `SKILL.md:2-15`）

- **能触发**：①「做一条卡点视频」②「纯代码做视频，不要用生成模型」③「逐帧渲染 + 节拍同步的展示片」。
- **不能触发**：①「给这段口播配字幕，做成 30 秒竖屏」——描述里没有「字幕/口播/竖屏短视频成片」；②「帮我出一支 30 秒产品宣传片」——`SKILL.md:8-9` 的触发词表里没有「宣传片」，只有「风格展示视频」；③「把这份 spec 批量导出抖音/B站/小红书三个版本并出封面图」——没有「多平台导出/封面/批量变体」。
- **误触发风险**：`SKILL.md:9` 把「时间轴」「配色主题」「视频质检」「并行渲染」列为必须触发，这四个都是跨领域通用词（AE 时间轴、任意设计配色、任意视频 QA）。建议限定为「卡点时间轴」「主题配色 13 套」「ffmpeg 视频质检」「逐帧并行渲染」。

## 3. 交叉引用完整性（抽查 35 个路径，35 个存在）

`references/{themes,timeline-schema,qa,audio-recipes,motion-and-color,style-recipes,render-pipeline,intake,original-brief,big-card-and-typography,reference-film-analysis,platform-presets,ai-lane}.md(.txt)`、`templates/{plan,style-pages,timeline,render-farm,render-segment,cdp}.mjs`、`templates/{synth_audio.py,concat-and-encode.sh}`、`scripts/{spec-lint,compile,qa-video,qa-audio,determinism-check,theme-audit,doctor,new-project}.*`、`fixtures/mini-41s/spec.json`、`assets/theme-previews/`、`app/{wizard,canvas,script,versions,review}`、`server/api.mjs` —— **全部存在**。
唯一瑕疵：`SKILL.md:96` 写 `theme-three-up.jpg` / `theme-contact-sheet.jpg` 时没带目录，真实路径是 `assets/theme-previews/`，Agent 必须自己 Glob。

## 4. 五处「两种合理解读」（按踩坑概率排序）

| # | 原文 | 解读 A（作者本意） | 解读 B（Agent 常选） | 选错的后果 | 证据 |
|---|---|---|---|---|---|
| A1 | `SKILL.md:25` vs `SKILL.md:427-438` | 新项目一律 `spec.json` + `cvs build` | §13 叫「快速启动」，先 `new-project.mjs` → `timeline.json` | 走进 legacy lane：`templates/timeline.mjs` 全文没有 `hash`，`render-farm/render-batch` 的缓存判据是 `if (!cacheDir || !s.hash)`，增量/`look.motion`/`accentOverride` 全部静默失效 | `SKILL.md:25,434-438`；`grep -c hash templates/timeline.mjs` = 0；`templates/render-batch.mjs:159`；`templates/render-farm.mjs:159` |
| A2 | `SKILL.md:34`「改一段只重渲一段」 | 内容变了就重渲该段 | 有 `--resume`，帧数对得上就跳过 | 改文案但时长不变 → cache miss 后 resume 命中，**跳过渲染**，还把旧 mp4 以新 hash 写进缓存（缓存被污染）；`compile.mjs:82` 永远带 `--resume`，且没有 `--no-resume` | `templates/render-batch.mjs:219-229`；`templates/render-farm.mjs:178-183`；`scripts/compile.mjs:82` |
| A3 | `SKILL.md:337`「其余为 WARN，`--strict` 升级为失败」 | 交付前用 `--strict` 卡严 | 直接跑文档里的 `qa-video.mjs`（不带 `--strict`） | 同一产物两条路径结论相反：`build` 绿 / 手工 `--strict` 红；Agent 会去改阈值或重渲全片，而不是修真实问题 | `scripts/qa-video.mjs:207`；`scripts/compile.mjs:112-116`；`SKILL.md:332` |
| A4 | `SKILL.md:23-31` 示例都带 `--root .` | spec 必须配 `--root` | 省略 `--root`（默认值看起来是 cwd，`plan.mjs` 自己的 help 也这么写） | 实际默认是 `dirname(spec)`，spec 放进 `fixtures/`/`specs/` 就 16 个 `E_PAGE_MISSING`，报错说页面不存在但页面就在仓库根 | 真实输出见下；`templates/plan.mjs:132` vs `:142`；`scripts/spec-lint.mjs:45`；`scripts/compile.mjs:46` |
| A5 | `SKILL.md:96`「把主题预览图发给用户选」 | 交互式会话里贴图 | 非交互 Agent 无展示工具、也没给路径 | 要么跳过主题确认按默认出片，要么把 13 张图路径硬编码猜错；`allowed-tools` 里没有任何「展示给用户」的能力 | `SKILL.md:15,96`；`ls assets/theme-previews/` |

A4 的真实输出（`node bin/cvs.mjs lint fixtures/mini-41s/spec.json`，未带 `--root`，exit 1）：
```
[error] [E_PAGE_MISSING] rounds[5].style.page: page not found: templates/segment.html
[error] [E_PAGE_MISSING] moreCard.page: page not found: templates/big-card.html
[error] [E_PAGE_MISSING] flash.page: page not found: templates/big-card.html
[error] [E_PAGE_MISSING] ending.page: page not found: templates/big-card.html
✗ mini-41s · 1920×1080 · 41s · 6 rounds · coral-noir — 16 error(s), 1 warning(s)
```

## 5. Findings

### F-04-01 `cvs build` 不传 `--audio` 会静默产出无音轨母版，且 QA 绿灯
- 严重度: P0 阻断
- 证据: `scripts/compile.mjs:93`（只有 `args.audio` 才走音频合成）、`:100-108`（否则 `ffmpeg -c copy` 纯视频）、`:112-116`（QA 不带 `--strict`）、`scripts/qa-video.mjs:116`（无音轨仅 `WARN`）、`:207`（只有 FAIL 才 exit 1）、`grep -c qa-audio scripts/compile.mjs` = 0、`SKILL.md:35`（build 作为统一入口，未提 `--audio`）
- 我的原话: 「作为 Agent，我按 SKILL.md 的『统一入口』跑 `cvs build`，想一条命令出片，但拿到的 master.mp4 没有音轨，QA 还打印 `0 fail` 并 exit 0，我就把它当成交付物了。」
- 影响面: 所有按 §0.5 走 `cvs build` 的 Agent / 每次必踩
- 建议方案: `compile.mjs` 在未传 `--audio` 时 **exit 1** 并提示 `audio/mix.wav` 或 `--no-audio` 显式豁免；把 `qa-audio.py` 纳入 build；`SKILL.md:35` 的 build 行补 `[--audio audio/mix.wav]`，并在 §1 交付物表加「必须含 a:0 音轨」
- 验收断言: Given 一个没有音轨的 master.mp4 When 跑 `cvs build spec.json`（不带 `--no-audio`） Then 退出码 ≠ 0 且 stderr 含 `E_AUDIO_REQUIRED`；Given 带 `--audio` When build Then 产物 `ffprobe` 有 `codec_type=audio` 且 `qa/qa-audio.json.summary.fail == 0`
- 工作量: S
- 打分: impact 10 / frequency 10 / confidence 10

### F-04-02 `--resume` 只比帧数，改过的段被跳过并被新 hash 缓存
- 严重度: P1 严重摩擦
- 证据: `templates/render-batch.mjs:219-229`（cache miss 后按 `probeFrames(outAbs) === s.frames` 直接 `skipped`，并 `writeCache(s, outAbs, got, 0)`）、`templates/render-farm.mjs:178-183`（同逻辑）、`scripts/compile.mjs:82`（永远 `--resume`，无 `--no-resume`）、`SKILL.md:34`（承诺「改一段只重渲一段」）
- 我的原话: 「作为 Agent，我改了一句文案再 build，想看到只重渲那一段，结果看到 `resume hit (N frames)` 和 `[cache] skipped=…`，成片里还是旧文案，且缓存里新 hash 指向旧内容。」
- 影响面: 任何「spec 改了但段时长没变」的迭代 / 每次必踩
- 建议方案: resume 命中前先比对缓存 meta 里的 `hash` 与段 hash；hash 不同则强制重渲（或在 resume 分支加 `if (s.hash && m.hash !== s.hash) return null`）；`SKILL.md:34` 补一句「`--resume` 只核对帧数，不核对内容」
- 验收断言: Given 已渲染的段 When 只改该段文案且时长不变后再次 build Then 该段 `status != skipped|cached` 且产物帧内容 sha256 变化
- 工作量: S
- 打分: impact 9 / frequency 9 / confidence 9

### F-04-03 两套入口并存：§0.5 说「新项目从 spec」，§13 快速启动却生成 timeline.json
- 严重度: P1 严重摩擦
- 证据: `SKILL.md:25`、`:33`、`:43`（timeline 是「旧项目」）对 `SKILL.md:427-447`（快速启动第 1-4 步全是 `new-project.mjs` + `timeline.json`）；`grep -c hash templates/timeline.mjs` = 0；`templates/render-batch.mjs:159`、`templates/render-farm.mjs:159` 的缓存判据要求 `s.hash`
- 我的原话: 「作为 Agent，我优先照『快速启动』做，想最快跑通，但生成的是 timeline.json，plan 里没有 segmentHash，后面所有『增量/主题档位/品牌色覆盖』都不生效，我还以为是我环境有问题。」
- 影响面: 首次上手、照抄 Quick Start 的 Agent / 每次必踩
- 建议方案: 把 §13 改成 spec 主线（`cvs new` → `cvs lint` → `cvs build`），timeline 路线降级到 `references/legacy-timeline.md`；或在 §13 开头加一行「新项目请走 §0.5，§13 仅用于 timeline v1 项目」
- 验收断言: Given 一个全新目录 When 只按 §13 抄命令 Then 产出文件含 `project.spec.json` 且 `out/plan.json.segments[0].hash` 存在
- 工作量: S
- 打分: impact 9 / frequency 8 / confidence 10

### F-04-04 `--root` 默认值是 spec 所在目录，且与自身 help 矛盾；报错误导
- 严重度: P1 严重摩擦
- 证据: `templates/plan.mjs:132`（help: `--root <dir> project root (default cwd)`）对 `:142`（实际 `dirname(specPath)`）；`scripts/spec-lint.mjs:45`、`scripts/compile.mjs:46` 同为 `dirname(spec)`；真实输出见 §4-A4（16 个 `E_PAGE_MISSING`）
- 我的原话: 「作为 Agent，我把 spec 放在 `fixtures/` 里跑 lint，想验证 spec 合法，但得到 16 条『page not found: templates/segment.html』——那个文件明明在仓库根，我第一反应是去复制页面而不是加 `--root`。」
- 影响面: 任何不在仓库根的 spec（fixtures、多项目工作区）/ 特定场景高频
- 建议方案: 三处统一默认 `process.cwd()`，并在 `E_PAGE_MISSING` 消息里回显 `root=`；`SKILL.md:27-31` 明写「spec 不在项目根时必须 `--root`」
- 验收断言: Given cwd=仓库根且 spec 在子目录 When 不带 `--root` 跑 lint Then exit 0 或错误消息含 `root=<实际解析目录>`
- 工作量: S
- 打分: impact 7 / frequency 7 / confidence 10

### F-04-05 「做完了」不可机械判定：产物名/报告路径/退出码三处不一致
- 严重度: P1 严重摩擦
- 证据: `scripts/compile.mjs:90`（母版 `out/master.mp4`）对 `SKILL.md:332,453,456`（一律检查 `out/final.mp4`）；`scripts/compile.mjs:114` 把报告写到 `<outDir>/qa/qa-video.json`，`scripts/qa-audio.py:286` 默认 `qa/qa-audio.json`，SKILL.md 全文未出现这两个路径（`grep -n "qa-video.json" SKILL.md` 无命中）；`SKILL.md:340-355` 自动项与人工项混排，没有一条「done 判据」
- 我的原话: 「作为 Agent，我想知道什么时候可以停，但文档一会儿 master、一会儿 final，QA 报告在哪也没写；我只能看『文件存在』和『看起来对』，没法机械判定。」
- 影响面: 所有无人值守调用 / 每次必踩
- 建议方案: 在 §1 增加「验收契约」5 行：`out/master.mp4` 存在且含 a:0；`out/plan.json.stats.frames == ffprobe nb_read_frames`；`out/qa/qa-video.json.summary.fail==0`；`qa/qa-audio.json.summary.fail==0`；`render-manifest.json` 无 `failed`。并把 §13/§10 的 `final.mp4` 统一成 `master.mp4`
- 验收断言: Given 一次 build When 用上述 5 条 assert 脚本检查 Then 全通过才允许输出「完成」；任一失败必须非零退出
- 工作量: S
- 打分: impact 8 / frequency 10 / confidence 10

### F-04-06 失败自愈：89 个错误码，SKILL.md 只解释 2 个，没有「报错 → 下一步」
- 严重度: P1 严重摩擦
- 证据: `grep -rho "E_[A-Z_]\{3,\}" scripts/ templates/ bin/ server/ | sort -u | wc -l` = **89**；`grep -n "E_[A-Z_]" SKILL.md` 只有 `:41` 的 `E_PAGE_REMOTE`/`E_PAGE_ABS`；`references/qa.md:76` 有现成的「常见失败」表，但 `SKILL.md:338` 只指向「阈值表与 JSON 结构」
- 我的原话: 「作为 Agent，我遇到 `E_ROUND_TOTAL`/`E_SCRIPT_GAP`/`E_MOTION` 只能猜：是改 spec、改页面还是重跑？猜错一次就是几分钟渲染。」
- 影响面: 所有非 happy path / 特定场景高频
- 建议方案: 在 SKILL.md 加一张 12 行的表（错误码前缀 → 一句话含义 → 唯一动作 → 参考节）：`E_PAGE_*`→加 `--root`/改 page；`E_ROUND_*`/`E_DURATION*`→改 spec 时长；`E_THEME_*`/`E_APCA`→换主题或 accentOverride；`E_MOTION`→查 `cvs motion matrix`；渲染类→删对应 `out/<seg>.mp4` 重跑；并显式写「不要手改 plan.json」
- 验收断言: Given 任一 lint 报错 When Agent 只能读 SKILL.md Then 能查到该错误码前缀对应的动作且动作唯一
- 工作量: M
- 打分: impact 8 / frequency 7 / confidence 9

### F-04-07 `allowed-tools` 功能够用，但边界给反了（授予了正文禁止的写权限）
- 严重度: P2 明显不便
- 证据: `SKILL.md:15` `allowed-tools: Bash, Read, Write, Edit, Glob, Grep`；`SKILL.md:33` 明令「不要手改 `plan.json` 或段 mp4」；`SKILL.md:96` 要求「把主题预览图发给用户」，但工具集里没有任何展示/附件能力
- 我的原话: 「作为 Agent，我判断 Bash 已覆盖 node/python/bash/ffmpeg，所以执行不缺工具；但 Write/Edit 让我可以『修』plan.json，而文档又说别改——这不是安全边界，是诱导。」
- 影响面: 所有装载该技能的 Agent / 每次必踩（权限语义层面）
- 建议方案: 把 `allowed-tools` 改成 `Bash(node:*, python:*, ffmpeg:*, ffprobe:*, bash:*), Read, Glob, Grep`（或保留 Write/Edit 但在 §0.5 加一句「Write 仅用于 spec/brief/页面，禁止写 plan.json/segments.txt/*.mp4」）；主题预览改为「让用户打开 `assets/theme-previews/theme-three-up.jpg`」而不是「发给用户」
- 验收断言: Given 装载技能 When Agent 试图 Edit `out/plan.json` Then 被工具策略拒绝或 SKILL.md 明确标注为违规
- 工作量: S
- 打分: impact 5 / frequency 8 / confidence 9

### F-04-08 触发词：能触发 3 类、漏 3 类高频说法，且有 4 个通用词误触发
- 严重度: P2 明显不便
- 证据: `SKILL.md:2-9`；实测可触发说法「卡点视频」「纯代码做视频」「逐帧渲染」；不可触发「配字幕出竖屏」「30 秒产品宣传片」「批量出三平台版本+封面」；`SKILL.md:9` 的「时间轴」「配色主题」「视频质检」「并行渲染」在 AE/设计/通用 QA 语境里同样成立
- 我的原话: 「作为 Agent 路由，我看到『做一条 30 秒产品宣传片』不会加载这个技能；看到『调一下 AE 时间轴』反而会误加载。」
- 影响面: 技能路由准确率 / 特定场景
- 建议方案: description 补「宣传片/产品短片/竖屏短视频成片/字幕安全区/多平台导出/封面图/批量变体」；把四个通用词改成带限定的组合词（「卡点时间轴」「13 套主题配色」「ffmpeg 视频质检」「逐帧并行渲染」）；再加一句负向边界「不用于 AE/PR 时间轴操作、不用于文生视频」
- 验收断言: Given 用户说「做一条 30 秒产品宣传片」Then 技能被选中；Given 用户说「AE 时间轴怎么调」Then 技能不被选中
- 工作量: S
- 打分: impact 6 / frequency 6 / confidence 8

### F-04-09 token 成本：一次装载 ≈ 9k tokens，§11 文件地图与 §12 可直接移出
- 严重度: P2 明显不便
- 证据: `SKILL.md` 37,050 B / 24,197 字符 / 5,098 汉字 / 464 行（`wc` 与 node 实测）。分段字节：§0.5 4,768 B/29 行、§5 3,994 B/52 行、§11 3,876 B/50 行、§2 2,822 B、§9 2,347 B、§12 1,3xx B
- 我的原话: 「作为 Agent，我每次会话都要把这 37 KB 读进来，其中 50 行是目录树快照、52 行是主题表、还有一段与 `references/reference-film-analysis.md` 重复的样片摘要——这些都不改变我下一步敲什么命令。」
- 影响面: 每次技能加载 / 每次必踩
- 建议方案: §11 整体移到 `references/repo-map.md`（保留 5 行「关键入口」）；§5 的 13 行主题表移到 `references/themes.md`，正文只留「13 套、默认 coral-noir、`themeFromURL` 用法」；§12 删除，指向已有 reference；§8 只留 3 条硬规则。目标 ≤ 6k tokens
- 验收断言: Given 精简后 SKILL.md When `wc -c` Then ≤ 25,000 B，且 §0.5+§1+§10 的命令与验收断言一条不少
- 工作量: M
- 打分: impact 6 / frequency 10 / confidence 9

### F-04-10 QA 失败后的动作二义：`--strict` 该由谁带、失败该改什么
- 严重度: P2 明显不便
- 证据: `SKILL.md:337`（「其余为 WARN，`--strict` 升级为失败」）未说明 build/compile 不带 `--strict`；`scripts/compile.mjs:112-116` 确实不带；`scripts/qa-video.mjs:207` 默认只 FAIL 退出；`SKILL.md:338` 未指向 `references/qa.md:76` 的「常见失败」表
- 我的原话: 「作为 Agent，我在 build 里看到 3 warn 就过去了；手工跑 `--strict` 又红，我不知道该信哪个，也不知道 warn 该修还是该接受。」
- 影响面: 交付判定 / 特定场景
- 建议方案: 明确规定「交付态 = `qa-video --strict` + `qa-audio --strict` 均 exit 0；迭代态允许 warn 但必须写进 `qa/notes.md`」；并在 §10 直接内联 6 行「WARN → 动作」映射（帧数不符→删段重渲；LUFS 偏→重跑 loudnorm；cue 低→synth_audio 读 plan.json）
- 验收断言: Given 交付态 When 任一 `--strict` 命令 exit≠0 Then 不得标记完成；checklist 必须记录该次 exit code
- 工作量: S
- 打分: impact 6 / frequency 7 / confidence 9

### F-04-11 版本与数量漂移：v2.1 / 11 风格 / 13 画风 / 2.3.4 并存
- 严重度: P3 打磨
- 证据: `SKILL.md:23` 标题写「v2.1」；`package.json` 2.3.4；`SKILL.md:270` 说「11 种风格」，`SKILL.md:38` 说「13 个画风」，`templates/style-pages.mjs` 实际 13 个键（`cyber-pixel,cyber-glitch,pixel-8bit,ink-wash,guofeng,great-wall,whiteboard,three-d,data-viz,screencast,flat,minimal,vertical`）；§7 表用中文名（扁平插画/数学动画），spec 需要 recipe id（`flat`/`screencast`）
- 我的原话: 「作为 Agent，我要填 `style.recipe`，但 §7 给的是中文风格名，13 个页面 id 只存在于源码里，我只能猜或去读 style-pages.mjs。」
- 影响面: 生成端填 spec / 特定场景
- 建议方案: §7 表加一列 `recipe id`（与 STYLE_PAGES 对齐）；把版本号统一到 SKILL frontmatter `metadata.version`；§0.5 标题去掉 v2.1
- 验收断言: Given §7 任一行 When 把该行 recipe id 写入 spec Then `cvs lint` 无 `E_STYLE_PAGE`
- 工作量: S
- 打分: impact 3 / frequency 5 / confidence 10

### F-04-12 命令清单漂移：§0.5 列 13 个 `cvs` 子命令，`--help` 实有 19 个
- 严重度: P3 打磨
- 证据: `SKILL.md:35` 只列 `new|ref|lint|plan|build|variant|ingest|motion|wizard|canvas|script|versions|test`；`node bin/cvs.mjs --help` 输出还含 `brand`、`golden`、`image`、`api`、`review`、`doctor`；`SKILL.md:431` 又用 `node scripts/doctor.mjs` 而不是 `cvs doctor`
- 我的原话: 「作为 Agent，我照 §0.5 的清单记命令，结果不知道 `cvs image`/`cvs brand`/`cvs doctor` 存在，多绕了两步。」
- 影响面: 命令发现 / 特定场景
- 建议方案: §0.5 的命令行改为从 `cvs --help` 自动生成或直接贴全 19 个；§13 的 doctor 统一成 `cvs doctor`
- 验收断言: Given SKILL.md 的子命令清单 When 与 `node bin/cvs.mjs --help` 对比 Then 差集为空
- 工作量: S
- 打分: impact 3 / frequency 4 / confidence 10

## 6. 建议直接加进 SKILL.md 的反误用断言（可复制）

```md
> **AGENT 硬断言（完成）**：`cvs build` 不带 `--audio` 只产出静音视频，且 QA 仍 exit 0。
> 宣布完成前必须全部成立：① `out/master.mp4` 存在且 `ffprobe` 有 `codec_type=audio`；
> ② `out/qa/qa-video.json` 的 `summary.fail == 0`；③ `qa/qa-audio.json` 的 `summary.fail == 0`；
> ④ `out/render-manifest.json` 中无 `"status": "failed"`。缺一即未完成，不得输出「已完成」。

> **AGENT 硬断言（增量）**：`--resume` 只核对帧数，不核对内容，且没有 `--no-resume`。
> 改过 spec 的段必须 `rm -f out/<seg>.mp4` 后再 build；看到 `resume hit` / `[cache] skipped`
> 不代表内容已更新。禁止把「缓存命中」当作「改动已生效」。

> **AGENT 硬断言（入口）**：新项目只允许 `project.spec.json` + `cvs lint/plan/build`。
> 不要走 §13 的 `new-project.mjs` + `timeline.json` 路径：那条路的 plan 没有 `segmentHash`，
> 增量缓存、`look.motion`、`accentOverride` 全部静默失效。

> **AGENT 硬断言（路径）**：spec 不在项目根时必须显式 `--root <项目根>`；
> 默认 root 是 spec 所在目录，`E_PAGE_MISSING` 多半是 root 错了，不是页面丢了。

> **AGENT 硬断言（无人值守）**：无法向用户提问时，用 `brief.json` 里 `meta.brand` 的默认值
> 并在成片参数说明里标注「未确认」；绝不允许把 `{{BRAND}}` 直接渲染进成片（lint 只给 WARN，不拦）。
```

## 7. 结论

SKILL.md 的**知识密度很高、路径几乎全真**（35/35 引用存在，文档命令实测可跑），但它是一份「写给人读的导演手册」，不是「写给 Agent 执行的契约」：缺**唯一入口、唯一产物、唯一验收、错误→动作映射**这四样，而它给的两条 lane 和两套 QA 严格度，恰好让 Agent 在「绿灯」里做错事。最该删/移的一段是 §11 文件地图（3,876 B / 50 行目录快照），其次是 §12 与 `references/reference-film-analysis.md` 重复的样片摘要。
