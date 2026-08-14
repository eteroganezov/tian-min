const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function element() {
  const listeners = new Map();
  const children = new Map();
  let html = "";
  const node = {
    hidden: false, value: "", checked: false, disabled: false, validity: { valid: true }, dataset: {}, parentElement: null,
    scrollCalls: [], focusCalls: [],
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type, event = {}) { return listeners.get(type)?.({ preventDefault() {}, key: "", target: node, currentTarget:node, ...event }); },
    appendChild() {}, setAttribute() {}, removeAttribute() {}, scrollIntoView(options) { node.scrollCalls.push(options); }, focus(options) { node.focusCalls.push(options); }, insertAdjacentHTML() {}, closest() { return null; },
    querySelector(selector) {
      if (selector === ".checkout-panel") return html.includes("checkout-panel") ? (children.get(selector) || (children.set(selector, element()), children.get(selector))) : null;
      if (selector === ".free-preview") return html.includes('class="free-preview"') ? element() : null;
      if (selector === "#free-result") return html.includes('id="free-result"') ? (children.get(selector) || (children.set(selector, element()), children.get(selector))) : null;
      if (selector === ".premium-action") return html.includes("premium-action") ? (children.get(selector) || (children.set(selector, element()), children.get(selector))) : null;
      const action = selector.match(/^\[data-action="([^"]+)"\]$/)?.[1];
      const name = selector.match(/^\[name="([^"]+)"\]$/)?.[1];
      const key = action ? `action:${action}` : name ? `name:${name}` : selector;
      const marker = action ? `data-action="${action}"` : name ? `name="${name}"` : null;
      if (marker && !html.includes(marker)) return null;
      if (!children.has(key)) children.set(key, element());
      return children.get(key);
    },
    querySelectorAll() { return []; },
  };
  Object.defineProperty(node, "innerHTML", {
    get: () => html,
    set(value) { html = String(value); children.clear(); },
  });
  return node;
}

function harness(fetchImpl) {
  const nodes = {
    "#birth-form": element(), "#form-error": element(), "#submit-button": element(), "#result-root": element(),
    "#birth-place": element(), "#place-options": element(), "#ambiguity-box": element(), ".premium-action": element(),
    ".preview-cover, #birth-form": element(),
  };
  nodes["#submit-button"].querySelector = () => element();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const document = {
    visibilityState: "visible",
    querySelector: selector => selector === ".premium-action" && nodes["#result-root"].innerHTML.includes("premium-action")
      ? nodes["#result-root"].querySelector(".premium-action")
      : nodes[selector] || element(),
    addEventListener(type, listener) { if (!documentListeners.has(type)) documentListeners.set(type, []); documentListeners.get(type).push(listener); },
    dispatch(type) { for (const listener of documentListeners.get(type) || []) listener({ type }); },
  };
  const storage = new Map();
  let timerId = 0;
  const timers = new Map();
  const context = {
    document, fetch: fetchImpl, FormData: class {}, localStorage: { getItem: key => storage.get(key) || null, removeItem: key => storage.delete(key), setItem: (key, value) => storage.set(key, String(value)) },
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); }, console, Intl, URLSearchParams, encodeURIComponent,
    addEventListener(type, listener) { if (!windowListeners.has(type)) windowListeners.set(type, []); windowListeners.get(type).push(listener); },
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "..", "public", "app.js"), "utf8"), context);
  return { context, document, async runNextTimer() { const next = timers.entries().next().value; if (!next) return false; timers.delete(next[0]); await next[1](); return true; }, dispatchWindow(type) { for (const listener of windowListeners.get(type) || []) listener({ type }); }, host: nodes[".premium-action"], resultRoot: nodes["#result-root"] };
}

const config = {
  available: true, amount: 599, currency: "RUB", paymentMode: "lorentsen", partnerPublicName: "Тянь Мин",
  consent: { termsUrl: "https://example.test/terms", privacyUrl: "https://example.test/privacy", autoRedemptionTermsUrl: "https://example.test/redemption" },
};

function order(providerStatus, overrides = {}) {
  return {
    orderId: "order_payment_ux", amount: 599, currency: "RUB", status: "PAYMENT_PENDING", paymentProvider: "lorentsen",
    providerStatus, currentAttemptId: "attempt_current", paymentSessionStatus: "active", paymentMethod: null,
    nextPollAt: "2026-08-13T10:00:05Z", paymentFailureReason: null, ...overrides,
  };
}

