@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ========================================
echo  PATS 信令 HTTPS 隧道（給 GitHub Pages）
echo ========================================
echo.
echo 請先確認「啟動信令.bat」已經在跑（port 3001）。
echo 接著會用 localtunnel 產生 https:// 網址。
echo 把網址貼到 PATS「通話設定」即可。
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo 找不到 Node.js。
  pause
  exit /b 1
)

echo 正在建立隧道，請稍候…
echo.
npx --yes localtunnel --port 3001
pause
