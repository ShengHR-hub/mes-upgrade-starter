param(
  [Parameter(Mandatory=$true)][string]$Database,
  [string]$DbHost = '127.0.0.1',
  [int]$DbPort = 3306,
  [string]$DbUsername = 'root'
)
$ErrorActionPreference = 'Stop'
# Run from a local terminal; never paste credentials or tokens into chat.
# Only use an approved test database, never the production database.
$project = Split-Path $PSScriptRoot -Parent
$review = Join-Path ([IO.Path]::GetTempPath()) ('mes-s12-'+[guid]::NewGuid().ToString('N'))
$keys = @('DB_HOST','DB_PORT','DB_USERNAME','DB_DATABASE','DB_PASSWORD','DB_LOGGING','JWT_SECRET')
$previous = @{}
foreach ($key in $keys) { $previous[$key] = [Environment]::GetEnvironmentVariable($key,'Process') }
$secure = $null
$plainPtr = [IntPtr]::Zero
try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { $env:PATH = 'D:\Node;' + $env:PATH }
  $secure = Read-Host 'Local MySQL test password (hidden; not saved)' -AsSecureString
  $plainPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $env:DB_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($plainPtr)
  if (-not $env:DB_PASSWORD) { throw 'Empty password: tests not executed' }
  $env:DB_HOST=$DbHost; $env:DB_PORT=[string]$DbPort; $env:DB_USERNAME=$DbUsername; $env:DB_DATABASE=$Database
  $env:DB_LOGGING='false'
  $random = New-Object byte[] 48
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($random) } finally { $rng.Dispose() }
  $env:JWT_SECRET=[Convert]::ToBase64String($random)
  New-Item -ItemType Directory -Path $review | Out-Null
  $source=Join-Path $project 'backend'
  & robocopy $source $review /E /XD node_modules dist .git /XF .env .env.* *.tsbuildinfo /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw 'Cannot prepare temporary test copy' }
  New-Item -ItemType Junction -Path (Join-Path $review 'node_modules') -Target (Join-Path $source 'node_modules') | Out-Null
  Push-Location $review
  try {
    Write-Host 'Running real MySQL tests. Test fixtures only; no schema import or table clearing.'
    & npm.cmd run test:e2e:db
    if ($LASTEXITCODE -ne 0) { throw 'Database suite failed; preserve sanitized output for review' }
  } finally { Pop-Location }
  Write-Host 'Database suite exited successfully. This does not approve production deployment.'
} finally {
  if ($plainPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($plainPtr) }
  if ($secure) { $secure.Dispose() }
  foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key,$previous[$key],'Process') }
  Write-Host ('Temporary source/evidence location: '+$review)
}
