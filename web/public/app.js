const form = document.querySelector("#birth-form");
const errorBox = document.querySelector("#form-error");
const submitButton = document.querySelector("#submit-button");
const buttonLabel = submitButton.querySelector(".button-label");
const resultRoot = document.querySelector("#result-root");
const placeInput = document.querySelector("#birth-place");
const placeOptions = document.querySelector("#place-options");
const placeFallback = document.querySelector("#place-fallback");
const timeZoneInput = document.querySelector("#birth-timezone");
const timeZoneOptions = document.querySelector("#timezone-options");
const ambiguityBox = document.querySelector("#ambiguity-box");
const siteHeader = document.querySelector(".site-header");
const heroLayout = document.querySelector(".hero-layout");
const mobileFormSlot = document.querySelector("#mobile-form-slot");
const timeCertaintyHelper = document.querySelector("#time-certainty-helper");
let selectedPlace = null;
let searchTimer = null;
let placeResults = [];
let activePlaceIndex = -1;
let placeSearchSequence = 0;
let selectedTimeZone = "";
let timeZoneResults = [];
let timeZoneSearchTimer = null;
let timeZoneSearchSequence = 0;
let currentBirthInput = null;
let premiumBusy = false;
let premiumConfig = null;
let paymentPollTimer = null;

const mobileFormMedia = typeof matchMedia === "function" ? matchMedia("(max-width: 620px)") : null;
function syncMobileFormPosition() {
  if (!mobileFormMedia || !heroLayout || !mobileFormSlot) return;
  const destination = mobileFormMedia.matches ? mobileFormSlot : heroLayout;
  if (form.parentElement !== destination) destination.appendChild(form);
}
function syncHeaderHeight() {
  if (!siteHeader?.getBoundingClientRect || !document.documentElement?.style) return;
  document.documentElement.style.setProperty("--site-header-height", `${Math.ceil(siteHeader.getBoundingClientRect().height)}px`);
}
syncMobileFormPosition();
syncHeaderHeight();
if (mobileFormMedia?.addEventListener) mobileFormMedia.addEventListener("change", syncMobileFormPosition);
else mobileFormMedia?.addListener?.(syncMobileFormPosition);
if (typeof ResizeObserver === "function" && siteHeader) new ResizeObserver(syncHeaderHeight).observe(siteHeader);
if (typeof addEventListener === "function") addEventListener("orientationchange", syncHeaderHeight);

placeInput.addEventListener("input", () => {
  selectedPlace = null;
  ambiguityBox.hidden = true;
  clearTimeout(searchTimer);
  const query = placeInput.value.trim();
  const sequence = ++placeSearchSequence;
  if (query.length < 2) return renderPlaceOptions([]);
  searchTimer = setTimeout(() => searchPlaces(query, sequence), 180);
});
timeZoneInput.addEventListener("input", () => {
  selectedTimeZone = "";
  clearTimeout(timeZoneSearchTimer);
  const query = timeZoneInput.value.trim();
  const sequence = ++timeZoneSearchSequence;
  if (query.length < 2) return renderTimeZoneOptions([]);
  timeZoneSearchTimer = setTimeout(() => searchTimeZones(query, sequence), 180);
});
placeInput.addEventListener("keydown", event => {
  if (event.key === "Escape") return renderPlaceOptions([]);
  if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key) || placeResults.length === 0) return;
  if (event.key === "Enter" && activePlaceIndex < 0) return;
  event.preventDefault();
  if (event.key === "ArrowDown") activePlaceIndex = (activePlaceIndex + 1) % placeResults.length;
  if (event.key === "ArrowUp") activePlaceIndex = (activePlaceIndex - 1 + placeResults.length) % placeResults.length;
  if (event.key === "Enter") return selectPlace(activePlaceIndex);
  updateActivePlaceOption();
});
document.addEventListener("click", event => { if (!event.target.closest(".place-field")) renderPlaceOptions([]); });
form.addEventListener("submit", async event => { event.preventDefault(); await submitFreeCalculation(); });
form.addEventListener("change", event => {
  if (event.target?.name !== "birthTimeCertainty") return;
  timeCertaintyHelper.hidden = event.target.value !== "approximate";
});

