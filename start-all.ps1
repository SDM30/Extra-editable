Param(
    [string]$JwtSecret = "jwt-secreto",
    [switch]$ForceKill
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$backendDir = Join-Path $root 'backend'
$frontendDir = Join-Path $root 'frontend'
$collabDir = Join-Path $root 'collab-service'
$collabLbDir = Join-Path $root 'collab-load-balancer'
$gatewayConfig = Join-Path $root 'nginx.conf'
$collabLbConfig = Join-Path $root 'collab-load-balancer\nginx.config'
$postgresContainer = 'extra-editable-postgres'
$gatewayContainer = 'extra-editable-gateway'
$collabLbContainer = 'collab-lb'
$postgresVolume = 'extra-editable-postgres-data'

Write-Host "Starting full local stack from $root"
Write-Host "JWT_SECRET = $JwtSecret"

$env:DB_ENGINE = 'django.db.backends.postgresql'
$env:DB_NAME = 'extra_editable'
$env:DB_USER = 'postgres'
$env:DB_PASSWORD = 'postgres'
$env:DB_HOST = 'localhost'
$env:DB_PORT = '5432'
$env:JWT_SECRET = $JwtSecret
$env:COLLAB_JWT_SECRET = $JwtSecret

function Get-PidsByPort([int]$port) {
    $pids = @()
    if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
        $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if ($conns) {
            $conns | ForEach-Object { if ($_.OwningProcess) { $pids += $_.OwningProcess } }
        }
    } else {
        $lines = netstat -ano | Select-String ":$port\s"
        foreach ($line in $lines) {
            $parts = ($line -replace '^\s+', '') -split '\s+'
            $pid = $parts[-1]
            if ($pid -match '^[0-9]+$') {
                $pids += [int]$pid
            }
        }
    }
    return $pids | Select-Object -Unique
}

function Start-Window([string]$workingDir, [string]$command) {
    $pwshCmd = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($pwshCmd) {
        $exe = $pwshCmd.Source
    } else {
        $powershellCmd = Get-Command powershell -ErrorAction SilentlyContinue
        if (-not $powershellCmd) { throw 'No PowerShell executable found in PATH.' }
        $exe = $powershellCmd.Source
    }

    Start-Process -FilePath $exe -WorkingDirectory $workingDir -ArgumentList @('-NoExit', '-Command', $command)
}

function Install-NpmDeps([string]$workingDir) {
    Push-Location $workingDir
    try {
        if (Test-Path 'package-lock.json') {
            npm ci
        } else {
            npm install
        }
        if ($LASTEXITCODE -ne 0) { throw "npm install failed in $workingDir" }
    } finally {
        Pop-Location
    }
}

function Ensure-BackendPython() {
    $venvPython = Join-Path $backendDir '.venv\Scripts\python.exe'
    if (Test-Path $venvPython) {
        return $venvPython
    }

    $pyCmd = Get-Command py -ErrorAction SilentlyContinue
    if (-not $pyCmd) { throw 'No Python launcher found and backend .venv is missing.' }

    Write-Host 'Creating backend virtual environment...'
    & $pyCmd.Source -3 -m venv (Join-Path $backendDir '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create backend virtual environment.' }

    if (-not (Test-Path $venvPython)) { throw 'Backend virtual environment was not created correctly.' }
    return $venvPython
}

function Invoke-Python([string]$pythonExe, [string[]]$pythonArgs, [string]$workingDir) {
    Push-Location $workingDir
    try {
        & $pythonExe @pythonArgs
        if ($LASTEXITCODE -ne 0) { throw "Python command failed in $workingDir" }
    } finally {
        Pop-Location
    }
}

function Test-BackendDependenciesInstalled([string]$pythonExe) {
    $checkCode = @'
import importlib.util
required_modules = [
    'django',
    'rest_framework',
    'corsheaders',
    'decouple',
    'jwt',
    'psycopg',
    'psycopg2',
]
missing = [name for name in required_modules if importlib.util.find_spec(name) is None]
raise SystemExit(0 if not missing else 1)
'@

    & $pythonExe '-c' $checkCode
    return ($LASTEXITCODE -eq 0)
}

