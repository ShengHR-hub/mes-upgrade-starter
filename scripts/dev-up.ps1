# Secure local dev launcher for MES + AI.
#
# - DB password is read from the per-user secret store (HKCU\Environment MES_DB_PASSWORD,
#   set by scripts\input-db-password.ps1 through a masked local input). It is injected into
#   the child processes only via environment variables; never printed, never written to files,
#   never placed on a command line.
# - JWT_SECRET and AI_SERVICE_TOKEN are freshly generated random values in this process and
#   inherited by backend + ai-service; never printed or written.
# - Ports 3001/8000: only processes whose command line references THIS project are stopped.
#   Unrelated listeners are reported and left untouched.
# - Status (no secrets) is written to $env:TEMP\mes-dev-status.txt; PIDs to mes-dev-pids.txt.
#
# Usage: pwsh -NoProfile -File scripts\dev-up.ps1
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$statusFile = Join-Path $env:TEMP 'mes-dev-status.txt'
$pidFile = Join-Path $env:TEMP 'mes-dev-pids.txt'
Remove-Item $statusFile, $pidFile -ErrorAction SilentlyContinue

function Add-Status([string]$line) {
  Add-Content -Path $statusFile -Value $line -Encoding utf8
}

# ---- 1. DB password from per-user secret store ----
$dbPass = [Environment]::GetEnvironmentVariable('MES_DB_PASSWORD', 'User')
if ([string]::IsNullOrEmpty($dbPass)) {
  throw 'MES_DB_PASSWORD is not set. Run scripts\input-db-password.ps1 first and enter the MySQL password in the local masked dialog.'
}
$env:DB_PASSWORD = $dbPass

# ---- 2. In-memory secrets (>= 32 bytes entropy each) ----
$jwtBytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($jwtBytes)
$env:JWT_SECRET = [Convert]::ToBase64String($jwtBytes)
$tokenBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($tokenBytes)
$env:AI_SERVICE_TOKEN = [Convert]::ToBase64String($tokenBytes)

# ---- 3. Port safety: stop only project-owned processes ----
function Stop-ProjectPortProcess([int]$port) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    $procId = $c.OwningProcess
    if (-not $procId -or $procId -eq $PID) { continue }
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    if ($p -and $p.CommandLine -and $p.CommandLine.Contains($project)) {
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      Add-Status ("PORT {0}: stopped project-owned pid {1}" -f $port, $procId)
    } else {
      Add-Status ("PORT {0}: pid {1} not project-owned; left untouched" -f $port, $procId)
    }
  }
}
Stop-ProjectPortProcess 3001
Stop-ProjectPortProcess 8000
Stop-ProjectPortProcess 3000

# ---- 4. Start services (env inherited; no secrets on command lines) ----
$pids = @{}
$pids.Backend = (Start-Process pwsh -ArgumentList '-NoExit', '-Command', "Set-Location '$project\backend'; npm run start:dev" -PassThru).Id
$pids.AiService = (Start-Process pwsh -ArgumentList '-NoExit', '-Command', "Set-Location '$project\ai-service'; & '.\.venv\Scripts\python.exe' -m uvicorn main:app --host 127.0.0.1 --port 8000" -PassThru).Id
$pids.Frontend = (Start-Process pwsh -ArgumentList '-NoExit', '-Command', "Set-Location '$project\frontend'; npm run dev" -PassThru).Id
("Backend=$($pids.Backend) AiService=$($pids.AiService) Frontend=$($pids.Frontend)") | Out-File -FilePath $pidFile -Encoding utf8

# ---- 5. Health checks ----
# 严格判定（修复 2026-10-16 审查问题 1）：
# - curl 一律加 --noproxy '*'：本机透明代理会把未就绪的本地端口返回成 502，
#   造成「已响应但服务未起」的误导（本轮实际发生）；
# - 只有 HTTP 2xx 判定为健康；000（未监听）/ 3xx / 4xx / 5xx / timeout 全部判失败；
# - 任一服务不健康：状态文件记录 OVERALL=FAILED，脚本以退出码 1 结束（不再静默 DONE）。
function Wait-Http([string]$url, [int]$timeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = curl.exe -s -o NUL -w '%{http_code}' --noproxy '*' --max-time 5 $url 2>$null
      if ($r -match '^2\d\d$') { return $r }
    } catch { }
    Start-Sleep -Seconds 3
  }
  return 'timeout'
}

function Test-Healthy([string]$code) {
  return ($code -match '^2\d\d$')
}

$backendCode = Wait-Http 'http://127.0.0.1:3001/api/v1/health' 180
Add-Status "BACKEND_HEALTH_HTTP $backendCode"
try { $bh = curl.exe -s --noproxy '*' --max-time 10 'http://127.0.0.1:3001/api/v1/health' 2>$null } catch { $bh = '' }
Add-Status "BACKEND_HEALTH_BODY $bh"

$aiCode = Wait-Http 'http://127.0.0.1:8000/health' 120
Add-Status "AI_HEALTH_HTTP $aiCode"
try { $ah = curl.exe -s --noproxy '*' --max-time 10 'http://127.0.0.1:8000/health' 2>$null } catch { $ah = '' }
Add-Status "AI_HEALTH_BODY $ah"

$feCode = Wait-Http 'http://127.0.0.1:3000/login' 120
Add-Status "FRONTEND_LOGIN_HTTP $feCode"

$overall = 'OK'
if (-not (Test-Healthy $backendCode)) { $overall = 'FAILED' }
if (-not (Test-Healthy $aiCode)) { $overall = 'FAILED' }
if (-not (Test-Healthy $feCode)) { $overall = 'FAILED' }
Add-Status "OVERALL $overall"
if ($overall -eq 'OK') {
  Add-Status 'DONE'
  exit 0
} else {
  Write-Host "Service health check FAILED (backend=$backendCode ai=$aiCode frontend=$feCode)."
  Write-Host "See $statusFile for details. Services may still be starting; re-check with:"
  Write-Host "  curl.exe -s --noproxy * http://127.0.0.1:3001/api/v1/health"
  Write-Host "  curl.exe -s --noproxy * http://127.0.0.1:8000/health"
  Write-Host "  curl.exe -s --noproxy * -o NUL -w %{http_code} http://127.0.0.1:3000/login"
  exit 1
}