test("expired/failed показывают terminal UX без выхода в длинную карту", async () => {
  const calls = [];
  const ui = harness(async url => { calls.push(url); return { ok: true, json: async () => config }; });
  await ui.context.openPremiumOffer();
  calls.length = 0;

  ui.context.renderLorentsenState(ui.host, order("expired", { status: "CHECKOUT_STARTED", paymentFailureReason: "expired" }));
  assert.match(ui.host.innerHTML, /Платёж не завершён/);
  assert.match(ui.host.innerHTML, /Попробовать снова/);
  assert.doesNotMatch(ui.host.innerHTML, /Вернуться к карте|leave-payment|PAYMENT_EXIT/);
  assert.deepEqual(calls, []);

  ui.context.renderLorentsenState(ui.host, order("failed", { status: "CHECKOUT_STARTED", paymentFailureReason: "failed" }));
  assert.match(ui.host.innerHTML, /Платёж не завершён/);
  assert.match(ui.host.innerHTML, /Попробовать снова/);
});

test("REPORT_FAILED retry sends the displayed attempt once and return preserves the entitlement locally", async()=>{
  const calls=[];
  const failed={orderId:"order_family",reportId:"report_family",status:"REPORT_FAILED",accessReason:"complimentary_promo",reportGenerationAttempt:4};
  const ui=harness(async(url,options={})=>{
    calls.push({url,options});
    if(url==="/api/premium/generate")return{ok:true,json:async()=>({order:{...failed,status:"REPORT_GENERATING",reportGenerationAttempt:5}})};
    if(url==="/api/premium/config")return{ok:true,json:async()=>config};
    if(url.startsWith("/api/premium/order/"))return{ok:true,json:async()=>({order:failed})};
    throw new Error(`unexpected ${url}`);
  });
  ui.context.renderPaymentState(failed);
  assert.match(ui.host.innerHTML,/Вернуться к результату/);
  const retry=ui.host.querySelector('[data-action="retry-generation"]');
  await Promise.all([retry.dispatch("click"),retry.dispatch("click")]);
  const generationCalls=calls.filter(call=>call.url==="/api/premium/generate");
  assert.equal(generationCalls.length,1);
  assert.deepEqual(JSON.parse(generationCalls[0].options.body),{orderId:failed.orderId,reportGenerationAttempt:4});

  ui.context.renderPaymentState(failed);
  calls.length=0;
  ui.host.querySelector('[data-action="leave-generation"]').dispatch("click");
  assert.match(ui.host.innerHTML,/Получить персональный разбор/);
  assert.deepEqual(calls,[]);
  await ui.context.openPremiumOffer();
  assert.match(ui.host.innerHTML,/REPORT_FAILED/);
  assert.equal(calls.some(call=>call.url==="/api/premium/generate"),false);
});

test("failed/expired retry возвращает в offer и double-click не создаёт payment", async () => {
  const calls = [];
  const ui = harness(async (url, options = {}) => {
    calls.push({ url, options });
    if (url === "/api/premium/config") return { ok: true, json: async () => config };
    throw new Error(`unexpected ${url}`);
  });
  await ui.context.openPremiumOffer();
  calls.length = 0;
  ui.context.renderLorentsenState(ui.host, order("expired", { status: "CHECKOUT_STARTED", paymentFailureReason: "expired" }));
  const retry = ui.host.querySelector('[data-action="retry-payment"]');
  retry.dispatch("click"); retry.dispatch("click");
  assert.match(ui.host.innerHTML, /data-checkout-state="OFFER"/);
  assert.match(ui.host.innerHTML, /У меня есть промокод/);
  assert.match(ui.host.innerHTML, /Перейти к оплате/);
  assert.equal(calls.length, 0);
});

test("processing/manual_review reopen восстанавливает status, а client expiry сначала делает authenticated GET", async () => {
  for (const status of ["processing", "manual_review"]) {
    const calls = [];
    const active = order(status);
    const ui = harness(async url => {
      calls.push(url);
      if (url === "/api/premium/config") return { ok: true, json: async () => config };
      return { ok: true, json: async () => ({ order: active }) };
    });
    ui.context.renderPaymentState(active);
    await ui.context.openPremiumOffer();
    assert.match(ui.host.innerHTML, new RegExp(`data-checkout-state="${status}"`));
    assert.equal(calls.includes("/api/premium/payment/start"), false);
  }

  const calls = [];
  const locallyExpired = order("requires_action", { paymentMethod: { link: "https://pay.example.test/old", expiresAt: "2020-01-01T00:00:00Z" } });
  const ui = harness(async url => { calls.push(url); return { ok: true, json: async () => ({ order: locallyExpired }) }; });
  ui.context.renderPaymentState(locallyExpired);
  await ui.context.refreshPremiumOrder("resume", { force: true, orderId: locallyExpired.orderId });
  assert.deepEqual(calls, ["/api/premium/order/order_payment_ux?source=resume&refresh=1"]);
  assert.equal(calls.includes("/api/premium/payment/start"), false);
});

