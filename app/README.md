# 守护者 v0

由出生时刻生成的守护神。**召唤全程发生在对话里**——它一开始看不见你，
你报出生辰，它逐渐具象，读一段你，然后由**你给它起名字**。

规格在 `../design/`：`HARNESS.md`（硬约束）· `SOUL.day1.md`（出场设置）· `FLOW.md`（流程）。

## 跑起来

```bash
cd app
./start.sh
```

第一次会自动装依赖并生成 `.env`，你填上 Kimi 的 key 再跑一次：

```
MOONSHOT_API_KEY=sk-xxxxxxxx        # platform.moonshot.cn → API 密钥
MOONSHOT_BASE_URL=https://api.moonshot.cn/v1
MODEL=kimi-k2.6
```

打开 http://localhost:3210

**只想看界面、不花钱**：`MOCK=1 ./start.sh`

**用别的模型**：任何 OpenAI 兼容接口都行，改 `MOONSHOT_BASE_URL` 和 `MODEL` 即可。

## 用法

| 动作 | 怎么做 |
|---|---|
| 语音 | 点右下 ◉ 开语音（它会朗读），再点一次说话。需要 Chrome |
| 不知道出生时辰 | 点「不确定」，用日柱主导，照样能算 |
| 看它是怎么算的 | 首读上方那行虚线小字，展开是完整四柱推导 |
| 换个人重来 | 右上角「重来」（会清掉本地全部记录） |
| 看它脑子里有什么 | 右上角「后台」→ http://localhost:3210/admin.html |

**刷新不会丢**——守护神、名字、聊天记录都存在浏览器 localStorage 里。

## 后台 `/admin.html`

这一页只说真话：**文档里写了、代码里没做的，一律标红。**

| 看什么 | 说明 |
|---|---|
| **真实 prompt** | 拼装完、这一刻真正发给模型的完整 system prompt。<br>对话质感不对，八成是这段的问题——以前你从来没见过它 |
| **Soul（可编辑）** | 在浏览器里直接改，**下一句话就生效，不用重启**；重启回到文件版本 |
| 记忆 | 原始对话数组 + 一条红线标出「超过 24 条的部分不会进上下文」 |
| 命盘 / 人格档案 | 召唤时算的和生成的，包括给模型看的原始 JSON |
| **硬约束** | HARNESS L0–L5 十九条，逐条 ✓ / ! / ✕。<br>`!` = 只写在 prompt 里，没有代码兜底 |
| Skills | 现在是空的，如实写着为什么 |
| 数据 | 导出全部 JSON / 一键销毁（HARNESS L4 退出权） |

> **改 Soul 的正确姿势**：后台改 → 回对话页发一句 → 不满意再改。
> 调顺了之后，把文本粘回 `lib/prompts.js` 存成永久版本。

## 结构

```
start.sh          一键启动
server.js         /api/summon（排盘→人格→首读）、/api/naming、/api/chat（SSE 流式）
                  /api/admin/*（soul 读写 · prompt 预览 · 硬约束状态 · skills）
lib/bazi.js       排盘：四柱、五行力量、身强弱、喜用神、出生时刻的白话描述
lib/prompts.js    SOUL 常量 + 三组 prompt —— 改对话质感就改这里
public/index.html 两个空间：对话（含逐渐具象的 orb）+ 串门（锁）
public/admin.html 后台
```

**要调它说话的味道，只动 `lib/prompts.js`（或后台的 Soul 框）。** 那是整个产品的杠杆所在。

## 落地了哪些设计决策

| 决策 | 在哪 |
|---|---|
| 召唤在对话里，没有表单向导 | `public/app.js` 状态机 |
| **模糊 → 具象 = 被理解的程度** | `app.js: resolve()` 六档；选定形象后用其色相 |
| 要生辰的理由当场成立（「我还看不见你」） | `app.js: OPENERS` |
| **不确定时辰是一等公民** | 前端按钮 → `bazi.js` 走日柱主导 |
| 证据是人话不是符号 | `bazi.js: describeMoment()` → "9月末，天刚黑透的时候" |
| 术语后台可查 | 「看我是怎么算的 ›」折叠卡片 |
| **形象候选每人独有** | `prompts.js: personaPrompt()`，由各自命盘生成 |
| **名字归主人** | `prompts.js: namingPrompt()` —— 它只问，不自称有名字 |
| 性格 = 命里缺的那味药；毛病 = 同一张盘 | `personaPrompt()` 的两条推导规则 |
| 信任证明：首读后主动认怂、说错就认 | `prompts.js: SOUL` + `firstReadingPrompt()` |
| 语音优先（为数字人铺路） | `app.js: speak()` / `prompts.js: VOICE_MODE` |
| 「认识 N 天」是累计不是连续 | `app.js: daysKnown()` —— 断了不清零、不提示 |
| 退出权：可查 / 可删 / 可带走 | `admin.html` 数据区 |

## 还没做

后台「硬约束」那一页是权威清单，这里只说最大的四个洞：

- **没有记忆提炼**。所谓记忆就是原始对话数组，超窗口的部分直接消失
- **没有 skill**。它只能说话，不能上网、不能看日历、不能记日记——
  「它今天在干嘛」目前是假的
- **没有主动消息**。没有心跳和调度，它不会先开口
- **硬约束大半只写在 prompt 里**，没有代码级兜底（危机识别、花费硬顶、深夜静默都是）

以及：服务端账号与多用户、引荐与串门（需要第二个用户）、端上模型、数字人。

## 注意

`.env` 含密钥，已被 `.gitignore` 忽略，别提交。
