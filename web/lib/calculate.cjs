// Новый слой только нормализует место и время; само астрологическое ядро не дублируется.
const { calculateBirthChart } = require("./birth-chart-pipeline.cjs");
const { toChartView } = require("./chart-view.cjs");
const { CivilTimeError } = require("./civil-time.cjs");
const { canonicalBirthInput, normalizeDisplayName } = require("./personalization.cjs");

function calculateRequest(input) {
  if (!input || typeof input !== "object") return failure("Передайте данные рождения.");
  if (typeof input.date !== "string" || !input.date) return failure("Укажите дату рождения.");
  if (typeof input.time !== "string" || !input.time) return failure("Укажите время рождения.");
  if (input.gender !== "male" && input.gender !== "female") return failure("Выберите пол.");
  if (typeof input.placeId !== "string" || !input.placeId) return failure("Выберите место рождения из списка подсказок.");
  try {
    const displayName = normalizeDisplayName(input.name);
    const result = calculateBirthChart(canonicalBirthInput(input));
    return { status: 200, body: { chart: toChartView(result.chart), metadata: result.metadata, presentation: { displayName }, ...(input.audit === true && process.env.NODE_ENV !== "production" ? { auditTrail: result.auditTrail } : {}) } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Некорректные данные рождения.";
    const body = { error: message.replace(/^(Некорректные данные рождения|排盘计算失败):\s*/, "") || "Некорректные данные рождения." };
    if (error instanceof CivilTimeError && error.code === "AMBIGUOUS_LOCAL_TIME") return { status: 409, body: { ...body, code: error.code, ...error.details } };
    if (error && error.code) body.code = error.code;
    return { status: 400, body };
  }
}

function failure(error) { return { status: 400, body: { error } }; }
module.exports = { calculateRequest };
