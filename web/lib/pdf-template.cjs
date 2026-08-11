const fs = require("node:fs");
const PDFDocument = require("pdfkit");

const colors = { ink: "#18231f", muted: "#66736d", jade: "#173f36", sage: "#dfe8e2", sand: "#f4f0e7", gold: "#b5955d", red: "#9c4938", white: "#ffffff" };

function chooseFont(candidates) { return candidates.find(file => fs.existsSync(file)); }

function clean(value) {
  return String(value ?? "").replace(/[–—−‑]/g, "-").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function createReportPdf({ chart, metadata, report, hasFullReport = true }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 52, bufferPages: true, info: { Title: report ? `${report.archetype} - персональный отчёт` : "Техническая карта BaZi и Zi Wei", Author: "Тянь Мин", Subject: "Персональный информационно-развлекательный отчёт" } });
    const chunks = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const regular = chooseFont([process.env.PDF_FONT_REGULAR, "/System/Library/Fonts/Supplemental/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"].filter(Boolean));
    const bold = chooseFont([process.env.PDF_FONT_BOLD, "/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"].filter(Boolean));
    if (regular) doc.registerFont("Body", regular); else doc.registerFont("Body", "Helvetica");
    if (bold) doc.registerFont("Bold", bold); else doc.registerFont("Bold", "Helvetica-Bold");
    const cjk = chooseFont([process.env.PDF_FONT_CJK, "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"].filter(Boolean));
    let cjkReady = false;
    if (cjk) { try { doc.registerFont("CJK", cjk); cjkReady = true; } catch { cjkReady = false; } }

    cover(doc, chart, metadata, report);
    if (report && hasFullReport) fullReport(doc, report);
    else if (report) previewReport(doc, report);
    else unavailablePage(doc);
    technicalAppendix(doc, chart, metadata, cjkReady);
    disclaimer(doc);
    addPageNumbers(doc);
    doc.end();
  });
}

function cover(doc, chart, metadata, report) {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(colors.jade);
  doc.fillColor(colors.gold).font("Bold").fontSize(11).text("ТЯНЬ МИН  /  ПЕРСОНАЛЬНЫЙ ОТЧЁТ", 52, 56, { characterSpacing: 1.2 });
  doc.fillColor(colors.white).font("Bold").fontSize(34).text(clean(report?.archetype || "Ваша карта BaZi + Zi Wei"), 52, 180, { width: 490, lineGap: 8 });
  doc.fillColor("#d9e3dd").font("Body").fontSize(17).text(clean(report?.subtitle || "Технический расчёт готов. Персональная AI-интерпретация не была создана."), 52, 285, { width: 460, lineGap: 5 });
  if (report) doc.fillColor(colors.gold).font("Body").fontSize(12).text(clean(report.oneLineFormula), 52, 370, { width: 450, lineGap: 4 });
  doc.moveTo(52, 540).lineTo(543, 540).strokeColor("#55736a").stroke();
  const rows = [
    ["Дата рождения", metadata.originalBirthDate], ["Местное время", metadata.originalBirthTime],
    ["Место рождения", metadata.birthPlace], ["Метод", metadata.calculationMethod],
  ];
  rows.forEach(([label, value], index) => {
    const y = 570 + index * 42;
    doc.fillColor("#9eb2aa").font("Body").fontSize(9).text(label.toUpperCase(), 52, y);
    doc.fillColor(colors.white).font("Bold").fontSize(11).text(clean(value), 190, y, { width: 350 });
  });
  doc.fillColor("#91a69e").font("Body").fontSize(8).text("Информационный и развлекательный материал", 52, 760);
}

