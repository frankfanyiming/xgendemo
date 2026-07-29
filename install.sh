#!/usr/bin/env bash
# OpenClaw + Kimi K3 (Moonshot) + Discord 一键安装脚本
# 用法:
#   cp .env.example .env   # 填入 MOONSHOT_API_KEY 和 DISCORD_BOT_TOKEN
#   ./install.sh           # 国际版 api.moonshot.ai
#   ./install.sh --cn      # 中国大陆版 api.moonshot.cn
set -euo pipefail

BASE_URL_DEFAULT="https://api.moonshot.ai/v1"
if [[ "${1:-}" == "--cn" ]]; then
  BASE_URL_DEFAULT="https://api.moonshot.cn/v1"
fi

say()  { printf '\033[1;36m[openclaw-setup]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[openclaw-setup] 错误:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- 1. 检查 Node 版本 ----------
command -v node >/dev/null 2>&1 || fail "未找到 Node.js。请先安装 Node 24（推荐 nvm: https://github.com/nvm-sh/nvm，然后 nvm install 24）"

# OpenClaw 硬性要求: >=22.22.3 <23 或 >=24.15.0 <25 或 >=25.9.0（实测 22.22.2 也会被拒绝）
if ! node -e '
  const [a,b,c] = process.versions.node.split(".").map(Number);
  const ok = (a===22 && (b>22 || (b===22 && c>=3)))
          || (a===24 && b>=15)
          || (a===25 && b>=9)
          || a>25;
  process.exit(ok ? 0 : 1);
'; then
  fail "Node $(node -v) 不满足 OpenClaw 要求（>=22.22.3 <23，或 >=24.15，或 >=25.9）。推荐: nvm install 24 && nvm use 24"
fi
say "Node $(node -v) ✓"

# ---------- 2. 读取密钥（.env 或环境变量，缺失时交互式询问） ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  say "读取 $SCRIPT_DIR/.env"
  set -a; # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env"; set +a
fi

ask_if_missing() {
  local var="$1" prompt="$2"
  if [[ -z "${!var:-}" ]]; then
    if [[ -t 0 ]]; then
      read -r -p "$prompt: " "${var?}"
      [[ -n "${!var}" ]] || fail "$var 不能为空"
    else
      fail "缺少 $var（请写入 .env 或以环境变量提供）"
    fi
  fi
}
ask_if_missing MOONSHOT_API_KEY  "请输入 Kimi (Moonshot) API Key (sk-...)"
ask_if_missing DISCORD_BOT_TOKEN "请输入 Discord 机器人 Token"
MOONSHOT_BASE_URL="${MOONSHOT_BASE_URL:-$BASE_URL_DEFAULT}"
say "Moonshot 接入点: $MOONSHOT_BASE_URL"

# ---------- 3. 安装 OpenClaw ----------
if command -v openclaw >/dev/null 2>&1; then
  say "已安装 $(openclaw --version 2>/dev/null | head -1)，执行升级…"
fi
say "npm install -g openclaw@latest（可能需要几分钟）"
npm install -g openclaw@latest
say "$(openclaw --version | head -1) ✓"

# ---------- 4. 生成 ~/.openclaw/openclaw.json ----------
CONF_DIR="$HOME/.openclaw"
CONF="$CONF_DIR/openclaw.json"
mkdir -p "$CONF_DIR"
if [[ -f "$CONF" ]]; then
  BAK="$CONF.bak.$(date +%Y%m%d%H%M%S)"
  cp "$CONF" "$BAK"
  say "检测到已有配置，已备份到 $BAK（本脚本会整体覆盖，如需保留自定义项请手动合并）"
fi

# 用 node 生成 JSON，避免特殊字符转义问题；密钥经环境变量传入，不进 shell 参数
MOONSHOT_API_KEY="$MOONSHOT_API_KEY" DISCORD_BOT_TOKEN="$DISCORD_BOT_TOKEN" \
MOONSHOT_BASE_URL="$MOONSHOT_BASE_URL" CONF_PATH="$CONF" node <<'EOF'
const fs = require("fs");
const config = {
  env: {
    MOONSHOT_API_KEY: process.env.MOONSHOT_API_KEY,
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
  },
  gateway: { mode: "local" },
  agents: { defaults: { model: { primary: "moonshot/kimi-k3" } } },
  models: {
    mode: "merge",
    providers: {
      moonshot: {
        baseUrl: process.env.MOONSHOT_BASE_URL,
        apiKey: "${MOONSHOT_API_KEY}",
        api: "openai-completions",
      },
    },
  },
  plugins: {
    allow: ["discord", "moonshot"],
    entries: { discord: { enabled: true }, moonshot: { enabled: true } },
  },
  channels: {
    discord: {
      enabled: true,
      token: { source: "env", provider: "default", id: "DISCORD_BOT_TOKEN" },
    },
  },
};
fs.writeFileSync(process.env.CONF_PATH, JSON.stringify(config, null, 2) + "\n");
EOF
chmod 600 "$CONF"
say "已写入 $CONF ✓"

# ---------- 5. 校验 ----------
[[ "$(openclaw config get agents.defaults.model.primary 2>/dev/null | tail -1)" == *"moonshot/kimi-k3"* ]] \
  && say "配置校验: 默认模型 moonshot/kimi-k3 ✓" \
  || say "提示: 无法自动校验配置，可运行 openclaw doctor 检查"

cat <<'NEXT'

✅ 安装完成！接下来：

  1) 启动网关（首次启动会自动安装 discord / moonshot 插件）:
       openclaw gateway
     常驻后台可用 systemd/launchd 服务，见: openclaw daemon --help

  2) 在 Discord 里给你的机器人发一条私信，会收到一个配对码，然后执行:
       openclaw pairing approve discord <配对码>

  3) 之后即可在 Discord 私聊使用；服务器频道里默认需要 @机器人 才会响应。
     控制台 UI: openclaw dashboard   健康检查: openclaw doctor

NEXT
