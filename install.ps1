# install.ps1 — Windows 一键准备（v2.4 / P1-11）
# 用法：powershell -ExecutionPolicy Bypass -File install.ps1
 = 'Stop'
Set-Location 
 = Get-Command node -ErrorAction SilentlyContinue
if (-not ) {
  Write-Host '✗ 没有找到 Node.js。安装 Node.js 22 LTS：https://nodejs.org/' -ForegroundColor Red
  Write-Host '  装好后重新执行：powershell -ExecutionPolicy Bypass -File install.ps1'
  exit 14
}
 = [int](node -p "process.versions.node.split('.')[0]")
if ( -lt 22) {
  Write-Host "✗ Node.js 24.22.1 太旧；本项目需要 >=22。" -ForegroundColor Red
  exit 14
}
Write-Host "✓ Node.js 24.22.1"

if (Test-Path package-lock.json) {
  Write-Host '→ npm ci'
  npm ci
} else {
  Write-Host '→ npm install'
  npm install
}

Write-Host ''
Write-Host '→ 环境探测（doctor）'
node scripts/doctor.mjs

Write-Host ''
Write-Host '下一步：'
Write-Host '  node app/wizard/serve.mjs          # http://127.0.0.1:5181/app/wizard/'
Write-Host '  node bin/cvs.mjs new "做一条 20 秒国风宣传片" --out project.spec.json'
Write-Host '  node bin/cvs.mjs build project.spec.json --platform douyin --strict'