async function submitFreeCalculation(timeOccurrence) {
  clearTimeout(paymentPollTimer);
  showError("");
  ambiguityBox.hidden = true;
  const data = new FormData(form);
  const input = {
    name: String(data.get("name") || "").trim().replace(/\s+/g, " "),
    date: String(data.get("date") || ""),
    time: String(data.get("time") || ""),
    birthTimeCertainty: String(data.get("birthTimeCertainty") || "exact"),
    gender: String(data.get("gender") || ""),
    placeId: selectedPlace?.id || "",
    ...(selectedTimeZone ? { timeZoneOverride: selectedTimeZone } : {}),
    ...(timeOccurrence ? { timeOccurrence } : {}),
  };
  if (!input.date) return showError("Укажите дату рождения.");
  if (!input.time) return showError("Укажите время рождения.");
  if (!selectedPlace) { placeFallback.hidden = false; return showError("Выберите место из списка подсказок. Если его нет, укажите ближайший крупный город."); }
  if (timeZoneInput.value.trim() && !selectedTimeZone) return showError("Выберите часовой пояс из списка подсказок.");
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
    currentBirthInput = input;
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
      <div class="birth-summary"><span>${e(formatDate(data.person.date))}</span><span>${e(data.person.time)}${data.person.birthTimeCertainty === "approximate" ? " · указано примерно" : ""}</span><span>${e(data.person.birthPlace?.label || "")}</span></div>
    </header>

    <div class="preview-body shell">
      <section class="preview-section" aria-labelledby="bazi-title">
        <div class="preview-heading"><div><span>01 · 八字</span><h2 id="bazi-title">Ваша карта Ба-цзы</h2></div><p>Четыре столпа — это базовая структура карты рождения: год, месяц, день и час.</p></div>
        <div class="pillars-grid">${data.bazi.pillars.map(pillar => `<article><span>${e(pillar.label)}</span><strong>${e(pillar.gan)}${e(pillar.zhi)}</strong><div class="pillar-parts"><b><i>${e(pillar.gan)} ·</i>${e(compactStemName(pillar.stemDisplay.name))}</b><b><i>${e(pillar.zhi)} ·</i>${e(compactBranchName(pillar.branchDisplay.name))}</b></div><small><b>${e(pillar.shiShenDisplay.name)}</b></small></article>`).join("")}</div>
        <div class="fact-grid">
          <article><span>Дневной хозяин</span><h3>${e(data.bazi.dayMasterDisplay?.name || "—")} · <i>${e(data.bazi.dayMaster)}</i></h3><p>Дневной хозяин — центральный элемент карты Ба-цзы. Здесь показан рассчитанный параметр без психологической интерпретации.</p></article>
          <article><span>Баланс карты</span><h3>${e(primaryStrengthName(data.bazi.strength))}</h3><p>Показывает, насколько основной элемент карты получает поддержку от остальных элементов. Это не оценка «хорошо» или «плохо», а характеристика внутреннего баланса.</p></article>
          <article><span>Текущий большой период</span><h3>${current ? e(current.years) : "Не определён"}</h3>${current ? `<div class="current-period-ganzhi"><b>${e(current.ganZhi)}</b><small>${e(current.gan)} · ${e(compactStemName(current.stemDisplay.name))}<br>${e(current.zhi)} · ${e(compactBranchName(current.branchDisplay.name))}</small></div><p>${e(current.range)} · ${e(current.detailDisplay.map(item => item.name).join(" · "))}</p>` : "<p>Период не входит в первые рассчитанные циклы.</p>"}</article>
        </div>
        <div class="elements-card"><div><span>Пять элементов</span><h3>Внутреннее соотношение карты</h3><p>График показывает рассчитанное присутствие Дерева, Огня, Земли, Металла и Воды.</p></div><div class="elements-bars">${data.bazi.elements.map(item => `<div><b>${e(item.name)} <small>${e(item.original)}</small></b><i><span style="width:${Math.max(4, Number(item.value) / maxElement * 100)}%"></span></i><strong>${e(item.displayValue ?? item.value)}</strong></div>`).join("")}</div></div>
      </section>

      <section class="preview-section ziwei-section" aria-labelledby="ziwei-title">
        <div class="preview-heading"><div><span>02 · 紫微斗数</span><h2 id="ziwei-title">Ваша карта Цзы Вэй</h2></div><p>Двенадцать дворцов описывают разные жизненные сферы. Ниже — ключевые рассчитанные параметры.</p></div>
        <div class="ziwei-summary-intro"><span>Ключевые параметры карты Цзы Вэй</span><p>Здесь собраны ключевые рассчитанные параметры карты Цзы Вэй.</p></div>
        <div class="ziwei-facts">
          <article><span>Лунная дата</span><b class="lunar-date">${lunarDateLines(data.ziwei).map(line => `<i class="lunar-date-line">${e(line)}</i>`).join("")}</b></article>
          <article><span>Дворец судьбы</span><b>${e(data.ziwei.mingPalace.displayName?.name || data.ziwei.mingPalace.branch)}</b><small>${e(data.ziwei.mingPalace.displayName?.original || "")} · ${e(data.ziwei.mingPalace.branch)}</small></article>
          <article><span>Дворец тела</span><b>${data.ziwei.shenPalace.displayName?.name ? `Находится во дворце ${e(lowerFirst(data.ziwei.shenPalace.displayName.name.replace(/^Дворец\s+/, "")))}` : e(data.ziwei.shenPalace.branch)}</b><small>${e(data.ziwei.shenPalace.displayName?.original || "")} · ${e(data.ziwei.shenPalace.branch)}</small></article>
          <article><span>Система элементов</span><b>${e(conciseBureauName(data.ziwei.fiveElementBureau.name))}</b><small>${e(data.ziwei.fiveElementBureau.original)}</small></article>
        </div>
        <div class="transformations"><header><span>Четыре трансформации</span><p>Четыре трансформации показывают, какие звёзды получают в карте дополнительные акценты.</p></header><div>${data.ziwei.transformations.map(item => `<p><b>${e(item.name)}</b><small>${e(item.original)}</small></p>`).join("")}</div></div>
        <article class="current-palace"><div><span>Текущий дворец · ${e(currentPalace?.majorPeriod || "—")} лет</span><b>${e(currentPalace?.displayName?.name || "Не определён")}</b><small>${e([currentPalace?.displayName?.original, currentPalace?.ganZhi].filter(Boolean).join(" · "))}</small></div></article>
        <details class="technical-chart"><summary><span><b class="disclosure-open">Посмотреть полную карту 12 дворцов</b><b class="disclosure-close">Скрыть полную карту 12 дворцов</b><small>Все жизненные сферы и рассчитанные звёзды</small></span><i aria-hidden="true"></i></summary><div class="palaces-grid">${data.ziwei.palaces.map(renderPalace).join("")}</div></details>
      </section>
    </div>

    <section class="premium-teaser" data-state="PREMIUM_LOCKED">
      <div class="shell"><header><p class="section-label">Следующий слой</p><h2>Карта рассчитана. Теперь можно понять, что она говорит именно о вас.</h2><p>Полный персональный разбор соединяет обе традиции и объясняет, как особенности карты могут проявляться в характере, работе, деньгах, отношениях и текущем жизненном периоде.</p></header>
        <div class="locked-grid">${premiumSections().map(item => `<article><h3>${e(item.title)}</h3><p>${e(item.description)}</p></article>`).join("")}</div>
        <div class="premium-action"><button type="button" class="premium-button" data-action="premium">Получить полный персональный разбор</button><p>Ба-цзы + Цзы Вэй · персональный разбор · PDF-отчёт</p><div class="premium-message" role="status" tabindex="-1" hidden>Полный разбор скоро будет доступен.</div></div>
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
    { title: "Объединённый разбор Ба-цзы и Цзы Вэй", description: "Обе традиции в одном цельном портрете" },
    { title: "Полный PDF-отчёт", description: "Готовый персональный материал для повторного чтения" },
  ];
}

