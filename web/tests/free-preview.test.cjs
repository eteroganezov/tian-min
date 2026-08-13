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
  assert.deepEqual(result.body.bazi.elements.map(({ displayValue, ...item }) => item), canonical.bazi.elementsDisplay);
  assert.ok(result.body.bazi.elements.every(item => typeof item.displayValue === "string"));
  assert.deepEqual(result.body.ziwei.transformations, canonical.ziwei.transformationsDisplay);
  assert.equal(result.body.ziwei.palaces.length, 12);
  assert.equal(result.body.ziwei.mingPalace.displayName.name, "Дворец судьбы и личности");
  assert.equal(result.body.ziwei.mingPalace.branch, canonical.ziwei.mingPalace);
  assert.match(result.body.ziwei.shenPalace.displayName.name, /^Дворец /);
  assert.equal(result.body.bazi.currentPeriod.years, "2024–2033");
  assert.equal(result.body.ziwei.currentPalace.isCurrentPeriod, true);
  assert.deepEqual(result.body.ziwei.lunarDateLines, result.body.ziwei.lunarDate.split(" · "));
});

test("free BaZi payload готов для пользовательского UI без raw enum и артефактов", () => {
  const result = createFreePreviewRequest(eduard, { currentYear: 2026 });
  const bazi = result.body.bazi;
  assert.equal(result.status, 200);
  assert.ok(Number.isFinite(bazi.strength.score));
  assert.doesNotMatch(bazi.strength.display.name, /[\u3400-\u9fff]/u);
  for (const pillar of bazi.pillars) {
    assert.match(pillar.stemDisplay.name, /(?:Ян|Инь) · небесный ствол$/);
    assert.match(pillar.branchDisplay.name, / · земная ветвь$/);
    assert.ok(pillar.shiShenDisplay.name);
  }
  const userFacing = JSON.stringify({
    strength: bazi.strength.display.name,
    pillars: bazi.pillars.map(pillar => [pillar.stemDisplay.name, pillar.branchDisplay.name, pillar.shiShenDisplay.name]),
    elements: bazi.elements.map(item => [item.name, item.displayValue]),
    currentPeriod: bazi.currentPeriod?.detailDisplay.map(item => item.name) || [],
  });
  assert.doesNotMatch(userFacing, /undefined|null|NaN|Infinity|极旺|偏旺|中和|偏弱|极弱/);
});

test("free-preview boundary не пропускает stale raw strength и неполные pillar labels", () => {
  const input = { ...eduard, date: "1940-04-15", time: "12:00" };
  const stale = structuredClone(calculateRequest(input));
  stale.body.chart.bazi.strength.display = { original: "极旺(可能从强)", name: "极旺(可能从强)" };
  stale.body.chart.bazi.pillars = stale.body.chart.bazi.pillars.map(pillar => ({
    ...pillar,
    stemDisplay: { original: pillar.gan, name: "Технический ствол" },
    branchDisplay: { original: pillar.zhi, name: "Земная ветвь" },
  }));
  const result = createFreePreviewRequest(input, { calculate: () => stale, currentYear: 1950 });
  assert.equal(result.body.bazi.strength.display.name, "Очень сильная карта (возможна структура следования силе)");
  assert.ok(result.body.bazi.pillars.every(pillar => /(?:Ян|Инь) · небесный ствол$/.test(pillar.stemDisplay.name)));
  assert.ok(result.body.bazi.pillars.every(pillar => / · земная ветвь$/.test(pillar.branchDisplay.name)));
});

test("все пять реальных verdict проходят через end-to-end free preview с русской подписью", () => {
  const cases = [
    ["1940-01-15", "中和", "Сбалансированная карта"],
    ["1940-02-15", "偏旺", "Скорее сильная карта"],
    ["1940-04-15", "极旺(可能从强)", "Очень сильная карта (возможна структура следования силе)"],
    ["1946-02-15", "偏弱", "Скорее ослабленная карта"],
    ["1952-06-15", "极弱(可能从弱)", "Очень слабая карта (возможна структура следования слабости)"],
  ];
  for (const [date, verdict, displayName] of cases) {
    const result = createFreePreviewRequest({ ...eduard, date, time: "12:00" }, { currentYear: 2026 });
    assert.equal(result.status, 200);
    assert.equal(result.body.bazi.strength.verdict, verdict);
    assert.equal(result.body.bazi.strength.display.name, displayName);
  }
});

