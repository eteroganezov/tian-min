const fs = require("node:fs");
const PDFDocument = require("pdfkit");

const colors = { ink: "#18231f", muted: "#66736d", jade: "#173f36", sage: "#dfe8e2", sand: "#f4f0e7", gold: "#b5955d", red: "#9c4938", white: "#ffffff" };

function chooseFont(candidates) { return candidates.find(file => fs.existsSync(file)); }

function clean(value) {
  return String(value ?? "").replace(/[–—−‑]/g, "-").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function createReportPdf({ chart, metadata, presentation = {}, report, hasFullReport = true }) {
  return new Promise((resolve, reject) => {
    const person = presentation.displayName ? `${presentation.displayName} - ` : "";
    const doc = new PDFDocument({ size: "A4", margin: 52, bufferPages: true, info: { Title: `${person}персональная карта личности и жизненного пути`, Author: "Тянь Мин", Subject: "Персональный информационно-развлекательный отчёт" } });
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
    baziVisualPage(doc, chart, cjkReady);
    luckTimelinePage(doc, chart, cjkReady);
    ziweiVisualPage(doc, chart, cjkReady);
    disclaimer(doc);
    addPageNumbers(doc);
    doc.end();
  });
}

function cover(doc, chart, metadata, presentation, report) {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(colors.jade);
  doc.fillColor(colors.gold).font(doc._tianMingBrandFont).fontSize(11).text("ТЯНЬ МИН · 天命", 52, 56, { characterSpacing: 1.2 });
  doc.fillColor("#a9bdb5").font("Body").fontSize(10).text("ПЕРСОНАЛЬНАЯ КАРТА ЛИЧНОСТИ И ЖИЗНЕННОГО ПУТИ", 52, 88, { characterSpacing: .7 });
  doc.fillColor(colors.white).font("Bold").fontSize(34).text(clean(presentation.displayName || "Ваша персональная карта"), 52, 168, { width: 490, lineGap: 8 });
  doc.fillColor("#d9e3dd").font("Body").fontSize(16).text("Понять себя. Увидеть свой ритм.", 52, 270, { width: 460, lineGap: 5 });
  if (report) doc.fillColor(colors.gold).font("Body").fontSize(11).text(cleanNarrative(`${report.archetype}. ${report.subtitle}`), 52, 330, { width: 450, lineGap: 4 });
  doc.fillColor("#a9bdb5").font(doc._tianMingBrandFont).fontSize(10).text("Ба-цзы (八字) + Цзы Вэй Доу Шу (紫微斗数)", 52, 430, { width: 450 });
  doc.moveTo(52, 490).lineTo(543, 490).strokeColor("#55736a").stroke();
  const rows = [
    ["Дата рождения", metadata.originalBirthDate], ["Время рождения", metadata.originalBirthTime],
    ["Место рождения", presentation.birthPlace?.label || metadata.birthPlace],
  ];
  rows.forEach(([label, value], index) => {
    const y = 520 + index * 42;
    doc.fillColor("#9eb2aa").font("Body").fontSize(9).text(label.toUpperCase(), 52, y);
    const valueSize = label === "Имя" && clean(value).length > 38 ? 9 : 11;
    doc.fillColor(colors.white).font("Bold").fontSize(valueSize).text(clean(value), 190, y, { width: 350, lineBreak: false, ellipsis: true });
  });
  doc.fillColor("#91a69e").font("Body").fontSize(8).text(
    "Время рождения учтено с поправкой на место рождения и исторические правила времени.",
    52, 664, { width: 470, lineGap: 2 },
  );
  doc.fillColor("#91a69e").font("Body").fontSize(8).text("Информационный и развлекательный материал", 52, 760);
}

function fullReport(doc, report) {
  section(doc, "Краткий портрет", report.executiveSummary);
  section(doc, "Личность и внутренний мотив", report.personality);
  cards(doc, "5 главных черт", report.keyTraits, item => `${item.title}\n${item.explanation}\n\nВ ресурсе: ${item.positive}\nРиск: ${item.shadow}\nОснования: ${item.evidence.join("; ")}`, { continuePage: true });
  cards(doc, "Сильные стороны", report.strengths, item => `${item.title}\n${item.essence}\n\nКак проявляется: ${item.manifestation}\nГде полезно: ${item.usefulWhere}\nПрактика: ${item.practicalUse}`, { continuePage: true });
  cards(doc, "Риски и слабые места", report.challenges, item => `${item.pattern}\nКогда: ${item.trigger}\nВозможное следствие: ${item.consequence}\nЧто помогает: ${item.compensation}`, { continuePage: true });
  section(doc, "Карьера и профессиональный рост", report.career);
  section(doc, "Деньги и финансовое поведение", report.money);
  section(doc, "Отношения и близость", report.relationships);
  splitSection(doc, "Текущий большой период", Object.entries(report.currentPeriod).map(([key, value]) => [labelFor(key), value]));
  cards(doc, "Ближайшие 3 года", report.yearlyOutlook, item => `${item.year} - ${item.theme}\nВозможности: ${item.opportunities}\nРиски: ${item.risks}\nФокус: ${item.focus}\nНе форсировать: ${item.avoid}`);
  splitSection(doc, "План действий", [
    ["Делать чаще", report.actionPlan.doMore.join("\n• ")], ["Избегать", report.actionPlan.avoid.join("\n• ")],
    ["Фокус на 12 месяцев", report.actionPlan.next12Months.join("\n• ")], ["Вопросы себе", report.actionPlan.questions.join("\n• ")],
  ]);
  section(doc, "Итог", report.finalSummary);
}

function previewReport(doc, report) {
  section(doc, "Короткий портрет", report.executiveSummary);
  cards(doc, "Три сильные стороны", report.strengths.slice(0, 3), item => `${item.title}\n${item.essence}`);
  cards(doc, "Главная зона внимания", report.challenges.slice(0, 1), item => `${item.pattern}\n${item.compensation}`);
  section(doc, "Полная версия", "Расширенные разделы отчёта не входят в текущий доступ. Подробная карта приведена ниже.");
}

function unavailablePage(doc) { section(doc, "Персональный разбор ещё не создан", "Карта уже рассчитана. Ниже приведены четыре столпа Ба-цзы, баланс пяти элементов, жизненные периоды и двенадцать дворцов Цзы Вэй Доу Шу."); }

function baziVisualPage(doc, chart, hasCjk) {
  page(doc, "Ба-цзы: основа карты", "Четыре столпа и баланс пяти элементов, рассчитанные по дате, времени и месту рождения.");
  const cardWidth = 116;
  chart.bazi.pillars.forEach((pillar, index) => {
    const x = 52 + index * 125;
    doc.roundedRect(x, 188, cardWidth, 158, 8).fill(index % 2 ? colors.sand : colors.sage);
    doc.fillColor(colors.muted).font("Bold").fontSize(8).text(pillar.label.toUpperCase(), x + 12, 204, { width: 92, align: "center" });
    doc.fillColor(colors.jade).font(hasCjk ? "CJK" : "Bold").fontSize(27).text(`${pillar.gan}${pillar.zhi}`, x + 12, 235, { width: 92, align: "center" });
    doc.fillColor(colors.ink).font("Bold").fontSize(9).text(pillar.shiShenDisplay.name, x + 10, 285, { width: 96, align: "center" });
    doc.fillColor(colors.red).font(hasCjk ? "CJK" : "Body").fontSize(8).text(pillar.shiShenDisplay.original, x + 12, 320, { width: 92, align: "center" });
  });

  const summaries = [
    ["Дневной хозяин", chart.bazi.dayMaster, "Центральная точка карты"],
    ["Структура", chart.bazi.structureDisplay.name.replace(/^Структура\s*/, ""), chart.bazi.structure],
    ["Сила карты", chart.bazi.strength.display.name, `Оценка ${chart.bazi.strength.score}`],
  ];
  summaries.forEach(([label, value, note], index) => {
    const x = 52 + index * 166;
    doc.roundedRect(x, 374, 156, 92, 6).lineWidth(1).strokeColor("#d8ded9").stroke();
    doc.fillColor(colors.gold).font("Bold").fontSize(7.5).text(label.toUpperCase(), x + 12, 390, { width: 132 });
    doc.fillColor(colors.ink).font(hasCjk && /[\u3400-\u9FFF]/.test(String(value)) ? "CJK" : "Bold").fontSize(12).text(clean(value), x + 12, 412, { width: 132 });
    doc.fillColor(colors.muted).font(hasCjk ? "CJK" : "Body").fontSize(7.5).text(clean(note), x + 12, 442, { width: 132 });
  });

  doc.fillColor(colors.ink).font("Bold").fontSize(16).text("Баланс пяти элементов", 52, 505);
  const max = Math.max(...chart.bazi.elementsDisplay.map(item => Number(item.value)), 1);
  chart.bazi.elementsDisplay.forEach((item, index) => {
    const y = 548 + index * 38;
    doc.fillColor(colors.ink).font("Bold").fontSize(9).text(item.name, 52, y, { width: 82 });
    doc.fillColor(colors.gold).font(hasCjk ? "CJK" : "Body").fontSize(9).text(item.original, 122, y, { width: 24 });
    doc.roundedRect(158, y + 1, 330, 10, 5).fill("#e7e7e1");
    doc.roundedRect(158, y + 1, Math.max(4, 330 * Number(item.value) / max), 10, 5).fill(index === 2 ? colors.red : colors.jade);
    doc.fillColor(colors.ink).font("Bold").fontSize(9).text(String(item.value), 505, y, { width: 35, align: "right" });
  });
}

function luckTimelinePage(doc, chart, hasCjk) {
  page(doc, "Большие жизненные периоды", "Последовательные десятилетние этапы карты Ба-цзы. Выделен период, включающий текущий календарный год.");
  const currentYear = new Date().getUTCFullYear();
  doc.moveTo(96, 202).lineTo(96, 720).lineWidth(2).strokeColor("#d6ddd8").stroke();
  chart.bazi.majorPeriods.forEach((item, index) => {
    const y = 205 + index * 86;
    const years = String(item.years).match(/(\d{4}).*?(\d{4})/);
    const current = years && currentYear >= Number(years[1]) && currentYear <= Number(years[2]);
    doc.circle(96, y + 21, current ? 9 : 6).fill(current ? colors.red : colors.gold);
    if (current) doc.roundedRect(122, y - 2, 420, 67, 7).fill(colors.sage);
    doc.fillColor(colors.muted).font("Bold").fontSize(8).text(item.range, 52, y + 8, { width: 34, align: "right" });
    doc.fillColor(colors.jade).font(hasCjk ? "CJK" : "Bold").fontSize(18).text(item.ganZhi, 140, y + 7, { width: 70 });
    doc.fillColor(colors.ink).font("Bold").fontSize(10).text(item.detailDisplay.map(value => value.name).join(" · "), 225, y + 8, { width: 285 });
    doc.fillColor(colors.muted).font("Body").fontSize(8).text(`${item.years}${current ? " · текущий период" : ""}`, 225, y + 35, { width: 285 });
  });
}

function ziweiVisualPage(doc, chart, hasCjk) {
  page(doc, "Цзы Вэй: двенадцать дворцов", "Русское название показано первым. Китайские обозначения и транслитерации сохранены как вторичный профессиональный слой.");
  const facts = [
    ["Лунная дата", chart.ziwei.lunarDateDisplay], ["Дворец судьбы", chart.ziwei.mingPalace],
    ["Дворец тела", chart.ziwei.shenPalace], ["Система элементов", chart.ziwei.fiveElementBureauDisplay.name],
  ];
  facts.forEach(([label, value], index) => {
    const x = 52 + index * 123;
    doc.roundedRect(x, 182, 115, 62, 6).fill(index % 2 ? colors.sand : colors.sage);
    doc.fillColor(colors.gold).font("Bold").fontSize(7).text(label.toUpperCase(), x + 9, 194, { width: 97 });
    doc.fillColor(colors.ink).font(hasCjk && /[\u3400-\u9FFF]/.test(String(value)) ? "CJK" : "Bold").fontSize(9).text(clean(value), x + 9, 214, { width: 97 });
  });
  if (chart.ziwei.transformationsDisplay.length) {
    doc.fillColor(colors.muted).font("Body").fontSize(7.5).text(`Четыре трансформации: ${chart.ziwei.transformationsDisplay.map(item => item.name).join(" · ")}`, 52, 258, { width: 491 });
  }
  chart.ziwei.palaces.forEach((palace, index) => {
    const col = index % 3, row = Math.floor(index / 3);
    const x = 52 + col * 166, y = 288 + row * 112;
    doc.roundedRect(x, y, 156, 102, 6).fill(palace.isCurrentPeriod ? colors.sage : index % 2 ? colors.sand : "#f8f7f2");
    if (palace.isCurrentPeriod) doc.rect(x, y, 4, 102).fill(colors.gold);
    doc.fillColor(colors.ink).font("Bold").fontSize(8.3).text(palace.displayName.name, x + 10, y + 10, { width: 136, height: 25 });
    doc.fillColor(colors.gold).font(hasCjk ? "CJK" : "Body").fontSize(7).text(`${palace.name} · ${palace.ganZhi}`, x + 10, y + 38, { width: 136 });
    const stars = palace.mainStarsDisplay.length ? palace.mainStarsDisplay.map(star => star.name).join(" · ") : "Без главной звезды";
    doc.fillColor(colors.jade).font("Bold").fontSize(8).text(stars, x + 10, y + 57, { width: 136 });
    doc.fillColor(colors.muted).font("Body").fontSize(6.7).text(`${palace.majorPeriod} лет${palace.isCurrentPeriod ? " · текущий" : ""}`, x + 10, y + 82, { width: 136 });
  });
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
