$Root = "E:\Desktop\Caption Maker"
Set-Location $Root
Write-Host "--- Testing 5173 (Web) ---"
try {
    $res5173 = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing -TimeoutSec 3
    Write-Host "5173 Status: $($res5173.StatusCode)"
} catch {
    Write-Host "5173 Error: $($_.Exception.Message)"
}

Write-Host "--- Testing 5180 (API) ---"
try {
    $res5180 = Invoke-WebRequest -Uri "http://localhost:5180/api/health" -UseBasicParsing -TimeoutSec 3
    Write-Host "5180 Status: $($res5180.StatusCode)"
    Write-Host "5180 Body: $($res5180.Content)"
} catch {
    Write-Host "5180 Error: $($_.Exception.Message)"
}
