# 视频编译器 · 集群实施计划 v1.0

> 基线：`code-video-showcase` v2.0.0（2026-11-11，Windows 端到端跑通）
> 目标：从「一个能出片的 Skill」升级为「选择式视频编译器」——小白选两下出片，圈一下只改一处，改完只重编译那一段。
> 口径：工时为单人流工程日（±40%），可 2–3 条 Agent 集群并行压缩。

---

## 0. 一页纸

| 项 | 内容 |
|---|---|
| 产品一句话 | 选择即参数，圈选即 patch，重渲染即编译 |
| 终局形态 | 入口层（选择/自然语言/参考图/剧本）→ spec.json（IR）→ plan.json → 增量渲染 → 成片 |
| 四个里程碑 | M0 编译地基（W2）· M1 小白可用（W6）· M2 好改（W10）· M3 规模化（W14）· 发布（W16） |
| 八个集群 | C0 编译地基 · C1 入口 · C2 编辑画布 · C3 素材品牌 · C4 渲染集群 · C5 质量 · C6 内容资产 · C7 交付运营 · C8 智能拓展 |
| 北极星指标 | **二次修改率**：一次成片后 10 分钟内再改一版并成功的会话占比 ≥ 60% |
| 不做 | 多轨 NLE、逐帧 inpainting、换脸/克隆音、自研生成模型、移动原生 App |

---

## 1. 现状盘点（基线）

| 能力 | 位置 | 成熟度 | 缺口 |
|---|---|---|---|
| 逐帧确定性渲染 | `templates/render-segment.mjs`、`motion.js` | 生产可用 | 无 spec，参数散在页面里 |
| 时间轴 | `templates/timeline.mjs`、`timeline.example.json` | 可用 | 只支持示例结构，无 schema/校验/增量 |
| 主题系统 | `templates/themes.js`（17 套） | 生产可用 | 无 combos 兼容矩阵 |
| 风格配方 | `references/style-recipes.md`（11 种） | 文档级 | 无单风格整片模式 |
| 渲染调度 | `templates/render-farm.mjs` | 可用（并发+续渲） | 无内容寻址缓存、无分布式 |
| 质检 | `qa-video.mjs` / `qa-audio.py` / `theme-audit.mjs` | 可用 | 未进 CI，无黄金样本回归 |
| AI 素材层 | `scripts/ai-lane.mjs` + `references/ai-lane.md` | 设计完成、默认关闭 | 无 provider 适配、无成本账本 |
| 需求采集 | `references/intake.md` → `brief.json` | 文档级 | 无 UI、无 schema、无迁移 |
| 入口/画布/剧本/参考图 | — | 无 | 本计划的 C1/C2 |
| 参考片分析 | `scripts/analyze-reference.sh` | 未验证 | 只抽帧，无反推结构 |
| 自动剪辑 | — | 无 | C8 |
| 批量变体 | — | 无 | C4 |

**开工前置动作**（当前工作区有未提交改动）：

```bash
cd code-video-showcase
git add -A && git commit -m "chore: baseline before compiler work"
git tag v2.0.0-baseline
```

---

## 2. 目标架构

```text
┌─ 入口层 ─────────────────────────────────────────────────────────────┐
│ 七张选择卡 │ 自然语言 │ 参考图/参考片 │ 剧本导入 │ API/SDK │ Agent Skill │
└──────────────────────────────┬───────────────────────────────────────┘
                               ▼
┌─ 编译层 ─────────────────────────────────────────────────────────────┐
│ project.spec.json (IR) → spec-lint → plan.json → dirty set           │
│ 不变式：duration 公式 / 帧对齐 / 脚本无缝覆盖 / 文案长度 / APCA       │
└──────────────────────────────┬───────────────────────────────────────┘
                               ▼
┌─ 素材层 ─────────────────────────────────────────────────────────────┐
│ 纯代码画面 │ 上传素材 │ 品牌包 │ AI-lane（哈希缓存 + manifest + 回退） │
└──────────────────────────────┬───────────────────────────────────────┘
                               ▼
┌─ 渲染层 ─────────────────────────────────────────────────────────────┐
│ render-farm（本地并发）│ render-cluster（分布式）│ 平台预设/多画幅重排 │
└──────────────────────────────┬───────────────────────────────────────┘
                               ▼
┌─ 质检层 ─────────────────────────────────────────────────────────────┐
│ spec-lint │ qa-video │ qa-audio │ theme-audit │ 视觉验收 │ 确定性回归 │
└──────────────────────────────┬───────────────────────────────────────┘
                               ▼
┌─ 产物 ───────────────────────────────────────────────────────────────┐
│ master.mp4 │ 平台交付版 │ 封面帧 │ manifest.json │ 版本树              │
└──────────────────────────────────────────────────────────────────────┘
```

