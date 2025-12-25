$errorLog = "resources/bin/error.log"
$accessLog = "resources/bin/access.log"

Write-Host "=== XRAY ERROR LOG (Last 20 lines) ===" -ForegroundColor Red
if (Test-Path $errorLog) {
    Get-Content $errorLog -Tail 20
} else {
    Write-Host "Error log not found"
}

Write-Host "`n=== XRAY ACCESS LOG (Last 10 lines) ===" -ForegroundColor Green
if (Test-Path $accessLog) {
    Get-Content $accessLog -Tail 10
} else {
    Write-Host "Access log not found"
}

Write-Host "`n=== PROXY STATUS ===" -ForegroundColor Yellow
$proxy = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
Write-Host "Proxy Enabled: $($proxy.ProxyEnable)"
Write-Host "Proxy Server: $($proxy.ProxyServer)"

Write-Host "`n=== XRAY PROCESS ===" -ForegroundColor Cyan
Get-Process | Where-Object {$_.ProcessName -like "*xray*"} | Format-Table ProcessName, Id, CPU, WorkingSet -AutoSize
