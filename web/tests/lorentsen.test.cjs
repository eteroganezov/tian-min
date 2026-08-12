const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { LorentsenPaymentProvider, PROVIDER_STATUSES, parseRetryAfter } = require("../lib/lorentsen-provider.cjs");
const { verifyLorentsenWebhook } = require("../lib/lorentsen-webhook.cjs");
const { MemoryOrderStore } = require("../lib/order-store.cjs");
const { PremiumService } = require("../lib/premium-service.cjs");
const { PostgresPaymentStore } = require("../lib/production-store.cjs");
const { locationProvider } = require("../lib/location-provider.cjs");

const birthInput = { name: "Тест", date: "1995-09-03", time: "05:50", gender: "male", placeId: locationProvider.search("Москва")[0].id };
const providerConfig = {
  apiBaseUrl: "https://api.lorentsen.pro/", apiToken: "test-token", webhookEndpointId: "endpoint-test",
  webhookSecret: "webhook-test-secret", webhookSigningKeyVersion: "v-test", partnerPublicName: "Edward",
  publicBaseUrl: "https://example.test", termsUrl: "https://example.test/terms", privacyUrl: "https://example.test/privacy",
  autoRedemptionTermsUrl: "https://example.test/redemption", consentVersion: "certificate_purchase_terms_v1",
  autoRedemptionConsentVersion: "partner_auto_redemption_consent_v1", requestTimeoutMs: 1_000,
};

function lorentsenEnv(overrides = {}) {
  return {
    NODE_ENV: "production", PAYMENT_MODE: "lorentsen", DATABASE_URL: "postgres://test", LORENTSEN_API_TOKEN: "test-token",
    LORENTSEN_WEBHOOK_ENDPOINT_ID: "endpoint-test", LORENTSEN_WEBHOOK_SECRET: "webhook-test-secret",
    LORENTSEN_WEBHOOK_SIGNING_KEY_VERSION: "v-test", LORENTSEN_PARTNER_PUBLIC_NAME: "Edward",
    PUBLIC_BASE_URL: "https://example.test", LORENTSEN_TERMS_URL: "https://example.test/terms",
    LORENTSEN_PRIVACY_URL: "https://example.test/privacy", LORENTSEN_AUTO_REDEMPTION_TERMS_URL: "https://example.test/redemption",
    ...overrides,
  };
}

function response(status, body, headers = {}) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } }); }

test("Lorentsen create использует exact endpoint, bearer и stable idempotency body", async () => {
  const calls = [];
  const provider = new LorentsenPaymentProvider({ env: lorentsenEnv(), fetch: async (url, options) => {
    calls.push({ url: String(url), options });
    return response(201, { payment_public_id: "pay_1", external_order_id: "ext_1", status: "preparing", payment_method: null, retry_after_seconds: 7, trace_id: "trace_1" });
  } });
  const requestBody = { external_order_id: "ext_1", customer_amount_minor: 39900 };
  const result = await provider.createPayment({ requestBody, idempotencyKey: "idem_1" });
  assert.equal(calls[0].url, "https://api.lorentsen.pro/api/v1/integration/payments");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-token");
  assert.equal(calls[0].options.headers["Idempotency-Key"], "idem_1");
  assert.deepEqual(JSON.parse(calls[0].options.body), requestBody);
  assert.equal(result.status, "preparing");
  assert.equal(result.paymentMethod, null);
  assert.equal(result.retryAfterSeconds, 7);
});

test("provider принимает 200 idempotent result и нормализует requires_action без декодирования QR", async () => {
  const provider = new LorentsenPaymentProvider({ env: lorentsenEnv(), fetch: async () => response(200, {
    payment_public_id: "pay_2", external_order_id: "ext_2", status: "requires_action",
    payment_method: { image: "https://cdn.example.test/qr.png", link: "https://pay.example.test/exact", expires_at: "2026-09-01T10:00:00Z" },
  }) });
  const result = await provider.createPayment({ requestBody: {}, idempotencyKey: "idem_2" });
  assert.equal(result.httpStatus, 200);
  assert.equal(result.paymentMethod.link, "https://pay.example.test/exact");
  assert.equal(result.paymentMethod.image, "https://cdn.example.test/qr.png");
  assert.equal(result.paymentMethod.expiresAt, "2026-09-01T10:00:00.000Z");
});