function bindPreviewActions() {
  document.querySelector('[data-action="premium"]')?.addEventListener("click", openPremiumOffer);
}

async function openPremiumOffer() {
  if (premiumBusy) return;
  premiumBusy = true;
  try {
    const config = premiumConfig = await api("/api/premium/config");
    const host = document.querySelector(".premium-action");
    if (!config.available) {
      host.innerHTML = '<section class="checkout-panel" data-checkout-state="UNAVAILABLE"><p class="section-label">Полный персональный разбор</p><h3>Оплата пока не открыта</h3><p>Бесплатная карта остаётся доступной. Платёжный способ будет включён после завершения production-настройки.</p></section>';
      return;
    }
    host.innerHTML = `<section class="checkout-panel" data-checkout-state="OFFER"><p class="section-label">Полный персональный разбор</p><h3>Ба-цзы + Цзы Вэй</h3><div class="purchase-summary"><span>Персональный отчёт</span><span>Полный PDF</span></div><div class="offer-price"><b>${e(formatPrice(config.amount, config.currency))}</b>${config.priceIsDevPlaceholder ? "<small>DEV-цена для проверки flow</small>" : ""}</div><button type="button" class="premium-button" data-action="checkout">Перейти к оплате</button><p>Разовая покупка · Персональный разбор · Полный PDF-отчёт</p></section>`;
    host.querySelector('[data-action="checkout"]').addEventListener("click", startCheckout);
    revealCheckout(host);
  } catch (error) { showPremiumError(error.message); }
  finally { premiumBusy = false; }
}

