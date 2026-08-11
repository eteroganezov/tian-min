const test = require("node:test");
const assert = require("node:assert/strict");
const { locationProvider } = require("../lib/location-provider.cjs");
const { calculateRequest } = require("../lib/calculate.cjs");

function place(query) {
  const result = locationProvider.search(query)[0];
  assert.ok(result, `Не найден тестовый город: ${query}`);
  return result;
}

test("русский запрос города возвращает проверяемое место, а поддельный id отклоняется", () => {
  const moscow = place("Москва");
  assert.equal(moscow.timeZone, "Europe/Moscow");
  assert.equal(moscow.display.label, "Москва, Россия");
  assert.match(moscow.label, /^Moscow,/);
  assert.equal(locationProvider.resolve(moscow.id).longitude, 37.61552283);
  assert.equal(locationProvider.resolve(Buffer.from("fake|place").toString("base64url")), null);
});

test("русская подпись места не меняет канонические координаты, id и часовой пояс", () => {
  for (const [query, expected] of [["Москва", "Москва, Россия"], ["Санкт-Петербург", "Санкт-Петербург, Россия"], ["Алматы", "Алматы, Казахстан"], ["London United Kingdom", "Лондон, Великобритания"], ["New York New York", "Нью-Йорк, Соединенные Штаты"]]) {
    const selected = place(query);
    const resolved = locationProvider.resolve(selected.id);
    assert.equal(selected.display.label, expected, query);
    assert.equal(resolved.id, selected.id, query);
    assert.equal(resolved.latitude, selected.latitude, query);
    assert.equal(resolved.longitude, selected.longitude, query);
    assert.equal(resolved.timeZone, selected.timeZone, query);
  }
});

test("неизвестный словарю город сохраняет каноническое имя и переводит страну", () => {
  const urumqi = place("Urumqi China");
  assert.equal(urumqi.display.city, urumqi.city);
  assert.equal(urumqi.display.country, "Китай");
  assert.equal(urumqi.display.isCityLocalized, false);
});

test("сквозная цепочка работает для городов разных зон, включая крайнее положение внутри зоны", () => {
  for (const query of ["Москва", "London United Kingdom", "New York New York", "Beijing China", "Vladivostok", "Urumqi China"]) {
    const selected = place(query);
    const result = calculateRequest({ date: "1990-05-15", time: "14:30", gender: "female", placeId: selected.id });
    assert.equal(result.status, 200, query);
    assert.equal(result.body.metadata.ianaTimeZone, selected.timeZone);
    assert.equal(result.body.chart.ziwei.palaces.length, 12);
    assert.equal(result.body.chart.bazi.pillars.length, 4);
  }
});

test("полночь, граница китайского двухчасового часа и historical DST проходят всю цепочку", () => {
  const moscow = place("Москва");
  for (const time of ["00:05", "00:59", "01:00", "22:59", "23:00"]) {
    const result = calculateRequest({ date: "1995-07-01", time, gender: "male", placeId: moscow.id });
    assert.equal(result.status, 200, time);
    assert.equal(result.body.metadata.dstApplied, true);
    assert.equal(result.body.metadata.historicalUtcOffset, 240);
    assert.equal(result.body.metadata.standardUtcOffset, 180);
    assert.match(result.body.metadata.absoluteBirthInstantUtc, /Z$/);
    assert.equal(result.body.metadata.trueSolarDate.length, 10);
    assert.equal(result.body.metadata.trueSolarTime.length, 5);
  }
});

test("случай около 23:00 сохраняет аудит изменений столпов", () => {
  const result = calculateRequest({ date: "2000-01-01", time: "23:05", gender: "male", placeId: place("Москва").id, audit: true });
  assert.equal(result.status, 200);
  assert.equal(result.body.auditTrail.input.time, "23:05");
  assert.equal(typeof result.body.metadata.sensitivityFlags.ChangedDayPillar, "boolean");
  assert.equal(typeof result.body.metadata.sensitivityFlags.ChangedHourPillar, "boolean");
});

test("даты около китайского Нового года, 立春 и 惊蛰 проходят через абсолютный контроль 节气", () => {
  const beijing = place("Beijing China");
  for (const [date, time] of [["2024-02-09", "23:50"], ["2024-02-10", "00:10"], ["2024-02-04", "16:20"], ["2024-03-05", "10:20"]]) {
    const result = calculateRequest({ date, time, gender: "male", placeId: beijing.id });
    assert.equal(result.status, 200, `${date} ${time}`);
    assert.equal(result.body.metadata.solarTermComparisonMethod, "ABSOLUTE_INSTANT_COMPARED_IN_UTC_PLUS_8");
  }
});

test.skip("точные астрологические эталоны для TRUE_SOLAR_TIME_V1 требуют внешней верификации специалистом", () => {});