test("page refresh показывает offer для terminal и восстанавливает active attempt", async () => {
  for (const terminalStatus of ["failed", "expired"]) {
    const terminal = order(terminalStatus, { status: "CHECKOUT_STARTED", paymentFailureReason: terminalStatus });
    const ui = harness(async url => url === "/api/premium/config"
      ? { ok: true, json: async () => config }
      : { ok: true, json: async () => ({ order: terminal }) });
    ui.context.localStorage.setItem("tianMinOrderId", terminal.orderId);
    await ui.context.restorePremiumOrder();
    assert.match(ui.resultRoot.querySelector(".premium-action").innerHTML, /data-checkout-state="OFFER"/);
  }

  const active = order("requires_action", { paymentMethod: { link: "https://pay.example.test/restored", expiresAt: "2099-01-01T00:00:00Z" } });
  const calls = [];
  const ui = harness(async url => {
    calls.push(url);
    return url === "/api/premium/config"
      ? { ok: true, json: async () => config }
      : { ok: true, json: async () => ({ order: active }) };
  });
  ui.context.localStorage.setItem("tianMinOrderId", active.orderId);
  await ui.context.restorePremiumOrder();
  assert.match(ui.resultRoot.querySelector(".premium-action").innerHTML, /https:\/\/pay\.example\.test\/restored/);
  assert.equal(calls.includes("/api/premium/payment/start"), false);
});

test("focus/visibility/pageshow coalesce refresh, detect PAID and request fulfillment once", async () => {
  const calls = [];
  let releaseStatus;
  const pendingStatus = new Promise(resolve => { releaseStatus = resolve; });
  const processing = order("succeeded_pending");
  const paid = { ...processing, status: "PAID", providerStatus: "settled", paymentConfirmedAt: "2026-08-14T14:10:00Z" };
  const ui = harness(async (url, options = {}) => {
    calls.push({ url, options });
    if (url.startsWith("/api/premium/order/")) { await pendingStatus; return { ok: true, json: async () => ({ order: paid }) }; }
    if (url === "/api/premium/generate") return { ok: true, json: async () => ({ order: { ...paid, status: "REPORT_GENERATING" } }) };
    throw new Error(`unexpected ${url}`);
  });
  ui.context.localStorage.setItem("tianMinOrderId", processing.orderId);
  ui.context.renderPaymentState(processing);
  ui.dispatchWindow("focus");
  ui.document.dispatch("visibilitychange");
  ui.dispatchWindow("pageshow");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(call => call.url.startsWith("/api/premium/order/")).length, 1);
  releaseStatus();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(call => call.url === "/api/premium/generate").length, 1);
  assert.equal(calls.some(call => call.url === "/api/premium/payment/start"), false);
  assert.match(ui.host.innerHTML, /REPORT_GENERATING|Готовим ваш персональный разбор/);
});

test("delayed lifecycle response cannot turn a detached FRIEND100 order back into payment checking", async () => {
  let releaseStatus;
  const delayedStatus = new Promise(resolve => { releaseStatus = resolve; });
  const offer = order(null, {
    status: "CHECKOUT_STARTED", baseAmount: 599, amount: 100, promoCode: "FRIEND100",
    currentAttemptId: null, paymentId: null, paymentSessionStatus: null, paymentSessionEndReason: "legacy_unusable",
  });
  const delayedLegacyManualReview = {
    ...offer, status: "PAYMENT_PENDING", providerStatus: "manual_review",
    currentAttemptId: "attempt_legacy", paymentId: "payment_legacy", paymentSessionEndReason: null,
  };
  const ui = harness(async url => {
    if (url.startsWith("/api/premium/order/")) { await delayedStatus; return { ok: true, json: async () => ({ order: delayedLegacyManualReview }) }; }
    throw new Error(`unexpected ${url}`);
  });
  ui.context.renderPaymentState(offer);
  assert.match(ui.host.innerHTML, /data-checkout-state="OFFER"/);
  assert.match(ui.host.innerHTML, /FRIEND100/);

  ui.dispatchWindow("focus");
  ui.document.dispatch("visibilitychange");
  ui.dispatchWindow("pageshow");
  await new Promise(resolve => setImmediate(resolve));
  releaseStatus();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.match(ui.host.innerHTML, /data-checkout-state="OFFER"/);
  assert.match(ui.host.innerHTML, /FRIEND100/);
  assert.match(ui.host.innerHTML, /100/);
  assert.doesNotMatch(ui.host.innerHTML, /Платёж ещё проверяется/);
});

