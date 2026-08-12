const crypto = require("node:crypto");
const { calculateBirthChart } = require("./birth-chart-pipeline.cjs");
const { canonicalBirthInput, normalizeDisplayName } = require("./personalization.cjs");
const { createFingerprints } = require("./report-fingerprint.cjs");
const { currentReportYears } = require("./report-service.cjs");
const { getProductConfig } = require("./product-config.cjs");
const { TERMINAL_STATUSES } = require("./lorentsen-provider.cjs");
const { verifyLorentsenWebhook } = require("./lorentsen-webhook.cjs");

const ORDER_STATES = Object.freeze(["FREE_PREVIEW", "CHECKOUT_STARTED", "PAYMENT_PENDING", "PAID", "REPORT_GENERATING", "REPORT_READY", "REPORT_FAILED"]);
const ACTIVE_PROVIDER_STATUSES = new Set(["creating", "preparing", "processing", "requires_action", "succeeded_pending", "manual_review", "provider_result_unknown"]);

class PremiumService {
  constructor(options) {
    this.env = options.env || process.env;
    this.orderStore = options.orderStore;
    this.reportStore = options.reportStore;
    this.paymentProvider = options.paymentProvider;
    this.config = options.config || getProductConfig(this.env);
    this.stubGenerator = options.stubGenerator || defaultStubGenerator;
    this.generationPromises = new Map();
    this.webhookJobs = new Set();
    this.now = options.now || (() => new Date());
  }

  getConfig() {
    const lorentsen = this.paymentProvider.name === "lorentsen" ? this.paymentProvider.config : null;
    return {
      productId: this.config.productId, amount: this.config.amount, currency: this.config.currency,
      priceIsDevPlaceholder: this.config.priceIsDevPlaceholder,
      available: this.config.available && this.paymentProvider.name !== "unconfigured",
      paymentMode: this.paymentProvider.name,
      ...(lorentsen ? { partnerPublicName: lorentsen.partnerPublicName, consent: { termsUrl: lorentsen.termsUrl, privacyUrl: lorentsen.privacyUrl, autoRedemptionTermsUrl: lorentsen.autoRedemptionTermsUrl } } : {}),
    };
  }

  async createCheckout(input) {
    if (!this.config.available || this.paymentProvider.name === "unconfigured") return failure(503, "Продажа полного разбора пока не настроена.");
    let ids;
    let birthInput;
    try {
      birthInput = canonicalBirthInput(input);
      const calculation = calculateBirthChart(birthInput);
      ids = createFingerprints({ input: birthInput, calculation, displayName: normalizeDisplayName(input?.name), model: this.env.OPENAI_MODEL || "gpt-5.6-terra", reportYears: currentReportYears() });
    } catch (error) { return failure(400, safeMessage(error)); }
    const checkoutKeyHash = hash(`${ids.reportId}:${this.config.productId}:${this.config.amount}:${this.config.currency}`);
    const existing = await this.orderStore.findByCheckoutKey(checkoutKeyHash);
    if (existing) return success(200, existing);
    const now = this.isoNow();
    const order = {
      orderId: randomId("order"), chartId: ids.chartId, reportId: ids.reportId,
      createdAt: now, updatedAt: now, status: "CHECKOUT_STARTED",
      amount: this.config.amount, currency: this.config.currency,
      paymentProvider: this.paymentProvider.name, paymentId: null, currentAttemptId: null,
      providerStatus: null, paymentMethod: null, nextPollAt: null, paymentConfirmedAt: null,
      reportGenerationStartedAt: null, reportGenerationCompletedAt: null,
      checkoutKeyHash, birthInput, displayName: normalizeDisplayName(input?.name), paymentFailureReason: null,
    };
    return success(201, await this.orderStore.save(order));
  }

