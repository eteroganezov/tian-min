const { hasBrokenPlaceholder } = require("./report-schema.cjs");

const EVIDENCE_CATALOG_VERSION = "evidence-catalog-v2";
const DIZHI = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];
const PILLARS = { year: "года", month: "месяца", day: "дня", hour: "часа", 年: "года", 月: "месяца", 日: "дня", 时: "часа" };
const PALACE_IDS = { 命宫:"life", 命:"life", 兄弟宫:"siblings", 兄弟:"siblings", 夫妻宫:"partnership", 夫妻:"partnership", 子女宫:"children", 子女:"children", 财帛宫:"finance", 财帛:"finance", 疾厄宫:"health", 疾厄:"health", 迁移宫:"travel", 迁移:"travel", 交友宫:"friends", 交友:"friends", 官禄宫:"career", 官禄:"career", 田宅宫:"property", 田宅:"property", 福德宫:"wellbeing", 福德:"wellbeing", 父母宫:"parents", 父母:"parents" };
const RELATIONS = {
  天干合: "соединение небесных стволов", 天干相克: "взаимодействие небесных стволов", 天干同: "повтор небесных стволов",
  六冲: "столкновение земных ветвей", 六合: "сочетание земных ветвей", 六害: "вред земных ветвей", 相刑: "наказание земных ветвей",
  自刑: "самонаказание земной ветви", 三合: "тройное сочетание земных ветвей", 三会: "сезонное объединение земных ветвей",
  暗合: "скрытое сочетание земных ветвей", 拱合: "неполное сочетание земных ветвей", 拱会: "неполное сезонное объединение",
};
const SIGNS = { 甲:"Цзя (甲)",乙:"И (乙)",丙:"Бин (丙)",丁:"Дин (丁)",戊:"У (戊)",己:"Цзи (己)",庚:"Гэн (庚)",辛:"Синь (辛)",壬:"Жэнь (壬)",癸:"Гуй (癸)",子:"Цзы (子)",丑:"Чоу (丑)",寅:"Инь (寅)",卯:"Мао (卯)",辰:"Чэнь (辰)",巳:"Сы (巳)",午:"У (午)",未:"Вэй (未)",申:"Шэнь (申)",酉:"Ю (酉)",戌:"Сюй (戌)",亥:"Хай (亥)" };
const ELEMENTS = { 木:"Дерево", 火:"Огонь", 土:"Земля", 金:"Металл", 水:"Вода" };
const SENSITIVITY_FLAGS = { ChangedYearPillar:"столп года", ChangedMonthPillar:"столп месяца", ChangedDayPillar:"столп дня", ChangedHourPillar:"столп часа", ChangedZiWeiDate:"дата Цзы Вэй", ChangedZiWeiHour:"час Цзы Вэй" };

