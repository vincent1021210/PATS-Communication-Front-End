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
echo 信令伺服器啟動中（請保持此視窗開啟）
echo 測試：http://本機IP:3001/health
echo GitHub Pages 請再開「啟動HTTPS隧道.bat」
echo.

set CORS_ORIGIN=https://vincent1021210.github.io
set PORT=3001
call npm start
pause
