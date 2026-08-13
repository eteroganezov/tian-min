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

test("autocomplete ищет русские города по неполному запросу без учёта регистра", () => {
  for (const [query, expected] of [["моск", "Москва, Россия"], ["санкт", "Санкт-Петербург, Россия"], ["екат", "Екатеринбург, Россия"], ["ниж", "Нижний Новгород, Россия"], ["каз", "Казань, Россия"]]) {
    assert.equal(place(query).display.label, expected, query);
  }
  assert.equal(place("москва").id, place("МОСКВА").id);
  assert.equal(place("Москва").id, place("МОСКВА").id);
});

test("русская локализация остаётся display-слоем над canonical location data", () => {
  const selected = place("екат");
  assert.equal(selected.city, "Yekaterinburg");
  assert.equal(selected.display.city, "Екатеринбург");
  assert.equal(selected.display.country, "Россия");
  assert.equal(locationProvider.resolve(selected.id).timeZone, "Asia/Yekaterinburg");
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

test("русский и английский варианты ведут к одному canonical place", () => {
  for (const [russian, english, expectedDisplay] of [
    ["Ереван", "Yerevan", "Ереван, Армения"], ["Москва", "Moscow", "Москва, Россия"],
    ["Алматы", "Almaty", "Алматы, Казахстан"], ["Тбилиси", "Tbilisi", "Тбилиси, Грузия"],
    ["Пекин", "Beijing", "Пекин, Китай"],
  ]) {
    const localized = place(russian);
    const canonical = place(english);
    assert.equal(localized.id, canonical.id, russian);
    assert.equal(localized.sourceId, canonical.sourceId, russian);
    assert.equal(localized.canonicalName, canonical.canonicalName, russian);
    assert.equal(localized.latitude, canonical.latitude, russian);
    assert.equal(localized.longitude, canonical.longitude, russian);
    assert.equal(localized.timeZone, canonical.timeZone, russian);
    assert.equal(localized.display.label, expectedDisplay, russian);
    assert.equal(calculateRequest({ date: "1990-05-15", time: "14:30", gender: "female", placeId: localized.id }).status, 200, russian);
  }
  assert.equal(place("北京").id, place("Beijing").id);
});

test("Unicode, ё/е, регистр и обычная транслитерация нормализуются", () => {
  assert.equal(place("ЕРЕВАН").id, place("Yerevan").id);
  assert.equal(place("Йорк").id, place("йорк").id);
  assert.equal(place("Екатеринбург").id, place("ёкатеринбург").id);
  assert.equal(place("Тбилиси").id, place("Tbilisi").id);
});

test("ручной IANA override меняет только timezone выбранного места и сохраняет его координаты", () => {
  const yerevan = place("Ереван");
  const result = calculateRequest({ date: "1990-05-15", time: "14:30", gender: "female", placeId: yerevan.id, timeZoneOverride: "Europe/Moscow" });
  assert.equal(result.status, 200);
  assert.equal(result.body.metadata.ianaTimeZone, "Europe/Moscow");
  assert.equal(result.body.metadata.placeTimeZone, "Asia/Yerevan");
  assert.equal(result.body.metadata.timeZoneSource, "USER_OVERRIDE");
  assert.equal(result.body.metadata.longitude, yerevan.longitude);
  assert.equal(calculateRequest({ date: "1990-05-15", time: "14:30", gender: "female", placeId: yerevan.id, timeZoneOverride: "UTC+04:00" }).body.code, "INVALID_TIME_ZONE");
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