三条铁律：

1. **spec 是唯一真相**。任何入口、任何编辑，只能改 spec；不许直接改 DOM 或成片。
2. **段哈希决定重编译范围**。未变段必须跳过，且可证明（缓存命中日志）。
3. **AI 只填表、只供素材**。不让模型生成 HTML/CSS/JS，不改时间网格。

---

## 3. 八个集群

### C0 编译地基（13d，W1–W2）

目标：把现在散落在模板与示例里的参数，收成可校验、可迁移、可增量的 IR。

| ID | 工单 | 产物 | 验收 | 估时 | 依赖 |
|---|---|---|---|---|---|
| C0-01 | spec JSON Schema | `schema/project.spec.schema.json` | 8 组预设全部通过 `ajv`（或自写 validator） | 1d | — |
| C0-02 | spec 加载/归一化/迁移 | `templates/spec.mjs` | `brief.json` v0 自动迁移到 spec v1 | 2d | C0-01 |
| C0-03 | 不变式校验器 | `scripts/spec-lint.mjs` | 20 条规则；故意破坏任一规则必须报错并给修复建议 | 2d | C0-02 |
| C0-04 | spec→plan 编译器 | `templates/plan.mjs` | 帧数=round(D×30)；脚本块无缝无重叠；每段带 `segmentHash` | 3d | C0-02 |
| C0-05 | 一键编译编排 | `scripts/compile.mjs` | `lint→plan→render(dirty)→concat→qa` 一条命令 | 2d | C0-04 |
| C0-06 | 段级内容寻址缓存 | `out/.cache/<hash>.mp4` | 同 spec 二次编译 0 帧重渲，日志证明 | 2d | C0-04 |
| C0-07 | 旧格式迁移 | `scripts/migrate-brief.mjs` | 3 个历史项目无损迁移 | 1d | C0-02 |

spec v1 字段（冻结）：

```json
{
  "specVersion": 1,
  "meta": { "name": "", "brand": "{{BRAND}}", "cta": "", "locale": "zh-CN" },
  "format": { "w": 1920, "h": 1080, "fps": 30, "duration": 41, "aspect": "16:9" },
  "look": { "mode": "single", "style": "cyber-pixel", "theme": "cyber-neon", "accentOverride": null },
  "audio": { "mood": "electronic", "bpm": 120, "vo": null },
  "structure": { "opening": 8, "round": 4, "rounds": 6, "flashes": 2, "ending": 6 },
  "script": [
    { "id": "s01", "t": [0, 8], "role": "opening", "copy": ["..."] },
    { "id": "s02", "t": [8, 12], "role": "card", "copy": ["想开", "产品发布会?"] },
    { "id": "s03", "t": [12, 16], "role": "scene", "recipe": "cyber-pixel", "copy": "...", "assets": [] }
  ],
  "assets": [],
  "patches": [],
  "render": { "quality": "master", "preset": "bilibili", "concurrency": 4 }
}
```

段哈希定义（所有缓存与增量的基础）：

```text
segmentHash = sha256(
  JSON.stringify(specSlice) + recipeVersion + themeHash +
  engineVersion + sorted(assetHashes)
)
```

### C1 入口与选择（17d，W3–W5）

