@echo off
cd /d "%~dp0"
title Dota Coach demo
echo  Starter en simulert kamp. Apne http://localhost:3355 i nettleseren for a se coachen.
node tools\demo.js %*
pause
