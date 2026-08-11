const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateTrueSolarTime, equationOfTimeMinutes } = require("../lib/true-solar-time.cjs");

function civil(overrides = {}) {
  return { local: { year: 2024, month: 1, day: 15, hour: 12, minute: 0 }, utcMilliseconds: Date.UTC(2024, 0, 15, 12), standardOffsetMinutes: 0, dstOffsetMinutes: 0, ...overrides };
}

test("долготная поправка равна четырём минутам на градус", () => {
  const atMeridian = calculateTrueSolarTime(civil(), 0);
  const oneDegreeEast = calculateTrueSolarTime(civil(), 1);
  const oneDegreeWest = calculateTrueSolarTime(civil(), -1);
  assert.equal(atMeridian.longitudeCorrectionMinutes, 0);
  assert.equal(oneDegreeEast.longitudeCorrectionMinutes, 4);
  assert.equal(oneDegreeWest.longitudeCorrectionMinutes, -4);
});

test("Equation of Time совпадает с известными сезонными экстремумами NOAA в пределах аппроксимации V1", () => {
  assert.ok(Math.abs(equationOfTimeMinutes(Date.UTC(2024, 1, 11, 12)) - (-14.2)) < 0.25);
  assert.ok(Math.abs(equationOfTimeMinutes(Date.UTC(2024, 10, 3, 12)) - 16.4) < 0.25);
});

test("DST удаляется отдельно и не меняет стандартный меридиан", () => {
  const result = calculateTrueSolarTime(civil({ historicalUtcOffsetMinutes: 60, standardOffsetMinutes: 0, dstOffsetMinutes: 60 }), 0);
  assert.equal(result.standardMeridianLongitude, 0);
  assert.equal(result.dstRemovalMinutes, -60);
  assert.ok(Math.abs(result.totalCorrectionMinutes - (result.equationOfTimeMinutes - 60)) < 1e-9);
});

test("истинное солнечное время корректно переходит на предыдущую дату", () => {
  const result = calculateTrueSolarTime(civil({ local: { year: 2024, month: 1, day: 15, hour: 0, minute: 10 }, utcMilliseconds: Date.UTC(2024, 0, 14, 21, 10), standardOffsetMinutes: 180 }), 37.61552283);
  assert.equal(result.formatted.slice(0, 10), "2024-01-14");
  assert.equal(result.dateChanged, true);
});

test("истинное солнечное время корректно переходит на следующую дату", () => {
  const result = calculateTrueSolarTime(civil({ local: { year: 2024, month: 1, day: 15, hour: 23, minute: 30 }, utcMilliseconds: Date.UTC(2024, 0, 15, 23, 30), standardOffsetMinutes: 0 }), 15);
  assert.equal(result.formatted.slice(0, 10), "2024-01-16");
  assert.equal(result.dateChanged, true);
});
