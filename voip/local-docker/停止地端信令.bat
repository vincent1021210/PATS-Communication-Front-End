@echo off
chcp 65001 >nul
cd /d "%~dp0"
docker compose down
echo 已停止。
pause
