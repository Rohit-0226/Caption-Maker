$Root = "E:\Desktop\Caption Maker"
Set-Location $Root

# Stop any running instances cleanly
Get-Process -Name "Caption Maker Web & Share", "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort 5173, 5180 -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 1

# Start the launcher fresh
$proc = Start-Process -FilePath ".\Caption Maker Web & Share.exe" -WorkingDirectory $Root -PassThru
Write-Host "Started launcher process: $($proc.Id)"

Start-Sleep -Seconds 6

Get-Content -Path "launcher\logs\launcher.log" -Tail 25
Write-Host "--- Active TCP Connections ---"
Get-NetTCPConnection -LocalPort 5173,5180 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,State,OwningProcess | Format-Table
