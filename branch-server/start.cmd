@echo off
rem Start the branch server in its own background window.
cd /d "%~dp0"
if not exist branch.config.cmd (
  echo Missing branch.config.cmd - copy branch.config.example.cmd and edit it first.
  pause
  exit /b 1
)
call branch.config.cmd
echo Starting BASIC branch server "%BRANCH%" (slug %SLUG%) on port %PORT% ...
start "BASIC branch server (%BRANCH%)" cmd /c run.cmd
echo Started. Open  http://localhost:%PORT%/   (logs: branch-server\server.log)
