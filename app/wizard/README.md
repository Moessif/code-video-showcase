# 入口 C1 · 七张选择卡

小白入口：选两下，右侧实时得到一份可渲染的 `project.spec.json`（spec v1）。
无框架、无构建步骤、无 npm install，只用浏览器原生 ES module 与 Node 内置模块。

```bash
node app/wizard/serve.mjs
# → http://127.0.0.1:5181/app/wizard/
```

`serve.mjs` 以**仓库根目录**为静态根，端口默认 `5181`（`--port 5182` 可改）。
不要用 `file://` 直接打开：`app.js` 会 `import('/templates/spec.mjs')`，浏览器在 `file://`
下会以 CORS 拒绝模块加载。

## 七张卡

| # | 卡 | 写入 spec | 取值来源 |
|---|---|---|---|
| 01 | 做什么片 | `meta.kind` | `content/presets.json` 的 8 种 kind |
| 02 | 什么画风 | `look.style` + 每轮 `style.recipe` | `content/combos.json` 的 12 个 style id |
| 03 | 什么气质 | `look.theme` | `templates/themes.js` 的 17 个真实 theme id |
| 04 | 时长与画幅 | `format.duration/aspect/width/height` | schema 的 `aspect` 枚举；时长 4–600s |
| 05 | 节奏 | `audio.mood/bpm` | schema 的 `mood` 枚举 |
| 06 | 品牌与点缀 | `meta.brand` + `look.accentOverride` | 文本 / `#rgb`·`#rrggbb` |
| 07 | 结尾 CTA | `meta.cta` | 文本 / 快捷选项 |

首屏只显示 `content/presets.json` 的 **8 组推荐组合**；点「我自己调」才展开全部枚举。
枚举不是手抄的：`aspect` / `mood` 在启动时从 `schema/project.spec.schema.json` 读取，
`theme` 从 `templates/themes.js` 读取，`style` 从 `content/combos.json` 的矩阵列读取。

### avoid 组合不可选

`content/combos.json` 是 17 themes × 20 styles 的兼容矩阵，值为
`recommended | ok | avoid`。当主题与画风互为 `avoid` 时：

- 对应的画风 chip / 主题 chip 直接 `disabled`（虚线 + 删除线 + tooltip 说明原因）；
- 若是程序性变更（例如点预设后又改主题）造成的冲突，会自动切到该主题下第一个
  `recommended` 画风，保证状态里永远不存在 `avoid` 组合。

### APCA 安全主色

`aqua-morandi` 与 `graphite-signal` 的默认 `accentInk / accent` 组合过不了
`scripts/spec-lint.mjs` 的 APCA 45 门槛（42.6 / 42.9）。`content/combos.json` 的
`_meta.accentFix` 给出对比度安全值；用户没有显式选主色时，页面会自动把它写进
`look.accentOverride`：

| theme | accent | accentInk | 结果 |
|---|---|---|---|
| `aqua-morandi` | `#6e9fae`（不变） | `#142225` | accentInk/accent APCA 46.0 |
| `graphite-signal` | `#d93b10`（加深） | `#ffffff` | APCA 75.8；accent/bg 30.1 |

用户手动选的主色优先，不再套用安全值——此时 APCA 由 `spec-lint` 在 CLI 侧判定。

## 生成与校验

每次状态变更（120ms 防抖）：

1. `buildSpec(state)` 组装 spec v1；
2. `normalizeSpec(spec)`（`/templates/spec.mjs`）补默认值、展开 `rounds` 的 card/style 字段；
3. `validateSpec(normalized)` 检查结构、时长公式、枚举、页面等；
4. 右侧 `project.spec.json` 与下载/复制都使用**归一化后**的对象。

页面只用仓库真实存在的 `templates/segment.html` 与 `templates/big-card.html`，
所以 `scripts/spec-lint.mjs` 的页面存在性检查能过。

状态条会显示 `0 error · N warning`；`{{BRAND}}` 占位符会产生一条 `W_BRAND` warning，
这是预期行为（品牌会在品牌包里替换）。

## 静态服务与 timeline 浏览器化

`templates/spec.mjs` 依赖 `templates/timeline.mjs` 的 `query()`，而后者顶部
`import fs from 'node:fs'` / `import path from 'node:path'` 且底部有 CLI 自启动判断，
浏览器无法直接加载。

`serve.mjs` **只在响应里**处理 `/templates/timeline.mjs`：剥离两个 `node:` 导入，
注入 `process` / `fs` / `path` 的只读桩（调用即抛错），并打上
`X-Wizard-Rewrite: timeline-browser` 响应头。磁盘上的 `templates/timeline.mjs`
不被修改。若模板的导入行变化导致改写失效，服务会返回 500 并明确报错，而不是静默降级。

其他安全约定：只允许 `GET/HEAD`；拒绝目录穿越；拒绝点文件（`.git` 等）；
目录不列表；所有响应 `Cache-Control: no-store`。

## 参考图上传

拖入或点击「有参考图？」区域，浏览器内用 Canvas 采样 96×96，交给
`scripts/ref-core.mjs`（与 `scripts/from-reference.mjs` 同一套 OKLab k-means +
主题色板最近邻 + APCA 闸门）：

- 自动套用 top-1 主题与提取主色（`look.accentOverride`）；
- 显示 top-3 候选，点击可切换；
- 结果写入 `meta.reference`（来源、置信度、候选、色板、密度），可追溯，不复制像素；
- 置信度 < 0.15 时提示改选候选；
- 选择推荐预设会清空参考图状态。

CLI 同一算法：`node bin/cvs.mjs ref poster.jpg --spec project.spec.json --out project.spec.json`。

## 文件

| 文件 | 作用 |
|---|---|
| `index.html` | 页面骨架：参考图上传、8 组预设、七张卡、右侧预览 |
| `app.js` | 状态、枚举加载、spec 组装、normalize/validate、参考图、下载/复制 |
| `style.css` | 暗色工作台样式，响应式；`prefers-reduced-motion` 关闭动画 |
| `serve.mjs` | 5181 静态服务 + timeline 浏览器改写 |
| `../../scripts/ref-core.mjs` | 参考图纯函数核心（Node/浏览器共用） |
| `../../content/presets.json` | 8 组首屏推荐预设 |
| `../../content/combos.json` | 17×20 兼容矩阵 + `_meta` 生成规则 |

## 已知边界

- 没有后端、没有持久化：刷新即回到第一组预设；状态不写 localStorage。
- 不做 APCA 校验：`validateSpec` 只做结构校验；主色对比度由
  `node scripts/spec-lint.mjs --spec ...` 在 CLI 侧复核。
- 主题 swatch 用的是 `themes.js` 的 `colors.bg` + `colors.accent` 两色渐变，
  不是完整主题渲染；它只用于辨认，不代表最终画面。
- `look.style` 在 JSON Schema 里是自由字符串；12 个 id 的“白名单”来自
  `content/combos.json`，不是 schema 枚举。
- 参考图是 96×96 全图拉伸采样（与 CLI 的 ffmpeg `scale=96:96` 一致）；极端长图会丢掉局部细节，
  低置信时请手动点候选，或改用 `cvs ref` 后手工调 `look`。
