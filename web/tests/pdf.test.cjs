const test = require("node:test");
const assert = require("node:assert/strict");
const pdfParse = require("pdf-parse");
const { locationProvider } = require("../lib/location-provider.cjs");
const { buildReportContext } = require("../lib/report-service.cjs");
const { calculateBirthChart } = require("../lib/birth-chart-pipeline.cjs");
const { createMockReport } = require("../lib/mock-report.cjs");
const { createPdfRequest } = require("../lib/pdf-service.cjs");

const moscow = locationProvider.search("Москва")[0];
const input = { date: "2000-01-01", time: "12:00", gender: "male", placeId: moscow.id };

test("полный PDF является настоящим документом и содержит главные разделы", async () => {
  const calculation = calculateBirthChart(input);
  const report = createMockReport(buildReportContext(calculation));
  const result = await createPdfRequest({ ...input, report }, { hasFullReport: true });
  assert.equal(result.status, 200);
  assert.equal(result.buffer.subarray(0, 5).toString(), "%PDF-");
  assert.equal(result.buffer.length > 50000, true);
  const parsed = await pdfParse(result.buffer);
  assert.match(parsed.text, /ТЯНЬ МИН/);
  assert.match(parsed.text, /Личность и внутренний мотив/);
  assert.match(parsed.text, /Карьера и профессиональный рост/);
  assert.match(parsed.text, /BaZi - четыре столпа/);
  assert.match(parsed.text, /Zi Wei - основные данные/);
});

test("PDF создаётся и без AI, сохраняя технический расчёт", async () => {
  const result = await createPdfRequest(input, { hasFullReport: true });
  assert.equal(result.status, 200);
  const parsed = await pdfParse(result.buffer);
  assert.match(parsed.text, /AI-интерпретация не была создана/);
  assert.match(parsed.text, /BaZi - четыре столпа/);
  assert.match(parsed.text, /Zi Wei - основные данные/);
});