function Ensure-PostgresContainer() {
    & docker volume create $postgresVolume | Out-Null

    $state = & docker inspect -f '{{.State.Running}}' $postgresContainer 2>$null
    if ($LASTEXITCODE -eq 0) {
        if ($state -ne 'true') {
            Write-Host 'Starting existing Postgres container...'
            & docker start $postgresContainer | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Failed to start Postgres container.' }
        }
        return
    }

    Write-Host 'Creating Postgres container...'
    & docker run -d --name $postgresContainer `
        -e POSTGRES_USER=postgres `
        -e POSTGRES_PASSWORD=postgres `
        -e POSTGRES_DB=extra_editable `
        -p 5432:5432 `
        -v "${postgresVolume}:/var/lib/postgresql/data" `
        postgres:15-alpine | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Failed to start Postgres container.' }
}

function Restart-DockerContainer([string]$name, [string[]]$dockerArgs) {
    & docker rm -f $name 2>$null | Out-Null
    & docker run @dockerArgs | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to start container $name" }
}

if (-not (Test-Path (Join-Path $backendDir '.env'))) {
    Copy-Item (Join-Path $backendDir '.env.example') (Join-Path $backendDir '.env') -Force
}

if ($ForceKill) {
    foreach ($port in 8000,8080,8083,4200,1234,1235,1236) {
        foreach ($pid in Get-PidsByPort $port) {
            try {
                Stop-Process -Id $pid -Force -ErrorAction Stop
                Write-Host "Killed PID $pid on port $port"
            } catch {
                Write-Warning ("Failed to kill PID {0} on port {1}: {2}" -f $pid, $port, $_)
            }
        }
    }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is not available in PATH.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm is not available in PATH.' }

$backendPython = Ensure-BackendPython
Install-NpmDeps $frontendDir
Install-NpmDeps $collabDir

if (-not (Test-BackendDependenciesInstalled $backendPython)) {
    Write-Host 'Installing backend Python dependencies...'
    Invoke-Python $backendPython @('-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '-r', 'requirements.txt') $backendDir
} else {
    Write-Host 'Backend Python dependencies already installed.'
}

Ensure-PostgresContainer

Write-Host 'Running Django migrations...'
Invoke-Python $backendPython @('manage.py', 'migrate', '--noinput') $backendDir

$gatewayArgs = @(
    '-d',
    '--name', $gatewayContainer,
    '-p', '8080:8080',
    '-v', "${gatewayConfig}:/etc/nginx/nginx.conf:ro",
    'nginx:1.25-alpine'
)
Restart-DockerContainer $gatewayContainer $gatewayArgs
Write-Host 'API gateway started on 8080'

$collabLbArgs = @(
    '-d',
    '--name', $collabLbContainer,
    '-p', '8083:8083',
    '-v', "${collabLbConfig}:/etc/nginx/nginx.conf:ro",
    'nginx:alpine'
)
Restart-DockerContainer $collabLbContainer $collabLbArgs
Write-Host 'Collaboration load balancer started on 8083'

$collabWatcherCommand = "Set-Location -LiteralPath '$collabLbDir'; `$env:COLLAB_DISCOVERY_HOST = '127.0.0.1'; `$env:COLLAB_UPSTREAM_HOST = 'host.docker.internal'; & '$backendPython' update_nginx.py"
Start-Window $collabLbDir $collabWatcherCommand
Write-Host 'Collaboration discovery watcher started (new window)'

$backendCommand = "Set-Location -LiteralPath '$backendDir'; & '$backendPython' manage.py runserver 8000"
Start-Window $backendDir $backendCommand
Write-Host 'Backend started (new window)'

$frontendCommand = "Set-Location -LiteralPath '$frontendDir'; npm start"
Start-Window $frontendDir $frontendCommand
Write-Host 'Frontend started (new window)'

foreach ($port in 1234,1235,1236) {
    $collabCommand = @'
Set-Location -LiteralPath '__COLLAB_DIR__';
$env:PORT = '__PORT__';
$env:JWT_SECRET = '__JWT_SECRET__';
$env:DB_ENGINE = 'django.db.backends.postgresql';
$env:DB_NAME = 'extra_editable';
$env:DB_USER = 'postgres';
$env:DB_PASSWORD = 'postgres';
$env:DB_HOST = 'localhost';
$env:DB_PORT = '5432';
node src/server.js
'@.Replace('__COLLAB_DIR__', $collabDir).Replace('__PORT__', $port).Replace('__JWT_SECRET__', $JwtSecret)
    Start-Window $collabDir $collabCommand
    Write-Host "Started collab-service on port $port"
}

Write-Host 'All services and containers started. Check the new windows and Docker logs if something fails.'
