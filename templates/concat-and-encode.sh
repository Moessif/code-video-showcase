#!/usr/bin/env bash
# concat-and-encode.sh v2 — concat segment MP4s, mux synthesized audio, and
# produce a delivery-grade MP4 with platform presets, bt709 tags and optional
# two-pass EBU R128 loudness normalisation.
#
#   ./concat-and-encode.sh segments.txt audio/mix.wav out/final.mp4 [duration=61] [fps=30]
#   ./concat-and-encode.sh --platform bilibili segments.txt audio/mix.wav out/bilibili.mp4
#   ./concat-and-encode.sh --platform douyin --loudnorm segments.txt audio.wav out/douyin.mp4
#
# Platforms: master (default), youtube, bilibili, douyin, xiaohongshu, weixin, archive, custom.
# Presets change resolution, CRF, audio bitrate and loudness target — see --help.
#
# Segments must share codec/params for stream-copy concat. If they do not, the
# script automatically falls back to a normalising re-encode (fps/size/sar).
#
# Env: FFMPEG, FFPROBE, PYTHON.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: concat-and-encode.sh [options] <segments.txt> <audio.wav> <out.mp4> [duration=61] [fps=30]

Options:
  --platform <name>     master|youtube|bilibili|douyin|xiaohongshu|weixin|archive|custom
  --crf <n>             override CRF
  --preset <name>       override x264 preset (default slow for master/youtube, medium else)
  --audio-bitrate <k>   override AAC bitrate (e.g. 192k)
  --width <n> --height <n>  override output size (custom / vertical)
  --duration <sec> --fps <n>  override positional values
  --loudnorm            force EBU R128 two-pass normalisation
  --no-loudnorm         disable normalisation
  --lufs <n>            target integrated loudness, default -14
  --true-peak <db>      default -1.0
  --two-pass            use bitrate two-pass instead of CRF
  --bitrate <k>         target video bitrate for --two-pass (e.g. 8M)
  --tune <name>         optional x264 tune (e.g. animation)
  --sprite              write qa/sprite.jpg (6×6, one tile every 2 s)
  --strict              exit 1 if final frame count != round(duration*fps)
  -h, --help            this help
EOF
}
if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then usage; exit 0; fi

PLATFORM="${PLATFORM:-master}"
CRF_OVERRIDE=""; PRESET_OVERRIDE=""; AUDIO_BITRATE_OVERRIDE=""
WIDTH_OVERRIDE=""; HEIGHT_OVERRIDE=""
DURATION_OVERRIDE=""; FPS_OVERRIDE=""
LOUDNORM="auto"; LUFS="-14"; TP="-1.0"
TWO_PASS=0; BITRATE="8M"; TUNE=""; SPRITE=0; STRICT=0
POS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --platform) PLATFORM="$2"; shift 2 ;;
    --crf) CRF_OVERRIDE="$2"; shift 2 ;;
    --preset) PRESET_OVERRIDE="$2"; shift 2 ;;
    --audio-bitrate) AUDIO_BITRATE_OVERRIDE="$2"; shift 2 ;;
    --width) WIDTH_OVERRIDE="$2"; shift 2 ;;
    --height) HEIGHT_OVERRIDE="$2"; shift 2 ;;
    --duration) DURATION_OVERRIDE="$2"; shift 2 ;;
    --fps) FPS_OVERRIDE="$2"; shift 2 ;;
    --loudnorm) LOUDNORM=1; shift ;;
    --no-loudnorm) LOUDNORM=0; shift ;;
    --lufs) LUFS="$2"; shift 2 ;;
    --true-peak) TP="$2"; shift 2 ;;
    --two-pass) TWO_PASS=1; shift ;;
    --bitrate) BITRATE="$2"; shift 2 ;;
    --tune) TUNE="$2"; shift 2 ;;
    --sprite) SPRITE=1; shift ;;
    --strict) STRICT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    --*) echo "unknown option: $1" >&2; usage; exit 2 ;;
    *) POS+=("$1"); shift ;;
  esac
done

SEGLIST="${POS[0]:?missing segments.txt}"
AUDIO="${POS[1]:?missing audio}"
OUT="${POS[2]:?missing output}"
DURATION="${DURATION_OVERRIDE:-${POS[3]:-61}}"
FPS="${FPS_OVERRIDE:-${POS[4]:-30}}"
FFMPEG="${FFMPEG:-ffmpeg}"
FFPROBE="${FFPROBE:-ffprobe}"
PYTHON="${PYTHON:-python3}"
command -v "$PYTHON" >/dev/null 2>&1 || PYTHON="python"
command -v "$PYTHON" >/dev/null 2>&1 || PYTHON=""

