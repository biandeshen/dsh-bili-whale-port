@echo off
setlocal
cd /d "%~dp0"
title whale-panel

if "%~1"=="--check" (
  node scripts/preflight.mjs
  exit /b
)

where node >nul 2>nul
if errorlevel 1 (
  echo [x] Node.js 20+ not found. Install it first.
  pause
  exit /b 1
)

if "%WHALE_HOME%"=="" set "WHALE_HOME=%USERPROFILE%\.dsh"
if "%PANEL_PORT%"=="" set "PANEL_PORT=8447"
if "%BILI_WHALE_CONFIG%"=="" set "BILI_WHALE_CONFIG=%WHALE_HOME%\bili-whale.config.json"

echo [1/3] preflight
node scripts\preflight.mjs
echo.

echo [2/3] starting panel on http://127.0.0.1:%PANEL_PORT%
start "" /b node scripts\open-panel.mjs

echo [3/3] Ctrl+C to stop. Token file: %WHALE_HOME%\panel.token
echo.
node panel\server.js --port %PANEL_PORT%
pause
