# QA gate（v2）

两道闸：**视频** `scripts/qa-video.mjs`，**音频** `scripts/qa-audio.py`。都输出 JSON，可直接进 CI。

```bash
node scripts/qa-video.mjs out/final.mp4 --plan out/plan.json
node scripts/qa-video.mjs out/final.mp4 --plan out/plan.json --ref out/master.mp4 --min-vmaf 95
python scripts/qa-audio.py audio/mix.wav --plan out/plan.json --strict
```

## 1. 视频检查

| 检查 | 工具 | 通过条件 | 失败级别 |
|---|---|---|---|
| codec | ffprobe | h264 | WARN（允许 h265/av1 时手改） |
| pix_fmt | ffprobe | yuv420p | FAIL |
| 尺寸 | ffprobe | 与 plan 的 `meta.width/height` 一致 | FAIL |
| fps | ffprobe | `30/1`（或 plan 值） | WARN |
| 帧数 | `-count_frames` | 等于 `plan.stats.frames` | FAIL |
| 色彩标记 | ffprobe | `bt709/bt709/bt709/tv` | WARN |
| 时长 | ffprobe | 与 plan 差 ≤ 1 帧 | WARN |
| 音频 | ffprobe | AAC 48 kHz 2ch | WARN |
| 黑帧 | `blackdetect=d=0.10:pic_th=0.98:pix_th=0.10` | 总黑 ≤ max(0.5 s, 1%) | WARN |
| 冻结帧 | `freezedetect=n=0.001:d=1.0` | 卡片/闪白窗口之外无 >1 s 静止 | WARN |
| 静音 | `silencedetect=noise=-45dB:d=1.0` | 片中无 >1 s 静音 | WARN |
| 响度 | `loudnorm … print_format=json` | −14 ±1 LUFS；TP ≤ −1.0；LRA ≤ 14 | WARN |
| VMAF | `libvmaf`（可选） | mean ≥ 95，min ≥ 90 | FAIL |
| 联系表 | ffmpeg tile | `qa/contact.jpg` 生成 | WARN |

`--strict` 把所有 WARN 升级为 exit 1。默认只在 FAIL 时 exit 1。

VMAF 的参考片必须是 **CRF 12/无损中间片**，不要拿平台成品互比；否则分数没有意义。

## 2. 音频检查

| 检查 | 方法 | 通过条件 |
|---|---|---|
| 峰值 | 样本最大值 | ≤ −1 dBFS（WARN） |
| 削波 | `abs(x) ≥ 0.999` | 0 samples（FAIL） |
| 整体响度 | BS.1770 K-weighting + gating | −14 ±1 LUFS（WARN） |
| 速度 | 谱通量包络自相关 | 与 plan BPM 差 ≤ 2（WARN） |
| 拍网格 | 相位搜索（1/1、1/2、1/4 细分取最优）+ ±30 ms | ≥70% onset 命中网格（WARN） |
| cue 对齐 | plan.audio.cues 最近 onset | 有 onset 覆盖的 cue 中 ≥80% 在 ±30 ms，且覆盖率 ≥20%（FAIL） |
| 静音 | 50 ms 窗 RMS < −45 dB | 无 ≥1 s 段（WARN） |
| 高频克制 | 8–16 kHz 能量 | 关键窗口比其余高 ≥6 dB（WARN） |

`qa-audio.py` 只需要 numpy/scipy；matplotlib 存在时额外输出 `qa/spectrogram.png`。

## 3. 报告结构

`qa/qa-video.json`：

```json
{
  "expect": { "width": 1920, "height": 1080, "fps": 30, "frames": 1830 },
  "metrics": { "frames": 1830, "codec": "h264", "pix_fmt": "yuv420p", "color": {}, "black": {}, "freeze": {}, "silence": {}, "loudness": {}, "vmaf": {} },
  "checks": [ { "name": "frames", "status": "PASS", "detail": "1830 (expected 1830)" } ],
  "summary": { "pass": 14, "warn": 0, "fail": 0 }
}
```

`qa/qa-audio.json`：`detectedBpm / beatOffset / gridHitRate / peakDbfs / integratedLufs / hf / cues[] / checks[] / summary`。

## 4. CI smoke

`.github/workflows/render-smoke.yml` 只渲染 2 s：

1. Playwright 容器 + ffmpeg 静态包
2. `node templates/render-segment.mjs --page templates/segment.html --duration 2`
3. 正弦波 2 s → `concat-and-encode.sh`
4. `qa-video.mjs --min-vmaf 93`（参考就是该段本身，主要验证管线）
5. 上传 `out/smoke/`、`qa/` artifact

全片 61 s 走自托管 runner（`[self-hosted, windows, render]`），CI 不跑全片。

## 5. 常见失败

| 失败 | 原因 | 修复 |
|---|---|---|
| 帧数少 1–2 | 最后一段 `duration` 不是 `frames/fps` | 用 plan 的 `duration`，不要手写 |
| 黑帧告警 | 风格段本身是黑底 | 检查是否超过 1% 总时长；必要时把该段加入白名单 |
| 冻结告警 | 静态大字卡 | plan 已白名单 `card/flash/more`；自定义静态段需改 `staticWindows` |
| 响度不够 | 合成时没归一化 | 用 `concat-and-encode.sh` 的 loudnorm，或在 synth 末尾归一化 |
| VMAF 低 | 参考片是平台压缩版 | 换 CRF12 中间片做参考 |
| cue 对齐低 | 音频与剪辑表不是同一组时间常数 | 让 `synth_audio.py` 直接读 `plan.json` 的 cues |