test("reload restores the saved free preview and the same purchase without a new payment", async () => {
  const calls = [];
  const active = order("processing");
  const ui = harness(async url => {
    calls.push(url);
    if (url === "/api/premium/config") return { ok: true, json: async () => config };
    if (url.startsWith("/api/premium/order/")) return { ok: true, json: async () => ({ order: active, freePreview: { state: "FREE_PREVIEW_READY" } }) };
    throw new Error(`unexpected ${url}`);
  });
  ui.context.renderFreePreview = () => '<section class="free-preview"><div class="premium-action"></div></section>';
  ui.context.bindPreviewActions = () => {};
  ui.context.localStorage.setItem("tianMinOrderId", active.orderId);
  await ui.context.restorePremiumOrder();
  assert.match(ui.resultRoot.innerHTML, /class="free-preview"/);
  assert.match(ui.resultRoot.querySelector(".premium-action").innerHTML, /data-checkout-state="processing"/);
  assert.equal(calls.some(url => url === "/api/premium/payment/start"), false);
  assert.equal(ui.context.localStorage.getItem("tianMinOrderId"), active.orderId);
});

test("temporary reload failure preserves the saved order capability for later recovery", async () => {
  const active = order("processing");
  const ui = harness(async url => {
    if (url === "/api/premium/config") return { ok: true, json: async () => config };
    throw new Error("temporary network failure");
  });
  ui.context.localStorage.setItem("tianMinOrderId", active.orderId);
  await ui.context.restorePremiumOrder();
  assert.equal(ui.context.localStorage.getItem("tianMinOrderId"), active.orderId);
});

test("manual payment check is available and never starts another payment", async () => {
  const calls = [];
  const active = order("processing");
  const ui = harness(async url => { calls.push(url); return { ok: true, json: async () => ({ order: active }) }; });
  ui.context.localStorage.setItem("tianMinOrderId", active.orderId);
  ui.context.renderPaymentState(active);
  assert.match(ui.host.innerHTML, /Проверить статус/);
  assert.match(ui.host.innerHTML, /повторно оплачивать не нужно/);
  await ui.host.querySelector('[data-action="check-payment"]').dispatch("click");
  assert.equal(calls.some(url => url === "/api/premium/payment/start"), false);
  assert.equal(calls.filter(url => String(url).includes("source=manual")).length, 1);
});

test("active QR polling автоматически видит PAID, запускает fulfillment и никогда не создаёт attempt", async () => {
  const calls = [];
  const active = order("requires_action", { paymentMethod: { link: "https://pay.example.test/current", expiresAt: "2099-01-01T00:00:00Z" } });
  const paid = { ...active, status: "PAID", providerStatus: "settled", paymentMethod: null, nextPollAt: null };
  const ui = harness(async url => {
    calls.push(url);
    if (url.includes("source=polling")) return { ok: true, json: async () => ({ order: paid }) };
    if (url === "/api/premium/generate") return { ok: true, json: async () => ({ order: { ...paid, status: "REPORT_GENERATING" } }) };
    if (url.startsWith("/api/premium/order/")) return { ok: true, json: async () => ({ order: { ...paid, status: "REPORT_GENERATING" } }) };
    throw new Error(`unexpected ${url}`);
  });
  ui.context.renderPaymentState(active);
  assert.equal(await ui.runNextTimer(), true);
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(url => url.includes("source=polling")).length, 1);
  assert.equal(calls.filter(url => url === "/api/premium/generate").length, 1);
  assert.equal(calls.includes("/api/premium/payment/start"), false);
  assert.match(ui.host.innerHTML, /REPORT_GENERATING|Готовим ваш персональный разбор/);
});

test("Pay немедленно показывает создание QR, а preparing response сохраняет этот state без Check Status", async () => {
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const preparing = order("preparing", { paymentId: "pay_preparing" });
  const ui = harness(async url => {
    assert.equal(url, "/api/premium/payment/start");
    await response;
    return { ok: true, json: async () => ({ order: preparing }) };
  });
  const pending = ui.context.submitLorentsenPayment(preparing.orderId, { email: "payer@example.test", termsAccepted: true, autoRedemptionAccepted: true });
  assert.match(ui.host.innerHTML, /Создаём QR-код для оплаты/);
  assert.doesNotMatch(ui.host.innerHTML, /Платёж ещё проверяется|Проверить статус/);
  release();
  await pending;
  assert.match(ui.host.innerHTML, /Создаём QR-код для оплаты/);
  assert.doesNotMatch(ui.host.innerHTML, /Проверить статус/);
});

test("creating/preparing показывают отдельное создание QR без проверки статуса", () => {
  const ui = harness(async () => ({ ok: true, json: async () => ({}) }));
  ui.resultRoot.innerHTML = '<section class="free-preview" id="free-result"><div class="premium-action"></div></section>';
  const host = ui.resultRoot.querySelector(".premium-action");
  for (const status of ["creating", "preparing"]) {
    ui.context.renderLorentsenState(host, order(status));
    assert.match(host.innerHTML, /Создаём QR-код для оплаты/);
    assert.match(host.innerHTML, /Это обычно занимает несколько секунд/);
    assert.match(host.innerHTML, /checkout-progress/);
    assert.doesNotMatch(host.innerHTML, /Платёж ещё проверяется|Проверить статус|Вернуться к карте/);
  }
});

