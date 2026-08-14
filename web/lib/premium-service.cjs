const crypto = require("node:crypto");
const { calculateBirthChart } = require("./birth-chart-pipeline.cjs");
const { canonicalBirthInput, normalizeDisplayName } = require("./personalization.cjs");
const { createFingerprints } = require("./report-fingerprint.cjs");
const { currentReportYears } = require("./report-service.cjs");
const { generateReportRequest } = require("./report-service.cjs");
const { createPdfFromSavedReport } = require("./pdf-service.cjs");
const { getProductConfig } = require("./product-config.cjs");
const { normalizePromoCode, promoAvailability } = require("./promo-config.cjs");
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
    this.reportGenerator = options.reportGenerator || (order => generatePremiumReport(order, this.env, event => this.logGenerationStage(order, event.stage, event)));
    this.pdfRenderer = options.pdfRenderer || createPdfFromSavedReport;
    this.logger = options.logger || console;
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
      baseAmount: this.config.amount, amount: this.config.amount, currency: this.config.currency,
      paymentProvider: this.paymentProvider.name, paymentId: null, currentAttemptId: null,
      providerStatus: null, paymentMethod: null, nextPollAt: null, paymentConfirmedAt: null,
      reportGenerationStartedAt: null, reportGenerationCompletedAt: null,
      reportGenerationLeaseUntil: null, reportGenerationAttempt: 0,
      reportAccessToken: randomToken(), reportAccessTokenHash: null,
      checkoutKeyHash, birthInput, displayName: normalizeDisplayName(input?.name), paymentFailureReason: null,
    };
    order.reportAccessTokenHash = hash(order.reportAccessToken);
    return success(201, await this.orderStore.save(order));
  }

  async applyPromo(input) {
    const normalizedCode = normalizePromoCode(input?.code);
    if (!normalizedCode) return failure(404, "Промокод не найден");
    const promo = await this.orderStore.getPromo(normalizedCode);
    const availability = promoAvailability(promo, this.now());
    if (!availability.ok) return failure(availability.code === "PROMO_NOT_FOUND" ? 404 : 409, promoCustomerMessage(availability));
    const existingOrder = input?.orderId ? await this.orderStore.load(input.orderId) : null;
    if (input?.orderId && !existingOrder) return failure(404, "Заказ не найден.");
    const checkout = existingOrder ? { status: 200, body: { order: existingOrder } } : await this.createCheckout(input?.birthInput);
    if (checkout.status >= 400) return checkout;
    try {
      const applied = await this.orderStore.applyPromoToOrder({ orderId: checkout.body.order.orderId, code: normalizedCode, now: this.isoNow() });
      return {
        status: 200,
        body: {
          order: publicOrder(applied.order),
          pricing: { baseAmount: applied.order.baseAmount, discountAmount: applied.order.baseAmount - applied.order.amount, finalAmount: applied.order.amount, currency: applied.order.currency, promoCode: applied.order.promoCode },
        },
      };
    } catch (error) { return failure(error.status || 409, promoCustomerMessage(error)); }
  }

  async redeemPromo(input) {
    const normalizedCode = normalizePromoCode(input?.code);
    if (!normalizedCode) return failure(404, "Промокод не найден");
    try {
      const result = await this.orderStore.redeemComplimentaryPromo({ orderId: input?.orderId, code: normalizedCode, now: this.isoNow() });
      const generation=await this.generate(result.order.orderId);
      return { status: result.duplicate ? 200 : 201, body: { order:generation.body.order || publicOrder(result.order), entitlement: { accessReason: "complimentary_promo", reportId: result.order.reportId } } };
    } catch (error) { return failure(error.status || 409, promoCustomerMessage(error)); }
  }

  async startPayment(input) {
    const request = typeof input === "string" ? { orderId: input } : input || {};
    const order = await this.orderStore.load(request.orderId);
    if (!order) return failure(404, "Заказ не найден.");
    if (["PAID", "REPORT_GENERATING", "REPORT_READY"].includes(order.status)) return success(200, order);
    const promoValidation = await this.validateAppliedPromo(order);
    if (promoValidation) return promoValidation;
    if (order.amount === 0) return failure(409, "Для этого промокода оплата не требуется.");
    if (this.paymentProvider.name === "mock") return this.startMockPayment(order);
    if (this.paymentProvider.name !== "lorentsen") return failure(503, "Платёжный способ пока не настроен.");
    return this.startLorentsenPayment(order, request);
  }

  async startMockPayment(order) {
    if (order.status === "PAYMENT_PENDING" && order.paymentId) return success(200, order);
    try {
      await this.recordPromoEvent(order, "payment_attempted");
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
    await this.recordPromoEvent(order, "payment_attempted");
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
      attempt.failureInfo = { code: error.code || "PROVIDER_ERROR", httpStatus: error.status || 503, retryable: Boolean(error.retryable), provider: error.providerDetails || null, at: now };
      attempt.traceId = error.traceId || attempt.traceId;
      attempt.nextPollAt = futureIso(this.now(), error.retryAfterSeconds || 5);
      this.logger.error("[PAYMENT_PROVIDER_ERROR]", JSON.stringify({ stage: "create_payment", httpStatus: error.status || null, code: error.code || "PROVIDER_ERROR", traceId: error.traceId || null, provider: error.providerDetails || null }));
      if (error.code === "PROVIDER_VALIDATION_ERROR") attempt.providerStatus = "failed";
      else if (error.retryable || error.code === "IDEMPOTENCY_CONFLICT" || error.code === "PROVIDER_ORDER_MISMATCH") attempt.providerStatus = "provider_result_unknown";
      if (attempt.statusHistory.at(-1)?.status !== attempt.providerStatus) attempt.statusHistory = [...attempt.statusHistory, { status: attempt.providerStatus, at: now }];
      await this.orderStore.saveAttempt(attempt);
      const terminalValidation = attempt.providerStatus === "failed";
      const saved = await this.saveOrder(order, { status: terminalValidation ? "CHECKOUT_STARTED" : "PAYMENT_PENDING", providerStatus: attempt.providerStatus, nextPollAt: terminalValidation ? null : attempt.nextPollAt, paymentFailureReason: terminalValidation ? "provider_validation" : null });
      return { status: error.status === 429 ? 429 : error.status === 409 || error.status === 422 ? error.status : 503, body: { error: customerPaymentError(error), order: publicOrder(saved) } };
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
    const saved = await this.saveOrder(order, changes);
    if (attempt.providerStatus === "settled") {
      await this.recordPromoEvent(saved, "settled");
    }
    return success(200, saved);
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
      const saved = await this.saveOrder(order, { status: "PAID", paymentConfirmedAt: event.confirmedAt, paymentFailureReason: null });
      await this.recordPromoEvent(saved, "settled");
      return success(200, saved);
    }
    if (event.status === "failed" || event.status === "cancelled") return success(200, await this.saveOrder(order, { status: "CHECKOUT_STARTED", paymentId: null, paymentFailureReason: event.status }));
    return success(200, await this.saveOrder(order, { status: "PAYMENT_PENDING" }));
  }

  async getOrder(orderId) {
    let order = await this.orderStore.load(orderId);
    if (!order) return failure(404, "Заказ не найден.");
    order=await this.ensureReportAccess(order);
    if (this.paymentProvider.name === "lorentsen" && order.status === "PAYMENT_PENDING" && (!order.nextPollAt || Date.parse(order.nextPollAt) <= this.now().getTime())) {
      if (order.paymentId) return this.reconcilePayment(order.paymentId);
      const attempt = order.currentAttemptId ? await this.orderStore.loadAttempt(order.currentAttemptId) : null;
      if (attempt && ACTIVE_PROVIDER_STATUSES.has(attempt.providerStatus)) {
        if (attempt.paymentPublicId) return this.reconcilePayment(attempt.paymentPublicId);
        return this.createProviderPayment(order, attempt);
      }
    }
    if (order.status === "REPORT_GENERATING") {
      if(Date.parse(order.reportGenerationLeaseUntil || 0) <= this.now().getTime()) {
        return this.generate(order.orderId);
      }
    }
    return success(200, order);
  }

  async generate(orderId, options = {}) {
    let order = await this.orderStore.load(orderId);
    if (!order) return failure(404, "Заказ не найден.");
    order=await this.ensureReportAccess(order);
    if (!await this.hasLegitimateEntitlement(order)) return failure(403, "Персональный разбор доступен только после подтверждённой оплаты или специального доступа.");
    const saved = await this.reportStore?.load(order.reportId);
    if (order.status === "REPORT_READY") return saved?.kind === "semantic-report" ? success(200, order) : failure(503, "Сохранённый отчёт временно недоступен.");
    if (order.status === "REPORT_FAILED" && Number(options.expectedAttempt) !== Number(order.reportGenerationAttempt)) {
      return failure(409, "Состояние подготовки отчёта изменилось. Обновите страницу и попробуйте снова.");
    }
    const now=this.isoNow(), runId=randomId("generation"), leaseUntil=new Date(this.now().getTime()+30*60*1000).toISOString();
    const claim=await this.orderStore.claimReportGeneration({ orderId,now,leaseUntil,runId });
    if (!claim.claimed) return success(claim.order?.status === "REPORT_READY" ? 200 : 202, claim.order || order);
    order=claim.order;
    this.logGenerationStage(order, "generation_claimed", { attempt: order.reportGenerationAttempt });
    if (!this.generationPromises.has(order.reportId)) {
      const job=this.finishGeneration(order,saved?.kind === "semantic-report" ? saved : null).finally(()=>this.generationPromises.delete(order.reportId));
      this.generationPromises.set(order.reportId,job);
    }
    return success(202,order);
  }

  async finishGeneration(order, savedEnvelope = null) {
    try {
      const envelope=savedEnvelope || await this.reportGenerator(order);
      if (envelope?.kind !== "semantic-report" || envelope.reportId !== order.reportId || envelope.chartId !== order.chartId) throw generationError("REPORT_BINDING_MISMATCH");
      if (!savedEnvelope) {
        try { await this.reportStore.saveImmutable(envelope); }
        catch(error) { if(!error.generationStage) error.generationStage="report_persistence"; throw error; }
        this.logGenerationStage(order, "report_persisted");
      } else this.logGenerationStage(order, "report_reused");
      this.logGenerationStage(order, "pdf_render_started");
      let rendered;
      try { rendered=await this.pdfRenderer(envelope); }
      catch(error) { if(!error.generationStage) error.generationStage="pdf_render"; throw error; }
      if (rendered?.status !== 200 || !Buffer.isBuffer(rendered.buffer) || rendered.buffer.subarray(0,5).toString() !== "%PDF-") throw generationError("PDF_RENDER_FAILED",{generationStage:"pdf_render"});
      this.logGenerationStage(order, "pdf_rendered");
      const current=await this.orderStore.load(order.orderId);
      if (current?.reportGenerationRunId === order.reportGenerationRunId) {
        await this.saveOrder(current,{ status:"REPORT_READY",reportGenerationCompletedAt:this.isoNow(),reportGenerationLeaseUntil:null,generationFailureCode:null,generationFailureStage:null,generationFailureHttpStatus:null });
        this.logGenerationStage(order, "delivery_ready");
      }
    } catch (error) {
      const stage=error?.generationStage || "report_generation";
      this.logger.error("[REPORT_GENERATION_ERROR]",JSON.stringify({ orderId:order.orderId,reportId:order.reportId,stage,code:error?.code || "REPORT_GENERATION_FAILED",type:error?.providerType || error?.name || "Error",httpStatus:Number.isInteger(error?.httpStatus)?error.httpStatus:null }));
      const current=await this.orderStore.load(order.orderId);
      if (current?.reportGenerationRunId === order.reportGenerationRunId) await this.saveOrder(current,{ status:"REPORT_FAILED",reportGenerationCompletedAt:this.isoNow(),reportGenerationLeaseUntil:null,generationFailureCode:error?.code || "REPORT_GENERATION_FAILED",generationFailureStage:stage,generationFailureHttpStatus:Number.isInteger(error?.httpStatus)?error.httpStatus:null });
    }
  }

  logGenerationStage(order, stage, details = {}) {
    this.logger.info?.("[REPORT_GENERATION_STAGE]",JSON.stringify({ orderId:order.orderId,reportId:order.reportId,stage,attempt:details.attempt || null,model:details.model || null,providerType:details.providerType || null,durationMs:Number.isFinite(details.durationMs)?details.durationMs:null,requestId:details.requestId || null,responseStatus:details.responseStatus || null }));
  }

  async waitForGenerationJobs() { await Promise.allSettled([...this.generationPromises.values()]); }

  async deliver(reportAccessToken) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(reportAccessToken || ""))) return { status:404,error:"Отчёт не найден." };
    const order=await this.orderStore.findByReportAccessTokenHash(hash(reportAccessToken));
    if (!order || order.status !== "REPORT_READY" || !await this.hasLegitimateEntitlement(order)) return { status:404,error:"Отчёт не найден." };
    const saved=await this.reportStore?.load(order.reportId);
    if (!saved || saved.kind !== "semantic-report" || saved.reportId !== order.reportId || saved.chartId !== order.chartId) return { status:404,error:"Отчёт не найден." };
    const rendered=await this.pdfRenderer(saved);
    if (rendered?.status !== 200 || !Buffer.isBuffer(rendered.buffer)) return { status:503,error:"Не удалось открыть отчёт. Попробуйте ещё раз." };
    const filename=buildPersonalReportFilename(saved.presentation?.displayName || order.displayName,saved.input?.date || order.birthInput?.date);
    return { status:200,buffer:rendered.buffer,filename };
  }

  async hasLegitimateEntitlement(order) {
    if (!order?.reportId || !order?.chartId) return false;
    if (order.accessReason === "complimentary_promo") return order.amount === 0 && Boolean(order.premiumEntitledAt && order.promoRedeemedAt && order.promoCode);
    if (!order.paymentConfirmedAt || !["PAID","REPORT_GENERATING","REPORT_READY","REPORT_FAILED"].includes(order.status)) return false;
    if (this.paymentProvider.name !== "lorentsen") return true;
    const attempts=await this.orderStore.listAttemptsByOrder(order.orderId);
    return attempts.some(attempt=>attempt.providerStatus === "settled" && attempt.paymentPublicId && attempt.paymentPublicId === order.paymentId);
  }

  async ensureReportAccess(order) {
    if(order.reportAccessToken&&order.reportAccessTokenHash) return order;
    const token=randomToken();
    return this.saveOrder(order,{reportAccessToken:token,reportAccessTokenHash:hash(token)});
  }

  async saveOrder(order, changes) { return this.orderStore.save({ ...order, ...changes, updatedAt: this.isoNow() }); }
  async validateAppliedPromo(order) {
    if (!order.promoCode) return null;
    const promo = await this.orderStore.getPromo(order.promoCode);
    const availability = promoAvailability(promo, this.now());
    if (!availability.ok || Number(promo.targetFinalAmount) !== Number(order.amount)) return failure(409, promoCustomerMessage(availability));
    return null;
  }
  async recordPromoEvent(order, eventType) {
    if (!order?.promoCode || !this.orderStore.recordPromoEvent) return;
    await this.orderStore.recordPromoEvent({ promoCode: order.promoCode, eventType, orderId: order.orderId, reportId: order.reportId, createdAt: this.isoNow() });
  }
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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,254}$/.test(email) || email.length > 320) return { error: "Укажите корректный email." };
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
async function generatePremiumReport(order,env,onStage) {
  const result=await generateReportRequest({ ...order.birthInput,name:order.displayName || "" },{ env,hasFullReport:true,onStage });
  if (result.status !== 200 || result.body?.aiStatus !== "ready" || !result.internal?.report) {
    const failure=result.internal?.failure || {};
    throw generationError(result.body?.aiStatus === "unavailable" ? "AI_NOT_CONFIGURED" : "REPORT_GENERATION_FAILED",{ generationStage:failure.stage,httpStatus:failure.httpStatus,providerType:failure.type });
  }
  if (result.body.reportId !== order.reportId || result.body.chartId !== order.chartId) throw generationError("REPORT_BINDING_MISMATCH");
  return { kind:"semantic-report",artifactVersion:"premium-delivery-v1",schemaVersion:result.body.schemaVersion,
    input:canonicalBirthInput(order.birthInput),presentation:result.body.presentation,report:result.internal.report,
    chartId:order.chartId,reportId:order.reportId,model:result.body.model,generatedAt:new Date().toISOString() };
}
function generationError(code,details={}) { const error=new Error("Premium generation failed"); error.code=code; Object.assign(error,details); return error; }
function randomToken() { return crypto.randomBytes(32).toString("base64url"); }
function publicOrder(order) { const { birthInput,checkoutKeyHash,displayName,promoCampaign,reportAccessTokenHash,reportGenerationRunId,reportGenerationLeaseUntil,generationFailureCode,generationFailureStage,generationFailureHttpStatus,...safe }=order; return { ...safe,displayName:displayName || "" }; }
function success(status, order) { return { status, body: { order: publicOrder(order) } }; }
function failure(status, error) { return { status, body: { error } }; }
function hash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function randomId(prefix) { return `${prefix}_${crypto.randomBytes(16).toString("hex")}`; }
function providerBindingError() { const error = new Error("Lorentsen вернул платёж для другого external_order_id."); error.status = 502; error.retryable = false; error.code = "PROVIDER_ORDER_MISMATCH"; return error; }
function customerPaymentError(error) {
  if (error?.status === 429) return "Слишком много попыток. Подождите немного и попробуйте снова.";
  if (error?.status === 409) return "Не удалось продолжить оплату. Обновите страницу и попробуйте снова.";
  if (error?.status === 422 || error?.code === "PROVIDER_VALIDATION_ERROR") return "Не удалось создать оплату. Попробуйте снова.";
  return "Не удалось начать оплату. Попробуйте ещё раз чуть позже.";
}
function promoCustomerMessage(error) {
  const code = error?.code;
  if (code === "PROMO_NOT_FOUND") return "Промокод не найден";
  if (code === "PROMO_EXPIRED") return "Срок действия промокода истёк";
  if (code === "PROMO_UNAVAILABLE" || code === "PROMO_EXHAUSTED") return "Промокод больше недоступен";
  return "Этот промокод нельзя применить";
}
function safeMessage(error) { return String(error?.message || "Некорректные данные рождения.").replace(/^(Некорректные данные рождения|排盘计算失败):\s*/, ""); }

