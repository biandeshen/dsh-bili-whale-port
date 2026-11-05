@echo off
rem ============================================================
rem  Open Windows Firewall inbound rule for Cortico WebUI 7799.
rem  LAN-only use: bound to 0.0.0.0 by start-cortico.mjs, but the
rem  firewall rule below is scoped to the PRIVATE network profile
rem  only. On a public wifi profile the port stays blocked.
rem
rem  Usage:
rem    start-cortico-firewall.cmd            add the rule (admin)
rem    start-cortico-firewall.cmd --check    verify state, no change
rem    start-cortico-firewall.cmd --remove   delete the rule (admin)
rem
rem  ASCII only on purpose: cmd mis-parses GBK/UTF-8 Chinese here.
rem ============================================================
setlocal
set RULE_NAME=Cortico WebUI 7799 (LAN private only)
set CHECK_MODE=0
set REMOVE_MODE=0
if /I "%~1"=="--check" set CHECK_MODE=1
if /I "%~1"=="--remove" set REMOVE_MODE=1
if not "%~2"=="" goto :usage
if "%~1"=="" goto :run
if "%CHECK_MODE%"=="1" goto :run
if "%REMOVE_MODE%"=="1" goto :run
goto :usage

:run
net session >nul 2>&1
if errorlevel 1 (
  echo [FAIL] Administrator rights required. Right-click - Run as administrator.
  exit /b 2
)

if "%CHECK_MODE%"=="1" goto :check
if "%REMOVE_MODE%"=="1" goto :remove

:check
netsh advfirewall firewall show rule name="%RULE_NAME%" >nul 2>&1
if errorlevel 1 (
  echo [STATE] rule does not exist: "%RULE_NAME%"
  if "%CHECK_MODE%"=="1" exit /b 1
  echo [ADD] creating inbound TCP 7799, profile=private, local subnet only ...
  netsh advfirewall firewall add rule name="%RULE_NAME%" dir=in action=allow protocol=TCP localport=7799 profile=private remoteip=localsubnet
  if errorlevel 1 (
    echo [FAIL] netsh add rule failed.
    exit /b 3
  )
  echo [OK] rule added. LAN devices on the PRIVATE profile can now open http://^<lan-ip^>:7799/
  echo [NOTE] webui has NO login auth. Private wifi / own devices only.
  exit /b 0
)
echo [STATE] rule already exists: "%RULE_NAME%"
if "%CHECK_MODE%"=="1" (
  netsh advfirewall firewall show rule name="%RULE_NAME%"
  exit /b 0
)
echo [SKIP] nothing to add. Use --remove to delete it first.
exit /b 0

:remove
netsh advfirewall firewall delete rule name="%RULE_NAME%" >nul 2>&1
if errorlevel 1 (
  echo [STATE] nothing to remove ^(or delete failed^).
  exit /b 1
)
echo [OK] rule removed. 7799 is loopback-only again from other devices' view.
exit /b 0

:usage
echo Usage: %~nx0 [--check ^| --remove]
echo   no arg   add firewall rule for TCP 7799, profile=private, localsubnet only
echo   --check  show rule state without changing anything
echo   --remove delete the rule
exit /b 2
