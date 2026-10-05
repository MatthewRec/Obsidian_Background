@echo off
cd /d "%~dp0"

:loop
"C:\Program Files\nodejs\node.exe" watch.js >> watch-shell.log 2>&1
timeout /t 5 /nobreak >nul
goto loop
