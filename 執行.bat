@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   美股投資追蹤儀表板 啟動中...
echo   關閉此視窗即可停止程式
echo ============================================
python -m streamlit run app.py
pause
