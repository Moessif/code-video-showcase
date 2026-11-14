# 仓库地图（v2.3.5）

> 从 SKILL.md §11 移出。SKILL.md 只保留「你要改什么 → 去哪里」的 12 行索引；
> 完整目录树与逐项说明在这里。

```
code-video-showcase/
├─ SKILL.md                              ← Agent 执行契约 + 工作流/约束/索引
├─ README.md / CHANGELOG.md              ← 仓库首页 / 版本记录
├─ package.json                          ← npm scripts（test/doctor/plan/render/qa/errors）
├─ .nvmrc                                ← Node 22
├─ docker/Dockerfile                     ← 固定 Node/Chrome/FFmpeg/Python 的渲染镜像
├─ docs/
│  ├─ OFFLINE.md                         ← 离线/内网部署
│  ├─ ERRORS.md                          ← 错误码 + 退出码（由 schema/errors.json 生成）
│  ├─ CLUSTER-PLAN.md / DECISIONS.md     ← 路线图 / 架构决策
│  └─ feedback/                          ← 内测集群产物（意见 + 优化方案 + backlog）
├─ schema/
│  ├─ project.spec.schema.json           ← spec (IR) 的 JSON Schema
│  └─ errors.json                        ← 错误码注册表（phase/exit/meaning/action）
├─ references/
│  ├─ repo-map.md                        ← 本文件
│  ├─ timeline-schema.md                 ← timeline v1 → plan.json 全字段与帧吸附
│  ├─ motion-and-color.md                ← 弹簧/缓动/CJK 排版/OKLCH/APCA/转场配方
│  ├─ platform-presets.md                ← 各平台分辨率/CRF/LUFS/命令
│  ├─ qa.md                              ← 视频/音频质检阈值与 JSON
│  ├─ ai-lane.md                         ← 可选 AI 素材 lane、模型表、License 红线
│  ├─ themes.md                          ← 17 套主题的调性/材质/token/HUD/推荐矩阵
│  ├─ style-recipes.md                   ← 20 种风格的美术+技术+音色配方
│  ├─ COVERAGE.md（docs/）               ← 领域×风格×效果×转场 覆盖矩阵 + 动效教义
│  ├─ big-card-and-typography.md         ← 大字卡 4 版式、字体/字号/砸入参数
│  ├─ audio-recipes.md                   ← 120BPM 编曲、音色合成公式、混音链
│  ├─ render-pipeline.md                 ← 浏览器/FFmpeg/跨平台环境与命令
│  ├─ intake.md / original-brief.txt     ← 需求采集 / 原始任务书
│  └─ reference-film-analysis.md         ← 61s 样片的实测拆解
├─ templates/
│  ├─ spec.mjs                           ← spec 归一化/校验/时长公式（浏览器可用）
│  ├─ spec-check.mjs                     ← Node 侧深度校验（lint 与 build 共用）
│  ├─ plan.mjs                           ← spec → plan + segmentHash + pageHash
│  ├─ timeline.mjs                       ← timeline v1 校验 + buildPlan + segments.txt
│  ├─ reflow.mjs                         ← 多画幅重排参数（16:9/9:16/1:1/3:4/6:7）
│  ├─ style-pages.mjs                    ← 画风 id → 真实渲染页（唯一真值）
│  ├─ color.js                           ← OKLCH/OKLab、APCA、主题派生
│  ├─ motion.js                          ← 弹簧/缓动/stagger/CJK 排版/质感/转场
│  ├─ common.js                          ← 缓动/种子随机/noise/片段模式/卡点冲击
│  ├─ themes.js                          ← 17 套主题 + 材质/卡片/HUD API（唯一数据源）
│  ├─ render-segment.mjs                 ← 逐帧渲染 → ffmpeg（Playwright/原生 CDP）
│  ├─ cdp.mjs                            ← 零依赖 Chrome DevTools Protocol 驱动
│  ├─ render-farm.mjs                    ← 并行/重试/断点续渲 + manifest
│  ├─ render-batch.mjs                   ← 单浏览器 batch 渲染
│  ├─ concat-and-encode.sh               ← 平台预设 + CRF + loudnorm + bt709
│  ├─ synth_audio.py                     ← numpy/scipy 音色库 + 编排骨架
│  ├─ timeline.example.json              ← 61s / 11 轮示例
│  ├─ segment.html / big-card.html       ← 通用场景页 / 大字卡
│  ├─ recipe-*.html / cyber-pixel.html   ← 20 个风格渲染页
│  ├─ transitions.mjs                    ← 段间转场单一真值（xfade 数学，v2.5）
│  ├─ effects.mjs                        ← 共享确定性效果库 26 个（v2.5）
│  ├─ effects-probe.html                 ← 效果库渲染探针
│  └─ theme-board.html / theme-sheet.html← 主题预览
├─ scripts/
│  ├─ compile.mjs                        ← 一条命令：校验→plan→渲染→拼接→QA
│  ├─ spec-lint.mjs                      ← spec 闸门（与 build 同源）
│  ├─ qa-video.mjs                       ← 容器/帧数/黑帧/冻结/静音/LUFS/内容断言
│  ├─ qa-audio.py                        ← BPM/拍网格/cue 对齐/削波/高频
│  ├─ doctor.mjs                         ← 环境体检（含 renderer 能力探测）
│  ├─ errors.mjs                         ← 错误码注册表检查 + ERRORS.md 生成
│  ├─ again.mjs                          ← 再来一版（--set + 增量 build）
│  ├─ deliver.mjs                        ← delivery.json + master.srt/.vtt
│  ├─ variants.mjs                       ← 笛卡尔变体（每个变体独立 outDir）
│  ├─ brand.mjs                          ← 品牌包 apply/check/list
│  ├─ image.mjs                          ← 同 spec 出封面/方图/竖版图
│  ├─ new-project.mjs                    ← 一键脚手架（timeline v1）
│  ├─ ai-lane.mjs                        ← AI 素材校验/叠加
│  ├─ vendor.mjs                         ← 生成离线安装的 vendor/
│  ├─ bundle-fonts.mjs                   ← 生成字体包 + sha256
│  ├─ build-fonts.mjs                    ← @fontsource → shared/fonts + OFL 文本
│  ├─ determinism-check.mjs              ← 同一 t 两次渲染字节比对
│  ├─ golden.mjs                         ← 静帧位级回归
│  ├─ theme-audit.mjs                    ← WCAG + APCA 审计
│  ├─ test-core.mjs / test-*.mjs         ← 纯 Node 回归
│  └─ test-compiler-contract.mjs         ← 交付契约回归（v2.3.5）
├─ bin/cvs.mjs                           ← 统一 CLI（28 个子命令）
├─ server/api.mjs                        ← 本机 job 队列（Origin/Host/Token 防护）
├─ app/{wizard,canvas,script,versions,review}/  ← 本地 GUI（experimental）
├─ fixtures/mini-41s/                    ← 41s 端到端 fixture（真实配方页）
├─ fixtures/golden/                      ← golden manifest
└─ assets/                               ← 样片接触表、频谱、切点、配色数据、截图
```

## 关键实测记录

- `render-segment.mjs` 走系统 Chrome + 原生 CDP + canvas 取帧（无需 Playwright）渲染 1920×1080@30fps。
- `render-farm.mjs` 双段并发 + `--resume`（帧数 + hash 双校验）通过。
- `concat-and-encode.sh --platform master` 输出 bt709/AAC 48 kHz。
- `qa-video.mjs` / `qa-audio.py` 实跑；42 秒 fixture 全链路通过。
- `timeline.mjs` 对 11 轮示例产出 33 段 / 1830 帧 / 61.000 s。
- 17 套主题 WCAG 全通过；`new-project.mjs` 脚手架可渲染。
- v2.3.5：`cvs build` 自动配乐、`--platform` 出交付版、`cvs deliver` 出清单与字幕。
