const test = require("node:test");
const assert = require("node:assert/strict");
const pdfParse = require("pdf-parse");
const { locationProvider } = require("../lib/location-provider.cjs");
const { buildReportContext } = require("../lib/report-service.cjs");
const { calculateBirthChart } = require("../lib/birth-chart-pipeline.cjs");
const { createMockReport } = require("../lib/mock-report.cjs");
const { createPdfFilename, createPdfRequest, safeFilenamePart } = require("../lib/pdf-service.cjs");

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
  assert.match(parsed.text, /Ба-цзы: основа карты/);
  assert.match(parsed.text, /Цзы Вэй: двенадцать дворцов/);
  assert.match(parsed.text, /Дворец партнёрства и[\s\S]{0,20}отношений/);
  assert.match(parsed.text, /Дерево[\s\S]*木[\s\S]*1/);
  assert.match(parsed.text, /Цзы Вэй[\s\S]*紫微/);
  assert.match(parsed.text, /Москва, Россия/);
  assert.match(parsed.text, /Время рождения учтено с поправкой/);
  assert.equal(parsed.numpages >= 14 && parsed.numpages <= 20, true, `Получилось ${parsed.numpages} страниц`);
  assert.doesNotMatch(parsed.text, /\b(?:BaZi|Bazi|Zi\s*Wei|ZiWei|undefined|null|NaN)\b/i);
  assert.doesNotMatch(parsed.text, /TRUE_SOLAR_TIME_V1|Equation of Time|Техническое приложение|AI-интерпретация/);
});

test("PDF создаётся без персонального разбора и сохраняет рассчитанную карту", async () => {
  const result = await createPdfRequest(input, { hasFullReport: true });
  assert.equal(result.status, 200);
  const parsed = await pdfParse(result.buffer);
  assert.match(parsed.text, /Персональный разбор ещё не/);
  assert.match(parsed.text, /Ба-цзы: основа карты/);
  assert.match(parsed.text, /Цзы Вэй: двенадцать дворцов/);
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
  assert.match(parsed.text, /正财格/);
});

test("PDF-инфографика использует реальные столпы, элементы и периоды карты", async () => {
  const calculation = calculateBirthChart(input);
  const result = await createPdfRequest(input, { hasFullReport: true });
  const parsed = await pdfParse(result.buffer);
  const chart = calculation.chart;
  for (const pillar of Object.values(chart.bazi.siZhu)) assert.match(parsed.text, new RegExp(`${pillar.gan}${pillar.zhi}`));
  for (const period of chart.bazi.dayun.slice(0, 6)) assert.match(parsed.text, new RegExp(period.ganZhi));
  assert.match(parsed.text, /Дворец судьбы и личности/);
  assert.match(parsed.text, /Четыре трансформации/);
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
  assert.match(parsed.text, /Важное пояснение/);
  assert.match(parsed.text, /Раньше проговаривать ожидания/);
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
