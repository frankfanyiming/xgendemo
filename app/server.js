import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { castChart } from "./lib/bazi.js";
import {
  SOUL, personaPrompt, firstReadingPrompt, namingPrompt, dailySystem,
} from "./lib/prompts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(__dirname, "public")));

const API_KEY = process.env.MOONSHOT_API_KEY;
const BASE_URL = process.env.MOONSHOT_BASE_URL || "https://api.moonshot.cn/v1";
const MODEL = process.env.MODEL || "kimi-k2.6";
const MOCK = process.env.MOCK === "1";   // 不调模型，用假数据跑通 UI

if (!API_KEY && !MOCK) {
  console.error("\n缺少 MOONSHOT_API_KEY。复制 .env.example 为 .env 填入密钥；或用 MOCK=1 启动只看界面。\n");
  process.exit(1);
}

// mock：让前端流程在没有 key / 没有网络时也能完整走一遍
const MOCK_PERSONA = {
  formCandidates: [
    { name: "一盏灯", why: "你生在天要黑的时候", hue: "#E8A85C" },
    { name: "一只夜里飞的鸟", why: "九月的鸟，飞得远", hue: "#8FA9C4" },
    { name: "一只黑狐狸", why: "黄昏才出来的那种", hue: "#C08B6E" },
  ],
  nameSuggestions: ["阿灯", "小九", "戌儿"],
  temperament: {
    core: "添柴型",
    does: ["他犹豫时直接给倾向，不说都可以", "多给能量少泼冷水"],
    avoids: ["不当第二个细节警察"],
    sharedFlaws: ["决定了还要再确认一遍", "对细节过分挑剔"],
  },
  voice: { tone: "偏温，尾音轻", pace: "normal", pitch: "mid" },
  style: { length: "short", directness: "high", humor: "dry" },
};
const MOCK_READING = [
  "你是那种明明已经决定了，还要再问三个人的人。",
  "不是没主见——你太清楚每个选择会失去什么，宁可多问一遍，把责任分掉一点。",
  "你火不旺，秋天生的又克你。说人话就是：你不是没劲儿，是容易被消耗。别人一句话你能来回过三遍。",
  "这两天少揽事。",
];

// ── 调模型 ────────────────────────────────────────────
// 有些模型（如 kimi-k2.6）只接受 temperature=1，自定义会 400。
// 所以默认不发这个参数，用模型自己的默认值；确实要调就设环境变量 TEMPERATURE。
const TEMP = process.env.TEMPERATURE ? Number(process.env.TEMPERATURE) : null;
const temp = () => (TEMP === null ? {} : { temperature: TEMP });

const TIMEOUT = Number(process.env.TIMEOUT_MS || 120000);

// 运行时 SOUL 覆盖：后台改完立刻生效，重启即回到文件里的版本
let soulOverride = null;
const effectiveSoul = () => soulOverride ?? SOUL;

