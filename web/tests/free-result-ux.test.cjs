const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createFreePreviewRequest } = require("../lib/free-preview.cjs");
const { locationProvider } = require("../lib/location-provider.cjs");

const script = fs.readFileSync(path.resolve(__dirname, "..", "public", "app.js"), "utf8");
const styles = fs.readFileSync(path.resolve(__dirname, "..", "public", "styles.css"), "utf8");

test("free result объясняет 12 дворцов и границу между данными и персональным смыслом", () => {
  assert.match(script, /Что показывают 12 дворцов\?/);
  assert.match(script, /делит жизненный путь на 12 сфер/);
  assert.match(script, /Здесь вы видите структуру карты/);
  assert.match(script, /что эти дворцы и звёзды означают именно для вас/);
  assert.match(script, /Что ещё выделяется в карте/);
  assert.doesNotMatch(script, /получают в карте дополнительные акценты/);
});

test("palace cards используют доступный button disclosure с локальным static mapping", () => {
  assert.match(script, /class="palace-trigger" aria-expanded="false" aria-controls=/);
  assert.match(script, /class="palace-explanation"[^>]*hidden/);
  assert.match(script, /"夫妻宫": "Сфера близких отношений, партнёрства/);
  assert.match(script, /Что означают звёзды именно в вашей карте/);
  const localSection = script.match(/const PALACE_EXPLANATIONS[\s\S]*?function premiumSections/u)?.[0] || "";
  assert.ok(localSection);
  assert.doesNotMatch(localSection, /api\(|fetch\(|XMLHttpRequest|openai/i);
  assert.match(styles, /\.palace-trigger:focus-visible/);
});

test("palace disclosure открывает одну generic explanation и поддерживает повторное закрытие", () => {
  const source = script.match(/function togglePalaceExplanation\(button\) \{[\s\S]*?\n\}/u)?.[0];
  assert.ok(source);
  const panels = new Map([["one", { hidden: true }], ["two", { hidden: false }]]);
  const makeButton = (id, expanded) => ({
    attrs: { "aria-controls": id, "aria-expanded": String(expanded) },
    getAttribute(name) { return this.attrs[name]; },
    setAttribute(name, value) { this.attrs[name] = value; },
  });
  const first = makeButton("one", false);
  const second = makeButton("two", true);
  const document = {
    querySelectorAll() { return second.attrs["aria-expanded"] === "true" ? [second] : []; },
    getElementById(id) { return panels.get(id); },
  };
  const toggle = vm.runInNewContext(`(${source.replace(/^function togglePalaceExplanation/, "function")})`, { document });
  toggle(first);
  assert.equal(first.attrs["aria-expanded"], "true");
  assert.equal(panels.get("one").hidden, false);
  assert.equal(second.attrs["aria-expanded"], "false");
  assert.equal(panels.get("two").hidden, true);
  toggle(first);
  assert.equal(first.attrs["aria-expanded"], "false");
  assert.equal(panels.get("one").hidden, true);
});

test("continuation cue ведёт к current life period, затем к существующему Premium flow", () => {
  assert.match(script, /href="#current-life-period">Дальше — ваш текущий жизненный период/);
  assert.match(script, /class="current-palace" id="current-life-period"/);
  assert.match(script, /Вы увидели, из чего состоит ваша карта/);
  assert.match(script, /data-action="premium">Получить персональный разбор/);
  assert.match(script, /data-action="premium"[^]*addEventListener\("click", openPremiumOffer\)/);
});

test("responsive CSS устраняет двойной нижний gap и сохраняет human context на mobile", () => {
  assert.match(styles, /\.preview-body\{padding-bottom:0\}/);
  assert.match(styles, /@media\(max-width:620px\)[^]*\.ziwei-summary-intro p\{display:block;text-align:left\}/);
  assert.match(styles, /\.result-continuation\{[^}]*margin:24px auto/);
  assert.doesNotMatch(styles, /\.palace-trigger[^}]*white-space:nowrap/);
});

test("наблюдаемый reverse-looking age order остаётся неизменным calculated output", () => {
  const placeId = locationProvider.search("Москва")[0].id;
  const result = createFreePreviewRequest({ date: "1974-10-15", time: "12:00", gender: "male", placeId }, { currentYear: 2026 });
  assert.deepEqual(result.body.ziwei.palaces.map(palace => palace.majorPeriod), [
    "3–12", "113–122", "103–112", "93–102", "83–92", "73–82",
    "63–72", "53–62", "43–52", "33–42", "23–32", "13–22",
  ]);
  assert.equal(result.body.ziwei.palaces.find(palace => palace.isCurrentPeriod).majorPeriod, "53–62");
  assert.match(script, /соседние карточки не всегда идут по возрастанию/);
});

test("UX task не затрагивает payment, promo, generation, PDF или calculation implementation", () => {
  const protectedPaths = ["premium-service.cjs", "promo-config.cjs", "report-service.cjs", "pdf-template-v4.cjs", "birth-chart-pipeline.cjs"];
  for (const protectedPath of protectedPaths) assert.equal(fs.existsSync(path.resolve(__dirname, "..", "lib", protectedPath)), true);
  assert.doesNotMatch(script.match(/function togglePalaceExplanation[\s\S]*?\n\}/u)?.[0] || "", /checkout|payment|promo|report|generate/i);
});
