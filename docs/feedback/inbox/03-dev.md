# T03 独立开发者 / 自托管工程师 · 内测反馈（v2.3.4）

- 基线：`E:/myzcode/.zcode/workspace/44849d7c-76ab-4ddb-9e7a-7f28ebdea221/code-video-showcase`，`package.json` `2.3.4`，HEAD `f67616d`。
- 环境：Windows 11 + Git Bash，Node `v24.22.1`，Chrome 157，ffmpeg `7.0.2-full_build`，Python `3.12.9`，`node scripts/doctor.mjs` 退出 0（4 项 optional 缺失）；`node_modules` 未安装，未做真实渲染。
- 范围：`bin/cvs.mjs`、`scripts/spec-lint.mjs`、`scripts/compile.mjs`、`templates/plan.mjs`、`scripts/golden.mjs`、`scripts/determinism-check.mjs`、`server/api.mjs`、`.github/workflows/*`、`package.json`/`package-lock.json`；实跑 CLI 错误路径、`doctor`、`test-core`、`test-spec-security`。
- 结论计数：P1 × 5，P2 × 6，P3 × 1。

## 必答：能不能塞进 GitHub Actions，并在失败时知道为什么？

**能塞，而且仓库已经塞好了**：`compiler.yml`（push/PR 触发，两个 job）跑 `test:all` + lint + plan + CLI/motion smoke + golden selfcheck；`render-smoke.yml` 跑 2 秒真渲染、concat、QA 并上传 `out/smoke/`。退出码能正确传播（CLI 透传子进程，测试失败 exit 1）。

**但“知道为什么”只对人成立，对机器不成立**：所有失败都收敛成 exit 1；`build` 的 spec/JSON 错误是原始 Node 堆栈；render/concat/QA 三阶段共用一句 `[compile] ... failed`；API job 的 `error` 只有 `compile exited with code N`；lint 的 `--json` 在致命错误时 stdout 为空；测试套件有四种互不兼容的汇总格式。CI 红了你需要人肉翻日志，不能直接生成 annotation、不能按错误码分流、不能从 API 轮询拿到失败阶段。把下面 F-03-02/03/07/10 修掉，才算“可编程的失败”。

## 实测退出码与原文（可直接复现）

```
$ node bin/cvs.mjs --help ; echo EXIT=$?
cvs — video compiler ... EXIT=0
$ node bin/cvs.mjs lint --help ; echo EXIT=$?
Usage: node scripts/spec-lint.mjs --spec <project.spec.json> ... EXIT=0
$ node bin/cvs.mjs lint does-not-exist.spec.json ; echo EXIT=$?
[error] [E_JSON] ...does-not-exist.spec.json: ENOENT: no such file or directory... EXIT=1
$ node bin/cvs.mjs frobnicate >/tmp/u.out 2>/tmp/u.err ; echo EXIT=$?
EXIT=2   stdout=1330 bytes   stderr=0 bytes
$ node bin/cvs.mjs build ../t03-tmp/no-such-spec.json ; echo EXIT=$?
node:fs:483  Error: ENOENT: no such file or directory, open '...no-such-spec.json'
    at file:///.../scripts/compile.mjs:47:27 ... EXIT=1
$ node bin/cvs.mjs build ../t03-tmp/theme-bad.spec.json --root . --outdir ../t03-tmp/out --dry-run
[compile] mini-41s · 41s · 1230 frames · 23 segments
[dry-run] stop after plan EXIT=0
$ node scripts/test-core.mjs        # 15 passed, EXIT=0
$ node scripts/test-spec-security.mjs  # 25 tests: 25 passed, 0 failed, EXIT=0
$ node scripts/doctor.mjs           # ✓ environment ready (4 optional missing), EXIT=0
```

## 反馈条目

