const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { formatDisplayNumber, splitLunarDateDisplay } = require("../lib/display-format.cjs");

test("presentation formatting не показывает floating-point artifacts", () => {
  assert.deepEqual([2, 2.5, 3.0999999999999996, 0.8, 0].map(formatDisplayNumber), ["2", "2.5", "3.1", "0.8", "0"]);
});

test("лунная дата разбивается на год, месяц и день без hardcode", () => {
  assert.deepEqual(splitLunarDateDisplay("2003 год · 1-й лунный месяц · 1-й день"), ["2003 год", "1-й лунный месяц", "1-й день"]);
  assert.deepEqual(splitLunarDateDisplay("2024 год · 12-й лунный месяц · 29-й день"), ["2024 год", "12-й лунный месяц", "29-й день"]);
});

test("CTA и calculated Zi Wei cards используют точечные alignment classes", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "..", "public", "index.html"), "utf8");
  const script = fs.readFileSync(path.resolve(__dirname, "..", "public", "app.js"), "utf8");
  const styles = fs.readFileSync(path.resolve(__dirname, "..", "public", "styles.css"), "utf8");
  assert.match(html, /class="cta-label">Рассчитать мою карту/);
  assert.match(html, /class="cta-arrow"/);
  assert.match(styles, /\.hero-cta,\.primary-button\{position:relative;justify-content:center;text-align:center\}/);
  assert.match(script, /class="lunar-date-line"/);
  assert.match(script, /split\(\/\\s\*·\\s\*\/u\)/);
  assert.match(styles, /\.lunar-date-line\{display:block/);
  assert.match(styles, /\.ziwei-facts article\{[^}]*align-items:flex-start;justify-content:flex-start;[^}]*padding:20px 16px;[^}]*text-align:left/);
  assert.match(styles, /\.ziwei-section>\.current-palace\{text-align:left/);
  assert.match(styles, /\.transformations>header p\{[^}]*padding:0;border:0;background:transparent/);
  assert.match(styles, /\.locked-grid article\{[^}]*border-radius:10px/);
});

