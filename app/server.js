import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { castChart } from "./lib/bazi.js";
import {
  personaPrompt, firstReadingPrompt, namingPrompt, dailySystem,
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
async function chat(messages, { json = false, temperature = 0.8 } = {}) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL, messages, temperature,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`模型请求失败 ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

// 流式，供日常对话用
async function chatStream(messages, onDelta) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.85, stream: true }),
  });
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

    const raw = await chat(
      [{ role: "user", content: personaPrompt(chart) }],
      { json: true, temperature: 0.9 }
    );
    const persona = JSON.parse(raw);

    const reading = await chat(
      [{ role: "user", content: firstReadingPrompt(chart, persona) }],
      { temperature: 0.85 }
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
    const text = await chat([{ role: "user", content: namingPrompt(persona) }], { temperature: 0.9 });
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
    const messages = [
      { role: "system", content: dailySystem(chart, persona, guardianName, { voice }) },
      ...history.slice(-24),
    ];
    await chatStream(messages, (d) => res.write(`data: ${JSON.stringify({ d })}\n\n`));
    res.write("data: [DONE]\n\n");
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: String(e.message || e) })}\n\n`);
  }
  res.end();
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
