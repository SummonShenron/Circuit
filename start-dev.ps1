$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = "$root\.venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    throw "Project Python was not found at $python. Create or select the .venv environment first."
}

$occupiedPorts = Get-NetTCPConnection -State Listen -LocalPort 8010, 8090 -ErrorAction SilentlyContinue
if ($occupiedPorts) {
    $ports = ($occupiedPorts | Select-Object -ExpandProperty LocalPort -Unique) -join ", "
    throw "Port(s) $ports are already in use. Run .\stop-dev.ps1, then try again."
}

Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$root\backend'; & '$python' run.py"
)

Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "npm --prefix '$root\frontend' run dev"
)

Write-Host "Starting backend at http://127.0.0.1:8010 with Uvicorn reload."
Write-Host "Starting frontend at http://127.0.0.1:8090 with Vite hot reload."