test("provider GET error replaces stale waiting animation with recoverable status and keeps the same order", async () => {
  const active = order("processing");
  const calls = [];
  const ui = harness(async url => {
    calls.push(url);
    return { ok: false, status: 503, json: async () => ({ error: "Статус оплаты временно не удалось проверить.", order: active }) };
  });
  ui.context.localStorage.setItem("tianMinOrderId", active.orderId);
  ui.context.renderPaymentState(active);
  await ui.host.querySelector('[data-action="check-payment"]').dispatch("click");
  assert.match(ui.host.innerHTML, /data-checkout-state="PROVIDER_ERROR"/);
  assert.match(ui.host.innerHTML, /Проверить статус/);
  assert.match(ui.host.innerHTML, /Повторно оплачивать не нужно/);
  assert.doesNotMatch(ui.host.innerHTML, /checkout-progress/);
  assert.equal(calls.some(url => url === "/api/premium/payment/start"), false);
  assert.equal(ui.context.localStorage.getItem("tianMinOrderId"), active.orderId);
});

test("terminal retry → offer → FAMILY0 создаёт entitlement без payment POST", async () => {
  const calls = [];
  const terminal = order("failed", { status: "CHECKOUT_STARTED", paymentFailureReason: "failed", currentAttemptId: "attempt_old", paymentId: "pay_old" });
  const promoOrder = { ...terminal, amount: 0, baseAmount: 599, promoCode: "FAMILY0", currentAttemptId: null, paymentId: null, providerStatus: null, paymentFailureReason: null };
  const ui = harness(async (url, options = {}) => {
    calls.push({ url, options });
    if (url === "/api/premium/config") return { ok: true, json: async () => config };
    if (url === "/api/premium/promo/apply") return { ok: true, json: async () => ({ order: promoOrder, pricing: { baseAmount: 599, discountAmount: 599, finalAmount: 0, currency: "RUB", promoCode: "FAMILY0" } }) };
    if (url === "/api/premium/promo/redeem") return { ok: true, json: async () => ({ order: { ...promoOrder, accessReason: "complimentary_promo" } }) };
    throw new Error(`unexpected ${url}`);
  });
  await ui.context.openPremiumOffer();
  ui.context.renderPaymentState(terminal);
  ui.host.querySelector('[data-action="retry-payment"]').dispatch("click");
  ui.host.querySelector('[name="promoCode"]').value = "FAMILY0";
  await ui.context.applyPromo(ui.host, null);
  const applyBody = JSON.parse(calls.find(call => call.url === "/api/premium/promo/apply").options.body);
  assert.equal(applyBody.orderId, terminal.orderId);
  await ui.host.querySelector('[data-action="checkout"]').dispatch("click");
  assert.match(ui.host.innerHTML, /Специальный доступ/);
  assert.equal(calls.some(call => call.url === "/api/premium/payment/start"), false);
});

test("manual_review/processing не показывают retry, а локально истёкший expires_at запускает проверку, не terminal state", () => {
  const ui = harness(async () => ({ ok: true, json: async () => ({}) }));
  for (const status of ["manual_review", "processing"]) {
    ui.context.renderLorentsenState(ui.host, order(status));
    assert.doesNotMatch(ui.host.innerHTML, /retry-payment|Обновить QR-код|Попробовать снова/);
    assert.doesNotMatch(ui.host.innerHTML, /Вернуться к карте|leave-payment/);
  }
  ui.context.renderLorentsenState(ui.host, order("requires_action", {
    paymentMethod: { link: "https://pay.example.test/old", image: null, expiresAt: "2020-01-01T00:00:00Z" },
  }));
  assert.match(ui.host.innerHTML, /актуальное состояние платёжной ссылки/);
  assert.doesNotMatch(ui.host.innerHTML, /data-checkout-state="expired"|Обновить QR-код/);
});

test("server-driven цена и каноническое имя Tian Min отображаются без stale 399/Edward", async () => {
  const ui = harness(async url => {
    assert.equal(url, "/api/premium/config");
    return { ok: true, json: async () => config };
  });
  await ui.context.openPremiumOffer();
  assert.match(ui.host.innerHTML, /599/);
  assert.doesNotMatch(ui.host.innerHTML, /399|Edward/);

  ui.context.renderConsentCheckout(order("preparing", { status: "CHECKOUT_STARTED" }));
  assert.match(ui.host.innerHTML, /партнёра «Тянь Мин»/);
  assert.doesNotMatch(ui.host.innerHTML, /Edward/);
});

