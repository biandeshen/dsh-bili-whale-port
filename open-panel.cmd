@echo off
setlocal
cd /d "%~dp0"
title 小鱼面板

if "%WHALE_HOME%"=="" set "WHALE_HOME=%USERPROFILE%\.dsh"
if "%PANEL_PORT%"=="" set "PANEL_PORT=8447"

node scripts\launch-panel.mjs
pause