test("верхняя группа Zi Wei сохраняет три строки даты и лаконичную систему элементов", () => {
  const script = fs.readFileSync(path.resolve(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(script, /lunarDateLines\(data\.ziwei\)\.map\(line => `<i class="lunar-date-line">/);
  assert.match(script, /conciseBureauName\(data\.ziwei\.fiveElementBureau\.name\)/);
  assert.match(script, /Здесь собраны ключевые рассчитанные параметры карты Цзы Вэй\./);
  assert.doesNotMatch(script, /Здесь собраны основные ориентиры карты:/);
  const source = script.match(/function conciseBureauName\(value\) \{[\s\S]*?\n\}/u)?.[0];
  assert.ok(source);
  const conciseBureauName = vm.runInNewContext(`(${source})`);
  assert.deepEqual(
    ["Дерево", "Огонь", "Земля", "Металл", "Вода"].map(element => conciseBureauName(`Система элемента «${element}»`)),
    ["Дерево", "Огонь", "Земля", "Металл", "Вода"],
  );
});

test("mobile landing переносит одну форму после объяснений и сохраняет safe-width iOS controls", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "..", "public", "index.html"), "utf8");
  const script = fs.readFileSync(path.resolve(__dirname, "..", "public", "app.js"), "utf8");
  const styles = fs.readFileSync(path.resolve(__dirname, "..", "public", "styles.css"), "utf8");
  assert.equal((html.match(/id="birth-form"/g) || []).length, 1);
  assert.match(html, /id="free-benefits-title">Что вы получите после расчёта/);
  assert.match(html, /id="mobile-form-slot"/);
  assert.ok(html.indexOf('id="how-it-works"') < html.indexOf('id="free-benefits-title"'));
  assert.ok(html.indexOf('id="free-benefits-title"') < html.indexOf('id="mobile-form-slot"'));
  assert.match(script, /mobileFormMedia\.matches \? mobileFormSlot : heroLayout/);
  assert.match(styles, /--site-header-height:76px;--anchor-gap:18px/);
  assert.match(styles, /main \[id\],\.checkout-panel\{scroll-margin-top:calc\(var\(--site-header-height\)/);
  assert.match(styles, /body\{overflow-x:clip\}/);
  assert.match(styles, /\.field input,\.place-field>input,\.checkout-field input\{display:block;width:100%;max-width:100%;min-width:0;box-sizing:border-box\}/);
  assert.match(styles, /@media\(max-width:620px\)[\s\S]*\.field input,\.place-field>input,\.checkout-field input,select,textarea\{font-size:16px\}/);
  assert.match(styles, /input\[type="date"\],\.field input\[type="time"\]\{-webkit-appearance:none;appearance:none;[^}]*min-inline-size:0/);
  assert.match(styles, /::-webkit-date-and-time-value\{min-height:54px;margin:0;text-align:left\}/);
  assert.match(styles, /\.locked-grid\{grid-template-columns:1fr 1fr/);
  assert.match(script, /input type="email" name="payerEmail" autocomplete="email" inputmode="email" enterkeyhint="done"/);
  assert.match(script, /if \(event\.key !== "Enter"\) return;[\s\S]*event\.preventDefault\(\);[\s\S]*email\.blur\(\)/);
});

test("final mobile rhythm сохраняет viewport sticky и editorial-композицию", () => {
  const styles = fs.readFileSync(path.resolve(__dirname, "..", "public", "styles.css"), "utf8");
  assert.match(styles, /html\{overflow-x:hidden\}body\{overflow-x:visible\}\s*@supports\(overflow:clip\)\{html,body\{overflow-x:clip\}\}/);
  assert.match(styles, /\.traditions article header b\{display:none\}/);
  assert.match(styles, /\.traditions h3\{order:1;[^}]*font-size:25px\}/);
  assert.match(styles, /\.free-benefits-grid span:last-child\{grid-column:1\/-1;width:calc\(50% - 4px\);justify-self:center\}/);
  assert.match(styles, /\.preview-heading\{gap:12px;align-items:start\}/);
  assert.match(styles, /\.pillars-grid\{margin-top:28px\}/);
});

test("premium topics показываются до CTA, а purchase disclosure не повторяет их", () => {
  const script = fs.readFileSync(path.resolve(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(script, /Объединённый разбор Ба-цзы и Цзы Вэй/);
  assert.match(script, /Полный PDF-отчёт/);
  assert.doesNotMatch(script, /И другие темы полного разбора/);
  assert.match(script, /class="purchase-summary"><span>Персональный отчёт<\/span><span>Полный PDF<\/span>/);
  assert.doesNotMatch(script, /function premiumOfferItems/);
  assert.match(script, /function revealCheckout\(host\) \{ host\.querySelector\("\.checkout-panel"\)\?\.scrollIntoView\(\{ behavior: "smooth", block: "start" \}\); \}/);
  assert.match(script, /renderConsentCheckout\(order\)[\s\S]*revealCheckout\(host\);/);
});

test("client email validation требует доменную точку и непустой suffix", () => {
  const script = fs.readFileSync(path.resolve(__dirname, "..", "public", "app.js"), "utf8");
  const source = script.match(/function isPlausibleEmail\(value\) \{[^\n]+\}/u)?.[0];
  assert.ok(source);
  const isPlausibleEmail = vm.runInNewContext(`(${source})`);
  for (const value of ["a@", "a@b", "user@mail", "user@domain."]) assert.equal(isPlausibleEmail(value), false);
  for (const value of ["user@mail.ru", "user@example.com"]) assert.equal(isPlausibleEmail(value), true);
  assert.match(script, /email\.validity\.valid && isPlausibleEmail\(email\.value\)/);
});
