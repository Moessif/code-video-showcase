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


def grid_phase(peaks, bpm: float):
    """Best phase on the beat grid, trying quarter / eighth / sixteenth subdivisions."""
    beat = 60.0 / bpm
    best = (0.0, -1.0, 1)
    for subdiv in (1, 2, 4):
        step = beat / subdiv
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
        # Prefer the coarser grid unless a finer one is clearly better.
        if rate > best[1] + 0.08 or (best[1] < 0 and rate >= best[1]):
            best = (best_off, rate, subdiv)
    return best


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


def save_spectrogram(mono: np.ndarray, sr: int, path: str):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception as e:  # matplotlib is optional
        print(f"[warn] matplotlib unavailable, skipping spectrogram: {e}", file=sys.stderr)
        return False
    f, t, z = signal.stft(mono, fs=sr, nperseg=2048, noverlap=1536)
    p = 20 * np.log10(np.abs(z) + EPS)
    p = np.clip(p, p.max() - 90, p.max())
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    fig, ax = plt.subplots(figsize=(16, 6), dpi=110)
    ax.pcolormesh(t, f, p, shading="auto", cmap="magma")
    ax.set_yscale("symlog", linthresh=100)
    ax.set_ylim(30, sr / 2)
    ax.set_xlabel("time (s)")
    ax.set_ylabel("frequency (Hz)")
    ax.set_title("log-frequency spectrogram")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
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
    offset, hit_rate, grid_subdiv = grid_phase(peaks, bpm) if bpm else (None, None, None)

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
    align_rate = matched / max(1, near)
    coverage = near / max(1, len(cues))

    key_times = [c["t"] for c in cues if c.get("kind") in ("card", "start")]
    hf = hf_contrast(mono, sr, key_times, dur)
    silences = silence_spans(mono, sr)

    checks = []

    def chk(name, ok, detail, warn_only=False):
        checks.append({"name": name, "status": "PASS" if ok else ("WARN" if warn_only else "FAIL"), "detail": detail})

    chk("peak", peak <= 0.891, f"{20*np.log10(peak+EPS):.2f} dBFS (≤ -1 dBFS)", warn_only=True)
    chk("clipping", clip == 0, f"{clip} samples ≥ 0.999")
    chk("integrated loudness", abs(integrated_lufs(stereo, sr) + 14) <= 1.0,
        f"{integrated_lufs(stereo, sr):.2f} LUFS (target -14 ±1)", warn_only=True)
    if expected_bpm and tempo:
        chk("tempo", abs(tempo - expected_bpm) <= 2.0, f"detected {tempo:.2f} BPM, expected {expected_bpm} (conf {tempo_conf:.2f})", warn_only=True)
    elif tempo:
        chk("tempo", True, f"detected {tempo:.2f} BPM (no plan expectation)")
    if cues:
        chk("cue alignment", coverage >= 0.2 and align_rate >= 0.8,
            f"{matched}/{near} cues with an onset within ±{int(args.tolerance*1000)}ms "
            f"({align_rate*100:.1f}%; onset coverage {coverage*100:.1f}% of {len(cues)} cues)")
    if hit_rate is not None:
        chk("beat grid", hit_rate >= 0.7, f"{hit_rate*100:.1f}% of onsets on 1/{grid_subdiv} grid (offset {offset*1000:.0f} ms)", warn_only=True)
    chk("silence", len(silences) == 0, f"{len(silences)} spans ≥1 s below -45 dB", warn_only=True)
    if hf:
        chk("HF restraint", hf["contrast_db"] >= 6.0, f"8–16 kHz key vs rest: {hf['contrast_db']:+.2f} dB (target ≥ +6)", warn_only=True)

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
    print(f"\n{s['pass']} pass · {s['warn']} warn · {s['fail']} fail  ->  {args.out}")
    if s["fail"] or (args.strict and s["warn"]):
        sys.exit(1)


if __name__ == "__main__":
    main()
