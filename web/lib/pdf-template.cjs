const fs = require("node:fs");
const PDFDocument = require("pdfkit");

const colors = { ink: "#18231f", muted: "#66736d", jade: "#173f36", sage: "#dfe8e2", sand: "#f4f0e7", gold: "#b5955d", red: "#9c4938", white: "#ffffff" };

function chooseFont(candidates) { return candidates.find(file => fs.existsSync(file)); }

function clean(value) {
  return String(value ?? "").replace(/[–—−‑]/g, "-").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function createReportPdf({ chart, metadata, presentation = {}, report, hasFullReport = true }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 52, bufferPages: true, info: { Title: report ? `${report.archetype} - персональный отчёт` : "Техническая карта Ба-цзы и Цзы Вэй", Author: "Тянь Мин", Subject: "Персональный информационно-развлекательный отчёт" } });
    const chunks = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const regular = chooseFont([process.env.PDF_FONT_REGULAR, "/System/Library/Fonts/Supplemental/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"].filter(Boolean));
    const bold = chooseFont([process.env.PDF_FONT_BOLD, "/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"].filter(Boolean));
    const cjk = chooseFont([process.env.PDF_FONT_CJK, "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"].filter(Boolean));
    let cjkReady = false;
    if (cjk) { try { doc.registerFont("CJK", cjk); cjkReady = true; } catch { cjkReady = false; } }
    if (regular) doc.registerFont("Body", regular); else doc.registerFont("Body", "Helvetica");
    if (bold) doc.registerFont("Bold", bold); else doc.registerFont("Bold", "Helvetica-Bold");
    doc._tianMingBrandFont = cjkReady ? "CJK" : "Bold";
    doc._tianMingCjkReady = cjkReady;

    cover(doc, chart, metadata, presentation, report);
    if (report && hasFullReport) fullReport(doc, report);
    else if (report) previewReport(doc, report);
    else unavailablePage(doc);
    technicalAppendix(doc, chart, metadata, cjkReady);
    disclaimer(doc);
    addPageNumbers(doc);
    doc.end();
  });
}

function cover(doc, chart, metadata, presentation, report) {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(colors.jade);
  doc.fillColor(colors.gold).font(doc._tianMingBrandFont).fontSize(11).text("ТЯНЬ МИН · 天命", 52, 56, { characterSpacing: 1.2 });
  doc.fillColor("#a9bdb5").font("Body").fontSize(10).text("ПЕРСОНАЛЬНАЯ КАРТА ЛИЧНОСТИ И ЖИЗНЕННОГО ПУТИ", 52, 88, { characterSpacing: .7 });
  doc.fillColor(colors.white).font("Bold").fontSize(34).text(cleanNarrative(report?.archetype || "Ваша персональная карта"), 52, 168, { width: 490, lineGap: 8 });
  doc.fillColor("#d9e3dd").font("Body").fontSize(16).text(cleanNarrative(report?.subtitle || "Технический расчёт готов. Персональная AI-интерпретация не была создана."), 52, 270, { width: 460, lineGap: 5 });
  if (report) doc.fillColor(colors.gold).font("Body").fontSize(11).text(cleanNarrative(report.oneLineFormula), 52, 350, { width: 450, lineGap: 4 });
  doc.fillColor("#a9bdb5").font(doc._tianMingBrandFont).fontSize(10).text("Ба-цзы (八字) + Цзы Вэй Доу Шу (紫微斗数)", 52, 450, { width: 450 });
  doc.moveTo(52, 510).lineTo(543, 510).strokeColor("#55736a").stroke();
  const rows = [
    ...(presentation.displayName ? [["Имя", presentation.displayName]] : []),
    ["Дата рождения", metadata.originalBirthDate], ["Местное время", metadata.originalBirthTime],
    ["Место рождения", metadata.birthPlace], ["Метод", metadata.calculationMethod],
  ];
  rows.forEach(([label, value], index) => {
    const y = 535 + index * 38;
    doc.fillColor("#9eb2aa").font("Body").fontSize(9).text(label.toUpperCase(), 52, y);
    const valueSize = label === "Имя" && clean(value).length > 38 ? 9 : 11;
    doc.fillColor(colors.white).font("Bold").fontSize(valueSize).text(clean(value), 190, y, { width: 350, lineBreak: false, ellipsis: true });
  });
  doc.fillColor("#91a69e").font("Body").fontSize(8).text("Информационный и развлекательный материал", 52, 760);
}

