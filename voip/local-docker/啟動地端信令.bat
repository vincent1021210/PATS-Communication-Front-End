@echo off
chcp 65001 >nul
cd /d "%~dp0"

where docker >nul 2>&1
if errorlevel 1 (
  echo 找不到 Docker。請先安裝 Docker Desktop：
  echo https://www.docker.com/products/docker-desktop/
  echo 安裝後請開啟 Docker Desktop，再執行本檔。
  pause
  exit /b 1
)

echo 正在建置並啟動 PATS 地端信令（port 3001）...
docker compose up -d --build
if errorlevel 1 (
  echo 啟動失敗。請確認 Docker Desktop 已開啟。
  pause
  exit /b 1
)

echo.
echo ========================================
echo  信令已啟動
echo  健康檢查：http://127.0.0.1:3001/health
echo.
echo  查本機區網 IP（PowerShell）：
echo    ipconfig
echo  手機與電腦同一 Wi-Fi 時，通話設定填：
echo    http://你的IPv4:3001
echo.
echo  若要用 GitHub Pages（HTTPS），另開：
echo    啟動Cloudflare隧道.bat
echo ========================================
echo.
docker compose ps
pause
