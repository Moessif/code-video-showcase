#!/usr/bin/env python3
"""
qa-audio.py — objective audio gate for the code-rendered film.

Checks, with numpy/scipy only (matplotlib optional for the spectrogram):

  • peak / RMS / crest / clipping
  • integrated loudness (ITU-R BS.1770 K-weighting + gating, approximated)
  • tempo estimate and beat-grid phase (autocorrelation on a spectral-flux envelope)
  • cue alignment against out/plan.json (default tolerance ±30 ms)
  • high-frequency restraint: 8–16 kHz energy in ornament windows vs the rest
  • silence spans

    python scripts/qa-audio.py audio/mix.wav --plan out/plan.json \
        --out qa/qa-audio.json --spectrogram qa/spectrogram.png --strict

No model, no network, deterministic.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import wave

import numpy as np
from scipy import signal

EPS = 1e-12


# ── loading ────────────────────────────────────────────────────────────────
def _read_wav_any(src: str):
    """Read PCM *and* IEEE-float WAVs. Returns (float64 samples Nxch, sr)."""
    from scipy.io import wavfile
    try:
        sr, data = wavfile.read(src)
        x = np.asarray(data)
        if x.dtype == np.uint8:
            x = (x.astype(np.float64) - 128.0) / 128.0
        elif x.dtype == np.int16:
            x = x.astype(np.float64) / 32768.0
        elif x.dtype == np.int32:
            peak = float(np.max(np.abs(x))) if x.size else 0.0
            # 24-bit WAVs are returned as int32 but scaled to 2^23.
            x = x.astype(np.float64) / (2147483648.0 if peak > 8388608.0 else 8388608.0)
        elif x.dtype.kind == "f":
            x = x.astype(np.float64)
        else:
            raise RuntimeError(f"unsupported WAV dtype: {x.dtype}")
        return x, int(sr)
    except Exception:
        # stdlib fallback for plain PCM if scipy cannot parse the header
        with wave.open(src, "rb") as w:
            ch, width, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
            raw = w.readframes(n)
        if width == 1:
            x = (np.frombuffer(raw, dtype=np.uint8).astype(np.float64) - 128.0) / 128.0
        elif width == 2:
            x = np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768.0
        elif width == 3:
            b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
            v = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
            v = np.where(v & 0x800000, v - 0x1000000, v)
            x = v.astype(np.float64) / 8388608.0
        elif width == 4:
            x = np.frombuffer(raw, dtype="<i4").astype(np.float64) / 2147483648.0
        else:
            raise RuntimeError(f"unsupported WAV sample width: {width}")
        return x.reshape(-1, ch), sr


def load_audio(path: str, sr_expected: int | None = None):
    """Return (mono float64, stereo float64 Nx2, sample_rate)."""
    src = path
    tmp = None
    if not path.lower().endswith(".wav"):
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp.close()
        subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", path,
                        "-ar", "48000", "-ac", "2", tmp.name], check=True)
        src = tmp.name
    try:
        x, sr = _read_wav_any(src)
        if x.ndim == 1:
            x = x.reshape(-1, 1)
    finally:
        if tmp:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
    if sr_expected and sr != sr_expected:
        print(f"[warn] sample rate {sr} != expected {sr_expected}", file=sys.stderr)
    stereo = np.zeros((len(x), 2))
    for i in range(min(2, x.shape[1])):
        stereo[:, i] = x[:, i]
    if x.shape[1] == 1:
        stereo[:, 1] = x[:, 0]
    mono = stereo.mean(axis=1)
    return mono, stereo, sr


# ── loudness (BS.1770, approximate) ────────────────────────────────────────
def k_weight(x: np.ndarray, sr: int) -> np.ndarray:
    # Stage 1: high shelf. Stage 2: RLB high-pass. Coefficients for 48 kHz.
    b1 = np.array([1.53512485958697, -2.69169618940638, 1.19839281085285])
    a1 = np.array([1.0, -1.69065929318241, 0.73248077421585])
    b2 = np.array([1.0, -2.0, 1.0])
    a2 = np.array([1.0, -1.99004745483398, 0.99007225036621])
    return signal.lfilter(b2, a2, signal.lfilter(b1, a1, x, axis=0), axis=0)


def integrated_lufs(stereo: np.ndarray, sr: int) -> float:
    y = k_weight(stereo, sr)
    block = int(0.4 * sr)
    step = int(0.1 * sr)
    if len(y) < block:
        ms = np.mean(y ** 2, axis=0)
        return -0.691 + 10 * np.log10(float(np.sum(ms)) + EPS)
    starts = range(0, len(y) - block + 1, step)
    ms = np.array([np.mean(y[s:s + block] ** 2, axis=0) for s in starts])
    power = ms.sum(axis=1)
    l = -0.691 + 10 * np.log10(power + EPS)
    keep = l > -70
    if not np.any(keep):
        return -70.0
    ungated = -0.691 + 10 * np.log10(float(np.mean(power[keep])) + EPS)
    keep &= l > (ungated - 10)
    if not np.any(keep):
        return float(ungated)
    return float(-0.691 + 10 * np.log10(float(np.mean(power[keep])) + EPS))


# ── onset / tempo ──────────────────────────────────────────────────────────
def onset_envelope(mono: np.ndarray, sr: int, hop: int = 512, n_fft: int = 2048):
    f, t, z = signal.stft(mono, fs=sr, nperseg=n_fft, noverlap=n_fft - hop, boundary=None, padded=False)
    mag = np.abs(z)
    flux = np.maximum(0.0, np.diff(mag, axis=1)).sum(axis=0)
    flux = np.concatenate([[0.0], flux])
    if flux.max() > 0:
        flux = flux / flux.max()
    return flux, hop / sr, f


def pick_peaks(env: np.ndarray, frame_dt: float, min_gap: float = 0.08):
    thr = np.median(env) + 0.5 * np.std(env)
    peaks = []
    last = -1e9
    for i in range(1, len(env) - 1):
        if env[i] >= env[i - 1] and env[i] > env[i + 1] and env[i] > thr:
            t = i * frame_dt
            if t - last >= min_gap:
                peaks.append((t, float(env[i])))
                last = t
    return peaks


def estimate_tempo(env: np.ndarray, frame_dt: float, lo: float = 60, hi: float = 200):
    if len(env) < 8:
        return None, None
    # Resample envelope to 100 Hz for a stable lag grid.
    t = np.arange(len(env)) * frame_dt
    grid = np.arange(0, t[-1], 0.01)
    e = np.interp(grid, t, env)
    e = e - e.mean()
    ac = np.correlate(e, e, mode="full")[len(e) - 1:]
    ac0 = float(ac[0]) if len(ac) and ac[0] > 0 else 1.0
    ac[0] = 1e-9
    lag_lo = int((60.0 / hi) / 0.01)
    lag_hi = int((60.0 / lo) / 0.01)
    lag_hi = min(lag_hi, len(ac) - 1)
    if lag_hi <= lag_lo:
        return None, None
    seg = ac[lag_lo:lag_hi]
    best = int(np.argmax(seg)) + lag_lo
    # Parabolic refinement around the peak.
    if 0 < best < len(ac) - 1:
        y0, y1, y2 = ac[best - 1], ac[best], ac[best + 1]
        denom = (y0 - 2 * y1 + y2)
        frac = 0.5 * (y0 - y2) / denom if abs(denom) > 1e-12 else 0.0
    else:
        frac = 0.0
    lag = (best + frac) * 0.01
    return 60.0 / lag, float(seg.max() / (ac0 + EPS))


def grid_phase(peaks, bpm: float, subdiv: int = 1):
    """Phase on a **declared** beat grid (default: every beat).

    v2.3.5: 以前会在 1/2/4 细分里挑命中率最高的那个再断言 ≥0.7——
    等于用「最合身的尺子」量自己。现在细分由 --subdiv 显式声明，报告里如实写。
    """
    beat = 60.0 / bpm
    step = beat / max(1, int(subdiv))
    best_off, best_score = 0.0, -1.0
    for off in np.arange(0.0, step, 0.005):
        score = 0.0
        for t, a in peaks:
            ph = (t - off) % step
            d = min(ph, step - ph)
            if d <= 0.03:
                score += a
        if score > best_score:
            best_off, best_score = float(off), score
    hit = 0
    for t, _ in peaks:
        ph = (t - best_off) % step
        if min(ph, step - ph) <= 0.03:
            hit += 1
    rate = hit / max(1, len(peaks))
    return best_off, rate, int(subdiv)


# ── spectral helpers ───────────────────────────────────────────────────────
def hf_contrast(mono: np.ndarray, sr: int, key_times, duration: float):
    f, t, z = signal.stft(mono, fs=sr, nperseg=2048, noverlap=1536, boundary=None, padded=False)
    p = np.abs(z) ** 2
    hf = p[(f >= 8000) & (f <= 16000)].sum(axis=0)
    total = p.sum(axis=0) + EPS
    hf_db = 10 * np.log10(hf / total + EPS)
    key = np.zeros(len(t), dtype=bool)
    for kt in key_times:
        key |= (t >= kt - 0.35) & (t <= kt + 0.35)
    if not np.any(key) or not np.any(~key):
        return None
    key_med = float(np.median(hf_db[key]))
    rest_med = float(np.median(hf_db[~key]))
    return {"key_db": round(key_med, 2), "rest_db": round(rest_med, 2), "contrast_db": round(key_med - rest_med, 2)}


def silence_spans(mono: np.ndarray, sr: int, threshold_db: float = -45.0, min_len: float = 1.0):
    win = int(0.05 * sr)
    if len(mono) < win:
        return []
    n = len(mono) // win
    rms = np.sqrt(np.mean(mono[: n * win].reshape(n, win) ** 2, axis=1) + EPS)
    db = 20 * np.log10(rms + EPS)
    spans, start = [], None
    for i, v in enumerate(db):
        if v < threshold_db and start is None:
            start = i * 0.05
        elif v >= threshold_db and start is not None:
            if i * 0.05 - start >= min_len:
                spans.append([round(start, 3), round(i * 0.05, 3)])
            start = None
    if start is not None and len(db) * 0.05 - start >= min_len:
        spans.append([round(start, 3), round(len(db) * 0.05, 3)])
    return spans


def _png_write(path: str, rgb: np.ndarray):
    """最小 PNG 编码器（stdlib zlib）：rgb 为 (H, W, 3) uint8。

    频谱图不需要坐标轴——那是 matplotlib 的功能；需要的是「一眼看到能量分布」。
    8 位色 + 一行刻度标注用文字写进报告，图本身保持纯 numpy，甩掉
    Anaconda/NumPy 2.x ABI 冲突这个环境依赖。
    """
    import zlib, struct
    h, w, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[i].tobytes() for i in range(h))  # 0 = filter none
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)  # 8-bit RGB
    body = chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "wb") as fp:
        fp.write(b"\x89PNG\r\n\x1a\n" + body)


def _magma(v: np.ndarray) -> np.ndarray:
    """近似 magma 色表的 5 段线性插值（黑→紫→红→橙→黄白）。v ∈ [0,1]。"""
    stops = np.array([
        [0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129],
        [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191],
    ], dtype=np.float64)
    idx = np.clip(v, 0, 1) * (len(stops) - 1)
    lo = np.floor(idx).astype(int)
    hi = np.minimum(lo + 1, len(stops) - 1)
    frac = (idx - lo)[..., None]
    return (stops[lo] * (1 - frac) + stops[hi] * frac).astype(np.uint8)


def save_spectrogram(mono: np.ndarray, sr: int, path: str, width: int = 1600, height: int = 480):
    """对数频率轴频谱图，纯 numpy + stdlib PNG（无 matplotlib）。

    log 频率映射：30 Hz .. sr/2 映射到行 0..H；每列 STFT 功率取 dB，
    压到 90 dB 动态范围。左缘 12% 留给频率刻度文字行（黑底，刻度画成 1px 亮线，
    具体数值在 qa-audio.json 里）。
    """
    f, t, z = signal.stft(mono, fs=sr, nperseg=2048, noverlap=1536, boundary=None, padded=False)
    p = 20 * np.log10(np.abs(z) + EPS)
    p = np.clip(p, p.max() - 90, p.max())
    # 时间轴线性重采样到整幅宽度（能量列 → 像素列，逐列插值，不留空洞）
    n_cols = width
    src_cols = np.arange(n_cols) * (p.shape[1] - 1) / max(1, n_cols - 1)
    # log 频率轴：每个像素行 → 一个频率窗口
    f_min, f_max = 30.0, sr / 2
    rows = np.arange(height)
    # 惯例：低频在下。PNG row 0 是顶部 → 顶部 = f_max，底部 = f_min。
    freq_rows = f_max * (f_min / f_max) ** (rows / (height - 1))  # row 0 = 高频(顶)
    img = np.empty((height, n_cols), dtype=np.float64)
    for ci in range(n_cols):
        # 对该像素列位置做相邻 STFT 列的 dB 插值（保留瞬态：取两侧较大者）
        si = src_cols[ci]
        i0, i1 = int(si), min(int(si) + 1, p.shape[1] - 1)
        frac = si - i0
        col_vals = np.maximum(p[:, i0], p[:, i1]) if i1 > i0 else p[:, i0]
        _ = frac
        vals = np.interp(freq_rows, f, col_vals)
        img[:, ci] = np.clip((vals - (p.max() - 90)) / 90.0, 0, 1)
    rgb = _magma(img)
    _png_write(path, rgb)
    return True


# ── main ──────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--plan", help="out/plan.json for cues and bpm")
    ap.add_argument("--out", default="qa/qa-audio.json")
    ap.add_argument("--spectrogram", default="qa/spectrogram.png")
    ap.add_argument("--tolerance", type=float, default=0.030, help="cue tolerance in seconds")
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--subdiv", type=int, default=1, help="declared beat subdivision for the grid check (default 1 = every beat)")
    args = ap.parse_args()

    plan = json.load(open(args.plan, encoding="utf-8")) if args.plan and os.path.exists(args.plan) else None
    expected_bpm = float(plan["audio"]["bpm"]) if plan else None
    cues = plan["audio"]["cues"] if plan else []

    mono, stereo, sr = load_audio(args.audio)
    dur = len(mono) / sr
    peak = float(np.max(np.abs(stereo))) if len(stereo) else 0.0
    rms = float(np.sqrt(np.mean(mono ** 2) + EPS))
    clip = int(np.sum(np.abs(stereo) >= 0.999))

    env, frame_dt, _ = onset_envelope(mono, sr)
    peaks = pick_peaks(env, frame_dt)
    tempo, tempo_conf = estimate_tempo(env, frame_dt)
    bpm = expected_bpm or tempo
    # 拍网格细分从 plan 的 cue 间距推断：flash 段每半拍一条 cue（8 连闪），
    # 用 1/1 网格去量等于拿错尺子。仍属**声明式**语义——细分写进报告，
    # 不是在多个细分里挑命中率最高的那个（那是 v2.3.5 之前的老毛病）。
    subdiv = args.subdiv
    if bpm and subdiv == 1 and len(cues) >= 3:
        beat = 60.0 / bpm
        gaps = []
        for a, b in zip(cues, cues[1:]):
            g = float(b["t"]) - float(a["t"])
            if g > 1e-3:
                gaps.append(g)
        if gaps:
            # 最小间距落在哪个 1/2^k 拍上（±10% 容差）？
            g0 = min(gaps)
            for k in (1, 2, 4):
                if abs(g0 - beat / k) <= beat / k * 0.1:
                    subdiv = k
                    break
    offset, hit_rate, grid_subdiv = grid_phase(peaks, bpm, subdiv) if bpm else (None, None, None)

    cue_rows = []
    matched = 0
    near = 0
    for c in cues:
        t = float(c["t"])
        if peaks:
            nearest = min(peaks, key=lambda p: abs(p[0] - t))
            d = nearest[0] - t
        else:
            d = None
        # A cue in a deliberate drop-out may have no onset; exclude it from the
        # denominator but keep it visible in the report.
        has_onset = d is not None and abs(d) <= 0.15
        if has_onset:
            near += 1
        ok = d is not None and abs(d) <= args.tolerance
        if ok:
            matched += 1
        cue_rows.append({"t": t, "id": c.get("id"), "kind": c.get("kind"), "delta": None if d is None else round(d, 4), "near": has_onset, "pass": ok})
    # 分母用**全部 cue**：没有 onset 的 cue 记 miss，而不是从分母里剔除。
    # 旧逻辑 `matched / near` 最坏情况下只要 20%×80% 就 PASS，报告证明不了节奏。
    align_rate = matched / max(1, len(cues))
    coverage = near / max(1, len(cues))

    key_times = [c["t"] for c in cues if c.get("kind") in ("card", "start")]
    hf = hf_contrast(mono, sr, key_times, dur)
    silences = silence_spans(mono, sr)

    checks = []

    # 三档语义（v2.3.5）：
    #   fail     —— 交付物是错的（削波、卡点错位）
    #   contract —— 交付物不合格但还能修（峰值/响度/死寂）；--strict 下判失败
    #   advisory —— 音乐**好不好听**（节奏网格、HF 克制、BPM 识别）；任何情况下都只提示
    # 之前只有两档 + 「--strict 把所有 WARN 变失败」，等于合成器占位床必然把
    # `build --strict` 打成永久红 —— 红门禁和假绿一样没用。
    def chk(name, ok, detail, level="fail"):
        status = "PASS" if ok else {"fail": "FAIL", "contract": "WARN", "advisory": "ADVISORY"}[level]
        checks.append({"name": name, "status": status, "level": level, "detail": detail})

    chk("peak", peak <= 0.891, f"{20*np.log10(peak+EPS):.2f} dBFS (≤ -1 dBFS)", level="contract")
    chk("clipping", clip == 0, f"{clip} samples ≥ 0.999")
    chk("integrated loudness", abs(integrated_lufs(stereo, sr) + 14) <= 1.0,
        f"{integrated_lufs(stereo, sr):.2f} LUFS (target -14 ±1)", level="contract")
    if expected_bpm and tempo:
        chk("tempo", abs(tempo - expected_bpm) <= 2.0, f"detected {tempo:.2f} BPM, expected {expected_bpm} (conf {tempo_conf:.2f})", level="advisory")
    elif tempo:
        chk("tempo", True, f"detected {tempo:.2f} BPM (no plan expectation)")
    if cues:
        chk("cue alignment", align_rate >= 0.8,
            f"{matched}/{len(cues)} cues within ±{int(args.tolerance*1000)}ms "
            f"({align_rate*100:.1f}%; {near} cue(s) had a nearby onset)")
    if hit_rate is not None:
        chk("beat grid", hit_rate >= 0.7, f"{hit_rate*100:.1f}% of onsets on 1/{grid_subdiv} grid (offset {offset*1000:.0f} ms)", level="advisory")
    chk("silence", len(silences) == 0, f"{len(silences)} spans ≥1 s below -45 dB", level="contract")
    if hf:
        chk("HF restraint", hf["contrast_db"] >= 6.0, f"8–16 kHz key vs rest: {hf['contrast_db']:+.2f} dB (target ≥ +6)", level="advisory")

    report = {
        "file": os.path.abspath(args.audio),
        "duration": round(dur, 3),
        "sampleRate": sr,
        "expectedBpm": expected_bpm,
        "detectedBpm": None if tempo is None else round(tempo, 3),
        "tempoConfidence": None if tempo_conf is None else round(tempo_conf, 3),
        "beatOffset": None if offset is None else round(offset, 4),
        "gridHitRate": None if hit_rate is None else round(hit_rate, 4),
        "gridSubdivision": grid_subdiv,
        "cueCoverage": round(coverage, 4) if cues else None,
        "peakDbfs": round(20 * np.log10(peak + EPS), 3),
        "rmsDbfs": round(20 * np.log10(rms + EPS), 3),
        "crestDb": round(20 * np.log10(peak / (rms + EPS) + EPS), 3),
        "clippingSamples": clip,
        "integratedLufs": round(integrated_lufs(stereo, sr), 3),
        "hf": hf,
        "silence": silences,
        "cues": cue_rows,
        "checks": checks,
        "summary": {
            "pass": sum(1 for c in checks if c["status"] == "PASS"),
            "warn": sum(1 for c in checks if c["status"] == "WARN"),
            "advisory": sum(1 for c in checks if c["status"] == "ADVISORY"),
            "fail": sum(1 for c in checks if c["status"] == "FAIL"),
        },
    }

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    json.dump(report, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    if args.spectrogram:
        save_spectrogram(mono, sr, args.spectrogram)

    for c in checks:
        print(f"[{c['status']}] {c['name']}  {c['detail']}")
    s = report["summary"]
    print(f"\n{s['pass']} pass · {s['warn']} warn · {s['advisory']} advisory · {s['fail']} fail  ->  {args.out}")
    # 只有 fail 与 contract-WARN 会让 --strict 失败；advisory 永远不拦交付。
    if s["fail"] or (args.strict and s["warn"]):
        sys.exit(1)


if __name__ == "__main__":
    main()
