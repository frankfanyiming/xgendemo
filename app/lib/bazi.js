// 排盘：八字四柱 + 五行分布 + 身强弱 + 喜用神
// 依赖 lunar-javascript（含节气边界，年柱按立春、月柱按节气切换）
import { Solar } from "lunar-javascript";

const WUXING = { 木: "木", 火: "火", 土: "土", 金: "金", 水: "水" };

// 天干五行
const GAN_WX = {
  甲: "木", 乙: "木", 丙: "火", 丁: "火", 戊: "土",
  己: "土", 庚: "金", 辛: "金", 壬: "水", 癸: "水",
};
// 地支五行（本气）
const ZHI_WX = {
  子: "水", 丑: "土", 寅: "木", 卯: "木", 辰: "土", 巳: "火",
  午: "火", 未: "土", 申: "金", 酉: "金", 戌: "土", 亥: "水",
};
// 地支藏干（含权重，本气 1.0 / 中气 0.4 / 余气 0.2）
const ZHI_CANG = {
  子: [["癸", 1]], 丑: [["己", 1], ["癸", 0.4], ["辛", 0.2]],
  寅: [["甲", 1], ["丙", 0.4], ["戊", 0.2]], 卯: [["乙", 1]],
  辰: [["戊", 1], ["乙", 0.4], ["癸", 0.2]], 巳: [["丙", 1], ["庚", 0.4], ["戊", 0.2]],
  午: [["丁", 1], ["己", 0.4]], 未: [["己", 1], ["丁", 0.4], ["乙", 0.2]],
  申: [["庚", 1], ["壬", 0.4], ["戊", 0.2]], 酉: [["辛", 1]],
  戌: [["戊", 1], ["辛", 0.4], ["丁", 0.2]], 亥: [["壬", 1], ["甲", 0.4]],
};

// 五行生克
const SHENG = { 木: "火", 火: "土", 土: "金", 金: "水", 水: "木" }; // 我生
const KE = { 木: "土", 土: "水", 水: "火", 火: "金", 金: "木" };     // 我克
const beSheng = (x) => Object.keys(SHENG).find((k) => SHENG[k] === x);  // 生我
const beKe = (x) => Object.keys(KE).find((k) => KE[k] === x);           // 克我

// 时辰不确定时的默认（正午，仅用日柱主导，时柱不参与判断）
const DEFAULT_HOUR = 12;

/**
 * @param {{date:string, hour?:number|null, minute?:number|null, place?:string}} input
 *        date: "1995-09-23"，hour/minute 为 null 表示不确定时辰
 */
export function castChart(input) {
  const [y, m, d] = input.date.split("-").map(Number);
  const hourKnown = input.hour !== null && input.hour !== undefined;
  const hh = hourKnown ? input.hour : DEFAULT_HOUR;
  const mm = hourKnown ? (input.minute ?? 0) : 0;

  const solar = Solar.fromYmdHms(y, m, d, hh, mm, 0);
  const lunar = solar.getLunar();
  const ec = lunar.getEightChar();

  const pillars = {
    year: ec.getYear(),
    month: ec.getMonth(),
    day: ec.getDay(),
    hour: hourKnown ? ec.getTime() : null,
  };

  const dayGan = ec.getDayGan();          // 日主天干
  const dayWx = GAN_WX[dayGan];           // 日主五行
  const monthZhi = ec.getMonthZhi();      // 月令

  // ── 五行力量分布（天干各 1，地支按藏干权重）────────────
  const power = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
  const visible = [pillars.year, pillars.month, pillars.day, pillars.hour].filter(Boolean);
  for (const gz of visible) {
    const [gan, zhi] = [gz[0], gz[1]];
    power[GAN_WX[gan]] += 1;
    for (const [cg, w] of ZHI_CANG[zhi]) power[GAN_WX[cg]] += w;
  }

  // ── 身强弱：帮身（生我 + 同我） vs 耗身（我生 + 我克 + 克我）──
  const support = power[beSheng(dayWx)] + power[dayWx];
  const drain = power[SHENG[dayWx]] + power[KE[dayWx]] + power[beKe(dayWx)];
  const ratio = support / (support + drain);
  const strong = ratio >= 0.5;

  // 喜用：身弱补印比，身强用食伤财官
  const favorable = strong
    ? [SHENG[dayWx], KE[dayWx]]            // 泄、耗
    : [beSheng(dayWx), dayWx];             // 生、帮
  const unfavorable = strong
    ? [beSheng(dayWx), dayWx]
    : [SHENG[dayWx], KE[dayWx]];

  // ── 生辰那一刻的白话描述（首读用，替代术语卡片）────────
  const moment = describeMoment(y, m, d, hourKnown ? hh : null, lunar);

  return {
    input: { ...input, hourKnown },
    pillars,
    dayGan,
    dayMaster: `${dayGan}${dayWx}`,        // 如 "丁火"
    dayMasterElement: dayWx,
    monthZhi,
    monthElement: ZHI_WX[monthZhi],
    power: round1(power),
    strength: { support: round(support), drain: round(drain), strong, ratio: round(ratio) },
    favorable,
    unfavorable,
    lunarDate: `${lunar.getYearInChinese()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
    zodiac: lunar.getYearShengXiao(),
    constellation: solar.getXingZuo(),
    moment,
  };
}

// 把出生那一刻说成人话——首读开场用，不出现任何术语
function describeMoment(y, m, d, hour, lunar) {
  const jieQi = lunar.getPrevJieQi(true)?.getName?.() || "";
  let season;
  if (m === 12 || m <= 2) season = "冬天";
  else if (m <= 5) season = "春天";
  else if (m <= 8) season = "夏天";
  else season = "秋天";

  const tenth = d <= 10 ? "初" : d <= 20 ? "中旬" : "末";
  let timeOfDay = null;
  if (hour !== null) {
    if (hour < 5) timeOfDay = "天还没亮的时候";
    else if (hour < 8) timeOfDay = "天刚亮的时候";
    else if (hour < 11) timeOfDay = "上午";
    else if (hour < 14) timeOfDay = "日头最高的时候";
    else if (hour < 17) timeOfDay = "下午";
    else if (hour < 19) timeOfDay = "太阳快落的时候";
    else if (hour < 21) timeOfDay = "天刚黑透的时候";
    else timeOfDay = "夜里";
  }

  return {
    season,
    phrase: timeOfDay
      ? `${m}月${tenth}，${timeOfDay}`
      : `${m}月${tenth}，${season}`,
    jieQi,
  };
}

const round = (n) => Math.round(n * 100) / 100;
const round1 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)]));
