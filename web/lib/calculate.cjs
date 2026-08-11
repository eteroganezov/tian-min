// Используем скомпилированный результат calculator/local-chart.ts; расчётная логика здесь не дублируется.
const { calculateLocalChart } = require("../../calculator/dist/local-chart.js");
const { toChartView } = require("./chart-view.cjs");

function calculateRequest(input) {
  if (!input || typeof input !== "object") return failure("Передайте дату, время и пол.");
  if (typeof input.date !== "string" || !input.date) return failure("Укажите дату рождения.");
  if (typeof input.time !== "string" || !input.time) return failure("Укажите время рождения.");
  if (input.gender !== "male" && input.gender !== "female") return failure("Выберите пол.");
  try {
    return { status: 200, body: { chart: toChartView(calculateLocalChart({ date: input.date, time: input.time, gender: input.gender })) } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Некорректные данные рождения.";
    return failure(message.replace(/^Некорректные данные рождения:\s*/, "") || "Некорректные данные рождения.");
  }
}

function failure(error) { return { status: 400, body: { error } }; }
module.exports = { calculateRequest };
