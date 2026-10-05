$Root = "E:\Desktop\Caption Maker"
Set-Location $Root
Start-Sleep -Seconds 3
Get-Content -Path "launcher\logs\launcher.log" -Tail 25
Write-Host "--- TCP Connections ---"
Get-NetTCPConnection -LocalPort 5173,5180 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,State,OwningProcess | Format-Table
