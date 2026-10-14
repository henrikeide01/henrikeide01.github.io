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
node src\server.js --open %*
pause
