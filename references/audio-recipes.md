# 配乐配方（120 BPM · A 小调 · numpy/scipy 纯合成）

> 参考样片实测：120.0 BPM、拍点相位 0.0 s、86.3% 强 onset 落在 ±30 ms 网格内、结尾 60.38 s 起淡出。
> 可运行骨架：`../templates/synth_audio.py`（默认 8 s demo；按本文的全局参数与编排表扩展到 61 s）。全片音轨与剪辑表共用同一组时间常数（见 `SKILL.md` 第 3 节）。

---

## 1. 全局参数

```python
SR = 48000
BPM = 120
BEAT = 60 / BPM          # 0.5 s
BAR = 4 * BEAT           # 2.0 s
DUR = 61.0
A4 = 440.0
```

A 小调音阶：A B C D E F G。和弦进行（每段前 4 拍 / 后 2 拍，共 6 拍）：

| 段 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 前 4 拍 | Am | C | F | C | Am | Am | Dm | C | Dm | F | Am |
| 后 2 拍 | F | G | G | F | G | Em | E | G | G | G | F |

---

## 2. 段落音轨结构

| 时间 | 内容 | 音乐动作 |
|---|---|---|
| 0–8 s | 开场 | 低通铺底长音；每个打出字配键盘咔哒；4.55 s sub boom + 底鼓逐拍渐强；5.3 s 起噪声上扬；5.5 s 起 8 分踩镲；6.5–7.95 s 军鼓滚奏加密；7.45 s 反向镲 |
| 8–52 s | 11 轮 | 每轮：卡 1 s（drop-out，音乐 6%）→ 风格 3 s（6 拍律动 + 专属音色） |
| 52–53 s | 「还有更多?」 | 同卡片 drop-out |
| 53–55 s | 八连闪 | 8×0.25 s：每切一次 kick + 短音效；可从简到繁叠加 |
| 55–61 s | 结尾 | 铺底 + 钢琴/钟声长音；60.4 s 后自然衰减到静音 |

**大字卡（2 拍）**
- 第 1 拍：kick + tom；
- 第 2 拍：kick + clap + sub boom + whoosh；
- 第 2 拍后半：反向镲；
- 其余音乐压到 6%（约 -24 dB），形成 drop-out。

**风格段第 1 帧「啪」**（卡点）：
kick + clap + snare + crash + sub boom + 高频爆裂（短 noise burst），6 层同时，峰值最高。

**每风格专属乐器**

| 风格 | 音色 | 备注 |
|---|---|---|
| 01 科普 | 马林巴 | 每拍和弦音，第 3 拍高八度 |
| 02 数学 | FM 电钢琶音 + 铺底 | 1/8 音符琶音 |
| 03 发布会 | 逐拍重低音 + 轰鸣 + 钟声 | 戒指出现时轰鸣 |
| 04 白板 | 尤克里里扫弦 + 笔摩擦 | 扫弦每拍，噪声带通 2–4k |
| 05 赛博 | 失真锯齿 16 分 + 四拍底鼓 + 故障音 | 侧链明显 |
| 06 国风 | 古筝五声 + 太鼓 + 笛 + 盖章 | 盖章闷响在红圈时 |
| 07 数据 | 方波琶音 + 滴答 | 年份跳变配 click |
| 08 像素 | 芯片音乐（方波/三角波 + 噪声） | 跳跃/金币音效 |
| 09 编程 | lo-fi 电钢 + 黑胶噪声 + 键盘声 | 键盘与逐字同步 |
| 10 3D | 钟声琶音 + boing | 小球弹跳 |
| 11 竖屏 | 808 + 超级锯齿 + trap 镲 + pop | 文本弹出配 pop |

> 表中的钟 / 拨弦 / 滴答 / coin 类高频音色按第 7 节处理：只做点状点缀，不铺底、不连奏、不每个数字都响一次。

---

## 3. 音色合成公式