test("409/422 не retry, 429/5xx retry и Retry-After сохраняется", async () => {
  for (const [status, retryable] of [[409, false], [422, false], [429, true], [503, true]]) {
    const provider = new LorentsenPaymentProvider({ env: lorentsenEnv(), fetch: async () => response(status, { trace_id: "safe" }, { "Retry-After": "9" }) });
    await assert.rejects(provider.createPayment({ requestBody: {}, idempotencyKey: "idem" }), error => error.status === status && error.retryable === retryable && error.retryAfterSeconds === 9);
  }
  assert.equal(parseRetryAfter("6"), 6);
});

test("все документированные provider statuses поддержаны, неизвестный становится provider_result_unknown", async () => {
  assert.deepEqual(PROVIDER_STATUSES, ["preparing", "processing", "requires_action", "succeeded_pending", "settled", "manual_review", "failed", "expired", "provider_result_unknown"]);
  const provider = new LorentsenPaymentProvider({ env: lorentsenEnv(), fetch: async () => response(200, { payment_public_id: "pay_unknown", external_order_id: "ext_unknown", status: "invented" }) });
  assert.equal((await provider.getPaymentStatus("pay_unknown")).status, "provider_result_unknown");
});

test("production Lorentsen configuration fail-closed и API base защищён от SSRF", () => {
  assert.throws(() => new LorentsenPaymentProvider({ env: { NODE_ENV: "production", PAYMENT_MODE: "lorentsen" } }), /не настроены/);
  assert.throws(() => new LorentsenPaymentProvider({ env: lorentsenEnv({ LORENTSEN_API_BASE_URL: "https://evil.example" }) }), /api\.lorentsen\.pro/);
});

test("PostgreSQL production store создаёт durable orders, attempts, consent, inbox, anomalies и reports tables", async () => {
  const queries = [];
  const pool = { query: async sql => { queries.push(sql); return { rows: [], rowCount: 0 }; } };
  const store = new PostgresPaymentStore({ pool });
  await store.ready;
  const schema = queries.join("\n");
  for (const table of ["tian_min_orders", "tian_min_payment_attempts", "tian_min_consent_records", "tian_min_webhook_inbox", "tian_min_payment_anomalies", "tian_min_reports"]) assert.match(schema, new RegExp(table));
  assert.throws(() => new PostgresPaymentStore({ env: {} }), /DATABASE_URL/);
});

test("создание attempt + consent + order status выполняется одной PostgreSQL transaction", async () => {
  const statements = [];
  const order = { orderId: "order_123", checkoutKeyHash: "hash", status: "PAYMENT_PENDING" };
  const client = {
    query: async sql => { statements.push(sql); return String(sql).startsWith("UPDATE tian_min_orders") ? { rows: [{ record: order }] } : { rows: [], rowCount: 1 }; },
    release() { statements.push("RELEASE"); },
  };
  const store = new PostgresPaymentStore({ pool: { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => client } });
  await store.ready;
  await store.beginPaymentAttempt({
    order,
    attempt: { attemptId: "attempt_123", orderId: order.orderId, externalOrderId: "external_123", idempotencyKey: "idem_123", providerStatus: "creating", requestBodyHash: "body_hash" },
    consent: { externalConsentReference: "consent_123", orderId: order.orderId, attemptId: "attempt_123", payerEmail: "private@example.test" },
  });
  assert.equal(statements[0], "BEGIN");
  assert.equal(statements.at(-2), "COMMIT");
  assert.equal(statements.at(-1), "RELEASE");
});

