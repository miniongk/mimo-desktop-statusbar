@echo off
rem ASCII only: cmd.exe parses this file with the OEM codepage before chcp.
rem Run the test suite on the resolved Node. Usage:  bin\test.cmd [name]
chcp 65001 >nul
call "%~dp0_env.cmd"
title mimo-desktop-statusbar tests
set "T=%~1"
if "%T%"=="" goto :all
"%NODE_EXE%" "%~dp0..\test\%T%.mjs" %2 %3 %4 %5
goto :done
:all
echo === runtime ===
"%NODE_EXE%" "%~dp0..\test\runtime.mjs"
echo === autostart ===
"%NODE_EXE%" "%~dp0..\test\autostart.mjs"
echo === shortcuts ===
"%NODE_EXE%" "%~dp0..\test\shortcuts.mjs"
echo === resolve ===
"%NODE_EXE%" "%~dp0..\test\resolve.mjs"
echo === stats ===
"%NODE_EXE%" "%~dp0..\test\stats.mjs"
echo === render ===
"%NODE_EXE%" "%~dp0..\test\render.mjs"
echo === e2e ===
"%NODE_EXE%" "%~dp0..\test\e2e.mjs"
:done
echo.
pause
