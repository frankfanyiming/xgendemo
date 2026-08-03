#!/usr/bin/env bash
# 一键启动。首次会自动装依赖。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

command -v node >/dev/null || { echo "没装 Node。装一个：https://nodejs.org（要 18 以上）"; exit 1; }
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$NODE_MAJOR" -ge 18 ] || { echo "Node 太老了（当前 $(node -v)），要 18 以上"; exit 1; }

[ -d node_modules ] || { echo "装依赖中…"; npm install --silent; }

if [ ! -f .env ] && [ "${MOCK:-}" != "1" ]; then
  cp .env.example .env
  echo
  echo "已生成 .env —— 用编辑器打开填上 MOONSHOT_API_KEY，然后再跑一次 ./start.sh"
  echo "（只想先看界面、不调模型：MOCK=1 ./start.sh）"
  exit 1
fi

echo
if [ "${MOCK:-}" = "1" ]; then
  echo "▸ MOCK 模式（不调模型）"
  MOCK=1 node server.js
else
  node --env-file=.env server.js
fi