目标：小白 3 分钟内得到第一条可渲染的 spec。

| ID | 工单 | 产物 | 验收 | 估时 | 依赖 |
|---|---|---|---|---|---|
| C1-01 | 七张选择卡 | `app/wizard/` | 8 组预设任选一键生成合法 spec | 4d | C0 |
| C1-02 | 预设与兼容矩阵 | `content/presets.json`、`content/combos.json` | 只露 8 组；`avoid` 组合不可选 | 2d | C0-01 |
| C1-03 | 自然语言 → spec | `scripts/nl2spec.mjs` | 20 条测试语料，schema 通过率 100%，越界枚举自动回退 | 3d | C0-03 |
| C1-04 | 参考图接入 | `scripts/from-reference.mjs` + UI | 上传→look.json→spec 合并→预览，< 10s | 2d | C0-02 |
| C1-05 | 参考片结构反推 | `scripts/analyze-reference-v2.mjs` | 输入 60s 参考片，输出 N/BPM/切点，误差 ≤ 1 拍 | 4d | C1-04 |
| C1-06 | 剧本导入 | `scripts/import-script.mjs` | 纯文本/Markdown → script 块，人工可改 | 2d | C0-03 |

NL→spec 三条硬规则：枚举白名单、文案字数上限、失败回退默认组合。提示词归一化后哈希缓存，同一句话只调一次模型。

### C2 编辑与画布（28d，W3–W10，最大集群）

目标：把「改一处」做成 1 秒反馈、只重编译一段。

| ID | 工单 | 产物 | 验收 | 估时 | 依赖 |
|---|---|---|---|---|---|
| C2-01 | 画布宿主 | `app/canvas/` | 拖动时间轴实时 `renderFrame(t)`，1080p 拖动 ≥ 20fps | 3d | C0-04 |
| C2-02 | `data-edit-id` 标注规范 | `docs/edit-contract.md` | 13 段全部节点带 id + schema | 4d | C2-01 |
| C2-03 | `__inspect/__patch` 契约 | `templates/edit-bridge.mjs` | big-card 点选改字/改色/改位，静帧 < 1s | 3d | C2-02 |
| C2-04 | schema 驱动属性面板 | `app/canvas/panel.js` | 文本/颜色/数值/枚举四类控件 | 3d | C2-03 |
| C2-05 | 圈选与组变换 | `app/canvas/marquee.js` | 框选多节点，整体移动/缩放/换色 | 4d | C2-03 |
| C2-06 | 剧本表格编辑 | `app/script/` | 改一行文案→对应段标脏；溢出实时预警 | 3d | C0-04 |
| C2-07 | 版本树与 diff | `app/versions/` | 每版可回滚；两版并排同步 scrub | 4d | C0-06 |
| C2-08 | 脏段后台重渲 + 热替换 | `scripts/compile-dirty.mjs` | 改一段只渲一段；预览无缝替换 | 2d | C0-06 |

编辑契约（冻结）：

```js
window.__spec   = () => currentSpec;                  // 只读快照
window.__inspect = (x, y) => ({                       // 屏幕坐标 → 可编辑节点
  id, role, rect, props, schema
});
window.__patch  = (id, props) => diff;                // 改 spec → 重画当前帧 → 返回 diff
```

硬规则：`__patch` 只改 spec，不改 DOM；节点必须有稳定 `data-edit-id`；没有 schema 的节点只读。

### C3 素材与品牌（16d，W7–W9）

| ID | 工单 | 产物 | 验收 | 估时 | 依赖 |
|---|---|---|---|---|---|
| C3-01 | 素材注册表 | `scripts/assets.mjs` | 导入即算哈希、ffprobe 元数据、缩略图 | 3d | C0-04 |
| C3-02 | 上传与拖入 | `app/assets/` | 图片/视频/音频拖入时间轴，自动适配画幅 | 2d | C3-01 |
| C3-03 | 品牌包 | `content/brand.schema.json` | logo 安全区、主色、字体、禁用词检查 | 3d | C3-01 |
| C3-04 | AI-lane 适配层 | `scripts/ai-providers/` | 本地/云 2 个 provider；成本账本 | 4d | C3-01 |
| C3-05 | 许可白名单与审计 | `scripts/license-audit.mjs` | NC/AGPL 模型默认拒绝 | 2d | C3-04 |
| C3-06 | 生成素材时序规则 | `references/ai-lane.md` v2 | 只允许整段替换或 b-roll 叠加；禁止逐帧 inpaint | 2d | C3-04 |

