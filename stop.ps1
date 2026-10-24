# Stop local Architecture Hub frontend/backend processes started by start.ps1.
# Wiki.js remains running to protect ongoing Wiki.js work; use docker compose down separately (without -v).
$root=$PSScriptRoot
foreach ($slug in @('web','api')) {
  $file=Join-Path $root ".runtime\$slug.pid"
  if (-not (Test-Path $file)) { continue }
  $processId = [int](Get-Content $file -Raw).Trim()
  $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
  if ($proc -and ($proc.CommandLine -match 'uvicorn|npm|vite|node')) {
    & taskkill.exe /PID $processId /T /F | Out-Null
    Write-Host "$slug – остановлен."
  } else { Write-Warning "$slug: PID $processId больше не относится к приложению; пропускаю." }
  Remove-Item $file -Force
}
Write-Host 'Wiki.js не остановлен (его Docker Compose живёт отдельно).'
