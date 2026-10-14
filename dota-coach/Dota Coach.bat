@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js mangler. Last ned "LTS" fra https://nodejs.org og installer det.
  start https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules\electron goto install
if exist .needs-install goto install
goto launch
:install
echo  Installerer app-komponenten ^(tar et minutt^) ...
call npm install
if errorlevel 1 (
  echo  Installasjonen feilet. Sjekk internett og start filen igjen.
  pause
  exit /b 1
)
if exist .needs-install del .needs-install
:launch
title Dota Coach
call node_modules\.bin\electron.cmd overlay\main.cjs
