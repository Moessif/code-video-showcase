# server/api.mjs — 本地编译 API（C7-03）

零依赖的 HTTP 包装：把 spec 校验、编译队列、成片流式读取做成一个本机服务。
只绑定 `127.0.0.1`，不联网、不需要 `npm install`。

```bash
node server/api.mjs                     # http://127.0.0.1:5190
node server/api.mjs --port 5191
node server/api.mjs --concurrency 2     # 同时编译 2 个 job（默认 1）
```

以 `import` 方式引入时不会自动监听，方便测试复用：

```js
import { createJobServer, startServer } from './server/api.mjs';
const { server, port, url } = await startServer({ port: 0, concurrency: 1 });
await server.shutdown();   // 关闭监听并清理编译子进程
```

## 契约

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/jobs` | body 为 spec v1 JSON（≤ 1MB）。先经 `templates/plan.mjs` 的 `buildPlanFromSpec`（root = 仓库根）校验；非法 → `400 {error, issues[]}`；合法 → `202 {id, status:"queued"}` |
| `GET` | `/jobs/<id>` | `{id, status, exitCode, createdAt, startedAt, finishedAt, stats, logTail, error}` |
| `GET` | `/jobs/<id>/master.mp4` | 成片流式返回，支持 `Range`（`206`）；未完成 → `409` |
| `DELETE` | `/jobs/<id>` | 排队中移除 / 运行中 `taskkill /T /F` 杀掉整棵进程树 → `cancelled` |
| `GET` | `/health` | `{ok:true, queue, running, concurrency, jobs}` |

- `status`：`queued` → `running` → `done` / `failed` / `cancelled`。
- `stats` 从 `out/api/<id>/plan.json` 的 `stats` 读取：`{duration, frames, segments, fps}`。
- `logTail` 是 `out/api/<id>/build.log` 的尾部 16KB。
- 所有响应均为 JSON（mp4 除外）；`OPTIONS` 预检返回 `204`，CORS 允许任意来源（服务本身只绑本机）。
- job id：`j-<UTC 时间戳 yyyymmddhhmmss>-<6 位短哈希>`，白名单 `^[a-z0-9-]{1,128}$`。
  任何非法 id（含 `..`、`%2F` 解码后的斜杠）在路由层直接 `404`，不会拼接文件系统路径。

## 一个 job 的目录

```
out/api/<id>/
  project.spec.json     # API 校验后的归一化 spec（编译的真实输入）
  build.log             # compile.mjs 的 stdout/stderr
  plan.json             # compile 生成的渲染计划（stats 来源）
  segments.txt
  render-manifest.json
  master.mp4            # 完成后可流式读取
  job.json              # 状态持久化（重启后 GET 仍可读）
```

编译命令固定为：

```bash
node scripts/compile.mjs \
  --spec out/api/<id>/project.spec.json \
  --root <repo> \
  --outdir out/api/<id> \
  --no-qa \
  --concurrency 2
```

## curl 示例（Git Bash）

```bash
# 1) 提交 fixtures 里的 41 秒样例
curl -sS -X POST http://127.0.0.1:5190/jobs \
  -H 'Content-Type: application/json' \
  --data-binary @fixtures/mini-41s/spec.json
# => {"id":"j-20261111120000-a1b2c3","status":"queued"}

# 2) 轮询
curl -sS http://127.0.0.1:5190/jobs/j-20261111120000-a1b2c3

# 3) 健康检查
curl -sS http://127.0.0.1:5190/health

# 4) 取消
curl -sS -X DELETE http://127.0.0.1:5190/jobs/j-20261111120000-a1b2c3

# 5) 成片（支持 Range）
curl -sS -o master.mp4 http://127.0.0.1:5190/jobs/j-.../master.mp4
curl -sS -H 'Range: bytes=0-99' -D - -o /dev/null http://127.0.0.1:5190/jobs/j-.../master.mp4
```

## 测试

```bash
node server/test-api.mjs
```

真实渲染一个 4 秒 / 1 轮 / 无 flash 的 spec（120 帧），覆盖：
`/health`、`POST` 202、轮询到 `done`、`stats`、ffprobe 120 帧、
master 200 且 >100KB、Range 206、404、非法 spec 400、路径穿越 404、DELETE 取消。
退出码 0/1；需要系统 `ffmpeg`/`ffprobe` 与 Chrome（`CHROME_EXE` 或默认安装路径）。

## 限制（明确不做）

1. **无鉴权**：任何能访问 `127.0.0.1:5190` 的本机进程都能提交/取消任务；服务拒绝绑定非本机地址。
2. **单机单队列**：job 队列在内存里，进程重启后 `queued/running` 会被标记为 `failed`，不会自动续跑。
3. **不清理磁盘**：job 目录与段缓存一直保留；需要时手动删 `out/api/<id>`。
4. **不做增量调度**：每个 job 独立 `outdir`，因此首次编译都会全量渲染；跨 job 复用缓存不在本切片。
5. **无进度百分比**：只有状态与日志尾部，没有逐段进度事件。
6. **master 只在 `done` 后可读**：`failed/cancelled/queued/running` 均返回 409。
7. **CORS 为 `*`**：交给本机绑定和调用方自律；不要把端口暴露到局域网。