### F-03-01 `cvs build` 根本不跑 lint：未知主题 build 退出 0，lint 才退出 1
- 严重度: P1 严重摩擦
- 证据: 上面实测 `cvs build ... --dry-run` 对 `look.theme=definitely-not-a-theme` 返回 0 并生成 plan；同一 spec `cvs lint` 返回 `[error] [E_THEME_UNKNOWN]`、exit 1；`bin/cvs.mjs:102-103` 宣称 `build` 是 `lint -> plan -> incremental render -> concat -> qa`，但 `scripts/compile.mjs:15-16` 只 import `plan.mjs/timeline.mjs`，没有任何 spec-lint/APCA 调用。
- 我的原话: 「作为要接 CI 的工程师，我想一个 `build` 就是门禁，但主题拼错时 build 静默落回默认主题并出片，只有我额外记得跑 lint 才会红。」
- 影响面: 所有只调 `cvs build`/`compile.mjs` 的 CI 与自托管流水线；换主题、抄错 theme id 时每次必踩。
- 建议方案: `build` 先执行与 `spec-lint` 相同的 theme 存在性 + APCA 检查（抽成 `validateSpecDeep(spec,{root})`，lint 与 build 共用）；失败时 stderr 输出 `[error] [E_THEME_UNKNOWN|E_APCA] path: message`，exit 1；同步修正 help 文案。
- 验收断言: Given `look.theme=definitely-not-a-theme` When `cvs build spec --dry-run` Then exit 1 且 stderr 含 `E_THEME_UNKNOWN`，不生成 plan。
- 工作量: S
- 打分: impact 9 / frequency 8 / confidence 10

### F-03-02 缺失/非法 spec 在 build/plan 走原始 Node 堆栈；`--json` 致命错误时 stdout 为空
- 严重度: P1 严重摩擦
- 证据: 实测 `cvs build no-such-spec.json` 输出 `node:fs:483 ... Error: ENOENT ... at compile.mjs:47:27`，exit 1；`cvs plan` 输出 `[fatal] Error: ENOENT ... at plan.mjs:141`；`spec-lint --json --spec /tmp/nope.json` 的 stdout 是 0 字节、stderr 是 `[error] [E_JSON] ...`、exit 1。`scripts/compile.mjs:47`、`templates/plan.mjs:141` 的 `JSON.parse(fs.readFileSync(...))` 都在 try/catch 之外；`scripts/spec-lint.mjs:118-125` 的 JSON 只在解析成功后才会打印。
- 我的原话: 「作为 CI 消费者，我想在 `--json` 时永远拿到可解析的失败对象，但 spec 读不到时程序直接抛 ENOENT 堆栈，stdout 空，解析器拿到 EOF。」
- 影响面: 每个把 spec 放在缓存/生成步骤之后、可能缺失或半写入的流水线；每次必踩。
- 建议方案: 抽出 `readSpecJson(path)`，统一返回 `{code:'E_JSON'|'E_READ', path, message, hint}`；两个 CLI 在 catch 里输出 `[error] [E_JSON] ...` 并 exit 1；`--json` 模式即使致命也向 stdout 写一行 `{"ok":false,"code":"E_JSON","path":...,"message":...}`，stderr 只留人类摘要。
- 验收断言: Given 不存在的 spec + `--json` When `cvs build`/`cvs lint` Then stdout 能被 `JSON.parse`，`ok=false`、`code=E_JSON`，exit 1。
- 工作量: S
- 打分: impact 9 / frequency 9 / confidence 10

### F-03-03 三阶段失败都是 exit 1：render/concat/QA 不可区分，API job 只存一句话
- 严重度: P1 严重摩擦
- 证据: `scripts/compile.mjs:84-86` 渲染失败只打印 `[compile] render failed`，`:101`/`:107` 拼接失败同理，`:117` QA 失败只打印 `[compile] qa failed`（`:114` 已知道 `outDir/qa/qa-video.json` 的路径却不回显）；`server/api.mjs:453` 只写 `job.error = compile exited with code ${code}`，`:309-322` 的 `jobView` 没有 `errorCode/phase/failedSegment/logPath` 字段。
- 我的原话: 「作为接 CI 的工程师，我想从退出码或 job JSON 知道是渲染、拼接还是 QA 挂了，但三者都 exit 1，我只能下载 1000 行 build.log 自己找。」
- 影响面: 每次非 happy path；用 API 队列做自托管构建时尤其致命。
- 建议方案: 每个阶段包成 `{phase:'render'|'concat'|'qa', code:'E_RENDER'|'E_CONCAT'|'E_QA', segmentId?, page?, exitCode, artifact, logPath}`；compile 失败输出 `[error] [E_RENDER] segment=... page=... exit=...` 并从 `render-manifest.json`/`qa-video.json` 取失败项；API `jobView` 增加 `errorCode/phase/failedSegment/logPath/artifactPath/engineVersion`。
- 验收断言: Given 某个 segment 渲染失败 When `cvs build` 或 `GET /jobs/:id` Then 输出含 `errorCode=E_RENDER` 且 `failedSegment` 等于该段 id，exit 1。
- 工作量: M
- 打分: impact 9 / frequency 8 / confidence 9

