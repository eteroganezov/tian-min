const test = require("node:test");
const assert = require("node:assert/strict");
const pdfParse = require("pdf-parse");
const { locationProvider } = require("../lib/location-provider.cjs");
const { buildReportContext } = require("../lib/report-service.cjs");
const { calculateBirthChart } = require("../lib/birth-chart-pipeline.cjs");
const { toChartView } = require("../lib/chart-view.cjs");
const { createMockReport } = require("../lib/mock-report.cjs");
const { createPdfFilename, createPdfFromSavedReport, createPdfRequest, safeFilenamePart } = require("../lib/pdf-service.cjs");

const moscow = locationProvider.search("Москва")[0];
const input = { name: "Эдуард", date: "2000-01-01", time: "12:00", gender: "male", placeId: moscow.id };

test("полный PDF является настоящим документом и содержит главные разделы", async () => {
  const calculation = calculateBirthChart(input);
  const report = createMockReport(buildReportContext(calculation, { displayName: input.name }, { model: "mock-v1", reportYears: [2026, 2027, 2028] }));
  const result = await createPdfRequest({ ...input, report }, { hasFullReport: true });
  assert.equal(result.status, 200);
  assert.equal(result.buffer.subarray(0, 5).toString(), "%PDF-");
  assert.equal(result.buffer.length > 50000, true);
  const parsed = await pdfParse(result.buffer);
  assert.match(parsed.text, /ТЯНЬ МИН/);
  assert.match(parsed.text, /Эдуард/);
  assert.match(parsed.text, /Персональная карта личности и жизненного пути/i);
  assert.match(parsed.text, /Внутренний портрет/);
  assert.match(parsed.text, /Роль, где можно влиять на качество/);
  assert.match(parsed.text, /Ваша карта в одном взгляде/);
  assert.match(parsed.text, /Янская Земля[\s\S]{0,40}戊\s*·\s*основной элемент человека/);
  assert.match(parsed.text, /Двенадцать дворцов Цзы Вэй/);
  assert.match(parsed.text, /Дворец партнёрства и[\s\S]{0,20}отношений/);
  assert.match(parsed.text, /Дерево[\s\S]*木[\s\S]*1/);
  assert.match(parsed.text, /Цзы Вэй[\s\S]*紫微/);
  assert.match(parsed.text, /Москва, Россия/);
  assert.match(parsed.text, /Время рождения учтено с поправкой/);
  assert.equal(parsed.numpages >= 19 && parsed.numpages <= 27, true, `Получилось ${parsed.numpages} страниц`);
  assert.equal((parsed.text.match(/Материалы предназначены для информационных, культурных/g) || []).length, 1);
  assert.equal(parsed.text.indexOf("Двенадцать дворцов Цзы Вэй") < parsed.text.indexOf("Главное о вас"), true);
  assert.match(parsed.text, /Дворец судьбы[\s\S]{0,50}У\s*·\s*午/i);
  assert.match(parsed.text, /Дворец тела[\s\S]{0,50}У\s*·\s*午/i);
  assert.equal((parsed.text.match(/Главное о вас/g) || []).length, 1);
  assert.doesNotMatch(parsed.text, /Оценка\s*-?\d/i);
  assert.doesNotMatch(parsed.text, /\b(?:BaZi|Bazi|Zi\s*Wei|ZiWei|undefined|null|NaN)\b/i);
  assert.doesNotMatch(parsed.text, /Продолжение|—\s*—|–\s*–|--|бизнес(?:\uFFFE)?анализ/iu);
  assert.doesNotMatch(parsed.text, /Цзы Вэй в одном взгляде/i);
  assert.doesNotMatch(parsed.text, /(?:соединение|столкновение|сочетание|вред)\s*[-–—](?:\s|$)/i);
  assert.doesNotMatch(parsed.text, /TRUE_SOLAR_TIME_V1|Equation of Time|Техническое приложение|AI-интерпретация/);
});

test("PDF создаётся без персонального разбора и сохраняет рассчитанную карту", async () => {
  const result = await createPdfRequest(input, { hasFullReport: true });
  assert.equal(result.status, 200);
  const parsed = await pdfParse(result.buffer);
  assert.match(parsed.text, /Персональный разбор ещё не/);
  assert.match(parsed.text, /Ваша карта в одном взгляде/);
  assert.match(parsed.text, /Двенадцать дворцов Цзы Вэй/);
  assert.doesNotMatch(parsed.text, /TRUE_SOLAR_TIME_V1|Equation of Time|AI|техническ/i);
});

test("PDF безопасно принимает длинное русское имя", async () => {
  const longName = "Александра-Мария Константиновна Мирославская";
  const result = await createPdfRequest({ ...input, name: longName }, { hasFullReport: true });
  assert.equal(result.status, 200);
  const parsed = await pdfParse(result.buffer);
  assert.match(parsed.text, /Александра-Мария/);
});

