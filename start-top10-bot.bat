@echo off
setlocal

cd /d "%~dp0"

set "ENV_FILE=%CD%\.env.bot2"

echo Starting top10 bot with ENV_FILE=%ENV_FILE%
node src\app.js

echo.
echo Top10 bot stopped.
pause