  async startPayment(input) {
    const request = typeof input === "string" ? { orderId: input } : input || {};
    const order = await this.orderStore.load(request.orderId);
    if (!order) return failure(404, "Заказ не найден.");
    if (["PAID", "REPORT_GENERATING", "REPORT_READY"].includes(order.status)) return success(200, order);
    if (this.paymentProvider.name === "mock") return this.startMockPayment(order);
    if (this.paymentProvider.name !== "lorentsen") return failure(503, "Платёжный способ пока не настроен.");
    return this.startLorentsenPayment(order, request);
  }

  async startMockPayment(order) {
    if (order.status === "PAYMENT_PENDING" && order.paymentId) return success(200, order);
    try {
      const payment = await this.paymentProvider.createPayment(order);
      return success(200, await this.saveOrder(order, { status: "PAYMENT_PENDING", paymentId: payment.paymentId, providerStatus: payment.status, paymentFailureReason: null }));
    } catch (error) { return failure(503, error.message || "Платёжный способ пока недоступен."); }
  }

  async startLorentsenPayment(order, input) {
    const attempts = await this.orderStore.listAttemptsByOrder(order.orderId);
    let attempt = order.currentAttemptId ? await this.orderStore.loadAttempt(order.currentAttemptId) : null;
    if (attempt && ACTIVE_PROVIDER_STATUSES.has(attempt.providerStatus)) {
      if (attempt.nextPollAt && Date.parse(attempt.nextPollAt) > this.now().getTime()) return success(200, order);
      if (attempt.paymentPublicId) return this.reconcilePayment(attempt.paymentPublicId);
      return this.createProviderPayment(order, attempt);
    }
    if (attempt && !TERMINAL_STATUSES.has(attempt.providerStatus)) return failure(409, "Предыдущая попытка оплаты требует ручной проверки.");
    const validation = validatePaymentInput(input);
    if (validation.error) return failure(400, validation.error);
    attempt = this.buildAttempt(order, validation, attempts.length + 1);
    const consent = buildConsentRecord(order, attempt, validation, this.paymentProvider.config, this.isoNow());
    const pendingOrder = { ...order, status: "PAYMENT_PENDING", currentAttemptId: attempt.attemptId, paymentId: null, providerStatus: "creating", paymentMethod: null, paymentFailureReason: null, updatedAt: this.isoNow() };
    try {
      order = this.orderStore.beginPaymentAttempt ? await this.orderStore.beginPaymentAttempt({ order: pendingOrder, attempt, consent }) : await this.persistPaymentAttempt(pendingOrder, attempt, consent);
    } catch (error) {
      if (error?.code === "23505") return failure(409, "Платёжная попытка уже создаётся. Обновите статус заказа.");
      throw error;
    }
    return this.createProviderPayment(order, attempt);
  }

  async persistPaymentAttempt(order, attempt, consent) { await this.orderStore.saveAttempt(attempt); await this.orderStore.saveConsent(consent); return this.orderStore.save(order); }

  buildAttempt(order, validation, sequence) {
    const attemptId = randomId("attempt");
    const externalOrderId = `${order.orderId}_${sequence}`;
    const idempotencyKey = randomId("idem");
    const externalConsentReference = randomId("consent");
    const cfg = this.paymentProvider.config;
    const requestBody = {
      external_order_id: externalOrderId,
      customer_amount_minor: order.amount * 100,
      customer_currency: order.currency,
      description: "Персональный цифровой отчёт «Тянь Мин»",
      webhook_endpoint_id: cfg.webhookEndpointId,
      payer_email: validation.email,
      terms_accepted: true,
      consent_version: cfg.consentVersion,
      auto_redemption_accepted: true,
      auto_redemption_consent_version: cfg.autoRedemptionConsentVersion,
      locale: "ru",
      external_consent_reference: externalConsentReference,
    };
    const now = this.isoNow();
    return {
      attemptId, orderId: order.orderId, sequence, externalOrderId, idempotencyKey, externalConsentReference,
      requestBody, requestBodyHash: hash(JSON.stringify(requestBody)), paymentPublicId: null,
      providerStatus: "creating", statusHistory: [{ status: "creating", at: now }], retryTimestamps: [],
      paymentMethod: null, paymentMethodExpiry: null, nextPollAt: null, traceId: null,
      failureInfo: null, createdAt: now, updatedAt: now,
    };
  }

