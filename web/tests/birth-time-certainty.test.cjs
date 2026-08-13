const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { calculateRequest } = require("../lib/calculate.cjs");
const { createFreePreviewRequest } = require("../lib/free-preview.cjs");
const { canonicalBirthInput } = require("../lib/personalization.cjs");
const { locationProvider } = require("../lib/location-provider.cjs");

const moscow = locationProvider.search("Москва")[0];
const base = { date: "1995-09-03", time: "05:00", gender: "male", placeId: moscow.id };

test("legacy input без certainty читается как exact, а неизвестное значение отклоняется", () => {
  assert.equal(canonicalBirthInput(base).birthTimeCertainty, "exact");
  assert.equal(canonicalBirthInput({ ...base, birthTimeCertainty: "approximate" }).birthTimeCertainty, "approximate");
  const invalid = calculateRequest({ ...base, birthTimeCertainty: "estimated" });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, "INVALID_BIRTH_TIME_CERTAINTY");
  assert.equal(invalid.body.error, "Выберите, насколько точно вы знаете время рождения.");
});

test("certainty остаётся metadata и не изменяет время, карту или sensitivity", () => {
  const exact = calculateRequest({ ...base, birthTimeCertainty: "exact" }).body;
  const approximate = calculateRequest({ ...base, birthTimeCertainty: "approximate" }).body;
  assert.equal(exact.metadata.originalBirthTime, "05:00");
  assert.equal(approximate.metadata.originalBirthTime, "05:00");
  assert.equal(exact.metadata.birthTimeCertainty, "exact");
  assert.equal(approximate.metadata.birthTimeCertainty, "approximate");
  assert.deepEqual(exact.chart, approximate.chart);
  assert.equal(exact.metadata.trueSolarDateTime, approximate.metadata.trueSolarDateTime);
  assert.equal(exact.metadata.calculationSensitivity, approximate.metadata.calculationSensitivity);
  assert.deepEqual(exact.metadata.sensitivityFlags, approximate.metadata.sensitivityFlags);
});

test("free preview возвращает certainty отдельно от неизменённого времени", () => {
  const legacy = createFreePreviewRequest(base).body.person;
  const approximate = createFreePreviewRequest({ ...base, birthTimeCertainty: "approximate" }).body.person;
  assert.equal(legacy.birthTimeCertainty, "exact");
  assert.equal(approximate.birthTimeCertainty, "approximate");
  assert.equal(legacy.time, "05:00");
  assert.equal(approximate.time, "05:00");
});

test("форма показывает вопрос, обе опции и заметный exact по умолчанию", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "..", "public", "index.html"), "utf8");
  const css = fs.readFileSync(path.resolve(__dirname, "..", "public", "styles.css"), "utf8");
  assert.match(html, /Насколько точно вы знаете время рождения\?/);
  assert.match(html, /name="birthTimeCertainty" value="exact" checked/);
  assert.match(html, /name="birthTimeCertainty" value="approximate"/);
  assert.match(html, /Знаю точно/);
  assert.match(html, /Знаю примерно/);
  assert.match(html, /Ничего страшного — мы учтём это при интерпретации карты\./);
  assert.match(html, /Нужны для точного расчёта в обеих системах/);
  assert.match(html, /Базовый расчёт — бесплатно\. Полный персональный разбор доступен отдельно\./);
  assert.doesNotMatch(html, /Нужны для точного построения двух карт/);
  assert.doesNotMatch(html, /Расчёт базовой карты не требует оплаты\. Полный персональный разбор — отдельный продукт\./);
  assert.match(css, /\.time-certainty-options input:checked\+span\{/);
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.time-certainty-options\{[^}]*gap:9px\}/);
  assert.match(css, /\.time-certainty-options span\{[^}]*border:1px solid rgba\(24,34,31,\.16\)[^}]*border-radius:8px[^}]*background:#fffefa/);
  assert.match(css, /\.time-certainty-options input:checked\+span\{[^}]*background:var\(--jade\)[^}]*color:#fff/);
  assert.match(css, /\.time-certainty-helper\[hidden\]\{display:none\}/);
  assert.doesNotMatch(css, /\.time-certainty-helper\{[^}]*min-height/);
  assert.doesNotMatch(css, /\.time-certainty-options\{[^}]*background:var\(--paper\)/);
});