async function startCheckout() {
  if (premiumBusy || !currentBirthInput) return;
  premiumBusy = true;
  try {
    const checkout = await api("/api/premium/checkout", currentBirthInput);
    localStorage.setItem("tianMinOrderId", checkout.order.orderId);
    if (premiumConfig?.paymentMode === "lorentsen") renderConsentCheckout(checkout.order);
    else {
      const payment = await api("/api/premium/payment/start", { orderId: checkout.order.orderId });
      renderPaymentState(payment.order);
    }
  } catch (error) { showPremiumError(error.message); }
  finally { premiumBusy = false; }
}

function renderPaymentState(order) {
  const host = document.querySelector(".premium-action") || resultRoot;
  clearTimeout(paymentPollTimer);
  if (order.paymentProvider === "lorentsen") return renderLorentsenState(host, order);
  if (order.status === "REPORT_READY") return renderReadyState(host, order);
  if (order.status === "REPORT_FAILED") {
    host.innerHTML = `<section class="checkout-panel" data-checkout-state="REPORT_FAILED"><p class="section-label">Оплата подтверждена</p><h3>Разбор не удалось подготовить</h3><p>Оплата сохранена. Повторная попытка не требует нового заказа или платежа.</p><button type="button" class="premium-button" data-action="retry-generation">Попробовать подготовить ещё раз</button></section>`;
    host.querySelector('[data-action="retry-generation"]').addEventListener("click", async () => renderPaymentState((await api("/api/premium/generate", { orderId: order.orderId })).order));
    return;
  }
  if (order.status === "REPORT_GENERATING" || order.status === "PAID") return renderPaidState(host, order);
  if (order.paymentFailureReason) {
    host.innerHTML = `<section class="checkout-panel dev-checkout" data-checkout-state="PAYMENT_FAILED"><p class="dev-badge">DEV · Тестовая оплата</p><h3>Оплата не завершена</h3><p>Бесплатная карта остаётся доступной. Можно безопасно повторить попытку.</p><div class="payment-notice error">Тестовый платёж отклонён</div><button type="button" class="premium-button" data-action="retry-payment">Попробовать ещё раз</button></section>`;
    host.querySelector('[data-action="retry-payment"]').addEventListener("click", async () => { const payment = await api("/api/premium/payment/start", { orderId: order.orderId }); renderPaymentState(payment.order); });
    return;
  }
  host.innerHTML = `<section class="checkout-panel dev-checkout" data-checkout-state="${e(order.status)}"><p class="dev-badge">DEV · Тестовая оплата</p><h3>Проверка платёжного сценария</h3><p>Реальные деньги не списываются. Эта панель недоступна в production.</p><div class="payment-notice">Статус оплаты: ожидает подтверждения</div><button type="button" class="premium-button" data-outcome="succeeded">Симулировать успешную оплату</button><button type="button" class="secondary-checkout-button" data-outcome="failed">Симулировать ошибку оплаты</button></section>`;
  host.querySelectorAll("[data-outcome]").forEach(button => button.addEventListener("click", () => simulatePayment(order.orderId, button.dataset.outcome)));
}

