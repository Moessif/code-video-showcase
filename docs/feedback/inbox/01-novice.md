# T01 小白短视频创作者 · 内测反馈（v2.3.4）

- 基线：`E:/myzcode/.zcode/workspace/44849d7c-76ab-4ddb-9e7a-7f28ebdea221/code-video-showcase`，package.json `2.3.4`。
- 测试环境：`cvs doctor` 必需项全绿（Node 24.22.1 / Chrome / ffmpeg 7.0.2 / Python 3.12.9，4 项可选缺失），但按 T01 画像「不会 Node、只会剪映」评估，不把本机环境当作小白可用前提。
- 范围：README 前 80 行、`cvs --help` / `new --help`、`cvs new` 生成的 spec、`cvs lint`、`app/wizard/` 静态阅读与 serve 探测；未跑真实渲染。

## 必答：如果我是第一次打开这个仓库，我会在哪一步放弃？

**第一次放弃：README 第 42 行，第一条可执行指令是 `node bin/cvs.mjs new ...` 时。** 我不会 Node，也没有双击就能打开的页面；唯一被称作「小白入口」的 wizard 仍要求 `node app/wizard/serve.mjs`（`app/wizard/README.md:6-9`），`file://` 直接打开会被 CORS 拒绝（同文件 11-13）。README 前 80 行没有一句「不会 Node 怎么办」，唯一的安装说明是发给 Agent 的（`README.md:9-13`），wizard 只在第 79 行的表格里出现一次。

**第二次放弃：如果有人帮我启动 wizard，我会在点完「下载 project.spec.json」之后放弃。** 页面没有「出片」按钮，下载后没有任何下一步提示（`app/wizard/index.html:169-171`、`app/wizard/app.js:829-840`）；文件落到默认的 Downloads 后再跑 `cvs build`，会收到 12 条 `E_PAGE_MISSING`，因为 root 默认指向 spec 所在目录（`scripts/compile.mjs:46`，真实 stderr 见 F-T01-08）。

## 反馈条目

### F-T01-01 小白入口仍然以 Node 为前提，前 80 行没有非技术路径
- 严重度: P0 阻断
- 证据: `README.md:42-47`（第一条可执行示例 `node bin/cvs.mjs new ...`）；`app/wizard/README.md:6-9`（小白入口也要 `node app/wizard/serve.mjs`）；同文件 11-13（`file://` 会被 CORS 拒绝）；`app/wizard/index.html:177`（「请通过 node app/wizard/serve.mjs 打开本页」）。
- 我的原话: 「作为只会剪映的小白，我想打开一个页面就开始选，但仓库里每个入口的第一句都是 node 命令，我连 wizard 都启动不了。」
- 影响面: 所有没有 Node 环境的非技术用户；第一次打开仓库时 100% 遇到。
- 建议方案: 提供 `start-wizard.cmd`（检测/提示安装 Node 并自动开浏览器）或托管 Demo；README 首屏加「不会 Node？点这里」并放 3 步图文；若产品只服务 Agent，请把「非技术用户请勿使用」写在第一屏，不要同时把 wizard 叫「小白入口」。
- 验收断言: Given 一台没有 Node 的电脑，When 用户只按 README 首屏操作，Then 要么 5 分钟内能看到 wizard 页面，要么首屏明确告知「需要 Node / 请让 Agent 安装」且不再出现「小白入口」承诺。
- 工作量: M
- 打分: impact 10 / frequency 10 / confidence 9

