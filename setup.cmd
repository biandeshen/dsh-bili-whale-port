@echo off
setlocal
cd /d "%~dp0"
title whale setup

where node >nul 2>nul
if errorlevel 1 (
  echo [x] Node.js 20+ not found. Install it first.
  pause
  exit /b 1
)

if "%~1"=="--check" (
  node scripts/setup.mjs --check
  pause
  exit /b
)

node scripts/setup.mjs
pause
