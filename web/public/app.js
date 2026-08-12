const form = document.querySelector("#birth-form");
const errorBox = document.querySelector("#form-error");
const submitButton = document.querySelector("#submit-button");
const buttonLabel = submitButton.querySelector(".button-label");
const resultRoot = document.querySelector("#result-root");
const placeInput = document.querySelector("#birth-place");
const placeOptions = document.querySelector("#place-options");
const ambiguityBox = document.querySelector("#ambiguity-box");
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
placeInput.addEventListener("keydown", event => { if (event.key === "Escape") renderPlaceOptions([]); });
document.addEventListener("click", event => { if (!event.target.closest(".place-field")) renderPlaceOptions([]); });
form.addEventListener("submit", async event => { event.preventDefault(); await submitFreeCalculation(); });

async function submitFreeCalculation(timeOccurrence) {
  showError("");
  ambiguityBox.hidden = true;
  const data = new FormData(form);
  const input = {
    name: String(data.get("name") || "").trim().replace(/\s+/g, " "),
    date: String(data.get("date") || ""),
    time: String(data.get("time") || ""),
    gender: String(data.get("gender") || ""),
    placeId: selectedPlace?.id || "",
    ...(timeOccurrence ? { timeOccurrence } : {}),
  };
  if (!input.date) return showError("Укажите дату рождения.");
  if (!input.time) return showError("Укажите время рождения.");
  if (!selectedPlace) return showError("Выберите место рождения из списка подсказок.");
  if (!input.gender) return showError("Выберите пол.");

  setState("CALCULATING");
  try {
    const response = await fetch("/api/free-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = await response.json();
    if (response.status === 409 && payload.code === "AMBIGUOUS_LOCAL_TIME") return showAmbiguity(payload.options || []);
    if (!response.ok) throw new Error(payload.error || "Не удалось выполнить расчёт.");
    resultRoot.innerHTML = renderFreePreview(payload);
    bindPreviewActions();
    setState("FREE_PREVIEW_READY");
    resultRoot.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    resultRoot.innerHTML = "";
    setState("ERROR");
    showError(error instanceof Error ? error.message : "Не удалось выполнить расчёт. Попробуйте ещё раз.");
  }
}

function renderFreePreview(data) {
  const name = data.person.displayName;
  const current = data.bazi.currentPeriod;
  const currentPalace = data.ziwei.currentPalace;
  const maxElement = Math.max(...data.bazi.elements.map(item => Number(item.value)), 1);
  return `<section class="free-preview" data-state="FREE_PREVIEW_READY">
    <header class="preview-cover shell">
      <p class="section-label">Базовая персональная карта</p>
      <h2>${name ? `${e(name)}, ваша карта готова` : "Ваша карта готова"}</h2>
      <p>Мы рассчитали Ба-цзы и Цзы Вэй Доу Шу по вашим данным рождения.</p>
      <div class="birth-summary"><span>${e(formatDate(data.person.date))}</span><span>${e(data.person.time)}</span><span>${e(data.person.birthPlace?.label || "")}</span></div>
    </header>

    <div class="preview-body shell">
      <section class="preview-section" aria-labelledby="bazi-title">
        <div class="preview-heading"><div><span>01 · 八字</span><h2 id="bazi-title">Ваша карта Ба-цзы</h2></div><p>Четыре столпа — это базовая структура карты рождения: год, месяц, день и час.</p></div>
        <div class="pillars-grid">${data.bazi.pillars.map(pillar => `<article><span>${e(pillar.label)}</span><strong>${e(pillar.gan)}${e(pillar.zhi)}</strong><b>${e(pillar.stemDisplay.name)}</b><small>${e(pillar.shiShenDisplay.name)}</small></article>`).join("")}</div>
        <div class="fact-grid">
          <article><span>Дневной хозяин</span><h3>${e(data.bazi.dayMasterDisplay?.name || "—")} · <i>${e(data.bazi.dayMaster)}</i></h3><p>Дневной хозяин — центральный элемент карты Ба-цзы. Здесь показан рассчитанный параметр без психологической интерпретации.</p></article>
          <article><span>Баланс карты</span><h3>${e(data.bazi.strength.display.name)}</h3><p>Показывает, насколько основной элемент карты получает поддержку от остальных элементов. Это не оценка «хорошо» или «плохо», а характеристика внутреннего баланса.</p></article>
          <article><span>Текущий большой период</span><h3>${current ? `${e(current.years)} · ${e(current.ganZhi)}` : "Не определён"}</h3><p>${current ? `${e(current.range)} · ${e(current.detailDisplay.map(item => item.name).join(" · "))}` : "Период не входит в первые рассчитанные циклы."}</p></article>
        </div>
        <div class="elements-card"><div><span>Пять элементов</span><h3>Внутреннее соотношение карты</h3><p>График показывает рассчитанное присутствие Дерева, Огня, Земли, Металла и Воды.</p></div><div class="elements-bars">${data.bazi.elements.map(item => `<div><b>${e(item.name)} <small>${e(item.original)}</small></b><i><span style="width:${Math.max(4, Number(item.value) / maxElement * 100)}%"></span></i><strong>${e(item.value)}</strong></div>`).join("")}</div></div>
      </section>

      <section class="preview-section ziwei-section" aria-labelledby="ziwei-title">
        <div class="preview-heading"><div><span>02 · 紫微斗数</span><h2 id="ziwei-title">Ваша карта Цзы Вэй</h2></div><p>Двенадцать дворцов описывают разные жизненные сферы. Ниже — ключевые рассчитанные параметры.</p></div>
        <div class="ziwei-facts">
          <article><span>Лунная дата</span><b>${e(data.ziwei.lunarDate)}</b></article>
          <article><span>Дворец судьбы</span><b>${e(data.ziwei.mingPalace.displayName?.name || data.ziwei.mingPalace.branch)}</b><small>${e(data.ziwei.mingPalace.displayName?.original || "")} · ${e(data.ziwei.mingPalace.branch)}</small></article>
          <article><span>Дворец тела</span><b>${e(data.ziwei.shenPalace.displayName?.name || data.ziwei.shenPalace.branch)}</b><small>${e(data.ziwei.shenPalace.displayName?.original || "")} · ${e(data.ziwei.shenPalace.branch)}</small></article>
          <article><span>Система элементов</span><b>${e(data.ziwei.fiveElementBureau.name)}</b><small>${e(data.ziwei.fiveElementBureau.original)}</small></article>
          <article class="current-palace"><span>Текущий дворец · ${e(currentPalace?.majorPeriod || "—")} лет</span><b>${e(currentPalace?.displayName?.name || "Не определён")}</b><small>${e(currentPalace?.ganZhi || "")}</small></article>
        </div>
        <div class="transformations"><span>Четыре трансформации</span><div>${data.ziwei.transformations.map(item => `<p><b>${e(item.name)}</b><small>${e(item.original)}</small></p>`).join("")}</div></div>
        <details class="technical-chart"><summary><span><b class="disclosure-open">Открыть 12 дворцов и звёзды</b><b class="disclosure-close">Скрыть 12 дворцов и звёзды</b><small>Подробные рассчитанные данные карты</small></span><i aria-hidden="true"></i></summary><div class="palaces-grid">${data.ziwei.palaces.map(renderPalace).join("")}</div></details>
      </section>
    </div>

    <section class="premium-teaser" data-state="PREMIUM_LOCKED">
      <div class="shell"><header><p class="section-label">Следующий слой</p><h2>Карта рассчитана. Теперь можно понять, что она говорит именно о вас.</h2><p>Полный персональный разбор соединяет обе традиции и объясняет, как особенности карты могут проявляться в характере, работе, деньгах, отношениях и текущем жизненном периоде.</p></header>
        <div class="locked-grid">${premiumSections().map((item, index) => `<article><span aria-hidden="true">${String(index + 1).padStart(2, "0")}</span><h3>${e(item.title)}</h3><p>${e(item.description)}</p></article>`).join("")}</div>
        <div class="premium-action"><button type="button" class="premium-button" data-action="premium">Получить полный персональный разбор</button><p>Ба-цзы + Цзы Вэй · персональная интерпретация · PDF-отчёт</p><div class="premium-message" role="status" tabindex="-1" hidden>Полный разбор скоро будет доступен.</div></div>
      </div>
    </section>
  </section>`;
}

function renderPalace(palace) {
  const stars = palace.mainStars.length ? palace.mainStars.map(star => `<span>${e(star.name)} <small>${e(star.original)}</small></span>`).join("") : "<span>Основные звёзды не указаны</span>";
  return `<article class="${palace.isCurrentPeriod ? "active" : ""}"><header><b>${e(palace.displayName.name)}</b><span>${e(palace.ganZhi)}</span></header><p>${stars}</p><footer>${e(palace.majorPeriod)} лет${palace.isMing ? " · Дворец судьбы" : ""}${palace.isShen ? " · Дворец тела" : ""}</footer></article>`;
}

function premiumSections() {
  return [
    { title: "Характер и внутренние мотивы", description: "Решения, внутренний ресурс и противоречия" },
    { title: "Сильные стороны и точки роста", description: "Качества, которые легче превращать в результат" },
    { title: "Карьера и реализация", description: "Роли, рабочая среда и возможные направления роста" },
    { title: "Деньги", description: "Ресурсы, риск и стиль финансовых решений" },
    { title: "Отношения", description: "Близость, партнёрство и личные границы" },
    { title: "Текущий жизненный период", description: "Темы, заметные на нынешнем этапе" },
    { title: "Ближайшие годы", description: "Изменение акцентов и фокуса периода" },
    { title: "Персональный план действий", description: "Практические ориентиры и точки приложения усилий" },
  ];
}

function bindPreviewActions() {
  document.querySelector('[data-action="premium"]')?.addEventListener("click", event => {
    const message = event.currentTarget.parentElement.querySelector(".premium-message");
    message.hidden = false;
    message.focus?.();
  });
}

async function searchPlaces(query) {
  try {
    const response = await fetch(`/api/places?q=${encodeURIComponent(query)}`);
    const payload = await response.json();
    renderPlaceOptions(response.ok ? payload.places : []);
  } catch { renderPlaceOptions([]); }
}

function renderPlaceOptions(places) {
  placeOptions.innerHTML = places.map((place, index) => `<button type="button" role="option" data-index="${index}">${e(place.display.label)}</button>`).join("");
  placeOptions.hidden = places.length === 0;
  placeInput.setAttribute("aria-expanded", String(places.length > 0));
  placeOptions.querySelectorAll("button").forEach((button, index) => button.addEventListener("click", () => {
    selectedPlace = places[index];
    placeInput.value = selectedPlace.display.label;
    renderPlaceOptions([]);
  }));
}

function showAmbiguity(options) {
  setState("INITIAL");
  ambiguityBox.hidden = false;
  ambiguityBox.innerHTML = `<p>В этот день часы переводили назад. Выберите, к какому времени относится запись:</p>${options.map(option => `<button type="button" data-occurrence="${e(option.value)}">${e(option.label)}</button>`).join("")}`;
  ambiguityBox.querySelectorAll("button").forEach(button => button.addEventListener("click", () => submitFreeCalculation(button.dataset.occurrence)));
}

function setState(state) {
  form.dataset.state = state;
  const loading = state === "CALCULATING";
  submitButton.disabled = loading;
  buttonLabel.textContent = loading ? "Рассчитываем вашу карту…" : "Рассчитать мою карту";
}

function showError(message) {
  errorBox.hidden = !message;
  errorBox.textContent = message;
}

function formatDate(value) {
  const [year, month, day] = String(value).split("-");
  return day && month && year ? `${day}.${month}.${year}` : value;
}

function e(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}
