@echo off
rem Internal: load branch settings and run the server (logging to server.log).
rem Launched by start.cmd in its own window. Do not double-click directly.
cd /d "%~dp0"
if not exist branch.config.cmd (
  echo Missing branch.config.cmd - copy branch.config.example.cmd and edit it.
  pause
  exit /b 1
)
call branch.config.cmd
echo [%date% %time%] starting "%BRANCH%" on port %PORT% >> server.log
node server.js >> server.log 2>&1
