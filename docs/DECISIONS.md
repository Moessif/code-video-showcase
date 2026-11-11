# 冻结决策（C0 之后）

> 集群并行期间，以下接口不得改动。需要变更时先改本文件并在集成时统一处理。

## D1 spec 是唯一真相

- 入口：`schema/project.spec.schema.json` + `templates/spec.mjs`
- 所有入口只产出 spec；`templates/plan.mjs` 是唯一 spec→plan 编译点。
- spec 结构兼容 timeline v1（`version:1` 会自动迁移）。

## D2 段哈希与缓存

- 每段 `segmentHash = sha256(plan/engine/page/frames/t0/speed/theme/brand/assets/patches)`，截 16 位。
- 缓存路径 `<outDir>/.cache/<hash>.mp4` + `.json`（frames）。
- 任何改变逐帧像素的实现变更必须递增 `ENGINE_VERSION`（`templates/spec.mjs`）。

## D3 编辑契约

页面必须实现（仅 canvas 页需要）：

```js
window.__spec    = () => specSnapshot;
window.__inspect = (x, y) => ({ id, role, rect, props, schema } | null);
window.__patch   = (id, props) => diff;   // 改内存 spec → renderFrame(currentT) → 返回 diff
```

- `big-card.html` / `segment.html` 是 Canvas 绘制，**不要用 DOM 命中测试**；在 `renderFrame` 里把可编辑区域注册进 hit map。
- `__patch` 只能改 spec/参数，不得直接改 DOM 或 canvas 像素后不管；必须能通过重新 `renderFrame` 复现。
- 不调用 `__inspect/__patch` 时，行为与现在完全一致。

## D4 文件所有权（并行期间）

| 路径 | 归属 |
|---|---|
| `app/wizard/` `content/presets.json` `content/combos.json` `scripts/nl2spec.mjs` | Wizard |
| `app/canvas/` `templates/edit-bridge.mjs` `templates/big-card.html` `templates/segment.html` `scripts/test-inspect.mjs` | Canvas |
| `app/script/` `app/versions/` `scripts/test-script.mjs` | Script |
| `scripts/assets.mjs` `scripts/variants.mjs` `templates/reflow.mjs` | Assets |
| `ingest/` | Ingest |
| `templates/styles/` `templates/cyber-pixel.html` `references/long-form.md` `references/style-recipes.md` | Content |

**任何人不得修改**：`package.json`、`templates/spec.mjs`、`templates/plan.mjs`、`templates/timeline.mjs`、`templates/render-farm.mjs`、`templates/themes.js`、`scripts/compile.mjs`、`scripts/spec-lint.mjs`、`schema/`。

## D5 零依赖

并行任务不执行 `npm install`；只用 Node 20+ 内置模块与仓库已有文件。浏览器渲染通过系统 Chrome（`CHROME_EXE`）。

## D6 验收

每个任务必须在 Windows Git Bash 下跑通自己的测试命令，并把命令与输出摘要写回报告。测试不得依赖网络。
