@echo off
rem Registers a scheduled task that runs auto-repair.cmd hourly.
rem Run this once on the mini-PC (right-click -> Run as administrator is safest).
rem
rem Default: runs as the CURRENT user, only when logged on (fine for a mini-PC
rem that auto-logs-in the owner). For a headless box, re-create with /RU <owner>
rem /RP <password> so it runs whether logged on or not.
rem
rem Private repo? The task's account needs stored git credentials. Public repo
rem (as with GitHub Pages sites) needs none.
set "TASK=BASIC-branch-auto-repair"
schtasks /Create /TN "%TASK%" /TR "\"%~dp0auto-repair.cmd\"" /SC HOURLY /F
if errorlevel 1 (
  echo.
  echo Could not create the task. Try running this as administrator.
  pause & exit /b 1
)
echo.
echo Installed "%TASK%" - runs hourly:  %~dp0auto-repair.cmd
echo Change cadence in Task Scheduler, or edit /SC (e.g. /SC MINUTE /MO 30).
echo Remove with:  schtasks /Delete /TN "%TASK%" /F
pause
