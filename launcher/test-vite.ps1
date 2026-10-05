$Root = "E:\Desktop\Caption Maker"
Set-Location $Root
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx vite --host" -PassThru -NoNewWindow
Start-Sleep -Seconds 4
Write-Host "Vite Process Id: $($proc.Id)"
Write-Host "Vite HasExited: $($proc.HasExited)"
Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | Format-Table
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