test("PDF сохраняет китайские оригинальные обозначения", async () => {
  const result = await createPdfRequest(input, { hasFullReport: true });
  assert.equal(result.status, 200);
  const parsed = await pdfParse(result.buffer);
  assert.match(parsed.text, /紫微/);
  assert.match(parsed.text, /正财\s*格/);
});

test("PDF-инфографика использует реальные столпы, элементы и периоды карты", async () => {
  const calculation = calculateBirthChart(input);
  const result = await createPdfRequest(input, { hasFullReport: true });
  const parsed = await pdfParse(result.buffer);
  const chart = calculation.chart;
  for (const pillar of Object.values(chart.bazi.siZhu)) assert.match(parsed.text, new RegExp(`${pillar.gan}${pillar.zhi}`));
  for (const period of chart.bazi.dayun.slice(0, 6)) assert.match(parsed.text, new RegExp(period.ganZhi));
  for (const palace of toChartView(chart).ziwei.palaces) {
    const pattern = palace.displayName.name.split(/\s+/u).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    assert.match(parsed.text, new RegExp(pattern));
  }
  assert.match(parsed.text, /Четыре трансформации/i);
});

test("consumer PDF удаляет пустые evidence-значения целиком", async () => {
  const saved = {
    kind: "legacy-rendered-report",
    input,
    presentation: { displayName: input.name },
    sections: [
      { key: "archetype", title: "Спокойный стратег", paragraphs: ["Знания превращаются в ясные решения."] },
      { key: "executive", title: "Главное о вас", paragraphs: ["Вы внимательно изучаете ситуацию.", "Вам важна ясность.", "Перегруз может мешать.", "Сейчас важна последовательность."] },
      { key: "traits", title: "Ваш характер в деталях", items: ["01 Наблюдательность Преобладание внимания к деталям. В РЕСУРСЕ Видите связи. В ПЕРЕГРУЗЕ Долго проверяете решение. Основания карты: соединение - и вред -."] },
      { key: "final", title: "Ваша главная линия", paragraphs: ["Ваша опора — ясность и последовательность."] },
    ],
  };
  const result = await createPdfFromSavedReport(saved);
  assert.equal(result.status, 200);
  const parsed = await pdfParse(result.buffer);
  assert.doesNotMatch(parsed.text, /\b(?:undefined|null|NaN)\b/i);
  assert.doesNotMatch(parsed.text, /(?:соединение|столкновение|сочетание|вред)\s*[-–—](?:\s|$)/i);
});