### F-T01-02 spec 到片子没有最后一公里：wizard 没有出片按钮，下载后无下一步
- 严重度: P0 阻断
- 证据: `app/wizard/index.html:31`（「选两下，得到一支片子的 spec。」）；同文件 169-171 只有「下载 project.spec.json / 复制」；`app/wizard/app.js:829-840` 的下载函数只写 Blob；`grep -rn "cvs build\|master.mp4" app/wizard/` 无输出；`node bin/cvs.mjs new ...` 输出只有 spec 路径和 4 条 note，没有 next。
- 我的原话: 「作为小白，我想选完就拿到能发的 mp4，但我点完最大的按钮只下载了一个 project.spec.json，页面没有任何下一步。」
- 影响面: 每一个走 wizard 的用户；每次必踩。
- 建议方案: 在下载按钮旁加「生成视频」主按钮（调用现有 `server/api.mjs` 队列），或至少弹出一张「下一步」卡：`cd <repo> && node bin/cvs.mjs build <spec> --root .`，并写明预计耗时与产物路径；否则把标题改成「选两下，得到一份 spec」。
- 验收断言: Given wizard 已生成 spec，When 用户点击主 CTA，Then 页面在 10 分钟内给出可播放 mp4 的路径，或显示一条可直接复制执行、含 `--root` 的 build 命令与产物路径。
- 工作量: L
- 打分: impact 10 / frequency 10 / confidence 10

### F-T01-03 默认成片的开场/结尾是开发者占位文案，品牌占位符也不会被替换
- 严重度: P0 阻断
- 证据: `templates/segment.html:86-87`（`PLACEHOLDER_TITLE='风格段标题'`、`PLACEHOLDER_SUB='替换 drawScene() 开始做真正的画面'`）、同文件 180（stamp 回退到 `BRAND`）；`templates/timeline.mjs:185,269` 的 opening/ending URL 只带 theme/motion/accent；`node templates/plan.mjs --spec /tmp/t01.spec.json --root . --print` 首段是 `templates/segment.html?theme=cyber-neon&mp=maximal`，卡片 URL 带 `brand=%7B%7BBRAND%7D%7D`。
- 我的原话: 「作为要发宣传片的人，我想开场就出现我的品牌，但按默认路径出的片，开场 5.5 秒写着『风格段标题 / 替换 drawScene() 开始做真正的画面』，右上角还是 {{BRAND}}。」
- 影响面: 所有用 nl2spec/wizard 默认 spec 的成片；30 秒片的开场+结尾共 10 秒（三分之一时长）。
- 建议方案: 给 opening/ending 接真实模板或参数：plan 把 `meta.brand`、`opening.name`、结尾文案下发到 segment 页；segment.html 的 `eff()` 读 URL/params；没有文案时至少回退到 `meta.name`，而不是开发者占位符。
- 验收断言: Given spec 里 brand=「赛博像素」，When 生成 plan 并检查 t=1s / t=29s 的静帧，Then 画面中不出现 `风格段标题`、`替换 drawScene()`、`{{BRAND}}`。
- 工作量: M
- 打分: impact 9 / frequency 10 / confidence 9

### F-T01-04 第 07 张卡写的「结尾 CTA」没有任何模板消费，成片里不会出现
- 严重度: P1 严重摩擦
- 证据: `app/wizard/index.html:139-148`（第 07 张卡写明「写进 meta.cta，出现在结尾段」）；`grep -rnw "cta" templates/*.html` 无输出（退出码 1）；`templates/spec.mjs:124` 只是把 cta 存进 spec；`templates/timeline.mjs:269` 的 ending URL 不带 cta。
- 我的原话: 「作为小白，我认真填了结尾 CTA『立即预约』，但成片里根本没有这四个字，卡片上的承诺是假的。」
- 影响面: 所有使用第 07 张卡的用户；每次必踩。
- 建议方案: 要么把 `meta.cta` 下发到 ending 页并渲染，要么删掉第 07 张卡；lint 增加 `E_CTA_UNUSED`（当前没有任何模板消费 cta 时必须报错，而不是静默）。
- 验收断言: Given spec.meta.cta=「立即预约」，When 检查结尾静帧，Then 画面文本包含「立即预约」；若未实现，则 wizard 不显示该卡且 lint 报错。
- 工作量: S
- 打分: impact 7 / frequency 10 / confidence 10

