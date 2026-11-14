# app/script — 剧本表格编辑器（C2-06）

把 `project.spec.json` 的 `rounds[]` 展开成一张可双击编辑的表格：改一行文案/画风参数，
右侧 JSON 预览与总时长实时更新，超长文案与结构不一致立刻标红。

## 启动

```bash
node app/script/serve.mjs          # http://127.0.0.1:5183/app/script/
node app/script/serve.mjs --port 5190
```

零依赖：静态服务只读仓库根，页面用 `fetch('/fixtures/mini-41s/spec.json')` 载入示例。
必须通过服务器访问（`file://` 下 fetch 会被浏览器拦截）。

## 页面

- **表格列**：`# / ID / 角色 / 名称 / 起始秒 / 时长 / first / keyword / recipe / t0 / speed`
- **双击可编辑**（虚线下划线）：`name / first / keyword / recipe / t0 / speed`；Enter 提交，Esc 取消。
- **红行 + 原因**：`validateRows()` 的 issue 会标红整行，并精确标红出问题的单元格；右侧列出 code 与说明。
- **顶部统计**：`D = opening + N×round + moreCard + flash.count×each + ending`，
  帧数 = `round(D×fps)`，段数与 plan 一致（opening + N×2 + more + flash + ending）。
- **按钮**：下载 `project.spec.json`、复制 JSON、恢复原始（重新 fetch 示例）。

## model.mjs（纯函数，Node 可直接 import）

| 导出 | 作用 |
|---|---|
| `specToRows(spec)` | spec → 表格行；行 id 与 `templates/timeline.mjs` 的段 id 对齐（`00-opening`、`r01-card`、`r01-style`、`99-more`、`f01`、`99-ending`） |
| `applyRowEdit(spec,rowId,field,value)` | 返回新 spec（不可变）；字段白名单 + 数值范围校验 |
| `validateRows(spec)` | issues：文案超长（first>8 / keyword>12）、轮次总时长与 structure 不一致、id 重复、speed<=0、t0 越界、总时长不一致 |
| `specTotals(spec)` | `{ nominal, duration, frames, fps, segments, rounds }`，公式与 `specDuration` 一致 |
| `specHash(spec)` | 递归排序键后的稳定 JSON → sha256 前 12 位（内置纯 JS SHA-256） |
| `diffSpecs(a,b)` | 行级 unified diff 文本（LCS，3 行上下文） |
| `sha256Hex(text)` | 纯 JS SHA-256，浏览器/Node 通用 |

时间轴复用 plan 的帧对齐：`startFrame = round(cursor×fps)`，末段收口到 `round(total×fps)`，
因此行时长之和恒等于 `总帧数 / fps`。

## 边界与已知限制

- 只编辑内容字段；**时长/结构字段只读**（改时长会连带改 `structure` 与全部段哈希，留给 planner）。
- `applyRowEdit` 使用 JSON 深拷贝，会丢弃 spec 上的非枚举属性（如 `templates/spec.mjs` 的 `_authoredBy`）。
  从页面下载的 spec 本来就不含它，重新 `normalizeSpec()` 可重建。
- 文案超长不阻止输入，只在 `validateRows()` 标红——与 `spec-lint` 的“警告而非硬阻断”一致。
- 页面不写回磁盘；导出靠「下载 project.spec.json」。
- `flash` 行代表 `structure.flash.count` 的整体计数，逐行只读。
- 「轮次总时长不一致」以 `round.duration`（可选扩展字段）或 `structure.round` 为基准；
  没有该扩展字段时它就是 `card + scene` 的帧对齐守卫（容差半帧）。

## 测试

```bash
node scripts/test-script.mjs
```
