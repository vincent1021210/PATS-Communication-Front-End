#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "缺少 .env，請先執行 ./setup.sh 並編輯 .env"
  exit 1
fi
if [[ ! -f turnserver.conf ]]; then
  echo "缺少 turnserver.conf，請先 cp turnserver.conf.example turnserver.conf 並修改"
  exit 1
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

if [[ -z "${DOMAIN:-}" || "${DOMAIN}" == "pats-call.duckdns.org" ]]; then
  echo "警告：請確認 .env 的 DOMAIN 已改成你的 DuckDNS 網域"
fi

echo "==> 建置並啟動 …"
sudo docker compose up -d --build

echo ""
echo "========================================"
echo " 部署完成後，到手機 PATS → 通話設定："
echo "   信令網址： https://${DOMAIN}"
echo ""
echo " 並在前端 config.js 的 iceServers 加上："
echo "   { urls: 'stun:${DOMAIN}:3478' }"
echo "   { urls: 'turn:${DOMAIN}:3478', username: '${TURN_USER:-pats}', credential: '${TURN_PASS:-***}' }"
echo "========================================"
echo ""
echo "健康檢查："
echo "  curl -s https://${DOMAIN}/health"
echo "查看日誌："
echo "  sudo docker compose logs -f signaling"
echo "  sudo docker compose logs -f caddy"