### C4 渲染集群（17d，W9–W12）

| ID | 工单 | 产物 | 验收 | 估时 | 依赖 |
|---|---|---|---|---|---|
| C4-01 | 只渲脏段 | `render-farm --only-changed` | 缓存命中率 > 80%（编辑会话） | 2d | C0-06 |
| C4-02 | 分布式 worker 协议 | `cluster/worker.mjs`、`cluster/queue.mjs` | 4 台机器线性加速 ≥ 3.2× | 5d | C4-01 |
| C4-03 | 固定镜像 | `docker/Dockerfile` | Chrome/字体/ffmpeg 版本锁定，跨机哈希一致 | 2d | C4-02 |
| C4-04 | 变体矩阵 | `scripts/variants.mjs` | 文案×主题×画幅笛卡尔积，100 条 30 分钟内 | 3d | C4-01 |
| C4-05 | 多平台重排 | `templates/reflow.mjs` | 9:16 是重排不是裁切；安全区/字号重算 | 4d | C0-04 |
| C4-06 | 批量清单与打包 | `scripts/bundle.mjs` | manifest + zip + 失败重试报告 | 1d | C4-04 |

### C5 质量与确定性（12d，W2–W12 持续）

| ID | 工单 | 产物 | 验收 | 估时 | 依赖 |
|---|---|---|---|---|---|
| C5-01 | lint 进 CI | `.github/workflows/spec.yml` | 非法 spec 阻断合并 | 1d | C0-03 |
| C5-02 | 黄金样本库 | `fixtures/golden/`（20 个项目） | 像素差 < 阈值；结构差 = 0 | 4d | C0-05 |
| C5-03 | 跨机确定性 | `scripts/determinism-check.mjs` v2 | 两机两跑哈希一致 | 2d | C4-03 |
| C5-04 | 视觉验收闸门 | `scripts/visual-gate.mjs` | 每段触表 + 评分，失败阻断交付 | 2d | C5-02 |
| C5-05 | 质量看板 | `app/qa/` | 帧数/响度/APCA/黑帧一屏可见 | 3d | C5-02 |

### C6 内容资产（21d，W1–W12 并行）

| ID | 工单 | 产物 | 验收 | 估时 | 依赖 |
|---|---|---|---|---|---|
| C6-01 | 赛博像素配方 | `references/style-recipes.md` 第 12 条 | 量化/抖动/扫描线/色差/CRT 全为 `t` 的纯函数 | 2d | — |
| C6-02 | 新增 8 套配方 | 同上 | 每套 1 段 3s 样片 + 1 张接触表 | 8d | C6-01 |
| C6-03 | 单风格长片编排规则 | `references/long-form.md` | 41s 单风格不单薄：三幕/节奏/景别变化 | 3d | C6-02 |
| C6-04 | 组合兼容矩阵 | `content/combos.json` | recommended/ok/avoid 三档，覆盖 17×20 | 2d | C1-02 |
| C6-05 | 12 条案例片 | `content/cases/` | 每条附 spec + 源码，可一键复现 | 6d | C6-03 |

### C7 交付与运营（18d，W11–W16）

