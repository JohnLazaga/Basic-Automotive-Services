@echo off
title Deploy Basic by JMSI
cd /d "%~dp0"

rem Commit message: use args if given, else ask, else default.
set "MSG=%*"
if "%MSG%"=="" set /p "MSG=Describe what changed (press Enter for default): "
if "%MSG%"=="" set "MSG=Update Basic by JMSI app"

echo.
echo ============================================
echo   Deploying Basic by JMSI to GitHub Pages
echo ============================================
echo.

powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0deploy.ps1" "%MSG%"

echo.
echo (You can close this window.)
pause >nul
