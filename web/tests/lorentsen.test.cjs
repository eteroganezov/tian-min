const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { LorentsenPaymentProvider, PROVIDER_STATUSES, describePaymentPayload, parseRetryAfter } = require("../lib/lorentsen-provider.cjs");
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
const silentLogger = { info() {}, error() {} };

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
  const provider = new LorentsenPaymentProvider({ env: lorentsenEnv(), logger: silentLogger, fetch: async (url, options) => {
    calls.push({ url: String(url), options });
    return response(201, { payment_public_id: "pay_1", external_order_id: "ext_1", payment_status: "preparing", payment_method: null, retry_after_seconds: 7, trace_id: "trace_1" });
  } });
  const requestBody = { external_order_id: "ext_1", customer_amount_minor: 59900 };
  const result = await provider.createPayment({ requestBody, idempotencyKey: "idem_1" });
  assert.equal(calls[0].url, "https://api.lorentsen.pro/api/v1/integration/payments");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-token");
  assert.equal(calls[0].options.headers["Idempotency-Key"], "idem_1");
  assert.deepEqual(JSON.parse(calls[0].options.body), requestBody);
  assert.equal(result.status, "preparing");
  assert.equal(result.paymentMethod, null);
  assert.equal(result.retryAfterSeconds, 7);
});

test("provider принимает фактический nested create contract и 200 idempotent requires_action", async () => {
  const provider = new LorentsenPaymentProvider({ env: lorentsenEnv(), logger: silentLogger, fetch: async () => response(200, {
    data: { payment: {
      payment_public_id: "pay_2", external_order_id: "ext_2", payment_status: "requires_action",
      payment_method: { image: "https://cdn.example.test/qr.png", link: "https://pay.example.test/exact", expires_at: "2026-09-01T10:00:00Z" },
      retry_after_seconds: 8,
    } },
    trace_id: "trace_2",
  }) });
  const result = await provider.createPayment({ requestBody: {}, idempotencyKey: "idem_2" });
  assert.equal(result.httpStatus, 200);
  assert.equal(result.paymentMethod.link, "https://pay.example.test/exact");
  assert.equal(result.paymentMethod.image, "https://cdn.example.test/qr.png");
  assert.equal(result.paymentMethod.expiresAt, "2026-09-01T10:00:00.000Z");
  assert.equal(result.status, "requires_action");
  assert.equal(result.retryAfterSeconds, 8);
  assert.equal(result.traceId, "trace_2");
});

test("актуальный direct data contract одинаково работает для create 201 и authenticated GET 200", async () => {
  const responses = [
    response(201, { data: {
      payment_public_id: "01DIRECTCREATE", external_order_id: "order_direct_1", payment_status: "preparing",
      payment_method: null, retry_after_seconds: 4, created_at: "2026-08-13T00:00:00Z",
    }, meta: {}, request_id: "request-create" }),
    response(200, { data: {
      payment_public_id: "01DIRECTCREATE", external_order_id: "order_direct_1", payment_status: "requires_action",
      payment_method: { link: "https://pay.example.test/direct", image: "https://cdn.example.test/direct.png", expires_at: "2026-08-13T00:15:00Z" },
      retry_after_seconds: 5, updated_at: "2026-08-13T00:00:05Z",
    }, meta: {}, request_id: "request-get" }),
  ];
  const provider = new LorentsenPaymentProvider({ env: lorentsenEnv(), logger: silentLogger, fetch: async () => responses.shift() });
  const created = await provider.createPayment({ requestBody: { external_order_id: "order_direct_1" }, idempotencyKey: "idem-direct" });
  assert.equal(created.httpStatus, 201);
  assert.equal(created.paymentPublicId, "01DIRECTCREATE");
  assert.equal(created.status, "preparing");
  assert.equal(created.paymentMethod, null);
  const fetched = await provider.getPaymentStatus(created.paymentPublicId);
  assert.equal(fetched.httpStatus, 200);
  assert.equal(fetched.status, "requires_action");
  assert.deepEqual(fetched.paymentMethod, {
    link: "https://pay.example.test/direct",
    image: "https://cdn.example.test/direct.png",
    expiresAt: "2026-08-13T00:15:00.000Z",
  });
});

