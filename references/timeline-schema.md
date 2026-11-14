# Timeline schema（v2）

`timeline.json` 是整支片的**唯一真源**：结构、时长、帧边界、每段页面参数、输出路径、音频 cue 全部由它派生。渲染、并行调度、音频对齐、质检都读同一份 `out/plan.json`，不再各自重算 `8 + N×4 + 1 + 2 + 6`。

```bash
node templates/timeline.mjs --spec timeline.json \
     --out out/plan.json --concat out/segments.txt --print
node templates/timeline.mjs --spec timeline.json --check   # CI 只校验
```

## 1. 最小示例

```json
{
  "version": 1,
  "meta": {
    "title": "brand launch",
    "brand": "ACME",
    "theme": "cyber-neon",
    "bpm": 120,
    "fps": 30,
    "width": 1920,
    "height": 1080,
    "outDir": "out"
  },
  "structure": {
    "opening": 8,
    "round": 4,
    "card": 1,
    "ending": 6,
    "moreCard": 1,
    "flash": { "count": 8, "each": 0.25 }
  },
  "opening": { "page": "segments/00-opening.html" },
  "rounds": [
    {
      "id": "r01",
      "name": "扁平插画科普",
      "card": { "layout": 0, "first": "想做", "keyword": "科普视频？", "color": "#ffcf5c" },
      "style": { "page": "segments/01.html", "t0": 0.35, "speed": 1.4 }
    }
  ],
  "moreCard": { "page": "segments/big-card.html", "first": "还有", "keyword": "更多？" },
  "flash": { "page": "segments/flash.html" },
  "ending": { "page": "segments/99-ending.html" }
}
```

完整 61 s / 11 轮示例：`templates/timeline.example.json`。

## 2. 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `meta.bpm` | 否 | 默认 120；只影响 cue 与音频对齐，不改画面 |
| `meta.fps` | 否 | 默认 30；帧边界会按它吸附 |
| `meta.width/height` | 否 | 默认 1920×1080；渲染视口与 QA 期望值 |
| `meta.theme` | 否 | 追加到每段页面 URL；空 = 老版默认 |
| `meta.brand` | 否 | 写进大字卡 `?brand=` |
| `meta.outDir` | 否 | 默认 `out`；可被 `--outdir` 覆盖 |
| `structure.round` | 否 | 每轮总时长，默认 4 |
| `structure.card` | 否 | 每轮大字卡时长，默认 1；style = round − card |
| `structure.flash` | 否 | `count` × `each`，默认 8 × 0.25 |
| `rounds[].style.page` | **是** | 风格段页面（相对项目根） |
| `rounds[].style.t0/speed` | 否 | 传给渲染器的场景偏移/速度 |
| `rounds[].card.*` | 否 | 传给 `big-card.html` 的版式/文案/强调色 |
| `moreCard` / `flash` / `ending` | 否 | 各自页面与参数 |

## 3. 帧边界与 0.25 s 陷阱

`buildPlan()` 先把每段的名义时长累加，再按 `round(t × fps)` 吸附到整数帧：

```text
startFrame_i = round(cumulativeTime_i × fps)
frames_i     = endFrame_i − startFrame_i
duration_i   = frames_i / fps
```

所以 30 fps 下 8 × 0.25 s 会变成 **8/7/8/7/8/7/8/7 帧**，合计仍是 60 帧（2.000 s），不会因为每段 `round(0.25×30)=8` 而多出 4 帧。全片帧数 = `plan.stats.frames`，最后一段强制对齐到总帧数。

## 4. 生成的 plan

```json
{
  "meta": { "root": "…", "fps": 30, "width": 1920, "height": 1080, "outDir": "out" },
  "stats": { "duration": 61, "frames": 1830, "segments": 33, "beats": 122, "bars": 30.5 },
  "audio": { "bpm": 120, "beat": 0.5, "bar": 2, "cues": [ { "t": 8, "frame": 240, "beat": 16, "kind": "start", "id": "r01-card" } ] },
  "segments": [
    {
      "id": "r01-style", "kind": "style", "start": 9, "end": 12,
      "startFrame": 270, "endFrame": 360, "frames": 90, "duration": 3,
      "page": "segments/01.html?theme=coral-noir",
      "out": "out/r01-style.mp4",
      "t0": 0.35, "speed": 1.4,
      "renderArgs": ["--page", "…", "--out", "…", "--duration", "3", "--fps", "30", "--t0", "0.35", "--speed", "1.4"]
    }
  ]
}
```

`kind` 取值：`opening | card | style | more | flash | ending`。`segments.txt` 是 ffmpeg concat demuxer 列表（绝对路径，Windows 反斜杠已转 `/`）。

## 5. 并行渲染

```bash
node templates/render-farm.mjs --plan out/plan.json --concurrency 4 --resume
node templates/render-farm.mjs --plan out/plan.json --kinds style --retries 2
node templates/render-farm.mjs --plan out/plan.json --only r01-style,r01-card
node templates/render-farm.mjs --plan out/plan.json --shard 0/3
```

- 每个 segment 一个进程、一个浏览器实例；默认并发 `min(4, cpus−1)`。
- `--resume` 用 `ffprobe -count_frames` 对比 `frames`，已完成直接跳过。
- 失败重试 `--retries`（默认 2，退避 0.5 s × 次数），结果写入 `out/render-manifest.json`。
- 帧数不符视为失败，不会把坏段混进成片。

## 6. 质检联动

`qa-video.mjs --plan out/plan.json` 读取尺寸/fps/帧数期望，并把 `card`/`flash`/`more` 的时间窗作为冻结帧白名单；`qa-audio.py --plan out/plan.json` 读取 `audio.cues` 做 ±30 ms 对齐评分。

## 7. 常见错误

| 现象 | 原因 | 修复 |
|---|---|---|
| `structure.card must be smaller than structure.round` | 卡比整轮长 | 调小 `card` 或调大 `round` |
| 帧数 1834 而不是 1830 | 手写每段 `round(d)` | 用 plan 的 `duration`，不要自己算 |
| 某段渲染 404 | `page` 相对路径错 | 路径相对 `meta.root`/项目根 |
| 主题没生效 | `meta.theme` 为空 | 填主题 id，或页面自己带 `?theme=` |
| 音频 cue 对不上 | 改了结构没重跑 plan | 重新 `timeline.mjs` 后再合成/QA |
