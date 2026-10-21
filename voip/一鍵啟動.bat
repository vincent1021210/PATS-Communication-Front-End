@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo 找不到 Node.js。請先安裝 https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo 第一次使用，正在安裝依賴…
  call npm install
  if errorlevel 1 (
    echo 安裝失敗。
    pause
    exit /b 1
  )
)

echo.
echo 即將啟動信令伺服器 + HTTPS 隧道
echo 成功後會顯示 https://xxxx.loca.lt
echo 請把該網址貼到手機 PATS「通話設定」
echo.
echo 此視窗請保持開啟。
echo.

set PORT=3001
set CORS_ORIGIN=https://vincent1021210.github.io
node "一鍵啟動信令與隧道.js"
pause
