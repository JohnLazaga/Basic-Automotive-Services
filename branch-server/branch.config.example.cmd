@echo off
rem ===========================================================================
rem  Per-branch settings for this mini-PC.
rem  COPY this file to  branch.config.cmd  and edit the values below.
rem  (branch.config.cmd is git-ignored so each branch keeps its own settings.)
rem ===========================================================================

rem  Slug must match an entry in ..\branches.json (used to build the app).
set "SLUG=sudipen"

rem  Display name shown in /health and logs.
set "BRANCH=Sudipen"

rem  Port the server listens on (default 8790).
set "PORT=8790"

rem  Where the built app for this branch lives (served at / by the server).
set "APP_DIR=..\dist\%SLUG%"

rem  Optional: require this token on /admin endpoints (leave blank to allow an
rem  admin session instead). Example:  set "ADMIN_TOKEN=some-long-secret"
set "ADMIN_TOKEN="

rem  Automatic parts re-sync from SQL Server (keeps the catalog fresh vs the
rem  live database). Reads are read-only + NOLOCK, so they never affect it.
rem    SYNC_AT           = daily re-sync at this local time, "HH:MM" (24-hour).
rem                        Leave blank to turn auto-sync OFF (manual Re-sync only).
rem    SYNC_INTERVAL_MIN = alternative: re-sync every N minutes (overrides SYNC_AT).
set "SYNC_AT=03:00"
set "SYNC_INTERVAL_MIN="
