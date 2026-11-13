# T06 企业内网 / 离线集成方 · 内测反馈

- 基线: code-video-showcase v2.3.4（HEAD 2.3.4，工作区另有未入库的 `shared/fonts/`，见 F-T06-03）
- 环境: Windows 10.0.22631 x64 / Git Bash / Node v24.22.1 / FFmpeg 7.0.2 / Python 3.12.9
- 方法: 只做静态 grep + 本地只读命令；未启动任何服务、未渲染、未联网
- 严重度统计: P0 × 2，P1 × 5，P2 × 4，P3 × 1（共 12 条）

## 结论先行：安全评审会卡在哪

**硬阻断是 F-T06-01**：无外网环境连 `bash arm.sh` 都跑不完（`npm i` + 未锁版本 + 无 vendor）。**若评审只做应用安全、不关心安装，硬阻断是 F-T06-02**：`POST /jobs` 无 Origin/Host 校验 + spec 可 `allowRemotePages:true`，任意网页可让服务端无头 Chrome 访问内网/云元数据并把结果渲进可下载的 master.mp4。

最可能被开成 ticket 的三条：**F-T06-02（CSRF→SSRF）**、**F-T06-01（公网 npm + 版本不可锁）**、**F-T06-04（OFL 许可文本缺失）**。若渲染跑在 Linux 镜像上，**F-T06-05（`--no-sandbox`）** 会紧随其后成为第四条。

---

## Findings

### F-T06-01 离线安装必须访问公网，且版本锁不住
- 严重度: P0 阻断
- 证据: `arm.sh:67` `npm i playwright-core`、`arm.sh:73-76` `npm i @fontsource/*`（无版本、无 `--offline`、无 `npm ci`）；`scripts/build-fonts.mjs:20,48` 只从 `node_modules/@fontsource` 取输入；`ls .npmrc` → `No such file or directory`；`.github/workflows/compiler.yml:21` 为 `npm ci ... || npm install ...`（回退即绕过锁）
- 我的原话: 「作为内网集成方，我想在一台没有外网的构建机上把工具装起来，但 arm.sh 第一步就要连 registry，而且不带版本；仓库里没有任何 vendored tarball 或离线安装包。」
- 影响面: 所有 air-gap / 内网构建机；每次首次部署必踩
- 建议方案: 发布 `vendor/`（8 个 tgz + integrity 清单）或 `npm pack` 产物；arm.sh 改 `npm ci --offline --no-audit`，失败即 `bad` 退出；新增 `docs/OFFLINE.md` 写明预置 `npm_config_cache`；`package.json` 依赖改精确版本
- 验收断言: Given 断网机器 + 仓库内 `vendor/`，When 执行 `bash arm.sh`，Then 全程无外网连接且退出码 0，`doctor` 全绿
- 工作量: M
- 打分: impact 10 / frequency 10 / confidence 10

### F-T06-02 API 可被任意网页 CSRF 提交任务，并借 allowRemotePages 让服务端浏览器访问内网
- 严重度: P0 阻断
- 证据: `server/api.mjs:495-505` 直接 `readBody`+`JSON.parse`，无 Content-Type / Origin 校验；`server/api.mjs:628-645` 路由无 Host 白名单；`templates/spec.mjs:370` 仅凭 `render.allowRemotePages` 放行；`templates/render-segment.mjs:261` 对绝对 URL 原样打开
- 证据: 本地实测（API 同一入口 `api.mjs:510`）: `ACCEPTED remote page with allowRemotePages:true -> http://169.254.169.254/latest/meta-data/?theme=coral-noir&mp=standard` / `errors: 0`
- 我的原话: 「作为安全评审，我看到一个只靠 127.0.0.1 兜底、却不校验 Origin/Host 的写接口；开发者只要开着 api，随便一个网页就能 POST 一个 spec，让无头 Chrome 打开 169.254.169.254，并把截图渲进 master.mp4 供下载。」
- 影响面: 所有运行 `cvs api` 的开发者/构建机；浏览器访问任意站点即可触发
- 建议方案: `POST /jobs` 强制 `Content-Type: application/json` 并校验 `Origin`/`Host`（仅 127.0.0.1/localhost）；`allowRemotePages` 改为 CLI 显式参数而非 spec 字段；渲染进程加 `--host-resolver-rules=MAP * ~NOTFOUND` 或 egress 阻断
- 验收断言: Given 服务默认启动，When 从 `http://evil.example` 发 `text/plain` POST /jobs，Then 403 且不创建 job；When spec 带 allowRemotePages，Then lint 报 E_PAGE_REMOTE
- 工作量: M
- 打分: impact 10 / frequency 6 / confidence 9