### F-03-04 段哈希不含页面/recipe 内容，`ENGINE_VERSION` 冻在 1：改模板仍复用旧缓存
- 严重度: P1 严重摩擦
- 证据: `templates/plan.mjs:24-47` 的 `segmentHash` payload 只有 `page` 路径、时长、theme/motion/accent/brand、spec.assets/patches，没有页面文件内容 hash；`templates/spec.mjs:18` `ENGINE_VERSION = 1`；`docs/DECISIONS.md:13` 把 `page` 当成已进哈希，`:15` 却要求“任何改变逐帧像素的实现变更必须递增 ENGINE_VERSION”；`git show --stat HEAD` 改了 `templates/recipe-greatwall.html`（19 行）而 `git log -- templates/spec.mjs` 自 `b955e5c` 起没再 bump；`templates/render-farm.mjs:158-169` 仅凭 `s.hash` 命中 `.cache/<hash>.mp4`。
- 我的原话: 「作为自托管工程师，我想改页面后重跑就得到新画面，但页面代码不在段哈希里、ENGINE_VERSION 又不动，CI 会直接复用旧 mp4 并报成功。」
- 影响面: 所有增量 build、API 队列、带缓存的自托管 runner；改模板/recipe 时必踩（本次 HEAD 就是现成例子）。
- 建议方案: 把页面及其 `@import`/recipe 依赖的 sha256 放进 `segmentHash`（构建时算一个 `pageHash`）；按 D2 在每次像素变更时 bump `ENGINE_VERSION`，并在 CI 断言版本号变更；发布流水线强制 `--no-cache` 或把 `engineVersion` 写进 cache 路径。
- 验收断言: Given 只改 `templates/recipe-greatwall.html` 一个字节 When 重新 `cvs plan` Then 受影响段的 `hash` 变化且 render-farm 显示 cache miss。
- 工作量: M
- 打分: impact 10 / frequency 8 / confidence 9

### F-03-05 声明 Node ≥20，渲染 fallback 却要 Node ≥22；装完依赖后 doctor 误报绿灯
- 严重度: P1 严重摩擦
- 证据: `package.json:8-9` `"node": ">=20"`；`compiler.yml:15`/`:51` 用 Node 20；`templates/cdp.mjs:102` 在 `typeof WebSocket === 'undefined'` 时直接抛错；`scripts/doctor.mjs:54-58` 只有在 `!pw` 时才把 WebSocket 标为 required，而 `npm ci` 会装 `playwright-core` → `pw=true`（它不带浏览器，`openPlaywright` 无 `executablePath` 必失败）；实测 `npx -y node@20 -e "console.log(process.version, typeof WebSocket)"` → `v20.20.2 undefined`。
- 我的原话: 「作为 CI 维护者，我照 engines 用 Node 20、照 workflow 装依赖，doctor 说环境 ready，但真正渲染时 Playwright 找不到自带浏览器、CDP 又没有 WebSocket，最后只得到一句 no renderer available。」
- 影响面: 所有 Node 20 + system Chrome + `npm ci` 的机器；恰好是 `compiler.yml` golden job 的配置。
- 建议方案: doctor 增加真实 renderer 探测（`openBrowser` 打开 `about:blank` 或在 `--json` 里做 capability 判定），Node<22 且无 bundled browser 时 required 失败并给出 `fix: use Node 22 / set CHROME_EXE absolute / pass --browser`；CI golden job 升 Node 22；`engines` 改 `>=22` 或明确“Node 20 仅静态套件”。
- 验收断言: Given Node 20 + `npm ci` + system Chrome When `doctor --strict` Then exit 1，且输出一行 `renderer: unavailable (Node <22 has no global WebSocket)`。
- 工作量: S
- 打分: impact 9 / frequency 8 / confidence 10