test("редакционный PDF очищает внутренние формулировки, Unicode и сохраняет последовательную нумерацию", async () => {
  const saved = {
    kind: "legacy-rendered-report",
    input,
    presentation: { displayName: input.name },
    sections: [
      { key: "archetype", title: "Спокойный стратег", paragraphs: ["Знания → ясное решение → устойчивый результат."] },
      { key: "executive", title: "Главное о вас", paragraphs: [
        "Этот отчёт основан на двух системах — это методическое пояснение. Главная объединяющая тема карты — ясность и последовательность. Лучше раскрывается там, где знания становятся результатом.",
        "Оценка силы обозначена как низкая. Давление ожиданий может истощать.",
        "Особенно заметна способность соединять людей.",
        "Практическая формула периода — ясные договорённости.",
      ] },
      { key: "relationships", title: "Близость, выбор и конфликты", paragraphs: [
        "Первый вводный смысл. Первый реальный смысловой пункт.",
        "Второй реальный смысловой пункт.",
        "Третий реальный смысловой пункт.",
        "Ба-цзы: Конфликт 申–寅 может отражать разные внутренние импульсы.",
        "Высокая чувствительность расчёта к часу рождения требует снизить уверенность.",
        "Шестой исходный, но пятый отображаемый смысловой пункт.",
      ] },
      { key: "environment", title: "", items: ["ЧТО УСИЛИВАЕТ Уникальная проверочная фраза о подходящей среде."] },
      { key: "leadership", title: "", items: ["СТИЛЬ Уникальная проверочная фраза о стиле лидерства."] },
      { key: "lifestyle", title: "", items: ["РИТМ Уникальная проверочная фраза о жизненном ритме."] },
      { key: "matrix", title: "Матрица жизненных сфер", items: ["Окружение Согласие Ба-цзы Конфликт 申–寅 может отражать напряжение. Экспертно\uFFFEструктурные роли поддерживают результат.", "Цзы Вэй Доу Шу Тань Лан во дворце уязвимостей напоминает о режиме."] },
      { key: "cross-validation", title: "Где выводы устойчивее", items: ["Подтверждают Уникальная проверочная фраза о согласовании систем."] },
      { key: "confidence", title: "Насколько устойчивы выводы", items: ["Хорошо подтверждается картой — Основная линия.", "Требует дополнительного контекста — Детали периода.", "Не стоит воспринимать буквально — Конкретные события."] },
      { key: "manifestations", title: "Как это проявляется в жизни", items: ["Уникальная проверочная фраза о проявлении в жизни."] },
      { key: "final", title: "Ваша главная линия", paragraphs: ["В рамках этой символической интерпретации ваша опора — ясность."] },
    ],
  };
  const result = await createPdfFromSavedReport(saved);
  assert.equal(result.status, 200);
  const parsed = await pdfParse(result.buffer);
  assert.equal((parsed.text.match(/Главное о вас/g) || []).length, 1);
  assert.doesNotMatch(parsed.text, /Этот отчёт основан|в рамках этой символической интерпретации|ПЕРСОНАЛЬНЫЙ СИНТЕЗ|Профессиональный слой отчёта|Русское название показано первым/i);
  assert.doesNotMatch(parsed.text, /(?:Конфликт|Соединение|Столкновение|Сочетание|Вред)\s*[-–—](?:\s|$)/i);
  assert.doesNotMatch(parsed.text, /[\u00AD\u200B-\u200D\u2060\uFFFD\uFFFE\uFFFF]/u);
  assert.doesNotMatch(parsed.text, /\b(?:undefined|null|NaN|sensitivity)\b|следует воспринимать особенно осторожно/i);
  const relationships = parsed.text.slice(parsed.text.indexOf("Близость, выбор и конфликты"), parsed.text.indexOf("Матрица жизненных сфер"));
  for (const number of ["01", "02", "03", "04", "05"]) assert.match(relationships, new RegExp(`${number}\\s*·`));
  assert.doesNotMatch(relationships, /06\s*·/);
  assert.equal((parsed.text.match(/Материалы предназначены для информационных, культурных/g) || []).length, 1);
  assert.match(parsed.text, /Здоровье[\s\S]{0,120}Тань Лан/);
  assert.doesNotMatch(parsed.text, /взаимодействие элементов,\s*взаимодействие элементов/i);
  assert.doesNotMatch(parsed.text, /не буквальный событийный прогноз|сохран[её]нн\p{L}* отч[её]т/iu);
  assert.doesNotMatch(parsed.text, /Оценка\s*-?\d/i);
  for (const phrase of ["подходящей среде", "стиле лидерства", "жизненном ритме", "согласовании систем", "проявлении в жизни"]) assert.match(parsed.text, new RegExp(phrase, "i"));
  assert.doesNotMatch(parsed.text, /Продолжение|—\s*—|–\s*–|--|бизнес(?:\uFFFE)?анализ|Требуют осторожности|высокая чувствительность расчёта/iu);
});

test("PDF-рендерер принимает короткие и длинные смысловые блоки без потери финала", async () => {
  const calculation = calculateBirthChart(input);
  const shortReport = createMockReport(buildReportContext(calculation, { displayName: input.name }, { model: "mock-v1" }));
  shortReport.career.summary = "Короткий вывод.";
  const shortPdf = await createPdfRequest({ ...input, report: shortReport }, { hasFullReport: true });
  assert.equal(shortPdf.status, 200);
  const longReport = structuredClone(shortReport);
  longReport.relationships.summary = Array(35).fill("Развёрнутый абзац проверяет перенос текста и сохранение читаемой структуры страницы.").join(" ");
  const longPdf = await createPdfRequest({ ...input, report: longReport }, { hasFullReport: true });
  assert.equal(longPdf.status, 200);
  const parsed = await pdfParse(longPdf.buffer);
  assert.match(parsed.text, /Материалы предназначены для информационных, культурных/);
  assert.match(parsed.text, /Раньше проговаривать ожидания/);
});

test("сохранённый отчёт повторно создаёт PDF без обращения к AI-провайдеру", async () => {
  let providerCalls = 0;
  const calculation = calculateBirthChart(input);
  const report = createMockReport(buildReportContext(calculation, { displayName: input.name }, { model: "mock-v1" }));
  const saved = { kind: "semantic-report", input, presentation: { displayName: input.name }, report };
  const result = await createPdfFromSavedReport(saved, { provider: { async generate() { providerCalls += 1; } } });
  assert.equal(result.status, 200);
  assert.equal(providerCalls, 0);
});

test("имя PDF безопасно для macOS, Windows и не допускает путь к чужому файлу", () => {
  assert.equal(createPdfFilename({ displayName: "Эдуард", date: "2000-01-01", time: "12:05" }), "tian-min-eduard-2000-01-01-12-05.pdf");
  const hostile = createPdfFilename({ displayName: "../../\\secret:<script>", date: "../../etc", time: "12/00" });
  assert.equal(hostile.includes("/"), false);
  assert.equal(hostile.includes("\\"), false);
  assert.equal(hostile.includes(".."), false);
  assert.match(hostile, /^tian-min-[a-z0-9-]+-date-time\.pdf$/);
  assert.equal(safeFilenamePart("  Анна Мария  "), "anna-mariya");
});
