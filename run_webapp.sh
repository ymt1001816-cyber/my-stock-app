#!/bin/bash
# 電腦上「只看」用的本機伺服器，由 launchd (com.stock.webapp) 開機自動啟動。
# 本機版比 Render 快 20-30 倍：Yahoo Finance 對雲端 IP 回應很慢，從家裡的網路
# 直接打就快得多（market.py 開頭的註解講的就是這件事）。
cd "$(dirname "$0")" || exit 1

# 啟動前先把 GitHub 上最新的資料拉回來。沒有網路或有本機變更擋住時，pull 失敗
# 也不要讓伺服器起不來——照樣用手上這份資料開起來就好。
# GIT_TERMINAL_PROMPT=0：萬一憑證失效，直接失敗而不是卡在那邊等人輸入帳密。
GIT_TERMINAL_PROMPT=0 git pull --ff-only --quiet 2>&1 || echo "[run_webapp] git pull 略過（用本機現有資料啟動）"

mkdir -p logs
# 只綁 127.0.0.1，不對外開放；不加 --reload，背景服務不需要監看檔案變動。
exec .venv/bin/python -m uvicorn main:app \
    --host 127.0.0.1 --port 8010 --app-dir webapp/backend
