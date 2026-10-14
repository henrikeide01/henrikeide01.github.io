@echo off
cd /d "%~dp0"
title Dota Coach - angre oppdatering
echo  Setter tilbake versjonen fra for siste oppdatering ...
(
  node tools\rollback.js
  pause
  exit /b
)
