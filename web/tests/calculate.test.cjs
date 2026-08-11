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

test("ошибка пользователя не содержит stack trace", () => {
  const result = calculateRequest({ date: "2000-02-30", time: "12:00", gender: "male", placeId: moscow.id });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /даты или времени не существует/);
  assert.doesNotMatch(result.body.error, /at\s|\.ts:/);
});

test("production build содержит форму и необходимые пояснения", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "..", "dist", "index.html"), "utf8");
  assert.match(html, /Рассчитать мою карту/);
  assert.match(html, /местную григорианскую дату/);
  assert.match(html, /Место рождения/);
  assert.match(html, /истинное солнечное время/);
  assert.match(html, /информационных и развлекательных целей/);
});
