# 内测集群产物索引

> 基线：code-video-showcase v2.3.4（`f67616d`）· 落地状态更新到 **v2.4.0**（2026-11-13）
> 集群：1 名产品经理 + 6 名异质内测者 · 76 条意见 · 26 个优化项

## 先看哪个

| 你是 | 打开 |
|---|---|
| 想知道改到哪一步了 | [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md) — 26 项逐条落地状态（v2.4.0：**已落地 26 / 部分 0 / 未做 0**） |
| 要拍板/排期 | [OPTIMIZATION-PLAN-v2.3.4.md](OPTIMIZATION-PLAN-v2.3.4.md) — 26 项、ICE 打分、四周序列、验收断言 |
| 想知道为什么 | [BETA-REPORT-v2.3.4.md](BETA-REPORT-v2.3.4.md) — 五条结论、八个根因、76 条原始意见索引 |
| 机器消费 | [BACKLOG.json](BACKLOG.json) — 26 项 + 4 个 C 路线延伸 + 3 个决策 + 4 条不做 |
| 复跑集群 | [PERSONAS.md](PERSONAS.md) — 7 个角色卡 + 反馈模板 + 聚合规则 |
| 看原始取样 | [inbox/](inbox/) — 每个角色一份原文，未改写 |

## 一句话结论

默认成片带开发者占位符、静音母版/占位页/改文案不重渲都能绿灯通过、平台预设与变体互相覆盖——
先花 10 人日把「假绿」清零，再谈新功能。

## 三个已拍的决定

1. **主路线选 A「Agent 视频编译器」**；品牌路线付费验证，剪辑师路线延后，小白路线暂缓。
2. **GUI 层标 experimental、移出主测试矩阵**，本轮不修。
3. **素材通道从对外承诺移除**，或单独立项。

## 目录

```
docs/feedback/
├── README.md                      ← 本文件
├── PERSONAS.md                    ← 集群编制与协议
├── BETA-REPORT-v2.3.4.md          ← 意见汇总
├── OPTIMIZATION-PLAN-v2.3.4.md    ← 优化方案
├── IMPLEMENTATION-STATUS.md       ← 落地状态（对照 26 项）
├── BACKLOG.json                   ← 机器可读台账
└── inbox/
    ├── 00-PM.md
    ├── 01-novice.md
    ├── 02-brand.md
    ├── 03-dev.md
    ├── 04-agent.md
    ├── 05-editor.md
    └── 06-enterprise.md
```

> 台账与门禁记录：`.cluster/state.json`
