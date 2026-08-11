const { calculateBirthChart } = require("./birth-chart-pipeline.cjs");
const { toChartView } = require("./chart-view.cjs");
const { createReportPdf } = require("./pdf-template.cjs");
const { validatePersonalReport } = require("./report-schema.cjs");
const { hasFullReport } = require("./report-service.cjs");
const { canonicalBirthInput, normalizeDisplayName } = require("./personalization.cjs");
const { locationProvider } = require("./location-provider.cjs");

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
  const place = locationProvider.resolve(input.placeId);
  const presentation = { displayName, birthPlace: place?.display || null };
  const buffer = await createReportPdf({ chart: toChartView(calculation.chart), metadata: calculation.metadata, presentation, report, hasFullReport: full });
  return { status: 200, buffer, filename: createPdfFilename({ displayName, date: calculation.metadata.originalBirthDate, time: calculation.metadata.originalBirthTime }) };
}

const transliteration = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"kh",ц:"ts",ч:"ch",ш:"sh",щ:"shch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya" };
function safeFilenamePart(value) {
  return String(value || "").normalize("NFKD").toLowerCase().split("").map(char => transliteration[char] ?? char).join("")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
function createPdfFilename({ displayName, date, time }) {
  const person = safeFilenamePart(displayName) || "report";
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? date : "date";
  const safeTime = /^\d{2}:\d{2}$/.test(String(time)) ? time.replace(":", "-") : "time";
  return `tian-min-${person}-${safeDate}-${safeTime}.pdf`;
}

function safeMessage(error) {
  const message = error instanceof Error ? error.message : "Некорректные данные рождения.";
  return message.replace(/^(Некорректные данные рождения|排盘计算失败):\s*/, "") || "Некорректные данные рождения.";
}

module.exports = { createPdfFilename, createPdfRequest, safeFilenamePart };
