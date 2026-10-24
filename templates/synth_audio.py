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
"""
from __future__ import annotations

import argparse
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
def kick(dur: float = 0.5, f0: float = 50, f1: float = 200, decay: float = 8) -> np.ndarray:
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
    env = np.ones(n)
    a = int(0.005 * SR)
    r = int(0.12 * SR)
    for k in kicks:
        i = int(round(k * SR))
        if i >= n:
            continue
        seg = np.exp(-np.arange(min(n - i, a + r)) / (0.05 * SR))
        env[i:i + len(seg)] *= 1 - depth * seg
    return env


def master(x: np.ndarray, peak_db: float = -0.6, drive: float = 1.1) -> np.ndarray:
    x = np.tanh(x * drive)
    peak = np.max(np.abs(x)) or 1.0
    target = 10 ** (peak_db / 20)
    return x / peak * target


# ----------------------------------------------------------------------------- demo arrangement
def build_arrangement() -> np.ndarray:
    """8 s demo. Replace with the full 61 s timeline (see references/audio-recipes.md)."""
    dur = 8.0
    n = int(dur * SR)
    music = np.zeros(n)       # mono bus for pads/keys/lead
    drums = np.zeros(n)       # kick/snare/hat
    fx = np.zeros(n)          # risers / impacts / whooshes

    chord_seq = [("Am", "F"), ("Am", "F")]  # 2 bars of demo
    kicks: list[float] = []
    for beat_i in range(int(dur / BEAT)):
        tb = beat_i * BEAT
        # drums
        place(drums, kick(), tb, 0.9); kicks.append(tb)
        if beat_i % 4 in (1, 3):
            place(drums, snare(), tb, 0.4)
        if beat_i % 4 == 2:
            place(drums, clap(), tb, 0.28)
        place(drums, hat(), tb, 0.18)
        place(drums, hat(open_=True), tb + BEAT / 2, 0.10)
        # bass: root every beat
        bar = int(tb // BAR)
        root = note_freq(CHORDS[chord_seq[bar % len(chord_seq)][0]][0]) / 2
        place(music, eight08(root, 0.45), tb, 0.22)
        # arp 8ths
        chord_name = chord_seq[bar % len(chord_seq)][0]
        tones = [note_freq(x) for x in CHORDS[chord_name]]
        note = tones[beat_i % len(tones)]
        place(music, epiano(note * 2, 0.4), tb, 0.10)
        place(music, epiano(note * 4, 0.3), tb + BEAT / 2, 0.06)

    # pad per bar
    for bar_i in range(int(dur / BAR)):
        first, second = chord_seq[bar_i % len(chord_seq)]
        for chord_name, off in ((first, 0.0), (second, 2 * BEAT)):
            freqs = [note_freq(x) for x in CHORDS[chord_name]]
            t = t_axis(2 * BEAT)
            pad = sum(np.sin(2 * np.pi * f * t) for f in freqs) / len(freqs)
            pad = lowpass(pad, 1800) * adsr(len(t), 0.05, 0.2, 0.8, 0.2)
            place(music, pad, bar_i * BAR + off, 0.12)

    # impacts / riser
    place(fx, sub_boom(), 0.0, 0.8)
    place(fx, reverse_crash(), BEAT)
    place(fx, whoosh(), 2 * BEAT, 0.4)
    place(fx, riser(2.0), dur - 2.0, 0.4)

    sc = kick_sidechain(n, kicks, 0.5)
    music *= sc

    mix = drums * 0.9 + music * 0.8 + fx
    stereo = reverb_stereo(mix, make_ir(), wet=0.18)
    return master(stereo)


def main() -> int:
    ap = argparse.ArgumentParser(description="numpy/scipy synth toolkit demo")
    ap.add_argument("--out", default=os.path.join("audio", "demo.wav"))
    args = ap.parse_args()
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    audio = build_arrangement()
    wavfile.write(args.out, SR, np.ascontiguousarray(audio.T.astype(np.float32)))
    peak = float(np.max(np.abs(audio)))
    print(f"wrote {args.out}  {audio.shape[1] / SR:.2f}s  {SR} Hz stereo  peak={peak:.3f} ({20*np.log10(peak):.1f} dBFS)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
