const { calculateBirthChart } = require("./birth-chart-pipeline.cjs");
const { toChartView } = require("./chart-view.cjs");
const { createReportProvider } = require("./report-provider.cjs");
const { validatePersonalReport } = require("./report-schema.cjs");

function buildReportContext(calculation) {
  const context = {
    calculationMethod: calculation.metadata.calculationMethod,
    sensitivity: { level: calculation.metadata.calculationSensitivity, flags: calculation.metadata.sensitivityFlags },
    birth: {
      date: calculation.metadata.originalBirthDate,
      time: calculation.metadata.originalBirthTime,
      place: calculation.metadata.birthPlace,
      trueSolarDate: calculation.metadata.trueSolarDate,
      trueSolarTime: calculation.metadata.trueSolarTime,
    },
    chartView: structuredClone(toChartView(calculation.chart)),
    calculationData: structuredClone({
      bazi: calculation.chart.bazi,
      ziwei: calculation.chart.ziwei,
    }),
    reportYears: [new Date().getUTCFullYear(), new Date().getUTCFullYear() + 1, new Date().getUTCFullYear() + 2],
  };
  return deepFreeze(context);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function hasFullReport(env = process.env) {
  return env.HAS_FULL_REPORT !== "false";
}

function createPreview(report) {
  return {
    archetype: report.archetype,
    subtitle: report.subtitle,
    oneLineFormula: report.oneLineFormula,
    executiveSummary: report.executiveSummary.slice(0, 1100),
    strengths: report.strengths.slice(0, 3),
    challenges: report.challenges.slice(0, 1),
  };
}

async function generateReportRequest(input, options = {}) {
  let calculation;
  try { calculation = calculateBirthChart(input); }
  catch (error) { return { status: 400, body: { error: safeMessage(error) } }; }
  const context = buildReportContext(calculation);
  const provider = options.provider || createReportProvider(options.env || process.env);
  let report;
  let validation;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      report = await provider.generate(context, attempt ? validation.errors.slice(0, 4).join("; ") : undefined);
    } catch (error) {
      if (error && error.code === "AI_NOT_CONFIGURED") {
        return { status: 200, body: { aiStatus: "unavailable", message: "Персональная интерпретация пока не подключена", hasFullReport: hasFullReport(options.env) } };
      }
      if (attempt === 1) return { status: 502, body: { aiStatus: "error", error: "Не удалось подготовить персональный разбор. Техническая карта остаётся доступна." } };
      validation = { errors: ["провайдер вернул техническую ошибку"] };
      continue;
    }
    validation = validatePersonalReport(report);
    if (validation.valid) break;
  }
  if (!validation || !validation.valid) return { status: 502, body: { aiStatus: "error", error: "Не удалось проверить персональный разбор. Техническая карта остаётся доступна." } };
  const full = options.hasFullReport ?? hasFullReport(options.env);
  return {
    status: 200,
    body: {
      aiStatus: "ready", hasFullReport: full,
      report: full ? report : createPreview(report),
      model: provider.model || "mock",
    },
    internal: { report, calculation, context },
  };
}

function safeMessage(error) {
  const message = error instanceof Error ? error.message : "Некорректные данные рождения.";
  return message.replace(/^(Некорректные данные рождения|排盘计算失败):\s*/, "") || "Некорректные данные рождения.";
}

module.exports = { buildReportContext, createPreview, generateReportRequest, hasFullReport };
