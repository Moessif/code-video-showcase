# install.ps1 — Windows 一键准备（v2.5.2 重写：v2.4 版所有 $ 变量被剥光，PowerShell 必 ParseError）
# 用法：powershell -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host '✗ 没有找到 Node.js。安装 Node.js 22 LTS：https://nodejs.org/' -ForegroundColor Red
  Write-Host '  装好后重新执行：powershell -ExecutionPolicy Bypass -File install.ps1'
  exit 14
}

$nodeVersion = (& node -p 'process.versions.node').Trim()
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 22) {
  Write-Host "✗ Node.js $nodeVersion 太旧；本项目需要 >= 22（raw CDP 依赖全局 WebSocket）。" -ForegroundColor Red
  Write-Host '  下载：https://nodejs.org/en/download'
  exit 14
}
Write-Host "✓ Node.js $nodeVersion"

if (Test-Path package-lock.json) {
  Write-Host '→ npm ci（严格按 lock 安装）'
  npm ci
} else {
  Write-Host '→ npm install'
  npm install
}
if ($LASTEXITCODE -ne 0) {
  Write-Host '✗ 依赖安装失败。离线环境见 docs/OFFLINE.md（arm.sh --offline / npm ci --offline）。' -ForegroundColor Red
  exit 14
}

Write-Host ''
Write-Host '→ 环境探测（doctor）'
node scripts/doctor.mjs
$doc = $LASTEXITCODE

Write-Host ''
if ($doc -ne 0) {
  Write-Host '下一步（先补齐 doctor 报缺失的项，每条 fix 都有命令）：' -ForegroundColor Yellow
} else {
  Write-Host '下一步：'
}
Write-Host '  node bin/cvs.mjs new "做一条 20 秒国风宣传片" --out project.spec.json'
Write-Host '  node bin/cvs.mjs build project.spec.json --platform douyin --strict'
Write-Host '  # 可选图形入口：node bin/cvs.mjs wizard   → http://127.0.0.1:5181/app/wizard/'
exit $doc
