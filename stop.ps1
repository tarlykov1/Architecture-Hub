# Stop only processes started by Architecture Hub start.ps1 (Windows PowerShell 5.1 safe).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
foreach ($slug in @('web','api')) {
  $file = Join-Path $root ".runtime\$slug.pid"
  if (-not (Test-Path $file)) {
    Write-Host "$slug : no tracked PID; process was not started by start.ps1."
    continue
  }
  $trackedId = 0
  if (-not [int]::TryParse((Get-Content $file -Raw).Trim(), [ref]$trackedId)) {
    Write-Warning "$slug : invalid PID file; skipped."
    continue
  }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$trackedId" -ErrorAction SilentlyContinue
  if (-not $proc) {
    Remove-Item $file -Force
    Write-Host "$slug : process already stopped."
    continue
  }
  $commandLine = [string]$proc.CommandLine
  $valid = if ($slug -eq 'api') { $commandLine -match 'uvicorn|python' } else { $commandLine -match 'npm|node|vite|cmd.exe' }
  if (-not $valid) {
    Write-Warning "$slug : PID $trackedId belongs to another application. Not stopping it."
    continue
  }
  & taskkill.exe /PID $trackedId /T /F | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Warning "$slug : taskkill reported an error; check port manually."; continue }
  Remove-Item $file -Force
  Write-Host "$slug : stopped."
}
Write-Host 'Wiki.js remains running in Docker.'
