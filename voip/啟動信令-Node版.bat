@echo off
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js not found. Install from https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

set PORT=3001
set CORS_ORIGIN=https://vincent1021210.github.io

echo.
echo PATS signaling starting on http://127.0.0.1:3001
echo Health check: http://127.0.0.1:3001/health
echo Keep this window open.
echo.

node server.js
pause
