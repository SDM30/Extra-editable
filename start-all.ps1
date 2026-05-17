Param(
    [string]$JwtSecret = "jwt-secreto",
    [switch]$StartFrontend
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Host "Starting services from $root with JWT_SECRET=$JwtSecret"

# Start backend in a new PowerShell window
$backendCmd = "Set-Location -LiteralPath '$root\backend'; `$env:JWT_SECRET='$JwtSecret'; python manage.py runserver 8000"
Start-Process -FilePath pwsh -ArgumentList -NoExit, '-Command', $backendCmd
Write-Host "Backend started (new window)"

# Start three collab-service instances, each in its own window
foreach ($port in 1234,1235,1236) {
    $cmd = "Set-Location -LiteralPath '$root\collab-service'; `$env:PORT=$port; `$env:JWT_SECRET='$JwtSecret'; node src/server.js"
    Start-Process -FilePath pwsh -ArgumentList -NoExit, '-Command', $cmd
    Write-Host "Started collab-service on port $port"
}

if ($StartFrontend) {
    $frontendCmd = "Set-Location -LiteralPath '$root\frontend'; npm start"
    Start-Process -FilePath pwsh -ArgumentList -NoExit, '-Command', $frontendCmd
    Write-Host "Frontend started (new window)"
}

Write-Host "All start commands issued. Check the new windows for logs."
