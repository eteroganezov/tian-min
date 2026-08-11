"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const local_chart_1 = require("../local-chart");
const index_1 = require("../yiqi-core/index");
const validBirth = {
    year: 2000,
    month: 1,
    day: 1,
    hour: 12,
    minute: 0,
    gender: 'male',
    isLunar: false,
    timeZone: 8
};
(0, node_test_1.default)('принимает существующую високосную дату', () => {
    strict_1.default.equal((0, index_1.validateBirthInfo)({ ...validBirth, year: 2000, month: 2, day: 29 }).valid, true);
});
(0, node_test_1.default)('отклоняет несуществующую григорианскую дату', () => {
    strict_1.default.throws(() => (0, index_1.createChart)({ ...validBirth, month: 2, day: 30 }), /даты не существует/);
});
(0, node_test_1.default)('отклоняет час за пределами 0-23', () => {
    strict_1.default.throws(() => (0, index_1.createChart)({ ...validBirth, hour: 24 }), /час должен быть/);
});
(0, node_test_1.default)('отклоняет минуты за пределами 0-59', () => {
    strict_1.default.throws(() => (0, index_1.createChart)({ ...validBirth, minute: 60 }), /минуты должны быть/);
});
(0, node_test_1.default)('отклоняет неизвестный пол вместо молчаливой подмены на female', () => {
    strict_1.default.throws(() => (0, index_1.createChart)({ ...validBirth, gender: 'unknown' }), /пол должен быть/);
});
(0, node_test_1.default)('явно запрещает пока не поддерживаемую лунную дату', () => {
    strict_1.default.throws(() => (0, index_1.createChart)({ ...validBirth, isLunar: true }), /лунной даты не поддерживается/);
});
(0, node_test_1.default)('явно запрещает попытку включить пересчёт часового пояса', () => {
    strict_1.default.throws(() => (0, index_1.createChart)({ ...validBirth, timeZone: 3 }), /часового пояса не поддерживается/);
});
(0, node_test_1.default)('внутренний интерфейс требует строгие форматы YYYY-MM-DD и HH:MM', () => {
    strict_1.default.throws(() => (0, local_chart_1.calculateLocalChart)({ date: '2000-1-1', time: '12:00', gender: 'male' }), /формат YYYY-MM-DD/);
    strict_1.default.throws(() => (0, local_chart_1.calculateLocalChart)({ date: '2000-01-01', time: '7:30', gender: 'male' }), /формат HH:MM/);
});
(0, node_test_1.default)('внутренний интерфейс возвращает полную BaZi + Zi Wei карту', () => {
    const chart = (0, local_chart_1.calculateLocalChart)({ date: '2000-01-01', time: '12:00', gender: 'male' });
    strict_1.default.equal(chart.bazi.enrichment.格局.primary, '正财格');
    strict_1.default.equal(chart.bazi.cangGan.day[0].gan, '丁');
    strict_1.default.equal(chart.bazi.dayun[0].endAge, chart.bazi.dayun[0].startAge + 9);
    strict_1.default.equal(chart.ziwei.gongs.length, 12);
});