test("валидный nested payment_method не становится INVALID_PROVIDER_RESPONSE и логируется без QR payload", async () => {
  const entries = [];
  const provider = new LorentsenPaymentProvider({ env: lorentsenEnv(), logger: { info: (...args) => entries.push(args) }, fetch: async () => response(200, {
    data: {
      payment_public_id: "01SAFELOG", external_order_id: "order_safe_1", payment_status: "requires_action",
      payment_method: { link: "https://pay.example.test/private-path", image: "data:image/png;base64,cHJpdmF0ZS1xcg==", expires_at: "2026-08-13T00:15:00Z" },
      retry_after_seconds: 5,
    },
    meta: { trace_id: "trace-safe" }, request_id: "request-safe",
  }) });
  const result = await provider.createPayment({ requestBody: {}, idempotencyKey: "idem-safe" });
  assert.equal(result.status, "requires_action");
  assert.equal(entries[0][0], "[PAYMENT_PROVIDER_RESPONSE]");
  const diagnostic = JSON.parse(entries[0][1]);
  assert.equal(diagnostic.httpStatus, 200);
  assert.equal(diagnostic.paymentPublicId, "01SAFELOG");
  assert.equal(diagnostic.externalOrderId, "order_safe_1");
  assert.equal(diagnostic.paymentStatus, "requires_action");
  assert.equal(diagnostic.hasPaymentMethod, true);
  assert.equal(diagnostic.hasPaymentLink, true);
  assert.equal(diagnostic.hasPaymentImage, true);
  assert.equal(diagnostic.hasPaymentMethodExpiry, true);
  assert.deepEqual(diagnostic.topLevelFields, ["data", "meta", "request_id"]);
  assert.deepEqual(diagnostic.dataFields, ["payment_public_id", "external_order_id", "payment_status", "payment_method", "retry_after_seconds"]);
  assert.equal(diagnostic.requestId, "request-safe");
  assert.equal(diagnostic.traceId, "trace-safe");
  assert.match(diagnostic.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(entries[0][1], /private-path|cHJpdmF0ZS1xcg|test-token/);
});

test("structural diagnostics содержит только имена полей, а не provider values", () => {
  const shape = describePaymentPayload({ data: { payment: { payment_public_id: "pay_private", payer_email: "private@example.test", payment_status: "preparing" } } });
  assert.deepEqual(shape.fields, ["$.data", "$.data.payment", "$.data.payment.payment_public_id", "$.data.payment.payer_email", "$.data.payment.payment_status"]);
  assert.doesNotMatch(JSON.stringify(shape), /pay_private|private@example/);
});

test("409/422 не retry, 429/5xx retry и Retry-After сохраняется", async () => {
  for (const [status, retryable] of [[409, false], [422, false], [429, true], [503, true]]) {
    const provider = new LorentsenPaymentProvider({ env: lorentsenEnv(), logger: silentLogger, fetch: async () => response(status, { trace_id: "safe" }, { "Retry-After": "9" }) });
    await assert.rejects(provider.createPayment({ requestBody: {}, idempotencyKey: "idem" }), error => error.status === status && error.retryable === retryable && error.retryAfterSeconds === 9);
  }
  assert.equal(parseRetryAfter("6"), 6);
});

test("422 сохраняет безопасную provider-диагностику без email и request values", async () => {
  const provider = new LorentsenPaymentProvider({ env: lorentsenEnv(), logger: silentLogger, fetch: async () => response(422, {
    error: {
      code: "validation_error",
      type: "request_validation",
      message: "payer private@example.test has invalid consent",
      details: [{ field: "consent_version", value: "private-value" }, { field: "payer_email", value: "private@example.test" }],
    },
  }) });
  await assert.rejects(provider.createPayment({ requestBody: {}, idempotencyKey: "idem" }), error => {
    assert.equal(error.status, 422);
    assert.deepEqual(error.providerDetails, {
      providerCode: "validation_error",
      providerType: "request_validation",
      providerMessage: "payer [redacted-email] has invalid consent",
      fields: ["consent_version", "payer_email"],
    });
    assert.doesNotMatch(JSON.stringify(error.providerDetails), /private@example|private-value/);
    return true;
  });
});

test("все документированные provider statuses поддержаны, неизвестный становится provider_result_unknown", async () => {
  assert.deepEqual(PROVIDER_STATUSES, ["preparing", "processing", "requires_action", "succeeded_pending", "settled", "manual_review", "failed", "expired", "provider_result_unknown"]);
  for (const status of PROVIDER_STATUSES) {
    const providerForStatus = new LorentsenPaymentProvider({ env: lorentsenEnv(), logger: silentLogger, fetch: async () => response(200, { data: { payment_public_id: `pay_${status}`, external_order_id: `ext_${status}`, payment_status: status } }) });
    assert.equal((await providerForStatus.getPaymentStatus(`pay_${status}`)).status, status);
  }
  const provider = new LorentsenPaymentProvider({ env: lorentsenEnv(), logger: silentLogger, fetch: async () => response(200, { payment_public_id: "pay_unknown", external_order_id: "ext_unknown", payment_status: "invented" }) });
  assert.equal((await provider.getPaymentStatus("pay_unknown")).status, "provider_result_unknown");
  const initialized = new LorentsenPaymentProvider({ env: lorentsenEnv(), logger: silentLogger, fetch: async () => response(200, { data: { payment_public_id: "pay_initialized", external_order_id: "ext_initialized", payment_status: "INITIALIZED" } }) });
  assert.equal((await initialized.getPaymentStatus("pay_initialized")).status, "provider_result_unknown");
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
  const event = overrides.event || { id: overrides.id || "evt_1", type: overrides.type || "payment.settled", created_at: createdAt, data: { payment_public_id: overrides.paymentId || "pay_1" } };
  const rawBody = Buffer.from(JSON.stringify(event));
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

test("generic signed reachability event не требует payment_public_id", () => {
  const payload = signedWebhook({ event: { id: "evt_reachability", type: "endpoint.test", created_at: "2026-08-12T10:00:00.000Z" } });
  const verified = verifyLorentsenWebhook({ ...payload, secret: providerConfig.webhookSecret, signingKeyVersion: "v-test", now: Date.parse("2026-08-12T10:00:01Z") });
  assert.equal(verified.eventType, "endpoint.test");
  assert.equal(verified.paymentPublicId, null);
  assert.equal(verified.requiresPaymentReconciliation, false);
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
  const service = new PremiumService({ env: { NODE_ENV: "production", PAYMENT_MODE: "lorentsen" }, orderStore, reportStore, paymentProvider: provider, logger: options.logger || { error() {} }, now: options.now || (() => new Date("2026-08-12T10:00:01Z")) });
  return { service, orderStore, provider };
}
const validConsent = { email: "payer@example.test", termsAccepted: true, autoRedemptionAccepted: true };

test("INITIALIZED-equivalent через nested create запускает GET polling и reload получает usable QR", async () => {
  let externalOrderId;
  const calls = [];
  const provider = new LorentsenPaymentProvider({ env: lorentsenEnv(), logger: silentLogger, fetch: async (url, options) => {
    calls.push({ url: String(url), method: options.method });
    if (options.method === "POST") {
      externalOrderId = JSON.parse(options.body).external_order_id;
      return response(201, { data: {
        payment_public_id: "01POLLTHENQR", external_order_id: externalOrderId, payment_status: "INITIALIZED",
        payment_method: null, retry_after_seconds: 3,
      }, request_id: "request-initialized" });
    }
    return response(200, { data: {
      payment_public_id: "01POLLTHENQR", external_order_id: externalOrderId, payment_status: "requires_action",
      payment_method: { link: "https://pay.example.test/poll-result", image: "https://cdn.example.test/poll-result.png", expires_at: "2026-08-12T10:15:00Z" },
      retry_after_seconds: 5,
    }, request_id: "request-action" });
  } });
  let current = new Date("2026-08-12T10:00:01Z");
  const ctx = serviceSetup([], { provider, now: () => current });
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  const started = await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  assert.equal(started.body.order.status, "PAYMENT_PENDING");
  assert.equal(started.body.order.providerStatus, "provider_result_unknown");
  assert.equal(started.body.order.paymentId, "01POLLTHENQR");
  assert.equal(started.body.order.paymentMethod, null);
  current = new Date("2026-08-12T10:00:05Z");
  const recovered = await ctx.service.getOrder(order.orderId);
  assert.equal(recovered.body.order.providerStatus, "requires_action");
  assert.deepEqual(recovered.body.order.paymentMethod, {
    link: "https://pay.example.test/poll-result",
    image: "https://cdn.example.test/poll-result.png",
    expiresAt: "2026-08-12T10:15:00.000Z",
  });
  assert.deepEqual(calls.map(call => call.method), ["POST", "GET"]);
  const reloadedBeforeNextPoll = await ctx.service.getOrder(order.orderId);
  assert.deepEqual(reloadedBeforeNextPoll.body.order.paymentMethod, recovered.body.order.paymentMethod);
  assert.deepEqual(calls.map(call => call.method), ["POST", "GET"]);
});

test("production checkout хранит 59900 minor units, exact consent schema и server-side amount", async () => {
  const ctx = serviceSetup(["preparing"]);
  const order = (await ctx.service.createCheckout({ ...birthInput, amount: 1 })).body.order;
  assert.equal(order.amount, 599);
  const started = await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  assert.equal(started.body.order.status, "PAYMENT_PENDING");
  const attempt = ctx.provider.createCalls[0];
  assert.equal(attempt.requestBody.customer_amount_minor, 59900);
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
  const failedAttempt = await ctx.orderStore.loadAttempt(failedOrder.currentAttemptId);
  await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  assert.equal(ctx.provider.createCalls.length, 2);
  assert.equal(ctx.orderStore.attempts.size, 2);
  const replacement = [...ctx.orderStore.attempts.values()].find(item => item.attemptId !== failedAttempt.attemptId);
  assert.notEqual(replacement.externalOrderId, failedAttempt.externalOrderId);
  assert.notEqual(replacement.idempotencyKey, failedAttempt.idempotencyKey);
});

test("confirmed expired создаёт replacement только по явному start с новыми external_order_id и Idempotency-Key", async () => {
  const ctx = serviceSetup(["expired", "preparing"]);
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  const expired = await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  assert.equal(expired.body.order.providerStatus, "expired");
  assert.equal(expired.body.order.status, "CHECKOUT_STARTED");
  const original = await ctx.orderStore.loadAttempt(expired.body.order.currentAttemptId);
  assert.equal(ctx.provider.createCalls.length, 1);
  const replacementResult = await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  const replacement = await ctx.orderStore.loadAttempt(replacementResult.body.order.currentAttemptId);
  assert.equal(ctx.provider.createCalls.length, 2);
  assert.notEqual(replacement.attemptId, original.attemptId);
  assert.notEqual(replacement.externalOrderId, original.externalOrderId);
  assert.notEqual(replacement.idempotencyKey, original.idempotencyKey);
  assert.equal(replacement.sequence, original.sequence + 1);
});

test("manual_review и processing не разрешают replacement attempt", async () => {
  for (const status of ["manual_review", "processing"]) {
    const ctx = serviceSetup([status]);
    const order = (await ctx.service.createCheckout(birthInput)).body.order;
    await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
    await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
    assert.equal(ctx.provider.createCalls.length, 1);
    assert.equal(ctx.orderStore.attempts.size, 1);
    assert.equal((await ctx.service.getOrder(order.orderId)).body.order.status, "PAYMENT_PENDING");
  }
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

test("reload восстанавливает active attempt через тот же idempotent create и сохраняет payment method", async () => {
  const store = new MemoryOrderStore();
  const provider = new FakeLorentsenProvider();
  let calls = 0;
  provider.createPayment = async attempt => {
    provider.createCalls.push(structuredClone(attempt));
    calls += 1;
    if (calls === 1) {
      const error = new Error("provider response mapping failed");
      error.retryable = true;
      error.status = 502;
      error.code = "INVALID_PROVIDER_RESPONSE";
      throw error;
    }
    return payment("pay_recovered", "requires_action");
  };
  let current = new Date("2026-08-12T10:00:01Z");
  const ctx = serviceSetup([], { orderStore: store, provider, now: () => current });
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  assert.equal((await ctx.service.startPayment({ orderId: order.orderId, ...validConsent })).status, 503);
  current = new Date("2026-08-12T10:00:07Z");
  const recovered = await ctx.service.getOrder(order.orderId);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.order.providerStatus, "requires_action");
  assert.equal(recovered.body.order.paymentId, "pay_recovered");
  assert.equal(recovered.body.order.paymentMethod.link, "https://pay.example/exact");
  assert.equal(provider.createCalls.length, 2);
  assert.equal(provider.createCalls[0].attemptId, provider.createCalls[1].attemptId);
  assert.equal(provider.createCalls[0].idempotencyKey, provider.createCalls[1].idempotencyKey);
  assert.deepEqual(provider.createCalls[0].requestBody, provider.createCalls[1].requestBody);
});

test("temporary GET error сохраняет ранее полученный QR/link для reload recovery", async () => {
  const provider = new FakeLorentsenProvider(["requires_action"]);
  const ctx = serviceSetup([], { provider });
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  const started = await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  provider.getPaymentStatus = async paymentId => {
    provider.getCalls.push(paymentId);
    const error = new Error("network");
    error.status = 503;
    error.retryable = true;
    error.code = "PROVIDER_NETWORK_ERROR";
    throw error;
  };
  const result = await ctx.service.reconcilePayment(started.body.order.paymentId);
  assert.equal(result.status, 503);
  assert.equal(result.body.order.paymentMethod.link, "https://pay.example/exact");
});

test("reload использует payment_public_id из durable attempt, если order update был прерван", async () => {
  let current = new Date("2026-08-12T10:00:01Z");
  const ctx = serviceSetup(["requires_action", "requires_action"], { now: () => current });
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  const started = await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  await ctx.orderStore.save({ ...await ctx.orderStore.load(order.orderId), paymentId: null, paymentMethod: null });
  current = new Date("2026-08-12T10:00:07Z");
  const recovered = await ctx.service.getOrder(order.orderId);
  assert.equal(recovered.body.order.paymentId, started.body.order.paymentId);
  assert.equal(recovered.body.order.paymentMethod.link, "https://pay.example/exact");
  assert.equal(ctx.provider.createCalls.length, 1);
  assert.deepEqual(ctx.provider.getCalls, [started.body.order.paymentId]);
});

test("create failure пишет только redacted structural diagnostics", async () => {
  const entries = [];
  const provider = new FakeLorentsenProvider();
  provider.createPayment = async () => {
    const error = new Error("Lorentsen отклонил параметры платежа.");
    error.status = 422;
    error.code = "PROVIDER_VALIDATION_ERROR";
    error.providerDetails = { providerCode: "validation_error", providerType: null, providerMessage: "invalid field", fields: ["consent_version"] };
    throw error;
  };
  const ctx = serviceSetup([], { provider, logger: { error: (...args) => entries.push(args) } });
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  const result = await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  assert.equal(result.status, 422);
  const attempt = [...ctx.orderStore.attempts.values()][0];
  assert.deepEqual(attempt.failureInfo.provider.fields, ["consent_version"]);
  assert.match(entries[0][0], /PAYMENT_PROVIDER_ERROR/);
  assert.match(entries[0][1], /consent_version/);
  assert.doesNotMatch(entries.flat().join(" "), /payer@example|test-token|webhook-test-secret/);
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

test("reachability event сохраняется, duplicate идемпотентен и reconciliation не запускается", async () => {
  const ctx = serviceSetup([]);
  const payload = signedWebhook({ event: { id: "evt_reachability", type: "endpoint.test", created_at: "2026-08-12T10:00:00.000Z" } });
  assert.equal((await ctx.service.handleLorentsenWebhook(payload.rawBody, payload.headers)).status, 202);
  assert.equal((await ctx.service.handleLorentsenWebhook(payload.rawBody, payload.headers)).status, 200);
  await ctx.service.waitForWebhookJobs();
  assert.equal(ctx.provider.getCalls.length, 0);
  const stored = await ctx.orderStore.loadWebhook("evt_reachability");
  assert.equal(stored.processingStatus, "not_applicable");
  assert.equal(stored.eventPayload.type, "endpoint.test");
});

test("invalid signature и key version не сохраняются в durable inbox", async () => {
  const ctx = serviceSetup([]);
  const badSignature = signedWebhook({ id: "evt_bad_signature", signature: "v1=bad" });
  const badVersion = signedWebhook({ id: "evt_bad_version", keyVersion: "wrong" });
  const badEventId = signedWebhook({ id: "evt_body", headerId: "evt_header" });
  assert.equal((await ctx.service.handleLorentsenWebhook(badSignature.rawBody, badSignature.headers)).status, 401);
  assert.equal((await ctx.service.handleLorentsenWebhook(badVersion.rawBody, badVersion.headers)).status, 401);
  assert.equal((await ctx.service.handleLorentsenWebhook(badEventId.rawBody, badEventId.headers)).status, 400);
  assert.equal(ctx.orderStore.webhooks.size, 0);
});

test("payment.succeeded webhook максимум succeeded_pending; payment.settled + GET authorizes PAID", async () => {
  const ctx = serviceSetup(["preparing", "settled", "settled"]);
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  const started = await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  const succeeded = signedWebhook({ id: "evt_success", type: "payment.succeeded", paymentId: started.body.order.paymentId });
  assert.equal((await ctx.service.handleLorentsenWebhook(succeeded.rawBody, succeeded.headers)).status, 202);
  await ctx.service.waitForWebhookJobs();
  assert.equal((await ctx.service.getOrder(order.orderId)).body.order.status, "PAYMENT_PENDING");
  const settled = signedWebhook({ id: "evt_settled", type: "payment.settled", paymentId: started.body.order.paymentId });
  assert.equal((await ctx.service.handleLorentsenWebhook(settled.rawBody, settled.headers)).status, 202);
  await ctx.service.waitForWebhookJobs();
  assert.equal((await ctx.service.getOrder(order.orderId)).body.order.status, "PAID");
});

test("webhook acceptance не ждёт зависший provider GET", async () => {
  const provider = new FakeLorentsenProvider(["preparing"]);
  let release;
  provider.getPaymentStatus = paymentId => { provider.getCalls.push(paymentId); return new Promise(resolve => { release = () => resolve(payment(paymentId, "processing")); }); };
  const ctx = serviceSetup([], { provider });
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  const started = await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  const webhook = signedWebhook({ id: "evt_deferred", type: "payment.succeeded", paymentId: started.body.order.paymentId });
  const accepted = await Promise.race([ctx.service.handleLorentsenWebhook(webhook.rawBody, webhook.headers), new Promise((_, reject) => setTimeout(() => reject(new Error("acceptance waited for GET")), 50))]);
  assert.equal(accepted.status, 202);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await ctx.orderStore.loadWebhook("evt_deferred")).processingStatus, "processing");
  release();
  await ctx.service.waitForWebhookJobs();
});

test("out-of-order succeeded после settled не откатывает PAID и duplicate settled не выполняет fulfillment повторно", async () => {
  const ctx = serviceSetup(["preparing", "settled", "settled"]);
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  const started = await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  const settled = signedWebhook({ id: "evt_settled_first", type: "payment.settled", paymentId: started.body.order.paymentId });
  await ctx.service.handleLorentsenWebhook(settled.rawBody, settled.headers);
  await ctx.service.waitForWebhookJobs();
  const paid = (await ctx.service.getOrder(order.orderId)).body.order;
  const late = signedWebhook({ id: "evt_success_late", type: "payment.succeeded", paymentId: started.body.order.paymentId });
  await ctx.service.handleLorentsenWebhook(late.rawBody, late.headers);
  await ctx.service.waitForWebhookJobs();
  const after = (await ctx.service.getOrder(order.orderId)).body.order;
  assert.equal(after.status, "PAID");
  assert.equal(after.paymentConfirmedAt, paid.paymentConfirmedAt);
});

test("reconciliation timeout не меняет webhook 202 и остаётся durable retry work", async () => {
  const provider = new FakeLorentsenProvider(["preparing"]);
  provider.getPaymentStatus = async paymentId => { provider.getCalls.push(paymentId); const error = new Error("timeout"); error.status = 503; error.retryable = true; error.code = "PROVIDER_TIMEOUT"; throw error; };
  const ctx = serviceSetup([], { provider });
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  const started = await ctx.service.startPayment({ orderId: order.orderId, ...validConsent });
  const webhook = signedWebhook({ id: "evt_timeout", type: "payment.settled", paymentId: started.body.order.paymentId });
  const accepted = await ctx.service.handleLorentsenWebhook(webhook.rawBody, webhook.headers);
  assert.equal(accepted.status, 202);
  await ctx.service.waitForWebhookJobs();
  const stored = await ctx.orderStore.loadWebhook("evt_timeout");
  assert.equal(stored.processingStatus, "retry");
  assert.equal(stored.lastProcessingError.code, "RECONCILIATION_FAILED");
  assert.equal((await ctx.service.getOrder(order.orderId)).body.order.status, "PAYMENT_PENDING");
  const recoveredProvider = new FakeLorentsenProvider(["settled"]);
  const recovered = serviceSetup([], { orderStore: ctx.orderStore, provider: recoveredProvider });
  await recovered.service.processPendingWebhooks();
  assert.equal((await ctx.orderStore.loadWebhook("evt_timeout")).processingStatus, "processed");
  assert.equal((await recovered.service.getOrder(order.orderId)).body.order.status, "PAID");
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
