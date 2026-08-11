const test = require("node:test");
const assert = require("node:assert/strict");
const { locationProvider } = require("../lib/location-provider.cjs");
const { createMockReport } = require("../lib/mock-report.cjs");
const { validatePersonalReport } = require("../lib/report-schema.cjs");
const { generateReportRequest } = require("../lib/report-service.cjs");
const { OpenAIReportProvider } = require("../lib/report-provider.cjs");
const { buildEvidenceCatalog, localizeReportText, russianTypography, sanitizePersonalReport } = require("../lib/report-content.cjs");
const { calculateBirthChart } = require("../lib/birth-chart-pipeline.cjs");
const { toChartView } = require("../lib/chart-view.cjs");

const moscow = locationProvider.search("Москва")[0];
const input = { date: "2000-01-01", time: "12:00", gender: "male", placeId: moscow.id };

test("OpenAI provider использует Responses API и строгий Structured Output", async () => {
  let request;
  const client = { responses: { async create(value) { request = value; return { output_text: "{\"ok\":true}" }; } } };
  const provider = new OpenAIReportProvider({ client, model: "gpt-test" });
  assert.deepEqual(await provider.generate({ diagnostic: true }), { ok: true });
  assert.equal(request.model, "gpt-test");
  assert.equal(request.store, false);
  assert.equal(request.reasoning.effort, "low");
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.schema.type, "object");
  assert.equal(request.text.format.schema.additionalProperties, false);
});

test("структурированный персональный отчёт проходит строгую схему", async () => {
  const result = await generateReportRequest({ ...input, name: "  Эдуард  " }, { env: { AI_MODE: "mock" }, reportYears: [2026, 2027, 2028] });
  assert.equal(result.status, 200);
  assert.equal(result.body.aiStatus, "ready");
  assert.equal(validatePersonalReport(result.body.report).valid, true);
  assert.equal(result.body.report.keyTraits.length, 5);
  assert.equal(result.body.report.lifeAreaMatrix.length, 8);
  assert.equal(result.body.presentation.displayName, "Эдуард");
  assert.match(result.body.report.executivePortrait.summary, /^Эдуард,/);
  assert.equal(result.body.report.executivePortrait.currentFocus.length > 20, true);
  assert.equal(result.body.report.career.insights.length, 3);
  assert.deepEqual(Object.keys(result.body.report.career), ["title", "headline", "summary", "insights", "strengths", "risks", "actions", "evidence", "confidenceNote"]);
  assert.deepEqual(Object.keys(result.body.report.conclusionStability), ["wellSupported", "needsContext", "notLiteral"]);
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

test("без API-ключа карта остаётся доступна, а персональный разбор имеет честный статус", async () => {
  const result = await generateReportRequest(input, { env: {} });
  assert.equal(result.status, 200);
  assert.equal(result.body.aiStatus, "unavailable");
  assert.equal(result.body.message, "Персональный разбор ещё не создан");
  assert.equal(result.body.report, undefined);
});

test("ошибка исчерпанного баланса логируется безопасно и не повторяет бесполезный запрос", async () => {
  let calls = 0;
  const lines = [];
  const originalConsoleError = console.error;
  console.error = line => lines.push(String(line));
  try {
    const provider = {
      model: "gpt-test",
      async generate() {
        calls += 1;
        throw Object.assign(new Error("Сообщение провайдера не должно попасть в лог"), {
          status: 429,
          code: "credit_balance_exhausted",
          type: "insufficient_quota",
          aiStage: "responses.create",
        });
      },
    };
    const result = await generateReportRequest({ ...input, name: "Эдуард" }, { provider });
    assert.equal(calls, 1);
    assert.equal(result.status, 502);
    assert.equal(result.body.aiStatus, "error");
  } finally {
    console.error = originalConsoleError;
  }
  const aiLines = lines.filter(line => line.startsWith("[AI_ERROR] "));
  assert.equal(aiLines.length, 1);
  const entry = JSON.parse(aiLines[0].replace(/^\[AI_ERROR\] /, ""));
  assert.deepEqual(entry, {
    stage: "responses.create",
    status: 429,
    code: "credit_balance_exhausted",
    type: "insufficient_quota",
    message: "OpenAI API credits are exhausted.",
    model: "gpt-test",
    attempt: 1,
  });
  assert.doesNotMatch(aiLines[0], /Эдуард|2000-01-01|Сообщение провайдера/);
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
  assert.equal(result.internal.report.career.summary.length > 100, true);
});

test("центральная локализация не выпускает английские названия систем", () => {
  assert.equal(localizeReportText("BaZi + Zi Wei Dou Shu, Bazi и ZiWei"), "Ба-цзы + Цзы Вэй Доу Шу, Ба-цзы и Цзы Вэй");
});

test("русская типографика не оставляет короткие предлоги в конце строки", () => {
  assert.equal(russianTypography("с опорой на опыт и ясность"), "с\u00a0опорой на\u00a0опыт и\u00a0ясность");
});

test("очистка удаляет пустые основания и локализует остальной отчёт", () => {
  const periods = Array.from({ length: 5 }, (_, index) => ({ range: `${index * 10 + 1}–${index * 10 + 10} лет`, ganZhi: "甲子", years: `${2020 + index * 10}–${2029 + index * 10}` }));
  const report = createMockReport({ chartView: { bazi: { dayMaster: "丁", structure: "正官格", majorPeriods: periods }, ziwei: { mingPalace: "子" } }, sensitivity: { level: "LOW" }, evidenceCatalog: { bazi: [], ziwei: [] } });
  report.career.evidence = ["BaZi: столкновение -.", "undefined", "Zi Wei: дворец судьбы 子."];
  const cleaned = sanitizePersonalReport(report);
  assert.deepEqual(cleaned.career.evidence, ["Цзы Вэй: дворец судьбы 子."]);
  assert.equal(validatePersonalReport(cleaned).valid, true);
  const userText = [];
  JSON.stringify(cleaned, (_key, value) => { if (typeof value === "string") userText.push(value); return value; });
  assert.doesNotMatch(userText.join("\n"), /\b(?:BaZi|Bazi|Zi\s*Wei|ZiWei|undefined|null|NaN)\b/i);
});

test("регрессия Эдуарда: реальные связи становятся полными основаниями без прочерков", () => {
  const reference = { date: "1995-09-03", time: "05:50", gender: "male", placeId: moscow.id };
  const calculation = calculateBirthChart(reference);
  const catalog = buildEvidenceCatalog(calculation, toChartView(calculation.chart));
  const text = catalog.bazi.join("\n");
  const normalized = text.replace(/\u00a0/g, " ");
  assert.match(normalized, /соединение небесных стволов Дин \(丁\) и Жэнь \(壬\)/);
  assert.match(normalized, /столкновение земных ветвей Шэнь \(申\) и Инь \(寅\)/);
  assert.match(normalized, /сочетание земных ветвей Хай \(亥\) и Инь \(寅\)/);
  assert.match(normalized, /вред земных ветвей Хай \(亥\) и Шэнь \(申\)/);
  assert.doesNotMatch(text, /(?:^|\s)[-–—](?:[\s.,;]|$)|undefined|null|NaN/);
});
