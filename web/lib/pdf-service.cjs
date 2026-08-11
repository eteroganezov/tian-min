const { calculateBirthChart } = require("./birth-chart-pipeline.cjs");
const { toChartView } = require("./chart-view.cjs");
const { createReportPdf } = require("./pdf-template.cjs");
const { validatePersonalReport } = require("./report-schema.cjs");
const { hasFullReport } = require("./report-service.cjs");
const { canonicalBirthInput, normalizeDisplayName } = require("./personalization.cjs");

async function createPdfRequest(input, options = {}) {
  let calculation;
  let displayName;
  try {
    displayName = normalizeDisplayName(input?.name);
    calculation = calculateBirthChart(canonicalBirthInput(input));
  }
  catch (error) { return { status: 400, error: safeMessage(error) }; }
  let report = input.report || null;
  if (report) {
    const validation = validatePersonalReport(report);
    if (!validation.valid) return { status: 400, error: "Структура персонального отчёта некорректна." };
  }
  const full = options.hasFullReport ?? hasFullReport(options.env);
  const buffer = await createReportPdf({ chart: toChartView(calculation.chart), metadata: calculation.metadata, presentation: { displayName }, report, hasFullReport: full });
  return { status: 200, buffer, filename: `tian-ming-report-${calculation.metadata.originalBirthDate}.pdf` };
}

function safeMessage(error) {
  const message = error instanceof Error ? error.message : "Некорректные данные рождения.";
  return message.replace(/^(Некорректные данные рождения|排盘计算失败):\s*/, "") || "Некорректные данные рождения.";
}

module.exports = { createPdfRequest };
