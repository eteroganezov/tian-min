const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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
  assert.match(styles, /\.ziwei-facts article\{[^}]*align-items:flex-start;justify-content:center[^}]*text-align:left/);
  assert.match(styles, /\.ziwei-section>\.current-palace\{text-align:left/);
  assert.match(styles, /\.transformations>header p\{[^}]*padding:0;border:0;background:transparent/);
  assert.match(styles, /\.locked-grid article\{[^}]*border-radius:10px/);
});
