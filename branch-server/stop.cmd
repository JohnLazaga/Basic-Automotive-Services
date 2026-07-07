@echo off
rem Stop the branch server (kills whatever is listening on its port).
cd /d "%~dp0"
if exist branch.config.cmd call branch.config.cmd
if "%PORT%"=="" set "PORT=8790"
set "FOUND="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
  echo Stopping server PID %%a on port %PORT% ...
  taskkill /F /PID %%a >nul 2>&1
  set "FOUND=1"
)
if not defined FOUND echo No server was listening on port %PORT%.
echo Stopped.
