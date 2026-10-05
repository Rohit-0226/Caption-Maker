$Root = "E:\Desktop\Caption Maker"
Set-Location $Root
$proc = Start-Process -FilePath ".\Caption Maker Web & Share.exe" -WorkingDirectory $Root -PassThru
Start-Sleep -Seconds 4
Write-Host "Process Id: $($proc.Id)"
Write-Host "HasExited: $($proc.HasExited)"
if ($proc.HasExited) {
    Write-Host "ExitCode: $($proc.ExitCode)"
}
