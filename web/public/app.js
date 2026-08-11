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
let currentInput = null;
let currentReport = null;
let currentHasFullReport = false;

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
form.addEventListener("submit", async event => { event.preventDefault(); await submitCalculation(); });

async function submitCalculation(timeOccurrence) {
  showError(""); ambiguityBox.hidden = true;
  const data = new FormData(form);
  const date = String(data.get("date") || "");
  const time = String(data.get("time") || "");
  const gender = String(data.get("gender") || "");
  if (!date) return showError("Укажите дату рождения.");
  if (!time) return showError("Укажите время рождения.");
  if (!selectedPlace) return showError("Выберите место рождения из списка подсказок.");
  if (!gender) return showError("Выберите пол.");
  currentInput = { date, time, gender, placeId: selectedPlace.id, ...(timeOccurrence ? { timeOccurrence } : {}) };
  currentReport = null; currentHasFullReport = false;
  setLoading(true);
  try {
    const response = await fetch("/api/calculate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(currentInput) });
    const payload = await response.json();
    if (response.status === 409 && payload.code === "AMBIGUOUS_LOCAL_TIME") return showAmbiguity(payload.options || []);
    if (!response.ok) throw new Error(payload.error || "Не удалось выполнить расчёт.");
    resultRoot.innerHTML = renderBaseResult(payload.chart, payload.metadata);
    bindResultActions();
    resultRoot.scrollIntoView({ behavior: "smooth", block: "start" });
    setLoading(false);
    await loadPersonalReport(payload.chart, payload.metadata);
  } catch (error) {
    resultRoot.innerHTML = "";
    showError(error instanceof Error ? error.message : "Не удалось выполнить расчёт. Попробуйте ещё раз.");
    setLoading(false);
  }
}

async function loadPersonalReport(chart, metadata) {
  updateAiState("loading", "Готовим персональный разбор…", "Сопоставляем BaZi и Zi Wei, выделяем устойчивые выводы.");
  try {
    const response = await fetch("/api/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(currentInput) });
    const payload = await response.json();
    if (!response.ok || payload.aiStatus === "error") throw new Error(payload.error || "Не удалось подготовить персональный разбор.");
    if (payload.aiStatus === "unavailable") return updateAiState("unavailable", payload.message, "Техническая карта и PDF с расчётом уже доступны.");
    currentReport = payload.report;
    currentHasFullReport = payload.hasFullReport;
    const container = document.querySelector("#personal-report");
    if (container) container.innerHTML = renderPersonalReport(payload.report, payload.hasFullReport, chart, metadata);
    bindResultActions();
  } catch (error) {
    updateAiState("error", "Персональный разбор сейчас не удалось подготовить.", "Техническая карта остаётся доступна — расчёт не потерян.");
  }
}

function renderBaseResult(chart, metadata) {
  return `<section class="report-shell">
    <header class="report-cover shell">
      <div class="cover-kicker"><span>Ваш персональный разбор</span><i></i><span>BaZi × Zi Wei</span></div>
      <h2>Карта готова.<br><em>Теперь — к главному.</em></h2>
      <p>${e(metadata.originalBirthDate)} · ${e(metadata.originalBirthTime)} · ${e(metadata.place.name)}</p>
      <div class="cover-actions"><button class="pdf-button" data-action="pdf">Скачать полный отчёт PDF <span>↓</span></button><button class="text-button" data-action="technical">Техническая карта</button></div>
    </header>
    <div id="personal-report" class="personal-report shell">${renderAiState("loading", "Готовим персональный разбор…", "Сопоставляем две системы и собираем понятную картину.")}</div>
    ${renderTechnical(chart, metadata)}
  </section>`;
}

function renderPersonalReport(report, full, chart, metadata) {
  if (!full) return `<section class="archetype-block"><p class="section-label">Ваш архетип</p><h2>${e(report.archetype)}</h2><h3>${e(report.subtitle)}</h3><blockquote>${e(report.oneLineFormula)}</blockquote></section>
    <section class="report-section lead"><p class="section-label">Короткий портрет</p><p>${paragraphs(report.executiveSummary)}</p></section>
    ${renderStrengths(report.strengths)}${renderChallenges(report.challenges)}
    <section class="locked-report"><span>Полный отчёт</span><h2>Карьера, деньги, отношения, периоды и план действий</h2><p>Архитектура полной версии уже готова. В текущем режиме открыт бесплатный preview.</p></section>`;
  return `<section class="archetype-block"><p class="section-label">Ваш архетип</p><h2>${e(report.archetype)}</h2><h3>${e(report.subtitle)}</h3><blockquote>${e(report.oneLineFormula)}</blockquote><div class="birth-caption">${e(metadata.originalBirthDate)} · ${e(metadata.originalBirthTime)} · ${e(metadata.birthPlace)}</div></section>
    <section class="report-section lead"><p class="section-label">В двух словах</p><h2>Главное о вас</h2><div class="prose">${paragraphs(report.executiveSummary)}</div></section>
    <section class="report-section"><p class="section-label">Внутренний портрет</p><h2>Как устроена ваша личность</h2><div class="prose narrow">${paragraphs(report.personality)}</div></section>
    ${renderTraits(report.keyTraits)}${renderStrengths(report.strengths)}${renderChallenges(report.challenges)}
    ${renderComparison(report.externalVsInternal)}${renderStress(report.stressPattern)}
    ${renderLongSection("Карьера", "Работа, роль и профессиональный рост", report.career, "career")}
    ${renderLongSection("Деньги", "Ваш финансовый стиль", report.money, "money")}
    ${renderLongSection("Отношения", "Близость, выбор и конфликты", report.relationships, "relationships")}
    ${renderMiniGrid("Люди и окружение", report.environment)}${renderMiniGrid("Лидерство и конфликты", report.leadership)}${renderMiniGrid("Образ жизни и ресурс", report.lifestyle)}
    ${renderCurrentPeriod(report.currentPeriod)}${renderYears(report.yearlyOutlook)}${renderTransitions(report.keyLifeTransitions)}${renderScenarios(report.scenarios)}
    ${renderMatrix(report.lifeAreaMatrix)}${renderCrossValidation(report.crossValidation)}${renderConfidence(report.confidence)}${renderActionPlan(report.actionPlan)}${renderSelfCheck(report.selfCheck)}
    <section class="report-section final-summary"><p class="section-label">Итог</p><h2>Ваша главная линия</h2><div class="prose">${paragraphs(report.finalSummary)}</div></section>`;
}

function renderAiState(kind, title, text) { return `<section class="ai-state ${e(kind)}"><div class="pulse" aria-hidden="true"></div><div><p class="section-label">Персональная интерпретация</p><h2>${e(title)}</h2><p>${e(text)}</p></div></section>`; }
function updateAiState(kind, title, text) { const root = document.querySelector("#personal-report"); if (root) root.innerHTML = renderAiState(kind, title, text); }

function renderTraits(items) { return `<section class="report-section"><p class="section-label">Пять главных черт</p><h2>Ваш характер в деталях</h2><div class="trait-list">${items.map((item, i) => `<article><span>0${i + 1}</span><div><h3>${e(item.title)}</h3><p>${e(item.explanation)}</p><div class="trait-poles"><p><b>В ресурсе</b>${e(item.positive)}</p><p><b>В перегрузе</b>${e(item.shadow)}</p></div><small>Основания карты: ${e(item.evidence.join(" · "))}</small></div></article>`).join("")}</div></section>`; }
function renderStrengths(items) { return `<section class="report-section tone-sage"><p class="section-label">Ваши ресурсы</p><h2>Сильные стороны</h2><div class="card-grid">${items.map(item => `<article><h3>${e(item.title)}</h3><p>${e(item.essence)}</p>${item.manifestation ? `<small>${e(item.manifestation)}</small><b>${e(item.practicalUse)}</b>` : ""}</article>`).join("")}</div></section>`; }
function renderChallenges(items) { return `<section class="report-section"><p class="section-label">Зоны внимания</p><h2>Что может мешать</h2><div class="challenge-grid">${items.map(item => `<article><h3>${e(item.pattern)}</h3><p><b>Когда:</b> ${e(item.trigger || "—")}</p><p><b>Риск:</b> ${e(item.consequence || "—")}</p><p class="remedy">${e(item.compensation || "")}</p></article>`).join("")}</div></section>`; }
function renderComparison(data) { return `<section class="report-section comparison"><p class="section-label">Два слоя</p><h2>Как вас видят — и что внутри</h2><div><article><span>Снаружи</span><p>${e(data.external)}</p></article><article><span>Внутри</span><p>${e(data.internal)}</p></article></div><blockquote>${e(data.synthesis)}</blockquote></section>`; }
function renderStress(data) { return `<section class="report-section"><p class="section-label">Под давлением</p><h2>Стресс и принятие решений</h2><div class="process-line"><article><span>01</span><h3>Реакция</h3><p>${e(data.reaction)}</p></article><article><span>02</span><h3>Ошибка</h3><p>${e(data.mistakes)}</p></article><article><span>03</span><h3>Восстановление</h3><p>${e(data.recovery)}</p></article></div><p class="editorial-note"><b>Лучше не делать:</b> ${e(data.avoid)}</p></section>`; }
function renderLongSection(label, title, text, cls) { return `<section class="report-section long-read ${cls}"><p class="section-label">${e(label)}</p><h2>${e(title)}</h2><div class="prose">${paragraphs(text)}</div></section>`; }
function renderMiniGrid(title, data) { const labels = {supports:"Что усиливает",drains:"Что истощает",allies:"Союзники",toxicPatterns:"Опасные паттерны",communication:"Общение",style:"Стиль",control:"Контроль",authority:"Авторитет",conflict:"В споре",negotiation:"Договорённости",mistakes:"Ошибки",rhythm:"Ритм",intensity:"Интенсивность",stabilityVsChange:"Стабильность и перемены",rest:"Отдых",overload:"Перегруз",recovery:"Восстановление",environment:"Среда"}; return `<section class="report-section compact"><p class="section-label">${e(title)}</p><div class="mini-grid">${Object.entries(data).map(([key,value])=>`<article><span>${e(labels[key] || key)}</span><p>${e(value)}</p></article>`).join("")}</div></section>`; }
function renderCurrentPeriod(data) { return `<section class="report-section period-feature"><p class="section-label">Сейчас</p><h2>${e(data.period)}</h2><h3>${e(data.theme)}</h3><div class="period-grid">${[["Возможности",data.opportunities],["Риски",data.risks],["Карьера",data.career],["Отношения",data.relationships],["Деньги",data.money],["Чему учит",data.lesson]].map(([a,b])=>`<article><span>${e(a)}</span><p>${e(b)}</p></article>`).join("")}</div></section>`; }
function renderYears(items) { return `<section class="report-section"><p class="section-label">Ближайший горизонт</p><h2>Следующие три года</h2><div class="year-timeline">${items.map(item=>`<article><strong>${e(item.year)}</strong><div><h3>${e(item.theme)}</h3><p>${e(item.opportunities)}</p><small><b>Фокус:</b> ${e(item.focus)}</small><small><b>Не форсировать:</b> ${e(item.avoid)}</small></div></article>`).join("")}</div></section>`; }
function renderTransitions(items) { return `<section class="report-section"><p class="section-label">Длинная перспектива</p><h2>Ключевые переходы</h2><div class="transitions">${items.map(item=>`<article><span>${e(item.age)}</span><div><small>${e(item.period)}</small><h3>${e(item.theme)}</h3><p>${e(item.change)}</p></div></article>`).join("")}</div></section>`; }
function renderScenarios(items) { return `<section class="report-section tone-dark"><p class="section-label">Выбор, а не предсказание</p><h2>Три возможных сценария</h2><div class="scenario-grid">${items.map(item=>`<article><span>${e(item.type)}</span><h3>${e(item.title)}</h3><p>${e(item.description)}</p><small>${e(item.decisions)}</small></article>`).join("")}</div></section>`; }
function renderMatrix(items) { return `<section class="report-section"><p class="section-label">Две системы</p><h2>Матрица жизненных сфер</h2><div class="matrix">${items.map(item=>`<article><header><h3>${e(item.area)}</h3><span class="alignment">${e(item.alignment)}</span></header><p><b>BaZi</b>${e(item.bazi)}</p><p><b>Zi Wei</b>${e(item.ziwei)}</p><footer>${e(item.synthesis)}</footer></article>`).join("")}</div></section>`; }
function renderCrossValidation(data) { return `<section class="report-section"><p class="section-label">Cross-validation</p><h2>Где выводы устойчивее</h2><div class="validation-grid"><article><span>Подтверждают</span>${list(data.agreements)}</article><article><span>Расходятся</span>${list(data.divergences)}</article><article><span>Устойчивые выводы</span>${list(data.stableConclusions)}</article><article><span>Требуют осторожности</span>${list(data.weakerConclusions)}</article></div></section>`; }
function renderConfidence(items) { return `<section class="report-section compact"><p class="section-label">Уверенность</p><div class="confidence-list">${items.map(item=>`<article><span class="confidence ${e(item.level.toLowerCase())}">${e(item.level)}</span><div><h3>${e(item.conclusion)}</h3><p>${e(item.reason)}</p></div></article>`).join("")}</div></section>`; }
function renderActionPlan(data) { return `<section class="report-section action-plan"><p class="section-label">Практический итог</p><h2>План действий</h2><div class="action-columns"><article><h3>Делать чаще</h3>${ordered(data.doMore)}</article><article><h3>Избегать</h3>${ordered(data.avoid)}</article></div><div class="next-focus"><h3>Фокус на 12 месяцев</h3>${list(data.next12Months)}</div></section>`; }
function renderSelfCheck(items) { return `<section class="report-section self-check"><p class="section-label">Проверьте на себе</p><h2>Насколько это про вас?</h2>${items.map((item,i)=>`<article><span>${String(i+1).padStart(2,"0")}</span><p>${e(item)}</p></article>`).join("")}</section>`; }

function renderTechnical(chart, metadata) { const max = Math.max(...Object.values(chart.bazi.elements),1); return `<section class="technical shell" id="technical-chart"><details><summary><span>Техническая карта BaZi и Zi Wei</span><small>Для специалистов и проверки расчёта</small></summary><div class="technical-body">
  <details class="method-details"><summary>Как учитывается место рождения</summary><p>Мы автоматически учитываем место рождения, исторический часовой пояс и положение города, чтобы корректно интерпретировать время рождения.</p>${metadata.calculationSensitivity === "HIGH" ? `<small>Время рождения находится близко к чувствительной границе расчёта.</small>` : ""}</details>
  <h3>BaZi · четыре столпа</h3><div class="pillars-grid">${chart.bazi.pillars.map(p=>`<article><span>${e(p.label)}</span><strong>${e(p.gan)}${e(p.zhi)}</strong><small>${e(p.shiShen)}</small></article>`).join("")}</div>
  <div class="technical-facts"><p><span>Дневной хозяин</span><b>${e(chart.bazi.dayMaster)}</b></p><p><span>Структура</span><b>${e(chart.bazi.structure)}</b></p><p><span>Сила</span><b>${e(chart.bazi.strength.verdict)}</b></p><p><span>Регулирующие</span><b>${e(chart.bazi.regulating.join(" · ") || "—")}</b></p></div>
  <div class="elements-list">${Object.entries(chart.bazi.elements).map(([name,value])=>`<div><b>${e(name)}</b><i><span style="width:${Number(value)/max*100}%"></span></i><small>${e(value)}</small></div>`).join("")}</div>
  <h3>Большие периоды BaZi</h3><div class="period-strip">${chart.bazi.majorPeriods.map(item=>`<article><b>${e(item.ganZhi)}</b><span>${e(item.range)}</span><small>${e(item.years)}</small></article>`).join("")}</div>
  <h3>Zi Wei · двенадцать дворцов</h3><div class="technical-facts"><p><span>Лунная дата</span><b>${e(chart.ziwei.lunarDate)}</b></p><p><span>Дворец судьбы</span><b>${e(chart.ziwei.mingPalace)}</b></p><p><span>Дворец тела</span><b>${e(chart.ziwei.shenPalace)}</b></p><p><span>Пять элементов</span><b>${e(chart.ziwei.fiveElementBureau)}</b></p></div>
  <div class="palaces-grid">${chart.ziwei.palaces.map(item=>`<article><header><b>${e(item.name)}</b><span>${e(item.ganZhi)}</span></header><p>${e(item.mainStars.join(" · ") || "Без главной звезды")}</p><small>${e(item.auxStars.join(" · ") || "—")}</small></article>`).join("")}</div>
  </div></details></section>`; }

async function downloadPdf(button) {
  if (!currentInput) return;
  const original = button.innerHTML; button.disabled = true; button.textContent = "Создаём PDF…";
  try {
    const payload = { ...currentInput, ...(currentHasFullReport && currentReport ? { report: currentReport } : {}) };
    const response = await fetch("/api/pdf", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
    if (!response.ok) { const error = await response.json(); throw new Error(error.error || "Не удалось создать PDF."); }
    const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = `tian-ming-report-${currentInput.date}.pdf`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  } catch (error) { showError(error instanceof Error ? error.message : "Не удалось создать PDF."); }
  finally { button.disabled = false; button.innerHTML = original; }
}

function bindResultActions() { document.querySelectorAll('[data-action="pdf"]').forEach(button=>button.onclick=()=>downloadPdf(button)); document.querySelectorAll('[data-action="technical"]').forEach(button=>button.onclick=()=>{const details=document.querySelector("#technical-chart details"); if(details){details.open=true;details.scrollIntoView({behavior:"smooth"});}}); }
async function searchPlaces(query) { try { const response=await fetch(`/api/places?q=${encodeURIComponent(query)}`); const payload=await response.json(); if(placeInput.value.trim()===query) renderPlaceOptions(response.ok?payload.places:[]); } catch { renderPlaceOptions([]); } }
function renderPlaceOptions(places) { placeOptions.innerHTML=places.map((place,index)=>`<button type="button" role="option" data-index="${index}"><strong>${e(place.city)}</strong><span>${e([place.region,place.country].filter(Boolean).join(", "))}</span></button>`).join(""); placeOptions.hidden=!places.length; placeInput.setAttribute("aria-expanded",String(Boolean(places.length))); placeOptions.querySelectorAll("button").forEach((button,index)=>button.addEventListener("click",()=>{selectedPlace=places[index];placeInput.value=selectedPlace.label;renderPlaceOptions([]);showError("");})); }
function showAmbiguity(options) { setLoading(false); ambiguityBox.innerHTML=`<p>В эту ночь указанное время наступало дважды. Выберите вариант:</p>${options.map(option=>`<button type="button" data-value="${e(option.value)}">${e(option.label)}</button>`).join("")}`; ambiguityBox.hidden=false; ambiguityBox.querySelectorAll("button").forEach(button=>button.addEventListener("click",()=>submitCalculation(button.dataset.value))); }
function showError(message) { errorBox.textContent=message; errorBox.hidden=!message; }
function setLoading(loading) { submitButton.disabled=loading; buttonLabel.textContent=loading?"Рассчитываем карту…":"Получить мой разбор"; }
function paragraphs(value) { return String(value||"").split(/\n{2,}/).map(p=>`<p>${e(p)}</p>`).join(""); }
function list(items) { return `<ul>${items.map(item=>`<li>${e(item)}</li>`).join("")}</ul>`; }
function ordered(items) { return `<ol>${items.map(item=>`<li>${e(item)}</li>`).join("")}</ol>`; }
function e(value) { return String(value??"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]); }
