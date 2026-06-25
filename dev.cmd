@echo off
rem Rebuild the isolated LOCAL dev build (no cloud, private storage) and open it.
rem Safe to use while the team works live — this never touches the live database.
cd /d "%~dp0"
node build.js dev
if errorlevel 1 ( echo Build failed. & pause & exit /b 1 )
start "" "%~dp0BASIC_dev.html"