function fullReport(doc, report) {
  section(doc, "Краткий портрет", report.executiveSummary);
  section(doc, "Личность и внутренний мотив", report.personality);
  cards(doc, "5 главных черт", report.keyTraits, item => `${item.title}\n${item.explanation}\n\nВ ресурсе: ${item.positive}\nРиск: ${item.shadow}\nОснования: ${item.evidence.join("; ")}`, { continuePage: true });
  cards(doc, "Сильные стороны", report.strengths, item => `${item.title}\n${item.essence}\n\nКак проявляется: ${item.manifestation}\nГде полезно: ${item.usefulWhere}\nПрактика: ${item.practicalUse}`, { continuePage: true });
  cards(doc, "Риски и слабые места", report.challenges, item => `${item.pattern}\nКогда: ${item.trigger}\nВозможное следствие: ${item.consequence}\nЧто помогает: ${item.compensation}`, { continuePage: true });
  splitSection(doc, "Как вас видят / что происходит внутри", [
    ["Снаружи", report.externalVsInternal.external], ["Внутри", report.externalVsInternal.internal], ["Синтез", report.externalVsInternal.synthesis],
  ]);
  splitSection(doc, "Стресс и решения", Object.entries(report.stressPattern).map(([key, value]) => [labelFor(key), value]));
  section(doc, "Карьера и профессиональный рост", report.career);
  section(doc, "Деньги и финансовое поведение", report.money);
  section(doc, "Отношения и близость", report.relationships);
  splitSection(doc, "Люди и окружение", Object.entries(report.environment).map(([key, value]) => [labelFor(key), value]));
  splitSection(doc, "Лидерство и конфликты", Object.entries(report.leadership).map(([key, value]) => [labelFor(key), value]));
  splitSection(doc, "Образ жизни и ресурс", Object.entries(report.lifestyle).map(([key, value]) => [labelFor(key), value]));
  splitSection(doc, "Текущий большой период", Object.entries(report.currentPeriod).map(([key, value]) => [labelFor(key), value]));
  cards(doc, "Ближайшие 3 года", report.yearlyOutlook, item => `${item.year} - ${item.theme}\nВозможности: ${item.opportunities}\nРиски: ${item.risks}\nФокус: ${item.focus}\nНе форсировать: ${item.avoid}`);
  cards(doc, "Ключевые переходы жизни", report.keyLifeTransitions, item => `${item.age} / ${item.period}\n${item.theme}\nЧто меняется: ${item.change}`, { continuePage: true });
  cards(doc, "Три сценария", report.scenarios, item => `${item.type}: ${item.title}\n${item.description}\nРешения: ${item.decisions}`);
  matrix(doc, report.lifeAreaMatrix);
  splitSection(doc, "Сопоставление Ба-цзы и Цзы Вэй", [
    ["Где согласны", report.crossValidation.agreements.join("\n• ")],
    ["Где расходятся", report.crossValidation.divergences.join("\n• ")],
    ["Устойчивые выводы", report.crossValidation.stableConclusions.join("\n• ")],
    ["Более слабые выводы", report.crossValidation.weakerConclusions.join("\n• ")],
  ]);
  cards(doc, "Уверенность выводов", report.confidence, item => `${item.conclusion}\nУровень: ${item.level}\n${item.reason}`);
  splitSection(doc, "План действий", [
    ["Делать чаще", report.actionPlan.doMore.join("\n• ")], ["Избегать", report.actionPlan.avoid.join("\n• ")],
    ["Фокус на 12 месяцев", report.actionPlan.next12Months.join("\n• ")], ["Вопросы себе", report.actionPlan.questions.join("\n• ")],
  ]);
  cards(doc, "Самопроверка", report.selfCheck, (item, index) => `${index + 1}. ${item}`);
  section(doc, "Итог", report.finalSummary);
}

function previewReport(doc, report) {
  section(doc, "Короткий портрет", report.executiveSummary);
  cards(doc, "Три сильные стороны", report.strengths.slice(0, 3), item => `${item.title}\n${item.essence}`);
  cards(doc, "Главная зона внимания", report.challenges.slice(0, 1), item => `${item.pattern}\n${item.compensation}`);
  section(doc, "Полная версия", "Расширенные разделы отчёта не входят в текущий доступ. Техническая карта приведена ниже.");
}

function unavailablePage(doc) {
  section(doc, "Персональная интерпретация", "Персональная AI-интерпретация не была создана. Ниже сохранён полный технический расчёт Ба-цзы и Цзы Вэй.");
}

