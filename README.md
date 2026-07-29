# OpenClaw × Kimi K3 × Discord 本地部署套件

在自己电脑上跑一个 [OpenClaw](https://openclaw.ai/) 个人 AI 助手：大脑用 **Kimi K3**（月之暗面 Moonshot 最新旗舰，API 名 `kimi-k3`，1M 上下文），聊天入口用 **Discord**。

本仓库提供：

| 文件 | 用途 |
|---|---|
| `install.sh` | 一键安装脚本（检查 Node → 装 OpenClaw → 生成配置） |
| `openclaw.json5.example` | 带中文注释的配置模板（手动配置时参考） |
| `.env.example` | 密钥填写模板 |

> 配置结构已在 OpenClaw **2026.7.1-2** + Node **24.18.0** 上实测验证（2026-07-29），见文末[验证记录](#验证记录)。

---

## 一、准备三样东西

### 1. Node.js 24

OpenClaw 硬性要求 Node **≥22.22.3 <23、≥24.15 <25 或 ≥25.9**，官方推荐 24。版本差一个补丁号都会被拒绝启动（实测 22.22.2 直接报错），建议用 nvm：

```bash
nvm install 24 && nvm use 24 && nvm alias default 24
```

### 2. Kimi API Key

- **国际版**：[platform.moonshot.ai](https://platform.moonshot.ai) → 控制台 → API Keys → 新建，得到 `sk-...`
- **中国大陆版**：[platform.moonshot.cn](https://platform.moonshot.cn) → API 密钥 → 新建

两边账号和 Key **不互通**。大陆版接口地址是 `https://api.moonshot.cn/v1`，安装时用 `--cn` 参数即可自动切换。

### 3. Discord 机器人 Token

1. 打开 [Discord 开发者后台](https://discord.com/developers/applications) → **New Application**，起个名字（如 "MyClaw"）
2. 左侧 **Bot** → **Reset Token** → 复制 Token（**只显示一次**，马上存好）
3. 同页往下，在 **Privileged Gateway Intents** 里打开：
   - ✅ **Message Content Intent**（必须，否则读不到消息内容）
   - ✅ **Server Members Intent**（建议）
   - ⬜ Presence Intent（可不开）
4. 左侧 **OAuth2** → **OAuth2 URL Generator**：
   - Scopes 勾选 `bot` 和 `applications.commands`
   - Bot Permissions 勾选：View Channels、Send Messages、Read Message History、Embed Links、Attach Files（可选再加 Add Reactions、Send Messages in Threads）
5. 复制页面底部生成的 URL，在浏览器打开，选择你的服务器完成邀请
6. 在 Discord 里右键你的服务器图标 → 隐私设置 → 打开**允许来自服务器成员的私信**（否则机器人无法私聊你）

---

## 二、一键安装

```bash
git clone https://github.com/frankfanyiming/xgendemo.git
cd xgendemo
cp .env.example .env      # 编辑 .env，填入两个密钥
chmod +x install.sh
./install.sh              # 国际版；大陆账号用 ./install.sh --cn
```

脚本会：校验 Node 版本 → `npm install -g openclaw@latest` → 把密钥写进 `~/.openclaw/openclaw.json`（已有配置会先备份）→ 校验默认模型是否解析为 `moonshot/kimi-k3`。

不想用脚本的话，照着 `openclaw.json5.example` 手写 `~/.openclaw/openclaw.json` 也一样；或者用官方向导 `openclaw onboard --auth-choice moonshot-api-key`（大陆版 `--auth-choice moonshot-api-key-cn`），装完再照模板补上 Discord 部分。

---

## 三、启动并配对

```bash
openclaw gateway
```

首次启动会自动从 npm 安装 `@openclaw/discord` 和 `@openclaw/moonshot-provider` 两个插件，然后你应该看到类似日志：

```
[gateway] agent model: moonshot/kimi-k3 (thinking=medium, fast=off)
[gateway] http server listening (… discord …)
[gateway] ready
[discord] [default] starting provider
```

**配对**（OpenClaw 的安全机制，默认陌生人私信不理）：

1. 在 Discord 里给你的机器人发一条私信，它会回一个**配对码**
2. 在电脑上执行：

```bash
openclaw pairing approve discord <配对码>
```

完成！之后私聊直接对话；**服务器频道里默认要 @机器人 才会响应**。

常驻后台运行（systemd/launchd 服务）可用 `openclaw daemon --help` 查看安装方式。

---

## 四、日常使用

| 命令 | 作用 |
|---|---|
| `openclaw gateway status` | 看网关状态（默认监听本机 18789 端口） |
| `openclaw dashboard` | 打开浏览器控制台 UI |
| `openclaw doctor` | 健康检查 + 自动修复建议 |
| `openclaw models list` | 查看可用模型（应能看到 `moonshot/kimi-k3`） |
| `openclaw config get agents.defaults.model.primary` | 确认默认模型 |

想换模型：把配置里 `agents.defaults.model.primary` 改成 `moonshot/kimi-k2.7-code` 等目录内其他型号即可。

---

## 五、常见问题

**启动报 `Node.js >=22.22.3 … is required`**
Node 版本不够，`nvm install 24 && nvm use 24`，然后重新 `npm install -g openclaw@latest`。

**报 `Gateway start blocked: existing config is missing gateway.mode`**
手写配置漏了 `"gateway": { "mode": "local" }`。本仓库模板和脚本已包含；也可按提示跑 `openclaw onboard` 或加 `--allow-unconfigured` 临时绕过。

**日志出现 `channel is configured, but external plugin "discord" is installed without explicit trust`**
配置里缺插件信任声明。需要 `plugins.allow: ["discord", "moonshot"]` 和 `plugins.entries.discord.enabled: true`（模板已含）。

**Discord 通道反复 `channel exited: Failed to resolve Discord application id`**
Token 无效或填错。回开发者后台 Reset Token 重新复制，更新配置后重启网关。

**机器人在服务器频道不理人**
默认行为——服务器频道需要 **@机器人** 才响应；私聊需先完成配对（见上文）。

**Kimi 侧报 401/额度错误**
确认 Key 与接口地址匹配：国际 Key 配 `api.moonshot.ai`，大陆 Key 配 `api.moonshot.cn`，别交叉用。

**安全提醒**：`~/.openclaw/openclaw.json` 里有明文密钥（脚本已将权限设为 600），不要提交到 git；`.env` 已被本仓库 `.gitignore` 忽略。网关默认只监听本机，不要随意暴露到公网。

---

## 验证记录

2026-07-29 在 Linux x86_64 + Node 24.18.0 容器内实测：

- `npm install -g openclaw@latest` → OpenClaw 2026.7.1-2 安装成功
- Node 22.22.2 被版本门槛拒绝（差一个补丁号），换 24.18.0 通过 —— 版本要求是严格校验
- 本套件配置写入后：`openclaw config get agents.defaults.model.primary` → `moonshot/kimi-k3` ✓；`openclaw models list` 含 `moonshot/kimi-k3`（200k 上下文档位）✓
- `openclaw gateway` 启动：自动安装 discord/moonshot 插件 ✓ → `agent model: moonshot/kimi-k3` ✓ → `http server listening`（9 插件含 discord）✓ → `[gateway] ready` ✓ → Discord 通道以占位 Token 启动，按预期在向 Discord 解析 application id 时退出并自动重试 —— 换真实 Token 即为最后一步

## 参考

- [OpenClaw 入门文档](https://docs.openclaw.ai/start/getting-started) ｜ [GitHub](https://github.com/openclaw/openclaw)
- [Discord 通道官方文档](https://docs.openclaw.ai/channels/discord)
- [Moonshot/Kimi 提供商官方文档](https://docs.openclaw.ai/providers/moonshot)
- [Kimi K3 发布报道（VentureBeat）](https://venturebeat.com/technology/chinas-moonshot-ai-releases-kimi-k3-the-largest-open-source-model-ever-rivaling-top-u-s-systems) ｜ [OpenRouter 上的 K3](https://openrouter.ai/moonshotai/kimi-k3)