test("compact pillar template отдельно показывает stem, branch и Ten God без повторяющегося label", () => {
  const script = fs.readFileSync(path.resolve(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(script, /pillar\.gan[\s\S]*pillar\.stemDisplay\.name[\s\S]*pillar\.zhi[\s\S]*pillar\.branchDisplay\.name/);
  assert.match(script, /compactStemName\(pillar\.stemDisplay\.name\)/);
  assert.match(script, /compactBranchName\(pillar\.branchDisplay\.name\)/);
  assert.doesNotMatch(script, /Роль в структуре Ба-цзы/);
  assert.match(script, /<small><b>\$\{e\(pillar\.shiShenDisplay\.name\)\}<\/b><i>традиционная категория Ба-цзы<\/i><\/small>/);
});

test("personal-first факты получают значения из payload, а не из fixture", () => {
  const second = createFreePreviewRequest({ ...eduard, date: "1990-05-15", time: "12:00", gender: "female" }, { currentYear: 2026 });
  const first = createFreePreviewRequest(eduard, { currentYear: 2026 });
  assert.notEqual(first.body.bazi.dayMaster, second.body.bazi.dayMaster);
  assert.match(fs.readFileSync(path.resolve(__dirname, "..", "public", "app.js"), "utf8"), /data\.bazi\.dayMaster[\s\S]*current\.years[\s\S]*currentPalace/);
});

test("current big period получает русский stem/branch слой поверх calculated ganZhi", () => {
  const result = createFreePreviewRequest(eduard, { currentYear: 2026 });
  const period = result.body.bazi.currentPeriod;
  assert.equal(period.ganZhi, period.gan + period.zhi);
  assert.match(period.stemDisplay.name, /(?:Ян|Инь) · небесный ствол$/);
  assert.match(period.branchDisplay.name, / · земная ветвь$/);
  const script = fs.readFileSync(path.resolve(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(script, /class="current-period-ganzhi"/);
  assert.match(script, /current\.gan[\s\S]*current\.stemDisplay\.name[\s\S]*current\.zhi[\s\S]*current\.branchDisplay\.name/);
});

test("frontend balance primary layer скрывает raw verdict и принимает русское display name", () => {
  const script = fs.readFileSync(path.resolve(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(script, /primaryStrengthName\(data\.bazi\.strength\)/);
  const source = script.match(/function primaryStrengthName\(strength\) \{[\s\S]*?\n\}/u)?.[0];
  assert.ok(source);
  const primaryStrengthName = require("node:vm").runInNewContext(`(${source})`);
  assert.equal(primaryStrengthName({ verdict: "极旺(可能从强)", display: { name: "Очень сильная карта" } }), "Очень сильная карта");
  assert.equal(primaryStrengthName({ verdict: "极旺(可能从强)", display: { name: "极旺(可能从强)" } }), "Статус требует уточнения");
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
  assert.match(script, /Получить персональный разбор/);
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

test("frontend требует подтверждённое место и содержит доступную keyboard navigation", () => {
  const script = fs.readFileSync(path.resolve(__dirname, "..", "public", "app.js"), "utf8");
  const html = fs.readFileSync(path.resolve(__dirname, "..", "public", "index.html"), "utf8");
  assert.match(script, /Выберите место из списка подсказок/);
  assert.match(script, /\["ArrowDown", "ArrowUp", "Enter"\]/);
  assert.match(script, /aria-selected/);
  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-autocomplete="list"/);
  assert.match(script, /fetch\(`\/api\/places\?q=\$\{encodeURIComponent\(query\)\}`\)/);
  assert.match(script, /const places = response\.ok \? payload\.places : \[\]/);
  assert.match(script, /renderPlaceOptions\(places\)/);
  assert.match(script, /placeFallback\.hidden = places\.length > 0/);
});
