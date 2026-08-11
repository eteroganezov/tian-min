"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const local_chart_1 = require("../local-chart");
const DIZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
function pillars(chart) {
    return ['year', 'month', 'day', 'hour'].map(key => {
        const pillar = chart.bazi.siZhu[key];
        return pillar.gan + pillar.zhi;
    });
}
(0, node_test_1.default)('BaZi: обычная дата совпадает с контрольным примером проекта', () => {
    const chart = (0, local_chart_1.calculateLocalChart)({ date: '1979-05-04', time: '06:00', gender: 'male' });
    strict_1.default.deepEqual(pillars(chart), ['己未', '戊辰', '辛未', '辛卯']);
});
(0, node_test_1.default)('BaZi: 2000-03-01 подтверждён двумя API lunar-typescript', () => {
    // lunar-typescript 1.8.6: Lunar.getDayInGanZhi() === EightChar.getDay() === 戊午.
    const chart = (0, local_chart_1.calculateLocalChart)({ date: '2000-03-01', time: '12:00', gender: 'female' });
    strict_1.default.deepEqual(pillars(chart), ['庚辰', '戊寅', '戊午', '戊午']);
});
(0, node_test_1.default)('BaZi: день до и день китайского Нового года берутся из lunar-typescript', () => {
    const before = (0, local_chart_1.calculateLocalChart)({ date: '2000-02-04', time: '12:00', gender: 'male' });
    const after = (0, local_chart_1.calculateLocalChart)({ date: '2000-02-05', time: '12:00', gender: 'male' });
    strict_1.default.equal(before.bazi.siZhu.year.gan + before.bazi.siZhu.year.zhi, '己卯');
    strict_1.default.equal(after.bazi.siZhu.year.gan + after.bazi.siZhu.year.zhi, '庚辰');
});
(0, node_test_1.default)('BaZi: поздний 子 час в 23:00 использует столп следующего дня', () => {
    const before = (0, local_chart_1.calculateLocalChart)({ date: '2000-03-01', time: '22:59', gender: 'male' });
    const lateZi = (0, local_chart_1.calculateLocalChart)({ date: '2000-03-01', time: '23:00', gender: 'male' });
    const midnight = (0, local_chart_1.calculateLocalChart)({ date: '2000-03-02', time: '00:00', gender: 'male' });
    strict_1.default.equal(before.bazi.siZhu.day.gan + before.bazi.siZhu.day.zhi, '戊午');
    strict_1.default.equal(lateZi.bazi.siZhu.day.gan + lateZi.bazi.siZhu.day.zhi, '己未');
    strict_1.default.deepEqual(lateZi.bazi.siZhu.day, midnight.bazi.siZhu.day);
    strict_1.default.deepEqual(lateZi.bazi.siZhu.hour, midnight.bazi.siZhu.hour);
});
(0, node_test_1.default)('BaZi: месяц переключается после точного момента 立春, а не в 00:00', () => {
    // lunar-typescript 1.8.6 даёт 立春 2024-02-04 16:27:07.
    const before = (0, local_chart_1.calculateLocalChart)({ date: '2024-02-04', time: '16:26', gender: 'male' });
    const after = (0, local_chart_1.calculateLocalChart)({ date: '2024-02-04', time: '16:28', gender: 'male' });
    strict_1.default.equal(before.bazi.siZhu.month.gan + before.bazi.siZhu.month.zhi, '乙丑');
    strict_1.default.equal(after.bazi.siZhu.month.gan + after.bazi.siZhu.month.zhi, '丙寅');
});
(0, node_test_1.default)('BaZi: месяц переключается после точного момента 惊蛰', () => {
    // lunar-typescript 1.8.6 даёт 惊蛰 2024-03-05 10:22:45.
    const before = (0, local_chart_1.calculateLocalChart)({ date: '2024-03-05', time: '10:22', gender: 'female' });
    const after = (0, local_chart_1.calculateLocalChart)({ date: '2024-03-05', time: '10:23', gender: 'female' });
    strict_1.default.equal(before.bazi.siZhu.month.gan + before.bazi.siZhu.month.zhi, '丙寅');
    strict_1.default.equal(after.bazi.siZhu.month.gan + after.bazi.siZhu.month.zhi, '丁卯');
});
(0, node_test_1.default)('Zi Wei: до китайского Нового года используется ствол китайского года', () => {
    const before = (0, local_chart_1.calculateLocalChart)({ date: '2000-02-04', time: '12:00', gender: 'male' }).ziwei;
    const after = (0, local_chart_1.calculateLocalChart)({ date: '2000-02-05', time: '12:00', gender: 'male' }).ziwei;
    strict_1.default.equal(before.siZhu?.year.gan + before.siZhu?.year.zhi, '己卯');
    strict_1.default.equal(before.yinYang, '阴男');
    strict_1.default.equal(after.siZhu?.year.gan + after.siZhu?.year.zhi, '庚辰');
    strict_1.default.equal(after.yinYang, '阳男');
});
(0, node_test_1.default)('Zi Wei: та же граница корректна для женщины в 2024 году', () => {
    const before = (0, local_chart_1.calculateLocalChart)({ date: '2024-02-09', time: '12:00', gender: 'female' }).ziwei;
    const after = (0, local_chart_1.calculateLocalChart)({ date: '2024-02-10', time: '12:00', gender: 'female' }).ziwei;
    strict_1.default.equal(before.siZhu?.year.gan, '癸');
    strict_1.default.equal(before.yinYang, '阴女');
    strict_1.default.equal(after.siZhu?.year.gan, '甲');
    strict_1.default.equal(after.yinYang, '阳女');
});
(0, node_test_1.default)('Zi Wei: направление 大限 меняется вместе с 阴男/阳男', () => {
    const yinMale = (0, local_chart_1.calculateLocalChart)({ date: '2000-02-04', time: '12:00', gender: 'male' }).ziwei;
    const yangMale = (0, local_chart_1.calculateLocalChart)({ date: '2000-02-05', time: '12:00', gender: 'male' }).ziwei;
    strict_1.default.equal(yinMale.gongs[1].daXian?.startAge, 15);
    strict_1.default.equal(yangMale.gongs[11].daXian?.startAge, 12);
});
(0, node_test_1.default)('Zi Wei: структурные инварианты полной карты', () => {
    const ziwei = (0, local_chart_1.calculateLocalChart)({ date: '1990-05-15', time: '14:30', gender: 'female' }).ziwei;
    strict_1.default.equal(ziwei.gongs.length, 12);
    strict_1.default.equal(new Set(ziwei.gongs.map(gong => gong.dizhi)).size, 12);
    const mainStars = ziwei.gongs.flatMap(gong => gong.mainStars);
    strict_1.default.equal(mainStars.length, 14);
    strict_1.default.equal(new Set(mainStars).size, 14);
    const transformations = ziwei.gongs.flatMap(gong => gong.sihua);
    strict_1.default.equal(transformations.length, 4);
    strict_1.default.ok(DIZHI.includes(DIZHI[ziwei.shenGongIndex]));
});
(0, node_test_1.default)('общий встроенный набор алгоритмов проходит без ошибок', async () => {
    const { formatChartResult, runAllTests } = await Promise.resolve().then(() => __importStar(require('../yiqi-core/index')));
    const result = runAllTests();
    strict_1.default.equal(result.summary.success, true);
    strict_1.default.equal(result.summary.totalPassed, 7);
    strict_1.default.equal(result.summary.totalFailed, 0);
    const sample = (0, local_chart_1.calculateLocalChart)({ date: '2000-01-01', time: '12:00', gender: 'male' });
    strict_1.default.match(formatChartResult(sample), /身宫: 午宫/);
});
