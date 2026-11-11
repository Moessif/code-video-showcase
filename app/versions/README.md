# app/versions — 版本树与并排 diff（C2-07）

每次「保存当前 spec」把一份快照写进 `localStorage`；勾选两个版本即可左右并排看差异，
随时把任一版本恢复回编辑缓冲区并下载。

## 启动

```bash
node app/versions/serve.mjs        # http://127.0.0.1:5184/app/versions/
node app/versions/serve.mjs --port 5194
```

静态服务复用 `app/script/serve.mjs` 的 `startStaticServer()`（同一份 MIME 表与路径穿越防护）。
必须经服务器访问，页面会 `fetch('/fixtures/mini-41s/spec.json')` 作为初始缓冲区。

## 数据

| key | 内容 |
|---|---|
| `cvs.versions.v1` | `[{ id, name, ts, hash, duration, spec }]`，新→旧，最多 200 条 |
| `cvs.versions.current` | 当前编辑缓冲区（一个完整 spec） |

- 保存时按 `specHash(spec)` 去重：内容相同的版本只更新时间/名称，不新增条目。
- 快照写入前做深拷贝，恢复/外部修改不会污染已保存版本。
- 存储损坏（非 JSON / 非数组）时降级为空列表，页面照常可用。

## 页面

- **当前编辑缓冲区**：可直接改 JSON →「应用 JSON」；「保存当前 spec」会先解析缓冲区再入版本树。
- **版本列表**：时间、名称、hash、总时长；每条可「恢复」「删除」。
- **并排 diff**：勾选两个版本，按时间排序（左旧右新），用 `model.mjs` 的 `diffSpecs()` 生成 unified diff，
  页面把 `-`/`+` 配对成左右两列；内容相同会提示无差异。
- **空状态**：没有版本时给出「保存当前 spec / 导入 .json / 载入示例 spec」三个入口。
- **导入**：`<input type="file" accept=".json">`，读入后成为当前缓冲区。
- **恢复**：把快照深拷贝回缓冲区并写入 `cvs.versions.current`，用「下载当前」导出。

## 已知限制

- 只存在浏览器 `localStorage`：换浏览器/清缓存即丢失；跨机同步不在本切片范围（C2-07 后续可接服务端）。
- 单 key 上限约 5MB；spec 通常 < 100KB，200 条上限内安全。配额写失败会抛错，页面 toast 提示。
- diff 是行级（按段一行 + 5 行元信息），不是字符级；同一行内改一个字也显示为整行替换。
- 「恢复」不自动下载，需再点「下载当前」——避免误覆盖本地文件。

## 测试

```bash
node scripts/test-script.mjs
```

版本存储用注入的内存 storage 测试，不依赖浏览器。
