@echo off
chcp 65001 >nul
title YouTube Multi-Stream Manager (Desktop App + Web Online)
echo ============================================================
echo   KHOI DONG APP & LINK WEB ONLINE LIVESTREAM YOUTUBE
echo ============================================================
cd /d "%~dp0"

if not exist "node_modules" (
    echo [1/2] Dang cai dat thu vien va FFmpeg...
    call npm.cmd install
    node node_modules/ffmpeg-static/install.js
)

echo [2/2] Dang mo App tren may tinh va khoi tao Link Web Online...
node server.js --desktop
pause
