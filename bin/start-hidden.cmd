@echo off
rem ASCII-only on purpose: cmd.exe parses this file with the OEM codepage before
rem chcp takes effect, so any non-ASCII here corrupts the batch parser.
chcp 65001 >nul
node "%~dp0..\src\start-hidden.mjs"
timeout /t 3 /nobreak >nul