### F-03-06 测试汇总有四种格式、无 JSON/TAP；`test:all` 与 `cvs test` 覆盖不一致
- 严重度: P2 明显不便
- 证据: `scripts/test-core.mjs:139` 输出 `15 passed`；`scripts/test-spec-security.mjs:216` 输出 `25 tests: 25 passed, 0 failed`；`scripts/test-golden.mjs:149` 输出 `Ran N tests: ...`；`server/test-api.mjs:277` 输出 `x passed, y failed`；`package.json:22` 的 `test:all` 不含 `test:api`/`test:golden`/`test:image`；`bin/cvs.mjs:57-83` 的 `cvs test` 默认也不含 `server/test-api.mjs`（只在 `--browser` 时追加），与 `:112` 的 help“run all suites”不符。
- 我的原话: 「作为 CI 消费者，我想一次拿到每条的 suite/name/status，但每个套件都换一种汇总格式，而且 API 契约测试在默认 CI 里根本没跑。」
- 影响面: 所有把 CI 结果接进 PR 注释、JUnit、看板的团队；每次失败都要重新写 grep。
- 建议方案: 统一 runner 支持 `--json`（或 TAP14），每行 `{suite,test,status,durationMs,error:{code,message}}`；`test:all` 纳入 `test:api`（服务用 port 0 自关闭）与 `test:golden --selfcheck`；`cvs test --json` 与 `package.json` 共用同一份 suite 清单。
- 验收断言: Given 任一测试失败 When `cvs test --json` Then stdout 是合法 JSON，含失败项 `{suite,test,status:"fail",error.code}`，exit 1。
- 工作量: M
- 打分: impact 7 / frequency 8 / confidence 9

### F-03-07 116 个 `E_*` 码没有机器可读注册表，同一码多义、退出码不承载原因
- 严重度: P2 明显不便
- 证据: `grep -rhoE "E_[A-Z][A-Z0-9_]*" scripts server templates bin ingest app | sort -u | wc -l` = **116**；`E_SPEC` 同时表示“body 不是对象”（`server/api.mjs:504`）和 plan 抛出的任意异常（`:514`）；`E_JSON` 同时表示读 spec 文件失败（`scripts/spec-lint.mjs:59`）和 HTTP body 解析失败（`server/api.mjs:501`）；`README.md`/`SKILL.md`/`docs/` 没有错误码表（grep 只命中 `PERSONAS.md` 和其他内测报告）；CLI 退出码只有 0/1/2，无法区分 spec/render/QA。
- 我的原话: 「作为要写重试策略的工程师，我想 `switch(err.code)` 决定重跑还是改 spec，但码没有注册表、同码多义、退出码也不告诉我阶段。」
- 影响面: 所有自动化重试/告警/看板；跨版本升级时无法判断码是否稳定。
- 建议方案: 新增 `docs/ERRORS.md` + `schema/errors.json`（`code, httpStatus, exitCode, phase, meaning, action`），由脚本生成文档并在 CI 断言所有字面量 `E_*` 都在注册表内；约定 exit 10=spec、11=render、12=qa、13=env；同一 `(code,phase)` 不得多义（文档部分可与 F-04-06 合并）。
- 验收断言: Given 代码里任意 `E_*` 字面量 When `npm run errors:check` Then 全部存在于 `errors.json` 且 `(code,phase)` 唯一，缺失即 exit 1。
- 工作量: M
- 打分: impact 8 / frequency 8 / confidence 9

### F-03-08 确定性只证明“同机两次”；跨机基线依赖 Chrome/字体，且检查结果不是 JSON
- 严重度: P2 明显不便
- 证据: `README.md:141` 写 “the same second always produces the same frame, on any machine”；`scripts/golden.mjs:64-66` 的 `--selfcheck` 明确只验证“本机可复现”，`compiler.yml:59-65` 也据此故意不用 committed manifest；`fixtures/golden/manifest.json:2-6` 记录 `Google Chrome 157.0.8103.51`、`git 8b1e0c2`，而当前 HEAD 是 `f67616d`；`scripts/determinism-check.mjs:61-65` 只打印 `✓ deterministic`/`✗ NOT deterministic` 文本，`golden.mjs` 的失败也只输出 `[fail]` 行，二者都没有 `--json`。
- 我的原话: 「作为 CI 作者，我想断言‘同 spec 同字节’，但跨机器基线绑定 Chrome 157 和一套字体，升级 runner 就全红；检查结果还只能靠 grep 对勾。」
- 影响面: 所有想用 committed golden 做回归的团队；换 runner 镜像/Chrome/字体时 100% 遇到。
- 建议方案: 提供固定镜像（Chrome 版本 + font manifest hash + ffmpeg 版本写入镜像 digest），CI 用 committed manifest 而非 selfcheck；`determinism-check`/`golden` 增加 `--json`：`{ok,engineVersion,chromeVersion,fontManifestHash,specs:[{name,specHash,stills:[{t,expected,actual}]}]}`；README 改成“同一镜像/字体内可复现”。
- 验收断言: Given 同一 image digest When `cvs golden --json` Then exit 0 且 JSON `ok=true`；Given 字体 hash 变化 Then exit 1 且 JSON 含逐 still 的 expected/actual。
- 工作量: M
- 打分: impact 9 / frequency 7 / confidence 9

