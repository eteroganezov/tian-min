const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createFreePreviewRequest } = require("../lib/free-preview.cjs");
const { locationProvider } = require("../lib/location-provider.cjs");

const script = fs.readFileSync(path.resolve(__dirname, "..", "public", "app.js"), "utf8");
const styles = fs.readFileSync(path.resolve(__dirname, "..", "public", "styles.css"), "utf8");

test("Variant B iteration 2 интегрирует два dynamic orientation facts без отдельной сухой секции", () => {
  assert.match(script, /Ваша персональная карта рассчитана/);
  assert.match(script, /Главный знак[\s\S]*data\.bazi\.dayMaster/);
  assert.match(script, /personalStemName\(data\.bazi\.dayMasterDisplay\?\.name\)/);
  assert.match(script, /Текущий жизненный этап[\s\S]*current\.years/);
  assert.doesNotMatch(script, /Что карта показывает сейчас|class="personal-first"|Ваша текущая сфера Цзы Вэй/);
  const opening = script.slice(script.indexOf('class="preview-cover'), script.indexOf('class="map-proof'));
  assert.doesNotMatch(opening, /Грабитель богатства|Семь убийц|Небесный ствол|Земная ветвь|Хуа Лу|Хуа Цюань/);
});

test("final framing отделяет calculated map data от полного персонального разбора", () => {
  assert.match(script, /Ваша персональная карта рассчитана/);
  assert.match(script, /Ниже — основные данные двух систем, из которых складывается ваша карта\./);
  assert.match(script, /В полном персональном разборе мы объясняем, что их сочетание означает именно для вас\./);
  const endingNote = "Это рассчитанные данные, из которых строится ваша карта. Персональный смысл этих данных раскрывается в полном разборе.";
  assert.equal(script.split(endingNote).length - 1, 2);
  assert.match(styles, /\.map-ending-note\{/);
  assert.doesNotMatch(script, /Поделиться PDF|navigator\.share/);
});

test("technical proof сохраняет 12 дворцов и границу между generic data и Premium meaning", () => {
  assert.match(script, /Что показывают 12 дворцов\?/);
  assert.match(script, /делит жизненный путь на 12 сфер/);
  assert.match(script, /Короткие пояснения карточек описывают только саму жизненную сферу/);
  assert.match(script, /Что означают звёзды именно в вашей карте/);
  assert.match(script, /Персональное значение раскрывается только в контексте всей карты/);
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

test("technical disclosures доступны с клавиатуры и переключают aria-expanded без API", () => {
  assert.match(script, /class="technical-disclosure-trigger" aria-expanded="false" aria-controls="technical-bazi-panel"/);
  assert.match(script, /id="technical-bazi-panel" hidden/);
  assert.match(styles, /\.technical-disclosure-trigger:focus-visible/);
  const setterSource = script.match(/function setTechnicalDisclosureState\(button, expanded\) \{[\s\S]*?\n\}/u)?.[0];
  const toggleSource = script.match(/function toggleTechnicalDisclosure\(button\) \{[\s\S]*?\n\}/u)?.[0];
  assert.ok(setterSource);
  assert.ok(toggleSource);
  assert.doesNotMatch(`${setterSource}${toggleSource}`, /api\(|fetch\(|payment|promo|generate/i);
  const panel = { hidden: true };
  const button = {
    attrs: { "aria-controls": "panel", "aria-expanded": "false" },
    action: { textContent: "Посмотреть карту" },
    getAttribute(name) { return this.attrs[name]; },
    setAttribute(name, value) { this.attrs[name] = value; },
    querySelector() { return this.action; },
    closest() { return { dataset: {} }; },
  };
  const toggle = vm.runInNewContext(`(() => { ${setterSource}; return ${toggleSource.replace(/^function toggleTechnicalDisclosure/, "function")}; })()`, { document: { getElementById: () => panel } });
  toggle(button);
  assert.equal(button.attrs["aria-expanded"], "true");
  assert.equal(panel.hidden, false);
  assert.equal(button.action.textContent, "Скрыть карту");
  toggle(button);
  assert.equal(button.attrs["aria-expanded"], "false");
  assert.equal(panel.hidden, true);
  assert.equal(button.action.textContent, "Посмотреть карту");
});

test("две карты предшествуют synthesis bridge и ведут в существующий Premium flow", () => {
  assert.match(script, /data-action="premium">Получить персональный разбор/);
  assert.match(script, /data-action="premium"[^]*addEventListener\("click", openPremiumOffer\)/);
  assert.match(script, /<b>Карта Ба-цзы<\/b><small>Рассчитаны четыре столпа, элементы и жизненные периоды<\/small><em class="disclosure-action">Посмотреть карту<\/em>/);
  assert.match(script, /<b>Карта Цзы Вэй<\/b><small>Рассчитаны 12 жизненных сфер и звёзды<\/small><em class="disclosure-action">Посмотреть карту<\/em>/);
  assert.doesNotMatch(script, /Посмотреть подробную карту и расчёты|Подробная карта Ба-цзы|Подробная карта Цзы Вэй/);
  assert.ok(script.indexOf('id="technical-bazi-panel"') < script.indexOf('class="premium-teaser early-premium-bridge"'));
  assert.ok(script.indexOf('id="technical-ziwei-panel"') < script.indexOf('class="premium-teaser early-premium-bridge"'));
  assert.match(script, /Отдельные знаки — только части картины/);
  assert.match(script, /сочетание рассчитанных данных проявляется/);
  assert.equal((script.match(/class="technical-disclosure-trigger" aria-expanded="false"/g) || []).length, 2);
});

test("responsive presentation раскрывает editorial proof на desktop и сохраняет compact stack на mobile", () => {
  assert.match(styles, /\.preview-body\{padding-bottom:0\}/);
  assert.match(script, /matchMedia\("\(min-width: 960px\)"\)/);
  assert.match(script, /syncTechnicalDisclosures\(\)/);
  assert.match(styles, /@media\(min-width:960px\)[^]*\.technical-disclosure-trigger\{display:none\}/);
  assert.match(styles, /@media\(min-width:960px\)[^]*\.technical-disclosure\{overflow:visible;border:0/);
  assert.match(styles, /@media\(max-width:760px\)[^]*\.map-disclosures\{grid-template-columns:1fr/);
  assert.match(styles, /\.technical-disclosure-panel\{[^}]*box-sizing:border-box/);
  assert.match(styles, /html\{overflow-x:hidden\}/);
});

test("desktop/mobile breakpoint синхронизирует hidden и aria-expanded в одном DOM", () => {
  const setterSource = script.match(/function setTechnicalDisclosureState\(button, expanded\) \{[\s\S]*?\n\}/u)?.[0];
  const syncSource = script.match(/function syncTechnicalDisclosures\(\) \{[\s\S]*?\n\}/u)?.[0];
  assert.ok(setterSource);
  assert.ok(syncSource);
  assert.equal((script.match(/id="technical-bazi-panel"/g) || []).length, 1);
  assert.equal((script.match(/id="technical-ziwei-panel"/g) || []).length, 1);
  assert.match(syncSource, /desktopTechnicalMedia\.matches/);
  assert.match(setterSource, /panel\.hidden = !expanded/);
  assert.match(setterSource, /aria-expanded/);
});

test("наблюдаемый reverse-looking age order остаётся неизменным calculated output", () => {
  const placeId = locationProvider.search("Москва")[0].id;
  const result = createFreePreviewRequest({ date: "1974-10-15", time: "12:00", gender: "male", placeId }, { currentYear: 2026 });
  assert.deepEqual(result.body.ziwei.palaces.map(palace => palace.majorPeriod), [
    "3–12", "113–122", "103–112", "93–102", "83–92", "73–82",
    "63–72", "53–62", "43–52", "33–42", "23–32", "13–22",
  ]);
  assert.equal(result.body.ziwei.palaces.find(palace => palace.isCurrentPeriod).majorPeriod, "53–62");
  assert.match(script, /соседние значения могут идти не по возрастанию/);
  assert.match(script, /class="palace-period">Период · \$\{e\(palace\.majorPeriod\)\} лет/);
});

test("Ten Gods обозначены как традиционные категории, а Four Pillars объяснены без free interpretation", () => {
  assert.match(script, /Что показывают четыре столпа\?/);
  assert.match(script, /Год, месяц, день и час рождения образуют четыре столпа/);
  assert.match(script, /«Грабитель богатства», «Семь убийц»[^]*не буквальные события или предсказания/);
  assert.match(script, /традиционная категория Ба-цзы/);
});

test("UX task не затрагивает payment, promo, generation, PDF или calculation implementation", () => {
  const protectedPaths = ["premium-service.cjs", "promo-config.cjs", "report-service.cjs", "pdf-template-v4.cjs", "birth-chart-pipeline.cjs"];
  for (const protectedPath of protectedPaths) assert.equal(fs.existsSync(path.resolve(__dirname, "..", "lib", protectedPath)), true);
  assert.doesNotMatch(script.match(/function togglePalaceExplanation[\s\S]*?\n\}/u)?.[0] || "", /checkout|payment|promo|report|generate/i);
});
