@echo off
rem Resolve a Node runtime WITHOUT requiring the user to install one: MiMo
rem Desktop ships its own (node:sqlite + WebSocket included). Falls back to
rem MIMO_NODE, then to whatever node.exe is on PATH.
rem ASCII only: cmd.exe parses this file with the OEM codepage before chcp.
set "NODE_EXE="
if defined MIMO_NODE if exist "%MIMO_NODE%" set "NODE_EXE=%MIMO_NODE%"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\Xiaomi MiMo\resources\runtimes\win32-x64\node\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\Xiaomi MiMo\resources\runtimes\win32-x64\node\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles%\Xiaomi MiMo\resources\runtimes\win32-x64\node\node.exe" set "NODE_EXE=%ProgramFiles%\Xiaomi MiMo\resources\runtimes\win32-x64\node\node.exe"
if not defined NODE_EXE set "NODE_EXE=node"
