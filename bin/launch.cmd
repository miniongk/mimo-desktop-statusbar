@echo off
rem ASCII-only on purpose: cmd.exe parses this file with the OEM codepage before
rem chcp takes effect, so any non-ASCII here corrupts the batch parser. All
rem messages live in src/launch.mjs, which Node reads as UTF-8.
chcp 65001 >nul
title MiMo session status bar
node "%~dp0..\src\launch.mjs" %*
echo.
pause