  async createProviderPayment(order, attempt) {
    try {
      const payment = await this.paymentProvider.createPayment(attempt);
      if (payment.externalOrderId && payment.externalOrderId !== attempt.externalOrderId) throw providerBindingError();
      attempt = updateAttempt(attempt, payment, this.isoNow());
      await this.orderStore.saveAttempt(attempt);
      return this.applyProviderStatus(order, attempt, payment);
    } catch (error) {
      const now = this.isoNow();
      attempt.retryTimestamps = [...attempt.retryTimestamps, now];
      attempt.failureInfo = { code: error.code || "PROVIDER_ERROR", httpStatus: error.status || 503, retryable: Boolean(error.retryable), at: now };
      attempt.traceId = error.traceId || attempt.traceId;
      attempt.nextPollAt = futureIso(this.now(), error.retryAfterSeconds || 5);
      if (error.code === "PROVIDER_VALIDATION_ERROR") attempt.providerStatus = "failed";
      else if (error.retryable || error.code === "IDEMPOTENCY_CONFLICT" || error.code === "PROVIDER_ORDER_MISMATCH") attempt.providerStatus = "provider_result_unknown";
      if (attempt.statusHistory.at(-1)?.status !== attempt.providerStatus) attempt.statusHistory = [...attempt.statusHistory, { status: attempt.providerStatus, at: now }];
      await this.orderStore.saveAttempt(attempt);
      const terminalValidation = attempt.providerStatus === "failed";
      const saved = await this.saveOrder(order, { status: terminalValidation ? "CHECKOUT_STARTED" : "PAYMENT_PENDING", providerStatus: attempt.providerStatus, nextPollAt: terminalValidation ? null : attempt.nextPollAt, paymentFailureReason: terminalValidation ? "provider_validation" : null });
      return { status: error.status === 429 ? 429 : error.status === 409 || error.status === 422 ? error.status : 503, body: { error: error.message || "Платёжный сервис временно недоступен.", order: publicOrder(saved) } };
    }
  }

  async reconcilePayment(paymentPublicId, options = {}) {
    const attempt = await this.orderStore.findAttemptByPaymentId(paymentPublicId);
    if (!attempt) return failure(404, "Платёжная попытка не найдена.");
    const order = await this.orderStore.load(attempt.orderId);
    if (!order) return failure(404, "Заказ не найден.");
    try {
      const payment = await this.paymentProvider.getPaymentStatus(paymentPublicId);
      if (payment.externalOrderId && payment.externalOrderId !== attempt.externalOrderId) throw providerBindingError();
      const authoritative = attempt.providerStatus === "settled" ? { ...payment, status: "settled" } : options.eventType === "payment.succeeded" && payment.status === "settled" ? { ...payment, status: "succeeded_pending" } : payment;
      const updated = updateAttempt(attempt, authoritative, this.isoNow());
      await this.orderStore.saveAttempt(updated);
      return this.applyProviderStatus(order, updated, authoritative);
    } catch (error) {
      const now = this.isoNow();
      attempt.retryTimestamps = [...attempt.retryTimestamps, now];
      attempt.failureInfo = { code: error.code || "PROVIDER_POLL_ERROR", httpStatus: error.status || 503, retryable: Boolean(error.retryable), at: now };
      attempt.nextPollAt = futureIso(this.now(), error.retryAfterSeconds || 5);
      await this.orderStore.saveAttempt(attempt);
      const preserved = await this.saveOrder(order, { nextPollAt: attempt.nextPollAt, paymentMethod: order.paymentMethod || attempt.paymentMethod });
      return { status: 503, body: { error: "Статус оплаты временно не удалось проверить.", order: publicOrder(preserved) } };
    }
  }

