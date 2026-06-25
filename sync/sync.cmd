@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0export-sql.ps1"
if errorlevel 1 exit /b 1
"C:\Program Files\nodejs\node.exe" "%~dp0upload.js"
