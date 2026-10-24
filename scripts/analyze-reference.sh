#!/usr/bin/env bash
# analyze-reference.sh — turn any reference MP4 into analysis artifacts.
#
#   ./analyze-reference.sh <input.mp4> [outdir]
#
# Outputs (in outdir, default ./analysis/<video-name>/):
#   metadata.json          ffprobe format + streams
#   contact-1fps.jpg       1 fps contact sheet (8x8)
#   scene-cuts.txt         scene-change timestamps (threshold 0.18)
#   audio-spectrogram.png  log-frequency spectrogram
#   audio-waveform.png     waveform
#   audio-analysis.json    duration/peak/rms/BPM/phase/onset alignment/quiet intervals
#   colors-per-second.json average RGB per second
#
# Requires: ffmpeg + ffprobe (with tile/showspectrumpic), python3 + numpy.
# Env overrides: FFMPEG, FFPROBE, PYTHON.
set -euo pipefail

IN="${1:?usage: analyze-reference.sh <input.mp4> [outdir]}"
NAME="$(basename "$IN" | sed 's/\.[^.]*$//')"
OUT="${2:-analysis/$NAME}"
FFMPEG="${FFMPEG:-ffmpeg}"
FFPROBE="${FFPROBE:-ffprobe}"
PYTHON="${PYTHON:-python3}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$OUT"
echo "[1/6] metadata"
"$FFPROBE" -v error -show_format -show_streams -of json "$IN" > "$OUT/metadata.json"

echo "[2/6] contact sheet (1 fps)"
"$FFMPEG" -y -v error -i "$IN" -vf "fps=1,scale=240:135,tile=8x8:padding=4:margin=4" \
  -frames:v 1 "$OUT/contact-1fps.jpg"

echo "[3/6] scene cuts"
"$FFMPEG" -hide_banner -v info -i "$IN" -vf "select='gt(scene,0.18)',showinfo" -an -f null - 2>&1 \
  | grep -o 'pts_time:[0-9.]*' | sed 's/pts_time://' | awk '{printf "%.3f\n",$1}' \
  > "$OUT/scene-cuts.txt" || true
echo "      $(wc -l < "$OUT/scene-cuts.txt") cuts"

echo "[4/6] audio images"
"$FFMPEG" -y -v error -i "$IN" -lavfi "showspectrumpic=s=1800x900:legend=1:scale=log:color=intensity" \
  -frames:v 1 "$OUT/audio-spectrogram.png"
"$FFMPEG" -y -v error -i "$IN" -lavfi "showwavespic=s=1800x300:colors=#d97757" \
  -frames:v 1 "$OUT/audio-waveform.png"

echo "[5/6] audio analysis"
"$FFMPEG" -y -v error -i "$IN" -vn -ac 1 -ar 48000 -f f32le "$TMP/audio.f32"
"$PYTHON" - "$TMP/audio.f32" "$OUT/audio-analysis.json" <<'PY'
import sys, json
import numpy as np

src, dst = sys.argv[1], sys.argv[2]
x = np.fromfile(src, dtype=np.float32)
sr = 48000
dur = len(x) / sr
peak, rms = float(np.abs(x).max()), float(np.sqrt((x * x).mean()))

win = int(0.02 * sr)
n = len(x) // win
env = np.sqrt((x[:n * win].reshape(n, win) ** 2).mean(axis=1)) + 1e-9
times = np.arange(n) * win / sr
db = 20 * np.log10(env)

quiet = env < 0.20 * np.median(env)
def intervals(mask):
    out, i = [], 0
    while i < len(mask):
        if mask[i]:
            j = i
            while j < len(mask) and mask[j]:
                j += 1
            if (j - i) * 0.02 >= 0.15:
                out.append((round(times[i], 2), round(times[j - 1] + 0.02, 2)))
            i = j
        else:
            i += 1
    return out

flux = np.maximum(0, np.diff(db))
flux = np.concatenate([[0], flux])
flux = np.maximum(flux - np.median(flux), 0)
ac = np.correlate(flux, flux, 'full')[len(flux) - 1:]
lo, hi = int(0.3 / 0.02), int(0.9 / 0.02)
lag = lo + int(np.argmax(ac[lo:hi]))
bpm = 60 / (lag * 0.02)
per = 0.5
best = (0.0, -1.0)
for off in np.arange(0, per, 0.005):
    idx = np.round((np.arange(off, dur, per)) / 0.02).astype(int)
    idx = idx[idx < len(flux)]
    score = float(flux[idx].sum())
    if score > best[1]:
        best = (float(off), score)
phase = best[0]
thr = np.percentile(flux[flux > 0], 92)
peak_t = times[np.where(flux > thr)[0]]
err = np.abs(((peak_t - phase) % per + per / 2) % per - per / 2)
err = err[err < 0.25]
align = {
    "n_peaks": int(len(peak_t)),
    "median_err_ms": round(float(np.median(err)) * 1000, 1) if len(err) else None,
    "within_30ms_pct": round(float((err < 0.03).mean() * 100), 1) if len(err) else None,
}
report = {
    "duration": round(dur, 3), "peak": round(peak, 4), "rms": round(rms, 5),
    "tempo": {"bpm_autocorr": round(bpm, 1), "phase_s": round(phase, 3)},
    "onset_alignment": align,
    "quiet_intervals": intervals(quiet),
}
json.dump(report, open(dst, "w"), ensure_ascii=False, indent=1)
print(json.dumps(report, ensure_ascii=False, indent=1))
PY

echo "[6/6] colors per second"
"$FFMPEG" -y -v error -i "$IN" -vf "fps=1,scale=1:1" -f rawvideo -pix_fmt rgb24 "$TMP/rgb.raw"
"$PYTHON" - "$TMP/rgb.raw" "$OUT/colors-per-second.json" <<'PY'
import sys, json
import numpy as np
src, dst = sys.argv[1], sys.argv[2]
a = np.fromfile(src, dtype=np.uint8).reshape(-1, 3)
data = [{"t": i, "hex": "#%02x%02x%02x" % tuple(int(v) for v in c)} for i, c in enumerate(a)]
json.dump(data, open(dst, "w"), indent=0)
print(f"{len(a)} seconds")
PY

echo "done -> $OUT"
ls -lh "$OUT"