  async applyProviderStatus(order, attempt, payment) {
    const changes = {
      status: "PAYMENT_PENDING", paymentId: attempt.paymentPublicId, currentAttemptId: attempt.attemptId,
      providerStatus: attempt.providerStatus, paymentMethod: attempt.paymentMethod || order.paymentMethod,
      nextPollAt: attempt.nextPollAt, paymentFailureReason: null,
    };
    const alreadyFulfilled = ["PAID", "REPORT_GENERATING", "REPORT_READY", "REPORT_FAILED"].includes(order.status);
    if (attempt.providerStatus === "settled") {
      const all = await this.orderStore.listAttemptsByOrder(order.orderId);
      const settled = all.filter(item => item.providerStatus === "settled");
      if (settled.length > 1) await this.orderStore.saveAnomaly({ orderId: order.orderId, type: "MULTIPLE_SETTLED_ATTEMPTS", attemptIds: settled.map(item => item.attemptId), createdAt: this.isoNow() });
      if (!alreadyFulfilled) Object.assign(changes, { status: "PAID", paymentConfirmedAt: this.isoNow(), paymentFailureReason: null });
      else Object.assign(changes, { status: order.status, paymentConfirmedAt: order.paymentConfirmedAt });
    } else if (TERMINAL_STATUSES.has(attempt.providerStatus)) {
      if (alreadyFulfilled) Object.assign(changes, { status: order.status, paymentConfirmedAt: order.paymentConfirmedAt });
      else Object.assign(changes, { status: "CHECKOUT_STARTED", paymentFailureReason: attempt.providerStatus, paymentMethod: null, nextPollAt: null });
    } else if (alreadyFulfilled) {
      Object.assign(changes, { status: order.status, paymentConfirmedAt: order.paymentConfirmedAt });
    }
    return success(200, await this.saveOrder(order, changes));
  }

  async handleLorentsenWebhook(rawBody, headers) {
    if (this.paymentProvider.name !== "lorentsen") return failure(404, "Webhook endpoint не настроен.");
    let verified;
    try {
      verified = verifyLorentsenWebhook({ rawBody, headers, secret: this.paymentProvider.config.webhookSecret, signingKeyVersion: this.paymentProvider.config.webhookSigningKeyVersion, now: this.now().getTime() });
    } catch (error) { return failure(error.status || 400, error.message); }
    let inbox;
    const needsReconciliation = verified.requiresPaymentReconciliation && Boolean(verified.paymentPublicId);
    const missingPaymentId = verified.requiresPaymentReconciliation && !verified.paymentPublicId;
    try { inbox = await this.orderStore.recordWebhook({ eventId: verified.eventId, eventType: verified.eventType, eventPayload: verified.event, paymentPublicId: verified.paymentPublicId, payloadHash: verified.payloadHash, createdAt: verified.createdAt, processingStatus: needsReconciliation ? "pending" : missingPaymentId ? "retry" : "not_applicable", processingAttempts: 0, lastProcessingError: missingPaymentId ? { code: "PAYMENT_ID_MISSING", at: this.isoNow() } : null }); }
    catch { return failure(503, "Webhook временно не удалось надёжно сохранить."); }
    if (inbox.status === "conflict") {
      await this.orderStore.saveAnomaly({ type: "WEBHOOK_EVENT_ID_CONFLICT", eventId: verified.eventId, createdAt: this.isoNow() });
      return failure(409, "Webhook event ID уже использован с другим payload.");
    }
    if (inbox.status === "stored" && needsReconciliation) this.scheduleWebhookReconciliation(verified.eventId);
    return { status: inbox.status === "stored" ? 202 : 200, body: { accepted: true, duplicate: inbox.status === "duplicate" } };
  }

  scheduleWebhookReconciliation(eventId) {
    const job = this.processWebhookEvent(eventId).catch(() => {}).finally(() => this.webhookJobs.delete(job));
    this.webhookJobs.add(job);
  }

