# T02 品牌 / 市场运营 · 内测反馈（code-video-showcase v2.3.4）

取样基线：仓库 `44849d7c…/code-video-showcase`，`git status` 除既有 `.cluster/` 外仅 `docs/feedback/` 未跟踪，未改动仓库其他文件；未跑 compile/render-farm/image 实渲，未跑 test:all。
取证命令：`node scripts/brand.mjs --help`、`node bin/cvs.mjs image --help`、`node bin/cvs.mjs build --help`、`node bin/cvs.mjs variant … --dry-run`、`node bin/cvs.mjs lint <fixture|探针>`、`node scripts/brand.mjs check …`、`git grep`、以及只在内存中调用 `applyBrand/buildPlanFromSpec` 的 `node -e`（探针 spec 写在 %TEMP%，未落仓库）。

## 取证结论（先回答必答项）

- **品牌色真的进片**：`brand apply` 写 `look.accentOverride`（scripts/brand.mjs:279-281）→ timeline 拼进每一类段的 URL（templates/timeline.mjs:171-178）→ 页面 `themeFromURL()` 调 `accentOverride()`（templates/themes.js:794-802）。实测 opening/style 段 URL 均带 `accent=%2300d4ff&accentInk=%230e0e0d&accentSoft=%236ee0f4`，且 segmentHash 把 accent 计入（templates/plan.mjs:42）。但**只有强调色进片**，logo/字体没进（见 F-02-04）。
- **平台规格不够用**：编码脚本有 6 个平台，build 不接线；渲染只有 3 个画幅（见 F-02-02、F-02-08）。
- **批量变体可脚本化，但有覆盖事故**：`cvs variant` 一次展开矩阵，但所有变体共用输出目录（见 F-02-01）。
- **审片/回滚都不能交给非技术同事**：审片依赖 API job + 本机 localStorage；回滚只回 JSON 文本（见 F-02-06、F-02-07）。
- **交付资产不成套**：封面帧/图片清单有，标题、正文、话题、字幕、投放清单没有（见 F-02-03、F-02-09、F-02-11）。

## Findings

### F-02-01 两个变体共用同一个 render.outDir，第二条 build 覆盖第一条成片
- 严重度: P0 阻断
- 证据: scripts/variants.mjs:205-216（outDir 只作为非枚举元数据）；APPLIERS（:108-130）从不写 `spec.render.outDir`；fixtures/mini-41s/spec.json 的 `render.outDir` 为 `out/mini-41s`，实测 4 个变体全部保持该值；scripts/compile.mjs:90 master 固定 `<outDir>/master.mp4`。
- 我的原话: 「作为品牌运营，我想同一 spec 出 A/B 两版，但按 manifest 顺序 build 完，B 把 A 的 master.mp4 覆盖了，我手里只剩一条片。」
- 影响面: 每天出 2 版的人必踩；错发版本属于对外事故
- 建议方案: `expandVariants` 把 `spec.render.outDir` 设为 `${baseOut}/${id}`，或新增 `cvs variant --build` 逐个传 `--outdir`；manifest 增 `masterPath/sha256`
- 验收断言: Given axes 两个 theme，When 展开后逐个 build，Then `out/variants/<idA>/master.mp4` 与 `<idB>/master.mp4` 同时存在且 sha256 不同，默认 `out/master.mp4` 不被改写
- 工作量: M
- 打分: impact 9 / frequency 9 / confidence 10

### F-02-02 平台交付预设没接进 `cvs build`，`render.preset` 是只写不读的死字段
- 严重度: P0 阻断
- 证据: templates/spec.mjs:80 定义 `bilibili|douyin|youtube|wechat|master|square`；`cvs build --help` 无 `--platform`；scripts/compile.mjs:93-107 调 concat 脚本时不传 platform，无 `--audio` 时直接 `-c copy`；`git grep render.preset` 只命中 variants 写入与 spec 校验，无消费方。平台表真实存在于 templates/concat-and-encode.sh:92-98。
- 我的原话: 「作为投放，我以为 spec 里选 douyin 就会出竖屏交付版，结果 build 出来还是 master 参数的一条 mp4，平台那套 CRF/码率/尺寸根本没生效。」
- 影响面: 每个平台每次交付；非技术同事不会去手跑 bash
- 建议方案: 把 `spec.render.preset` 映射到 `--platform`，`cvs build` 增 `--platform`，输出 `<outDir>/<platform>.mp4`，manifest 记 platform
- 验收断言: Given `render.preset=xiaohongshu` 且有音轨，When `cvs build`，Then concat 参数含 `--platform xiaohongshu`，ffprobe 输出 1080×1440，且 master 同时保留
- 工作量: S
- 打分: impact 9 / frequency 9 / confidence 10

