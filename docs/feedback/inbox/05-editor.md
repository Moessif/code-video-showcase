# T05 · 职业剪辑师 / 动效师 内测报告

基线：v2.3.4（`package.json:3`）。方法：只读取证 + 4 条 ≤60s 的 CLI/`node -e`（`motion matrix`、`theme-audit --strict`、两次 spec→plan 推演），未渲染、未起服务、未改仓库、未 commit。`git status` 仅 `?? .cluster/ ?? docs/feedback/`。

## 0. 必答

**给我什么，我才愿意用它而不是 AE？**
不是"更快的剪辑"。我要的是**可复现的图形插入件工厂**，三件就够：① 帧级可寻址 + 单段重渲（已有雏形：`templates/plan.mjs:24-48` 的 segmentHash、`render-farm` 的 resume）——改一个字段只重渲那 3 秒，其余帧逐字节不变，这是 AE 做不到的；② 一份 spec 出 13 主题 × 3 画幅 × 多语言，排版重算而不是手改；③ 每个镜头的截图 diff + 帧级 QA 作为交付证据。
但前提是它得承认自己不是 NLE：不碰我的素材、不做段间转场、不做混音。那我就用它做 AE 里最烦的那 20%（批量字卡、数据条、多语言版）。**要用它替代 AE 剪整片，现在不行**——F-05-01/03/06/07 四条都缺，不是打磨问题，是缺件。

**最像"模板生成器"而非"创作工具"的地方：节奏是盖上去的，不问画面。**
每一刀都有同一发 `sub_boom`+kick（示例 plan 55 cue / 61s = 每 1.11s 一发，`templates/synth_audio.py:341-348`）；每段入场都是同一个 slam，四档只是 4 个倍率（`templates/common.js:167-181`）；每一页的字是页面自带的 demo 文案，brand 缺省直接印 `{{BRAND}}`；而仓库自带的参考成片 78% 是占位页，QA 仍判 10 pass / 0 fail。创作工具让我决定"这一刀要不要响"，模板生成器替我决定"每一刀都响"。

## 1. Findings

### F-05-01 我只能改"种类"的时长，改不了"这一段"的时长（最小单位不是段，更不是帧）
- 严重度: P0 阻断
- 证据: `templates/timeline.mjs:219` `duration: Number(st.round) - Number(st.card)`（所有 style 段共用一个值）；`:136` 总长 = `opening + N×round + more + flashes + ending`；`templates/spec.mjs:363-365` 声明的总长与公式不符即 `E_DURATION`。实测：`{format.duration:45}` → `duration 45s != structure total 21s (opening + N×round + more + flashes + ending)`。script 模式也救不了：`templates/spec.mjs:179` `structure.round = roundDur`（最后一个 scene 覆盖全部），我写 3s+9s 两段 → `[E_SCRIPT_COVER] script: script ends at 14s but structure totals 22.5s`。
- 我的原话: 「作为剪辑师，我想让第 3 段留 2.2 秒把动作看完，但只有一个全局 `structure.round`；改它，11 段一起变长。我要的『这一刀晚 6 帧』在这个模型里无法表达。」
- 影响面: 每次必踩。任何非等长切点、任何"这段多留 0.4s"的修改都落在模型外。
- 建议方案: schema `schema/project.spec.schema.json:115-121` 的 style 增加 `dur`（秒）或 `frames`（整数帧）；`buildPlan` 改为按段累加，公式降级为缺省值；`totalDuration` 同步；script 模式真正按 block 的 `t[]` 落盘而不是折叠成单一 round。
- 验收断言: Given spec 中 `rounds[0].style.dur=2.2`、其余 3.0，When `cvs plan`，Then `segments[0].frames===66` 且 `stats.frames===Σ各段frames` 且 `format.duration` 可省略。
- 工作量: L
- 打分: impact 10 / frequency 10 / confidence 10

