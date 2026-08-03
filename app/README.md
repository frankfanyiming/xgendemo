# 守护者 v0

由出生时刻生成的守护神。**召唤全程发生在对话里**——它一开始看不见你，
你报出生辰，它逐渐具象，读一段你，然后由**你给它起名字**。

上承 `../design/` 里的规格：`HARNESS.md`（硬约束）· `SOUL.day1.md`（出场设置）· `FLOW.md`（流程）。

## 跑起来

```bash
cd app
npm install
cp .env.example .env      # 填入 MOONSHOT_API_KEY
npm start                 # → http://localhost:3210
```

只想看界面、不调模型：

```bash
MOCK=1 node server.js
```

## 结构

```
server.js         Express：/api/summon（排盘→人格→首读）、/api/naming、/api/chat（SSE 流式）
lib/bazi.js       排盘：四柱、五行力量、身强弱、喜用神、出生时刻的白话描述
lib/prompts.js    SOUL 常量 + 三组 prompt（人格生成 / 首读 / 日常）
public/           两个空间的前端：对话（含逐渐具象的 orb）+ 串门（锁）
```

## 已经落地的设计决策

| 决策 | 在哪 |
|---|---|
| 召唤在对话里发生，没有表单向导 | `public/app.js` 状态机 |
| **模糊 → 具象 = 被理解的程度** | `resolve()` 六档，选定形象后用其色相 |
| 要生辰的理由当场成立（「我还看不见你」） | `OPENERS` + 开场四句 |
| **不确定时辰是一等公民** | 前端「不确定」按钮 → 后端 `hourKnown:false`，日柱主导 |
| 证据是人话不是符号 | `bazi.js: describeMoment()` → "9月末，天刚黑透的时候" |
| 术语后台可查 | 「看我是怎么算的 ›」折叠卡片 |
| **形象候选每人独有** | 由 LLM 从各自命盘生成，不是固定原型 |
| **名字归主人** | `/api/naming`：它只问，不自称已有名字 |
| 性格 = 命里缺的那味药；毛病 = 同一张盘 | `prompts.js: personaPrompt()` |
| 语音优先（为数字人铺路） | Web Speech API：`speak()` / `webkitSpeechRecognition` |
| 串门锁着，锁由它自己解释 | `index.html .visit` |

## 语音

点右下角 ◉ 打开语音模式（它会朗读），再点一次开始录音。
语音模式下 prompt 自动切到 `VOICE_MODE`：40 字以内、最多两句、不分点。
需要 Chrome（Web Speech API）。

## 还没做

- 账号与持久化（刷新即重来）
- 引荐与串门（需要第二个用户）
- 主动消息、日记、每周自省
- 端上模型、数字人

## 注意

`.env` 含密钥，已被 `.gitignore` 忽略，别提交。