function signedWebhook(overrides = {}) {
  const createdAt = overrides.createdAt || "2026-08-12T10:00:00.000Z";
  const event = { id: overrides.id || "evt_1", type: overrides.type || "payment.settled", created_at: createdAt, data: { payment_public_id: overrides.paymentId || "pay_1" } };
  const rawBody = Buffer.from(JSON.stringify(overrides.event || event));
  const signature = `v1=${crypto.createHmac("sha256", providerConfig.webhookSecret).update(rawBody).digest("base64")}`;
  return { rawBody, headers: { "x-lorensten-event-id": overrides.headerId || event.id, "x-lorensten-timestamp": overrides.headerTimestamp || createdAt, "x-lorensten-signature": overrides.signature || signature, "x-lorensten-signing-key-version": overrides.keyVersion || providerConfig.webhookSigningKeyVersion } };
}

test("webhook проверяет raw-body HMAC, key version, event ID и timestamp", () => {
  const valid = signedWebhook();
  const verified = verifyLorentsenWebhook({ ...valid, secret: providerConfig.webhookSecret, signingKeyVersion: providerConfig.webhookSigningKeyVersion, now: Date.parse("2026-08-12T10:00:01Z") });
  assert.equal(verified.paymentPublicId, "pay_1");
  assert.throws(() => verifyLorentsenWebhook({ ...signedWebhook({ signature: "v1=bad" }), secret: providerConfig.webhookSecret, signingKeyVersion: "v-test", now: Date.parse("2026-08-12T10:00:01Z") }), /signature/);
  assert.throws(() => verifyLorentsenWebhook({ ...signedWebhook({ keyVersion: "wrong" }), secret: providerConfig.webhookSecret, signingKeyVersion: "v-test", now: Date.parse("2026-08-12T10:00:01Z") }), /верси/i);
  assert.throws(() => verifyLorentsenWebhook({ ...signedWebhook({ headerId: "evt_other" }), secret: providerConfig.webhookSecret, signingKeyVersion: "v-test", now: Date.parse("2026-08-12T10:00:01Z") }), /Event ID/);
});

test("webhook отклоняет >300 sec future, но принимает старый legitimate replay", () => {
  const future = signedWebhook({ createdAt: "2026-08-12T10:06:00Z" });
  assert.throws(() => verifyLorentsenWebhook({ ...future, secret: providerConfig.webhookSecret, signingKeyVersion: "v-test", now: Date.parse("2026-08-12T10:00:00Z") }), /будущем/);
  const old = signedWebhook({ createdAt: "2025-01-01T00:00:00Z" });
  assert.equal(verifyLorentsenWebhook({ ...old, secret: providerConfig.webhookSecret, signingKeyVersion: "v-test", now: Date.parse("2026-08-12T10:00:00Z") }).eventId, "evt_1");
});

class FakeLorentsenProvider {
  constructor(statuses = ["preparing"]) { this.name = "lorentsen"; this.config = providerConfig; this.statuses = [...statuses]; this.createCalls = []; this.getCalls = []; }
  async createPayment(attempt) { this.createCalls.push(structuredClone(attempt)); const status = this.statuses.shift() || "preparing"; return payment(`pay_${attempt.attemptId.slice(-6)}`, status); }
  async getPaymentStatus(paymentId) { this.getCalls.push(paymentId); return payment(paymentId, this.statuses.shift() || "processing"); }
}
function payment(paymentPublicId, status) { return { paymentId: paymentPublicId, paymentPublicId, status, paymentMethod: status === "requires_action" ? { image: "https://cdn.example/qr", link: "https://pay.example/exact", expiresAt: "2026-09-01T10:00:00.000Z" } : null, retryAfterSeconds: 5, traceId: "trace" }; }
function serviceSetup(statuses, options = {}) {
  const orderStore = options.orderStore || new MemoryOrderStore();
  const provider = options.provider || new FakeLorentsenProvider(statuses);
  const reportStore = { load: async () => null, save: async value => value };
  const service = new PremiumService({ env: { NODE_ENV: "production", PAYMENT_MODE: "lorentsen" }, orderStore, reportStore, paymentProvider: provider, now: options.now || (() => new Date("2026-08-12T10:00:01Z")) });
  return { service, orderStore, provider };
}
const validConsent = { email: "payer@example.test", termsAccepted: true, autoRedemptionAccepted: true };

