@echo off
rem ===========================================================================
rem  One-command update for this branch.
rem    update.cmd            -> pull latest, rebuild this branch, restart server
rem    update.cmd --offline  -> restart with already-copied files (no pull/build)
rem
rem  Data (data.sqlite) is never touched. Users get a "reload to update" prompt
rem  automatically once the new app is in place.
rem ===========================================================================
cd /d "%~dp0"
if not exist branch.config.cmd (
  echo Missing branch.config.cmd - copy branch.config.example.cmd and edit it first.
  pause
  exit /b 1
)
call branch.config.cmd

set "OFFLINE=0"
if /I "%~1"=="--offline" set "OFFLINE=1"

echo ============================================
echo   Updating branch "%BRANCH%"  (slug %SLUG%)
echo ============================================

if "%OFFLINE%"=="1" goto restart

echo [1/3] Pulling latest from GitHub ...
pushd ..
git pull
if errorlevel 1 (
  echo.
  echo Git pull failed - no connection? Copy the new files over and run:  update.cmd --offline
  popd & pause & exit /b 1
)
echo [2/3] Building app for %SLUG% ...
node build.js --branch=%SLUG%
if errorlevel 1 ( echo Build failed. & popd & pause & exit /b 1 )
popd
goto restart

:restart
echo [3/3] Restarting server ...
call stop.cmd
call start.cmd
echo.
echo Done. Branch "%BRANCH%" is updated. Open browsers will prompt to reload.
pause