function renderConsentCheckout(order, options = {}) {
  const host = document.querySelector(".premium-action") || resultRoot;
  const config = premiumConfig;
  if (!config?.consent) return showPremiumError("Платёжная форма пока не настроена.");
  host.innerHTML = `<section class="checkout-panel production-checkout" data-checkout-state="CONSENT">
    <p class="section-label">Оплата полного разбора</p><h3>${e(formatPrice(order.amount, order.currency))}</h3>
    <label class="checkout-field">Email для оформления покупки<input type="email" name="payerEmail" autocomplete="email" inputmode="email" enterkeyhint="done" required></label>
    <label class="consent-check"><input type="checkbox" name="termsAccepted"><span>Я принимаю <a href="${e(config.consent.termsUrl)}" target="_blank" rel="noopener noreferrer">условия покупки сертификата Lorentsen</a> и <a href="${e(config.consent.privacyUrl)}" target="_blank" rel="noopener noreferrer">политику конфиденциальности</a></span></label>
    <label class="consent-check"><input type="checkbox" name="autoRedemptionAccepted"><span>Я согласен, что сертификат, приобретаемый этой оплатой, будет немедленно погашен у партнёра «${e(config.partnerPublicName)}». <a href="${e(config.consent.autoRedemptionTermsUrl)}" target="_blank" rel="noopener noreferrer">Подробнее</a></span></label>
    <button type="button" class="premium-button" data-action="confirm-payment" disabled>${e(options.actionLabel || "Перейти к оплате")}</button>
    <button type="button" class="secondary-checkout-button" data-action="leave-payment">Вернуться к результату</button>
    <p>Сумма определяется сервером. После оплаты мы автоматически проверим её статус.</p>
  </section>`;
  const email = host.querySelector('[name="payerEmail"]');
  const terms = host.querySelector('[name="termsAccepted"]');
  const redemption = host.querySelector('[name="autoRedemptionAccepted"]');
  const button = host.querySelector('[data-action="confirm-payment"]');
  const update = () => { button.disabled = !(email.validity.valid && isPlausibleEmail(email.value) && terms.checked && redemption.checked); };
  [email, terms, redemption].forEach(control => control.addEventListener("input", update));
  [terms, redemption].forEach(control => control.addEventListener("change", update));
  email.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    email.blur();
  });
  button.addEventListener("click", () => submitLorentsenPayment(order.orderId, { email: email.value.trim(), termsAccepted: terms.checked, autoRedemptionAccepted: redemption.checked }, button));
  host.querySelector('[data-action="leave-payment"]').addEventListener("click", () => leaveLorentsenPaymentFlow(host, order));
  revealCheckout(host);
}

async function submitLorentsenPayment(orderId, consent, button) {
  if (premiumBusy) return;
  premiumBusy = true;
  if (button) button.disabled = true;
  try { renderPaymentState((await api("/api/premium/payment/start", { orderId, ...consent })).order); }
  catch (error) { if (button) button.disabled = false; showPremiumError(error.message); }
  finally { premiumBusy = false; }
}

