# app/canvas — 编辑画布宿主（C2-01 / C2-03 / C2-04）

零依赖、无外部资源。服务仓库根目录，用 iframe 打开 `templates/big-card.html` / `templates/segment.html`，
点画面里的可编辑区域 → 右侧面板按 schema 出控件 → `__patch` → 页面自己重绘。

## 启动

```bash
node app/canvas/serve.mjs            # http://127.0.0.1:5182/app/canvas/
node app/canvas/serve.mjs --port 5190
```

`serve.mjs` 同时导出 `createStaticServer(root)` / `startServer({root, port})`，`scripts/test-inspect.mjs` 直接复用。

## 界面

| 区域 | 行为 |
|---|---|
| 顶栏 · 页面 | `big-card`（DURATION 1.0s） / `segment`（DURATION 3.0s） |
| 顶栏 · 主题 | `templates/themes.js` 的 17 套主题；第一项是「无 theme」旧版默认画面 |
| 画面 | 1920×1080 canvas，按容器等比 CSS 缩放；点击 = 命中测试 |
| 时间轴 | `0..DURATION`，拖动即 `iframe.contentWindow.renderFrame(t)`；播放按钮按真实时间推进 |
| 右侧 · 属性 | schema 驱动的 text / color / number / size / enum 控件，改动立即 `__patch` |
| 右侧 · patches | 当前 patch 列表；复制 JSON / 下载 `spec.patches.json` / 清空 |

## 坐标换算

`__inspect(x, y)` 的入参是**画布位图坐标**（1920×1080），不是鼠标 client 坐标。
宿主在 iframe 的 document 上监听点击，用 canvas 自己的 `getBoundingClientRect()` 换算：

```js
const r = cv.getBoundingClientRect();
const x = (ev.clientX - r.left) * (cv.width / r.width);
const y = (ev.clientY - r.top) * (cv.height / r.height);
```

这样 devicePixelRatio（canvas.width ≠ CSS 宽度时）和 iframe 的 CSS `transform: scale()` 都自动折算，
宿主不需要知道 DPR 是多少。页面内也可以用 `window.__editBridge.clientToCanvas(clientX, clientY)` 做同样的事。

## 契约（与 docs/DECISIONS.md D3 一致）

```js
window.__spec()              // => spec 快照（深拷贝；含 patches）
window.__inspect(x, y)       // => { id, role, rect:[x,y,w,h], props, schema } | null（后注册的在上）
window.__patch(id, props)    // => { id, props, scope, diff }（改 spec.patches → renderFrame(currentT)）
window.__hit                 // 当前帧的命中表数组（实时引用）
window.__editBridge          // clientToCanvas / metrics / exportPatches / clearPatches / stats
```

patch 记录形状：

```js
{ id: 'card.first', scope: 'card', props: { text: '新文案' } }   // 节点 patch
{ id: null,         scope: 'card', props: { color: '#00ff00' } } // scope 级 patch（__patch('card', …)）
```

同 `id + scope` 再 patch 会就地合并 props；页面用 `mergePatches(SPEC.patches, scope, id)` 读生效值。

## 页面接入要点

`templates/big-card.html` / `templates/segment.html` 都是 Canvas 绘制，命中测试**不读 DOM**：

1. `renderFrame` 开头 `bridge.setTime(t); bridge.begin();`
2. 绘制结束后按实际绘制位置注册矩形（big-card 折算 slam 缩放/shake；segment 用 `ctx.getTransform()` 折算 `applyImpact2D`）。
3. 读参数时先 `mergePatches(...)`，再回退到默认值——默认 patches 为空，渲染与接入前逐像素一致。
4. 注册只写数据，不额外画像素。

## 已知限制

- **big-card 版式 2/3 的随机条纹**：`rnd` 是跨帧连续状态（旧模板行为），切换版式/编号后
  条纹图案会跳到新的随机序列；不影响 0/1 版式与文字/颜色 patch。
- **只登记当前可见的主节点**：big-card 的 echo 大字、速度线、网格、闪光、下划线动画本身不可点；
  segment 的星场、柔光、玻璃卡片、色片不可点。它们没有 schema，按契约只读。
- **segment 的倒计时文案**：默认由 `u` 自动计算；一旦 patch `hud.countdown.text` 就固定为该值（可选择清空 patch 恢复）。
- **`card.layout` / `hud.stamp` 这类没有独立可见控件的节点**，命中区是固定的空白/角落矩形（big-card 左上角、右下角水印），
  点击那里才选中。
- **多段/整片时间轴**不在本画布范围内：这里每次只预览一个页面、一个局部时间；段级编排在 plan/compile 层。
- 面板的 color 控件对 `rgba()` 等非 `#rrggbb` 值只做文本透传，色块预览回退到白色。
