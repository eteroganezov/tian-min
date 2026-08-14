const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { initialPromoRecords, normalizePromoCode, promoAvailability, promoError } = require("./promo-config.cjs");

class MemoryOrderStore {
  constructor(options = {}) {
    this.orders = new Map(); this.attempts = new Map(); this.consents = new Map(); this.webhooks = new Map(); this.anomalies = [];
    this.promos = new Map((options.promos || initialPromoRecords()).map(promo => [promo.normalizedCode, structuredClone(promo)]));
    this.promoRedemptions = new Map(); this.promoEvents = new Map();
  }
  save(order) { this.orders.set(order.orderId, structuredClone(order)); return structuredClone(order); }
  load(orderId) { const order = this.orders.get(String(orderId)); return order ? structuredClone(order) : null; }
  findByCheckoutKey(checkoutKeyHash) {
    const order = [...this.orders.values()].find(item => item.checkoutKeyHash === checkoutKeyHash);
    return order ? structuredClone(order) : null;
  }
  findByReportAccessTokenHash(tokenHash) {
    const order = [...this.orders.values()].find(item => item.reportAccessTokenHash === tokenHash);
    return order ? structuredClone(order) : null;
  }
  claimReportGeneration({ orderId, now, leaseUntil, runId }) {
    const order = this.load(orderId);
    if (!order) return { claimed:false, order:null };
    const stale = order.status === "REPORT_GENERATING" && Date.parse(order.reportGenerationLeaseUntil || 0) <= Date.parse(now);
    const eligible = ["PAID", "REPORT_FAILED"].includes(order.status)
      || (order.accessReason === "complimentary_promo" && ["CHECKOUT_STARTED", "REPORT_FAILED"].includes(order.status)) || stale;
    if (!eligible) return { claimed:false, order };
    const updated = this.save({ ...order, status:"REPORT_GENERATING", reportGenerationStartedAt:now,
      reportGenerationCompletedAt:null, reportGenerationLeaseUntil:leaseUntil,
      reportGenerationRunId:runId, reportGenerationAttempt:Number(order.reportGenerationAttempt || 0)+1, updatedAt:now });
    return { claimed:true, order:updated };
  }
  saveAttempt(attempt) { const existing = this.attempts.get(attempt.attemptId); if (existing && existing.requestBodyHash !== attempt.requestBodyHash) throw new Error("Immutable payment attempt body нельзя изменить."); this.attempts.set(attempt.attemptId, structuredClone(attempt)); return structuredClone(attempt); }
  loadAttempt(attemptId) { const value = this.attempts.get(String(attemptId)); return value ? structuredClone(value) : null; }
  findAttemptByPaymentId(paymentId) { const value = [...this.attempts.values()].find(item => item.paymentPublicId === paymentId); return value ? structuredClone(value) : null; }
  listAttemptsByOrder(orderId) { return [...this.attempts.values()].filter(item => item.orderId === orderId).map(item => structuredClone(item)); }
  saveConsent(record) { this.consents.set(record.externalConsentReference, structuredClone(record)); return structuredClone(record); }
  beginPaymentAttempt({ order, attempt, consent }) {
    const current = this.load(order.orderId);
    if (!current || current.currentAttemptId || current.status !== "CHECKOUT_STARTED") throw paymentSessionConflict();
    this.saveAttempt(attempt); this.saveConsent(consent);
    return this.save({ ...current, ...paymentSessionFields(order) });
  }
  endPaymentSession({ orderId, attemptId, reason, now }) {
    const order = this.load(orderId);
    if (!order) return null;
    if (["PAID", "REPORT_GENERATING", "REPORT_READY", "REPORT_FAILED"].includes(order.status) || order.currentAttemptId !== attemptId) return order;
    const attempt = this.loadAttempt(attemptId);
    if (attempt) this.saveAttempt({ ...attempt, userSessionStatus: reason === "cancelled" ? "cancelled" : "expired", userSessionEndReason: reason, userSessionEndedAt: now, updatedAt: now });
    return this.save({ ...order, status: "CHECKOUT_STARTED", lastAttemptId: attemptId, currentAttemptId: null, paymentId: null, providerStatus: null, paymentMethod: null, nextPollAt: null, paymentFailureReason: null, paymentSessionStatus: null, paymentSessionExpiresAt: null, paymentSessionEndReason: reason, updatedAt: now });
  }
  saveCurrentPaymentSession({ orderId, attemptId, changes }) {
    const order = this.load(orderId);
    if (!order || order.status !== "PAYMENT_PENDING" || order.currentAttemptId !== attemptId) return order;
    return this.save({ ...order, ...structuredClone(changes) });
  }
  recordWebhook(event) { const existing = this.webhooks.get(event.eventId); if (!existing) { this.webhooks.set(event.eventId, structuredClone(event)); return { status: "stored" }; } return existing.payloadHash === event.payloadHash ? { status: "duplicate" } : { status: "conflict" }; }
  loadWebhook(eventId) { const value = this.webhooks.get(String(eventId)); return value ? structuredClone(value) : null; }
  listPendingWebhooks(limit = 50) { const now = Date.now(); return [...this.webhooks.values()].filter(item => ((item.processingStatus === "pending" || item.processingStatus === "retry") && (!item.nextProcessingAt || Date.parse(item.nextProcessingAt) <= now)) || (item.processingStatus === "processing" && Date.parse(item.processingLeaseUntil || 0) <= now)).slice(0, limit).map(item => structuredClone(item)); }
  updateWebhook(eventId, changes) { const existing = this.webhooks.get(String(eventId)); if (!existing) return null; const updated = { ...existing, ...structuredClone(changes) }; this.webhooks.set(String(eventId), updated); return structuredClone(updated); }
  saveAnomaly(record) { this.anomalies.push(structuredClone(record)); return structuredClone(record); }
  getPromo(code) { const promo = this.promos.get(normalizePromoCode(code)); return promo ? structuredClone(promo) : null; }
  applyPromoToOrder({ orderId, code, now }) {
    const normalizedCode = normalizePromoCode(code);
    const promo = this.promos.get(normalizedCode);
    const availability = promoAvailability(promo, new Date(now));
    if (!availability.ok) throw promoError(availability);
    const order = this.load(String(orderId));
    const terminalPayment = ["failed", "expired"].includes(order?.providerStatus);
    if (!order || order.status !== "CHECKOUT_STARTED" || order.accessReason || ((!terminalPayment) && (order.currentAttemptId || order.paymentId))) throw promoError({ code: "PROMO_INVALID", message: "Этот промокод нельзя применить" });
    const updated = { ...order, status: "CHECKOUT_STARTED", baseAmount: order.baseAmount || order.amount, amount: promo.targetFinalAmount, promoCode: promo.normalizedCode, promoCampaign: promo.campaign, promoAppliedAt: now, currentAttemptId: null, paymentId: null, providerStatus: null, paymentMethod: null, nextPollAt: null, paymentFailureReason: null, updatedAt: now };
    this.save(updated);
    this.recordPromoEvent({ promoCode: normalizedCode, eventType: "promo_applied", orderId: order.orderId, reportId: order.reportId, createdAt: now });
    this.recordPromoEvent({ promoCode: normalizedCode, eventType: "checkout_created", orderId: order.orderId, reportId: order.reportId, createdAt: now });
    return { order: structuredClone(updated), promo: structuredClone(promo) };
  }
  redeemComplimentaryPromo({ orderId, code, now }) {
    const normalizedCode = normalizePromoCode(code);
    const order = this.load(String(orderId));
    const existing = this.promoRedemptions.get(String(orderId));
    if (existing) {
      if (existing.promoCode !== normalizedCode) throw promoError({ code: "PROMO_INVALID", message: "Этот промокод нельзя применить" });
      return { order: this.load(orderId), redemption: structuredClone(existing), duplicate: true };
    }
    if (order?.accessReason === "complimentary_promo" && order.promoCode === normalizedCode) {
      return { order: structuredClone(order), redemption: { promoCode: normalizedCode, orderId: order.orderId, reportId: order.reportId, accessReason: "complimentary_promo", createdAt: order.promoRedeemedAt }, duplicate: true };
    }
    const promo = this.promos.get(normalizedCode);
    const availability = promoAvailability(promo, new Date(now));
    if (!availability.ok) throw promoError(availability);
    if (!order || order.promoCode !== normalizedCode || promo.targetFinalAmount !== 0 || order.reportId == null || order.accessReason) throw promoError({ code: "PROMO_INVALID", message: "Этот промокод нельзя применить" });
    promo.redemptionCount = Number(promo.redemptionCount || 0) + 1;
    promo.updatedAt = now;
    const redemption = { redemptionId: `promo_redemption_${crypto.randomBytes(16).toString("hex")}`, promoCode: normalizedCode, orderId: order.orderId, reportId: order.reportId, finalAmount: 0, accessReason: "complimentary_promo", createdAt: now };
    const updated = { ...order, amount: 0, accessReason: "complimentary_promo", premiumEntitledAt: now, promoRedeemedAt: now, updatedAt: now };
    this.promoRedemptions.set(order.orderId, structuredClone(redemption));
    this.save(updated);
    this.recordPromoEvent({ promoCode: normalizedCode, eventType: "complimentary_entitlement_created", orderId: order.orderId, reportId: order.reportId, createdAt: now });
    return { order: structuredClone(updated), redemption: structuredClone(redemption), duplicate: false };
  }
  recordPromoEvent(event) {
    if (!event?.promoCode) return null;
    const key = `${event.eventType}:${event.promoCode}:${event.orderId}`;
    if (!this.promoEvents.has(key)) this.promoEvents.set(key, { eventId: `promo_event_${crypto.randomBytes(16).toString("hex")}`, ...structuredClone(event) });
    return structuredClone(this.promoEvents.get(key));
  }
}

