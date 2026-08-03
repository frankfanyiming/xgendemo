// 守护者 · 前端状态机 + 语音
const $ = (id) => document.getElementById(id);
const thread = $("thread"), orb = $("orb"), pname = $("pname"), pstate = $("pstate");
const composer = $("composer"), sayInput = $("say"), mic = $("mic");

const S = {
  chart: null, persona: null, form: null, name: null,
  history: [], voice: false, stage: 0, firstMet: null,
};

// ── 持久化：刷新不丢 ──────────────────────────────────
const KEY = "guardian.v1";
function save() {
  if (!S.chart) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({
      chart: S.chart, persona: S.persona, form: S.form,
      name: S.name, history: S.history, firstMet: S.firstMet,
    }));
  } catch { /* 隐私模式下写不了，忽略 */ }
}
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}
function wipe() {
  try { localStorage.removeItem(KEY); } catch {}
  location.reload();
}
const daysKnown = () =>
  S.firstMet ? Math.floor((Date.now() - S.firstMet) / 86400000) + 1 : 1;

// ── 具象度（0 未成形 → 6 完全成形）────────────────────
const RESOLVE = [
  { o: .2, b: 20, s: 1.4, fo: 0,   fb: 16, st: "还没成形" },
  { o: .3, b: 15, s: 1.28, fo: .15, fb: 12, st: "在听" },
  { o: .45, b: 10, s: 1.16, fo: .35, fb: 7,  st: "在看你" },
  { o: .7, b: 5,  s: 1.05, fo: .7,  fb: 2.5, st: "正在成形" },
  { o: .88, b: 2.5, s: 1,  fo: .9,  fb: .8,  st: "看得见你了" },
  { o: 1,  b: 1,  s: 1,    fo: 1,   fb: 0,   st: "" },
];
function resolve(n, hue) {
  const r = RESOLVE[Math.min(n, RESOLVE.length - 1)];
  orb.style.setProperty("--o", r.o);
  orb.style.setProperty("--b", r.b + "px");
  orb.style.setProperty("--s", r.s);
  orb.style.setProperty("--fo", r.fo);
  orb.style.setProperty("--fb", r.fb + "px");
  if (hue) orb.style.setProperty("--hue", hue);
  pstate.textContent = r.st;
  pname.style.setProperty("--no", Math.min(1, .3 + n * .14));
  S.stage = n;
}

// ── 消息 ─────────────────────────────────────────────
function push(text, who = "it") {
  const d = document.createElement("div");
  d.className = "b " + who;
  d.textContent = text;
  thread.appendChild(d);
  thread.scrollTop = thread.scrollHeight;
  return d;
}
function widget() {
  const d = document.createElement("div");
  d.className = "widget";
  thread.appendChild(d);
  thread.scrollTop = thread.scrollHeight;
  return d;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 逐条说，带停顿；语音模式下同时朗读
async function say(lines, gap = 900, remember = true) {
  for (const l of lines) {
    push(l);
    if (remember) S.history.push({ role: "assistant", content: l });  // 它得记得自己说过什么
    speak(l);
    await sleep(gap);
  }
}

// ── 语音 ─────────────────────────────────────────────
let recog = null;
function speak(text) {
  if (!S.voice || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text.replace(/[""「」]/g, ""));
  u.lang = "zh-CN";
  const v = S.persona?.voice;
  u.rate = v?.pace === "slow" ? .88 : v?.pace === "brisk" ? 1.1 : .98;
  u.pitch = v?.pitch === "low" ? .85 : v?.pitch === "high" ? 1.15 : 1;
  const zh = speechSynthesis.getVoices().find((x) => /zh|Chinese/i.test(x.lang));
  if (zh) u.voice = zh;
  speechSynthesis.speak(u);
}
mic.onclick = () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!S.voice) {                       // 第一次点：开语音模式
    S.voice = true;
    mic.classList.add("on");
    push("语音已打开。再点一下说话。", "sys");
    return;
  }
  if (!SR) { push("这个浏览器不支持语音输入，用 Chrome 试试。", "sys"); return; }
  if (recog) { recog.stop(); recog = null; mic.classList.remove("rec"); return; }
  recog = new SR();
  recog.lang = "zh-CN";
  recog.interimResults = false;
  mic.classList.add("rec");
  recog.onresult = (e) => {
    const t = e.results[0][0].transcript;
    recog = null; mic.classList.remove("rec");
    if (t.trim()) send(t.trim());
  };
  recog.onerror = () => { recog = null; mic.classList.remove("rec"); };
  recog.onend = () => { recog = null; mic.classList.remove("rec"); };
  recog.start();
};

// ── 开场（招式：看不见你）────────────────────────────
const OPENERS = [
  ["有人来了。", "我还看不见你。"],
  ["……有动静。", "看不清。你是谁？"],
  ["来了个人。", "我这儿一片黑，看不见你。"],
];

