$listeners = Get-NetTCPConnection -State Listen -LocalPort 8010, 8090 -ErrorAction SilentlyContinue

if (-not $listeners) {
    Write-Host "No Circuit development servers are listening on ports 8010 or 8090."
    return
}

$listeners | ForEach-Object {
    $process = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    if ($process) {
        Stop-Process -Id $_.OwningProcess -Force
        Write-Host "Stopped $($process.ProcessName) on port $($_.LocalPort)."
    } else {
        Write-Warning "Could not find the process for port $($_.LocalPort). Restart Windows to clear this orphaned listener."
    }
}
