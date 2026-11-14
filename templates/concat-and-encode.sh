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
TRANSITION=""; TD=""; OFFSETS=""
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
    --transition) TRANSITION="$2"; shift 2 ;;
    --td) TD="$2"; shift 2 ;;
    --offsets) OFFSETS="$2"; shift 2 ;;
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
SAFE_LIST=""
trap 'rm -rf "$TMP" ${SAFE_LIST:+"$SAFE_LIST"}' EXIT
CONCAT="$TMP/concat.mp4"

# ── v2.4 / P1-10: concat list sanitisation ──────────────────────────────────
# Never fall back to unsafe mode. Every list is rewritten next to the segments
# as relative names: no absolute paths, drive letters, UNC, '..', quotes or
# newlines. A list line cannot point ffmpeg outside its own directory.
to_msys() { printf '%s' "$1" | sed 's|\\|/|g'; }
abspath_file() {
  local p="$1" d b
  d=$(dirname "$p"); b=$(basename "$p")
  if [ -d "$d" ]; then printf '%s/%s\n' "$(cd "$d" && pwd)" "$b"; else printf '%s\n' "$p"; fi
}
SEGLIST="$(to_msys "$SEGLIST")"
AUDIO="$(to_msys "$AUDIO")"
OUT="$(to_msys "$OUT")"
SEGLIST="$(abspath_file "$SEGLIST")"
AUDIO="$(abspath_file "$AUDIO")"
OUT="$(abspath_file "$OUT")"
LIST_DIR="$(dirname "$SEGLIST")"
SAFE_LIST="$LIST_DIR/.cvs-concat-$$.txt"
: > "$SAFE_LIST"
SEGS=()
while IFS= read -r line || [ -n "$line" ]; do
  [ -z "$line" ] && continue
  case "$line" in
    file\ *) ;;
    *) echo "[concat] invalid list line: $line" >&2; exit 12 ;;
  esac
  f="${line#file }"
  f="${f#\'}"; f="${f%\'}"
  f="${f//\'\\\'\'/\'}"
  case "$f" in
    /*|[A-Za-z]:[\\/]*|\\\\*) abs="$f" ;;
    *) abs="$LIST_DIR/$f" ;;
  esac
  abs="$(abspath_file "$abs")"
  case "$abs" in
    "$LIST_DIR"/*) rel="${abs#"$LIST_DIR"/}" ;;
    *) echo "[concat] unsafe entry outside list dir: $abs" >&2; exit 12 ;;
  esac
  case "$rel" in
    *\'*|*$'\n'*|*$'\r'*|*:*) echo "[concat] unsafe entry: $rel" >&2; exit 12 ;;
  esac
  [ -f "$abs" ] || { echo "[concat] missing segment: $abs" >&2; exit 12; }
  SEGS+=("$abs")
  printf "file '%s'\n" "$rel" >> "$SAFE_LIST"
done < "$SEGLIST"
SAFE_BASE="$(basename "$SAFE_LIST")"

# ── v2.5: xfade transitions ─────────────────────────────────────────────────
# Offsets come from the plan (templates/transitions.mjs is the single source of
# truth); the shell only applies them. Each input is normalised to the target
# size/fps/pixfmt first so xfade never sees mismatched formats.
if [ -n "$TRANSITION" ] && [ "${#SEGS[@]}" -ge 2 ] && [ -n "$OFFSETS" ]; then
  echo "[1/5] concat segments (xfade=${TRANSITION}, td=${TD}s)"
  INPUTS=()
  NORM=""
  for i in "${!SEGS[@]}"; do
    INPUTS+=(-i "${SEGS[$i]}")
    NORM+="[${i}:v]fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p[v${i}];"
  done
  IFS=',' read -r -a OFF <<< "$OFFSETS"
  GRAPH="$NORM"
  PREV="[v0]"
  for k in "${!OFF[@]}"; do
    nxt=$((k + 1))
    if [ "$k" -eq $(( ${#OFF[@]} - 1 )) ]; then OUTLBL="[vout]"; else OUTLBL="[vx${k}]"; fi
    GRAPH+="${PREV}[v${nxt}]xfade=transition=${TRANSITION}:duration=${TD}:offset=${OFF[$k]}${OUTLBL};"
    PREV="$OUTLBL"
  done
  GRAPH="${GRAPH%;}"
  # Memory bound (v2.5): an N-input xfade graph decodes all N segments at once.
  # With default threads + x264 lookahead this exhausts commit on Windows and
  # surfaces as "x264 malloc failed" / bogus "decode_slice_header error". Cap
  # decoder threads, run the (sequential) filter graph single-threaded, and
  # shrink x264's lookahead so peak RSS stays flat regardless of segment count.
  if ! "$FFMPEG" -y -hide_banner -loglevel error -threads 2 -filter_complex_threads 1 "${INPUTS[@]}" \
      -filter_complex "$GRAPH" -map "[vout]" \
      -c:v libx264 -preset veryfast -crf 12 -pix_fmt yuv420p \
      -x264-params "rc-lookahead=8:sync-lookahead=0:threads=2" \
      -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv "$CONCAT" 2>"$TMP/concat.err"; then
    echo "[concat] xfade failed:" >&2; sed -n '1,5p' "$TMP/concat.err" >&2 || true; exit 12
  fi
else
echo "[1/5] concat segments (stream copy, -safe 1)"
if ! ( cd "$LIST_DIR" && "$FFMPEG" -y -hide_banner -loglevel error -f concat -safe 1 -i "$SAFE_BASE" -c copy "$CONCAT" ) 2>"$TMP/concat.err"; then
  echo "      stream-copy concat failed; normalising re-encode"
  sed -n '1,3p' "$TMP/concat.err" >&2 || true
  ( cd "$LIST_DIR" && "$FFMPEG" -y -hide_banner -loglevel error -f concat -safe 1 -i "$SAFE_BASE" \
    -vf "fps=${FPS},setsar=1,scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black" \
    -c:v libx264 -preset veryfast -crf 12 -pix_fmt yuv420p \
    -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv "$CONCAT" )
fi
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
# R2-21（N03-F3）：GOP ≤ 2s——旧版无 keyint 控制，成片最大 GOP 242 帧(8s)，
# 平台必判"需重转"。R2-22（N03-F4）：固定 level，不再让 x264 按 CPB 反推出
# master 5.0 / douyin 4.0 互相打架（1080p→4.1，更大画幅→5.0）。
GOP=$((FPS * 2)); KEYMIN=$((FPS / 2)); [ "$KEYMIN" -lt 1 ] && KEYMIN=1
LEVEL="4.1"; [ $((W * H)) -gt 2211840 ] && LEVEL="5.0"
LEVEL_ARGS=(-profile:v high -level:v "$LEVEL")
# R2-11（N04-F1）：固定线程数 + bitexact → 同 spec 同环境逐字节可复现。
# 旧版 auto 线程数随调度漂移，两次全缓存构建的 master.mp4 sha256 不同，
# 与 SKILL「确定性」卖点直接矛盾。threads=2 与 xfade 中间层一致。
X264_PARAMS=(-x264-params "aq-mode=3:deblock=-1,-1:psy-rd=1.0,0.15:keyint=${GOP}:min-keyint=${KEYMIN}:scenecut=40:threads=2:lookahead_threads=1")
BITEXACT=(-fflags +bitexact -flags +bitexact)
# R2-01（N03+N07 交叉实证）：loudnorm 之后接**真峰限幅**——4× 过采样让 alimiter
# 看见 inter-sample 峰。limit=0.562(-5dBFS)：AAC 重建过冲随码率降低而增大
# （master 320k ~+1.6dB，平台 192k ~+3dB）；-5dBFS 广播级保守天花板留足余量
# → 全件 post-AAC ≤ -1dBTP（实测 master -2 / douyin -1.5）。响度仍守 -14±1 LUFS。
LIMITER="aresample=192000,alimiter=limit=0.562:attack=1:release=50:level=false,aresample=48000"
AF="$LIMITER"
[ -n "$LOUD_ARGS" ] && AF="loudnorm=I=${LUFS}:TP=${TP}:LRA=11${LOUD_ARGS}:linear=true,${LIMITER}"
AF_ARGS=(-af "$AF")
TUNE_ARGS=()
[ -n "$TUNE" ] && TUNE_ARGS=(-tune "$TUNE")

echo "[3/5] video encode (${W}x${H} @${FPS}fps, ${PLATFORM}, level ${LEVEL}, GOP ${GOP})"
if [ "$TWO_PASS" = "1" ]; then
  echo "      two-pass ${BITRATE}"
  # R2-23（N03-F5）：pass1 必须与 pass2 共用同一套 x264/色彩参数——
  # 旧版 pass1 缺 X264_PARAMS，AQ/cutree 统计自始错误，率控预测失真。
  "$FFMPEG" -y -hide_banner -loglevel error -i "$CONCAT" \
    -vf "$VF" -r "$FPS" -fps_mode cfr -c:v libx264 -preset "$PRESET" -b:v "$BITRATE" \
    "${X264_PARAMS[@]}" "${COLOR_TAGS[@]}" "${LEVEL_ARGS[@]}" "${BITEXACT[@]}" \
    -pass 1 -passlogfile "$TMP/passlog" -an -f null -
  "$FFMPEG" -y -hide_banner -loglevel error -i "$CONCAT" -i "$AUDIO" \
    -vf "$VF" -r "$FPS" -fps_mode cfr -c:v libx264 -preset "$PRESET" -b:v "$BITRATE" \
    -pass 2 -passlogfile "$TMP/passlog" "${X264_PARAMS[@]}" "${COLOR_TAGS[@]}" "${LEVEL_ARGS[@]}" "${BITEXACT[@]}" \
    -c:a aac -b:a "$ABR" -ar 48000 -ac 2 "${AF_ARGS[@]}" \
    -shortest -t "$DURATION" -movflags +faststart "$OUT"
else
  "$FFMPEG" -y -hide_banner -loglevel error -i "$CONCAT" -i "$AUDIO" \
    -vf "$VF" -r "$FPS" -fps_mode cfr -c:v libx264 -preset "$PRESET" -crf "$CRF" \
    -maxrate "$MAXRATE" -bufsize "$BUF" \
    "${TUNE_ARGS[@]}" "${X264_PARAMS[@]}" "${COLOR_TAGS[@]}" "${LEVEL_ARGS[@]}" "${BITEXACT[@]}" \
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
