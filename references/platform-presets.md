# 平台交付预设（v2）

`templates/concat-and-encode.sh` 内置预设。**中间片永远 CRF 12–16、同参数**，最终只压一次；平台会二次转码，上传码率比推荐高 20–50% 可减少代际损失。

```bash
# 母版
bash templates/concat-and-encode.sh out/segments.txt audio/mix.wav out/master.mp4 61 30

# B 站
bash templates/concat-and-encode.sh --platform bilibili out/segments.txt audio/mix.wav out/bilibili.mp4

# 抖音竖屏（1080×1920，自动缩放+补边）
bash templates/concat-and-encode.sh --platform douyin out/segments.txt audio/mix.wav out/douyin.mp4

# 指定 CRF / 两遍码率
bash templates/concat-and-encode.sh --platform custom --width 1080 --height 1350 --crf 18 ...
bash templates/concat-and-encode.sh --two-pass --bitrate 8M ...
```

## 预设表

| 平台 | 分辨率 | fps | CRF | maxrate | 音频 | 目标 LUFS | 备注 |
|---|---|---|---|---|---|---|---|
| `master` | 1920×1080 | 30 | 21 | 18M | AAC 320k | −14 | 母版，CRF + slow |
| `youtube` | 1920×1080 | 30 | 22 | 14M | AAC 256k | −14 | faststart |
| `bilibili` | 1920×1080 | 30 | 24 | 10M | AAC 192k | −14 | 高码率上传约 9 Mbps |
| `douyin` | 1080×1920 | 30 | 24 | 10M | AAC 192k | −14 | 竖屏重新排版，勿裁 16:9 |
| `xiaohongshu` | 1080×1440 | 30 | 24 | 8M | AAC 192k | −14 | 3:4 |
| `weixin` | 1080×1260 | 30 | 24 | 8M | AAC 192k | −14 | 6:7 |
| `archive` | 1920×1080 | 30 | 18 | 24M | AAC 320k | −14 | 归档/再剪 |

> CRF 按「胶片颗粒很贵」实测调过：同一段带 grain 的 1080p30，CRF 18≈31 Mbps、20≈21 Mbps、22≈14 Mbps、24≈9 Mbps、26≈5.7 Mbps；CRF24 对 CRF12 中间片的 VMAF 仍有 96.4。`maxrate` 防止颗粒段把体积翻倍。

统一输出：H.264 High、`yuv420p`、`bt709/bt709/bt709/tv`、`+faststart`、AAC 48 kHz 立体声。

## 编码要点

- **CRF 是感知恒定质量**；`-qp` 是固定量化，同质量更差。颗粒重的代码画面交付用 CRF 22–24，母版 21。
- **2-pass 只在平台硬码率/固定体积时用**；同体积下 CRF 通常更省。
- `-tune animation` 会让文字略软；代码/大字卡建议用：
  `-x264-params "aq-mode=3:deblock=-1,-1:psy-rd=1.0,0.15"`（脚本已内置）。
- 10-bit/HDR 对纯代码画面没有收益；交付保持 8-bit。
- 分段必须同 codec/profile/分辨率/fps/pix_fmt/色彩/时间基才能 `-c copy` 拼接；脚本在失败时自动回退到归一化重编。
- `-vsync` 已弃用，统一 `-fps_mode cfr`。

## 响度（EBU R128）

脚本默认做两遍 `loudnorm`：先测 `input_i/input_lra/input_tp/input_thresh`，再带 `measured_*` 应用。

```bash
# 手动测
ffmpeg -i audio/mix.wav -af loudnorm=I=-14:TP=-1.0:LRA=11:print_format=json -f null -
# 手动应用
ffmpeg -i in.mp4 -i audio.wav -af "loudnorm=I=-14:TP=-1.0:LRA=11:measured_I=…:measured_LRA=…:measured_TP=…:measured_thresh=…:offset=…:linear=true" …
```

YouTube/B 站/抖音/小红书/视频号统一 −14 LUFS；true peak ≤ −1.0 dBTP；LRA ≤ 14 LU。

## 拼接失败排查

| 报错 | 原因 | 处理 |
|---|---|---|
| `Non-monotonic DTS` | 分段 fps/时间基不一致 | 统一 `-r 30 -fps_mode cfr` 重编，或走脚本回退 |
| 音画不同步 | 首段 `start_time` 非 0 | `-avoid_negative_ts make_zero`，音频 `aresample=async=1:first_pts=0` |
| 某段黑屏 | 渲染帧不足/超时 | `render-farm --resume` 重渲该段 |
| 颜色偏 | 缺 bt709 标记 | 用 v2 渲染器/编码脚本，不要手写 ffmpeg |

## 分发附加物

```bash
# 雪碧图 + WebVTT（脚本 --sprite）
ffmpeg -i final.mp4 -vf "fps=1/2,scale=320:180,tile=6x6" -frames:v 1 qa/sprite.jpg

# HLS（shaka-packager，可选）
packager in=final.mp4,stream=video,init_segment=hls/v/init.mp4,segment_template='hls/v/$Number$.m4s' \
         in=final.mp4,stream=audio,init_segment=hls/a/init.mp4,segment_template='hls/a/$Number$.m4s' \
         --segment_duration 2 --hls_master_playlist_output hls/master.m3u8 --hls_playlist_type VOD

# 封面嵌入
ffmpeg -i final.mp4 -i cover.jpg -map 0 -map 1 -c copy -disposition:v:1 attached_pic out.mp4
```
