@echo off
setlocal

cd /d "%~dp0"

start "Main Bot - Top 50" cmd /k call "%~dp0start-main-bot.bat"
start "Top10 Bot - Top 10" cmd /k call "%~dp0start-top10-bot.bat"
