@echo off
chcp 65001 >nul
cd /d "%~dp0"
python daily_briefing.py >> reports\briefing_log.txt 2>&1