### F-T06-03 字体不随仓库分发，默认路径产生 1187 个 404
- 严重度: P1 严重摩擦
- 证据: `.gitignore:27` 忽略 `shared/fonts/`；`grep -c "url(\./fonts/" shared/fonts.css` → `1187`；`git ls-files shared/fonts | wc -l` → `0`；`scripts/new-project.mjs:90-97` 默认只复制 css 并写一个 README；`arm.sh:84-85` 仅 `warn`，不置 `fail`
- 我的原话: 「作为内网集成方，我 clone 下来发现 fonts.css 在、1187 个 woff2 一个不在；new-project 默认也只给空目录。渲染不报错，只是字悄悄变系统字体——审计时我无法证明成片用的是哪套字。」
- 影响面: 每个 fresh clone / 每个默认 scaffold；Linux 精简镜像上 CJK 可能直接豆腐块
- 建议方案: 将 `shared/fonts/` 纳入发布产物（或提供 `fonts-bundle.tar.zst` + sha256）；`new-project` 默认复制字体，缺字体时直接失败而非静默；arm.sh 把字体缺失计入 `fail`
- 验收断言: Given 干净 clone 且断网，When `node scripts/doctor.mjs`，Then 退出码 0 且 `shared/fonts/` ≥1 个 woff2；When 渲染任一页，Then `fonts.css` 的 1187 个 woff2 请求 0 个 404
- 工作量: S
- 打分: impact 9 / frequency 10 / confidence 10

### F-T06-04 分发物缺少 OFL 许可文本，法务无法放行
- 严重度: P1 严重摩擦
- 证据: `find shared -iname "*LICENSE*" -o -iname "*OFL*" | wc -l` → `0`；`scripts/build-fonts.mjs:71-75` 只 `copyFileSync` woff2；`shared/fonts.css:2` 仅一行「OFL fonts vendored locally」；`package-lock.json` 中 7 个字体包 license 均为 `OFL-1.1`
- 我的原话: 「作为要过法务的集成方，产物里有 7 个 OFL 字族的二进制，却没有 OFL.txt、没有版权行、没有 Reserved Font Name 说明；这不能对外分发。」
- 影响面: 所有对外交付/二次分发；法务必卡
- 建议方案: build-fonts.mjs 同步复制各包 LICENSE 到 `shared/fonts/licenses/<pkg>.txt`，fonts.css 头部写版权行；新增 `THIRD-PARTY-NOTICES.md`
- 验收断言: Given 发布包，When `find shared/fonts -iname "OFL*" | wc -l`，Then ≥7；When 检查 fonts.css 头部，Then 含每个字族的版权行
- 工作量: S
- 打分: impact 8 / frequency 10 / confidence 10

### F-T06-05 Linux/WSL 无条件 `--no-sandbox` 渲染 spec 指定页面
- 严重度: P1 严重摩擦
- 证据: `templates/cdp.mjs:168` `if (process.platform !== 'win32') args.unshift('--no-sandbox','--disable-setuid-sandbox')`；`templates/render-segment.mjs:283` 同样；页面来源由 spec `*.page` 决定（`templates/spec.mjs:371-397`）
- 我的原话: 「作为安全评审，我看到渲染不可信 HTML 的 Chromium 在 Linux 上强制关沙箱；配合 allowRemotePages 就是无沙箱打开任意远程页。」
- 影响面: 所有 Linux/WSL 渲染节点；CI 与多租户渲染农场
- 建议方案: 仅 root 且显式 `--unsafe-no-sandbox` 时关闭；默认保留 sandbox（容器内用 user namespace 或 `SYS_ADMIN`）；同时默认 `--host-resolver-rules` 阻断外网
- 验收断言: Given Linux 非 root，When 渲染任意段，Then 进程命令行不含 `--no-sandbox`；When 传 `--unsafe-no-sandbox`，Then 日志打印显式告警
- 工作量: S
- 打分: impact 8 / frequency 8 / confidence 9