### F-05-02 质检全绿，但仓库自带的参考成片 78% 是占位页
- 严重度: P0 阻断
- 证据: `fixtures/mini-41s/spec.json` 的 opening、6 个 style、ending 全部指向 `templates/segment.html`——该页自带 `templates/segment.html:86-87` `PLACEHOLDER_TITLE='风格段标题'` / `PLACEHOLDER_SUB='替换 drawScene() 开始做真正的画面'`。`qa/qa-video.json` 真实输出 `{"pass":10,"warn":1,"fail":0}`（`out/mini-41s/master.mp4`，41s/1230 帧）；`qa/contact.jpg` 41 格里 32 格是同一张占位页（8s 开场 + 6×3s 风格 + 6s 结尾 = 32s）。`scripts/qa-video.mjs:84-164` 的断言全是容器级（codec/pix_fmt/size/fps/frames/colour/black/freeze/silence/loudness），没有一条读 page 或截图做内容断言。（与 T04 的"静音母版绿灯"同根：QA 只验容器，我这条是画面侧。）
- 我的原话: 「我要的不是『没崩』，是『这条片子确实是我要的那 11 个镜头』。现在占位页也能拿满分，那我拿什么跟客户签字？」
- 影响面: 每次必踩。这是 README 快速开始（`README.md:37-39`）和 CI（`.github/workflows/compiler.yml:27-30`）用的同一份 fixture。
- 建议方案: plan 阶段加 `E_PLACEHOLDER_PAGE`（`page` 落在 `templates/segment.html` 且 `style.recipe` 为空 → error）；`qa-video` 加 `--expect-pages`，逐 segment 断言 page basename，并在报告里列出"未使用真实配方的段"；contact sheet 改为按 segment 中点取样。
- 验收断言: Given 当前 fixture，When `node scripts/qa-video.mjs out/mini-41s/master.mp4 --plan out/plan.json --strict`，Then exit 1 且报告含 `placeholder-page FAIL`。
- 工作量: S
- 打分: impact 10 / frequency 10 / confidence 10

### F-05-03 转场词汇是假的：段间硬切，段内只有一个写死的 slam
- 严重度: P1 严重摩擦
- 证据: `grep -rIn "xfade\|acrossfade" .` = **0**；`templates/concat-and-encode.sh:113` 用 `-f concat -c copy`，段与段之间没有重叠手柄，物理上只能硬切。段内入场写死在 `templates/common.js:167-181`（scale 1.13、flash 0.85、shake 14px、push 1.05），profile 只做 flash/impact/shake/push 四个乘数。`templates/motion.js:176 transitionParams()`（slam/whip/glitch/fade 四种）与 `:310 drawKineticText()` 全仓库**零调用**（只有 import/注释）。`MOTION_PROFILES` 里 `transition / easeOut / spring / stagger / kineticMode / blur` 六个字段无人消费：`grep -rn "profile.transition" templates/` = 0，其余同。
- 我的原话: 「我想在 05 和 06 之间做 12 帧 dissolve，或者让大字卡『甩』出去。结果只有 calm/standard/dynamic/maximal，而四档的入场画面是同一个 slam——`motion-profile.mjs:38-43` 承诺的转场/弹簧/逐字，在画面里一个字都没发生。」
- 影响面: 每次必踩。只要涉及"两个镜头怎么接"，工具就只剩切。
- 建议方案: 段间转场必须离开 concat——`render-farm` 输出带重叠的段，用 `xfade` 链合成；spec 加 `rounds[].inTransition:{type,durFrames}`，plan 里生成 xfade 图并校验总帧数不变。段内把 `transitionParams(profile.transition,p)` 接进 `createSegment`，或者把不可达字段从档位表删掉。
- 验收断言: Given `rounds[1].inTransition={type:'whip',frames:8}`，When plan+render，Then plan 出现 xfade 段、`stats.frames` 与无转场时一致。
- 工作量: XL
- 打分: impact 9 / frequency 9 / confidence 10

