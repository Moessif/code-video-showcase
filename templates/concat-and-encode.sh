#!/usr/bin/env bash
# concat-and-encode.sh — concat segment MP4s, mux audio, final 2-pass H.264 encode.
#
#   ./concat-and-encode.sh segments.txt audio/mix.wav out/final.mp4 [duration=61] [fps=30]
#
# segments.txt format (concat demuxer):
#   file 'out/00-opening.mp4'
#   file 'out/01-card.mp4'
#   ...
# All segments must share codec/params for -c copy concat; if not, see FALLBACK note.
# Env: FFMPEG, FFPROBE, PYTHON (defaults: ffmpeg, ffprobe, python3),
#      VIDEO_BITRATE (3400k), AUDIO_BITRATE (192k).
set -euo pipefail

SEGLIST="${1:?usage: concat-and-encode.sh <segments.txt> <audio.wav> <out.mp4> [duration=61] [fps=30]}"
AUDIO="${2:?missing audio}"
OUT="${3:?missing output}"
DURATION="${4:-61}"
FPS="${5:-30}"
VIDEO_BITRATE="${VIDEO_BITRATE:-3400k}"
AUDIO_BITRATE="${AUDIO_BITRATE:-192k}"
FFMPEG="${FFMPEG:-ffmpeg}"
FFPROBE="${FFPROBE:-ffprobe}"
PYTHON="${PYTHON:-python3}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CONCAT="$TMP/concat.mp4"

echo "[1/4] concat segments (stream copy)"
"$FFMPEG" -y -hide_banner -loglevel error -f concat -safe 0 -i "$SEGLIST" -c copy "$CONCAT"
# FALLBACK: if the segments were encoded with different settings, concat copy can fail or
# desync. Replace the line above with a re-encode:
#   "$FFMPEG" -y -f concat -safe 0 -i "$SEGLIST" -c:v libx264 -preset medium -crf 16 -pix_fmt yuv420p "$CONCAT"

FRAMES=$($FFPROBE -v error -count_frames -select_streams v:0 \
  -show_entries stream=nb_read_frames -of csv=p=0 "$CONCAT")
EXPECTED=$("$PYTHON" -c "print(round($DURATION*$FPS))" 2>/dev/null || \
  awk "BEGIN { printf \"%d\", $DURATION*$FPS + 0.5 }")
echo "      concat frames=${FRAMES} (expected ${EXPECTED})"
if [ "$FRAMES" != "$EXPECTED" ]; then
  echo "WARNING: frame count mismatch; check segment durations/timeline." >&2
fi

echo "[2/4] 2-pass video encode (${VIDEO_BITRATE})"
"$FFMPEG" -y -hide_banner -loglevel error -i "$CONCAT" -i "$AUDIO" \
  -c:v libx264 -preset slow -b:v "$VIDEO_BITRATE" -pix_fmt yuv420p \
  -pass 1 -passlogfile "$TMP/passlog" -an -f null -
"$FFMPEG" -y -hide_banner -loglevel error -i "$CONCAT" -i "$AUDIO" \
  -c:v libx264 -preset slow -b:v "$VIDEO_BITRATE" -pix_fmt yuv420p \
  -pass 2 -passlogfile "$TMP/passlog" \
  -c:a aac -b:a "$AUDIO_BITRATE" -ar 48000 \
  -shortest -t "$DURATION" -movflags +faststart "$OUT"

echo "[3/4] verify"
"$FFPROBE" -v error -show_entries format=duration,size,bit_rate \
  -show_entries stream=index,codec_type,codec_name,width,height,r_frame_rate,nb_frames \
  -of json "$OUT" | "$PYTHON" -m json.tool 2>/dev/null || \
  "$FFPROBE" -v error -show_entries format=duration,size,bit_rate -of default=nw=1 "$OUT"

SIZE_BYTES=$("$FFPROBE" -v error -show_entries format=size -of csv=p=0 "$OUT")
SIZE_MB=$(awk "BEGIN { printf \"%.2f\", $SIZE_BYTES / 1048576 }")
echo "[4/4] done: $OUT  (${SIZE_MB} MB)"