### F-T06-06 `render.outDir` 可路径穿越，编译写到项目根之外
- 严重度: P1 严重摩擦
- 证据: `templates/spec.mjs:456` `outDir: outDir || spec.render?.outDir || 'out'`（无绝对路径 / `..` 校验）；`scripts/compile.mjs:59` `path.resolve(root, plan.meta.outDir)`；实测输出 `outDir accepted: ../../escape`
- 我的原话: 「作为把 spec 当不可信输入的集成方，我发现 page 有闸门、id 有闸门，唯独 outDir 没有；CI 里跑别人的 spec 就能往仓库外写 plan/segments/master。」
- 影响面: 任何接受外部 spec 的 CI/服务；API 路径因 `api.mjs:412` 强制 `--outdir` 暂不受影响
- 建议方案: `spec.mjs` 校验 outDir 必须为相对路径且 resolve 后仍在 root 内（复用 `isInside`）；`compile.mjs` 再加一次兜底
- 验收断言: Given spec `render.outDir="../../escape"`，When `node scripts/compile.mjs --spec x.json`，Then 退出码 1 报 `E_OUTDIR` 且磁盘无新文件
- 工作量: S
- 打分: impact 7 / frequency 5 / confidence 10

### F-T06-07 文档推荐的预览命令会暴露 `.git`
- 严重度: P1 严重摩擦
- 证据: `README.md:335`、`README.md:593` 推荐 `python -m http.server -d . 4600` 服务仓库根；仓库自带静态服务器反而显式挡点文件（`app/canvas/serve.mjs:67`、`app/script/serve.mjs:58`、`app/wizard/serve.mjs:112-116`）
- 我的原话: 「作为安全评审，我按 README 起预览，`/.git/config` 直接可读；项目明明写了点文件防护，文档却把人引到没有防护的通用服务器上。」
- 影响面: 所有照文档预览的人；内网机器上等于把源码历史暴露给同网段
- 建议方案: README 改为 `node app/canvas/serve.mjs --root .`（或新增 `cvs preview`），并注明不要用通用 http.server
- 验收断言: Given 按新文档启动预览，When GET `/.git/config`，Then 404；When GET `/segments/01.html`，Then 200
- 工作量: S
- 打分: impact 7 / frequency 7 / confidence 10

### F-T06-08 安全文档与实现相反（CORS / 监听地址）
- 严重度: P2 明显不便
- 证据: `server/README.md:97`「服务拒绝绑定非本机地址」 vs `server/api.mjs:757-762`（`host` 直接 `listen`，无任何校验）；`server/README.md:103`「CORS 为 `*`」 vs `server/api.mjs:41-47`（默认关闭，需 `--cors`）
- 我的原话: 「作为审计方，我拿 README 当配置基线，结果两条都跟代码对不上：一条把不存在的保护写成已有，一条把已修的风险写成仍在。」
- 影响面: 每次安全评审/等保材料；会误导实现方按错误基线部署
- 建议方案: 用 `server/test-api.mjs` 的断言反向生成 README「安全边界」小节；两处加代码行链接；CI 增加文档-代码一致性检查
- 验收断言: Given `npm run test:api` 通过，When 读取 README 安全小节，Then 每条声明都能在测试里找到对应断言
- 工作量: S
- 打分: impact 6 / frequency 6 / confidence 10

### F-T06-09 job 日志与 plan 泄露构建机绝对路径
- 严重度: P2 明显不便
- 证据: `server/api.mjs:318` `logTail: readLogTail(...)` 未过 `scrubMessage`（`:69-73` 只用于 error）；`templates/timeline.mjs:318` `meta.root: path.resolve(root)`；实测 build.log 第 2 行含 `E:\myzcode\...\out\api\j-.../plan.json`
- 我的原话: 「作为要归档构建证据的集成方，我发现 GET /jobs/<id> 的 logTail 和 plan.json 都带构建机绝对路径；脱敏函数只盖住了 error 字段。」
- 影响面: 所有通过 API 取日志/归档 plan 的场景；跨团队共享成片包时
- 建议方案: `jobView` 对 logTail 过 `scrubMessage`；`plan.json` 的 `meta.root` 改为可选/相对，或在写出前 scrub
- 验收断言: Given 一个完成的 job，When GET `/jobs/<id>`，Then `logTail` 与 `plan.json` 均不含盘符或 `/home/` 绝对路径
- 工作量: S
- 打分: impact 5 / frequency 8 / confidence 10