### F-05-04 单段动效档位静默失效（写了不报错、也不生效）
- 严重度: P1 严重摩擦
- 证据: `schema/project.spec.schema.json:115-121` 的 style 只有 `page/recipe/t0/speed`，没有 `motion`。实测 `rounds[0].style={...,motion:'maximal'}` → plan 输出 `r01-style -> templates/recipe-flat.html?theme=coral-noir&mp=calm`，`issues` 里没有一条 related（未识别字段被静默吞掉）。
- 我的原话: 「赛博那段我想比别的段更猛，写了 `motion:'maximal'`，成片一点没变，也没有任何提示。这比报错更糟——我会以为它生效了。」
- 影响面: 每次必踩（只要想"这一段特殊一点"）。
- 建议方案: style 增加 `motion`，`specToTimeline` 按段下发 `mp`（现有 `templates/timeline.mjs:218` 的 query 只拼全局参数）；schema 对该对象加 `additionalProperties:false`，未知字段报 `E_UNKNOWN_FIELD`。
- 验收断言: Given `rounds[0].style.motion='maximal'` 其余不写，When plan，Then 仅该段 URL 含 `mp=maximal`，其余段 URL 与改前逐字符相同。
- 工作量: S
- 打分: impact 8 / frequency 8 / confidence 10

### F-05-05 画面上的字不是我的字（style 页拿不到 copy，`{{BRAND}}` 直接上屏）
- 严重度: P1 严重摩擦
- 证据: `templates/timeline.mjs:217-222` 给 style 页只拼 theme/motion/accent，没有 title/brand。于是每页回落到自带 demo 文案：`templates/recipe-flat.html:51` `'扁平插画'`、`recipe-minimal.html:52` `'少即是多'`、`recipe-kinetic.html:46` `'速度即风格'`、`recipe-guofeng.html:51` `'东方既白'`。卡页 brand 缺省是字面量 `'{{BRAND}}'` 并在 `templates/big-card.html:749` `fillText` 上屏（`:67`）。仓库真实 plan 可验：`out/guofeng.plan.json` 的 card URL 含 `brand=%7B%7BBRAND%7D%7D`。script 模式的 scene `copy` 也被丢弃（`templates/spec.mjs:174-199` 只读 `pendingCard.copy`）。
- 我的原话: 「交片第一件事是把客户名和标题放上去。现在 11 个风格段各说各的 demo 文案，卡片页脚印着 `{{BRAND}}`——这是工程占位符，不是我的稿子。」
- 影响面: 每次必踩。默认路径（`cvs build spec.json`）产出的片子在画面里就带着模板痕迹。
- 建议方案: style 增加 `copy:{title,subtitle,caption}` 并下发为 URL 参数（页面已在读 `title`，见 `recipe-flat.html:51`）；`meta.brand` 为空/仍为 `{{BRAND}}` 时 lint 由 `W_BRAND`（`templates/spec.mjs:430`）升级为 error。
- 验收断言: Given `meta.brand="ACME"`、`rounds[0].style.copy.title="X"`，When plan，Then 两个 URL 都含对应参数，且 `grep -c "{{BRAND}}" plan.json` = 0。
- 工作量: M
- 打分: impact 9 / frequency 10 / confidence 10

### F-05-06 没有素材通道：我的镜头进不了画面
- 严重度: P1 严重摩擦
- 证据: `spec.assets[]` 只进 segmentHash 与 plan 元数据（`templates/plan.mjs:25-45`、`:102`），**没有任何页面读 assets**（`grep -rln "assets" templates/*.html` = 0）；渲染器只注入 `window.__vars`（`templates/render-segment.mjs:477`）；全仓库无 `<video>`/`currentTime` 取帧（grep = 0）；`ingest/edl.mjs:225-233` 能按 target ±10% 出 EDL，但 `render-farm`/`compile` 不消费 EDL。
- 我的原话: 「我有一堆 4K 屏录要当第 7 段，结果只能放一个 HTML 页面。『assets』字段是给我看的，不是给画面用的——这条链路一看就没接完。」
- 影响面: 特定场景，但一旦要真实素材就 100% 阻断。
- 建议方案: 二选一。要么把 assets/ingest 从对外承诺里删掉；要么实现 `recipe-footage` 页：`<video>` + `currentTime = t0+u*speed` 逐帧 seek，`render-segment` 等 `seeked` 再抓帧，并在 plan 里记录源时间码。
- 验收断言: Given `assets=[{id:'a',kind:'video'}]` 且 `rounds[0].style.useAsset='a'`，When 渲染该段，Then 画面来自该视频第 t 秒，且 qa 的 frozen 检查不误报。
- 工作量: XL
- 打分: impact 9 / frequency 7 / confidence 9

