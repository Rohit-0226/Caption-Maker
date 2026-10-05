# Creates (or refreshes) the Caption Maker shortcuts on the Desktop. This is the
# one place shortcuts are made; launcher\build.ps1 calls it too.
#
#   "Caption Maker"             the desktop window. It runs the project's own
#                               Electron on this folder, so it is always as
#                               current as the code - no packaged build to go stale.
#   "Caption Maker Web & Share" the launcher with LAN and public links.
#
# Both share one server: whichever opens first runs it and the other attaches.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File launcher\create-shortcuts.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File launcher\create-shortcuts.ps1 -Which desktop

param(
    [ValidateSet("desktop", "webshare")]
    [string[]]$Which = @("desktop", "webshare"),
    [string]$Destination = [Environment]::GetFolderPath("Desktop")
)

$ErrorActionPreference = "Stop"

# Work from this script's own folder, never a hard-coded path: the project has
# been reached through a link before, and shortcuts to a vanished link break.
$Root = Split-Path -Parent $PSScriptRoot
$RootItem = Get-Item -LiteralPath $Root
if ($RootItem.LinkType -and $RootItem.Target) { $Root = @($RootItem.Target)[0] }

$Shell = New-Object -ComObject WScript.Shell
try {
    if ($Which -contains "desktop") {
        $Electron = Join-Path $Root "node_modules\electron\dist\electron.exe"
        if (-not (Test-Path -LiteralPath $Electron)) {
            throw "Electron was not found at $Electron. Run npm install in $Root first."
        }
        $Path = Join-Path $Destination "Caption Maker.lnk"
        $Shortcut = $Shell.CreateShortcut($Path)
        $Shortcut.TargetPath = $Electron
        $Shortcut.Arguments = '"' + $Root + '"'
        $Shortcut.WorkingDirectory = $Root
        $Icon = Join-Path $Root "resources\icon.ico"
        if (Test-Path -LiteralPath $Icon) { $Shortcut.IconLocation = "$Icon,0" }
        $Shortcut.Description = "Caption Maker - the live project in a desktop window (shares its server with Web & Share)"
        $Shortcut.Save()
        Write-Host "Shortcut ready: $Path"
    }

    if ($Which -contains "webshare") {
        $Launcher = Join-Path $Root "Caption Maker Web & Share.exe"
        if (-not (Test-Path -LiteralPath $Launcher)) {
            throw "The launcher was not found at $Launcher. Build it with launcher\build.ps1 first."
        }
        $Path = Join-Path $Destination "Caption Maker Web & Share.lnk"
        $Shortcut = $Shell.CreateShortcut($Path)
        $Shortcut.TargetPath = $Launcher
        $Shortcut.WorkingDirectory = $Root
        $Shortcut.IconLocation = "$Launcher,0"
        $Shortcut.Description = "Caption Maker Web & Share - AI Video Caption Studio & Cloudflare Tunnel"
        $Shortcut.Save()
        Write-Host "Shortcut ready: $Path"
    }
}
finally {
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($Shell) | Out-Null
}