### F-T06-10 无固定运行时/镜像，版本无法复现
- 严重度: P2 明显不便
- 证据: `ls .nvmrc .node-version .tool-versions` → 均 No such file；`package.json:9` `"node": ">=20"` vs `SKILL.md` compatibility「raw-CDP 需 Node 22+」与 `templates/cdp.mjs:102` 抛错；`.github/workflows/*.yml` 全是 `actions/*@v4`（tag 非 SHA）；`docs/CLUSTER-PLAN.md:191` C4-03「固定镜像」仍是待办
- 我的原话: 「作为要版本锁定的集成方，我找不到任何 pin：Node 只写 >=20，但默认渲染路径要 22；没有 Dockerfile，CI action 也只钉到 tag。两台机器渲出的东西我不敢说同源。」
- 影响面: 多机渲染农场、升级评审、跨机哈希一致性
- 建议方案: 增加 `.nvmrc` 与 `packageManager`；提供 `docker/Dockerfile` 固定 Node/Chrome/FFmpeg/Python；Actions 改 `@<sha>`；doctor 的 `--json` 输出各组件精确版本
- 验收断言: Given 两台干净机器按 OFFLINE.md 安装，When 各渲同一 spec，Then `render-manifest.json` 段哈希一致
- 工作量: L
- 打分: impact 7 / frequency 6 / confidence 9

### F-T06-11 静态服务默认安全，但一个 `--host` 就能无鉴权暴露整仓
- 严重度: P2 明显不便
- 证据: `app/wizard/serve.mjs:92` 支持 `--host`；`app/script/serve.mjs:188`、`app/versions/serve.mjs:40` 同样；无鉴权（`server/README.md:97` 自述）；默认回环（各文件 `HOST` 默认 `127.0.0.1`）
- 我的原话: 「作为内网部署方，我本来想把它挂到部门网段给同事用；一看没有任何鉴权，`--host 0.0.0.0` 就等于把源码、out/、spec 全公开。」
- 影响面: 所有想共享预览/评审页的团队
- 建议方案: `--host` 非回环时强制要求 `--token`，否则拒绝启动；文档写明「仅供本机」
- 验收断言: Given `--host 0.0.0.0` 且无 token，When 启动，Then 退出码 2 并提示；Given 带 token，When 无 Authorization 请求，Then 401
- 工作量: M
- 打分: impact 6 / frequency 5 / confidence 9

### F-T06-12 ffmpeg concat 使用 `-safe 0`（纵深防御缺口）
- 严重度: P3 打磨
- 证据: `scripts/compile.mjs:104` `['-y','-f','concat','-safe','0','-i',concatPath,...]`；id 已白名单（`templates/spec.mjs:28,347`），清单由 `templates/timeline.mjs:337-342` 生成并转义单引号
- 我的原话: 「作为安全评审，我知道现在靠 id 白名单挡住了注入，但 `-safe 0` 等于把最后一层交给上游；组合路径一旦变化就会退化。」
- 影响面: 未来新增段来源（assets 段、用户自定义段名）时
- 建议方案: 改回 `-safe 1` 并写相对 outDir 的清单；或保留 `-safe 0` 但在 `concatList` 内断言每个路径都在 outDir 内
- 验收断言: Given 任意合法 spec，When 生成 segments.txt，Then 每行 `file '...'` 解析后都在 outDir 内
- 工作量: S
- 打分: impact 4 / frequency 3 / confidence 9

---

## 附录 A：运行期远程依赖清单

结论：**运行期零远程依赖**（不含安装期）。命令与结果：

```
$ grep -rnE '(src|href)="https?://|url\(https?://|(src|href)="[/][/]|url\([/][/]|@import' templates shared app
（无输出，MATCHES=0）
```

- 文档链接（非运行期）：`README.md:11,15-19,661` 的徽章/Star History、`CHANGELOG.md:3-4`、`ARMED.md:3`、`schema/project.spec.schema.json:2-3` 的 `$schema`/`$id`。
- 安装期远程依赖：`package-lock.json` 的 8 个 registry.npmjs.org 包（7 字体 + playwright-core），见 F-T06-01。
- 渲染期外联面：`templates/cdp.mjs:159-160` 已带 `--disable-background-networking` / `--disable-component-update` / `--disable-sync`；唯一未受限的是 spec `allowRemotePages` 主动打开的页面（F-T06-02）。