test("production checkout хранит 39900 minor units, exact consent schema и server-side amount", async () => {
  const ctx = serviceSetup(["preparing"]);
  const order = (await ctx.service.createCheckout({ ...birthInput, amount: 1 })).body.order;
  assert.equal(order.amount, 399);
  const started = await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  assert.equal(started.body.order.status, "PAYMENT_PENDING");
  const attempt = ctx.provider.createCalls[0];
  assert.equal(attempt.requestBody.customer_amount_minor, 39900);
  assert.equal(attempt.requestBody.customer_currency, "RUB");
  assert.equal(attempt.requestBody.consent_version, "certificate_purchase_terms_v1");
  assert.equal(attempt.requestBody.auto_redemption_consent_version, "partner_auto_redemption_consent_v1");
  assert.equal(ctx.orderStore.consents.size, 1);
  assert.equal([...ctx.orderStore.consents.values()][0].displayedPartnerPublicName, "Edward");
});

test("email и две отдельные consent actions обязательны", async () => {
  const ctx = serviceSetup();
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  assert.equal((await ctx.service.startPayment({ orderId: order.orderId, ...validConsent, email: "bad" })).status, 400);
  assert.equal((await ctx.service.startPayment({ orderId: order.orderId, ...validConsent, termsAccepted: false })).status, 400);
  assert.equal((await ctx.service.startPayment({ orderId: order.orderId, ...validConsent, autoRedemptionAccepted: false })).status, 400);
  assert.equal(ctx.provider.createCalls.length, 0);
});

test("non-terminal attempt не дублируется, failed/expired разрешают новую attempt", async () => {
  const ctx = serviceSetup(["preparing", "processing", "failed", "preparing"]);
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  const first = await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  assert.equal(ctx.provider.createCalls.length, 1);
  await ctx.service.reconcilePayment(first.body.order.paymentId);
  await ctx.service.reconcilePayment(first.body.order.paymentId);
  const failedOrder = (await ctx.service.getOrder(order.orderId)).body.order;
  assert.equal(failedOrder.paymentFailureReason, "failed");
  await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  assert.equal(ctx.provider.createCalls.length, 2);
  assert.equal(ctx.orderStore.attempts.size, 2);
});

test("retryable create failure повторяет тот же attempt, idempotency key и exact body", async () => {
  const store = new MemoryOrderStore();
  let calls = 0;
  const provider = new FakeLorentsenProvider();
  provider.createPayment = async attempt => {
    provider.createCalls.push(structuredClone(attempt));
    calls += 1;
    if (calls === 1) { const error = new Error("timeout"); error.retryable = true; error.status = 503; error.code = "PROVIDER_TIMEOUT"; throw error; }
    return payment("pay_retry", "preparing");
  };
  let current = new Date("2026-08-12T10:00:01Z");
  const ctx = serviceSetup([], { orderStore: store, provider, now: () => current });
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  assert.equal((await ctx.service.startPayment({ orderId: order.orderId, ...validConsent })).status, 503);
  current = new Date("2026-08-12T10:00:07Z");
  await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  assert.equal(provider.createCalls.length, 2);
  assert.equal(provider.createCalls[0].attemptId, provider.createCalls[1].attemptId);
  assert.equal(provider.createCalls[0].idempotencyKey, provider.createCalls[1].idempotencyKey);
  assert.deepEqual(provider.createCalls[0].requestBody, provider.createCalls[1].requestBody);
});

test("succeeded_pending не выставляет PAID, authenticated GET settled выставляет", async () => {
  const ctx = serviceSetup(["succeeded_pending", "settled"]);
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  const pending = await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  assert.equal(pending.body.order.status, "PAYMENT_PENDING");
  const paid = await ctx.service.reconcilePayment(pending.body.order.paymentId);
  assert.equal(paid.body.order.status, "PAID");
  assert.equal(ctx.provider.getCalls.length, 1);
});

test("production settled не запускает stub/OpenAI generation автоматически", async () => {
  const ctx = serviceSetup(["settled"]);
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  const paid = await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  assert.equal(paid.body.order.status, "PAID");
  assert.equal((await ctx.service.generate(order.orderId)).status, 503);
});

