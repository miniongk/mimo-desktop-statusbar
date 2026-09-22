@echo off
rem ASCII only: cmd.exe parses this file with the OEM codepage before chcp.
chcp 65001 >nul
call "%~dp0_env.cmd"
title Uninstall MiMo session status bar
"%NODE_EXE%" "%~dp0..\src\uninstall.mjs" %*
echo.
pause
