@echo off
cd /d "E:\WorkSpace_Qoder\Cortico"
start "" /min "C:\Program Files\nodejs\node.exe" "%USERPROFILE%\.dsh\ofm-go-proxy\proxy.mjs"
timeout /t 2 >/dev/null
start "" /min "C:\Program Files\nodejs\node.exe" bin\cortico.mjs mybot --port=7799
timeout /t 6 >/dev/null
curl -s -X POST http://127.0.0.1:7799/api/run/resume >/dev/null