class LocalOrderStore extends MemoryOrderStore {
  constructor(options = {}) {
    super(options);
    this.root = options.root || path.resolve(__dirname, "..", ".local-orders");
    this.enabled = options.enabled !== false && (options.env || process.env).NODE_ENV !== "production";
  }
  save(order) {
    if (!this.enabled) throw unavailable();
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const target = path.join(this.root, `${safeOrderId(order.orderId)}.json`);
    const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(order, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, target);
    return structuredClone(order);
  }
  load(orderId) {
    if (!this.enabled) return null;
    const target = path.join(this.root, `${safeOrderId(orderId)}.json`);
    return fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8")) : null;
  }
  findByCheckoutKey(checkoutKeyHash) {
    if (!this.enabled || !fs.existsSync(this.root)) return null;
    for (const filename of fs.readdirSync(this.root).filter(name => /^order_[a-f0-9]{32}\.json$/.test(name))) {
      const order = JSON.parse(fs.readFileSync(path.join(this.root, filename), "utf8"));
      if (order.checkoutKeyHash === checkoutKeyHash) return order;
    }
    return null;
  }
  findByReportAccessTokenHash(tokenHash) {
    if (!this.enabled || !fs.existsSync(this.root)) return null;
    for (const filename of fs.readdirSync(this.root).filter(name => /^order_[a-f0-9]{32}\.json$/.test(name))) {
      const order = JSON.parse(fs.readFileSync(path.join(this.root, filename), "utf8"));
      if (order.reportAccessTokenHash === tokenHash) return order;
    }
    return null;
  }
}

function safeOrderId(value) {
  const id = String(value || "");
  if (!/^order_[a-f0-9]{32}$/.test(id)) throw new Error("Некорректный идентификатор заказа.");
  return id;
}
function unavailable() { const error = new Error("Production order storage пока не настроено."); error.code = "ORDER_STORE_UNAVAILABLE"; return error; }
function paymentSessionConflict() { const error = new Error("Платёжная сессия уже существует."); error.code = "PAYMENT_SESSION_CONFLICT"; return error; }
function paymentSessionFields(order) { return { status: order.status, currentAttemptId: order.currentAttemptId, paymentId: order.paymentId, providerStatus: order.providerStatus, paymentMethod: order.paymentMethod, nextPollAt: order.nextPollAt, paymentFailureReason: order.paymentFailureReason, paymentSessionStatus: order.paymentSessionStatus, paymentSessionExpiresAt: order.paymentSessionExpiresAt, paymentSessionEndReason: order.paymentSessionEndReason, updatedAt: order.updatedAt }; }

module.exports = { LocalOrderStore, MemoryOrderStore };
