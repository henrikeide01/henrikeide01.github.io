@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js mangler. Last ned "LTS" fra https://nodejs.org og installer det.
  start https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules\electron (
  echo  Installerer overlay-komponenten ^(kun forste gang, tar et minutt^) ...
  call npm install
)
title Dota Coach overlay
call npx electron overlay\main.cjs
