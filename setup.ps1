# setup.ps1
# Configuracion e inicio del Servicio de Ejecucion

$ErrorActionPreference = "Stop"

# Cambiar a la carpeta del servicio
$serviceDir = Join-Path $PSScriptRoot "code-execution-service"
Set-Location $serviceDir

function Exit-OnError {
    param([string]$message)
    Write-Host "ERROR: $message" -ForegroundColor Red
    exit 1
}

function Run-Step {
    param(
        [string]$message,
        [scriptblock]$command
    )

    Write-Host $message -ForegroundColor Yellow

    try {
        & $command
        Write-Host "   OK" -ForegroundColor Green
    }
    catch {
        Exit-OnError $_.Exception.Message
    }
}

Write-Host "================================" -ForegroundColor Cyan
Write-Host "Servicio de Ejecucion - Setup" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host "Directorio: $serviceDir" -ForegroundColor Cyan
Write-Host ""

Run-Step "1. Verificando Node.js..." {
    node --version | Out-Null
}

Run-Step "2. Verificando npm..." {
    npm --version | Out-Null
}

Run-Step "3. Verificando Docker..." {
    docker --version | Out-Null
}

Run-Step "4. Verificando que Docker esta corriendo..." {
    docker ps | Out-Null
}

Run-Step "5. Instalando dependencias de Node.js..." {
    npm install
    npm install --save-dev @types/dockerode
}

Run-Step "6. Compilando TypeScript..." {
    npx tsc --noEmit

    if ($LASTEXITCODE -ne 0) {
        throw "Falló la compilación TypeScript"
    }
}

Run-Step "7. Construyendo imagen secure-cpp-runner..." {
    docker build -t secure-cpp-runner:latest .\docker-images\cpp
    if ($LASTEXITCODE -ne 0) {
        throw "Falló build Docker"
    }
}

Run-Step "8. Construyendo imagen secure-python-runner..." {
    docker build -t secure-python-runner:latest .\docker-images\python
    if ($LASTEXITCODE -ne 0) {
       throw "Falló build Docker"
    }
}

Run-Step "9. Construyendo imagen secure-typescript-runner..." {
    docker build -t secure-typescript-runner:latest .\docker-images\typescript
    if ($LASTEXITCODE -ne 0) {
        throw "Falló build Docker"
    }
}

Write-Host ""
Write-Host "Imagenes creadas:" -ForegroundColor Green
docker images --format "table {{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}" | Select-String "secure-"

Write-Host ""
Write-Host "================================" -ForegroundColor Green
Write-Host "Setup completado correctamente" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host ""

Write-Host "Iniciando el servidor..." -ForegroundColor Yellow
npm run dev