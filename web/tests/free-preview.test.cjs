const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { calculateRequest } = require("../lib/calculate.cjs");
const { createFreePreviewRequest } = require("../lib/free-preview.cjs");
const { locationProvider } = require("../lib/location-provider.cjs");

const moscow = locationProvider.search("Москва")[0];
const eduard = { name: "Эдуард", date: "1995-09-03", time: "05:50", gender: "male", placeId: moscow.id };

test("free preview содержит только реальные canonical данные карты", () => {
  const canonical = calculateRequest(eduard).body.chart;
  const result = createFreePreviewRequest(eduard, { currentYear: 2026 });
  assert.equal(result.status, 200);
  assert.equal(result.body.state, "FREE_PREVIEW_READY");
  assert.equal(result.body.person.time, "05:50");
  assert.deepEqual(result.body.bazi.pillars, canonical.bazi.pillars);
  assert.equal(result.body.bazi.dayMaster, canonical.bazi.dayMaster);
  assert.deepEqual(result.body.bazi.elements, canonical.bazi.elementsDisplay);
  assert.deepEqual(result.body.ziwei.transformations, canonical.ziwei.transformationsDisplay);
  assert.equal(result.body.ziwei.palaces.length, 12);
  assert.equal(result.body.ziwei.mingPalace.displayName.name, "Дворец судьбы и личности");
  assert.equal(result.body.ziwei.mingPalace.branch, canonical.ziwei.mingPalace);
  assert.match(result.body.ziwei.shenPalace.displayName.name, /^Дворец /);
  assert.equal(result.body.bazi.currentPeriod.years, "2024–2033");
  assert.equal(result.body.ziwei.currentPalace.isCurrentPeriod, true);
});

test("free payload не содержит AI-отчёт, prompts, metadata или закрытый текст", () => {
  const json = JSON.stringify(createFreePreviewRequest(eduard, { currentYear: 2026 }).body);
  assert.doesNotMatch(json, /report|prompt|auditTrail|metadata|executivePortrait|actionPlan|openai|api[_-]?key/i);
  assert.doesNotMatch(json, /Полный разбор скоро будет доступен|Характер и внутренние мотивы/);
});

test("два расчёта free preview не вызывают provider полного отчёта", () => {
  let reportCalls = 0;
  const aiProvider = () => { reportCalls += 1; throw new Error("AI must not run"); };
  for (let index = 0; index < 2; index += 1) {
    const response = createFreePreviewRequest(eduard, { currentYear: 2026, aiProvider });
    assert.equal(response.status, 200);
    assert.equal(response.body.state, "FREE_PREVIEW_READY");
  }
  assert.equal(reportCalls, 0);
});

test("клиент free preview не содержит вызовов premium API и показывает CTA placeholder", () => {
  const script = fs.readFileSync(path.resolve(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(script, /fetch\("\/api\/free-preview"/);
  assert.match(script, /Получить полный персональный разбор/);
  assert.match(script, /Полный разбор скоро будет доступен/);
  assert.doesNotMatch(script, /fetch\("\/api\/(?:report|pdf)"/);
});

test("адаптивные правила защищают desktop и 390px от горизонтального overflow", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "..", "public", "styles.css"), "utf8");
  assert.match(css, /\*\{box-sizing:border-box\}/);
  assert.match(css, /body\{[^}]*overflow-x:hidden/);
  assert.match(css, /@media\(max-width:390px\)/);
  assert.match(css, /\.pillars-grid\{grid-template-columns:1fr 1fr\}/);
  assert.match(css, /minmax\(0,1fr\)/);
});
