#!/usr/bin/env bash
# qa-check.sh — verify rendered segment MP4s before concat.
#
#   ./qa-check.sh <dir-with-segment-mp4s> [fps=30]
#
# Checks per file: H.264, yuv420p, 1920x1080, fps, frame count = duration*fps.
# Prints a table and a total frame count (must match the timeline).
# Env overrides: FFPROBE, PYTHON.
set -euo pipefail
DIR="${1:?usage: qa-check.sh <dir-with-mp4s> [fps=30]}"
FPS="${2:-30}"
FFPROBE="${FFPROBE:-ffprobe}"
PYTHON="${PYTHON:-python3}"
total=0
fail=0
printf "%-28s %8s %7s %9s %6s %5s %s\n" "file" "frames" "expect" "duration" "fps" "ok" "codec/pix"
shopt -s nullglob
for f in "$DIR"/*.mp4; do
  read -r codec pix w h rate frames dur < <("$PYTHON" - "$f" <<'PY'
import json, os, subprocess, sys
probe = os.environ.get("FFPROBE", "ffprobe")
out = subprocess.check_output([probe, "-v", "error", "-count_frames", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_read_frames",
    "-show_entries", "format=duration", "-of", "json", sys.argv[1]])
d = json.loads(out)
s = (d.get("streams") or [{}])[0]
print(s.get("codec_name", "?"), s.get("pix_fmt", "?"), s.get("width", "?"), s.get("height", "?"),
      s.get("r_frame_rate", "?"), s.get("nb_read_frames", "?"), d.get("format", {}).get("duration", "0"))
PY
)
  expect=$("$PYTHON" -c "print(round(float('$dur')*$FPS))" 2>/dev/null || echo "?")
  ok="OK"
  [ "$codec" = "h264" ] || ok="CODEC"
  [ "$pix" = "yuv420p" ] || ok="PIXFMT"
  [ "$w" = "1920" ] && [ "$h" = "1080" ] || ok="SIZE"
  [ "$rate" = "30/1" ] || ok="FPS"
  [ "$frames" = "$expect" ] || ok="FRAMES"
  [ "$ok" = "OK" ] || fail=$((fail+1))
  total=$((total + ${frames:-0}))
  printf "%-28s %8s %7s %9s %6s %5s %s\n" "$(basename "$f")" "$frames" "$expect" "$dur" "$rate" "$ok" "$codec/$pix"
done
echo "-------------------------------------------------------------------"
echo "total frames: $total   failures: $fail"
[ "$fail" -eq 0 ] || exit 1
