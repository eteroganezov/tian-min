const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveCivilTime } = require("../lib/civil-time.cjs");

test("New York: несуществующее время весеннего перевода часов отклоняется", () => {
  assert.throws(() => resolveCivilTime("2024-03-10", "02:30", "America/New_York"), error => error.code === "NONEXISTENT_LOCAL_TIME");
});

test("New York: повторяющееся осеннее время требует явного выбора", () => {
  assert.throws(() => resolveCivilTime("2024-11-03", "01:30", "America/New_York"), error => error.code === "AMBIGUOUS_LOCAL_TIME");
  const first = resolveCivilTime("2024-11-03", "01:30", "America/New_York", "first");
  const second = resolveCivilTime("2024-11-03", "01:30", "America/New_York", "second");
  assert.equal(first.utcInstant, "2024-11-03T05:30:00.000Z");
  assert.equal(second.utcInstant, "2024-11-03T06:30:00.000Z");
  assert.equal(first.historicalUtcOffsetMinutes, -240);
  assert.equal(second.historicalUtcOffsetMinutes, -300);
});

test("London: границы DST также распознаются", () => {
  assert.throws(() => resolveCivilTime("2024-03-31", "01:30", "Europe/London"), error => error.code === "NONEXISTENT_LOCAL_TIME");
  assert.throws(() => resolveCivilTime("2024-10-27", "01:30", "Europe/London"), error => error.code === "AMBIGUOUS_LOCAL_TIME");
});

test("исторические правила Moscow отделяют DST от стандартного смещения", () => {
  const summer1995 = resolveCivilTime("1995-07-01", "12:00", "Europe/Moscow");
  assert.equal(summer1995.historicalUtcOffsetMinutes, 240);
  assert.equal(summer1995.standardOffsetMinutes, 180);
  assert.equal(summer1995.dstApplied, true);
  const summer2012 = resolveCivilTime("2012-07-01", "12:00", "Europe/Moscow");
  assert.equal(summer2012.historicalUtcOffsetMinutes, 240);
  assert.equal(summer2012.standardOffsetMinutes, 240);
  assert.equal(summer2012.dstApplied, false);
});