### F-T01-05 七张卡里没有「文案」卡：四轮大字卡永远重复同一句，改文案要手改 5 处 JSON
- 严重度: P1 严重摩擦
- 证据: `app/wizard/app.js:69-70`（promo 文案固定 `['想做','宣传片？']`）；同文件 237-253 每轮复用同一组 first/keyword；`app/wizard/index.html:67-149` 七张卡没有文案输入；生成的 `/tmp/t01.spec.json:55-131` 四轮完全相同，`moreCard` 也是固定「还有/更多？」；`app/script/README.md:1-9` 有文案表格编辑器，但 wizard 没有链接。
- 我的原话: 「作为创作者，我想写自己的四句卖点，但七张卡里没有一处能改文案，四轮大字卡全是『想做 / 宣传片？』。」
- 影响面: 所有需要真实文案的用户；每条片必踩。
- 建议方案: 加第 08 张「文案」卡（4 行 first/keyword 表格），或把已存在的 `app/script`（5183）链接进 wizard；nl2spec 至少把用户原句拆成 4 条不同文案，而不是复制同一句。
- 验收断言: Given 用户在 wizard 输入 4 行不同文案，When 下载 spec，Then `rounds[].card.keyword` 有 4 个不同值，且渲染出的 4 张卡文字与输入一致。
- 工作量: M
- 打分: impact 9 / frequency 10 / confidence 10

### F-T01-06 8 组预设里没有「30 秒竖屏宣传片」：唯一 30s 宣传片是 16:9，唯一竖屏是 15s 电商
- 严重度: P1 严重摩擦
- 证据: `content/presets.json:6-12`（promo-cyber-pixel 30s / 16:9）；同文件 39-45（唯一 9:16 是 15s 电商）；其余 6 组均 16:9；`app/wizard/app.js:142` 默认 aspect 16:9；同文件 352 只显示原始 `16:9` 标签，没有「横屏/竖屏」。
- 我的原话: 「作为抖音用户，我要 30 秒竖屏，但首屏 8 个推荐里没有这个组合，最像的『宣传片·赛博像素』点下去是横屏。」
- 影响面: 竖屏平台创作者；第一次选预设时必踩。
- 建议方案: 增加 `promo-cyber-pixel-vertical`（30s/9:16）预设；卡片把 `16:9` 显示成「横屏 1920×1080」、`9:16` 显示成「竖屏 1080×1920」；记住上次画幅。
- 验收断言: Given 首次打开 wizard，When 用户选「宣传片·赛博像素」，Then 生成的 spec 是 1080×1920 / 30s；或首屏存在明确标注「30 秒竖屏」的预设。
- 工作量: S
- 打分: impact 8 / frequency 9 / confidence 10

### F-T01-07 W_BRAND 只警告不阻断，build 继续出带 {{BRAND}} 的片，且不告诉怎么修
- 严重度: P1 严重摩擦
- 证据: `node bin/cvs.mjs lint /tmp/t01.spec.json --root .` 真实输出 `[warn] [W_BRAND] meta.brand: brand is still the {{BRAND}} placeholder` 与 `✓ ... 0 error(s), 1 warning(s)`，退出码 0；`scripts/compile.mjs:57` 只打印 warning 后继续；`node templates/plan.mjs ... --print` 里卡片 URL 是 `brand=%7B%7BBRAND%7D%7D`。
- 我的原话: 「作为小白，我看到绿色的『0 error』就以为可以发了，结果片子里每一张卡都印着 {{BRAND}}，lint 只轻描淡写说了一句 warning。」
- 影响面: 所有没填品牌名的用户；默认路径必踩。
- 建议方案: `cvs build` 把 W_BRAND 当阻断错误（或用 `meta.name` 自动兜底），并给出修复命令（编辑 `spec.meta.brand` 或 `cvs brand apply`）；lint 文案加中文「品牌名还没填」。
- 验收断言: Given spec.meta.brand 仍是 `{{BRAND}}`，When 运行 `cvs build`，Then 退出码非 0、不产出 mp4，并打印一条可执行的修复命令。
- 工作量: S
- 打分: impact 8 / frequency 9 / confidence 10