function localizeReportText(value) {
  return String(value).replace(/Zi\s*Wei\s*Dou\s*Shu/gi,"Цзы Вэй Доу Шу").replace(/Zi\s*Wei|ZiWei/gi,"Цзы Вэй").replace(/BaZi|Bazi/gi,"Ба-цзы").replace(/\bsensitivity\b/gi,"чувствительность расчёта");
}
function russianTypography(value) { return String(value).replace(/(^|[\s(«„])((?:а|в|и|к|о|с|у|но|на|по|из|за|от|до|для|при))\s+(?=\S)/giu, (_match,before,word)=>`${before}${word}\u00a0`); }
function cleanFact(value) {
  if (value === undefined || value === null) return null;
  const text = russianTypography(localizeReportText(value).replace(/\s+/g," ").trim());
  return !text || hasBrokenPlaceholder(text) ? null : text;
}

function buildEvidenceCatalog(calculation, chartView = {}, options = {}) {
  const items = [];
  const seen = new Set();
  const add = (id, system, category, label, fact, data) => {
    const cleanText = cleanFact(fact);
    if (!cleanText || seen.has(id)) return;
    seen.add(id);
    items.push({ id, system, category, label: cleanFact(label), fact: cleanText, data: clone(data) });
  };
  addBaziEvidence(add, calculation.chart?.bazi || {}, chartView.bazi || {}, options.reportYears || []);
  addZiweiEvidence(add, calculation.chart?.ziwei || {}, chartView.ziwei || {});
  addTimeEvidence(add, calculation.metadata || {});
  return { version: EVIDENCE_CATALOG_VERSION, items };
}

function addBaziEvidence(add, bazi, view, reportYears) {
  add("bazi.day_master","bazi","identity","Дневной хозяин",`Дневной хозяин Ба-цзы — ${sign(bazi.dayMaster)}.`,{ dayMaster:bazi.dayMaster });
  const keys = ["year","month","day","hour"];
  for (const key of keys) {
    const pillar = bazi.siZhu?.[key];
    if (!pillar) continue;
    add(`bazi.pillar.${key}`,"bazi","pillar",`Столп ${PILLARS[key]}`,`Столп ${PILLARS[key]} — ${pillar.gan}${pillar.zhi}; десять божеств — ${bazi.shiShen?.[key] || "не указано"}.`,{ pillar, tenGod:bazi.shiShen?.[key], zhangSheng:bazi.zhangSheng?.[key], naYin:bazi.naYin?.[key] });
    const hidden = bazi.cangGan?.[key] || [];
    if (hidden.length) add(`bazi.hidden_stems.${key}`,"bazi","hidden_stems",`Скрытые стволы столпа ${PILLARS[key]}`,`Скрытые стволы столпа ${PILLARS[key]}: ${hidden.map(item=>`${sign(item.gan)} — ${item.shiShen}`).join("; ")}.`,hidden);
  }
  add("bazi.ten_gods","bazi","ten_gods","Десять божеств по столпам",`Десять божеств: ${keys.map(key=>`${PILLARS[key]} — ${bazi.shiShen?.[key]}`).join("; ")}.`,bazi.shiShen);
  const groups = bazi.enrichment?.五行统计?.shiShenGroups;
  if (groups) add("bazi.ten_god_groups","bazi","ten_gods","Группы десяти божеств",`Группы десяти божеств по элементам: ${Object.entries(groups).map(([element,value])=>`${elementName(element)} — ${value.十神类}, ${value.实例数}`).join("; ")}.`,groups);
  const stats = bazi.enrichment?.五行统计;
  if (stats?.surface) add("bazi.elements.surface","bazi","elements","Пять элементов на поверхности",`Пять элементов без скрытых стволов: ${elementValues(stats.surface)}.`,stats.surface);
  if (stats?.withCangGan) add("bazi.elements.weighted","bazi","elements","Пять элементов со скрытыми стволами",`Пять элементов с учётом скрытых стволов: ${elementValues(stats.withCangGan)}.`,stats.withCangGan);
  if (stats) add("bazi.elements.balance","bazi","elements","Особенности баланса элементов",`Наиболее выражены: ${(stats.strongest||[]).map(elementName).join(", ") || "нет отдельного максимума"}; отсутствуют на поверхности: ${(stats.missing||[]).map(elementName).join(", ") || "нет"}.`,{ strongest:stats.strongest||[], missing:stats.missing||[] });
  const seasonal = bazi.enrichment?.五行旺相;
  if (seasonal) add("bazi.elements.seasonal","bazi","elements","Сезонное состояние элементов",`Сезонное состояние элементов: ${Object.entries(seasonal).map(([element,state])=>`${elementName(element)} — ${state}`).join("; ")}.`,seasonal);
  const structure = bazi.enrichment?.格局;
  if (structure?.primary) add("bazi.structure","bazi","structure","Структура карты",`Структура Ба-цзы — ${view.structureDisplay?.name || structure.primary}; основание: ${structure.basis}; уверенность расчёта — ${structure.confidence}.`,structure);
  const strength = bazi.enrichment?.旺衰;
  if (strength?.verdict) {
    add("bazi.strength","bazi","strength","Баланс Дневного хозяина",`Баланс Дневного хозяина — ${view.strength?.display?.name || strength.verdict}; score ${strength.score}; уверенность расчёта — ${strength.confidence}.`,{ verdict:strength.verdict, score:strength.score, confidence:strength.confidence });
    add("bazi.strength.breakdown","bazi","strength","Основания оценки баланса",`Состав оценки баланса: ${Object.entries(strength.breakdown || {}).filter(([key])=>key!=="details").map(([key,value])=>`${key} ${value}`).join("; ")}.`,strength.breakdown);
  }
  const regulating = bazi.enrichment?.调候用神 || [];
  if (regulating.length) add("bazi.regulating","bazi","regulating","Регулирующие стволы",`Расчётные регулирующие стволы: ${regulating.map(sign).join(", ")}.`,regulating);
  addRelations(add,"stem",bazi.enrichment?.天干关系 || []);
  addRelations(add,"branch",bazi.enrichment?.地支关系 || []);
  for (const item of bazi.enrichment?.整柱 || []) add(`bazi.pillar_relation.${pillarKey(item.pillar)}`,"bazi","pillar_relation",`Связь внутри столпа ${PILLARS[item.pillar]}`,`Столп ${PILLARS[item.pillar]} ${item.gan}${item.zhi}: ${item.verdict}.`,item);
  (bazi.dayun || []).forEach((period,index)=>add(`bazi.luck_period.${String(index+1).padStart(2,"0")}`,"bazi","luck_period",`Большой период ${index+1}`,`Период ${period.startAge}–${period.endAge} лет (${period.startYear}–${period.endYear}): ${period.ganZhi.gan}${period.ganZhi.zhi}, ${period.ganShiShen} / ${period.zhiShiShen}.`,period));
  const annual = (bazi.dayun || []).flatMap(period=>period.liuNian || []);
  for (const year of reportYears) {
    const item = annual.find(value=>value.year===year);
    if (item) add(`bazi.annual.${year}`,"bazi","annual",`Годовой GanZhi ${year}`,`Для ${year} года рассчитан GanZhi ${item.ganZhi.gan}${item.ganZhi.zhi}; возраст по расчётной шкале — ${item.age}.`,item);
  }
}

function addRelations(add, kind, relations) {
  relations.forEach((item,index)=>{
    const values = item.gans || item.zhi || [];
    const label = RELATIONS[item.type] || item.type;
    const pillars = (item.pillars || []).map(value=>PILLARS[value]).filter(Boolean);
    add(`bazi.relation.${kind}.${String(index+1).padStart(2,"0")}`,"bazi","relation",label,`Ба-цзы: ${label} ${values.map(sign).join(" и ")}${pillars.length?` между столпами ${pillars.join(" и ")}`:""}${item.detail?`; деталь расчёта: ${item.detail}`:""}.`,item);
  });
}

function addZiweiEvidence(add, ziwei, view) {
  const life = ziwei.gongs?.find(gong=>gong.gong === "命宫" || gong.gong === "命") || ziwei.gongs?.[0];
  const bodyBranch = DIZHI[ziwei.shenGongIndex];
  const body = ziwei.gongs?.find(gong=>gong.dizhi === bodyBranch);
  if (life) add("ziwei.life_palace","ziwei","identity","Дворец судьбы",`Дворец судьбы Цзы Вэй — ${life.gong} в ветви ${sign(life.dizhi)}, ствол ${sign(life.tiangan)}.`,palaceData(life));
  if (body) add("ziwei.body_palace","ziwei","identity","Дворец тела",`Дворец тела Цзы Вэй расположен в дворце ${body.gong}, ветвь ${sign(body.dizhi)}.`,palaceData(body));
  if (ziwei.wuXingJu) add("ziwei.five_element_bureau","ziwei","identity","Система пяти элементов",`Система пяти элементов Цзы Вэй — ${view.fiveElementBureauDisplay?.name || ziwei.wuXingJu.name}, число ${ziwei.wuXingJu.number}.`,ziwei.wuXingJu);
  (ziwei.gongs || []).forEach((gong,index)=>{
    const key = PALACE_IDS[gong.gong] || `index-${index+1}`;
    const main = gong.mainStars?.length ? gong.mainStars.join(", ") : "без главной звезды";
    const aux = gong.auxStars?.length ? gong.auxStars.join(", ") : "без вспомогательных звёзд";
    const hua = gong.sihua?.length ? gong.sihua.map(item=>`${item.star}${item.hua}`).join(", ") : "без четырёх трансформаций";
    add(`ziwei.palace.${key}`,"ziwei","palace",`Дворец ${gong.gong}`,`Дворец ${gong.gong}: ${gong.tiangan}${gong.dizhi}; главные звёзды — ${main}; вспомогательные — ${aux}; трансформации — ${hua}.`,palaceData(gong));
    if (gong.daXian) add(`ziwei.age_period.${String(index+1).padStart(2,"0")}`,"ziwei","age_period",`Возрастной период дворца ${gong.gong}`,`Дворец ${gong.gong} соответствует периоду ${gong.daXian.startAge}–${gong.daXian.endAge} лет${gong.daXian.isCurrent?"; это текущий возрастной дворец":""}.`,gong.daXian);
    (gong.sihua || []).forEach((item,huaIndex)=>add(`ziwei.transformation.${String(index+1).padStart(2,"0")}.${String(huaIndex+1).padStart(2,"0")}`,"ziwei","transformation",`${item.star}${item.hua}`,`В дворце ${gong.gong} звезда ${item.star} имеет трансформацию ${item.hua}.`,{ palace:gong.gong, ...item }));
  });
  const current = (ziwei.gongs || []).find(gong=>gong.daXian?.isCurrent);
  if (current) add("ziwei.current_palace","ziwei","current_period","Текущий возрастной дворец",`Текущий возрастной дворец — ${current.gong}, период ${current.daXian.startAge}–${current.daXian.endAge} лет.`,palaceData(current));
  for (const gong of ziwei.gongs || []) {
    const year = gong.liuNianYear;
    if (Number.isInteger(year)) add(`ziwei.annual.${year}`,"ziwei","annual_mapping",`Доступное годовое сопоставление ${year}`,`В расчётных данных ${year} год сопоставлен с дворцом ${gong.gong}; это mapping, а не событийный прогноз.`,{ year, palace:gong.gong, stem:gong.tiangan, branch:gong.dizhi });
  }
}

function addTimeEvidence(add, metadata) {
  add("time.civil","time","birth_time","Исходное гражданское время",`Исходные дата и местное время рождения: ${metadata.originalBirthDate} ${metadata.originalBirthTime}.`,{ date:metadata.originalBirthDate, time:metadata.originalBirthTime });
  add("time.timezone","time","timezone","Часовой пояс",`Часовой пояс места рождения — ${metadata.ianaTimeZone}; историческое смещение UTC ${metadata.historicalUtcOffset} минут; переход на летнее время ${metadata.dstApplied?"учтён":"не применялся"}.`,{ ianaTimeZone:metadata.ianaTimeZone, historicalUtcOffset:metadata.historicalUtcOffset, standardUtcOffset:metadata.standardUtcOffset, dstApplied:metadata.dstApplied });
  add("time.true_solar","time","true_solar","Истинное солнечное время",`Истинное солнечное время расчёта: ${metadata.trueSolarDate} ${metadata.trueSolarTime}; общая коррекция ${round(metadata.trueSolarCorrectionMinutes)} минут.`,{ date:metadata.trueSolarDate, time:metadata.trueSolarTime, correctionMinutes:metadata.trueSolarCorrectionMinutes, method:metadata.calculationMethod });
  add("time.sensitivity","time","sensitivity","Чувствительность расчёта",`Уровень чувствительности расчёта — ${metadata.calculationSensitivity}.`,{ level:metadata.calculationSensitivity, flags:metadata.sensitivityFlags });
  for (const [flag,changed] of Object.entries(metadata.sensitivityFlags || {})) if (changed) add(`time.sensitivity.${snake(flag)}`,"time","sensitivity",`Изменённый параметр: ${SENSITIVITY_FLAGS[flag] || flag}`,`Поправка времени изменила параметр «${SENSITIVITY_FLAGS[flag] || flag}».`,{ flag, changed:true });
}

function palaceData(gong) { return { palace:gong.gong, stem:gong.tiangan, branch:gong.dizhi, mainStars:gong.mainStars||[], auxiliaryStars:gong.auxStars||[], transformations:gong.sihua||[], agePeriod:gong.daXian||null, annualAges:gong.liuNian||[], annualYear:gong.liuNianYear||null }; }
function pillarKey(value) { return ({ 年:"year",月:"month",日:"day",时:"hour" })[value] || String(value); }
function elementName(value) { return ELEMENTS[value] ? `${ELEMENTS[value]} (${value})` : value; }
function elementValues(value) { return Object.entries(value).map(([element,count])=>`${elementName(element)} — ${count}`).join("; "); }
function sign(value) { return SIGNS[value] || value; }
function snake(value) { return String(value).replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase(); }
function round(value) { return Number.isFinite(Number(value)) ? Math.round(Number(value)*10)/10 : value; }
function clone(value) { return value === undefined ? null : structuredClone(value); }

function sanitizePersonalReport(report) { return sanitizeNode(report); }
function sanitizeNode(value, key = "") {
  if (typeof value === "string") return isReferenceKey(key) ? value.trim() : cleanFact(value) || "";
  if (Array.isArray(value)) return value.map(item=>sanitizeNode(item,key)).filter(item=>typeof item === "string" ? Boolean(item) : item !== null && item !== undefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([childKey,child])=>[childKey,sanitizeNode(child,childKey)]));
}
function isReferenceKey(key) { return key === "evidence" || key.endsWith("Evidence") || key === "sourceInsightIds" || key === "id" || key === "schemaVersion"; }

module.exports = { EVIDENCE_CATALOG_VERSION, buildEvidenceCatalog, cleanFact, localizeReportText, russianTypography, sanitizePersonalReport };
