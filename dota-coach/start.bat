@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js mangler. Last ned "LTS" fra https://nodejs.org og installer det, og start denne filen igjen.
  echo.
  start https://nodejs.org
  pause
  exit /b 1
)
title Dota Coach
set DOTACOACH_LAUNCHER=1
set OPEN=--open
:run
node src\server.js %OPEN% %*
if errorlevel 76 goto end
if errorlevel 75 (
  set OPEN=
  echo.
  echo  Starter den oppdaterte versjonen ...
  goto run
)
:end
pause