### F-T01-08 下载的 spec 放在仓库外，`cvs build` 报 12 条 E_PAGE_MISSING，不告诉你 `--root`
- 严重度: P1 严重摩擦
- 证据: spec 在 `C:/Users/chen/AppData/Local/Temp/t01.spec.json` 时运行 `node bin/cvs.mjs build ... --dry-run`，真实 stderr 前 3 行：`invalid spec:` / `- [E_PAGE_MISSING] opening.page: page not found: templates/segment.html` / `- [E_PAGE_MISSING] rounds[0].card.page: ...`，共 12 条，退出码 1；`scripts/compile.mjs:46` root 默认 spec 所在目录。
- 我的原话: 「作为从浏览器下载 spec 的人，我想直接 build，但终端刷出 12 条 page not found，我不知道它说的 templates 在哪里，也没人告诉我加 --root。」
- 影响面: 所有用「下载」按钮、把文件放在 Downloads 的用户；每次必踩。
- 建议方案: 错误信息打印 `root=<resolved>` 并追加「请加 --root <仓库根>」；wizard 下载时在按钮旁给出完整 build 命令；或让 `cvs build` 从 `bin/cvs.mjs` 所在仓库自动推断 templates 根。
- 验收断言: Given spec 在仓库外，When 运行 `cvs build`，Then stderr 同时包含解析出的 root 和一条可直接复制的 `--root <repo>` 命令；或直接构建成功。
- 工作量: S
- 打分: impact 8 / frequency 9 / confidence 10

### F-T01-09 `cvs build` 默认出无声片：配乐要另跑 python，CLI 帮助和 README 前 80 行都没说
- 严重度: P1 严重摩擦
- 证据: `node bin/cvs.mjs build --help` 真实输出含 `--audio <wav> optional soundtrack; without it the film is video-only`；`scripts/compile.mjs:93-107` 无 audio 时走 `-c copy` 的纯视频 concat；`README.md:42-47` 的统一 CLI 示例没有 `--audio`；配乐命令到 `README.md:309` 才出现。
- 我的原话: 「作为要发抖音的人，我想要有 BGM 的 30 秒片，但按 README 的 build 命令出来是无声的，帮助里只说 optional。」
- 影响面: 所有按统一 CLI 出片的用户；默认路径必踩。
- 建议方案: `cvs build` 在 spec.audio 存在时自动调用 `templates/synth_audio.py --plan <plan> --out <out>/audio.wav` 再 mux；若 Python/依赖缺失，明确提示「成片将无声」并给出命令；把 `--audio` 从 optional 改为推荐。
- 验收断言: Given spec.audio.mood=electronic，When 运行 `cvs build`（不带 --audio），Then `ffprobe master.mp4` 含 audio stream；或 build 停止并打印生成配乐的确切命令。
- 工作量: M
- 打分: impact 9 / frequency 10 / confidence 9

