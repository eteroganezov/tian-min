const test = require("node:test");
const assert = require("node:assert/strict");
const { locationProvider } = require("../lib/location-provider.cjs");
const { createMockReport } = require("../lib/mock-report.cjs");
const { validatePersonalReport } = require("../lib/report-schema.cjs");
const { generateReportRequest } = require("../lib/report-service.cjs");

const moscow = locationProvider.search("Москва")[0];
const input = { date: "2000-01-01", time: "12:00", gender: "male", placeId: moscow.id };

test("структурированный персональный отчёт проходит строгую схему", async () => {
  const result = await generateReportRequest({ ...input, name: "  Эдуард  " }, { env: { AI_MODE: "mock" }, reportYears: [2026, 2027, 2028] });
  assert.equal(result.status, 200);
  assert.equal(result.body.aiStatus, "ready");
  assert.equal(validatePersonalReport(result.body.report).valid, true);
  assert.equal(result.body.report.keyTraits.length, 5);
  assert.equal(result.body.report.lifeAreaMatrix.length, 8);
  assert.equal(result.body.presentation.displayName, "Эдуард");
  assert.match(result.body.report.executiveSummary, /^Эдуард,/);
  assert.match(result.body.reportId, /^tmr_[a-f0-9]{24}$/);
  assert.match(result.body.chartId, /^tmc_[a-f0-9]{24}$/);
});

test("стабильный report ID повторяется для одинакового контекста", async () => {
  const options = { env: { AI_MODE: "mock" }, reportYears: [2026, 2027, 2028] };
  const first = await generateReportRequest({ ...input, name: "Эдуард" }, options);
  const second = await generateReportRequest({ ...input, name: "Эдуард" }, options);
  const renamed = await generateReportRequest({ ...input, name: "Edward" }, options);
  assert.equal(first.body.reportId, second.body.reportId);
  assert.equal(first.body.chartId, renamed.body.chartId);
  assert.notEqual(first.body.reportId, renamed.body.reportId);
});

test("имя передаётся отдельно от неизменяемых расчётных данных", async () => {
  const provider = { model: "test", async generate(context) {
    assert.equal(context.presentation.displayName, "Эдуард");
    assert.equal(Object.prototype.hasOwnProperty.call(context.calculationData, "displayName"), false);
    assert.equal(Object.isFrozen(context.presentation), true);
    return createMockReport(context);
  } };
  const result = await generateReportRequest({ ...input, name: "Эдуард" }, { provider, reportYears: [2026, 2027, 2028] });
  assert.equal(result.status, 200);
});

test("без API-ключа технический расчёт остаётся доступен, а AI имеет честный статус", async () => {
  const result = await generateReportRequest(input, { env: {} });
  assert.equal(result.status, 200);
  assert.equal(result.body.aiStatus, "unavailable");
  assert.match(result.body.message, /не подключена/);
  assert.equal(result.body.report, undefined);
});

test("невалидный ответ AI повторяется один раз и затем возвращает безопасную ошибку", async () => {
  let calls = 0;
  const provider = { model: "test", async generate() { calls += 1; return {}; } };
  const result = await generateReportRequest(input, { provider });
  assert.equal(calls, 2);
  assert.equal(result.status, 502);
  assert.equal(result.body.aiStatus, "error");
  assert.doesNotMatch(result.body.error, /at\s|\.cjs:/);
});

test("после первого невалидного ответа корректный повтор принимается", async () => {
  let calls = 0;
  const provider = {
    model: "test",
    async generate(context) {
      calls += 1;
      return calls === 1 ? {} : createMockReport(context);
    },
  };
  const result = await generateReportRequest(input, { provider });
  assert.equal(calls, 2);
  assert.equal(result.status, 200);
  assert.equal(result.body.aiStatus, "ready");
});

test("AI-контекст не может изменить канонический расчёт", async () => {
  let observedBefore;
  let observedAfter;
  const provider = {
    model: "hostile-test",
    async generate(context) {
      observedBefore = context.calculationData.bazi.siZhu.year.gan;
      context.calculationData.bazi.siZhu.year.gan = "X";
      context.chartView.bazi.pillars[0].gan = "X";
      observedAfter = context.calculationData.bazi.siZhu.year.gan;
      return createMockReport(context);
    },
  };
  const result = await generateReportRequest(input, { provider });
  assert.equal(observedBefore, "己");
  assert.equal(observedAfter, "己");
  assert.equal(result.internal.calculation.chart.bazi.siZhu.year.gan, "己");
  assert.equal(result.internal.context.chartView.bazi.pillars[0].gan, "己");
});

test("бесплатный режим не отправляет закрытые разделы в браузер", async () => {
  const result = await generateReportRequest(input, { env: { AI_MODE: "mock" }, hasFullReport: false });
  assert.equal(result.status, 200);
  assert.equal(result.body.hasFullReport, false);
  assert.equal(result.body.report.strengths.length, 3);
  assert.equal(result.body.report.challenges.length, 1);
  assert.equal(result.body.report.career, undefined);
  assert.equal(result.internal.report.career.length > 100, true);
});