test("обычный payment UX не раскрывает provider language вне обязательного legal consent", async () => {
  const ui = harness(async () => ({ ok: true, json: async () => config }));
  await ui.context.openPremiumOffer();

  ui.context.renderConsentCheckout(order("preparing", { status: "CHECKOUT_STARTED" }));
  assert.match(ui.host.innerHTML, /Email для оформления покупки/);
  assert.match(ui.host.innerHTML, /сертификата Lorentsen/);
  assert.match(ui.host.innerHTML, /сертификат, приобретаемый этой оплатой/);
  assert.match(ui.host.innerHTML, /После оплаты мы автоматически проверим её статус/);

  for (const status of ["preparing", "processing", "requires_action", "succeeded_pending", "manual_review", "provider_result_unknown", "failed"]) {
    ui.context.renderLorentsenState(ui.host, order(status, status === "failed" ? { status: "CHECKOUT_STARTED", paymentFailureReason: "provider_validation" } : {}));
    const visibleText = ui.host.innerHTML.replace(/<[^>]+>/g, " ");
    assert.doesNotMatch(visibleText, /Lorentsen|провайдер|provider|settled|сертификат/i);
  }

  ui.context.renderLorentsenState(ui.host, order("requires_action", {
    paymentMethod: { link: "https://pay.example.test/current", image: null, expiresAt: "2099-01-01T00:00:00Z" },
  }));
  assert.doesNotMatch(ui.host.innerHTML.replace(/<[^>]+>/g, " "), /Lorentsen|провайдер|provider|settled|сертификат/i);
});

test("active QR объясняет 15 минут, Cancel скрывает QR и сохраняет promo offer", async () => {
  const calls = [];
  const active = order("requires_action", {
    baseAmount: 599, amount: 100, promoCode: "FRIEND100", paymentSessionStatus: "active",
    paymentMethod: { link: "https://pay.example.test/current", image: null, expiresAt: "2099-01-01T00:00:00Z" },
  });
  const cancelled = { ...active, status: "CHECKOUT_STARTED", currentAttemptId: null, paymentId: null, providerStatus: null, paymentMethod: null, paymentSessionStatus: null, paymentSessionEndReason: "cancelled", checkoutEmail: "payer@example.test" };
  const ui = harness(async (url, options) => { calls.push({ url, options }); return url === "/api/premium/config" ? { ok: true, json: async () => config } : { ok: true, json: async () => ({ order: cancelled }) }; });
  await ui.context.openPremiumOffer();
  calls.length = 0;
  ui.context.renderLorentsenState(ui.host, active);
  assert.match(ui.host.innerHTML, /QR-код действителен 15 минут/);
  assert.doesNotMatch(ui.host.innerHTML, /Вернуться к карте/);
  assert.match(ui.host.innerHTML, /Отменить оплату/);
  await ui.host.querySelector('[data-action="cancel-payment"]').dispatch("click");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/premium/payment/cancel");
  assert.deepEqual(JSON.parse(calls[0].options.body), { orderId: active.orderId });
  assert.match(ui.host.innerHTML, /data-checkout-state="OFFER"/);
  assert.match(ui.host.innerHTML, /FRIEND100|К оплате/);
  assert.doesNotMatch(ui.host.innerHTML, /pay\.example\.test\/current/);
  await ui.host.querySelector('[data-action="checkout"]').dispatch("click");
  assert.match(ui.host.innerHTML, /data-checkout-state="CONSENT"/);
  assert.match(ui.host.innerHTML, /value="payer@example\.test"/);
  assert.equal(ui.host.querySelector('[name="termsAccepted"]').checked, false);
  assert.equal(ui.host.querySelector('[name="autoRedemptionAccepted"]').checked, false);
});

test("payment-specific screens не содержат возврат к карте", () => {
  const ui = harness(async () => ({ ok: true, json: async () => ({}) }));
  const states = [
    order("requires_action", { paymentMethod: { link: "https://pay.example.test/current", image: null, expiresAt: "2099-01-01T00:00:00Z" } }),
    order("processing"), order("manual_review"), order("preparing"),
    order(null, { status: "CHECKOUT_STARTED", currentAttemptId: null, paymentSessionEndReason: "expired" }),
  ];
  for (const state of states) {
    ui.context.renderPaymentState(state);
    assert.doesNotMatch(ui.host.innerHTML, /Вернуться к карте|leave-payment/);
  }
});

