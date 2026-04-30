@echo off
setlocal

cd /d "%~dp0"

set "ENV_FILE=%CD%\.env"

echo Starting main bot with ENV_FILE=%ENV_FILE%
node src\app.js

echo.
echo Main bot stopped.
pause