# CRF values are tuned for grain-heavy code video (film grain is expensive):
# CRF 21 ≈ 12 Mbps, 24 ≈ 9 Mbps, 26 ≈ 6 Mbps at 1080p30. maxrate prevents
# grain spikes from tripling the file size.
case "$PLATFORM" in
  master)      W=1920; H=1080; CRF=21; PRESET=slow;   ABR=320k; MAXRATE=18M; BUF=36M; LUFS="${LUFS:--14}"; TP="${TP:--1.0}" ;;
  youtube)     W=1920; H=1080; CRF=22; PRESET=slow;   ABR=256k; MAXRATE=14M; BUF=28M ;;
  bilibili)    W=1920; H=1080; CRF=24; PRESET=medium; ABR=192k; MAXRATE=10M; BUF=20M ;;
  douyin)      W=1080; H=1920; CRF=24; PRESET=medium; ABR=192k; MAXRATE=10M; BUF=20M ;;
  xiaohongshu) W=1080; H=1440; CRF=24; PRESET=medium; ABR=192k; MAXRATE=8M;  BUF=16M ;;
  weixin)      W=1080; H=1260; CRF=24; PRESET=medium; ABR=192k; MAXRATE=8M;  BUF=16M ;;
  archive)     W=1920; H=1080; CRF=18; PRESET=slow;   ABR=320k; MAXRATE=24M; BUF=48M ;;
  custom)      W=1920; H=1080; CRF=21; PRESET=medium; ABR=192k; MAXRATE=18M; BUF=36M ;;
  *) echo "unknown platform: $PLATFORM" >&2; exit 2 ;;
esac
[ -n "$CRF_OVERRIDE" ] && CRF="$CRF_OVERRIDE"
[ -n "$PRESET_OVERRIDE" ] && PRESET="$PRESET_OVERRIDE"
[ -n "$AUDIO_BITRATE_OVERRIDE" ] && ABR="$AUDIO_BITRATE_OVERRIDE"
[ -n "$WIDTH_OVERRIDE" ] && W="$WIDTH_OVERRIDE"
[ -n "$HEIGHT_OVERRIDE" ] && H="$HEIGHT_OVERRIDE"
[ "$LOUDNORM" = "auto" ] && LOUDNORM=1

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CONCAT="$TMP/concat.mp4"

echo "[1/5] concat segments (stream copy)"
if ! "$FFMPEG" -y -hide_banner -loglevel error -f concat -safe 0 -i "$SEGLIST" -c copy "$CONCAT" 2>"$TMP/concat.err"; then
  echo "      stream-copy concat failed; normalising re-encode"
  sed -n '1,3p' "$TMP/concat.err" >&2 || true
  "$FFMPEG" -y -hide_banner -loglevel error -f concat -safe 0 -i "$SEGLIST" \
    -vf "fps=${FPS},setsar=1,scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black" \
    -c:v libx264 -preset veryfast -crf 12 -pix_fmt yuv420p \
    -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv "$CONCAT"
fi

FRAMES=$("$FFPROBE" -v error -count_frames -select_streams v:0 \
  -show_entries stream=nb_read_frames -of csv=p=0 "$CONCAT" | tr -d '\r')
EXPECTED=$("$PYTHON" -c "print(round($DURATION*$FPS))" 2>/dev/null || \
  awk "BEGIN { printf \"%d\", $DURATION*$FPS + 0.5 }")
echo "      concat frames=${FRAMES} (expected ${EXPECTED})"
if [ "$FRAMES" != "$EXPECTED" ]; then
  echo "WARNING: concat frame count mismatch; check timeline and segment durations." >&2
  [ "$STRICT" = "1" ] && exit 1
fi

# ── loudness: two-pass measure ──────────────────────────────────────────────
LOUD_ARGS=""
if [ "$LOUDNORM" = "1" ]; then
  echo "[2/5] measure loudness (EBU R128, target ${LUFS} LUFS / TP ${TP})"
  "$FFMPEG" -hide_banner -nostats -i "$AUDIO" \
    -af "loudnorm=I=${LUFS}:TP=${TP}:LRA=11:print_format=json" -f null - 2>"$TMP/loud.txt" || true
  if [ -n "$PYTHON" ] && grep -q '"input_i"' "$TMP/loud.txt"; then
    LOUD_ARGS=$("$PYTHON" - "$TMP/loud.txt" <<'PY'
import json, re, sys
s = open(sys.argv[1], encoding='utf-8', errors='ignore').read()
m = re.search(r'\{[^{}]*"input_i"[^{}]*\}', s, re.S)
if not m:
    sys.exit(0)
d = json.loads(m.group(0))
print(":measured_I=%s:measured_LRA=%s:measured_TP=%s:measured_thresh=%s:offset=%s" % (
    d["input_i"], d["input_lra"], d["input_tp"], d["input_thresh"], d["target_offset"]))
PY
)
  fi
  echo "      measured${LOUD_ARGS:- (unavailable; single-pass)}"