| ID | 工单 | 产物 | 验收 | 估时 | 依赖 |
|---|---|---|---|---|---|
| C7-01 | `cvs` CLI | `bin/cvs.mjs` | `cvs new/render/preview/qa` 四命令 | 3d | C0-05 |
| C7-02 | 本地 Web 工作台 | `app/`（项目列表/画布/剧本） | 双击启动，无外部服务 | 5d | C2-01 |
| C7-03 | HTTP API | `server/api.mjs` | `POST /spec` → job id → 进度 → 成片 | 4d | C4-02 |
| C7-04 | 评审链接 | `app/review/` | 只读播放 + 帧级评论 | 3d | C2-07 |
| C7-05 | 匿名遥测 | `scripts/telemetry.mjs` | 默认关闭；只看预设选择与流失点 | 1d | C7-02 |
| C7-06 | 打包分发 | npm / Docker / Skill | 三形态同源，版本一致 | 2d | C7-01 |

### C8 智能与拓展（24d，W10–W15）

| ID | 工单 | 产物 | 验收 | 估时 | 依赖 |
|---|---|---|---|---|---|
| C8-01 | 素材摄取 | `ingest/probe.mjs` | ffprobe + 场景切分 + 静音检测 | 3d | C3-01 |
| C8-02 | 词级转写对齐 | `ingest/asr.mjs` | 10 分钟素材 < 3 分钟（CPU） | 3d | C8-01 |
| C8-03 | 选段与 EDL | `ingest/edl.mjs` | 清晰度/运动/语音/时长打分，产出可审 EDL | 4d | C8-02 |
| C8-04 | 录屏→教程片 | `ingest/screen.mjs` | 光标事件→缩放/标注/章节卡 | 5d | C8-03 |
| C8-05 | 数据驱动批产 | `scripts/data2video.mjs` | CSV 每行一条片，字段校验失败即跳过 | 3d | C4-04 |
| C8-06 | 多语言矩阵 | `scripts/i18n-matrix.mjs` | 一条 spec → 12 语，字幕不溢出 | 3d | C2-06 |
| C8-07 | 配方/主题插件 API | `plugin/sdk.mjs` | 第三方配方签名加载，不改核心 | 3d | C0-01 |

---

## 4. 里程碑与排期

| 里程碑 | 周 | 交付 | 验收口径 |
|---|---|---|---|
| M0 编译地基 | W2 | C0 全量 + C5-01 | `npm run spec:lint && npm run determinism` 全绿；二次编译 0 帧重渲 |
| M1 小白可用 | W6 | C1-01/02/03 + C2-01/02/06 + C6-01/03 + 3 套预设 | 5 名非技术用户，3 分钟内各出一条 41s 片 |
| M2 好改 | W10 | C2-03→08 + C3-01/02/03 + C4-04/05 | 圈选改一处：静帧 < 1s，段重渲 < 40s，其余段缓存命中 |
| M3 规模化 | W14 | C8-01→04 + C4-02/03 + C7-03 + 8 套配方 | 4 机集群 100 变体 < 30 分钟；10 分钟素材自动出 60s 粗剪 |
| M4 发布 | W16 | C7 全量 + C6-05 + 文档/打包 | 12 条案例可复现；三形态安装成功率 100% |

并行轨道：

```text
W1  ├ C0 ─────────────┐
W2  │   └ C5-01        │
W3  ├ C1 ──────┐       ├ C2 画布 ────────┐
W6  │          └ M1    │                 │
W7  ├ C3 ──────┐       │                 ├ C4 渲染 ──┐
W10 │          └ M2 ───┘                 │           │
W11 ├ C7 交付 ────────────────────────────┤           │
W12 ├ C8 智能 ────────────────────────────┘           │
W16 └ M4 ◀────────────────────────────────────────────┘
```

---

## 5. 渲染集群（算力层）

| 形态 | 规模 | 用途 | 实现 |
|---|---|---|---|
| 单机 | 4–8 并发 | 个人/编辑回路 | 现有 `render-farm` + 段缓存 |
| 局域网 | 2–8 节点 | 批量/团队 | worker 拉取任务，共享内容寻址缓存（NAS） |
| 云突发 | 按需 | 大促/批量 | 固定 Docker 镜像，任务队列 + 对象存储 |

协议：worker 只接收 `{segmentHash, specSlice, assets, renderOpts}`，返回 `{hash, mp4, qa}`；重复哈希直接取缓存。队列幂等，worker 可随时重启。