断网后命令矩阵：

| 命令 | 断网结果 | 依据 |
|---|---|---|
| `bash arm.sh` | 挂：`npm i` 失败 → `bad` | `arm.sh:67,73` |
| `npm ci` | 挂：无 vendor、无 .npmrc、无本地 cache | 无 `.npmrc`；`compiler.yml:21` |
| `node scripts/build-fonts.mjs` | 挂：缺 `node_modules/@fontsource` | `build-fonts.mjs:20,48` |
| `node scripts/doctor.mjs` | 本机通过（未入库字体在场）；fresh clone 必失败 | `doctor.mjs:79-86` |
| `node scripts/test-spec-security.mjs` | 通过（纯 Node，实测 25/25） | 见附录 C |
| `node templates/plan.mjs` / `scripts/spec-lint.mjs` | 通过（纯 Node，无网络调用） | 静态检查 |
| `node scripts/compile.mjs` | 通过（只依赖本机 ffmpeg/Chrome/Python） | `doctor.mjs` 实测组件齐全 |

## 附录 B：spec 作为不可信输入 —— 已防住 / 未防住

已防住（均有测试或代码闸门）：
- `round.id` 白名单：挡路径穿越、换行注入 concat、引号/空格、点开头、>64 字符（`templates/spec.mjs:28,347`；测试 25/25 通过）。
- 页面绝对 URL：默认 `E_PAGE_REMOTE`（`spec.mjs:384-388`）；绝对路径 / 盘符 / UNC：`E_PAGE_ABS`（`:392-396`）。
- 资源上限：flash ≤256（`:326`）、单段 ≤600s（`:330`）、总帧 ≤18000（`:335`）、rounds ≤24（`:312`）。
- API：body ≤1MB（`server/api.mjs:30,136-153`）、队列 ≤32（`:36,526`）、jobs ≤200（`:38`）、job id 白名单（`:672`）、job 目录 `isInside`（`:326,521,579`）。
- 静态服务点文件 + 根限制：`app/canvas/serve.mjs:67,73`、`app/script/serve.mjs:58,63`、`app/wizard/serve.mjs:112-123`。
- 错误信息脱敏 `scrubMessage`（`server/api.mjs:69-73`），但仅覆盖 `error` 字段（见 F-T06-09）。
- 子进程一律数组参数、无 shell 拼接：`compile.mjs:98,104`、`render-segment.mjs:232`、`timeline.mjs:341` 转义单引号。

未防住：
- `allowRemotePages` + 无 Origin/Host 校验 → CSRF→SSRF（F-T06-02）。
- `render.outDir` 无根约束 → 写出项目根外（F-T06-06）。
- `assets[].path` 接受绝对路径且无根约束（`scripts/assets.mjs:135`）；当前 compile 只把 path 写进 manifest、不读文件，故未构成读取原语，但 `registerAsset` 本身可对任意绝对路径做 hash/ffprobe。
- `jobView.logTail` 与 `plan.json.meta.root` 泄露绝对路径（F-T06-09）。
- Linux 渲染 `--no-sandbox`（F-T06-05）。
- 分发物缺 OFL 文本（F-T06-04）。

## 附录 C：可跑证据（真实输出）

```
$ node scripts/test-spec-security.mjs
✓ 基线：正常 spec 没有 error
✓ id 路径逃逸（../../etc/passwd）被拒
✓ id 换行注入 concat 清单被拒
✓ scrubMessage 抹掉 Windows / POSIX 绝对路径
25 tests: 25 passed, 0 failed
```

```
$ node scripts/doctor.mjs
  ✓ node                   v24.22.1 (need ≥ 20)
  ✓ ffmpeg                 ffmpeg version 7.0.2-full_build-www.gyan.dev
  ✓ chrome/edge            C:\Program Files\Google\Chrome\Application\chrome.exe
  ✓ shared/fonts/          1187 font files
✓ environment ready  (4 optional missing)
```

注：doctor 的 `shared/fonts/ 1187` 来自本机未入库目录（`.gitignore:27`），不能代表发布物状态；fresh clone 下这一项为 `✗`。