### F-03-09 跨平台契约未验证：音频构建硬依赖 bash，`CHROME_EXE` 只认绝对路径，CI 只有 Ubuntu
- 严重度: P2 明显不便
- 证据: `scripts/compile.mjs:96-98` 用 `process.env.BASH || 'bash'` 调 `concat-and-encode.sh`，而 `scripts/doctor.mjs` 没有 bash 检查行；`templates/cdp.mjs:21-22` 的 `add()` 用 `fs.existsSync(p)`，所以 `CHROME_EXE=google-chrome` 这种 PATH 名会被静默忽略（实测 `CHROME_EXE=definitely-not-a-real-binary node -e "...browserCandidates()"` 仍返回本机 Chrome 路径）；`compiler.yml:64` 正好写的是相对值 `google-chrome`；三个 workflow 的 `runs-on` 全是 ubuntu（`compiler.yml:9,45`、`render-smoke.yml:10`）。
- 我的原话: 「作为 Windows 自托管用户，我想 doctor 告诉我缺什么，但它不检查 bash；我按 workflow 写 `CHROME_EXE=google-chrome`，代码却当作没设置。」
- 影响面: Windows 无 Git Bash 的机器带音频 build；所有依赖 PATH 名配置浏览器的 CI；跨平台回归无人覆盖。
- 建议方案: doctor 增加 `bash` 行（与 `BASH` 同源）；`CHROME_EXE` 先按 PATH 解析（`where`/`which`）再 `existsSync`，并在 doctor `--json` 输出 `resolved` 绝对路径；增加 `windows-latest` job 跑 `test-core + spec-lint + plan --check`（不渲染）。
- 验收断言: Given Windows + `CHROME_EXE=chrome` When `doctor --json` Then `browser.detail` 是绝对路径；Given 无 bash When `cvs build --audio` Then 渲染前 exit 1 且 stderr 含 `E_BASH_MISSING`。
- 工作量: M
- 打分: impact 7 / frequency 6 / confidence 9

### F-03-10 CLI 契约缺口：未知命令只把 help 打到 stdout（exit 2、stderr 空）、无 `--version`、spawn 失败被吞
- 严重度: P2 明显不便
- 证据: 实测 `node bin/cvs.mjs frobnicate` → exit 2、stdout 1330 bytes、stderr 0 bytes；`node bin/cvs.mjs --version` → exit 2 + 同一份 help；`bin/cvs.mjs:93-116` 把未知命令与 help 合并处理且无错误码；`:24-26` 的 `spawnSync` 返回值在 `:119-120` 只取 `r.status`，`r.error`（ENOENT/权限）未打印，status 为 null 时静默 exit 1。
- 我的原话: 「作为脚本调用方，我想用 `--version` 记版本、用 stderr+错误码识别拼错的命令，但 `cvs --version` 被当成未知命令，拼错子命令只得到一屏 help。」
- 影响面: 所有包装 `cvs` 的 Makefile/CI/Agent；命令拼错或脚本缺失时每次遇到。
- 建议方案: 未知命令 → stderr `[error] [E_UNKNOWN_COMMAND] <cmd>`、exit 2、stdout 不输出；`--version`/`-V` 读 `package.json` 输出 `2.3.4`、exit 0；`r.error` 时输出 `[error] [E_SPAWN] script=... errno=...`、exit 127。
- 验收断言: Given `cvs nope` Then stdout 为空、stderr 含 `E_UNKNOWN_COMMAND`、exit 2；Given `cvs --version` Then 单行 semver、exit 0。
- 工作量: S
- 打分: impact 6 / frequency 7 / confidence 10

