@echo off
rem Resolve a Node runtime. MiMo Desktop ships one at resources\runtimes\...\node
rem but it is the "mimo-node" shim, not standalone Node: it refuses to run unless
rem MIMO_ELECTRON_NODE_HOST points at Xiaomi MiMo.exe and prints
rem   mimo-node: MIMO_ELECTRON_NODE_HOST is not set
rem So we resolve the host first and export it. A real Node on PATH ignores it.
rem ASCII only: cmd.exe parses this file with the OEM codepage before chcp.

set "NODE_EXE="
set "MIMO_EXE="

rem Already in a MiMo-managed shell (both set): use it as-is.
if defined MIMO_NODE if defined MIMO_ELECTRON_NODE_HOST if exist "%MIMO_NODE%" set "NODE_EXE=%MIMO_NODE%"

if not defined MIMO_EXE if exist "%LOCALAPPDATA%\Programs\Xiaomi MiMo\Xiaomi MiMo.exe" set "MIMO_EXE=%LOCALAPPDATA%\Programs\Xiaomi MiMo\Xiaomi MiMo.exe"
if not defined MIMO_EXE if exist "%ProgramFiles%\Xiaomi MiMo\Xiaomi MiMo.exe" set "MIMO_EXE=%ProgramFiles%\Xiaomi MiMo\Xiaomi MiMo.exe"
if not defined MIMO_EXE if defined MIMO_STATSBAR_APP if exist "%MIMO_STATSBAR_APP%" set "MIMO_EXE=%MIMO_STATSBAR_APP%"

if not defined NODE_EXE if defined MIMO_EXE if exist "%LOCALAPPDATA%\Programs\Xiaomi MiMo\resources\runtimes\win32-x64\node\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\Xiaomi MiMo\resources\runtimes\win32-x64\node\node.exe"
if not defined NODE_EXE if defined MIMO_EXE if exist "%ProgramFiles%\Xiaomi MiMo\resources\runtimes\win32-x64\node\node.exe" set "NODE_EXE=%ProgramFiles%\Xiaomi MiMo\resources\runtimes\win32-x64\node\node.exe"

rem The shim will not start without this. Harmless for a real Node.
if not defined MIMO_ELECTRON_NODE_HOST if defined MIMO_EXE set "MIMO_ELECTRON_NODE_HOST=%MIMO_EXE%"

if not defined NODE_EXE set "NODE_EXE=node"
