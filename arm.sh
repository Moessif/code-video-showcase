#!/usr/bin/env bash
# arm.sh — bootstrap code-video-showcase on this machine. Idempotent.
#
#   bash arm.sh              # verify + install deps + build fonts + smoke render
#   bash arm.sh --offline    # install from vendor/ with no network
#   SKIP_SMOKE=1 bash arm.sh # verify + install only, no render
#
# Verified target: Windows 10/11 + Git Bash, Node 22+, FFmpeg (libx264/AAC),
# Python 3.10+ with numpy+scipy, Chrome or Edge installed.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || exit 1
fail=0
ok()   { printf '  [ok]   %s\n' "$1"; }
bad()  { printf '  [FAIL] %s\n' "$1"; fail=1; }
warn() { printf '  [warn] %s\n' "$1"; }

echo "== 1. toolchain =="
have() { command -v "$1" >/dev/null 2>&1; }

if have node; then
  nv="$(node --version)"; case "$nv" in v2[2-9]*|v[3-9][0-9]*) ok "node $nv";; *) bad "node $nv (need >= 22)";; esac
else bad "node not found"; fi

if have ffmpeg; then
  fl="$(ffmpeg -version 2>/dev/null | head -1)"
  if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q 'libx264'; then
    ok "ffmpeg ($fl) with libx264"
  else
    bad "ffmpeg without libx264 encoder: $fl"
  fi
else bad "ffmpeg not found"; fi

have ffprobe && ok "ffprobe" || bad "ffprobe not found"

if have python; then
  py="$(python --version 2>&1)"
  # Import the modules synth_audio.py actually uses: a bare `import scipy` is lazy and
  # can pass while scipy.signal / scipy.io.wavfile still fail to load their BLAS DLLs.
  if python -c "import numpy, scipy.signal, scipy.io.wavfile" >/dev/null 2>&1; then
    ok "$py with numpy+scipy ($(python -c 'import numpy,scipy;print(numpy.__version__+"/"+scipy.__version__)'))"
  else bad "$py cannot import numpy/scipy.signal/scipy.io.wavfile  ->  python -m pip install -U numpy scipy"; fi
else bad "python not found"; fi

echo "== 2. browser =="
CANDIDATES=(
  "${CHROME_EXE:-}"
  "C:/Program Files/Google/Chrome/Application/chrome.exe"
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe"
)
BROWSER=""
for c in "${CANDIDATES[@]}"; do [ -n "$c" ] && [ -f "$c" ] && { BROWSER="$c"; break; }; done
if [ -n "$BROWSER" ]; then
  export CHROME_EXE="$BROWSER"
  ok "browser: $BROWSER"
  echo "         export CHROME_EXE=\"$BROWSER\"   # required for render-segment.mjs"
else
  warn "no Chrome/Edge found at known paths; renderer will try Playwright bundled Chromium"
fi

echo "== 3. node deps =="
if [ -d node_modules/playwright-core ] || [ -d node_modules/playwright ]; then
  ok "node deps installed"
else
  if [ "${CVS_OFFLINE:-0}" = "1" ] || [ "${1:-}" = "--offline" ]; then
    if [ -f vendor/manifest.json ]; then
      echo "  ... offline: fill npm cache from vendor/*.tgz"
      npm cache add vendor/*.tgz --cache "$ROOT/vendor/npm-cache" >/dev/null 2>&1 \
        || bad "npm cache add failed"
      npm ci --offline --no-audit --no-fund --cache "$ROOT/vendor/npm-cache" >/dev/null 2>&1 \
        && ok "offline npm ci" || bad "offline npm ci failed (vendor/ incomplete?)"
    else
      bad "offline requested but vendor/ is missing (run: node scripts/vendor.mjs on a networked machine)"
    fi
  else
    echo "  ... npm ci (lockfile-pinned)"
    npm ci --no-audit --no-fund >/dev/null 2>&1 \
      && ok "npm ci" || bad "npm ci failed (check package-lock.json; do not fall back to npm install)"
  fi
fi

echo "== 4. local fonts (kills the /shared/fonts.css 404) =="
if [ -f shared/fonts.css ] && [ -d shared/fonts ]; then
  ok "shared/fonts.css present ($(ls shared/fonts | wc -l) woff2)"
elif [ -d node_modules/@fontsource ]; then
  node scripts/build-fonts.mjs && ok "built shared/fonts.css" || bad "build-fonts.mjs failed"
else
  warn "skipped: no @fontsource packages"
fi

if [ "${SKIP_SMOKE:-0}" = "1" ]; then
  echo "== smoke render skipped (SKIP_SMOKE=1) =="
else
  echo "== 5. smoke render =="
  rm -rf out/arm-smoke
  if node templates/render-segment.mjs --page templates/segment.html \
       --out out/arm-smoke/seg.mp4 --duration 3 >out/arm-smoke.log 2>&1; then
    nb="$(ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames -of csv=p=0 out/arm-smoke/seg.mp4 2>/dev/null | tr -d '\r')"
    if [ "$nb" = "90" ]; then ok "rendered 90 frames @30fps (out/arm-smoke/seg.mp4)"
    else warn "rendered but frame count = ${nb:-?} (expected 90)"; fi
    grep -q "page errors" out/arm-smoke.log && warn "page reported console errors:
$(sed -n '/page errors/,$p' out/arm-smoke.log)" || ok "no page console errors"
  else
    bad "smoke render failed; see out/arm-smoke.log"
  fi
fi

echo
if [ "$fail" = "0" ]; then echo "ARMED. Next: read ARMED.md, then start a film from templates/."
else echo "NOT ARMED — fix the [FAIL] lines above."; fi
exit "$fail"
