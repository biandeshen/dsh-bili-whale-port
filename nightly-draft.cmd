@echo off
cd /d "%~dp0"
if not exist "D:\AI\养鱼\drafts" mkdir "D:\AI\养鱼\drafts"
node scripts\draft-dynamic.mjs >> "D:\AI\养鱼\drafts\nightly.log" 2>&1
