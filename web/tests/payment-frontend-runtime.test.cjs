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
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type, event = {}) { return listeners.get(type)?.({ preventDefault() {}, key: "", target: node, ...event }); },
    appendChild() {}, setAttribute() {}, removeAttribute() {}, scrollIntoView() {}, insertAdjacentHTML() {}, closest() { return null; },
    querySelector(selector) {
      if (selector === ".checkout-panel") return html.includes("checkout-panel") ? element() : null;
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
  const document = { querySelector: selector => nodes[selector] || element(), addEventListener() {} };
  let timerId = 0;
  const context = {
    document, fetch: fetchImpl, FormData: class {}, localStorage: { getItem: () => null, removeItem() {}, setItem() {} },
    setTimeout: () => ++timerId, clearTimeout() {}, console, Intl, URLSearchParams, encodeURIComponent,
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "..", "public", "app.js"), "utf8"), context);
  return { context, host: nodes[".premium-action"] };
}

const config = {
  available: true, amount: 599, currency: "RUB", paymentMode: "lorentsen", partnerPublicName: "Edward",
  consent: { termsUrl: "https://example.test/terms", privacyUrl: "https://example.test/privacy", autoRedemptionTermsUrl: "https://example.test/redemption" },
};

function order(providerStatus, overrides = {}) {
  return {
    orderId: "order_payment_ux", amount: 599, currency: "RUB", status: "PAYMENT_PENDING", paymentProvider: "lorentsen",
    providerStatus, paymentMethod: null, nextPollAt: "2026-08-13T10:00:05Z", paymentFailureReason: null, ...overrides,
  };
}

test("expired/failed показывают terminal UX, а Back не вызывает API и не меняет payment", async () => {
  const calls = [];
  const ui = harness(async url => { calls.push(url); return { ok: true, json: async () => config }; });
  await ui.context.openPremiumOffer();
  calls.length = 0;

  ui.context.renderLorentsenState(ui.host, order("expired", { status: "CHECKOUT_STARTED", paymentFailureReason: "expired" }));
  assert.match(ui.host.innerHTML, /QR-код истёк/);
  assert.match(ui.host.innerHTML, /Обновить QR-код/);
  assert.match(ui.host.innerHTML, /data-action="leave-payment">Назад/);
  ui.host.querySelector('[data-action="leave-payment"]').dispatch("click");
  assert.match(ui.host.innerHTML, /data-checkout-state="PAYMENT_EXIT"/);
  assert.deepEqual(calls, []);

  ui.context.renderLorentsenState(ui.host, order("failed", { status: "CHECKOUT_STARTED", paymentFailureReason: "failed" }));
  assert.match(ui.host.innerHTML, /Платёж не завершён/);
  assert.match(ui.host.innerHTML, /Попробовать снова/);
});

test("expired retry требует явного подтверждения и double-click отправляет один start request", async () => {
  const calls = [];
  let releasePayment;
  const ui = harness(async (url, options = {}) => {
    calls.push({ url, options });
    if (url === "/api/premium/config") return { ok: true, json: async () => config };
    return new Promise(resolve => { releasePayment = () => resolve({ ok: true, json: async () => ({ order: order("preparing") }) }); });
  });
  await ui.context.openPremiumOffer();
  calls.length = 0;
  ui.context.renderLorentsenState(ui.host, order("expired", { status: "CHECKOUT_STARTED", paymentFailureReason: "expired" }));
  ui.host.querySelector('[data-action="retry-payment"]').dispatch("click");
  assert.match(ui.host.innerHTML, /data-checkout-state="CONSENT"/);
  assert.match(ui.host.innerHTML, /data-action="confirm-payment" disabled>Обновить QR-код/);
  assert.equal(calls.length, 0);

  const email = ui.host.querySelector('[name="payerEmail"]');
  const terms = ui.host.querySelector('[name="termsAccepted"]');
  const redemption = ui.host.querySelector('[name="autoRedemptionAccepted"]');
  const confirm = ui.host.querySelector('[data-action="confirm-payment"]');
  email.value = "payer@example.test";
  terms.checked = true;
  redemption.checked = true;
  email.dispatch("input"); terms.dispatch("change"); redemption.dispatch("change");
  assert.equal(confirm.disabled, false);
  const first = confirm.dispatch("click");
  const second = confirm.dispatch("click");
  assert.equal(confirm.disabled, true);
  assert.equal(calls.filter(call => call.url === "/api/premium/payment/start").length, 1);
  releasePayment();
  await Promise.all([first, second]);
});

test("manual_review/processing не показывают retry, а локально истёкший expires_at запускает проверку, не terminal state", () => {
  const ui = harness(async () => ({ ok: true, json: async () => ({}) }));
  for (const status of ["manual_review", "processing"]) {
    ui.context.renderLorentsenState(ui.host, order(status));
    assert.doesNotMatch(ui.host.innerHTML, /retry-payment|Обновить QR-код|Попробовать снова/);
    assert.match(ui.host.innerHTML, /data-action="leave-payment">Назад/);
  }
  ui.context.renderLorentsenState(ui.host, order("requires_action", {
    paymentMethod: { link: "https://pay.example.test/old", image: null, expiresAt: "2020-01-01T00:00:00Z" },
  }));
  assert.match(ui.host.innerHTML, /Проверяем срок действия QR-кода/);
  assert.doesNotMatch(ui.host.innerHTML, /data-checkout-state="expired"|Обновить QR-код/);
});