目标性能（1080p/30fps）：
- 单段 3s：并发 4 时 ≤ 30s
- 61s 全片：并发 4 时 ≤ 5min，并发 8 时 ≤ 3min
- 100 条 41s 变体：4 节点 ≤ 30min

---

## 6. 开发集群（多 Agent 执行）

原则：**一个 mission = 一个目录子树**，禁止两个 mission 同时写同一文件。

| Mission | 所有权 | 验证命令 |
|---|---|---|
| M-C0 | `schema/`、`templates/spec.mjs`、`templates/plan.mjs`、`scripts/spec-lint.mjs`、`scripts/compile.mjs` | `npm run spec:lint && npm run plan` |
| M-C1 | `app/wizard/`、`scripts/nl2spec.mjs`、`content/presets.json` | `node scripts/test-nl2spec.mjs` |
| M-C2a | `app/canvas/`、`templates/edit-bridge.mjs` | `node scripts/test-inspect.mjs` |
| M-C2b | `app/script/`、`app/versions/` | `node scripts/test-script.mjs` |
| M-C3 | `scripts/assets.mjs`、`content/brand.schema.json`、`scripts/ai-providers/` | `node scripts/test-assets.mjs` |
| M-C4 | `cluster/`、`docker/`、`scripts/variants.mjs` | `node cluster/test-e2e.mjs` |
| M-C5 | `fixtures/golden/`、`scripts/visual-gate.mjs` | `npm run determinism && npm run qa` |
| M-C6 | `references/style-recipes.md`、`content/combos.json` | `node scripts/theme-audit.mjs --strict` |
| M-C7 | `bin/`、`app/`、`server/` | `node server/test-api.mjs` |
| M-C8 | `ingest/` | `node ingest/test-edl.mjs` |

共享文件冻结表：

| 文件 | 归属 | 规则 |
|---|---|---|
| `package.json` | 集成者 | 只有集成者能改 scripts/deps |
| `templates/themes.js` | C6 | W1 后冻结，只允许加主题，不改既有值 |
| `templates/motion.js` | C2 | 只允许追加导出，不改签名 |
| `README.md` / `SKILL.md` | 发布者 | 里程碑时统一更新 |

执行节奏：3 个 builder 并发 + 1 critic 常驻 + 里程碑 verifier。每个 mission 的 `verification_cmd` 必须能在 5 分钟内跑完；跑不过不许合并；critic 只挑错不表扬，finding 必须带 `path:line`。

---

## 7. 指标与验收

| 指标 | 目标 | 测法 |
|---|---|---|
| 首次出片时间（TTFV） | 新手 < 5 min | 5 人可用性测试 |
| 静帧响应 | < 1s | 画布打点 |
| 单段重渲（3s） | < 40s | render-farm 日志 |
| 全片重渲（61s） | < 5min @4 并发 | 基准脚本 |
| 增量准确率 | 未变段 0 重渲 | 缓存命中日志 |
| 确定性 | 两机两跑哈希一致 | CI |
| 批量 | 100 变体 < 30min @4 节点 | 压测 |
| 质量 | QA 全过；APCA 全过 | CI |
| 二次修改率 | ≥ 60% 会话 | 遥测（opt-in） |
| 崩溃率 | < 0.5% 会话 | 遥测 |

---

## 8. 风险登记册

| 风险 | 概率 | 影响 | 缓解 | 触发信号 |
|---|---|---|---|---|
| 单风格长片单薄 | 高 | 高 | C6-03 三幕编排 + 景别/运动库；先出 3 条样片定标准 | 内部评审“像 PPT” |
| 圈选依赖 DOM 结构 | 中 | 高 | 编辑契约 + 每配方契约测试；无 schema 节点只读降级 | 某配方点选错位 |
| 自动剪辑质量不稳 | 高 | 高 | 先锁两个域：口播、录屏；其余标 beta | EDL 人工返工 > 50% |
| LLM 输出漂移 | 中 | 中 | 枚举 + temperature 0 + 哈希缓存 + 回退 | schema 通过率 < 95% |
| 范围膨胀 | 高 | 高 | 第 9 节不做清单；里程碑门禁 | 新需求挤占 M 验收 |
| 浏览器版本漂移 | 中 | 中 | Docker 锁版本；`engineVersion` 进段哈希 | 跨机哈希不一致 |
| 字体/素材许可 | 低 | 中 | 只收 OFL；素材来源白名单 | 法务抽查 |
| 用户不信任“无模型” | 中 | 低 | 徽章改 `Deterministic by default · Generative on demand` | 咨询集中在“是不是 AI 生成” |

