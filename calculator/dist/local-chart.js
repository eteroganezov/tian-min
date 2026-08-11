"use strict";
// Внутренний интерфейс сайта к существующему deterministic engine.
// Legacy-метод ниже сохранён; новый адаптер принимает уже нормализованное TRUE_SOLAR_TIME_V1.
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateLocalChart = calculateLocalChart;
exports.calculateNormalizedSolarChart = calculateNormalizedSolarChart;
const index_1 = require("./yiqi-core/index");
function calculateLocalChart(input) {
    if (!input || typeof input !== 'object') {
        throw new Error('Некорректные данные рождения: входные данные отсутствуют');
    }
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.date);
    if (!dateMatch) {
        throw new Error('Некорректная дата: используйте формат YYYY-MM-DD');
    }
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(input.time);
    if (!timeMatch) {
        throw new Error('Некорректное время: используйте формат HH:MM');
    }
    return (0, index_1.createChart)({
        year: Number(dateMatch[1]),
        month: Number(dateMatch[2]),
        day: Number(dateMatch[3]),
        hour: Number(timeMatch[1]),
        minute: Number(timeMatch[2]),
        gender: input.gender,
        isLunar: false,
        // Служебное legacy-поле движка. Пересчёт часового пояса не выполняется.
        timeZone: 8
    });
}
function calculateNormalizedSolarChart(input, solarTermReference) {
    return (0, index_1.createChart)({ ...input, isLunar: false, timeZone: 8 }, { solarTermReference });
}
