@echo off
rem ASCII only: cmd.exe parses this file with the OEM codepage before chcp.
rem The one entry point: install and enable in a single double-click.
chcp 65001 >nul
call "%~dp0bin\_env.cmd"
title Install MiMo session status bar
"%NODE_EXE%" "%~dp0src\install.mjs" --enable %*
echo.
pause