### F-02-03 片头主副标题是开发占位语，且没有平台标题/正文/话题字段
- 严重度: P0 阻断
- 证据: templates/segment.html:86-87（`风格段标题` / `替换 drawScene() 开始做真正的画面`）、:99 默认写入；scripts/nl2spec.mjs:596 与 app/wizard/app.js:314 都产出 `patches: []`；schema/project.spec.schema.json:11-19 的 meta 只有 name/brand/cta/locale。实测 `cvs new …` 的 opening 无 title，plan 的 `00-opening` URL 只有 theme/mp。
- 我的原话: 「作为品牌运营，我想把 campaign 标题放进片头，但打开成片，片头副标题写着『替换 drawScene() 开始做真正的画面』——这是给我客户看的东西。」
- 影响面: 每个默认入口生成的片子必踩；对外交付即事故
- 建议方案: schema 增 `meta.title/description/tags` 与 `opening.title/sub`，timeline 拼进 URL，页面读参数；lint 对占位标题报 error；wizard/`cvs new` 增加标题输入
- 验收断言: Given `cvs new "…"` 的 spec 未填 title，When lint，Then exit≠0 且报 E_TITLE_PLACEHOLDER；When 填 title 后 plan，Then opening URL 含 `title=` 且不含 `风格段标题`
- 工作量: M
- 打分: impact 10 / frequency 10 / confidence 9

### F-02-04 品牌包只有强调色进片，logo 和品牌字体只写进 spec 元数据
- 严重度: P1 严重摩擦
- 证据: scripts/brand.mjs:271-276 把 logo/fonts 写入 `meta.brandKit`；`git grep brandKit` 仅命中 brand.mjs，templates/ 无读取方；`git grep brand.fonts` 仅 brand.mjs:275；logo 只在 :361-372 做存在性校验。画面水印走 `brand` 文本参数（templates/segment.html:180），不是 logo 文件。
- 我的原话: 「我把品牌包 apply 上去，以为水印会换成我们的 logo、标题会用品牌字体，结果水印只是把品牌名当文字写上去，字体还是默认的。」
- 影响面: 所有需要品牌规范落地的投放；每次必踩
- 建议方案: 页面接收 `?logo=`/`?logoW=` 并按 `logo.safeArea` 绘制；`brand.fonts` 经 `loadFontsFor` 映射到标题/正文；apply 时把 logo 转成可服务 URL
- 验收断言: Given 品牌包含 logo，When build，Then opening/card URL 含 `logo=`，同帧加/不加 logo 的静帧 sha256 不同；Given heading 字体，Then canvas 标题字体族等于 `brand.fonts.heading`
- 工作量: L
- 打分: impact 8 / frequency 9 / confidence 9

### F-02-05 品牌合规检查不在 build 链路，占位品牌名和禁用词都能过
- 严重度: P1 严重摩擦
- 证据: scripts/brand.mjs:457-461 `apply` 无条件 `return 0`；`forbiddenWords` 只在 brand.mjs:322 被读（`git grep` 无其他非测试命中）；templates/spec.mjs:430 对 `{{BRAND}}` 只 warn。实测 `cvs lint`/`brand check` 对 `{{BRAND}}` 均 exit 0：`[warn] [W_BRAND] meta.brand: brand is still the {{BRAND}} placeholder` → `0 error(s), 1 warning(s)`。
- 我的原话: 「我改完文案让同事 build 发出去，没人提醒我里面还留着 {{BRAND}}，禁用词『国家级』也不会被拦——这在广告法上是真金白银的罚款。」
- 影响面: 每次改文案；合规风险高、频率中
- 建议方案: compile 在 spec 有 `brandKit` 时调 `checkBrand`，把 E_FORBIDDEN_WORD / 占位 brand 升级为 error；`brand apply` 有 error 时 exit 1
- 验收断言: Given card.first 含「最好」且 brand=tech-dark，When `cvs build`，Then exit≠0 且 stderr 含 E_FORBIDDEN_WORD；Given `meta.brand={{BRAND}}`，Then build exit≠0
- 工作量: S
- 打分: impact 9 / frequency 6 / confidence 10

