@echo off
rem ===========================================================================
rem  Auto-repair / auto-update for a branch mini-PC.
rem  - Reverts any local tampering with app/server CODE to the owner's repo.
rem  - Rebuilds the app (overwrites any tampering with the built files).
rem  - Restarts the server ONLY if server code changed (app-only fixes need no
rem    restart - the server serves the app file fresh each request).
rem  Safe to run on a schedule (see install-autorepair.cmd). Never touches data
rem  (data.sqlite / photos / branch.config.cmd are git-ignored). Logs to
rem  autorepair.log.
rem
rem  NOTE: this also auto-applies YOUR pushes to main within the interval.
rem ===========================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"
if not exist branch.config.cmd exit /b 0
call branch.config.cmd
set "LOG=%~dp0autorepair.log"
echo [%date% %time%] auto-repair start (slug %SLUG%) >> "%LOG%"

pushd ..
set "NEEDRESTART=0"

rem 1) local tampering with tracked server code?  (check BEFORE we reset)
for /f %%i in ('git status --porcelain -- branch-server 2^>nul ^| find /c /v ""') do set "LOCALCHG=%%i"
if not "!LOCALCHG!"=="0" set "NEEDRESTART=1"

rem 2) fetch the owner's latest (fine if offline - local repair still runs)
git fetch origin main >> "%LOG%" 2>&1

rem 3) hard-reset all tracked files to the repo (reverts code tampering)
for /f %%i in ('git rev-parse HEAD 2^>nul') do set "BEFORE=%%i"
git reset --hard origin/main >> "%LOG%" 2>&1
for /f %%i in ('git rev-parse HEAD 2^>nul') do set "AFTER=%%i"

rem 4) if upstream moved, did server code change between the two commits?
if not "!BEFORE!"=="!AFTER!" (
  git diff --name-only !BEFORE! !AFTER! | findstr /i "branch-server/" >nul && set "NEEDRESTART=1"
)

rem 5) always rebuild the app (repairs any tampering with dist\<slug>)
node build.js --branch=%SLUG% >> "%LOG%" 2>&1
popd

rem 6) restart only when server code actually changed
if "!NEEDRESTART!"=="1" (
  echo [%date% %time%] server code changed -^> restarting >> "%LOG%"
  call "%~dp0stop.cmd" >> "%LOG%" 2>&1
  call "%~dp0start.cmd" >> "%LOG%" 2>&1
)
echo [%date% %time%] auto-repair done (restart=!NEEDRESTART!) >> "%LOG%"
endlocal