### F-03-11 安装面约 188 MB，两个 CI job 各装一次且无 npm cache；`npm ci || npm install` 会掩盖锁文件漂移
- 严重度: P2 明显不便
- 证据: `package.json:67-75` 8 个直接依赖；`npm view <pkg> dist.unpackedSize` 求和 ≈ **187.8 MB**（noto-sans-sc 74.6 MB、noto-serif-sc 87.2 MB、playwright-core 14.0 MB、其余约 12 MB）；`compiler.yml:21` 与 `:54` 都是 `npm ci ... || npm install ...`，且该文件没有 `cache: npm`（`render-smoke.yml:22` 有）；`package-lock.json:3` 和 `packages[""].version` 仍是 `2.0.0`，与 `package.json` 的 `2.3.4` 漂移。
- 我的原话: 「作为要控 CI 成本的工程师，我想一次装好并复用缓存，但现在每次 push 两个 job 各拉约 188 MB，而且 lock 不一致时会被 `|| npm install` 悄悄修好。」
- 影响面: 每次 push/PR 的 CI 时间与带宽；依赖漂移导致的不可复现。
- 建议方案: `compiler.yml` 两个 setup-node 都加 `cache: npm`；去掉 `|| npm install`，让 `npm ci` 失败即失败并输出 `E_LOCK_MISMATCH`；字体包移到 optionalDependencies 或独立 `build-fonts` job 产出 artifact；同步 lock 的 `version`。
- 验收断言: Given lock 与 package.json 不一致 When CI install Then job 失败且日志含 `E_LOCK_MISMATCH`；Given 正常缓存命中 Then install 步骤不重复下载字体包。
- 工作量: S
- 打分: impact 7 / frequency 9 / confidence 8

### F-03-12 `doctor --strict` 是空操作；`--json` 缺 CLI 版本与修复命令
- 严重度: P3 打磨
- 证据: `scripts/doctor.mjs:113-114` 两个分支都是 `if (failed.length) process.exit(1)`，加不加 `--strict` 对 required 缺失完全一样；`:7` 声称 `--strict` 是 “exit 1 on any missing required item”，且 optional 缺失永远不会让 strict 失败；`:102-103` 的 JSON 只有 `{ok,rows,failed,warnings}`，行内只有 `group,name,ok,detail,required`，没有 `cliVersion`/`version`/`fix`。
- 我的原话: 「作为写 CI 前置检查的人，我想 `--strict` 真的更严格、`--json` 能直接告诉我版本和修复命令，但 strict 没有区别，失败行也只有一句 detail。」
- 影响面: 把 doctor 当 gate 的流水线；排障时要手写安装命令。
- 建议方案: `--strict` 把 optional 的 `WARN` 也计入失败；JSON 顶层加 `cliVersion`、`resolved:{chrome,ffmpeg,bash,node}`；每行加 `fix`（可直接执行的命令）；失败行加 `code`（如 `E_NO_CHROME`）。
- 验收断言: Given 仅 optional 项缺失 When `doctor --strict` Then exit 1；不加 `--strict` Then exit 0；`--json` 顶层含 `cliVersion`。
- 工作量: S
- 打分: impact 3 / frequency 5 / confidence 9

## 缺失的错误码 / 日志字段清单（按优先级）

1. `E_UNKNOWN_COMMAND`：未知子命令，stderr 一行，exit 2（现为 stdout help、stderr 空）。
2. `E_SPAWN`：`spawnSync` 的 `r.error`，字段 `{script, errno, syscall}`，exit 127（现被吞）。
3. `E_JSON`/`E_READ`：spec 读取/解析失败，字段 `{path, message}`，且 `--json` 时 stdout 必须是 `{"ok":false,...}`（现 build/plan 抛堆栈，lint JSON 为空）。
4. `E_RENDER`：`{segmentId, page, exitCode, manifestPath}`（现只有 `[compile] render failed`）。
5. `E_CONCAT`：`{stage:'audio'|'video', command, exitCode, stderrTail}`（现只有一句 failed）。
6. `E_QA`：`{check, expected, actual, reportPath}`（`qa-video.json` 已有 checks，compile 没回显路径）。
7. `E_CACHE_STALE` / `pageHash`：缓存命中前比对输入内容 hash，而非只信 `segmentHash`。
8. API job 字段：`errorCode`、`phase`、`failedSegment`、`logPath`、`artifactPath`、`engineVersion`（`server/api.mjs:309-322` 目前只有 `error` 字符串和 `logTail`）。
9. lint JSON 字段：`ok`、`schemaVersion`、`exitCode`、`errorCodes[]`（现只有 `errors/warnings/issues`）。
10. 测试结果字段：`suite`、`test`、`status`、`durationMs`、`error.code`（现四种文本汇总）。
11. 确定性字段：`engineVersion`、`chromeVersion`、`fontManifestHash`、`expected/actual`（现仅对勾/叉文本）。
12. doctor 字段：`cliVersion`、`resolved.{chrome,ffmpeg,bash}`、每行 `code`/`fix`（现只有 detail）。