function technicalAppendix(doc, chart, metadata, hasCjk) {
  page(doc, "Техническое приложение", "Рассчитанные данные не изменялись AI-интерпретацией.");
  subheading(doc, "Ба-цзы (八字) - четыре столпа");
  chart.bazi.pillars.forEach(pillar => technicalRow(doc, pillar.label, `${pillar.gan}${pillar.zhi} / ${pillar.shiShenDisplay.name} (${pillar.shiShenDisplay.original})`, hasCjk));
  technicalRow(doc, "Дневной хозяин - центральный элемент личности", chart.bazi.dayMaster, hasCjk);
  technicalRow(doc, "Структура - ведущий тип взаимодействия", `${chart.bazi.structureDisplay.name} (${chart.bazi.structure})`, hasCjk);
  technicalRow(doc, "Сила - общий баланс карты", `${chart.bazi.strength.display.name} / ${chart.bazi.strength.verdict} (${chart.bazi.strength.score})`, hasCjk);
  technicalRow(doc, "Пять элементов", chart.bazi.elementsDisplay.map(item => `${item.name} ${item.original}: ${item.value}`).join(" / "), hasCjk);
  technicalRow(doc, "Регулирующие элементы - точки баланса", chart.bazi.regulatingDisplay.map(item => `${item.name} (${item.original})`).join(" / ") || "-", hasCjk);
  subheading(doc, "Большие жизненные периоды Ба-цзы");
  chart.bazi.majorPeriods.forEach(item => technicalRow(doc, `${item.range} / ${item.years}`, `${item.ganZhi} / ${item.detailDisplay.map(value => `${value.name} (${value.original})`).join(" · ")}`, hasCjk));
  subheading(doc, "Цзы Вэй Доу Шу (紫微斗数) - основные данные");
  technicalRow(doc, "Лунная дата", chart.ziwei.lunarDate, hasCjk);
  technicalRow(doc, "Дворец судьбы", chart.ziwei.mingPalace, hasCjk);
  technicalRow(doc, "Дворец тела", chart.ziwei.shenPalace, hasCjk);
  technicalRow(doc, "Система пяти элементов", `${chart.ziwei.fiveElementBureauDisplay.name} (${chart.ziwei.fiveElementBureau})`, hasCjk);
  technicalRow(doc, "Четыре трансформации", chart.ziwei.transformations.join(" / "), hasCjk);
  subheading(doc, "Двенадцать дворцов");
  chart.ziwei.palaces.forEach(item => technicalRow(doc, `${item.displayName.name} / ${item.name} · ${item.ganZhi}`, `${item.mainStarsDisplay.map(star => `${star.name} (${star.original})`).join(" / ") || "Без главной звезды"}; ${item.auxStars.join(" / ") || "-"}`, hasCjk));
  subheading(doc, "Метод времени");
  technicalRow(doc, "Исходное местное время", metadata.originalLocalDateTime, false);
  technicalRow(doc, "Истинное солнечное время", metadata.trueSolarDateTime, false);
  technicalRow(doc, "Метод", metadata.calculationMethod, false);
  if (metadata.calculationSensitivity === "HIGH") technicalRow(doc, "Примечание", "Время рождения находится близко к чувствительной границе расчёта.", false);
}

function disclaimer(doc) {
  page(doc, "Важное пояснение", "Этот отчёт основан на традиционных символических системах Ба-цзы и Цзы Вэй Доу Шу. Он предназначен для культурного исследования, саморефлексии и развлечения. Материал не является медицинской, юридической, финансовой, инвестиционной или иной профессиональной рекомендацией. Формулировки описывают возможные тенденции, а не предопределённые события. Решения человека и объективные обстоятельства важнее любой интерпретации.");
}

function page(doc, title, intro) {
  doc.addPage();
  doc.fillColor(colors.gold).font(doc._tianMingBrandFont).fontSize(9).text("ТЯНЬ МИН · 天命", 52, 48, { characterSpacing: 1.1 });
  doc.fillColor(colors.ink).font("Bold").fontSize(27).text(clean(title), 52, 88, { width: 490 });
  if (intro) doc.fillColor(colors.muted).font("Body").fontSize(10).text(clean(intro), 52, 135, { width: 490, lineGap: 4 });
  doc.y = intro ? 188 : 145;
}

function section(doc, title, text) { page(doc, title); bodyText(doc, text); }

