@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title whale-panel 一键启动

where node >nul 2>nul
if errorlevel 1 (
  echo [x] 找不到 node。请安装 Node.js 20+ 后重试。
  pause
  exit /b 1
)

if "%WHALE_HOME%"=="" set "WHALE_HOME=%USERPROFILE%\.dsh"
if "%PANEL_PORT%"=="" set "PANEL_PORT=8447"
if "%BILI_WHALE_CONFIG%"=="" set "BILI_WHALE_CONFIG=%WHALE_HOME%\bili-whale.config.json"

echo [1/3] 预检（失败项会标 x，可先在面板里补）
node scripts\preflight.mjs
echo.

echo [2/3] 启动面板 http://127.0.0.1:%PANEL_PORT%
start "" /b node scripts\open-panel.mjs

echo [3/3] Ctrl+C 停止面板。浏览器会自动打开；没弹就复制下面的地址：
echo        http://127.0.0.1:%PANEL_PORT%/?t=^<见 %WHALE_HOME%\panel.token^>
echo.
node panel\server.js --port %PANEL_PORT%
pause