### F-05-07 音频只有一条合成铺底：无 VO、无 ducking、无换曲
- 严重度: P1 严重摩擦
- 证据: `templates/synth_audio.py:299-320` 每一拍都 kick、每四拍固定 snare、固定 arp，全片一个 loop；`:341-348` 每个 cue 都叠 `sub_boom`+kick，示例 plan 55 cue / 61s = 每 1.11s 一发；`schema/project.spec.schema.json:68` 声明了 `audio.vo`，全仓库 **0 行读取**（`grep -rIn "audio\.vo" .` = 0）；`scripts/compile.mjs:93-98` 必须手工 `--audio <wav>`，build 既不合成也不混音；ducking 只有 kick→music（`synth_audio.py:254`、`:350`），没有 VO 侧链；唯一的 VO 混音是文档里让你自己抄的一条 ffmpeg（`references/ai-lane.md:64`）。
- 我的原话: 「客户给一条 48k 配乐和一段口播。我要做的是把配乐套进 61 秒、口播时自动压 6dB。现在这两件事都得离开工具、手写 ffmpeg——那我为什么不在 AE/PR 里做？」
- 影响面: 每次必踩（有声片就没有一条是这条合成轨刚好合适的）。
- 建议方案: `spec.audio` 增加 `music:{path,gain,offset}` / `vo:{path,gain}` / `duck:{depthDb,attackMs,releaseMs}`，在 `concat-and-encode.sh` 用 `sidechaincompress` 实现；`audio.vo` 要么实现要么从 schema 删掉。build 在缺 `--audio` 且 spec 未声明音乐时给出明确 error 而不是静音出片。
- 验收断言: Given `audio.vo` 与 `audio.music` 同时给出，When build，Then 成片含双轨混合、VO 段音乐实测下降 6±1dB、qa-audio 报告 `duck PASS`。
- 工作量: L
- 打分: impact 9 / frequency 9 / confidence 9

### F-05-08 BPM 是装饰：结构以秒写死，换曲对不上
- 严重度: P2 明显不便
- 证据: `templates/timeline.mjs:97-99` bpm 只影响 cue 换算并给一句 warn；`:136` 时长公式全是秒，与 bpm 无关；`schema/project.spec.schema.json:66-68` 的 audio 只有 `mood/bpm/vo`，没有 downbeat offset。参考设计锁死 120BPM（`templates/synth_audio.py:33`）：4s round 在 120BPM 下正好 2 小节，换到 96BPM 就变成 1.67 小节，刀口全部离格。
- 我的原话: 「我手里的曲子是 96 BPM、第一拍在 0.37s。想让每一刀落在小节线上，现在得自己算 `structure.round=5.0` 再去猜 offset，工具一个数都不帮我算。」
- 影响面: 特定场景（用自有配乐），但一旦用就全片错位。
- 建议方案: 加 `audio.offset`（秒）；structure 允许用 `beats` 表达（`round:"8beats"`）；plan 输出每段的 `bar/beat` 对齐表和 `startOffsetMs`；lint 在 `round % bar != 0` 时 warn。
- 验收断言: Given `bpm=96, offset=0.37, structure.round="8beats"`，When plan，Then 每个 `segment.start` 换算成 beat 为整数，且 qa-audio `beatOffset≈0.37`。
- 工作量: M
- 打分: impact 7 / frequency 6 / confidence 9

