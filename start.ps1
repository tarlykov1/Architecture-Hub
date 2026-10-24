# Start Architecture Hub on Windows: local SQLite API + Vite + Docker Wiki.js.
# Usage: powershell -ExecutionPolicy Bypass -File .\start.ps1
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$runtime = Join-Path $root '.runtime'
New-Item -Path $runtime -ItemType Directory -Force | Out-Null

function Test-Service([int]$Port) {
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $result = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    $connected = $result.AsyncWaitHandle.WaitOne(700)
    if ($connected) { $client.EndConnect($result) }
    $client.Close()
    return $connected
  } catch { return $false }
}
function Test-HttpService([string]$Label,[int]$Port) {
  if (-not (Test-Service $Port)) { return $false }
  $uri = if ($Label -eq 'api') { "http://127.0.0.1:$Port/api/health" } else { "http://127.0.0.1:$Port/" }
  try {
    $response = Invoke-WebRequest -Uri $uri -TimeoutSec 3 -UseBasicParsing -MaximumRedirection 5
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 400) { return $false }
    if ($Label -eq 'api') {
      $json = $response.Content | ConvertFrom-Json
      return $json.status -eq 'ok'
    }
    if ($Label -eq 'web') {
      return ([string]$response.Content).Contains('id="root"')
    }
    return $true
  } catch { return $false }
}
function Wait-Service([int]$Port, [int]$Seconds = 30, [string]$Label = 'wiki') {
  for ($i=0; $i -lt $Seconds; $i++) {
    if (Test-HttpService $Label $Port) { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}
function Start-LocalProcess([string]$Label, [string]$Exe, [string]$Arguments, [string]$Directory, [int]$Port) {
  if (Test-Service $Port) {
    if (-not (Test-HttpService $Label $Port)) { throw "Port $Port is occupied, but $Label health check failed. Stop the unrelated or broken process manually." }
    Write-Host "  $Label healthy on port $Port; existing process is NOT restarted." -ForegroundColor Yellow
    Write-Host "  Run .\\stop.ps1 before pulling updates. If it is untracked, stop the old process manually." -ForegroundColor Yellow
    return
  }
  $slug = $Label.ToLowerInvariant()
  $output = Join-Path $runtime "$slug.out.log"
  $errors = Join-Path $runtime "$slug.err.log"
  # Redirected streams go to files so no extra console windows are needed.
  $proc = Start-Process -FilePath $Exe -ArgumentList $Arguments -WorkingDirectory $Directory -RedirectStandardOutput $output -RedirectStandardError $errors -PassThru -WindowStyle Hidden
  Set-Content -Path (Join-Path $runtime "$slug.pid") -Value $proc.Id
  if (-not (Wait-Service $Port 35 $Label)) {
    Write-Host "  $Label failed. Log: $errors" -ForegroundColor Red
    if (Test-Path $errors) { Get-Content $errors -Tail 18 }
    throw "Unable to start $Label on port $Port."
  }
  Write-Host "  $Label ready on port $Port" -ForegroundColor Green
}

Write-Host "Architecture Hub - starting services" -ForegroundColor Cyan
$python = Join-Path $root 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path $python)) {
  throw "Python environment not found: $python. Set up backend venv first."
}
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { throw 'npm.cmd not found. Install Node.js first.' }
if (-not (Test-Path (Join-Path $root 'frontend\node_modules'))) {
  throw 'Frontend dependencies missing. Run: cd frontend; npm install'
}

# Wiki.js runs in its existing Docker Compose project and keeps its PostgreSQL volume.
if (Test-HttpService 'wiki' 3000) {
  Write-Host '  Wiki.js responded successfully over HTTP.' -ForegroundColor Green
} else {
  if (Test-Service 3000) {
    Write-Warning 'Wiki.js port 3000 is occupied but HTTP check failed. Existing container may still be starting or unhealthy.'
  } elseif (-not (Test-Path (Join-Path $root '.env'))) {
    Write-Warning 'Wiki.js was not started: .env is missing. Keep the existing Wiki DB password; do not regenerate it.'
  } else {
    try {
      docker info --format '{{.ServerVersion}}' 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop engine is not running' }
      Push-Location $root
      try {
        docker compose -f compose.wikijs.yml up -d
        if ($LASTEXITCODE -ne 0) { throw 'Docker Compose failed' }
      } finally { Pop-Location }
      if (Wait-Service 3000 60 'wiki') {
        Write-Host '  Wiki.js responded successfully over HTTP.' -ForegroundColor Green
      } else { Write-Warning 'Wiki.js did not start. See: docker compose -f compose.wikijs.yml logs wiki' }
    } catch {
      Write-Warning "Wiki.js unavailable: $($_.Exception.Message). Check Docker and .env."
    }
  }
}

Start-LocalProcess -Label 'api' -Exe $python -Arguments '-m uvicorn app.main:app --host 127.0.0.1 --port 8001' -Directory (Join-Path $root 'backend') -Port 8001
$env:VITE_API_TARGET = 'http://127.0.0.1:8001'
Start-LocalProcess -Label 'web' -Exe $npm.Source -Arguments 'run dev -- --host 127.0.0.1 --port 5174 --strictPort' -Directory (Join-Path $root 'frontend') -Port 5174

Write-Host ''
Write-Host 'Web:       http://127.0.0.1:5174/' -ForegroundColor Cyan
Write-Host 'API:       http://127.0.0.1:8001/api/health'
Write-Host 'Wiki.js:   http://127.0.0.1:3000/'
Write-Host "Logs:      $runtime"
