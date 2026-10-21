@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo Cloudflare Tunnel（免費 HTTPS，給 GitHub Pages 用）
echo ------------------------------------------------
echo 1) 請先執行「啟動地端信令.bat」
echo 2) 安裝 cloudflared：
echo    winget install --id Cloudflare.cloudflared
echo    或 https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
echo 3) 本腳本會把本機 3001 暴露成 https://….trycloudflare.com
echo 4) 把顯示的 https 網址貼到 PATS「通話設定」
echo.
echo 此視窗請保持開啟。
echo.

where cloudflared >nul 2>&1
if errorlevel 1 (
  echo 找不到 cloudflared，嘗試用 winget 安裝…
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  where cloudflared >nul 2>&1
  if errorlevel 1 (
    echo 請手動安裝 cloudflared 後再執行本檔。
    pause
    exit /b 1
  )
)

cloudflared tunnel --url http://127.0.0.1:3001
pause