function fullReport(doc, report) {
  section(doc, "Краткий портрет", report.executiveSummary);
  section(doc, "Личность и внутренний мотив", report.personality);
  cards(doc, "5 главных черт", report.keyTraits, item => `${item.title}\n${item.explanation}\n\nВ ресурсе: ${item.positive}\nРиск: ${item.shadow}\nОснования: ${item.evidence.join("; ")}`);
  cards(doc, "Сильные стороны", report.strengths, item => `${item.title}\n${item.essence}\n\nКак проявляется: ${item.manifestation}\nГде полезно: ${item.usefulWhere}\nПрактика: ${item.practicalUse}`);
  cards(doc, "Риски и слабые места", report.challenges, item => `${item.pattern}\nКогда: ${item.trigger}\nВозможное следствие: ${item.consequence}\nЧто помогает: ${item.compensation}`);
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
  cards(doc, "Ключевые переходы жизни", report.keyLifeTransitions, item => `${item.age} / ${item.period}\n${item.theme}\nЧто меняется: ${item.change}`);
  cards(doc, "Три сценария", report.scenarios, item => `${item.type}: ${item.title}\n${item.description}\nРешения: ${item.decisions}`);
  matrix(doc, report.lifeAreaMatrix);
  splitSection(doc, "Cross-validation BaZi + Zi Wei", [
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
  section(doc, "Персональная интерпретация", "Персональная AI-интерпретация не была создана. Ниже сохранён полный технический расчёт BaZi и Zi Wei.");
}

function technicalAppendix(doc, chart, metadata, hasCjk) {
  page(doc, "Техническое приложение", "Рассчитанные данные не изменялись AI-интерпретацией.");
  subheading(doc, "BaZi - четыре столпа");
  chart.bazi.pillars.forEach(pillar => technicalRow(doc, pillar.label, `${pillar.gan}${pillar.zhi} / ${pillar.shiShen}`, hasCjk));
  technicalRow(doc, "Дневной хозяин", chart.bazi.dayMaster, hasCjk);
  technicalRow(doc, "Структура", chart.bazi.structure, hasCjk);
  technicalRow(doc, "Сила", `${chart.bazi.strength.verdict} (${chart.bazi.strength.score})`, hasCjk);
  subheading(doc, "Большие периоды BaZi");
  chart.bazi.majorPeriods.forEach(item => technicalRow(doc, `${item.range} / ${item.years}`, `${item.ganZhi} / ${item.detail}`, hasCjk));
  subheading(doc, "Zi Wei - основные данные");
  technicalRow(doc, "Лунная дата", chart.ziwei.lunarDate, hasCjk);
  technicalRow(doc, "Дворец судьбы", chart.ziwei.mingPalace, hasCjk);
  technicalRow(doc, "Дворец тела", chart.ziwei.shenPalace, hasCjk);
  technicalRow(doc, "Система пяти элементов", chart.ziwei.fiveElementBureau, hasCjk);
  technicalRow(doc, "Четыре трансформации", chart.ziwei.transformations.join(" / "), hasCjk);
  subheading(doc, "Двенадцать дворцов");
  chart.ziwei.palaces.forEach(item => technicalRow(doc, `${item.name} ${item.ganZhi}`, `${item.mainStars.join(" / ") || "Без главной звезды"}; ${item.auxStars.join(" / ") || "-"}`, hasCjk));
  subheading(doc, "Метод времени");
  technicalRow(doc, "Исходное местное время", metadata.originalLocalDateTime, false);
  technicalRow(doc, "Истинное солнечное время", metadata.trueSolarDateTime, false);
  technicalRow(doc, "Метод", metadata.calculationMethod, false);
  if (metadata.calculationSensitivity === "HIGH") technicalRow(doc, "Примечание", "Время рождения находится близко к чувствительной границе расчёта.", false);
}

function disclaimer(doc) {
  page(doc, "Важное пояснение", "Этот отчёт основан на традиционных символических системах BaZi и Zi Wei. Он предназначен для культурного исследования, саморефлексии и развлечения. Материал не является медицинской, юридической, финансовой, инвестиционной или иной профессиональной рекомендацией. Формулировки описывают возможные тенденции, а не предопределённые события. Решения человека и объективные обстоятельства важнее любой интерпретации.");
}

function page(doc, title, intro) {
  doc.addPage();
  doc.fillColor(colors.gold).font("Bold").fontSize(9).text("ТЯНЬ МИН", 52, 48, { characterSpacing: 1.1 });
  doc.fillColor(colors.ink).font("Bold").fontSize(27).text(clean(title), 52, 88, { width: 490 });
  if (intro) doc.fillColor(colors.muted).font("Body").fontSize(10).text(clean(intro), 52, 135, { width: 490, lineGap: 4 });
  doc.y = intro ? 188 : 145;
}

function section(doc, title, text) { page(doc, title); bodyText(doc, text); }

function cards(doc, title, items, formatter) {
  page(doc, title);
  items.forEach((item, index) => {
    const text = clean(formatter(item, index));
    const height = doc.heightOfString(text, { width: 455, lineGap: 3 }) + 28;
    ensure(doc, height + 14);
    doc.roundedRect(52, doc.y, 491, height, 8).fill(index % 2 ? colors.sand : colors.sage);
    doc.fillColor(colors.ink).font("Body").fontSize(10).text(text, 70, doc.y + 14, { width: 455, lineGap: 3 });
    doc.y += height + 12;
  });
}

function splitSection(doc, title, entries) {
  page(doc, title);
  entries.forEach(([label, value]) => {
    const height = doc.heightOfString(clean(value), { width: 350, lineGap: 3 });
    ensure(doc, Math.max(54, height + 20));
    const y = doc.y;
    doc.fillColor(colors.gold).font("Bold").fontSize(9).text(clean(label).toUpperCase(), 52, y, { width: 118 });
    doc.fillColor(colors.ink).font("Body").fontSize(10).text(clean(value), 185, y, { width: 358, lineGap: 3 });
    doc.y = y + Math.max(54, height + 20);
    doc.moveTo(52, doc.y - 10).lineTo(543, doc.y - 10).strokeColor("#d8ded9").stroke();
  });
}

function matrix(doc, rows) {
  page(doc, "Матрица жизненных сфер", "Как две системы дополняют или уточняют друг друга.");
  rows.forEach(row => {
    const text = `BaZi: ${row.bazi}\nZi Wei: ${row.ziwei}\nСинтез: ${row.synthesis}`;
    const height = doc.heightOfString(clean(text), { width: 360, lineGap: 2 }) + 26;
    ensure(doc, height + 12);
    const y = doc.y;
    doc.fillColor(colors.jade).font("Bold").fontSize(11).text(clean(row.area), 52, y, { width: 95 });
    doc.fillColor(row.alignment === "Расхождение" ? colors.red : colors.gold).font("Bold").fontSize(8).text(clean(row.alignment).toUpperCase(), 52, y + 22, { width: 100 });
    doc.fillColor(colors.ink).font("Body").fontSize(9).text(clean(text), 165, y, { width: 378, lineGap: 2 });
    doc.y = y + height + 10;
  });
}

function bodyText(doc, text) { doc.fillColor(colors.ink).font("Body").fontSize(11).text(clean(text), 52, doc.y, { width: 491, lineGap: 5, align: "left" }); }
function subheading(doc, text) { ensure(doc, 48); doc.moveDown(1).fillColor(colors.jade).font("Bold").fontSize(15).text(clean(text)); doc.moveDown(.5); }
function technicalRow(doc, label, value, cjk) { ensure(doc, 34); const y = doc.y; doc.fillColor(colors.muted).font("Body").fontSize(8).text(clean(label), 52, y, { width: 175 }); doc.fillColor(colors.ink).font(cjk ? "CJK" : "Body").fontSize(9).text(clean(value), 230, y, { width: 313 }); doc.y = Math.max(doc.y, y + 28); }
function ensure(doc, height) { if (doc.y + height > 770) { doc.addPage(); doc.y = 58; } }

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
