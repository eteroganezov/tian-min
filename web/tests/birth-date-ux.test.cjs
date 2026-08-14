const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const script = fs.readFileSync(path.resolve(__dirname, "..", "public", "app.js"), "utf8");
const html = fs.readFileSync(path.resolve(__dirname, "..", "public", "index.html"), "utf8");
const styles = fs.readFileSync(path.resolve(__dirname, "..", "public", "styles.css"), "utf8");
const source = script.match(/function normalizeBirthDateParts\(dayValue, monthValue, yearValue, todayValue = new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\) \{[\s\S]*?\n\}/u)?.[0];
assert.ok(source);
const normalizeBirthDateParts = vm.runInNewContext(`(${source.replace(/^function normalizeBirthDateParts/, "function")})`);

test("day month year controls сохраняют canonical YYYY-MM-DD semantics", () => {
  assert.equal(normalizeBirthDateParts("1", "1", "1900", "2026-08-14").value, "1900-01-01");
  assert.equal(normalizeBirthDateParts("31", "01", "2000", "2026-08-14").value, "2000-01-31");
  assert.equal(normalizeBirthDateParts("30", "04", "2000", "2026-08-14").value, "2000-04-30");
  assert.equal(normalizeBirthDateParts("29", "02", "2000", "2026-08-14").value, "2000-02-29");
});

test("invalid combinations, non-leap February and future birth date fail clearly", () => {
  assert.match(normalizeBirthDateParts("31", "04", "2000", "2026-08-14").error, /Такой даты не существует/);
  assert.match(normalizeBirthDateParts("29", "02", "2001", "2026-08-14").error, /Такой даты не существует/);
  assert.match(normalizeBirthDateParts("15", "08", "2026", "2026-08-14").error, /не может быть в будущем/);
  assert.match(normalizeBirthDateParts("", "08", "1990", "2026-08-14").error, /день, месяц и год/);
});

test("supported year bounds remain explicit", () => {
  assert.equal(normalizeBirthDateParts("31", "12", "2100", "2100-12-31").value, "2100-12-31");
  assert.match(normalizeBirthDateParts("31", "12", "1899", "2026-08-14").error, /от 1900 до 2100/);
  assert.match(normalizeBirthDateParts("01", "01", "2101", "2101-01-01").error, /от 1900 до 2100/);
  assert.match(normalizeBirthDateParts("01", "01", "90", "2026-08-14").error, /четырьмя цифрами/);
});

test("date UI exposes explicit accessible day, month and year controls", () => {
  assert.match(html, /<fieldset class="field birth-date-field">\s*<legend>Дата рождения<\/legend>/);
  assert.match(html, /<span>День<\/span><input id="birth-day"[^>]*inputmode="numeric"[^>]*autocomplete="bday-day"/);
  assert.match(html, /<span>Месяц<\/span><select id="birth-month"[^>]*autocomplete="bday-month"/);
  assert.match(html, /<span>Год<\/span><input id="birth-year"[^>]*inputmode="numeric"[^>]*autocomplete="bday-year"/);
  assert.match(html, /id="birth-date" name="date" type="hidden"/);
  assert.match(html, /id="birth-date-desktop" type="date"[^>]*autocomplete="bday"/);
  assert.match(html, /ДД\.ММ\.ГГГГ/);
  assert.match(styles, /\.birth-date-parts input:focus,\.birth-date-parts select:focus/);
  assert.match(styles, /\.birth-date-field,\.birth-date-field\+\.field\{grid-column:1\/-1\}/);
  assert.match(styles, /@media\(min-width:960px\)[^]*\.birth-form \.birth-date-field,\.birth-form \.birth-date-field\+\.field\{grid-column:auto\}/);
  assert.match(styles, /@media\(min-width:960px\)[^]*\.birth-form \.birth-date-parts\{display:none\}/);
  assert.match(styles, /@media\(min-width:960px\)[^]*\.birth-form \.birth-date-native\{display:block/);
});

test("full DD.MM.YYYY paste distributes values and syncs canonical date", () => {
  assert.match(script, /match\(\/\^\(\\d\{1,2\}\)\[\.\\\/-\]\(\\d\{1,2\}\)\[\.\\\/-\]\(\\d\{4\}\)\$\/u\)/);
  assert.match(script, /birthDayInput\.value = match\[1\]\.padStart\(2, "0"\)/);
  assert.match(script, /birthMonthInput\.value = match\[2\]\.padStart\(2, "0"\)/);
  assert.match(script, /birthYearInput\.value = match\[3\]/);
  assert.match(script, /birthDateInput\.value = value/);
});

test("desktop native date and mobile parts synchronize one canonical date state", () => {
  const syncToDesktop = script.match(/function syncBirthDateValue\(\) \{[\s\S]*?\n\}/u)?.[0] || "";
  const syncToParts = script.match(/function syncBirthDatePartsFromDesktop\(\) \{[\s\S]*?\n\}/u)?.[0] || "";
  assert.match(syncToDesktop, /normalizeBirthDateParts\(birthDayInput\.value, birthMonthInput\.value, birthYearInput\.value\)/);
  assert.match(syncToDesktop, /birthDateInput\.value = value/);
  assert.match(syncToDesktop, /birthDesktopDateInput\.value = value/);
  assert.match(syncToParts, /birthYearInput\.value = match\[1\]/);
  assert.match(syncToParts, /birthMonthInput\.value = match\[2\]/);
  assert.match(syncToParts, /birthDayInput\.value = match\[3\]/);
  assert.match(script, /birthDesktopDateInput\.addEventListener\("input", syncBirthDatePartsFromDesktop\)/);
  assert.equal((html.match(/name="date"/g) || []).length, 1);
});

test("submit validates parts before FormData and sends the existing date field", () => {
  const submit = script.match(/async function submitFreeCalculation[\s\S]*?const data = new FormData\(form\);/u)?.[0] || "";
  assert.match(submit, /normalizeBirthDateParts\(birthDayInput\.value, birthMonthInput\.value, birthYearInput\.value\)/);
  assert.match(submit, /birthDateInput\.value = birthDate\.value/);
  assert.match(submit, /if \(birthDate\.error\) return showError/);
});
