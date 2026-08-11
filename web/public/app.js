const form = document.querySelector("#birth-form");
const errorBox = document.querySelector("#form-error");
const submitButton = document.querySelector("#submit-button");
const buttonLabel = submitButton.querySelector(".button-label");
const resultRoot = document.querySelector("#result-root");
const placeInput = document.querySelector("#birth-place");
const placeOptions = document.querySelector("#place-options");
const ambiguityBox = document.querySelector("#ambiguity-box");
const elementNames = ["木", "火", "土", "金", "水"];
let selectedPlace = null;
let searchTimer = null;

placeInput.addEventListener("input", () => {
  selectedPlace = null;
  ambiguityBox.hidden = true;
  clearTimeout(searchTimer);
  const query = placeInput.value.trim();
  if (query.length < 2) return renderPlaceOptions([]);
  searchTimer = setTimeout(() => searchPlaces(query), 180);
});

placeInput.addEventListener("keydown", event => {
  if (event.key === "Escape") renderPlaceOptions([]);
});

document.addEventListener("click", event => {
  if (!event.target.closest(".place-field")) renderPlaceOptions([]);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitCalculation();
});

async function submitCalculation(timeOccurrence) {
  showError("");
  ambiguityBox.hidden = true;
  const data = new FormData(form);
  const date = String(data.get("date") || "");
  const time = String(data.get("time") || "");
  const gender = String(data.get("gender") || "");
  if (!date) return showError("Укажите дату рождения.");
  if (!time) return showError("Укажите время рождения.");
  if (!gender) return showError("Выберите пол.");
  if (!selectedPlace) return showError("Выберите место рождения из списка подсказок.");

  setLoading(true);
  try {
    const response = await fetch("/api/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, time, gender, placeId: selectedPlace.id, ...(timeOccurrence ? { timeOccurrence } : {}) }),
    });
    const payload = await response.json();
    if (response.status === 409 && payload.code === "AMBIGUOUS_LOCAL_TIME") return showAmbiguity(payload.options || []);
    if (!response.ok) throw new Error(payload.error || "Не удалось выполнить расчёт.");
    resultRoot.innerHTML = renderResults(payload.chart, payload.metadata);
    resultRoot.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    resultRoot.innerHTML = "";
    showError(error instanceof Error ? error.message : "Не удалось выполнить расчёт. Попробуйте ещё раз.");
  } finally {
    setLoading(false);
  }
}

async function searchPlaces(query) {
  try {
    const response = await fetch(`/api/places?q=${encodeURIComponent(query)}`);
    const payload = await response.json();
    if (placeInput.value.trim() === query) renderPlaceOptions(response.ok ? payload.places : []);
  } catch { renderPlaceOptions([]); }
}

function renderPlaceOptions(places) {
  placeOptions.innerHTML = places.map((place, index) => `<button type="button" role="option" data-index="${index}"><strong>${e(place.city)}</strong><span>${e([place.region, place.country].filter(Boolean).join(", "))}</span></button>`).join("");
  placeOptions.hidden = places.length === 0;
  placeInput.setAttribute("aria-expanded", String(places.length > 0));
  placeOptions.querySelectorAll("button").forEach((button, index) => button.addEventListener("click", () => {
    selectedPlace = places[index];
    placeInput.value = selectedPlace.label;
    renderPlaceOptions([]);
    showError("");
  }));
}

