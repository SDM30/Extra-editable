Param(
    [string]$JwtSecret = "jwt-secreto",
    [switch]$StartFrontend,
    [switch]$ForceKill
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Host "Starting services from $root with JWT_SECRET=$JwtSecret"

# Helper: get PIDs listening on a local port (uses Get-NetTCPConnection when available, else netstat)
function Get-PidsByPort([int]$port) {
    $pids = @()
    if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
        $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if ($conns) { $conns | ForEach-Object { if ($_.OwningProcess) { $pids += $_.OwningProcess } } }
    } else {
        $lines = netstat -ano | Select-String ":$port\s"
        foreach ($l in $lines) {
            $parts = ($l -replace '^\s+','') -split '\s+'
            $pid = $parts[-1]
            if ($pid -match '^[0-9]+$') { $pids += [int]$pid }
        }
    }
    return $pids | Select-Object -Unique
}

# If ForceKill not set, show occupied ports and optionally prompt
if (-not $ForceKill) {
    $occupied = @{}
    foreach ($port in 1234,1235,1236) {
        $pids = Get-PidsByPort $port
        if ($pids.Count -gt 0) { $occupied[$port] = $pids }
    }
    if ($occupied.Count -gt 0) {
        Write-Host "The following ports are occupied:" -ForegroundColor Yellow
        foreach ($k in $occupied.Keys) { Write-Host "  Port $k -> PIDs: $($occupied[$k] -join ', ')" }
        $ans = Read-Host "Do you want to continue and skip killing these processes? (Y/N)"
        if ($ans -match '^[Nn]') { Write-Host "Aborting start."; return }
    }
} else {
    # Force kill processes on target ports
    foreach ($port in 1234,1235,1236) {
        $pids = Get-PidsByPort $port
        foreach ($pid in $pids) {
            try {
                Stop-Process -Id $pid -Force -ErrorAction Stop
                Write-Host "Killed PID $pid on port $port"
            } catch {
                Write-Warning ("Failed to kill PID {0} on port {1}: {2}" -f $pid, $port, $_)
            }
        }
    }
}

# Determine PowerShell executable (prefer pwsh, fallback to powershell)
$pwshCmd = Get-Command pwsh -ErrorAction SilentlyContinue
if ($pwshCmd) { $pwshExe = $pwshCmd.Source } else {
    $psCmd = Get-Command powershell -ErrorAction SilentlyContinue
    if ($psCmd) { $pwshExe = $psCmd.Source } else { Write-Error "No PowerShell executable (pwsh or powershell) found in PATH."; return }
}

# Start backend in a new PowerShell window
$backendCmd = "Set-Location -LiteralPath '$root\backend'; `$env:JWT_SECRET='$JwtSecret'; python manage.py runserver 8000"
Start-Process -FilePath $pwshExe -ArgumentList @('-NoExit', '-Command', $backendCmd)
Write-Host "Backend started (new window)"

# Start three collab-service instances, each in its own window
foreach ($port in 1234,1235,1236) {
    $cmd = "Set-Location -LiteralPath '$root\collab-service'; `$env:PORT=$port; `$env:JWT_SECRET='$JwtSecret'; node src/server.js"
    Start-Process -FilePath $pwshExe -ArgumentList @('-NoExit', '-Command', $cmd)
    Write-Host "Started collab-service on port $port"
}

if ($StartFrontend) {
    $frontendCmd = "Set-Location -LiteralPath '$root\frontend'; npm start"
    Start-Process -FilePath $pwshExe -ArgumentList @('-NoExit', '-Command', $frontendCmd)
    Write-Host "Frontend started (new window)"
}

Write-Host "All start commands issued. Check the new windows for logs."