else
  echo "[2/5] loudness normalisation disabled"
fi

# ── video encode ────────────────────────────────────────────────────────────
VF="scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p"
COLOR_TAGS=(-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv)
X264_PARAMS=(-x264-params "aq-mode=3:deblock=-1,-1:psy-rd=1.0,0.15")
AF=""
[ -n "$LOUD_ARGS" ] && AF="loudnorm=I=${LUFS}:TP=${TP}:LRA=11${LOUD_ARGS}:linear=true"
AF_ARGS=()
[ -n "$AF" ] && AF_ARGS=(-af "$AF")
TUNE_ARGS=()
[ -n "$TUNE" ] && TUNE_ARGS=(-tune "$TUNE")

echo "[3/5] video encode (${W}x${H} @${FPS}fps, ${PLATFORM})"
if [ "$TWO_PASS" = "1" ]; then
  echo "      two-pass ${BITRATE}"
  "$FFMPEG" -y -hide_banner -loglevel error -i "$CONCAT" \
    -vf "$VF" -r "$FPS" -fps_mode cfr -c:v libx264 -preset "$PRESET" -b:v "$BITRATE" \
    -pass 1 -passlogfile "$TMP/passlog" -an -f null -
  "$FFMPEG" -y -hide_banner -loglevel error -i "$CONCAT" -i "$AUDIO" \
    -vf "$VF" -r "$FPS" -fps_mode cfr -c:v libx264 -preset "$PRESET" -b:v "$BITRATE" \
    -pass 2 -passlogfile "$TMP/passlog" "${X264_PARAMS[@]}" "${COLOR_TAGS[@]}" \
    -c:a aac -b:a "$ABR" -ar 48000 -ac 2 "${AF_ARGS[@]}" \
    -shortest -t "$DURATION" -movflags +faststart "$OUT"
else
  "$FFMPEG" -y -hide_banner -loglevel error -i "$CONCAT" -i "$AUDIO" \
    -vf "$VF" -r "$FPS" -fps_mode cfr -c:v libx264 -preset "$PRESET" -crf "$CRF" \
    -maxrate "$MAXRATE" -bufsize "$BUF" \
    "${TUNE_ARGS[@]}" "${X264_PARAMS[@]}" "${COLOR_TAGS[@]}" \
    -c:a aac -b:a "$ABR" -ar 48000 -ac 2 "${AF_ARGS[@]}" \
    -shortest -t "$DURATION" -movflags +faststart "$OUT"
fi

echo "[4/5] verify"
"$FFPROBE" -v error -count_frames -select_streams v:0 \
  -show_entries stream=codec_name,profile,pix_fmt,width,height,r_frame_rate,nb_read_frames,color_space,color_primaries,color_transfer,color_range \
  -show_entries format=duration,size,bit_rate -of json "$OUT" > "$TMP/probe.json"
[ -n "$PYTHON" ] && "$PYTHON" -m json.tool "$TMP/probe.json" || cat "$TMP/probe.json"

FINAL_FRAMES=$("$FFPROBE" -v error -count_frames -select_streams v:0 \
  -show_entries stream=nb_read_frames -of csv=p=0 "$OUT" | tr -d '\r')
SIZE_BYTES=$("$FFPROBE" -v error -show_entries format=size -of csv=p=0 "$OUT" | tr -d '\r')
SIZE_MB=$(awk "BEGIN { printf \"%.2f\", $SIZE_BYTES / 1048576 }")
echo "      ${FINAL_FRAMES:-?} frames, ${SIZE_MB} MB"
if [ "$STRICT" = "1" ] && [ "$FINAL_FRAMES" != "$EXPECTED" ]; then
  echo "ERROR: final frame count ${FINAL_FRAMES} != expected ${EXPECTED}" >&2
  exit 1
fi

if [ "$SPRITE" = "1" ]; then
  mkdir -p qa
  "$FFMPEG" -y -hide_banner -loglevel error -i "$OUT" \
    -vf "fps=1/2,scale=320:180,tile=6x6" -frames:v 1 qa/sprite.jpg
  echo "      sprite -> qa/sprite.jpg"
fi

echo "[5/5] done: $OUT  (${SIZE_MB} MB, ${PLATFORM})"