  async processWebhookEvent(eventId) {
    const event = await this.orderStore.loadWebhook(eventId);
    if (!event || !event.paymentPublicId || !["payment.succeeded", "payment.settled"].includes(event.eventType)) return { status: "not_applicable" };
    const attempts = Number(event.processingAttempts || 0) + 1;
    await this.orderStore.updateWebhook(eventId, { processingStatus: "processing", processingAttempts: attempts, lastProcessingStartedAt: this.isoNow(), processingLeaseUntil: futureIso(this.now(), 60) });
    const result = await this.reconcilePayment(event.paymentPublicId, { eventType: event.eventType });
    if (result.status >= 400) {
      await this.orderStore.updateWebhook(eventId, { processingStatus: "retry", processingLeaseUntil: null, nextProcessingAt: result.body?.order?.nextPollAt || futureIso(this.now(), 15), lastProcessingError: { code: "RECONCILIATION_FAILED", httpStatus: result.status, at: this.isoNow() } });
      return { status: "retry", result };
    }
    await this.orderStore.updateWebhook(eventId, { processingStatus: "processed", processingLeaseUntil: null, nextProcessingAt: null, lastProcessingError: null, processedAt: this.isoNow() });
    return { status: "processed", result };
  }

  async processPendingWebhooks(limit = 50) {
    const pending = await this.orderStore.listPendingWebhooks(limit);
    const results = [];
    for (const event of pending) results.push(await this.processWebhookEvent(event.eventId));
    return results;
  }

  async waitForWebhookJobs() { await Promise.allSettled([...this.webhookJobs]); }

  async applyMockOutcome(orderId, outcome) {
    if (this.env.NODE_ENV === "production" || this.paymentProvider.name !== "mock") return failure(404, "DEV payment endpoint недоступен.");
    const order = await this.orderStore.load(orderId);
    if (!order || !order.paymentId) return failure(404, "Платёж не найден.");
    const event = await this.paymentProvider.handleWebhook({ paymentId: order.paymentId, outcome });
    if (!event.verified || event.orderId !== order.orderId) return failure(400, "Платёжное событие не подтверждено провайдером.");
    if (event.status === "succeeded") {
      if (["PAID", "REPORT_GENERATING", "REPORT_READY"].includes(order.status)) return success(200, order);
      return success(200, await this.saveOrder(order, { status: "PAID", paymentConfirmedAt: event.confirmedAt, paymentFailureReason: null }));
    }
    if (event.status === "failed" || event.status === "cancelled") return success(200, await this.saveOrder(order, { status: "CHECKOUT_STARTED", paymentId: null, paymentFailureReason: event.status }));
    return success(200, await this.saveOrder(order, { status: "PAYMENT_PENDING" }));
  }

  async getOrder(orderId) {
    const order = await this.orderStore.load(orderId);
    if (!order) return failure(404, "Заказ не найден.");
    if (this.paymentProvider.name === "lorentsen" && order.status === "PAYMENT_PENDING" && order.paymentId && (!order.nextPollAt || Date.parse(order.nextPollAt) <= this.now().getTime())) return this.reconcilePayment(order.paymentId);
    return success(200, order);
  }

  async generate(orderId) {
    let order = await this.orderStore.load(orderId);
    if (!order) return failure(404, "Заказ не найден.");
    if (this.env.NODE_ENV === "production" && this.paymentProvider.name === "lorentsen") return failure(503, "Автоматическая подготовка полного разбора пока не включена.");
    if (order.status === "REPORT_READY") return success(200, order);
    if (order.status === "REPORT_GENERATING") return success(202, order);
    if (!["PAID", "REPORT_FAILED"].includes(order.status)) return failure(403, "Персональный разбор доступен только после подтверждённой оплаты.");
    const saved = await this.reportStore?.load(order.reportId);
    if (saved?.kind === "premium-generation-stub") return success(200, await this.saveOrder(order, { status: "REPORT_READY", reportGenerationCompletedAt: saved.savedAt }));
    order = await this.saveOrder(order, { status: "REPORT_GENERATING", reportGenerationStartedAt: this.isoNow(), reportGenerationCompletedAt: null });
    if (!this.generationPromises.has(order.reportId)) this.generationPromises.set(order.reportId, this.finishStubGeneration(order).finally(() => this.generationPromises.delete(order.reportId)));
    await this.generationPromises.get(order.reportId);
    return success(200, await this.orderStore.load(orderId));
  }

