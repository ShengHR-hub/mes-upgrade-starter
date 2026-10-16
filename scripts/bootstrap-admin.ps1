param(
  [string]$BackendPath = (Join-Path $PSScriptRoot '..\backend'),
  [string]$Username = 'admin'
)

$ErrorActionPreference = 'Stop'
$backend = (Resolve-Path $BackendPath).Path
$envPath = Join-Path $backend '.env'
if (-not (Test-Path $envPath)) {
  throw "Missing $envPath. Copy backend/.env.example to backend/.env and configure the local MySQL connection first."
}

Get-Content $envPath | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$' -and $matches[1] -ne 'DB_PASSWORD') {
    [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
  }
}
$env:DB_PASSWORD = Read-Host 'MySQL password' -AsSecureString | ConvertFrom-SecureString -AsPlainText
$env:MES_BOOTSTRAP_PASSWORD = Read-Host "New password for $Username" -AsSecureString | ConvertFrom-SecureString -AsPlainText
$env:MES_BOOTSTRAP_USERNAME = $Username

Push-Location $backend
try {
  node (Join-Path $PSScriptRoot 'bootstrap-admin.mjs')
} finally {
  Remove-Item Env:DB_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:MES_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:MES_BOOTSTRAP_USERNAME -ErrorAction SilentlyContinue
  Pop-Location
}