function showAmbiguity(options) {
  setLoading(false);
  ambiguityBox.innerHTML = `<p>В эту ночь часы переводили назад, поэтому указанное время наступало дважды. Выберите вариант:</p>${options.map(option => `<button type="button" data-value="${e(option.value)}">${e(option.label)}</button>`).join("")}`;
  ambiguityBox.hidden = false;
  ambiguityBox.querySelectorAll("button").forEach(button => button.addEventListener("click", () => submitCalculation(button.dataset.value)));
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

function setLoading(loading) {
  submitButton.disabled = loading;
  buttonLabel.textContent = loading ? "Рассчитываем карту…" : "Рассчитать мою карту";
}

function renderResults(chart, metadata) {
  const maxElement = Math.max(...Object.values(chart.bazi.elements), 1);
  return `<div class="results">
    <header class="result-header shell">
      <div><p class="eyebrow">Персональная карта</p><h2>${e(metadata.originalLocalDateTime.split(" ")[0])} <span>·</span> ${e(metadata.originalLocalDateTime.split(" ")[1])}</h2><p>${e(chart.input.gender)} · ${e(metadata.place.name)}</p></div>
      <div class="result-mark"><span>八字</span><i></i><span>紫微</span></div>
    </header>
    <section class="method-details shell"><details><summary>Как учитывается место рождения</summary><div class="method-grid"><p><span>Исходное местное время</span><strong>${e(metadata.originalLocalDateTime)}</strong></p><p><span>Истинное солнечное время</span><strong>${e(metadata.trueSolarDateTime)}</strong></p><p><span>Часовой пояс места</span><strong>${e(metadata.ianaTimeZone)}</strong></p><p><span>Поправка</span><strong>${e(formatSigned(metadata.trueSolarCorrectionMinutes))} мин</strong></p></div><small>Исторические правила часового пояса, летнее время, долгота и уравнение времени учтены автоматически. Метод: ${e(metadata.calculationMethod)}.</small></details></section>
    <section class="chart-section shell">
      <div class="section-title"><span class="chapter">02</span><div><p>Четыре столпа</p><h2>BaZi <small>八字</small></h2></div></div>
      <div class="pillars-grid">${chart.bazi.pillars.map(p => `<article class="pillar-card"><p>${e(p.label)}</p><span>${e(p.shiShen)}</span><strong>${e(p.gan)}</strong><strong>${e(p.zhi)}</strong></article>`).join("")}</div>
      <div class="summary-grid">
        <article class="summary-card accent"><span>Дневной хозяин</span><strong>${e(chart.bazi.dayMaster)}</strong><p>日主</p></article>
        <article class="summary-card"><span>Структура карты</span><strong>${e(chart.bazi.structure)}</strong><p>Уверенность: ${e(chart.bazi.structureConfidence)}</p></article>
        <article class="summary-card"><span>Сила карты</span><strong>${e(chart.bazi.strength.verdict)}</strong><p>Оценка ${e(chart.bazi.strength.score)} · ${e(chart.bazi.strength.confidence)}</p></article>
        <article class="summary-card"><span>Регулирующие элементы</span><strong>${e(chart.bazi.regulating.join(" · ") || "—")}</strong><p>调候用神</p></article>
      </div>
      <div class="detail-grid">
        <article class="panel elements-panel"><div class="panel-head"><h3>Пять элементов</h3><span>五行</span></div><div class="elements-list">${elementNames.map(name => `<div class="element-row element-${name}"><b>${name}</b><div><i style="width:${(chart.bazi.elements[name] / maxElement) * 100}%"></i></div><span>${e(chart.bazi.elements[name])}</span></div>`).join("")}</div></article>
        <article class="panel"><div class="panel-head"><h3>Первые большие периоды</h3><span>大运</span></div><div class="period-list">${chart.bazi.majorPeriods.map(period => `<div class="period"><strong>${e(period.ganZhi)}</strong><span>${e(period.range)}</span><small>${e(period.years)}<br>${e(period.detail)}</small></div>`).join("")}</div></article>
      </div>
    </section>
    <section class="chart-section ziwei-section"><div class="shell">
      <div class="section-title"><span class="chapter light">03</span><div><p>Двенадцать дворцов</p><h2>Zi Wei <small>紫微斗数</small></h2></div></div>
      <div class="ziwei-facts">
        <article><span>Лунная дата</span><strong>${e(chart.ziwei.lunarDate)}</strong></article><article><span>Дворец судьбы</span><strong>${e(chart.ziwei.mingPalace)}宫</strong></article><article><span>Дворец тела</span><strong>${e(chart.ziwei.shenPalace)}宫</strong></article><article><span>Пять элементов</span><strong>${e(chart.ziwei.fiveElementBureau)}</strong></article>
      </div>
      <div class="transformations"><span>Четыре трансформации</span>${chart.ziwei.transformations.map(item => `<b>${e(item)}</b>`).join("")}</div>
      <div class="palaces-grid">${chart.ziwei.palaces.map(palace => `<article class="palace ${palace.isMing ? "ming" : ""}"><header><h3>${e(palace.name)}</h3><span>${e(palace.ganZhi)}</span></header><div class="palace-stars">${e(palace.mainStars.length ? palace.mainStars.join(" · ") : "Без главной звезды")}</div><p>${e(palace.auxStars.slice(0, 5).join(" · ") || "—")}</p><footer><span>${e(palace.majorPeriod)} лет</span><div>${palace.isMing ? "<b>命</b>" : ""}${palace.isShen ? "<b>身</b>" : ""}</div></footer></article>`).join("")}</div>
      <article class="ziwei-periods panel dark-panel"><div class="panel-head"><h3>Первые большие периоды Zi Wei</h3><span>大限</span></div><div class="period-list">${chart.ziwei.majorPeriods.map(period => `<div class="period"><strong>${e(period.gong)}</strong><span>${e(period.range)}</span><small>${e(period.detail)}</small></div>`).join("")}</div></article>
    </div></section>
  </div>`;
}

function formatSigned(value) {
  const rounded = Math.round(Number(value) * 10) / 10;
  return `${rounded >= 0 ? "+" : ""}${rounded}`;
}

function e(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}
