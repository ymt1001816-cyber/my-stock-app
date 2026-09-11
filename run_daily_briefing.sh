#!/bin/bash
# 每日簡報排程進入點（取代舊機器的 每日簡報.bat）。
# 由 ~/Library/LaunchAgents/com.stock.daily-briefing.plist 每天早上叫起來。
cd "$(dirname "$0")" || exit 1

# GITHUB_TOKEN 放在同目錄的 .env（已被 .gitignore 擋掉，不會上傳）。
# 有設才會把簡報推回 GitHub → 手機上的線上版才看得到；沒設就只更新本機 config.json。
[ -f .env ] && set -a && . ./.env && set +a

mkdir -p reports
exec .venv/bin/python daily_briefing.py >> reports/briefing_log.txt 2>&1
