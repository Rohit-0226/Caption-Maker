@echo off
setlocal
REM Opens the Caption Maker desktop window on the live project - the same thing
REM the "Caption Maker" Desktop shortcut does. It runs this folder's code, so it
REM is always as current as the project; there is no packaged build to go stale.
REM It shares one server with "Caption Maker Web & Share": whichever opens first
REM runs it and the other attaches, so both see the same projects.

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "ELECTRON=%ROOT%\node_modules\electron\dist\electron.exe"

if not exist "%ELECTRON%" (
    echo Electron is not installed in this folder yet. Running npm install...
    pushd "%ROOT%"
    call npm install
    popd
)

if not exist "%ELECTRON%" (
    echo Could not find "%ELECTRON%".
    pause
    exit /b 1
)

start "" /D "%ROOT%" "%ELECTRON%" "%ROOT%"
exit /b