### F-02-06 审片离不开技术同事：必须先有 API job，评论只存本机且无法导出
- 严重度: P1 严重摩擦
- 证据: app/review/index.html:24 空状态要求「在 API 上先 POST /jobs」；app/review/app.js:228 视频源只接受 `${api}/jobs/<id>/master.mp4`；app/review/README.md:56-58 评论仅 localStorage、无导入导出、只读；全仓无 approve/reject 状态。
- 我的原话: 「我想把片子发群里让老板点个『过』，结果这页得先有人起服务、发 job，评论还只存在我这台电脑上，老板打开是空的。」
- 影响面: 每次审片；跨人协作 100% 卡住
- 建议方案: review 支持直接选本地 mp4；评论落 `out/<job>/review.json` 并可导出 CSV；增加 通过/驳回/待改 三态；生成只读分享链接
- 验收断言: Given 磁盘上的 master.mp4，When 在 review 页选择该文件，Then 可播放且不请求 5190；When 点导出，Then 下载含全部时间码的 review.json
- 工作量: M
- 打分: impact 8 / frequency 9 / confidence 9

### F-02-07 「回滚」只回滚 JSON 文本，不回滚成片，也不是一键
- 严重度: P1 严重摩擦
- 证据: app/versions/app.js:395-397 恢复只写回编辑缓冲区并提示「未下载」；app/versions/README.md:39 仅 localStorage、:42 恢复后还要手动「下载当前」；scripts/compile.mjs:90 每次 build 覆盖 `<outDir>/master.mp4`，无版本归档。
- 我的原话: 「老板说上一版更好，我点『恢复』，它只把一段 JSON 放回输入框，我还得下载、覆盖文件、重新 build——上一版 mp4 已经被这次 build 覆盖了，回不去。」
- 影响面: 每次改版返工；发布后回滚几乎不可行
- 建议方案: 版本快照记录 master 路径+sha256；恢复时按版本目录重建/直接取回 mp4；review 页加「回滚到此版」
- 验收断言: Given 已 build 的 v1/v2，When 点回滚 v1，Then `out/versions/v1/master.mp4` 存在且 sha256 等于 v1 记录值，全程无需手改 JSON
- 工作量: L
- 打分: impact 8 / frequency 6 / confidence 9

### F-02-08 视频只能出 16:9 / 9:16 / 1:1，小红书 3:4、视频号 6:7 只能补黑边
- 严重度: P1 严重摩擦
- 证据: templates/reflow.mjs:18-25 仅三种画幅；schema/project.spec.schema.json:28 枚举相同；references/platform-presets.md:28-29 承诺 1080×1440 / 1080×1260；templates/concat-and-encode.sh:117,157 用 `force_original_aspect_ratio=decrease` + `pad=…:color=black`。
- 我的原话: 「我要发小红书 3:4，工具只能给我 9:16 加左右黑边；视频号 6:7 同理。平台一看就是没适配，封面还会被裁。」
- 影响面: 小红书/视频号每次投放；至少 2 个平台不合规
- 建议方案: reflow 增 3:4、4:5、6:7 参数与安全区；build 按 platform 选画幅；platform 与 aspect 不匹配时报错而非静默 pad
- 验收断言: Given aspect=3:4，When build，Then 所有段尺寸 1080×1440 且 concat 不走 pad 分支；Given 16:9 + platform=xiaohongshu，Then exit≠0 提示需 reflow
- 工作量: L
- 打分: impact 8 / frequency 8 / confidence 10

### F-02-09 没有任何字幕产物，静音投放等于没有文案
- 严重度: P1 严重摩擦
- 证据: README.md:633 明写「不使用底部字幕」；`git grep -E '\.srt|\.vtt|webvtt'` 在 scripts/templates/bin/server/app 无命中；references/platform-presets.md:71 写「雪碧图 + WebVTT（脚本 --sprite）」，但 templates/concat-and-encode.sh:206-207 只产出 `qa/sprite.jpg`。
- 我的原话: 「抖音和小红书大部分人是静音刷的，我需要一条带字幕的版本；工具连 .srt 都不给，只能拿去剪映再压一遍——那我不如整条都在剪映改。」
- 影响面: 每条短视频投放；无障碍/合规也需要
- 建议方案: spec 增 `captions[]`（或从 card/cue 自动生成），build 输出 master.srt/.vtt，提供 `--burn-subtitles` 按画幅安全区压制
- 验收断言: Given spec 有 N 条 caption，When build，Then `out/master.srt` 有 N 条 cue 且与 plan cues 误差 ≤30ms；Given `--burn-subtitles`，Then 对应时间段出现文字像素
- 工作量: M
- 打分: impact 8 / frequency 7 / confidence 10

