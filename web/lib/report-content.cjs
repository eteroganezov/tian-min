const { hasBrokenPlaceholder } = require("./report-schema.cjs");

const PILLARS = { 年: "года", 月: "месяца", 日: "дня", 时: "часа" };
const RELATIONS = {
  天干合: "соединение небесных стволов",
  天干相克: "взаимодействие небесных стволов",
  天干同: "повтор небесных стволов",
  六冲: "столкновение земных ветвей",
  六合: "сочетание земных ветвей",
  六害: "вред земных ветвей",
  相刑: "наказание земных ветвей",
  自刑: "самонаказание земной ветви",
  三合: "тройное сочетание земных ветвей",
  三会: "сезонное объединение земных ветвей",
  暗合: "скрытое сочетание земных ветвей",
  拱合: "неполное сочетание земных ветвей",
  拱会: "неполное сезонное объединение земных ветвей",
};
const SIGNS = { 甲: "Цзя (甲)", 乙: "И (乙)", 丙: "Бин (丙)", 丁: "Дин (丁)", 戊: "У (戊)", 己: "Цзи (己)", 庚: "Гэн (庚)", 辛: "Синь (辛)", 壬: "Жэнь (壬)", 癸: "Гуй (癸)", 子: "Цзы (子)", 丑: "Чоу (丑)", 寅: "Инь (寅)", 卯: "Мао (卯)", 辰: "Чэнь (辰)", 巳: "Сы (巳)", 午: "У (午)", 未: "Вэй (未)", 申: "Шэнь (申)", 酉: "Ю (酉)", 戌: "Сюй (戌)", 亥: "Хай (亥)" };

function localizeReportText(value) {
  return String(value)
    .replace(/Zi\s*Wei\s*Dou\s*Shu/gi, "Цзы Вэй Доу Шу")
    .replace(/Zi\s*Wei|ZiWei/gi, "Цзы Вэй")
    .replace(/BaZi|Bazi/gi, "Ба-цзы");
}

function cleanFact(value) {
  if (value === undefined || value === null) return null;
  const text = localizeReportText(value).replace(/\s+/g, " ").trim();
  return !text || hasBrokenPlaceholder(text) ? null : text;
}

function buildEvidenceCatalog(calculation, chartView = {}) {
  const bazi = calculation.chart?.bazi || {};
  const baziView = chartView.bazi || {};
  const ziweiView = chartView.ziwei || {};
  const baziFacts = [
    bazi.dayMaster ? cleanFact(`Ба-цзы: дневной хозяин ${SIGNS[bazi.dayMaster] || bazi.dayMaster}.`) : null,
    baziView.structureDisplay?.name ? cleanFact(`Ба-цзы: ${baziView.structureDisplay.name}.`) : null,
    ...relationFacts(bazi.enrichment?.["天干关系"]),
    ...relationFacts(bazi.enrichment?.["地支关系"]),
  ].filter(Boolean);
  const ziweiFacts = [
    ziweiView.mingPalace ? cleanFact(`Цзы Вэй: дворец судьбы — ${SIGNS[ziweiView.mingPalace] || ziweiView.mingPalace}.`) : null,
    ziweiView.shenPalace ? cleanFact(`Цзы Вэй: дворец тела — ${SIGNS[ziweiView.shenPalace] || ziweiView.shenPalace}.`) : null,
    ziweiView.fiveElementBureauDisplay?.name ? cleanFact(`Цзы Вэй: ${ziweiView.fiveElementBureauDisplay.name}.`) : null,
  ].filter(Boolean);
  return { bazi: unique(baziFacts), ziwei: unique(ziweiFacts) };
}

function relationFacts(items) {
  if (!Array.isArray(items)) return [];
  return items.map(item => {
    const label = RELATIONS[item?.type];
    const signs = cleanValues(item?.gans || item?.zhi).map(value => SIGNS[value] || value);
    const pillars = cleanValues(item?.pillars).map(value => PILLARS[value]).filter(Boolean);
    if (!label || signs.length === 0) return null;
    const signsText = signs.join(" и ");
    const pillarText = pillars.length ? ` между столпами ${pillars.join(" и ")}` : "";
    return cleanFact(`Ба-цзы: ${label} ${signsText}${pillarText}.`);
  }).filter(Boolean);
}

function cleanValues(items) {
  return Array.isArray(items) ? items.map(cleanFact).filter(Boolean) : [];
}

function sanitizePersonalReport(report) {
  return sanitizeNode(report);
}

function sanitizeNode(value, key = "") {
  if (typeof value === "string") return cleanFact(value) || "";
  if (Array.isArray(value)) return value.map(item => sanitizeNode(item, key)).filter(item => {
    if (typeof item === "string") return Boolean(item);
    return item !== null && item !== undefined;
  });
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitizeNode(child, childKey)]));
}

function unique(items) { return [...new Set(items)]; }

module.exports = { buildEvidenceCatalog, cleanFact, localizeReportText, sanitizePersonalReport };
