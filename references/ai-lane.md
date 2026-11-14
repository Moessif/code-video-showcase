# 可选 AI lane（默认关闭）

主流程**永远是纯代码**：1830 帧、120 BPM、确定性。AI 只作为可选素材层，用于 B-roll、首尾镜头、插帧、超分、配音；任何缺失/校验失败都回退到纯代码段，且不允许改变帧数与时间网格。

```
ai/lane.json          # enabled=false（默认）
ai/prompts/*.yaml     # 你的生成器读取的 prompt/spec
ai/cache/<sha256>/    # clip.mp4 + meta.json
assets/ai/            # 最终素材（git 忽略）
ai/manifest.json      # 哈希 + ffprobe 元数据
```

```bash
node scripts/ai-lane.mjs init
node scripts/ai-lane.mjs manifest
node scripts/ai-lane.mjs validate --plan out/plan.json
node scripts/ai-lane.mjs overlay --clip assets/ai/broll-r01.mp4 --from 9 --to 11
```

## 1. 模型选型（2025–2026，本地部署）

| 用途 | 模型 | 显存 | License | 备注 |
|---|---|---|---|---|
| 文生视频/B-roll | **Wan 2.2 TI2V-5B** | 24 GB | Apache-2.0 | 720P/5s ≈ 9 min（4090） |
| 首尾帧 | Wan 2.1 FLF2V-14B | 16–80 GB | Apache-2.0 | 2.2 无此任务 |
| 低显存草稿 | Wan 2.1 T2V-1.3B | 8.2 GB | Apache-2.0 | 480P/5s ≈ 4 min |
| 长镜头 | LTX-Video 0.9.8 2B | 8 GB (Q8) | OpenRAIL-M | 704p/30fps，最长 60s |
| 带声 B-roll | LTX-2 | 24 GB+ | LTX-2 社区 | 1024×1536/5s；营收门槛 |
| 中文旁白 | **CosyVoice2-0.5B** | 4–6 GB | Apache-2.0 | CER 1.45% |
| 轻量旁白 | Kokoro-82M | CPU | Apache-2.0 | 实时级 |
| 音乐 | **ACE-Step 1.5** | 8–12 GB | MIT | 唯一能硬控 BPM/调性/时长 |
| 插帧 | RIFE 4.x | 2–4 GB | MIT | 16→30 fps |
| 超分 | Real-ESRGAN | 4–8 GB | BSD-3 | tile 可跑 1080p |
| 去水印/修复 | LaMa | 4–8 GB | Apache-2.0 | 单帧 |

**不能商用**（至少默认不能）：F5-TTS（CC-BY-NC）、ChatTTS（AGPL+NC）、MusicGen/AudioGen/MAGNeT（CC-BY-NC）、SUPIR、ProPainter、GIMM-VFI。IndexTTS2、Fish-Speech-S2 需单独授权。FramePack 代码 Apache 但权重继承腾讯社区许可。

**不可复现**：扩散模型跨 GPU/驱动/批大小不保证逐像素一致；必须固定 seed、steps、分辨率、软件版本，并记录在 `meta.json`。关闭 prompt 扩写/LLM 规划（Wan 的 `--rewrite`、ACE-Step 的 LM planner），否则每次不同。

## 2. 缓存键

```text
sha256(prompt | model | version | seed | steps | width×height | duration | post)
```

`ai-lane.mjs cache-key --spec ai/prompts/broll-02.yaml` 输出该键；同名缓存命中才复用。`manifest.json` 记录每个素材的 sha256 + ffprobe 元数据。

## 3. 合成

叠加（保留原段时间网格）：

```bash
ffmpeg -y -i out/r01-style.mp4 -i assets/ai/broll-r01.mp4 \
  -filter_complex "[1:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[b];[0:v][b]overlay=0:0:enable='between(t,0.5,2.5)'[v]" \
  -map "[v]" -map 0:a? -c:v libx264 -crf 12 -pix_fmt yuv420p \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -c:a copy out/r01-style-ai.mp4
```

整段替换：先统一到 1920×1080/30fps/yuv420p/CRF12，再参与 concat。旁白：

```bash
ffmpeg -i mix.wav -i vo.wav -filter_complex \
  "[1:a]adelay=9000|9000,volume=1.0[vo];[0:a][vo]amix=inputs=2:duration=first:dropout_transition=0[m]" \
  -map "[m]" mix-vo.wav
```

旁白段建议用 `sidechaincompress` 把配乐压低 4–6 dB，再走最终 `loudnorm`。

## 4. 回退规则（硬性）

以下任一条件成立 → 该段走纯代码：

- `lane.enabled === false`
- 缓存缺失或 `meta.json` 的 sha256/时长/fps/尺寸校验失败
- 抽帧全黑/全透明
- 素材时长不足覆盖 `[at, at+duration]`
- `ai-lane.mjs validate` 报错

## 5. 目录与忽略

```
ai/lane.json
ai/prompts/
ai/cache/          # 可重建，.gitignore
assets/ai/         # 成片素材，.gitignore
ai/manifest.json   # 可选提交，便于审计
```

`.gitignore` 建议：

```
ai/cache/
assets/ai/
*.safetensors
*.ckpt
```