test("expired session показывает новый QR action, а cancelled reload показывает offer с promo", async () => {
  const expired = order(null, { status: "CHECKOUT_STARTED", baseAmount: 599, amount: 100, promoCode: "FRIEND100", currentAttemptId: null, paymentSessionEndReason: "expired" });
  const ui = harness(async url => url === "/api/premium/config"
    ? { ok: true, json: async () => config }
    : { ok: true, json: async () => ({ order: expired }) });
  await ui.context.openPremiumOffer();
  ui.context.renderPaymentState(expired);
  assert.match(ui.host.innerHTML, /Время оплаты истекло/);
  assert.match(ui.host.innerHTML, /Получить новый QR-код/);
  assert.doesNotMatch(ui.host.innerHTML, /https:\/\/pay\./);
  ui.host.querySelector('[data-action="new-payment-session"]').dispatch("click");
  assert.match(ui.host.innerHTML, /data-checkout-state="CONSENT"/);
  assert.match(ui.host.innerHTML, /Получить новый QR-код/);

  const cancelled = { ...expired, paymentSessionEndReason: "cancelled" };
  const reloaded = harness(async url => url === "/api/premium/config"
    ? { ok: true, json: async () => config }
    : { ok: true, json: async () => ({ order: cancelled }) });
  reloaded.context.localStorage.setItem("tianMinOrderId", cancelled.orderId);
  await reloaded.context.restorePremiumOrder();
  assert.match(reloaded.resultRoot.querySelector(".premium-action").innerHTML, /data-checkout-state="OFFER"/);
  assert.match(reloaded.resultRoot.querySelector(".premium-action").innerHTML, /К оплате/);
});

test("reload scrolls once to QR/generation/ready and same-state polling does not fight viewport", async () => {
  const states = [
    order("requires_action", { paymentMethod: { link: "https://pay.example.test/restored", expiresAt: "2099-01-01T00:00:00Z" } }),
    { ...order(null), status: "REPORT_GENERATING", providerStatus: "settled", paymentSessionStatus: null },
    { ...order(null), status: "REPORT_READY", providerStatus: "settled", paymentSessionStatus: null, reportAccessToken: "safe_token" },
  ];
  for (const restored of states) {
    const ui = harness(async url => {
      if (url === "/api/premium/config") return { ok: true, json: async () => config };
      return { ok: true, json: async () => ({ order: restored, freePreview: { state: "FREE_PREVIEW_READY" } }) };
    });
    ui.context.renderFreePreview = () => '<section class="free-preview"><div class="premium-action"></div></section>';
    ui.context.bindPreviewActions = () => {};
    ui.context.localStorage.setItem("tianMinOrderId", restored.orderId);
    await ui.context.restorePremiumOrder();
    const restoredHost = ui.resultRoot.querySelector(".premium-action");
    assert.equal(restoredHost.querySelector(".checkout-panel").scrollCalls.length, 1);
    assert.equal(restoredHost.querySelector(".checkout-panel").scrollCalls[0].behavior, "auto");
    if (restored.status === "PAYMENT_PENDING") {
      await ui.context.refreshPremiumOrder("polling", { orderId: restored.orderId });
      assert.equal(restoredHost.querySelector(".checkout-panel").scrollCalls.length, 0);
    }
  }
});

test("promo UX скрыт по умолчанию, FAMILY0 показывает перерасчёт и не вызывает payment endpoint", async () => {
  const calls = [];
  const promoOrder = order(null, { status: "CHECKOUT_STARTED", baseAmount: 599, amount: 0, promoCode: "FAMILY0" });
  const ui = harness(async (url, options = {}) => {
    calls.push({ url, options });
    if (url === "/api/premium/config") return { ok: true, json: async () => config };
    if (url === "/api/premium/promo/apply") return { ok: true, json: async () => ({ order: promoOrder, pricing: { baseAmount: 599, discountAmount: 599, finalAmount: 0, currency: "RUB", promoCode: "FAMILY0" } }) };
    if (url === "/api/premium/promo/redeem") return { ok: true, json: async () => ({ order: { ...promoOrder, accessReason: "complimentary_promo", premiumEntitledAt: "2026-08-13T12:00:00Z" } }) };
    throw new Error(`unexpected ${url}`);
  });
  await ui.context.openPremiumOffer();
  assert.match(ui.host.innerHTML, /У меня есть промокод/);
  assert.match(ui.host.innerHTML, /class="promo-entry" hidden/);

  const code = ui.host.querySelector('[name="promoCode"]');
  code.value = " family0 ";
  await ui.context.applyPromo(ui.host, { date: "1995-09-03" });
  assert.match(ui.host.innerHTML, /Стоимость/);
  assert.match(ui.host.innerHTML, /Промокод/);
  assert.match(ui.host.innerHTML, /К оплате/);
  assert.match(ui.host.innerHTML, /Получить персональный разбор/);
  assert.equal(JSON.parse(calls.find(call => call.url === "/api/premium/promo/apply").options.body).code, " family0 ");

  await ui.host.querySelector('[data-action="checkout"]').dispatch("click");
  assert.match(ui.host.innerHTML, /Специальный доступ/);
  assert.match(ui.host.innerHTML, /Оплата не требуется/);
  assert.equal(calls.filter(call => call.url === "/api/premium/promo/redeem").length, 1);
  assert.equal(calls.filter(call => call.url === "/api/premium/payment/start").length, 0);
});