function cards(doc, title, items, formatter, { continuePage = false } = {}) {
  if (continuePage) subheading(doc, title); else page(doc, title);
  items.forEach((item, index) => {
    const text = cleanNarrative(formatter(item, index));
    const height = doc.heightOfString(text, { width: 459, lineGap: 2 }) + 22;
    ensure(doc, height + 10);
    const y = doc.y;
    doc.roundedRect(52, y, 491, height, 8).fill(index % 2 ? colors.sand : colors.sage);
    doc.fillColor(colors.ink).font("Body").fontSize(9.5).text(text, 68, y + 11, { width: 459, lineGap: 2 });
    doc.y = y + height + 8;
  });
}

function splitSection(doc, title, entries) {
  page(doc, title);
  entries.forEach(([label, value]) => {
    const narrativeValue = cleanNarrative(value);
    const height = doc.heightOfString(narrativeValue, { width: 350, lineGap: 3 });
    ensure(doc, Math.max(54, height + 20));
    const y = doc.y;
    doc.fillColor(colors.gold).font("Bold").fontSize(9).text(clean(label).toUpperCase(), 52, y, { width: 118 });
    doc.fillColor(colors.ink).font("Body").fontSize(10).text(narrativeValue, 185, y, { width: 358, lineGap: 3 });
    doc.y = y + Math.max(54, height + 20);
    doc.moveTo(52, doc.y - 10).lineTo(543, doc.y - 10).strokeColor("#d8ded9").stroke();
  });
}

function matrix(doc, rows) {
  page(doc, "Матрица жизненных сфер", "Как две системы дополняют или уточняют друг друга.");
  rows.forEach(row => {
    const text = cleanNarrative(`Ба-цзы: ${row.bazi}\nЦзы Вэй: ${row.ziwei}\nСинтез: ${row.synthesis}`);
    const height = doc.heightOfString(text, { width: 384, lineGap: 1 }) + 16;
    ensure(doc, height + 7);
    const y = doc.y;
    doc.fillColor(colors.jade).font("Bold").fontSize(11).text(clean(row.area), 52, y, { width: 95 });
    doc.fillColor(row.alignment === "Расхождение" ? colors.red : colors.gold).font("Bold").fontSize(8).text(clean(row.alignment).toUpperCase(), 52, y + 22, { width: 100 });
    doc.fillColor(colors.ink).font("Body").fontSize(8.2).text(text, 153, y, { width: 390, lineGap: 1 });
    doc.y = y + height + 5;
  });
}

function bodyText(doc, text) { doc.fillColor(colors.ink).font("Body").fontSize(11).text(cleanNarrative(text), 52, doc.y, { width: 491, lineGap: 5, align: "left" }); }
function subheading(doc, text) { ensure(doc, 90); const font = doc._tianMingCjkReady && /[\u3400-\u9FFF]/.test(String(text)) ? "CJK" : "Bold"; doc.moveDown(1).fillColor(colors.jade).font(font).fontSize(15).text(clean(text)); doc.moveDown(.5); }
function technicalRow(doc, label, value, cjk) { ensure(doc, 34); const y = doc.y; doc.fillColor(colors.muted).font(cjk ? "CJK" : "Body").fontSize(8).text(clean(label), 52, y, { width: 175 }); doc.fillColor(colors.ink).font(cjk ? "CJK" : "Body").fontSize(9).text(clean(value), 230, y, { width: 313 }); doc.y = Math.max(doc.y, y + 28); }
function ensure(doc, height) { if (doc.y + height > 770) { doc.addPage(); doc.y = 58; } }

function cleanNarrative(value) {
  return clean(value)
    .replace(/[\u3400-\u9FFF]+/g, "")
    .replace(/[ \t]+([;,:])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ");
}

function addPageNumbers(doc) {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    doc.fillColor("#8b9691").font("Body").fontSize(8).text(`${index + 1} / ${range.count}`, 52, 780, { width: 491, align: "right", lineBreak: false });
  }
}

function labelFor(key) {
  return ({ reaction: "Реакция", mistakes: "Типичные ошибки", decisions: "Решения", recovery: "Восстановление", avoid: "Чего избегать", supports: "Что усиливает", drains: "Что истощает", allies: "Союзники", toxicPatterns: "Токсичные паттерны", communication: "Общение", style: "Стиль", control: "Контроль", authority: "Авторитет", conflict: "Спор", negotiation: "Договорённости", rhythm: "Ритм", intensity: "Интенсивность", stabilityVsChange: "Стабильность и перемены", rest: "Отдых", overload: "Перегруз", environment: "Среда", period: "Период", theme: "Тема", opportunities: "Возможности", risks: "Риски", career: "Карьера", relationships: "Отношения", money: "Деньги", lesson: "Урок" })[key] || key;
}

module.exports = { createReportPdf };