function element() {
  const listeners = new Map();
  return {
    hidden: false, value: "", dataset: {}, attributes: new Map(), innerHTML: "", parentElement: null,
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type, event = {}) { return listeners.get(type)?.({ preventDefault() {}, key: "", target: this, ...event }); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    removeAttribute(name) { this.attributes.delete(name); },
    querySelector() { return element(); },
    querySelectorAll(selector) {
      if (selector !== "button") return [];
      return [...this.innerHTML.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)].map((match, index) => {
        const button = element();
        button.textContent = match[1];
        button.dataset.index = String(index);
        return button;
      });
    },
    closest() { return null; }, scrollIntoView() {}, insertAdjacentHTML() {}, appendChild(child) { child.parentElement = this; },
  };
}

function frontendHarness() {
  const nodes = {
    "#birth-form": element(), "#form-error": element(), "#submit-button": element(), "#result-root": element(),
    "#birth-place": element(), "#place-options": element(), "#ambiguity-box": element(), "#time-certainty-helper": element(),
  };
  nodes["#time-certainty-helper"].hidden = true;
  nodes["#submit-button"].querySelector = () => element();
  const values = new Map([["name", ""], ["date", base.date], ["time", base.time], ["gender", base.gender], ["birthTimeCertainty", "exact"]]);
  const requests = [];
  const fetch = async (url, options = {}) => {
    if (String(url).startsWith("/api/places")) return { ok: true, json: async () => ({ places: [moscow] }) };
    requests.push(JSON.parse(options.body));
    return { ok: false, json: async () => ({ error: "test stop after request" }) };
  };
  const document = { querySelector: selector => nodes[selector] || element(), addEventListener() {} };
  const context = {
    document, fetch, FormData: class { get(name) { return values.get(name) ?? null; } },
    localStorage: { getItem: () => null, removeItem() {}, setItem() {} }, setTimeout, clearTimeout, console, Intl, URLSearchParams, encodeURIComponent,
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "..", "public", "app.js"), "utf8"), context);
  return { nodes, requests, values };
}

test("переключение exact ↔ approximate управляет helper и не меняет введённое время", async () => {
  const ui = frontendHarness();
  const approximate = { name: "birthTimeCertainty", value: "approximate", checked: true };
  const exact = { name: "birthTimeCertainty", value: "exact", checked: true };
  ui.nodes["#birth-form"].dispatch("change", { target: approximate });
  assert.equal(ui.nodes["#time-certainty-helper"].hidden, false);
  assert.equal(ui.values.get("time"), "05:00");
  ui.nodes["#birth-form"].dispatch("change", { target: exact });
  assert.equal(ui.nodes["#time-certainty-helper"].hidden, true);
  assert.equal(ui.values.get("time"), "05:00");

  ui.nodes["#birth-place"].value = "моск";
  ui.nodes["#birth-place"].dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 220));
  ui.nodes["#birth-place"].dispatch("keydown", { key: "ArrowDown" });
  ui.nodes["#birth-place"].dispatch("keydown", { key: "Enter" });

  ui.values.set("birthTimeCertainty", "exact");
  await ui.nodes["#birth-form"].dispatch("submit");
  ui.values.set("birthTimeCertainty", "approximate");
  await ui.nodes["#birth-form"].dispatch("submit");
  assert.equal(ui.requests.length, 2);
  assert.deepEqual(ui.requests.map(request => request.time), ["05:00", "05:00"]);
  assert.deepEqual(ui.requests.map(request => request.birthTimeCertainty), ["exact", "approximate"]);
});
