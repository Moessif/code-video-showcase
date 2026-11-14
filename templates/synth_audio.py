#!/usr/bin/env python3
"""synth_audio.py — numpy/scipy sound-design toolkit for the code-rendered video.

Everything is synthesized (no samples). This template is a *toolkit + runnable demo*:
`python synth_audio.py --out audio/demo.wav` writes an 8 s 120 BPM demo so you can
verify your environment; extend `build_arrangement()` to the full 61 s timeline.

Reference design (120 BPM, A minor):
  intro 0-8s   : low pad, typing clicks, sub boom at 4.55, kick crescendo, 8th hats,
                 snare roll 6.5-7.95, riser from 5.3, reverse crash at 7.45
  cards        : beat1 kick+tom, beat2 kick+clap+sub+whoosh, reverse crash; music at 6%
  styles       : 6-beat groove + per-style instrument (marimba, epiano, bells, ...)
  ending       : pad + piano/bell, fade out after 60.4
Mix: kick sidechain (55% duck), 2.2 s synthetic reverb, tanh soft clip, normalize -0.6 dBFS.

Frequency restraint (important): metallic accents (FM bells / plucks / bright stabs /
coin FX / high-octave arpeggios) are for 2-3 key moments only. Never use them as a bed,
never one ding per stat/number, never 16th-note high arpeggios. Stats and numeric sections
use low drums (sub + tom + kick + clap). See references/audio-recipes.md section 7.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
BPM = 120
BEAT = 60.0 / BPM          # 0.5 s
BAR = 4 * BEAT             # 2.0 s

# ----------------------------------------------------------------------------- utils
def t_axis(dur: float) -> np.ndarray:
    return np.arange(int(round(dur * SR)), dtype=np.float64) / SR


def place(buf: np.ndarray, x: np.ndarray, start_sec: float, gain: float = 1.0) -> None:
    i = int(round(start_sec * SR))
    if i >= buf.shape[-1]:
        return
    n = min(len(x), buf.shape[-1] - i)
    buf[..., i:i + n] += gain * x[..., :n]


def lowpass(x: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, min(cutoff, SR / 2 - 100) / (SR / 2), btype="low", output="sos")
    return signal.sosfilt(sos, x, axis=-1)


def highpass(x: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, max(cutoff, 20) / (SR / 2), btype="high", output="sos")
    return signal.sosfilt(sos, x, axis=-1)


def bandpass(x: np.ndarray, lo: float, hi: float, order: int = 2) -> np.ndarray:
    sos = signal.butter(order, [lo / (SR / 2), min(hi, SR / 2 - 100) / (SR / 2)], btype="band", output="sos")
    return signal.sosfilt(sos, x, axis=-1)


def adsr(n: int, a: float = 0.005, d: float = 0.08, s: float = 0.6, r: float = 0.12) -> np.ndarray:
    a_n, d_n, r_n = (max(1, int(v * SR)) for v in (a, d, r))
    s_n = max(1, n - a_n - d_n - r_n)
    env = np.concatenate([
        np.linspace(0, 1, a_n, endpoint=False),
        np.linspace(1, s, d_n, endpoint=False),
        np.full(s_n, s),
        np.linspace(s, 0, r_n),
    ])
    return env[:n] if len(env) >= n else np.pad(env, (0, n - len(env)))


def exp_decay(t: np.ndarray, k: float) -> np.ndarray:
    return np.exp(-k * t)


def noise(n: int, seed: int = 7) -> np.ndarray:
    return np.random.default_rng(seed).standard_normal(n)


def note_freq(name: str) -> float:
    """'A3' / 'C#4' / 'Bb2' -> Hz."""
    names = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5,
             "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}
    pitch = names[name[:-1]]
    octave = int(name[-1])
    return 440.0 * (2 ** ((pitch - 9) / 12 + (octave - 4)))


CHORDS = {
    "Am": ["A3", "C4", "E4"], "C": ["C4", "E4", "G4"], "F": ["F3", "A3", "C4"],
    "G": ["G3", "B3", "D4"], "Dm": ["D4", "F4", "A4"], "Em": ["E4", "G4", "B4"],
    "E": ["E4", "G#4", "B4"],  # harmonic-minor V of Am (segment 7 ends on E)
}
CHORD_TABLE = [("Am", "F"), ("C", "G"), ("F", "G"), ("C", "F"), ("Am", "G"), ("Am", "Em"),
               ("Dm", "E"), ("C", "G"), ("Dm", "G"), ("F", "G"), ("Am", "F")]

# ----------------------------------------------------------------------------- instruments
def kick(dur: float = 0.5, f0: float = 52, f1: float = 110, decay: float = 11) -> np.ndarray:
    t = t_axis(dur)
    freq = f0 + f1 * np.exp(-t * 30)
    phase = 2 * np.pi * np.cumsum(freq) / SR
    x = np.sin(phase) * exp_decay(t, decay)
    return np.tanh(x * 1.4)


def snare(dur: float = 0.25, seed: int = 3) -> np.ndarray:
    t = t_axis(dur)
    tone = np.sin(2 * np.pi * 180 * t) * exp_decay(t, 22) * 0.5
    n = noise(len(t), seed) * exp_decay(t, 18) * 0.8
    return highpass(tone + n, 900)


def clap(dur: float = 0.25, seed: int = 11) -> np.ndarray:
    t = t_axis(dur)
    n = noise(len(t), seed)
    out = np.zeros_like(t)
    for delay in (0.0, 0.011, 0.023):
        shifted = np.zeros_like(t)
        i = int(delay * SR)
        shifted[i:] = n[:len(t) - i]
        out += shifted * exp_decay(t, 40)
    return bandpass(out, 900, 5000)


def hat(dur: float = 0.07, seed: int = 5, open_: bool = False) -> np.ndarray:
    t = t_axis(dur if not open_ else 0.35)
    n = noise(len(t), seed)
    return highpass(n * exp_decay(t, 12 if open_ else 55), 7000)


def crash(dur: float = 2.2, seed: int = 21) -> np.ndarray:
    t = t_axis(dur)
    n = noise(len(t), seed)
    return highpass(n * exp_decay(t, 2.5), 4000) * 0.7


def sub_boom(dur: float = 0.9) -> np.ndarray:
    t = t_axis(dur)
    return np.sin(2 * np.pi * 45 * t) * exp_decay(t, 3.2)


def riser(dur: float = 2.0, seed: int = 9) -> np.ndarray:
    t = t_axis(dur)
    n = noise(len(t), seed)
    env = np.linspace(0, 1, len(t)) ** 2
    # sweep the band centre upwards
    out = np.zeros_like(n)
    for i in range(0, len(n), 4096):
        seg = n[i:i + 4096]
        centre = 400 + 6000 * (i / len(n))
        out[i:i + len(seg)] = bandpass(seg, centre * 0.7, centre * 1.4)
    return out * env * 0.5


def reverse_crash(dur: float = 1.2, seed: int = 31) -> np.ndarray:
    return crash(dur, seed)[::-1]


def whoosh(dur: float = 0.5, seed: int = 41) -> np.ndarray:
    t = t_axis(dur)
    n = noise(len(t), seed)
    out = np.zeros_like(n)
    for i in range(0, len(n), 1024):
        seg = n[i:i + 1024]
        k = i / len(n)
        out[i:i + len(seg)] = lowpass(highpass(seg, 300 + 3000 * k), 1200 + 6000 * k)
    env = np.sin(np.linspace(0, np.pi, len(t))) ** 2
    return out * env * 0.45


def pluck(freq: float, dur: float = 0.8, harmonics: int = 8, decay: float = 5) -> np.ndarray:
    t = t_axis(dur)
    x = np.zeros_like(t)
    for n in range(1, harmonics + 1):
        x += (1.0 / n) * np.sin(2 * np.pi * freq * n * t) * exp_decay(t, decay * (0.4 + 0.35 * n))
    return x * 0.5


def epiano(freq: float, dur: float = 0.6, index: float = 1.6, ratio: float = 2.0) -> np.ndarray:
    t = t_axis(dur)
    mod = np.sin(2 * np.pi * freq * ratio * t) * index * exp_decay(t, 3.5)
    return np.sin(2 * np.pi * freq * t + mod) * adsr(len(t), 0.003, 0.2, 0.35, 0.2)


def bell(freq: float, dur: float = 1.4, ratio: float = 2.76) -> np.ndarray:
    t = t_axis(dur)
    mod = np.sin(2 * np.pi * freq * ratio * t) * 2.0 * exp_decay(t, 2.0)
    return np.sin(2 * np.pi * freq * t + mod) * exp_decay(t, 1.6)


def supersaw(freq: float, dur: float = 0.5, voices: int = 5, detune: float = 0.12) -> np.ndarray:
    t = t_axis(dur)
    x = np.zeros_like(t)
    for v in range(voices):
        f = freq * (1 + detune * (v - (voices - 1) / 2))
        saw = 2 * ((f * t) % 1.0) - 1
        x += saw
    return lowpass(x / voices, 4500) * adsr(len(t), 0.01, 0.1, 0.8, 0.15)


def square_lead(freq: float, dur: float = 0.2) -> np.ndarray:
    t = t_axis(dur)
    return np.sign(np.sin(2 * np.pi * freq * t)) * exp_decay(t, 8) * 0.3


def triangle_lead(freq: float, dur: float = 0.2) -> np.ndarray:
    t = t_axis(dur)
    return (2 / np.pi) * np.arcsin(np.sin(2 * np.pi * freq * t)) * exp_decay(t, 6) * 0.4


def eight08(freq: float, dur: float = 0.9) -> np.ndarray:
    t = t_axis(dur)
    x = np.sin(2 * np.pi * freq * t) * exp_decay(t, 2.5)
    return np.tanh(x * 2.2) * 0.6


def flute(freq: float, dur: float = 0.8) -> np.ndarray:
    t = t_axis(dur)
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5 * t)
    x = np.sin(2 * np.pi * freq * vib * t) + 0.18 * np.sin(2 * np.pi * 3 * freq * t)
    breath = bandpass(noise(len(t), 13), 1200, 3200) * 0.08
    return (x * 0.5 + breath) * adsr(len(t), 0.03, 0.1, 0.7, 0.2)


# ----------------------------------------------------------------------------- mix utilities
def make_ir(dur: float = 2.2, seed: int = 77) -> np.ndarray:
    t = t_axis(dur)
    n = len(t)
    rng = np.random.default_rng(seed)
    ir = np.zeros((2, n))
    for ch in range(2):
        ir[ch] = rng.standard_normal(n) * exp_decay(t, 3.2)
        ir[ch] = lowpass(ir[ch], 9000)
    ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True))
    return ir


def reverb_stereo(x: np.ndarray, ir: np.ndarray, wet: float = 0.22) -> np.ndarray:
    """x: mono (n,) -> stereo (2,n)."""
    if x.ndim == 2:
        x = x.mean(axis=0)
    out = np.vstack([
        signal.fftconvolve(x, ir[ch])[:len(x)] for ch in range(2)
    ])
    dry = np.vstack([x, x])
    return dry * (1 - wet) + out * wet


def kick_sidechain(n: int, kicks: list[float], depth: float = 0.55) -> np.ndarray:
    """Kick 侧链：压 music 总线。

    v2.5.1：释放从 120 ms 指数改成 320 ms 余弦——原曲线在 kick 后 ~0.12 s
    会形成一个「能量回升」的假 onset，qa 的 beat grid 把它当成拍点之外的音头，
    命中率被拖到 60%。余弦包络的导数是连续的，回升是斜坡不是音头。
    """
    env = np.ones(n)
    a = int(0.005 * SR)
    r = int(0.32 * SR)
    span = max(1, a + r)
    # 余弦下降沿：1 → 0，两端斜率为 0（无拐点 = 无 flux 峰）
    shape = 0.5 * (1 + np.cos(np.linspace(0, np.pi, span)))
    for k in kicks:
        i = int(round(k * SR))
        if i >= n:
            continue
        seg = shape[:min(n - i, span)]
        env[i:i + len(seg)] *= 1 - depth * seg
    return env


def _k_weight(x: np.ndarray, sr: int) -> np.ndarray:
    """ITU-R BS.1770-4 K-weighting（高频架 + 高通），用于 LUFS 测量。"""
    from scipy import signal
    if sr == 48000:
        b1 = [1.53512485958697, -2.69169618940638, 1.19839281085285]
        a1 = [1.0, -1.69065929318241, 0.73248077421585]
        b2 = [1.0, -2.0, 1.0]
        a2 = [1.0, -1.99004745483398, 0.99007225036621]
    else:
        # 非 48k：用双线性变换从模拟原型近似（架 +4dB@1681Hz，高通 38Hz）。
        import math
        f0 = 1681.0; G = 4.0; Q = 0.707
        A = 10 ** (G / 40); w0 = 2 * math.pi * f0 / sr
        cw = math.cos(w0); sw = math.sin(w0); alpha = sw / (2 * Q)
        b0 = A * ((A + 1) + (A - 1) * cw + 2 * math.sqrt(A) * alpha)
        b1c = -2 * A * ((A - 1) + (A + 1) * cw)
        b2c = A * ((A + 1) + (A - 1) * cw - 2 * math.sqrt(A) * alpha)
        a0 = (A + 1) - (A - 1) * cw + 2 * math.sqrt(A) * alpha
        a1c = 2 * ((A - 1) - (A + 1) * cw)
        a2c = (A + 1) - (A - 1) * cw - 2 * math.sqrt(A) * alpha
        b1 = [b0 / a0, b1c / a0, b2c / a0]; a1 = [1.0, a1c / a0, a2c / a0]
        wc = 2 * math.pi * 38.0 / sr; c = math.cos(wc); s = math.sin(wc)
        al = s / (2 * 0.5)
        b2 = [1.0, -2.0, 1.0]; a2 = [1 + al, -2 * c, 1 - al]
        a2 = [v / a2[0] for v in a2]
    axis = 1 if (x.ndim == 2 and x.shape[0] <= 2) else 0
    y = signal.lfilter(b1, a1, x, axis=axis)
    return signal.lfilter(b2, a2, y, axis=axis)


def integrated_lufs_synth(x: np.ndarray, sr: int) -> float:
    """K-weighted 积分响度（无门限近似；密集配乐床与门限版差 <0.3 LU）。"""
    y = _k_weight(x, sr)
    if y.ndim == 1:
        return -0.691 + 10 * np.log10(float(np.mean(y ** 2)) + 1e-12)
    time_axis = 1 if y.shape[0] <= 2 else 0
    ms = np.mean(y ** 2, axis=time_axis)
    return -0.691 + 10 * np.log10(float(np.sum(ms)) + 1e-12)


def master(x: np.ndarray, peak_db: float = -1.5, drive: float = 1.1,
           target_lufs: float = -14.0) -> np.ndarray:
    """Master bus: soft-clip → LUFS 闭环归一 → 峰值天花板。

    v2.3.5: 峰值 -0.6→-1.5 dB，留余量给 AAC/loudnorm。
    v2.5.2 R2-27（N07-F7）：旧版只做峰值归一，响度随 BPM/时长漂 2.9 dB
    （8s@90=-10.9、41s@120=-12.5 LUFS），独立 `qa:audio` 量直出 wav 必 WARN。
    现在 BS.1770 闭环迭代到 -14 LUFS，再压峰值天花板——直出即交付级响度，
    与 concat 的 loudnorm 目标一致（后者此时增益≈0）。
    """
    x = np.tanh(x * drive)
    ceiling = 10 ** (peak_db / 20)
    for _ in range(3):
        lufs = integrated_lufs_synth(x, SR)
        x = x * (10 ** ((target_lufs - lufs) / 20))
        peak = np.max(np.abs(x)) or 1.0
        if peak > ceiling:
            x = x / peak * ceiling
    return x


# ----------------------------------------------------------------------------- demo arrangement
def build_arrangement(plan: dict | None = None) -> np.ndarray:
    """8 s demo, or a full-length cue-aligned bed when plan.json is supplied.

    `--plan out/plan.json` reads stats.duration + audio.cues, so every segment
    start / card beat lands on the same time base as the picture. The musical
    material is still the simple demo loop; replace the per-style instruments
    with references/audio-recipes.md for a finished score.
    """
    if plan:
        dur = float(plan["stats"]["duration"])
        bpm = float(plan["audio"]["bpm"])
        beat = 60.0 / bpm
        bar = 4 * beat
        chord_seq = CHORD_TABLE
    else:
        dur = 8.0
        beat, bar = BEAT, BAR
        chord_seq = [("Am", "F"), ("Am", "F")]  # 2 bars of demo
    n = int(round(dur * SR))
    music = np.zeros(n)       # mono bus for pads/keys/lead
    drums = np.zeros(n)       # kick/snare/hat
    fx = np.zeros(n)          # risers / impacts / whooshes

    kicks: list[float] = []

    for beat_i in range(int(dur / beat + 0.5)):
        tb = beat_i * beat
        if tb >= dur:
            break
        # 主拍底鼓（低频能量担当）
        place(drums, kick(), tb, 0.9); kicks.append(tb)
        # 频率克制（audio-recipes §7）：**非关键段把高频压下去**，HF 对比度才有来源。
        # hat 原本 highpass 7000、open hat 更亮——它们是全片 8–16 kHz 的主要来源，
        # 盖住了关键节点的点缀。现在统一 lowpass 到 5.5 kHz（保住「嚓」的质感，
        # 去掉 8 kHz 以上的空气声）；军鼓同样收顶。
        if beat_i % 4 in (1, 3):
            place(drums, lowpass(snare(), 5500), tb, 0.4)
        if beat_i % 4 == 2:
            place(drums, clap(), tb, 0.28)          # clap 自带 bandpass 900–5000，本就克制
        place(drums, lowpass(hat(), 5500), tb, 0.16)
        place(drums, lowpass(hat(open_=True), 5500), tb + beat / 2, 0.08)
        # bass: root every beat（低频承担音乐性，不需要高音琶音铺底）
        bar_idx = int(tb // bar)
        root = note_freq(CHORDS[chord_seq[bar_idx % len(chord_seq)][0]][0]) / 2
        place(music, eight08(root, 0.45), tb, 0.22)
        # v2.5.1 频率克制：删掉「8 分 epiano 高八度琶音铺底」——它是 HF restraint
        # WARN 的主因（非点缀段的 8–16 kHz 能量被琶音抬高）。音乐性交给
        # 低音 + pad + 鼓组；金属点缀只保留下面 3 处关键节点。
        place(music, epiano(root * 2, 0.4), tb, 0.07)  # 低八度和弦根音，贴 pad 同区

    # pad per bar（lowpass 1800，天然低频床）
    for bar_i in range(int(dur / bar + 0.5)):
        first, second = chord_seq[bar_i % len(chord_seq)]
        for chord_name, off in ((first, 0.0), (second, 2 * beat)):
            freqs = [note_freq(x) for x in CHORDS[chord_name]]
            t = t_axis(2 * beat)
            pad = sum(np.sin(2 * np.pi * f * t) for f in freqs) / len(freqs)
            pad = lowpass(pad, 1800) * adsr(len(t), 0.05, 0.2, 0.8, 0.2)
            place(music, pad, bar_i * bar + off, 0.12)

    # impacts / riser
    place(fx, sub_boom(), 0.0, 0.8)
    place(fx, reverse_crash(0.6), beat, 0.5)
    place(fx, whoosh(), 2 * beat, 0.2)
    place(fx, riser(2.0), max(0.0, dur - 2.0), 0.22)

    # v2: land the picture cues on the same grid (segment starts, card keyword,
    # style second beat). This is what makes qa-audio's ±30 ms check meaningful.
    # v2.5.1 频率克制：金属点缀（FM 钟声）只落 3 处关键节点——
    #   ① 片头揭示（第一个 opening cue）② 第一张卡的 keyword ③ 片尾（ending cue）。
    # 其余 cue 用低频鼓点（sub+kick+clap），不用铃音代替鼓点。
    if plan:
        plan_cues = plan.get("audio", {}).get("cues", [])
        # 3 处金属点缀的落点（references/audio-recipes.md §7：标题揭示 / 结尾 impact /
        # 唯一一次 resolve）。bell 基频取根音 ×16（≈3.5kHz+），FM 边带（ratio 2.76）
        # 落进 8–16 kHz——×4 时铃音能量只在 2.4 kHz，HF 窗口根本测不到。
        key_idx = set()
        for i, c in enumerate(plan_cues):
            if c.get("kind") == "opening":
                key_idx.add(i)                      # ① 片头揭示
            elif c.get("kind") == "card-keyword" and "key_card1" not in key_idx:
                key_idx.add(i); key_idx.add("key_card1")  # ② 唯一一次 resolve（第一张卡）
            elif c.get("kind") == "ending":
                key_idx.add(i)                      # ③ 结尾 impact
        bell_budget = 3
        for ci, cue in enumerate(plan_cues):
            tc = float(cue.get("t", -1))
            if not (0 <= tc < dur):
                continue
            kind = cue.get("kind")
            place(fx, sub_boom(), tc, 0.55)
            place(drums, kick(), tc, 0.7); kicks.append(tc)
            # 'start' 从不是真实 cue kind（段首 cue 的 kind 是 opening/card/style/…），
            # 旧写法里它永不命中；clap 实际落在 card-keyword（第二拍重音）。
            if kind == "card-keyword":
                place(drums, clap(), tc, 0.26)
            if kind == "flash":
                # 八连闪：低频 click（短 hat 低通），不用高频爆裂
                place(drums, lowpass(hat(0.05), 2500), tc, 0.35)
            # HF restraint 的正向来源：关键节点（卡片/片头/片尾）给**音调型**
            # 高频点缀。这里刻意不用 crash 噪声：0.4 s 的噪声爆裂自身会产出
            # 3–4 个随机 flux 峰（卡片后 +75/+171 ms 这类），qa 的拍网格把它们
            # 记成拍点外音头。triangle_lead 在 3.5 kHz 起振、谐波铺到 16 kHz，
            # 一个音头、能量足、尾巴干净。
            if kind in ("card", "opening", "ending", "more"):
                chord_name = CHORD_TABLE[ci % len(CHORD_TABLE)][0]
                accent = note_freq(CHORDS[chord_name][0]) * 16
                place(fx, triangle_lead(accent, 0.22), tc, 0.5)
                place(fx, crash(0.3), tc, 0.3)
            if ci in key_idx and bell_budget > 0:
                chord_name = CHORD_TABLE[ci % len(CHORD_TABLE)][0]
                bell_root = note_freq(CHORDS[chord_name][0])
                place(fx, bell(bell_root * 16, 1.2), tc, 0.3)
                bell_budget -= 1

    sc = kick_sidechain(n, kicks, 0.5)
    music *= sc

    mix = drums * 0.9 + music * 0.8 + fx
    # 0.6 s fade at the tail so the film ends on silence, not a cut.
    fade_n = min(n, int(0.6 * SR))
    if fade_n > 1:
        mix[-fade_n:] *= np.linspace(1.0, 0.0, fade_n)
    # v2.5.1：混响收短到 1.4 s、wet 降到 0.14 —— 2.2 s 的噪声 IR 会把关键节点的
    # crash 尾巴拉成一片密集 flux 峰（卡片后每 ~85 ms 一个），qa 的拍网格把它们
    # 当成拍点外音头。干声更贴近卡点片的听感，也更利于自动质检。
    stereo = reverb_stereo(mix, make_ir(1.4), wet=0.14)
    return master(stereo)


def main() -> int:
    ap = argparse.ArgumentParser(description="numpy/scipy synth toolkit")
    ap.add_argument("--out", default=os.path.join("audio", "demo.wav"))
    ap.add_argument("--plan", help="out/plan.json: render the full duration and land every cue on the timeline")
    args = ap.parse_args()
    plan = json.load(open(args.plan, encoding="utf-8")) if args.plan else None
    if plan and "stats" not in plan:
        raise SystemExit(f"{args.plan} is not a timeline plan (missing stats)")
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    audio = build_arrangement(plan)
    wavfile.write(args.out, SR, np.ascontiguousarray(audio.T.astype(np.float32)))
    peak = float(np.max(np.abs(audio)))
    print(f"wrote {args.out}  {audio.shape[1] / SR:.2f}s  {SR} Hz stereo  peak={peak:.3f} ({20*np.log10(peak):.1f} dBFS)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
