@echo off
rem ASCII only: cmd.exe parses this file with the OEM codepage before chcp.
rem Interactive/debug launcher: keeps a console open and streams the log.
rem For daily use, double-click bin\enable.cmd or the desktop shortcut.
chcp 65001 >nul
call "%~dp0_env.cmd"
title MiMo session status bar
"%NODE_EXE%" "%~dp0..\src\launch.mjs" %*
echo.
pause