test("webhook durable inbox: new=202, duplicate=200, changed body conflict", async () => {
  const ctx = serviceSetup(["preparing", "settled", "settled"]);
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  const started = await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  const firstPayload = signedWebhook({ paymentId: started.body.order.paymentId });
  assert.equal((await ctx.service.handleLorentsenWebhook(firstPayload.rawBody, firstPayload.headers)).status, 202);
  assert.equal((await ctx.service.handleLorentsenWebhook(firstPayload.rawBody, firstPayload.headers)).status, 200);
  const changed = signedWebhook({ id: "evt_1", paymentId: started.body.order.paymentId, type: "payment.succeeded" });
  assert.equal((await ctx.service.handleLorentsenWebhook(changed.rawBody, changed.headers)).status, 409);
});

test("payment.succeeded webhook максимум succeeded_pending; payment.settled + GET authorizes PAID", async () => {
  const ctx = serviceSetup(["preparing", "settled", "settled"]);
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  const started = await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  const succeeded = signedWebhook({ id: "evt_success", type: "payment.succeeded", paymentId: started.body.order.paymentId });
  await ctx.service.handleLorentsenWebhook(succeeded.rawBody, succeeded.headers);
  assert.equal((await ctx.service.getOrder(order.orderId)).body.order.status, "PAYMENT_PENDING");
  const settled = signedWebhook({ id: "evt_settled", type: "payment.settled", paymentId: started.body.order.paymentId });
  await ctx.service.handleLorentsenWebhook(settled.rawBody, settled.headers);
  assert.equal((await ctx.service.getOrder(order.orderId)).body.order.status, "PAID");
});

test("out-of-order succeeded после settled не откатывает PAID и duplicate settled не выполняет fulfillment повторно", async () => {
  const ctx = serviceSetup(["preparing", "settled", "settled"]);
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  const started = await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  const settled = signedWebhook({ id: "evt_settled_first", type: "payment.settled", paymentId: started.body.order.paymentId });
  await ctx.service.handleLorentsenWebhook(settled.rawBody, settled.headers);
  const paid = (await ctx.service.getOrder(order.orderId)).body.order;
  const late = signedWebhook({ id: "evt_success_late", type: "payment.succeeded", paymentId: started.body.order.paymentId });
  await ctx.service.handleLorentsenWebhook(late.rawBody, late.headers);
  const after = (await ctx.service.getOrder(order.orderId)).body.order;
  assert.equal(after.status, "PAID");
  assert.equal(after.paymentConfirmedAt, paid.paymentConfirmedAt);
});

test("durable inbox failure returns 5xx and never trusts webhook payload", async () => {
  const store = new MemoryOrderStore();
  store.recordWebhook = () => { throw new Error("database down"); };
  const ctx = serviceSetup(["preparing"], { orderStore: store });
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  const started = await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  const webhook = signedWebhook({ paymentId: started.body.order.paymentId });
  assert.equal((await ctx.service.handleLorentsenWebhook(webhook.rawBody, webhook.headers)).status, 503);
  assert.equal((await ctx.service.getOrder(order.orderId)).body.order.status, "PAYMENT_PENDING");
});

test("две settled attempts дают одно PAID fulfillment и anomaly", async () => {
  const ctx = serviceSetup(["settled"]);
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  const first = await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  const original = await ctx.orderStore.loadAttempt(first.body.order.currentAttemptId);
  const second = { ...original, attemptId: "attempt_22222222222222222222222222222222", externalOrderId: `${order.orderId}_2`, idempotencyKey: "idem_22222222222222222222222222222222", paymentPublicId: "pay_second", providerStatus: "settled" };
  await ctx.orderStore.saveAttempt(second);
  await ctx.service.applyProviderStatus(await ctx.orderStore.load(order.orderId), second, payment("pay_second", "settled"));
  assert.equal((await ctx.service.getOrder(order.orderId)).body.order.status, "PAID");
  assert.equal(ctx.orderStore.anomalies.length, 1);
});
