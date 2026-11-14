# app/review — 只读评审页（C7-04）

零依赖静态页：轮询编译 job，播放成片，按时间码留帧级评论。
评论只存在当前浏览器的 `localStorage`，不写服务器。

```bash
node app/review/serve.mjs                 # http://127.0.0.1:5185/app/review/
node app/review/serve.mjs --port 5195
```

评审页默认服务仓库根，所以能直接读取：

- `out/api/<job>/project.spec.json`（Spec 面板）
- `out/api/<job>/master.mp4`（视频通过 API 读取，走 CORS）

## URL 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `job` | 无 | job id，白名单 `^[a-z0-9-]{1,128}$`。没有它时显示空状态，评论不保存 |
| `api` | `http://127.0.0.1:5190` | API 基地址；只接受 `http:` / `https:` |

示例：

```
http://127.0.0.1:5185/app/review/?job=j-20261111120000-a1b2c3
http://127.0.0.1:5185/app/review/?job=j-...&api=http://127.0.0.1:5191
```

## 页面行为

1. 每 2 秒 `GET /jobs/<id>`，显示状态、退出码、起止时间、`stats`、`logTail`。
2. `done` 后自动把 `<video controls>` 指向 `<api>/jobs/<id>/master.mp4`。
3. 启动时读取 `/out/api/<id>/project.spec.json` 并格式化展示。
4. 评论表单：时间码（秒，支持小数）+ 文本。保存到
   `localStorage["cvs.review.<job>"]`，列表按时间升序；点时间码跳转到视频该秒；
   “删除”移除单条；“当前时间”读取视频播放位置。
5. `queued/running` 时持续轮询；`done/failed/cancelled` 后停止；API 不可达时保留重试。
6. 没有 `job` 参数时显示空状态与输入框（可试写，但提交会提示不会保存）。

## 评论数据结构

```json
[
  {
    "id": "6f0c1b1e-…",
    "t": 12.48,
    "text": "这一帧标题压到安全区外了",
    "createdAt": "2026-11-11T12:00:00.000Z"
  }
]
```

## 限制

- 评论是**浏览器本地**的，不跨设备、不跨浏览器、不进入 job 产物；清站点数据即丢失。
- 无鉴权、无多人协作、无评论导入导出；仅适合本机评审。
- 只读播放：不能在页面上 patch spec 或重新编译。
- 帧级定位精度取决于浏览器 `currentTime` 的 seek 粒度，不保证精确到某一帧。
- Spec 面板依赖评审服务器以仓库根为静态根；换 `--root` 后该路径可能 404（不影响视频与评论）。
