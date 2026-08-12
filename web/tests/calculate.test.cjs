const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { calculateRequest } = require("../lib/calculate.cjs");
const { locationProvider } = require("../lib/location-provider.cjs");

const moscow = locationProvider.search("Москва")[0];

test("web-слой требует дату, время и пол", () => {
  assert.equal(calculateRequest({}).body.error, "Укажите дату рождения.");
  assert.equal(calculateRequest({ date: "2000-01-01" }).body.error, "Укажите время рождения.");
  assert.equal(calculateRequest({ date: "2000-01-01", time: "12:00" }).body.error, "Выберите пол.");
  assert.equal(calculateRequest({ date: "2000-01-01", time: "12:00", gender: "male" }).body.error, "Выберите место рождения из списка подсказок.");
});

test("web-слой возвращает настоящий результат существующего ядра", () => {
  const result = calculateRequest({ date: "2000-01-01", time: "12:00", gender: "male", placeId: moscow.id });
  assert.equal(result.status, 200);
  const chart = result.body.chart;
  assert.deepEqual(chart.bazi.pillars.map(pillar => pillar.gan + pillar.zhi), ["己卯", "丙子", "戊午", "戊午"]);
  assert.equal(chart.bazi.dayMaster, "戊");
  assert.equal(chart.bazi.structure, "正财格");
  assert.equal(chart.ziwei.yinYang, "阴男");
  assert.equal(chart.ziwei.palaces.length, 12);
  assert.equal(chart.ziwei.transformations.length, 4);
  assert.equal(result.body.metadata.ianaTimeZone, "Europe/Moscow");
  assert.equal(result.body.metadata.calculationMethod, "TRUE_SOLAR_TIME_V1");
});

test("имя поддерживает кириллицу, латиницу и остаётся необязательным", () => {
  const base = { date: "2000-01-01", time: "12:00", gender: "male", placeId: moscow.id };
  assert.equal(calculateRequest({ ...base, name: "  Эдуард  " }).body.presentation.displayName, "Эдуард");
  assert.equal(calculateRequest({ ...base, name: "Edward Stone" }).body.presentation.displayName, "Edward Stone");
  assert.equal(calculateRequest(base).body.presentation.displayName, "");
});

test("опасная разметка и слишком длинное имя отклоняются понятной ошибкой", () => {
  const base = { date: "2000-01-01", time: "12:00", gender: "male", placeId: moscow.id };
  assert.match(calculateRequest({ ...base, name: "<script>alert(1)</script>" }).body.error, /В имени можно использовать/);
  assert.match(calculateRequest({ ...base, name: "А".repeat(61) }).body.error, /не длиннее 60/);
});

test("изменение имени не меняет карту, солнечное время и периоды", () => {
  const base = { date: "2000-01-01", time: "12:00", gender: "male", placeId: moscow.id };
  const first = calculateRequest({ ...base, name: "Эдуард" }).body;
  const second = calculateRequest({ ...base, name: "Edward" }).body;
  assert.deepEqual(first.chart, second.chart);
  assert.equal(first.metadata.trueSolarDateTime, second.metadata.trueSolarDateTime);
  assert.deepEqual(first.chart.bazi.majorPeriods, second.chart.bazi.majorPeriods);
  assert.deepEqual(first.chart.ziwei.majorPeriods, second.chart.ziwei.majorPeriods);
});

test("ошибка пользователя не содержит stack trace", () => {
  const result = calculateRequest({ date: "2000-02-30", time: "12:00", gender: "male", placeId: moscow.id });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /даты или времени не существует/);
  assert.doesNotMatch(result.body.error, /at\s|\.ts:/);
});

test("production build содержит бесплатную воронку и нормализованную терминологию", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "..", "dist", "index.html"), "utf8");
  const script = fs.readFileSync(path.resolve(__dirname, "..", "dist", "app.js"), "utf8");
  const styles = fs.readFileSync(path.resolve(__dirname, "..", "dist", "styles.css"), "utf8");
  assert.match(html, /Рассчитать мою карту/);
  assert.match(html, /Базовая карта — без оплаты/);
  assert.match(html, /Полный персональный разбор доступен отдельно/);
  assert.doesNotMatch(html, /Рассчитать мою карту бесплатно|Без оплаты · результат сразу после расчёта/);
  assert.match(html, /name="name"/);
  assert.match(html, /Ба-цзы/);
  assert.match(html, /Цзы Вэй Доу Шу/);
  assert.match(html, /Место рождения/);
  assert.match(html, /информационных, культурных и развлекательных целей/);
  assert.match(html, /Персональная карта личности и жизненного пути/);
  assert.match(html, /Как это работает/);
  assert.match(html, /Что вы узнаете/);
  assert.match(html, /Введите имя/);
  assert.doesNotMatch(html, /placeholder="Эдуард"/);
  assert.match(script, /Четыре столпа/);
  assert.match(script, /Дневной хозяин/);
  assert.match(script, /Пять элементов/);
  assert.match(script, /Ваша карта Цзы Вэй/);
  assert.match(script, /Текущий большой период/);
  assert.match(script, /Получить полный персональный разбор/);
  assert.match(script, /Полный разбор скоро будет доступен/);
  assert.match(script, /Посмотреть полную карту 12 дворцов/);
  assert.match(script, /Скрыть полную карту 12 дворцов/);
  assert.match(script, /Все жизненные сферы и рассчитанные звёзды/);
  assert.match(script, /Ключевые параметры карты Цзы Вэй/);
  assert.match(script, /Четыре трансформации показывают/);
  assert.match(script, /Находится во дворце/);
  assert.doesNotMatch(script, /◇|Посмотреть подробные данные карты/);
  assert.doesNotMatch(script, /padStart\(2, "0"\)/);
  assert.doesNotMatch(html, /<article><b>0[1-8]<\/b><h3>/);
  assert.doesNotMatch(script, /\/api\/report|\/api\/pdf|loadPersonalReport/);
  assert.equal((html.match(/Две традиции — один цельный портрет/g) || []).length, 2);
  assert.doesNotMatch(html, /Две системы[.,—]/);
  assert.doesNotMatch(html, /Понадобится меньше минуты/);
  assert.match(styles, /\.section-signature\{padding-top:0;border-top:0\}/);
  assert.match(styles, /\.transformations>div>p\{border-radius:8px\}/);
  assert.match(styles, /\.locked-grid article\{border:[^}]+border-radius:10px\}/);
});