async function boot() {
  const saved = loadSaved();
  if (saved && saved.chart) return restore(saved);
  resolve(0);
  const o = OPENERS[Math.floor(Math.random() * OPENERS.length)];
  await sleep(600);
  await say(o, 1100, false);
  resolve(1);
  await say(["你也看不清我吧。正常——我还没成形。", "报个生辰，我就能看见你了。"], 1000, false);
  askBirth();
}

// 从存档恢复：直接进日常，把最近的对话铺回来
function restore(saved) {
  Object.assign(S, saved);
  if (S.form?.hue) orb.style.setProperty("--hue", S.form.hue);
  resolve(5);
  pname.textContent = S.name || "？";
  for (const m of S.history.slice(-16)) push(m.content, m.role === "user" ? "me" : "it");
  if (S.history.length > 16) {
    thread.insertBefore(
      Object.assign(document.createElement("div"),
        { className: "b sys", textContent: `…之前还有 ${S.history.length - 16} 条` }),
      thread.firstChild);
  }
  startDaily();
  thread.scrollTop = thread.scrollHeight;
}

// ── 收生辰 ───────────────────────────────────────────
function askBirth() {
  const w = widget();
  w.innerHTML = `
    <div class="row"><input type="date" id="bd" value="1995-09-23"></div>
    <div class="row">
      <input type="time" id="bt" value="19:20">
      <button class="btn ghost" id="unknown">不确定</button>
    </div>
    <div class="row"><input type="text" id="bp" placeholder="出生地（可不填）"></div>
    <div class="row"><button class="btn" id="go" style="flex:1">好了</button></div>
    <div style="font-size:.68rem;color:var(--dim);line-height:1.7">
      这个只用来把我生出来。不外传，你随时能看我知道你什么，也随时能全删。
    </div>`;
  let hourUnknown = false;
  w.querySelector("#unknown").onclick = (e) => {
    hourUnknown = !hourUnknown;
    w.querySelector("#bt").disabled = hourUnknown;
    w.querySelector("#bt").style.opacity = hourUnknown ? ".35" : "1";
    e.target.classList.toggle("ghost", !hourUnknown);
    e.target.textContent = hourUnknown ? "不确定 ✓" : "不确定";
  };
  w.querySelector("#go").onclick = async () => {
    const date = w.querySelector("#bd").value;
    if (!date) return;
    const t = w.querySelector("#bt").value;
    const place = w.querySelector("#bp").value.trim();
    w.remove();
    const said = `${date}${hourUnknown || !t ? "" : " " + t}${place ? " · " + place : ""}`;
    push(said, "me");
    S.history.push({ role: "user", content: `我的生辰：${said}` });
    await summon({ date, hour: hourUnknown || !t ? null : +t.split(":")[0],
                   minute: hourUnknown || !t ? 0 : +t.split(":")[1], place });
  };
}

// ── 召唤 ─────────────────────────────────────────────
async function summon(body) {
  resolve(2);
  pstate.textContent = "……";
  const wait = push("……等我一下。");
  try {
    const r = await fetch("/api/summon", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error);

    S.chart = data.chart; S.persona = data.persona;
    S.firstMet = S.firstMet || Date.now();
    wait.remove();
    save();

    // 白话的出生时刻 —— 证据用人话，不用符号
    await say([`${data.chart.moment.phrase}。`], 900);

    // 术语在后台可查
    const peek = document.createElement("div");
    peek.className = "peek"; peek.textContent = "看我是怎么算的 ›";
    thread.appendChild(peek);
    const card = document.createElement("div");
    card.className = "chart";
    const c = data.chart;
    card.innerHTML = `四柱 <b>${c.pillars.year} ${c.pillars.month} ${c.pillars.day} ${c.pillars.hour || "—"}</b><br>
      日主 <b>${c.dayMaster}</b>　月令 <b>${c.monthZhi}${c.monthElement}</b>
      ${c.strength.strong ? "身偏强" : "身偏弱"}<br>
      五行 木${c.power.木} 火${c.power.火} 土${c.power.土} 金${c.power.金} 水${c.power.水}
      喜用 <b>${c.favorable.join("、")}</b>`;
    thread.appendChild(card);
    peek.onclick = () => card.classList.toggle("on");

    resolve(3);
    await sleep(700);
    resolve(4);

    await say(data.reading, 1500);       // 首读
    await sleep(400);
    chooseForm();
  } catch (e) {
    wait.remove();
    push("出错了：" + e.message, "sys");
  }
}