### F-05-09 音频 QA 的指标在自我满足
- 严重度: P2 明显不便
- 证据: `scripts/qa-audio.py:320-328` 只有"±0.15s 内有 onset"的 cue 才进分母 `near`，判据是 `matched/near`，再配 `coverage>=0.2`（`:348`）——最坏 20%×80% = 16% 的 cue 对齐即可 PASS；`:191-216` beat grid 在 1/2/4 细分里挑命中率最高的那个再断言 ≥0.7（`:352`，且只 WARN）；`:339` 峰值门限 0.891（-1.0 dBFS）与合成器 master `peak_db=-0.6`（`templates/synth_audio.py:267`，≈0.933）自相矛盾；`scripts/qa-video.mjs:159` 文案写"target ≤ -1.0"而断言是 `TP <= -0.5`。
- 我的原话: 「报告说『cue alignment PASS / beat grid 92%』，我却听不出卡点。因为分母把没对齐的 cue 排除了，网格又是自己挑的最合身的那条——这报告证明不了节奏。」
- 影响面: 每次必踩，且直接决定我信不信这份 QA。
- 建议方案: 分母用全部 cue（缺 onset 记 miss），并输出逐段 `start delta` 表；网格固定为用户声明的细分而不是自适应择优；峰值门限收成一个常量并让合成器与 QA 共用；`qa-video.mjs:159` 的文案与断言对齐。
- 验收断言: Given 55 个 cue 中 20 个无 onset，When qa-audio，Then 报告 `align_rate ≤ 35/55` 且整体 FAIL（不是 PASS）。
- 工作量: S
- 打分: impact 8 / frequency 7 / confidence 9

### F-05-10 没有排版系统，只有每页各自的"看着差不多"
- 严重度: P2 明显不便
- 证据: `templates/recipe-flat.html:81` `maxSize: Math.round(H*0.09)`、`:96` `titleSize*0.3`、`:106` `H*0.15`；`templates/recipe-minimal.html:117` 另一套 `L.size`；`grep -rn "typeScale\|--fs-" templates/` = 0，没有共享字阶。安全区也是两套：风格页用 `templates/recipes/util.js:119 safePad(W,H)`，卡页自己算百分比 `templates/big-card.html:285-287`（0.06/0.08）。
- 我的原话: 「11 个风格段的标题字号、行距、页边距全是各页自定。连起来看，字阶在跳、安全区在跳，像 11 个人拼的片子——这正是『模板味』的来源。」
- 影响面: 特定场景（多风格混剪/品牌片），但只要看整体节奏就一定遇到。
- 建议方案: 建 `templates/tokens.mjs`：4 级字阶（display/title/body/caption，按画布高归一）、3 档间距、单一 `safe()`；所有配方 import；`scripts/test-style-pages.mjs` 加一致性断言。
- 验收断言: Given 任意两个 recipe 页在 1920×1080 下，When 取实际 title 像素高，Then 比值 ∈[0.9,1.1] 且左右安全区相等。
- 工作量: M
- 打分: impact 7 / frequency 10 / confidence 10

### F-05-11 审片回流不存在，抽样也看不到刀口
- 严重度: P3 打磨
- 证据: `app/review/README.md:5` 评论只存当前浏览器 `localStorage`，不回写 spec/plan；`scripts/qa-video.mjs:196` contact sheet `fps=1,tile=8x8`，8 个 0.25s 的 flash 一共 2s，最多留 2 格；`templates/concat-and-encode.sh:206` sprite 每 2s 一格。
- 我的原话: 「我在 12.4s 留一条『这里早 6 帧』，这条意见没有任何入口变成 spec 的改动；回看也只能看 1fps 的缩略图，转场和闪白根本不在抽样里。」
- 影响面: 特定场景（有审片流程时），但决定"改一版"的往返成本。
- 建议方案: review 评论带 `segmentId+frame`，导出成 `patches.json` 或"时长建议值"供 plan 消费；contact sheet 改为"每段中点 + 每刀前后 2 帧"，并保留原分辨率局部。
- 验收断言: Given review 页在 frame 372 留评论，When 导出，Then 得到 `{segment:'r03-style',frame:372,delta:-6}` 且能被 plan 读入。
- 工作量: L
- 打分: impact 6 / frequency 5 / confidence 9