> 统一用 numpy，`t = np.arange(int(dur*SR))/SR`。

**Kick（正弦扫频）**
```python
f = 50 + 150*np.exp(-t*30)
phase = 2*np.pi*np.cumsum(f)/SR
x = np.sin(phase) * np.exp(-t*8)
```

**Snare**：`noise * exp(-t*18)` 混 180 Hz 三角波 body；**Clap**：3 次错位 10 ms 的噪声爆发；
**Hat**：高通噪声，`exp(-t*60)`，可 1/8 或 1/16；**Crash**：长噪声 `exp(-t*2.5)` 带高频 shelf；
**Sub boom**：`sin(2π*45*t)*exp(-t*3)`；**Riser**：噪声 × 线性/指数音量 + 带通中心上扫；
**Reverse crash**：把 crash 波形反转；**Whoosh**：噪声 + 快速移动的带通（交叉淡化两段滤波）；

**拨弦（谐波衰减）**：`Σ (1/n) sin(2π f n t) exp(-t*(4+2n))`，n=1..8；
**FM 电钢**：`sin(2π f t + I*sin(2π f*2 t))`，`I` 用 `exp(-t*3)` 包络；
**FM 钟声**：载波 + 非整数比调制（如 1:2.76），长衰减；
**超级锯齿**：5–7 个失谐 ±10 cent 的锯齿波叠加，解调后再低通；
**808**：正弦 + 轻微失真 + 长衰减（0.6–1.2 s）；
**方波/三角波**：`np.sign(sin)` / `2/π*arcsin(sin)`，用于芯片音乐；
**笛子**：正弦 + 少量 3 次谐波 + 气声噪声（带通 1–3 kHz）+ 慢 vibrato。

**合成混响（2.2 s）**：生成指数衰减的立体声噪声 IR（左右去相关），`scipy.signal.fftconvolve`；或用 Schroeder 延迟网络（4 个 comb + 2 个 allpass）省内存。

---

## 4. 编排与混音链

```
各乐器分轨 -> 音量/声像 -> 侧链(由 kick 包络) -> 混响 send -> 总线
总线: 高通 30Hz -> 轻微 EQ -> tanh 软削波 -> 归一化到 -0.6 dBFS -> 写 WAV
```

**侧链**：`duck = 1 - 0.55 * envelope(kick)`，envelope 用 5 ms attack / 120 ms release 的包络跟随，作用于音乐总线（不是鼓组）。
**混响**：music send 约 -14 dB，drums 少给；结尾铺底多给。
**电平建议**：kick -6 dB、snare -8、hat -18、bass -10、chords -14、lead -12、fx -16；最终峰值 -0.6 dBFS。
**导出**：float32 WAV 48 kHz stereo；FFmpeg 里编码 AAC 192 kbps。

---

## 5. 卡点对齐的工程做法

1. 所有事件时间从同一份 `CLIP` 表生成：
   `beat_time = start + beat * 0.5`；帧号 = `round(time*30)`；
2. 卡片 drop-out 用同一 `start`；
3. 风格段第一帧的「啪」样本放在 `(9+4k)*SR` 精确位置；
4. 生成后用脚本核对：能量包络自相关应锁定 120 BPM，相位 0；强 onset 与网格误差中位数 < 5 ms；
5. 频谱图核查：每个 `8+4k`（卡）与 `9+4k`（风格）都应有明显瞬态；结尾 60.4–61.0 s 应接近静音。

**Python 自检片段**
```python
# 已经对齐的工程：把 kick 起点直接写成样本索引，避免浮点累积误差
sample_at = lambda sec: int(round(sec * SR))
for ev in events:
    idx = sample_at(ev['t'])
    place(track, ev['wave'], idx)
```

---

## 6. 参考实测数据（用于对照）