### F-02-10 封面默认是风格段 78% 处截帧，不是封面版式；且每次出图清空输出目录
- 严重度: P2 明显不便
- 证据: scripts/image.mjs:88 默认 `kind='style'`、:58-62 hero 帧取段长 78%；:161 `fs.rmSync(outDir,{recursive:true,force:true})` 每次先删目录。
- 我的原话: 「我要的是能压大字标题的封面，它给我一张带编号胶囊和倒计时的正片截图；我补出第二套尺寸，第一套图被删了。」
- 影响面: 每次出封面/方图；多尺寸批次必踩
- 建议方案: 默认封面改用 card/独立 cover 版式；`--out` 已存在时要求 `--force` 或写入时间戳子目录；manifest 记批次 id
- 验收断言: Given 连续两次 `cvs image --set cover --at 1` 与 `--at 2`，When 第二次结束，Then 第一批文件仍在（或第二次因未加 --force 拒绝执行）
- 工作量: S
- 打分: impact 6 / frequency 8 / confidence 10

### F-02-11 没有「平台→文件→封面→标题」的投放清单，只有图片清单
- 严重度: P2 明显不便
- 证据: scripts/image.mjs:223-238 只写 image-manifest（preset/尺寸/文件/sha）；scripts/compile.mjs:121-130 的 render-manifest 是分段缓存状态；references/platform-presets.md 有平台表但不是可生成产物；全仓无 delivery/投放清单生成器。
- 我的原话: 「一天 3 个尺寸 2 个版本，最后我要对着 6 个 mp4 和 6 张封面猜哪个是抖音、哪个是小红书，还得手填标题——清单在哪？」
- 影响面: 每次多平台投放；错发风险
- 建议方案: 新增 `cvs deliver` 输出 delivery.json/csv：platform/aspect/file/sha256/duration/bytes/cover/title/cta/specHash/时间
- 验收断言: Given 2 变体×3 平台已 build，When `cvs deliver`，Then delivery.json 6 行且每行 file 存在、sha256 与磁盘一致、含 cover 与 title
- 工作量: M
- 打分: impact 7 / frequency 8 / confidence 9

### F-02-12 变体轴三个陷阱：brand 轴不改色、theme 轴被品牌覆盖压住、copy 轴改不到片头
- 严重度: P2 明显不便
- 证据: scripts/variants.mjs:129 `brand` 轴只写 `spec.meta.brand`；:109 `theme` 轴只改 `look.theme`，不清 `accentOverride`；:88-92 `applyCopy` 只写 `rounds[].card.first/keyword`，opening/ending 无字段。
- 我的原话: 「我以为 brand 轴能换一套品牌包，结果只换了个字符串；theme 轴换了主题，主色还是上一套品牌色；copy 轴改了卡片，片头标题纹丝不动。」
- 影响面: 做 A/B 版本的人；特定场景
- 建议方案: brand 轴加载 brand kit 并走 `applyBrand`；theme 轴提供 `clearAccent` 选项或冲突时 warn；增加 opening/ending copy 轴
- 验收断言: Given brand 轴两套 kit，When expandVariants，Then 两个 spec 的 `look.accentOverride.accent` 不同；Given 已有 accentOverride + theme 轴，Then 输出 W_AXIS_ACCENT_CONFLICT
- 工作量: M
- 打分: impact 7 / frequency 6 / confidence 10

## 结论：能不能替掉外包的「改一版」

**能替的是「重新渲染」，替不掉「交付前的最后一公里」。**

- 能替：改卡片文案、换 theme、套品牌 accent 后，`segmentHash` 让缓存只重渲受影响段（templates/plan.mjs:24-47），一条 41 秒片改一版是分钟级；品牌色确实全链路进片（已实测 URL，confidence 9）。
- 卡点一：**版本产物层**——两个变体共用一个 `out/`，第二条 build 覆盖第一条（F-02-01），这是会发错片的硬伤。
- 卡点二：**平台交付层**——`render.preset` 没接线（F-02-02），小红书 3:4 / 视频号 6:7 没有版面只有黑边（F-02-08）；每条片仍要手工 ffmpeg。
- 卡点三：**文案/字幕资产层**——片头是开发占位语，没有平台标题/正文/话题字段（F-02-03），没有 srt/vtt（F-02-09）；每条片仍要剪映压字幕、手写文案。
- 卡点四：**审片/回滚闭环**——审片要 API job、评论不能导出（F-02-06），回滚只回 JSON 文本且旧 mp4 已被覆盖（F-02-07）；非技术同事无法独立完成。

按现在的代码，T02 每条片子仍要做 3 次手工补救（平台版转码、字幕压制、投放清单整理），所以答案是：**不能整环替掉外包，只能替掉「重渲」这一半；要真替，先修 F-02-01/02/03 三条 P0。**