function renderLorentsenState(host, order) {
  if (order.status === "PAID" || order.status === "REPORT_GENERATING" || order.status === "REPORT_READY" || order.status === "REPORT_FAILED") return renderPaidState(host, order);
  if (["failed", "expired"].includes(order.providerStatus) || order.paymentFailureReason) {
    const expired = order.providerStatus === "expired";
    host.innerHTML = `<section class="checkout-panel production-checkout" data-checkout-state="${e(order.providerStatus || "failed")}"><p class="section-label">Оплата не завершена</p><h3>${expired ? "QR-код истёк" : "Платёж не завершён"}</h3><p>${expired ? "Этот QR-код больше нельзя использовать. Если вы не успели оплатить, создайте новый." : "Оплата не прошла. Можно безопасно попробовать ещё раз."}</p><button type="button" class="premium-button" data-action="retry-payment">${expired ? "Обновить QR-код" : "Попробовать снова"}</button><button type="button" class="secondary-checkout-button" data-action="leave-payment">Вернуться к результату</button></section>`;
    host.querySelector('[data-action="retry-payment"]').addEventListener("click", () => renderConsentCheckout(order, { actionLabel: expired ? "Обновить QR-код" : "Попробовать снова" }));
    host.querySelector('[data-action="leave-payment"]').addEventListener("click", () => leaveLorentsenPaymentFlow(host, order));
    return;
  }
  const method = order.paymentMethod;
  const methodExpiresAt = Date.parse(method?.expiresAt || "");
  const methodIsUsable = Boolean(method && (!Number.isFinite(methodExpiresAt) || methodExpiresAt > Date.now()));
  if (methodIsUsable && !["succeeded_pending", "settled", "failed", "expired"].includes(order.providerStatus)) {
    host.innerHTML = `<section class="checkout-panel production-checkout" data-checkout-state="requires_action"><p class="section-label">Оплата полного разбора</p><h3>Отсканируйте QR-код</h3><p>Используйте QR-код или ссылку для оплаты.</p>${method.image ? `<img class="payment-qr" src="${e(method.image)}" alt="QR-код для оплаты">` : ""}${method.link ? `<a class="premium-button payment-link" href="${e(method.link)}" target="_blank" rel="noopener noreferrer">Открыть оплату</a>` : ""}${method.expiresAt ? `<p>QR-код действует до: ${e(new Date(method.expiresAt).toLocaleString("ru-RU"))}</p>` : ""}<div class="payment-notice">Проверяем статус оплаты…</div><button type="button" class="secondary-checkout-button" data-action="leave-payment">Вернуться к результату</button></section>`;
  } else {
    const copy = { preparing: ["Платёж создаётся", "QR-код появится, когда оплата будет готова."], processing: ["Платёж обрабатывается", "Проверяем статус оплаты."], requires_action: ["Проверяем срок действия QR-кода", "Обновляем статус оплаты."], succeeded_pending: ["Оплата принята в обработку", "Подтверждение оплаты может занять немного времени."], manual_review: ["Платёж проверяется", "Проверка занимает больше времени. Новая попытка пока недоступна."], provider_result_unknown: ["Проверяем статус оплаты", "Временная ошибка связи не отменяет существующий QR-код или платёж."] }[order.providerStatus] || ["Готовим оплату", "Пожалуйста, подождите."];
    host.innerHTML = `<section class="checkout-panel production-checkout" data-checkout-state="${e(order.providerStatus || "preparing")}"><p class="section-label">Оплата полного разбора</p><h3>${e(copy[0])}</h3><p>${e(copy[1])}</p><div class="checkout-progress" aria-label="Проверка оплаты"><i></i></div><button type="button" class="secondary-checkout-button" data-action="leave-payment">Вернуться к результату</button></section>`;
  }
  host.querySelector('[data-action="leave-payment"]').addEventListener("click", () => leaveLorentsenPaymentFlow(host, order));
  schedulePaymentPoll(order.orderId, order.nextPollAt);
}

