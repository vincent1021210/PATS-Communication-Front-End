#!/usr/bin/env bash
# 依 .env 產生 turnserver.conf
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "請先：cp .env.example .env 並填 PUBLIC_IP / TURN_PASS"
  exit 1
fi

# shellcheck disable=SC1091
source .env

: "${PUBLIC_IP:?請在 .env 填 PUBLIC_IP}"
: "${TURN_USER:=pats}"
: "${TURN_PASS:?請在 .env 填 TURN_PASS}"
: "${TURN_REALM:=pats.local}"

sed \
  -e "s/YOUR_PUBLIC_IP/${PUBLIC_IP}/g" \
  -e "s|user=pats:please-change-this-password|user=${TURN_USER}:${TURN_PASS}|g" \
  -e "s/realm=pats.local/realm=${TURN_REALM}/g" \
  turnserver.conf.example > turnserver.conf

echo "已產生 turnserver.conf（external-ip=${PUBLIC_IP}, user=${TURN_USER}）"
echo "接著：docker compose up -d"
echo "前端 config.js 範例："
echo "  { urls: 'turn:${PUBLIC_IP}:3478', username: '${TURN_USER}', credential: '${TURN_PASS}' }"
