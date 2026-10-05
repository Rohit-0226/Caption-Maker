# PowerShell 5.1 Compatible Build Script for Caption Maker Launcher
# Generates multi-size icon, compiles C# launcher, swaps into place, creates desktop shortcut.

param(
    [switch]$NoShortcut = $false
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LauncherDir = $PSScriptRoot
$IcoPath = Join-Path $LauncherDir "icon.ico"
$CsPath = Join-Path $LauncherDir "Launcher.cs"
$BinDir = Join-Path $LauncherDir "bin"
$LogsDir = Join-Path $LauncherDir "logs"
$TargetExeName = "Caption Maker Web & Share.exe"
$FinalExePath = Join-Path $ProjectRoot $TargetExeName

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Building Caption Maker Web & Share Launcher..." -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Ensure Directories
if (-not (Test-Path $BinDir)) { New-Item -ItemType Directory -Path $BinDir -Force | Out-Null }
if (-not (Test-Path $LogsDir)) { New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null }

# 2. Generate Multi-Size Icon (.ico) via System.Drawing
Write-Host "[1/4] Generating multi-size icon (16, 32, 48, 256 px)..." -ForegroundColor Yellow
Add-Type -AssemblyName System.Drawing

function Generate-MultiSizeIcon {
    param([string]$OutFile)

    $sizes = @(16, 32, 48, 256)
    $images = @()

    foreach ($sz in $sizes) {
        $bmp = New-Object System.Drawing.Bitmap $sz, $sz
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

        # Background circle: Deep Slate / Indigo
        $rect = New-Object System.Drawing.Rectangle 0, 0, $sz, $sz
        $bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(15, 23, 42)) # #0f172a
        $g.FillEllipse($bgBrush, $rect)
        $bgBrush.Dispose()

        # Outer ring: Cyan / Blue Gradient accent
        $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(56, 189, 248), [Math]::Max(1.0, $sz * 0.05)) # #38bdf8
        $ringRect = New-Object System.Drawing.Rectangle ([int]($sz * 0.06)), ([int]($sz * 0.06)), ([int]($sz * 0.88)), ([int]($sz * 0.88))
        $g.DrawEllipse($pen, $ringRect)
        $pen.Dispose()

        # Inner badge: Royal Blue
        $innerBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(37, 99, 235)) # #2563eb
        $innerRect = New-Object System.Drawing.Rectangle ([int]($sz * 0.2)), ([int]($sz * 0.2)), ([int]($sz * 0.6)), ([int]($sz * 0.6))
        $g.FillEllipse($innerBrush, $innerRect)
        $innerBrush.Dispose()

        # Center dot: Emerald Green (indicating live/online connectivity)
        $dotBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(52, 211, 153)) # #34d399
        $dotRect = New-Object System.Drawing.Rectangle ([int]($sz * 0.38)), ([int]($sz * 0.38)), ([int]($sz * 0.24)), ([int]($sz * 0.24))
        $g.FillEllipse($dotBrush, $dotRect)
        $dotBrush.Dispose()

        $g.Dispose()

        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $pngBytes = $ms.ToArray()
        $ms.Dispose()
        $bmp.Dispose()

        $images += ,@($sz, $pngBytes)
    }

    $fs = [System.IO.File]::Create($OutFile)
    $bw = New-Object System.IO.BinaryWriter $fs
    $bw.Write([uint16]0) # Reserved
    $bw.Write([uint16]1) # Type 1 = Icon
    $bw.Write([uint16]$images.Count) # Image Count

    $offset = 6 + ($images.Count * 16)
    foreach ($img in $images) {
        $sz = $img[0]
        $data = $img[1]
        $w = if ($sz -ge 256) { 0 } else { [byte]$sz }
        $h = if ($sz -ge 256) { 0 } else { [byte]$sz }
        $bw.Write([byte]$w)
        $bw.Write([byte]$h)
        $bw.Write([byte]0)   # Color count
        $bw.Write([byte]0)   # Reserved
        $bw.Write([uint16]1) # Planes
        $bw.Write([uint16]32)# Bit count
        $bw.Write([uint32]$data.Length) # Image bytes
        $bw.Write([uint32]$offset)      # Offset
        $offset += $data.Length
    }

    foreach ($img in $images) {
        $bw.Write($img[1])
    }
    $bw.Flush()
    $bw.Close()
    $fs.Close()
}

Generate-MultiSizeIcon -OutFile $IcoPath
Write-Host "   -> Icon generated successfully: $IcoPath" -ForegroundColor Green

# 3. Compile Launcher.cs with csc.exe
Write-Host "[2/4] Compiling C# launcher using Windows csc.exe..." -ForegroundColor Yellow
$CscPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $CscPath)) {
    $CscPath = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path $CscPath)) {
    throw "Microsoft .NET C# compiler (csc.exe) not found on this system."
}

$TempExe = Join-Path $BinDir ("build_" + (Get-Date -Format "yyyyMMddHHmmss") + ".exe")

$CscArgs = @(
    "/target:winexe",
    "/optimize+",
    "/win32icon:`"$IcoPath`"",
    "/out:`"$TempExe`"",
    "`"$CsPath`""
)

$Process = Start-Process -FilePath $CscPath -ArgumentList ($CscArgs -join " ") -NoNewWindow -Wait -PassThru
if ($Process.ExitCode -ne 0 -or (-not (Test-Path $TempExe))) {
    throw "C# compilation failed with exit code $($Process.ExitCode)"
}
Write-Host "   -> Compiled successfully: $TempExe" -ForegroundColor Green

# 4. Atomic Rename-Aside Swap
Write-Host "[3/4] Swapping executable into project root..." -ForegroundColor Yellow
if (Test-Path $FinalExePath) {
    try {
        # Attempt direct replacement
        Move-Item -Path $TempExe -Destination $FinalExePath -Force
    } catch {
        # File is currently running / locked: rename running exe aside
        $OldBackup = $FinalExePath + ".old-" + (Get-Date -Format "yyyyMMddHHmmss")
        Write-Host "   -> Target is active; renaming aside to: $OldBackup" -ForegroundColor Gray
        Move-Item -Path $FinalExePath -Destination $OldBackup -Force
        Move-Item -Path $TempExe -Destination $FinalExePath -Force
    }
} else {
    Move-Item -Path $TempExe -Destination $FinalExePath -Force
}
Write-Host "   -> Placed executable at: $FinalExePath" -ForegroundColor Green

# 5. Desktop Shortcut (one shortcut script for the whole project)
if (-not $NoShortcut) {
    Write-Host "[4/4] Creating Desktop shortcut..." -ForegroundColor Yellow
    & (Join-Path $LauncherDir "create-shortcuts.ps1") -Which webshare
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Build Complete! Double-click Desktop icon to launch." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
