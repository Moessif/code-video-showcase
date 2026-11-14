# ingest/ — 素材摄取与 EDL（C8-01..03）

把「一堆拍摄素材」变成「一份可审的 EDL + 一份可编译的 spec」的最小闭环。
零 npm 依赖，只用 Node 内置模块 + 系统 `ffmpeg` / `ffprobe`；不联网。

```
素材文件/目录
   │  probe.mjs      ffprobe 元数据 + 目录扫描
   │  scene.mjs      场景切点（select+metadata=print）+ 静音（silencedetect）
   │  asr.mjs        可选：whisper 系词级转写（找不到就如实报告）
   ▼
  EDL（clips: src/in/out/dur/score/reason）
   │  edl.mjs        scoreShots → buildEDL → edlToScript
   ▼
project.spec.json（script 作者模式）+ edl.json
```

| 文件 | 职责 |
|---|---|
| `probe.mjs` | `probe(file)`、`listMedia(dir)`、`collectMedia(path)`、`IngestError` |
| `scene.mjs` | `detectScenes(file, threshold)`、`detectSilence(file, opts)`、`voicedIntervals()` |
| `asr.mjs` | `detectEngines()`、`transcribe(file, opts)`、`parseAsrJson()` |
| `edl.mjs` | `scoreShots()`、`buildEDL()`、`edlToScript()`（纯函数，可单测） |
| `cli.mjs` | 一条命令跑完上面全部并写 `edl.json` / `project.spec.json` |
| `test-edl.mjs` | 合成数据单测（不依赖真实媒体、不联网） |

## 用法

```bash
node ingest/cli.mjs --input <file|dir> --target 60 --out out/ingest
node ingest/cli.mjs --input out/demo.mp4 --target 3 --out out/ingest-demo
node ingest/test-edl.mjs
```

常用参数：

```
--threshold 0.35     场景切分阈值（0..1，越高切点越少）
--noise -35          静音阈值 dB（负数）      --min-dur 0.6  最短静音
--min-shot 1.2       单镜头下限（秒）         --max-shot 6   单镜头上限
--round 4            spec 每轮时长下限         --opening 3 --ending 2.5 --more 1
--theme coral-noir   主题 id                  --name <str>   spec.meta.name
--asr / --no-asr     是否尝试 ASR（默认 auto：PATH 上有引擎就跑）
--model small --lang zh
```

退出码：

| 码 | 含义 |
|---|---|
| 0 | 成功，两个 JSON 都写了 |
| 1 | 运行失败（ffprobe/ffmpeg 失败、EDL 为空、生成的 spec 校验不过） |
| 2 | 用法错误：缺 `--input`、目录里没有媒体、扩展名不支持 |

没有输入文件/目录为空时打印 usage 并退出 2。

## 输出

`<out>/edl.json`

```json
{
  "target": 60, "total": 59.7, "withinTolerance": true, "coverage": 0.995,
  "clips": [{ "src": "...", "in": 3.2, "out": 7.4, "dur": 4.2, "score": 0.78, "reason": "score …" }],
  "sources": [/* probe 结果 */],
  "analysis": { "scenes": [], "silence": [], "asr": [], "shots": 0 },
  "warnings": []
}
```

`<out>/project.spec.json`：`specVersion:1` 的完整 spec，`script` 作者模式
（`opening → [card, scene]×N → more → ending`），可直接喂给
`templates/spec.mjs` 的 `normalizeSpec` / `scripts/spec-lint.mjs`。

`x-edl` 字段保留完整 cut 清单（`edlTotal` / `cutTotal` / `omitted` / `clips`），
方便上游 NLE 或人工复核；它不是 spec schema 的一部分，校验时被忽略。

## 设计要点

**打分**（`scoreShots`，权重可覆盖，总和归一）：

| 分项 | 默认权重 | 说明 |
|---|---|---|
| motion | 0.40 | 清晰度/运动占位。CLI 用「切入该镜头的 scene score」 |
| duration | 0.25 | 越接近 `idealShot`（默认 3s）越高 |
| speech | 0.20 | 与语音区间重合比例；区间可带 `src`，只影响同源镜头 |
| position | 0.15 | `exp(-start/3)`：开头 3 秒权重高（钩子优先） |

**选段**（`buildEDL`）：按分数贪心；每个镜头先裁到 `[minShot, maxShot]`
（超长取中间），同源不重叠，总时长逼近 `target` 且不超过 `target*1.1`；
选完按「来源首次出现顺序 + in」排序。素材不够时如实返回
`withinTolerance:false` 与 `warnings`，不虚报。

**EDL → spec 的关键约束**：spec v1 的轮次是等长的
（`specDuration = opening + N×round + moreCard + flash + ending`，
`deriveFromScript` 用最后一个 `card+scene` 覆盖 `structure.round`）。因此
`edlToScript` 取 `round = max(opts.round, 最长 clip + minCard)`，
并让 `card_i = round - clip_dur_i` 吸收差额：每个 `scene` 块的时长仍精确
等于对应 clip，整份 script 从 0 连续覆盖到 `total`，`validateSpec` 零 error。
完整 cut 清单在 `x-edl`。

**路径**：`src` 统一成正斜杠（Windows 也能直接给 ffmpeg 用），`probe().path`
是绝对路径，便于跨 cwd 复现。

## ASR

`detectEngines()` 在 PATH 上按 `whisper-ctranslate2` → `faster-whisper` →
`whisper` 顺序查找。有引擎时 `transcribe()` 执行：

```
<engine> <file> --model small --language zh --output_format json \
         --output_dir <out>/asr --word_timestamps True
```

返回 `{available:true, json, segments, words, wordLevel}`；没有引擎或执行失败
时返回/抛出明确结果（`available:false` + `reason`，或 `E_ASR_FAILED`），
**不会**返回空转写冒充成功。ASR 不可用时 CLI 用「静音取补集」的有声区间
做 VAD 代理，并在输出里标注。

本机实测：PATH 上没有 whisper 系命令 → `available:false`。

## 测试

```bash
node ingest/test-edl.mjs      # ✓ edl — 21 tests passed
```

覆盖：打分单调性（开头痛点/语音加成）、min/max、同源不重叠、时间排序、
±10% 容差、素材不足如实标记、确定性、src 标签匹配（含 Windows 反斜杠）、
`edlToScript` 连续覆盖与 `normalizeSpec`+`validateSpec` 零 error、页面存在性、
ffmpeg 输出解析器、无引擎时 ASR 不假装成功。

## 边界（不承诺的部分）

- **不切视频、不渲染**：只产出 EDL 与 spec；真正的剪辑/合片由下游完成。
- **真实拍摄素材的选段质量**：打分是启发式（scene score + 时长 + VAD/ASR +
  开头加权），没有语义理解；EDL 是「可审初剪」，需要人工复核。
- **spec v1 等长轮次**：为满足 IR 约束，短镜头的 card 会变长（card 吸收差额）。
  这不影响 clip 记录，但成片节奏会偏「卡片化」。
- `spec.rounds` 上限 24：超出时 `edlToScript` 保留分数最高的 24 个 clip
  （`edl.json` 仍保留全部），并发出 `warnings`。
- 场景切分基于画面变化，光照突变/闪白会误切；静音阈值与录音底噪相关，
  默认 `-35dB / 0.6s` 只是起点。
- ASR 路径未在本机跑通（没有引擎），`transcribe()` 的 CLI 参数按
  whisper 系通用约定实现，未做端到端验证。