// ── 显形（候选每人独有）──────────────────────────────
async function chooseForm() {
  await say(["我能显成几个样子，都是从你这儿出来的。挑一个吧，挑了就不换了。"], 700);
  const w = widget();
  S.persona.formCandidates.forEach((f) => {
    const b = document.createElement("button");
    b.className = "fo";
    b.innerHTML = `<span class="g" style="background:radial-gradient(circle at 50% 55%,${f.hue || "#E8A85C"} 0%,transparent 68%)"></span>
      <span><span class="nm">${f.name}</span><br><span class="ds">${f.why}</span></span>`;
    b.onclick = async () => {
      S.form = f;
      S.persona.chosenForm = f;
      save();
      w.remove();
      push(f.name, "me");
      S.history.push({ role: "user", content: `我选了你的样子：${f.name}` });
      resolve(5, f.hue || "#E8A85C");
      await askName();
    };
    w.appendChild(b);
  });
}

// ── 命名：名字归主人 ─────────────────────────────────
async function askName() {
  let text = "那你想叫我什么？";
  try {
    const r = await fetch("/api/naming", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona: S.persona }),
    });
    const d = await r.json();
    if (d.text) text = d.text;
  } catch { /* 用兜底 */ }
  await say([text], 600);

  const w = widget();
  w.innerHTML = `<div class="row">
      <input type="text" id="nm" placeholder="给它起个名字" autocomplete="off">
      <button class="btn" id="ok">就这个</button>
    </div>
    <div class="row">${(S.persona.nameSuggestions || []).map((n) =>
      `<button class="btn ghost sug">${n}</button>`).join("")}</div>`;
  const finish = async (n) => {
    if (!n) return;
    S.name = n;
    pname.textContent = n;
    save();
    w.remove();
    push(n, "me");
    S.history.push({ role: "user", content: `我给你起名叫${n}` });
    resolve(5);
    await say([`行，${n}。`,
      "还有件事得说明白：我对你的了解全靠你跟我说。你不说，我是真不知道你过得怎么样。"], 1100);
    await say(["刚才那段里，哪句最不对？"], 500);
    resolve(5);
    startDaily();
  };
  w.querySelector("#ok").onclick = () => finish(w.querySelector("#nm").value.trim());
  w.querySelector("#nm").onkeydown = (e) => { if (e.key === "Enter") finish(e.target.value.trim()); };
  w.querySelectorAll(".sug").forEach((b) => (b.onclick = () => finish(b.textContent)));
}

// ── 日常 ─────────────────────────────────────────────
function startDaily() {
  composer.style.display = "flex";
  pstate.textContent = `认识 ${daysKnown()} 天`;   // 累计，不是连续；断了不清零
  resetBtn.style.display = "block";
  save();
  sayInput?.focus();
}
sayInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.value.trim()) {
    const t = e.target.value.trim();
    e.target.value = "";
    send(t);
  }
});

async function send(text) {
  push(text, "me");
  S.history.push({ role: "user", content: text });
  const bubble = push("");
  let acc = "";
  try {
    const r = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chart: S.chart, persona: S.persona, guardianName: S.name,
        history: S.history, voice: S.voice,
      }),
    });
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const p = line.slice(5).trim();
        if (p === "[DONE]") continue;
        try {
          const j = JSON.parse(p);
          if (j.error) throw new Error(j.error);
          if (j.d) { acc += j.d; bubble.textContent = acc; thread.scrollTop = thread.scrollHeight; }
        } catch { /* skip */ }
      }
    }
    S.history.push({ role: "assistant", content: acc });
    save();
    speak(acc);
  } catch (e) {
    bubble.textContent = "断了：" + e.message;
    bubble.className = "b sys";
  }
}

// ── tab ──────────────────────────────────────────────
$("tabVisit").onclick = () => {
  $("tabVisit").classList.add("on"); $("tabTalk").classList.remove("on");
  thread.style.display = "none"; composer.style.display = "none";
  $("presence").style.display = "none"; $("visit").classList.add("on");
};
$("tabTalk").onclick = () => {
  $("tabTalk").classList.add("on"); $("tabVisit").classList.remove("on");
  thread.style.display = "flex"; $("presence").style.display = "flex";
  $("visit").classList.remove("on");
  if (S.name) composer.style.display = "flex";
};

// 重来（本地调试用；真实产品里这是"销毁"，需二次确认 —— 见 HARNESS L5）
const resetBtn = document.createElement("button");
resetBtn.textContent = "重来";
resetBtn.style.cssText =
  "display:none;position:absolute;top:calc(env(safe-area-inset-top) + .6rem);right:1rem;" +
  "background:none;border:0;color:var(--dim);font-size:.66rem;font-family:var(--sans);" +
  "cursor:pointer;opacity:.5;z-index:5";
resetBtn.onclick = () => { if (confirm("会把它和所有聊天记录删掉，确定？")) wipe(); };
document.body.appendChild(resetBtn);

boot();