---

## 9. 不做清单（anti-scope）

1. 多轨 NLE、拖拽时间轴、关键帧曲线。
2. 逐帧 inpainting / 逐帧重绘。
3. 换脸、声音克隆、真人数字人。
4. 自研文生视频/文生图模型。
5. 实时多人协同（v1 不做）。
6. 移动原生 App（前 6 个月）。
7. 在线素材市场（先做插件 API）。

---

## 10. 拓展池

| 优先级 | 拓展 | 价值 | 成本 |
|---|---|---|---|
| P0 | 多平台重排（非裁切） | 一条 spec 出 16:9/9:16/1:1 | C4-05 |
| P0 | 版本树 + 双版同步 scrub | “改坏了回得去” | C2-07 |
| P0 | 数据驱动批产 | 电商/报表按行出片 | C8-05 |
| P0 | 录屏→教程片 | 开发者内容刚需，与品牌最贴 | C8-04 |
| P0 | GitHub Action：PR 改文案→机器人回预览 | 视频进 CI，天然传播 | 2d |
| P1 | 多语言矩阵 | 一条片 12 语 | C8-06 |
| P1 | 帧级评论/评审链接 | 团队交付 | C7-04 |
| P1 | 720p WebGL 实时预览 | 编辑手感 | 4d |
| P1 | 品牌合规检查 | B 端付费点 | C3-03 |
| P1 | A/B 钩子批量 | 投放优化 | C4-04 |
| P2 | 插件市场 | 生态 | C8-07 |
| P2 | PPT/大纲→视频 | 知识区 | 4d |
| P2 | Lottie/SVG 导入 | 设计协作 | 4d |
| P2 | 代码 AST 讲解片 | 品牌延伸 | 5d |
| P2 | 音频可视化层 | 音乐类内容 | 2d |

---

## 11. 第一周可直接开工的 10 条工单

1. `C0-01` 写 spec JSON Schema。
2. `C0-02` 写 `spec.mjs`（load/normalize/migrate）。
3. `C0-03` 先落 8 条 lint 规则（时长公式、帧对齐、脚本无缝、文案长度、APCA、枚举、素材存在、画幅合法）。
4. `C0-04` 把 `timeline.mjs` 重构成 `plan.mjs`，加 `segmentHash`。
5. `C0-06` 建 `out/.cache`，先做“同 spec 二次编译 0 帧重渲”。
6. `C5-02` 建 `fixtures/mini-41s/` 黄金样本。
7. `C6-01` 赛博像素配方原型（可与 1–6 并行）。
8. `C1-01` 七张卡的静态原型（可与 1–6 并行）。
9. `C5-01` lint 进 CI。
10. 提交基线 tag 并开 `docs/DECISIONS.md` 记录冻结决策。

验收命令：

```bash
npm run spec:lint
npm run plan
npm run render
npm run determinism
npm run qa
```

---

## 12. 结论

这个计划的本质不是“加功能”，是**把已有能力收进一个 IR，然后用 IR 换三样东西**：

- 换入口：小白不用懂代码，选卡即可；
- 换编辑：圈选改一处，只重编译一段；
- 换规模：一条 spec 变一百条片，一台机器变一个集群。

三条护城河按顺序建立：**spec（W2）→ 增量（W6）→ 圈选（W10）**。前两条不做，第三条无处落地；第三条不做，前两条只是内部重构。
