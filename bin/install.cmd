@echo off
rem ASCII only: cmd.exe parses this file with the OEM codepage before chcp.
rem Install + enable in one go. This is the file the README tells you to
rem double-click; 安装.cmd at the package root is the same thing.
chcp 65001 >nul
call "%~dp0_env.cmd"
title Install MiMo session status bar
"%NODE_EXE%" "%~dp0..\src\install.mjs" %* --enable
echo.
pause