function leaveLorentsenPaymentFlow(host, order) {
  clearTimeout(paymentPollTimer);
  host.innerHTML = `<section class="checkout-panel production-checkout" data-checkout-state="PAYMENT_EXIT"><p class="section-label">Персональный разбор</p><h3>Вы вернулись к карте</h3><p>Платёж не отменён и его статус не изменён. Можно изменить данные рождения и рассчитать новую карту; эта попытка останется связана только с прежними данными.</p><button type="button" class="secondary-checkout-button" data-action="resume-payment">Вернуться к оплате</button></section>`;
  host.querySelector('[data-action="resume-payment"]').addEventListener("click", () => resumeLorentsenPayment(order.orderId));
  document.querySelector(".preview-cover, #birth-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function resumeLorentsenPayment(orderId) {
  if (premiumBusy) return;
  premiumBusy = true;
  try { renderPaymentState((await api(`/api/premium/order/${encodeURIComponent(orderId)}`)).order); }
  catch (error) { showPremiumError(error.message); }
  finally { premiumBusy = false; }
}

function schedulePaymentPoll(orderId, nextPollAt) {
  clearTimeout(paymentPollTimer);
  const delay = Math.max(1000, Math.min(30000, Date.parse(nextPollAt || "") - Date.now() || 5000));
  paymentPollTimer = setTimeout(async () => { try { renderPaymentState((await api(`/api/premium/order/${encodeURIComponent(orderId)}`)).order); } catch { schedulePaymentPoll(orderId, null); } }, delay);
}

async function simulatePayment(orderId, outcome) {
  if (premiumBusy) return;
  premiumBusy = true;
  try {
    const result = await api("/api/premium/dev/payment", { orderId, outcome });
    if (result.order.status === "PAID") {
      renderPaidState(document.querySelector(".premium-action") || resultRoot, result.order);
      const generated = await api("/api/premium/generate", { orderId });
      renderPaymentState(generated.order);
    } else renderPaymentState(result.order);
  } catch (error) { showPremiumError(error.message); }
  finally { premiumBusy = false; }
}

function renderPaidState(host, order) {
  if (order.paymentProvider === "lorentsen") {
    host.innerHTML = `<section class="checkout-panel paid-state" data-checkout-state="${e(order.status)}"><p class="section-label">Оплата подтверждена</p><h3>Покупка успешно подтверждена</h3><p>Оплата надёжно сохранена.</p></section>`;
    return;
  }
  host.innerHTML = `<section class="checkout-panel paid-state" data-checkout-state="${e(order.status)}"><p class="section-label">Оплата подтверждена</p><h3>Готовим персональный разбор</h3><p>Тестовая генерация выполняется без OpenAI API и без расходования средств.</p><div class="checkout-progress" aria-label="Подготовка отчёта"><i></i></div></section>`;
}

function renderReadyState(host, order) {
  host.innerHTML = `<section class="checkout-panel ready-state" data-checkout-state="REPORT_READY"><p class="section-label">Персональный разбор готов</p><h3>Тестовый отчёт сохранён</h3><p>Monetization flow завершён в mock-режиме. Реальная интерпретация и PDF будут включены после подключения production-оплаты.</p><button type="button" class="premium-button" data-action="open-stub">Открыть тестовый результат</button><button type="button" class="secondary-checkout-button" data-action="pdf-stub">Проверить PDF-flow</button><div class="stub-result" hidden>Тестовый полный разбор подготовлен без обращения к AI. Report ID: ${e(order.reportId)}</div><div class="pdf-stub-result" hidden>PDF-flow готов к подключению сохранённого premium-отчёта.</div></section>`;
  host.querySelector('[data-action="open-stub"]')?.addEventListener("click", () => { host.querySelector(".stub-result").hidden = false; });
  host.querySelector('[data-action="pdf-stub"]')?.addEventListener("click", () => { host.querySelector(".pdf-stub-result").hidden = false; });
}

async function restorePremiumOrder() {
  const orderId = localStorage.getItem("tianMinOrderId");
  if (!orderId) return;
  try {
    premiumConfig = await api("/api/premium/config");
    const result = await api(`/api/premium/order/${encodeURIComponent(orderId)}`);
    if (["PAID", "REPORT_GENERATING"].includes(result.order.status)) {
      resultRoot.innerHTML = '<section class="premium-recovery shell"><div class="premium-action"></div></section>';
      renderPaidState(resultRoot.querySelector(".premium-action"), result.order);
      if (result.order.paymentProvider === "lorentsen") renderPaymentState(result.order);
      else { const generated = await api("/api/premium/generate", { orderId }); renderPaymentState(generated.order); }
    } else if (result.order.status === "REPORT_READY") {
      resultRoot.innerHTML = '<section class="premium-recovery shell"><div class="premium-action"></div></section>';
      renderReadyState(resultRoot.querySelector(".premium-action"), result.order);
    } else if (result.order.status === "CHECKOUT_STARTED" && !result.order.paymentFailureReason) {
      resultRoot.innerHTML = '<section class="premium-recovery shell"><div class="premium-action"></div></section>';
      if (premiumConfig.paymentMode === "lorentsen") renderConsentCheckout(result.order);
      else { const payment = await api("/api/premium/payment/start", { orderId }); renderPaymentState(payment.order); }
    } else if (["CHECKOUT_STARTED", "PAYMENT_PENDING"].includes(result.order.status)) {
      resultRoot.innerHTML = '<section class="premium-recovery shell"><div class="premium-action"></div></section>';
      renderPaymentState(result.order);
    }
  } catch { localStorage.removeItem("tianMinOrderId"); }
}

async function api(url, body) {
  const response = await fetch(url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Не удалось выполнить действие.");
  return payload;
}

function showPremiumError(message) {
  const host = document.querySelector(".premium-action") || resultRoot;
  host.insertAdjacentHTML("beforeend", `<div class="payment-notice error" role="alert">${e(message || "Не удалось продолжить. Бесплатная карта остаётся доступной.")}</div>`);
}
function formatPrice(amount, currency) { return `${new Intl.NumberFormat("ru-RU").format(amount)} ${currency === "RUB" ? "₽" : currency}`; }
function isPlausibleEmail(value) { return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u.test(String(value || "").trim()); }
function revealCheckout(host) { host.querySelector(".checkout-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }); }

async function searchPlaces(query, sequence) {
  try {
    const response = await fetch(`/api/places?q=${encodeURIComponent(query)}`);
    const payload = await response.json();
    if (sequence !== placeSearchSequence) return;
    const places = response.ok ? payload.places : [];
    renderPlaceOptions(places);
    placeFallback.hidden = places.length > 0;
  } catch { if (sequence === placeSearchSequence) { renderPlaceOptions([]); placeFallback.hidden = false; } }
}

async function searchTimeZones(query, sequence) {
  try {
    const response = await fetch(`/api/timezones?q=${encodeURIComponent(query)}`);
    const payload = await response.json();
    if (sequence !== timeZoneSearchSequence) return;
    renderTimeZoneOptions(response.ok ? payload.timeZones : []);
  } catch { if (sequence === timeZoneSearchSequence) renderTimeZoneOptions([]); }
}

function renderTimeZoneOptions(zones) {
  timeZoneResults = zones;
  timeZoneOptions.innerHTML = zones.map((zone, index) => `<button type="button" role="option" data-index="${index}">${e(zone.label)}</button>`).join("");
  timeZoneOptions.hidden = zones.length === 0;
  timeZoneInput.setAttribute("aria-expanded", String(zones.length > 0));
  timeZoneOptions.querySelectorAll("button").forEach((button, index) => button.addEventListener("click", () => {
    selectedTimeZone = timeZoneResults[index]?.id || "";
    if (!selectedTimeZone) return;
    timeZoneInput.value = selectedTimeZone;
    renderTimeZoneOptions([]);
  }));
}

function renderPlaceOptions(places) {
  placeResults = places;
  activePlaceIndex = -1;
  placeOptions.innerHTML = places.map((place, index) => `<button id="place-option-${index}" type="button" role="option" aria-selected="false" data-index="${index}">${e(place.display.label)}</button>`).join("");
  placeOptions.hidden = places.length === 0;
  placeInput.setAttribute("aria-expanded", String(places.length > 0));
  placeInput.removeAttribute("aria-activedescendant");
  placeOptions.querySelectorAll("button").forEach((button, index) => button.addEventListener("click", () => selectPlace(index)));
}

function updateActivePlaceOption() {
  placeOptions.querySelectorAll("button").forEach((button, index) => button.setAttribute("aria-selected", String(index === activePlaceIndex)));
  placeInput.setAttribute("aria-activedescendant", `place-option-${activePlaceIndex}`);
}

function selectPlace(index) {
  selectedPlace = placeResults[index] || null;
  if (!selectedPlace) return;
  placeInput.value = selectedPlace.display.label;
  renderPlaceOptions([]);
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

function lunarDateLines(ziwei) {
  if (Array.isArray(ziwei?.lunarDateLines) && ziwei.lunarDateLines.length === 3) return ziwei.lunarDateLines;
  const parts = String(ziwei?.lunarDate || "—").split(/\s*·\s*/u).filter(Boolean);
  return parts.length === 3 ? parts : [String(ziwei?.lunarDate || "—")];
}

function conciseBureauName(value) {
  return String(value || "—").replace(/^Система элемента\s+[«"]?/u, "").replace(/[»"]$/u, "");
}

function compactStemName(value) {
  return String(value || "—").replace(/\s*·\s*небесный ствол$/u, " · ствол");
}

function compactBranchName(value) {
  return String(value || "—").replace(/\s*·\s*земная ветвь$/u, " · ветвь");
}

function primaryStrengthName(strength) {
  const name = String(strength?.display?.name || "").trim();
  const verdict = String(strength?.verdict || "").trim();
  return name && name !== verdict ? name : "Статус требует уточнения";
}

function lowerFirst(value) {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}

function e(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

restorePremiumOrder();