```json
{
 "tempo": {"bpm_autocorr": 120.0, "phase_s": 0.0},
 "onset_alignment": {"n_peaks": 102, "median_err_ms": 0.0, "within_30ms": 86.3},
 "card_hit_ratio": "8–9× (8/12/16/...s)",
 "style_hit_ratio": "2.8–3.5× (9/13/17/...s)",
 "quiet": "0–0.56 s, 60.38–61.0 s"
}
```

做新片时若这些数值相差太大（如 onset 中位误差 > 30 ms、卡片没有 drop-out），先修时间常量再继续混音。

---

## 7. 频率克制：铃音只在关键位置「点缀」

> 真实片例的教训：一版 24 s 发布片在统计段五个拍点、用法段、尾段都铺了 FM 铃 / 拨弦 / 高八度琶音，被评价为「太吵、叮叮叮」。
> 重混后：高频 8–16 kHz 在蒙太奇段降了 6.9 dB、瞬态密度降 44%，全片铃音从 25 处减到 3 处；关键节点（2.5 s 标题揭示、18.5 s 结尾 impact）保留原样，听感明显更高级。

**什么算「叮」**：FM 钟声、拨弦、玻璃/钟、coin/chip 音效、亮 saw/方波 stab、高八度琶音、短促高音 click —— 都是 4–16 kHz 的金属/瞬态点缀。

**分配规则**
1. 全片金属/铃音点缀 **≤ 3 处**，只放在「信息节点」：标题揭示、结尾 impact、唯一一次 resolve。
2. 统计 / 数字 / 计数段落用 **低频鼓点**（sub stab + tom + kick + clap），不要用铃音或琶音代替鼓点。
3. 有 drop-out 的段落（大字卡等）不叠铃音，保留干净留白。
4. 铃音之间至少留 **1 拍空白**；不允许连续两拍以上仍有金属泛音在响。
5. 风格专属音色里的钟/拨弦（如三维段的钟声琶音）也要稀疏化：点状、单音、不铺底、不连奏。

**删掉高频层后怎么补能量（避免变空）**
- pad 电平 +3~4 dB，每个和弦下加持续 sub bed；
- 切点补低 tom，用低 tom/低音下行线替代原来的铃音下行线；
- 不要用「更多铃音」补偿，用低频与中频。

**可量化自检**
- 铃音计数：全片金属点缀 ≤ 3 处（脚本里给每处点赞打 label，渲染后 grep 检查）；
- 8–16 kHz 段能量：非点缀段应比关键点缀段低 **≥ 6 dB**（示例中蒙太奇 −6.9 dB、用法段 −2.1 dB、统计段 −2.0 dB、尾段 −12.0 dB）；
- 高频瞬态密度：100 ms 窗口内的 HF 谱通量峰，普通段 **< 2 /s**（示例 3.2 → 1.8 /s）；
- 频谱图：非点缀段不应出现连续的亮高频竖条或水平泛音线；统计段只应是低频鼓点竖条；
- 听感测试：把 <200 Hz 全部切掉后听一遍——如果只剩「叮叮叮」，就是高频点缀过量。

**检测片段（numpy/scipy，读回 WAV）**
```python
import numpy as np
from scipy.io import wavfile
from scipy import signal

sr, x = wavfile.read('audio/final.wav')
x = x.astype(np.float32) / 32768.0
if x.ndim == 2:
    x = x.mean(axis=1)

b, a = signal.butter(4, [8000 / (sr / 2), 16000 / (sr / 2)], btype='band')
hf = signal.lfilter(b, a, x)

def hf_db(t0, t1):
    seg = hf[int(t0 * sr):int(t1 * sr)]
    return 20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-12)

for name, (t0, t1) in {
    'montage 7-12': (7, 12), 'howto 12-16': (12, 16),
    'stats 16-18': (16, 18), 'impact 18.5': (18.4, 18.7),
}.items():
    print(name, round(hf_db(t0, t1), 1), 'dBFS')
# 目标：stats / montage / howto 比 impact 低 6 dB 以上
```