## 2. 真实命令输出（原样）

`node bin/cvs.mjs motion matrix`（节选，8 行 kind 完全相同 → kind 只在 style 未知时才起作用）：

```
kind \ style    cyber- cyber- pixel- ink-wa guofen whiteb three- data-v screen flat   minima vertic
promo           maximalmaximaldynamiccalm   calm   calm   dynamicstandardstandardstandardcalm   dynamic
launch          maximalmaximaldynamiccalm   calm   calm   dynamicstandardstandardstandardcalm   dynamic
knowledge       maximalmaximaldynamiccalm   calm   calm   dynamicstandardstandardstandardcalm   dynamic
ecommerce       maximalmaximaldynamiccalm   calm   calm   dynamicstandardstandardstandardcalm   dynamic
```

逐段动效覆盖被吞（`style.motion:'maximal'`）：

```
issues: 1
r01-style -> templates/recipe-flat.html?theme=coral-noir&mp=calm
r02-style -> templates/recipe-flat.html?theme=coral-noir&mp=calm
```

声明 45 秒目标时长：

```
computed duration = 21
[{"code":"E_DURATION","path":"format.duration",
  "message":"duration 45s != structure total 21s (opening + N×round + more + flashes + ending)","level":"error"}]
```

script 模式按真实 in/out 写 3s + 9s 两段：

```
ERR invalid spec:
  - [E_SCRIPT_COVER] script: script ends at 14s but structure totals 22.5s
```

`node scripts/theme-audit.mjs --strict` → exit 0：`✓ WCAG 全部通过  ·  9 项 APCA 提醒`。注意这是**令牌级**审计（`scripts/theme-audit.mjs:16-17` 只 import `auditTheme`/`auditApca`），不含任何渲染帧；配方把字画在自绘色带/版面上（如 `recipe-flat.html:83-108`），上屏对比度并未被验证。

## 3. 汇总

| 严重度 | 条数 | 编号 |
|---|---|---|
| P0 | 2 | F-05-01, F-05-02 |
| P1 | 5 | F-05-03, F-05-04, F-05-05, F-05-06, F-05-07 |
| P2 | 3 | F-05-08, F-05-09, F-05-10 |
| P3 | 1 | F-05-11 |

| 编号 | impact | freq | conf | 工作量 | 一句话 |
|---|---|---|---|---|---|
| 01 | 10 | 10 | 10 | L | 段时长只能由公式推导 |
| 02 | 10 | 10 | 10 | S | QA 全绿但成片是占位页 |
| 03 | 9 | 9 | 10 | XL | 段间无转场，段内只有 slam |
| 04 | 8 | 8 | 10 | S | 单段档位静默失效 |
| 05 | 9 | 10 | 10 | M | 画面文案不是用户的 |
| 06 | 9 | 7 | 9 | XL | 素材进不了画面 |
| 07 | 9 | 9 | 9 | L | 无 VO/ducking/换曲 |
| 08 | 7 | 6 | 9 | M | BPM 不驱动结构 |
| 09 | 8 | 7 | 9 | S | 音频 QA 指标自证 |
| 10 | 7 | 10 | 10 | M | 无字阶/无统一安全区 |
| 11 | 6 | 5 | 9 | L | 审片意见无回流 |

**最该补的一个控制维度：** 段级时长（`rounds[].dur` / `frames`）。它是唯一一个"补上之后其余 6 条都能顺着做"的维度——有了它，转场才有位置、素材才有入点出点、配乐才有 conform 的可能、审片意见才有可写回的字段。