test("promo error показывается человеческим текстом без раскрытия внутренних деталей", async () => {
  const ui = harness(async url => {
    if (url === "/api/premium/config") return { ok: true, json: async () => config };
    return { ok: false, json: async () => ({ error: "Промокод больше недоступен" }) };
  });
  await ui.context.openPremiumOffer();
  ui.host.querySelector('[name="promoCode"]').value = "FRIEND100";
  await ui.context.applyPromo(ui.host, { date: "1995-09-03" });
  assert.match(ui.host.innerHTML, /Промокод больше недоступен/);
  assert.match(ui.host.innerHTML, /class="promo-toggle"[^>]*hidden/);
  assert.doesNotMatch(ui.host.innerHTML, /database|provider|minim|internal/i);
});

test("promo first tap немедленно блокирует повторный запрос и после success обновляет цену", async () => {
  const calls = [];
  let resolveApply;
  const pendingApply = new Promise(resolve => { resolveApply = resolve; });
  const promoOrder = order(null, { status: "CHECKOUT_STARTED", baseAmount: 599, amount: 100, promoCode: "FRIEND100" });
  const ui = harness(async (url, options = {}) => {
    calls.push({ url, options });
    if (url === "/api/premium/config") return { ok: true, json: async () => config };
    if (url === "/api/premium/promo/apply") { await pendingApply; return { ok: true, json: async () => ({ order: promoOrder, pricing: { baseAmount: 599, discountAmount: 499, finalAmount: 100, currency: "RUB", promoCode: "FRIEND100" } }) }; }
    throw new Error(`unexpected ${url}`);
  });
  await ui.context.openPremiumOffer();
  ui.host.querySelector('[data-action="show-promo"]').dispatch("click");
  ui.host.querySelector('[name="promoCode"]').value = "FRIEND100";
  const first = ui.context.applyPromo(ui.host, { date: "1995-09-03" });
  const second = ui.context.applyPromo(ui.host, { date: "1995-09-03" });
  assert.equal(ui.host.querySelector('[data-action="apply-promo"]').disabled, true);
  assert.equal(ui.host.querySelector('[name="promoCode"]').disabled, true);
  assert.match(ui.host.querySelector(".promo-message").textContent, /Проверяем промокод/);
  assert.equal(calls.filter(call => call.url === "/api/premium/promo/apply").length, 1);
  resolveApply();
  await Promise.all([first, second]);
  assert.match(ui.host.innerHTML, /✓ Промокод применён/);
  assert.match(ui.host.innerHTML, /−499 ₽/);
  assert.match(ui.host.innerHTML, /100 ₽/);
  assert.match(ui.host.innerHTML, /Перейти к оплате/);
  assert.doesNotMatch(ui.host.innerHTML, /Получить персональный разбор/);
});

test("SUPPORT399 summary показывает скидку 200 ₽ и paid CTA", () => {
  const ui = harness(async () => ({ ok: true, json: async () => config }));
  ui.context.renderPremiumOffer(ui.host, config, { pricing: { baseAmount: 599, discountAmount: 200, finalAmount: 399, currency: "RUB", promoCode: "SUPPORT399" }, message: "✓ Промокод применён", success: true });
  assert.match(ui.host.innerHTML, /−200 ₽/);
  assert.match(ui.host.innerHTML, /399 ₽/);
  assert.match(ui.host.innerHTML, /Перейти к оплате/);
});

test("успешный promo перерасчёт не возвращает скрытую кнопку раскрытия", () => {
  const styles = fs.readFileSync(path.resolve(__dirname, "..", "public", "styles.css"), "utf8");
  assert.match(styles, /\.promo-toggle\[hidden\]\{display:none\}/);
});

test("открытие promo form скрывает исходный disclosure trigger", () => {
  const ui = harness(async () => ({ ok: true, json: async () => config }));
  ui.context.renderPremiumOffer(ui.host, config);
  const trigger = ui.host.querySelector('[data-action="show-promo"]');
  const entry = ui.host.querySelector(".promo-entry");
  assert.equal(trigger.hidden, false);
  assert.equal(entry.hidden, false, "test DOM does not parse initial hidden attribute into the stub property");
  trigger.dispatch("click");
  assert.equal(trigger.hidden, true);
  assert.equal(entry.hidden, false);
});
