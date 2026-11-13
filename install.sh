#!/usr/bin/env bash
# install.sh — 一条命令把本仓库准备到「能跑 cvs build」的状态（v2.4 / P1-11）。
#
#   bash install.sh
#
# 做什么：检查 Node 22+ → npm ci（无 lock 时 npm install）→ doctor 环境探测 → 打印下一步。
# 不做什么：不装 Chrome/FFmpeg/Python（操作系统级依赖，doctor 会告诉你缺什么）。
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '%s\n' "$*"; }

if ! command -v node >/dev/null 2>&1; then
  say "✗ 没有找到 Node.js。"
  say "  安装 Node.js 22 LTS：https://nodejs.org/ （或 nvm install 22）"
  say "  装好后重新执行：bash install.sh"
  exit 14
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "${NODE_MAJOR:-0}" -lt 22 ]; then
  say "✗ Node.js $(node -v) 太旧；本项目需要 >=22（raw CDP 使用全局 WebSocket）。"
  say "  nvm install 22 && nvm use 22"
  exit 14
fi
say "✓ Node.js $(node -v)"

if [ -f package-lock.json ]; then
  say "→ npm ci"
  npm ci
else
  say "→ npm install（没有 package-lock.json）"
  npm install
fi

say ""
say "→ 环境探测（doctor）"
node scripts/doctor.mjs || true

say ""
say "下一步："
say "  node app/wizard/serve.mjs          # 打开 http://127.0.0.1:5181/app/wizard/"
say "  node bin/cvs.mjs new \"做一条 20 秒国风宣传片\" --out project.spec.json"
say "  node bin/cvs.mjs build project.spec.json --platform douyin --strict"
say ""
say "只想要图片：node bin/cvs.mjs image --spec project.spec.json"