function buildPersonalReportFilename(displayName,birthDate) {
  const firstName=sanitizeFilenameFirstName(displayName);
  const yearMatch=String(birthDate || "").match(/^(\d{4})-/u);
  const year=yearMatch && Number(yearMatch[1]) >= 1900 && Number(yearMatch[1]) <= 2100 ? yearMatch[1] : "";
  if(firstName && year) return `Tian-Min_${firstName}_${year}.pdf`;
  if(year) return `Tian-Min_${year}.pdf`;
  if(firstName) return "Tian-Min_Report.pdf";
  return "tian-min-personal-report.pdf";
}

function sanitizeFilenameFirstName(value) {
  const firstToken=String(value || "").normalize("NFC").trim().split(/\s+/u)[0] || "";
  const safe=firstToken.replace(/[^\p{L}\p{M}'’\-]/gu,"").replace(/^['’\-]+|['’\-]+$/gu,"");
  return [...safe].slice(0,40).join("").replace(/^['’\-]+|['’\-]+$/gu,"");
}

module.exports = { ACTIVE_PROVIDER_STATUSES, ORDER_STATES, PremiumService, buildConsentRecord, buildPersonalReportFilename, customerPaymentError, generatePremiumReport, promoCustomerMessage, publicOrder, validatePaymentInput };