### F-T01-10 wizard 的状态条和帮助入口是开发者向：normalizeSpec / validateSpec / APCA / 入口 C1 / 集群计划
- 严重度: P2 明显不便
- 证据: `app/wizard/app.js:776` 状态条 `✓ normalizeSpec + validateSpec：0 error · 1 warning`；`app/wizard/index.html:174-178` 页脚出现 `/templates/spec.mjs`、`spec-lint`、`APCA`；同文件 20/23/24 顶栏是「入口 C1」「集群计划」「使用说明」，其中「使用说明」指向 `app/wizard/README.md`（开发者文档）。
- 我的原话: 「作为小白，我想知道现在能不能下载，但页面告诉我『normalizeSpec + validateSpec：1 warning』，我不知道这是什么，也不知道 warning 要不要管。」
- 影响面: 所有非技术用户；每次打开页面都看到。
- 建议方案: 状态条改成「✓ 可以下载 · 1 条提醒：品牌名还没填（去填）」；把函数名/APCA/spec-lint 收进「技术细节」折叠；顶栏换成「3 步出片 / 常见问题」，删掉「入口 C1」「集群计划」。
- 验收断言: Given 页面有 1 条 W_BRAND，When 首次打开，Then 状态区只出现中文人话 + 一个修复入口，不出现 `normalizeSpec` / `validateSpec` / `APCA` / `spec-lint` 字样。
- 工作量: S
- 打分: impact 5 / frequency 10 / confidence 9

### F-T01-11 CLI 帮助是内部脚本的 help，不是 cvs 的 help；枚举全是英文 id
- 严重度: P2 明显不便
- 证据: `node bin/cvs.mjs new --help` 首行 `Usage: node scripts/nl2spec.mjs "<自然语言>" [options]`，风格列 13 个英文 id；`node bin/cvs.mjs build --help` 首行 `Usage: node scripts/compile.mjs --spec <project.spec.json> [options]`；只有 `cvs --help` 才出现 `cvs`。
- 我的原话: 「作为第一次用命令行的人，我输入 cvs new --help，它回我一堆 nl2spec 和 13 个英文风格 id，我不知道『赛博像素』该选哪个。」
- 影响面: 所有首次用 CLI 的用户；每次查帮助都遇到。
- 建议方案: 子命令 help 统一以 `cvs new` 开头；每个枚举给中文名 + 一句适用场景 + 默认值，并给两条可直接复制的例子（含 30s / 9:16）；加一句「不知道选什么就用默认」。
- 验收断言: Given 运行 `cvs new --help`，Then 首行是 `cvs new`，输出含中文枚举说明和一条 30 秒竖屏示例；不出现 `nl2spec.mjs`。
- 工作量: S
- 打分: impact 6 / frequency 8 / confidence 10

### F-T01-12 页面没有任何画面预览，只有 JSON 和两个色块，选卡看不到片子长什么样
- 严重度: P3 打磨
- 证据: `app/wizard/index.html:160-180` 右侧只有 `<pre id="spec-json">` 与下载/复制；`app/wizard/app.js:340-346` 预设卡只有两色 swatch；`app/wizard/app.js:757-765` 把 spec 全文塞进 pre；仓库 `assets/contact-1fps.jpg`、`assets/style-tiles.jpg` 未在 wizard 使用。
- 我的原话: 「作为视觉创作者，我想先看一眼片子长什么样再决定，但页面只给我一大段 JSON 和两个色块，我完全不知道成片是什么风格。」
- 影响面: 所有视觉向用户；每次选预设都缺少判断依据。
- 建议方案: 每个预设卡展示一张真实首帧（可用现有静帧/主题预览图），或在右侧加「预览首帧」按钮（复用 `templates/render-segment.mjs --still` / `app/review`），并支持 9:16 画幅预览。
- 验收断言: Given 用户选中任一预设，When 页面稳定 3 秒后，Then 右侧出现至少一张与该 theme/style 对应的真实静帧；无图时明确显示「预览生成中 / 失败原因」。
- 工作量: M
- 打分: impact 7 / frequency 9 / confidence 9

## 值得保留的（非 finding）

- `cvs lint` 的真错误是人话：`[error] [E_THEME_UNKNOWN] look.theme: unknown theme "neon-cyber"; known: coral-noir, ...`（12 个合法值一次列全），比 warning 路径好得多。
- `cvs doctor` 按 runtime / ffmpeg / browser / python / assets / disk 分块，缺什么一眼可见。
- wizard 的 8 组预设、avoid 矩阵、参考图取色是真正的差异化；问题只在于它们停在 spec，没有走到片子。
