const fs = require("node:fs");
const path = require("node:path");

class MemoryOrderStore {
  constructor() { this.orders = new Map(); this.attempts = new Map(); this.consents = new Map(); this.webhooks = new Map(); this.anomalies = []; }
  save(order) { this.orders.set(order.orderId, structuredClone(order)); return structuredClone(order); }
  load(orderId) { const order = this.orders.get(String(orderId)); return order ? structuredClone(order) : null; }
  findByCheckoutKey(checkoutKeyHash) {
    const order = [...this.orders.values()].find(item => item.checkoutKeyHash === checkoutKeyHash);
    return order ? structuredClone(order) : null;
  }
  saveAttempt(attempt) { const existing = this.attempts.get(attempt.attemptId); if (existing && existing.requestBodyHash !== attempt.requestBodyHash) throw new Error("Immutable payment attempt body нельзя изменить."); this.attempts.set(attempt.attemptId, structuredClone(attempt)); return structuredClone(attempt); }
  loadAttempt(attemptId) { const value = this.attempts.get(String(attemptId)); return value ? structuredClone(value) : null; }
  findAttemptByPaymentId(paymentId) { const value = [...this.attempts.values()].find(item => item.paymentPublicId === paymentId); return value ? structuredClone(value) : null; }
  listAttemptsByOrder(orderId) { return [...this.attempts.values()].filter(item => item.orderId === orderId).map(item => structuredClone(item)); }
  saveConsent(record) { this.consents.set(record.externalConsentReference, structuredClone(record)); return structuredClone(record); }
  beginPaymentAttempt({ order, attempt, consent }) { this.saveAttempt(attempt); this.saveConsent(consent); return this.save(order); }
  recordWebhook(event) { const existing = this.webhooks.get(event.eventId); if (!existing) { this.webhooks.set(event.eventId, structuredClone(event)); return { status: "stored" }; } return existing.payloadHash === event.payloadHash ? { status: "duplicate" } : { status: "conflict" }; }
  loadWebhook(eventId) { const value = this.webhooks.get(String(eventId)); return value ? structuredClone(value) : null; }
  listPendingWebhooks(limit = 50) { const now = Date.now(); return [...this.webhooks.values()].filter(item => ((item.processingStatus === "pending" || item.processingStatus === "retry") && (!item.nextProcessingAt || Date.parse(item.nextProcessingAt) <= now)) || (item.processingStatus === "processing" && Date.parse(item.processingLeaseUntil || 0) <= now)).slice(0, limit).map(item => structuredClone(item)); }
  updateWebhook(eventId, changes) { const existing = this.webhooks.get(String(eventId)); if (!existing) return null; const updated = { ...existing, ...structuredClone(changes) }; this.webhooks.set(String(eventId), updated); return structuredClone(updated); }
  saveAnomaly(record) { this.anomalies.push(structuredClone(record)); return structuredClone(record); }
}

class LocalOrderStore extends MemoryOrderStore {
  constructor(options = {}) {
    super();
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
}

function safeOrderId(value) {
  const id = String(value || "");
  if (!/^order_[a-f0-9]{32}$/.test(id)) throw new Error("Некорректный идентификатор заказа.");
  return id;
}
function unavailable() { const error = new Error("Production order storage пока не настроено."); error.code = "ORDER_STORE_UNAVAILABLE"; return error; }

module.exports = { LocalOrderStore, MemoryOrderStore };