  async finishStubGeneration(order) {
    try {
      const stub = await this.stubGenerator(publicOrder(order));
      await this.reportStore?.save({ kind: "premium-generation-stub", reportId: order.reportId, chartId: order.chartId, stub });
      await this.saveOrder(await this.orderStore.load(order.orderId), { status: "REPORT_READY", reportGenerationCompletedAt: this.isoNow() });
    } catch {
      await this.saveOrder(await this.orderStore.load(order.orderId), { status: "REPORT_FAILED", reportGenerationCompletedAt: this.isoNow() });
    }
  }

  async saveOrder(order, changes) { return this.orderStore.save({ ...order, ...changes, updatedAt: this.isoNow() }); }
  isoNow() { return this.now().toISOString(); }
}

function buildConsentRecord(order, attempt, input, config, timestamp) {
  return {
    externalConsentReference: attempt.externalConsentReference, orderId: order.orderId, attemptId: attempt.attemptId,
    timestamp, consentVersion: config.consentVersion, autoRedemptionConsentVersion: config.autoRedemptionConsentVersion,
    documentUrls: { terms: config.termsUrl, privacy: config.privacyUrl, autoRedemption: config.autoRedemptionTermsUrl },
    displayedPartnerPublicName: config.partnerPublicName, amount: order.amount, currency: order.currency, locale: "ru",
    separateUserActions: { termsAccepted: true, autoRedemptionAccepted: true }, requestBodyHash: attempt.requestBodyHash,
    payerEmail: input.email,
  };
}
function validatePaymentInput(input) {
  const email = String(input?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,254}$/.test(email) || email.length > 320) return { error: "Укажите корректный email для получения сертификата." };
  if (input.termsAccepted !== true) return { error: "Нужно отдельно принять условия покупки сертификата и политику конфиденциальности." };
  if (input.autoRedemptionAccepted !== true) return { error: "Нужно отдельно подтвердить немедленное погашение сертификата у партнёра." };
  return { email };
}
function updateAttempt(attempt, payment, now) {
  const status = payment.status || "provider_result_unknown";
  const history = attempt.statusHistory.at(-1)?.status === status ? attempt.statusHistory : [...attempt.statusHistory, { status, at: now }];
  return { ...attempt, paymentPublicId: payment.paymentPublicId || attempt.paymentPublicId, providerStatus: status, statusHistory: history, paymentMethod: payment.paymentMethod || attempt.paymentMethod, paymentMethodExpiry: payment.paymentMethod?.expiresAt || attempt.paymentMethodExpiry, nextPollAt: futureIso(new Date(now), payment.retryAfterSeconds || 5), traceId: payment.traceId || attempt.traceId, failureInfo: TERMINAL_STATUSES.has(status) ? { status, at: now } : null, updatedAt: now };
}
function futureIso(date, seconds) { return new Date(date.getTime() + Number(seconds || 5) * 1000).toISOString(); }
async function defaultStubGenerator(order) { return { mode: "stub", reportId: order.reportId, message: "Тестовый полный разбор подготовлен без обращения к AI." }; }
function publicOrder(order) { const { birthInput, checkoutKeyHash, displayName, ...safe } = order; return { ...safe, displayName: displayName || "" }; }
function success(status, order) { return { status, body: { order: publicOrder(order) } }; }
function failure(status, error) { return { status, body: { error } }; }
function hash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function randomId(prefix) { return `${prefix}_${crypto.randomBytes(16).toString("hex")}`; }
function providerBindingError() { const error = new Error("Lorentsen вернул платёж для другого external_order_id."); error.status = 502; error.retryable = false; error.code = "PROVIDER_ORDER_MISMATCH"; return error; }
function safeMessage(error) { return String(error?.message || "Некорректные данные рождения.").replace(/^(Некорректные данные рождения|排盘计算失败):\s*/, ""); }

module.exports = { ACTIVE_PROVIDER_STATUSES, ORDER_STATES, PremiumService, buildConsentRecord, publicOrder, validatePaymentInput };
