param(
    [ValidateSet("sin-cola", "con-cola")]
    [string]$Escenario = "con-cola",
    [int]$Total = 30,
    [int]$VentanaSegundos = 2
)

if ($Total -le 0) {
    throw "Total debe ser mayor que 0"
}
if ($VentanaSegundos -le 0) {
    throw "VentanaSegundos debe ser mayor que 0"
}

$uriSinCola = "http://localhost:8080/api/ejecutar"
$uriConCola = "http://localhost:8080/api/codigo/ejecutar"

$codigo = "int main(){return 0;}"
$delayMs = [math]::Max(1, [int](($VentanaSegundos * 1000) / $Total))

Write-Host "Iniciando prueba: $Escenario"
Write-Host "Solicitudes: $Total en $VentanaSegundos segundos (espaciado aprox ${delayMs}ms)"

$jobs = @()
$swGlobal = [System.Diagnostics.Stopwatch]::StartNew()

for ($i = 1; $i -le $Total; $i++) {
    $jobs += Start-Job -ScriptBlock {
        param($idx, $modo, $uSinCola, $uConCola, $src)

        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            if ($modo -eq "sin-cola") {
                $body = @{
                    id = $idx
                    contenido = $src
                    fecha = (Get-Date).ToString("yyyy-MM-dd")
                    resultado = ""
                    tiempo = ""
                } | ConvertTo-Json

                $resp = Invoke-RestMethod -Method Post -Uri $uSinCola -ContentType "application/json" -Body $body
                $sw.Stop()
                [PSCustomObject]@{
                    id = $idx
                    ok = $true
                    status = "ok"
                    ms = $sw.ElapsedMilliseconds
                    detalle = ($resp.resultado | Out-String).Trim()
                }
            }
            else {
                $resp = Invoke-RestMethod -Method Post -Uri $uConCola -Body @{
                    userId = 1
                    codigo = $src
                    lenguaje = "cpp"
                }
                $sw.Stop()
                [PSCustomObject]@{
                    id = $idx
                    ok = $true
                    status = "encolado"
                    ms = $sw.ElapsedMilliseconds
                    detalle = "tareaId=$($resp.tareaId) posicion=$($resp.posicionEstimada)"
                }
            }
        }
        catch {
            $sw.Stop()
            [PSCustomObject]@{
                id = $idx
                ok = $false
                status = "error"
                ms = $sw.ElapsedMilliseconds
                detalle = $_.Exception.Message
            }
        }
    } -ArgumentList $i, $Escenario, $uriSinCola, $uriConCola, $codigo

    Start-Sleep -Milliseconds $delayMs
}

$results = $jobs | Wait-Job | Receive-Job
$jobs | Remove-Job | Out-Null
$swGlobal.Stop()

$ok = ($results | Where-Object { $_.ok }).Count
$err = ($results | Where-Object { -not $_.ok }).Count
$avg = [math]::Round((($results | Measure-Object -Property ms -Average).Average), 2)
$p95 = ($results | Sort-Object ms)
$p95Index = [math]::Ceiling($results.Count * 0.95) - 1
if ($p95Index -lt 0) { $p95Index = 0 }
$p95Ms = $p95[$p95Index].ms

Write-Host ""
Write-Host "Resumen"
Write-Host "- Escenario: $Escenario"
Write-Host "- Exitosas: $ok"
Write-Host "- Errores: $err"
Write-Host "- Latencia promedio ms: $avg"
Write-Host "- Latencia p95 ms: $p95Ms"
Write-Host "- Duracion total ms: $($swGlobal.ElapsedMilliseconds)"
Write-Host ""

$results | Sort-Object id | Select-Object -First 10 | Format-Table -AutoSize

if ($err -gt 0) {
    Write-Host ""
    Write-Host "Primeros errores:"
    $results | Where-Object { -not $_.ok } | Select-Object -First 5 | Format-List
}
