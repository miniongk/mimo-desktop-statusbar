@echo off
rem ASCII-only on purpose: cmd.exe parses this file with the OEM codepage before
rem chcp takes effect, so any non-ASCII here corrupts the batch parser.
chcp 65001 >nul
title Install MiMo session status bar
node "%~dp0..\src\install.mjs" %*
echo.
pause
