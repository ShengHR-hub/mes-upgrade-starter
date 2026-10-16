$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Stop-PortProcess([int]$port) {
  $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    if ($listener.OwningProcess -and $listener.OwningProcess -ne $PID) {
      Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
}

Stop-PortProcess 3001
Stop-PortProcess 8000

$jwtBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($jwtBytes)
$env:JWT_SECRET = [Convert]::ToBase64String($jwtBytes)
$env:AI_SERVICE_TOKEN = [Guid]::NewGuid().ToString('N')

$backendCommand = "Set-Location '$project\backend'; npm run start:dev"
$aiCommand = "Set-Location '$project\ai-service'; python -m uvicorn main:app --host 127.0.0.1 --port 8000"

Start-Process pwsh -ArgumentList '-NoExit', '-Command', $backendCommand
Start-Process pwsh -ArgumentList '-NoExit', '-Command', $aiCommand

Write-Host 'Backend and AI service started with shared in-memory secrets.'
Write-Host 'Start the frontend separately with: cd frontend; npm run dev'
Write-Host 'Secrets are not printed or written to disk.'
