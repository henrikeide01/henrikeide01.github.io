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
set "OPEN=--open"
rem Everything that runs after the server is inside one block: cmd.exe parses a block before
rem running it, so an update that rewrites this file cannot make it read half a line.
:run
(
  node src\server.js %OPEN% %*
  if errorlevel 76 (
    pause
    exit /b
  )
  if errorlevel 75 (
    set "OPEN="
    echo.
    echo  Starter den oppdaterte versjonen ...
    goto run
  )
  pause
  exit /b
)
