$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$out = "C:\Users\konte\.gemini\antigravity\brain\78143cc6-68b9-4240-a418-d709b831912f\live_app_preview.png"
# Chrome flag to wait for network idle or run with timeout
$args = @(
    "--headless",
    "--disable-gpu",
    "--window-size=1280,800",
    "--virtual-time-budget=3000",
    "--screenshot=$out",
    "http://localhost:5173"
)
Start-Process $chrome -ArgumentList $args -Wait
Test-Path $out
