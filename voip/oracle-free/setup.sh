#!/usr/bin/env bash
# 在 Oracle Ubuntu 主機上執行一次：安裝 Docker、準備設定檔
set -euo pipefail

cd "$(dirname "$0")"

echo "==> 安裝 Docker / Compose …"
if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y docker.io docker-compose-v2 curl
  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER" || true
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "已建立 .env，請用 nano .env 填 DOMAIN / PUBLIC_IP / TURN 密碼"
fi

if [[ ! -f turnserver.conf ]]; then
  cp turnserver.conf.example turnserver.conf
  echo "已建立 turnserver.conf，請把 YOUR_PUBLIC_IP 與帳密改成 .env 裡的值"
fi

echo ""
echo "下一步："
echo "  1) nano .env"
echo "  2) nano turnserver.conf   # external-ip 與 user= 帳密"
echo "  3) ./deploy.sh"
echo ""
echo "若剛加入 docker 群組，請先 logout/login 再 deploy。"