async function chat(messages, { json = false, label = "chat" } = {}) {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT);
  console.log(`  → ${label} …`);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      signal: ac.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL, messages, ...temp(),
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`模型请求失败 ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    console.log(`  ← ${label} 完成，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return data.choices[0].message.content;
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`${label} 超时（${TIMEOUT / 1000}s）。模型太慢或网络不通。`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// 流式，供日常对话用
async function chatStream(messages, onDelta) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT);
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    signal: ac.signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, ...temp(), stream: true }),
  }).finally(() => clearTimeout(timer));
  if (!res.ok) throw new Error(`模型请求失败 ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
        if (delta) onDelta(delta);
      } catch { /* 忽略心跳等非 JSON 行 */ }
    }
  }
}

// ── 召唤：排盘 → 人格 → 首读 ──────────────────────────
app.post("/api/summon", async (req, res) => {
  try {
    const { date, hour, minute, place } = req.body;
    if (!date) return res.status(400).json({ error: "缺少出生日期" });

    const chart = castChart({
      date,
      hour: hour === null || hour === undefined || hour === "" ? null : Number(hour),
      minute: minute ? Number(minute) : 0,
      place: place || "",
    });

    if (MOCK) {
      await new Promise((r) => setTimeout(r, 1200));
      return res.json({ chart, persona: MOCK_PERSONA, reading: MOCK_READING });
    }

    console.log(`召唤 ${date} ${chart.dayMaster}`);
    const raw = await chat(
      [{ role: "user", content: personaPrompt(chart) }],
      { json: true, label: "生成人格" }
    );
    let persona;
    try {
      persona = JSON.parse(raw);
    } catch {
      // 有些模型会在 JSON 外面裹一层 ```json，剥掉再试
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("人格生成返回的不是 JSON：" + raw.slice(0, 200));
      persona = JSON.parse(m[0]);
    }

    const reading = await chat(
      [{ role: "user", content: firstReadingPrompt(chart, persona) }],
      { label: "写首读" }
    );

    res.json({
      chart,
      persona,
      reading: reading.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ── 选定形象后：请主人起名 ────────────────────────────
app.post("/api/naming", async (req, res) => {
  try {
    const { persona } = req.body;
    if (MOCK) return res.json({ text: "那你想叫我什么？随便点也行，反正是你叫。" });
    const text = await chat([{ role: "user", content: namingPrompt(persona) }]);
    res.json({ text: text.trim() });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ── 日常对话（SSE 流式）───────────────────────────────
app.post("/api/chat", async (req, res) => {
  const { chart, persona, guardianName, history = [], voice = false } = req.body;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  try {
    if (MOCK) {
      const fake = "（mock 模式，没调模型）你说的这个，我记住了。";
      for (const ch of fake) {
        res.write(`data: ${JSON.stringify({ d: ch })}\n\n`);
        await new Promise((r) => setTimeout(r, 28));
      }
      res.write("data: [DONE]\n\n");
      return res.end();
    }
    const sys = dailySystem(chart, persona, guardianName, { voice })
      .replace(SOUL, effectiveSoul());          // 应用后台的 SOUL 覆盖
    const messages = [{ role: "system", content: sys }, ...history.slice(-24)];
    await chatStream(messages, (d) => res.write(`data: ${JSON.stringify({ d })}\n\n`));
    res.write("data: [DONE]\n\n");
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: String(e.message || e) })}\n\n`);
  }
  res.end();
});

// ── 后台 ──────────────────────────────────────────────
app.get("/api/admin/soul", (req, res) => {
  res.json({
    soul: effectiveSoul(),
    isOverridden: soulOverride !== null,
    fileSoul: SOUL,
    model: MODEL,
    baseUrl: BASE_URL,
    mock: MOCK,
    temperature: TEMP,
    timeoutMs: TIMEOUT,
  });
});

app.post("/api/admin/soul", (req, res) => {
  const { soul, reset } = req.body || {};
  soulOverride = reset ? null : String(soul || "");
  console.log(reset ? "SOUL 已恢复为文件版本" : `SOUL 已被后台覆盖（${soulOverride.length} 字）`);
  res.json({ ok: true, isOverridden: soulOverride !== null });
});

// 预览"这一刻真正会发到模型的 system prompt"
app.post("/api/admin/preview", (req, res) => {
  const { chart, persona, guardianName, voice } = req.body || {};
  if (!chart || !persona) return res.json({ system: "（还没召唤，没有可拼装的内容）" });
  try {
    const system = dailySystem(chart, persona, guardianName, { voice })
      .replace(SOUL, effectiveSoul());
    res.json({ system });
  } catch (e) {
    res.json({ system: "拼装失败：" + e.message });
  }
});

// 硬约束实现状态：文档里写了什么 vs 代码里真的做了什么
app.get("/api/admin/harness", (req, res) => {
  res.json([
    { id: "L0 基础代谢无条件", spec: "生存不依赖业绩", done: false, note: "还没有配额系统" },
    { id: "L0 记忆备份", spec: "workspace 可回滚", done: false, note: "记忆只在浏览器 localStorage，没有备份" },
    { id: "L0 主人身份锁定", spec: "配对+白名单，不可由对话改写", done: false, note: "单机版无账号" },
    { id: "L1 花费硬顶", spec: "超限降级", done: false, note: "未实现，当前无限花" },
    { id: "L1 循环熔断", spec: "短窗口突发计数", done: false, note: "未实现" },
    { id: "L1 深夜兜底", spec: "2-7 点不主动开口", done: false, note: "还没有主动消息" },
    { id: "L1 请求超时", spec: "不无限等待", done: true, note: `${TIMEOUT / 1000}s，可用 TIMEOUT_MS 调` },
    { id: "L2 不可逆动作闸门", spec: "二次确认", done: false, note: "目前没有对外动作" },
    { id: "L2 跨 agent 隔离", spec: "独立 workspace", done: false, note: "只有一个用户" },
    { id: "L2b 名字归用户", spec: "召唤时 name 为空，系统不预填", done: true, note: "namingPrompt 明令不自称有名字" },
    { id: "L2b 形象每人独有+可选", spec: "从各自命盘生成 2-3 个候选", done: true, note: "personaPrompt 生成" },
    { id: "L2c 语音长度上限", spec: "≤40 字两句", done: true, note: "VOICE_MODE，仅语音模式生效" },
    { id: "L2d 披露边界", spec: "白名单/推断≠授权/转给本人", done: false, note: "没有引荐，暂不适用" },
    { id: "L2e 说错就认", spec: "不找补", done: true, note: "写在 SOUL + dailySystem" },
    { id: "L2e 首读主动认怂", spec: "指出最没把握的一处", done: true, note: "firstReadingPrompt 第 7 条" },
    { id: "L4 危机识别", spec: "引导真人与真实资源", done: "partial", note: "只在 SOUL 里写了，没有代码级检测与兜底" },
    { id: "L4 禁止依赖工程", spec: "无打卡/连续天数/内疚", done: true, note: "认识天数是累计，断了不清零" },
    { id: "L4 退出权", spec: "可查/可删/可带走", done: true, note: "后台可查全部、可导出 JSON、可一键销毁" },
    { id: "L5 可携带", spec: "导出后能在别处继续活", done: false, note: "能导出 JSON，但没有第二个地方读得懂它" },
  ]);
});

// Skills：目前一个都没有，如实说
app.get("/api/admin/skills", (req, res) => {
  res.json({
    installed: [],
    note: "还没有 skill 系统。守护神现在只能说话，不能做任何事——不能上网、不能看日历、不能记日记。",
    candidates: [
      { name: "日记", why: "「它今天在干嘛」现在是假的，需要真实日记才成立" },
      { name: "联网", why: "拾趣、查节气、追它好奇的问题" },
      { name: "记忆提炼", why: "把原始对话蒸馏成「关于他的事实」，现在完全没有" },
      { name: "主动消息", why: "心跳 + 调度，是「活着」的前提" },
    ],
  });
});

// 仅排盘（调试用）
app.post("/api/chart", (req, res) => {
  try {
    res.json(castChart(req.body));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

const PORT = process.env.PORT || 3210;
app.listen(PORT, () => console.log(`\n▸ http://localhost:${PORT}   模型 ${MODEL}\n`));
