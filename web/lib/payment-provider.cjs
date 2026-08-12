const crypto = require("node:crypto");

class MockPaymentProvider {
  constructor(options = {}) {
    this.env = options.env || process.env;
    if (this.env.NODE_ENV === "production") throw configurationError("Mock-payment запрещён в production.");
    this.payments = new Map();
    this.name = "mock";
  }
  async createPayment(order) {
    const paymentId = order.paymentId || `mock_${crypto.randomBytes(16).toString("hex")}`;
    const payment = { paymentId, orderId: order.orderId, status: "pending" };
    this.payments.set(paymentId, payment);
    return structuredClone(payment);
  }
  async getPaymentStatus(paymentId) { return structuredClone(this.payments.get(paymentId) || { paymentId, status: "unknown" }); }
  async handleWebhook(payload) {
    const payment = this.payments.get(String(payload?.paymentId));
    if (!payment || !["succeeded", "failed", "cancelled", "pending"].includes(payload?.outcome)) return { verified: false };
    payment.status = payload.outcome;
    return { verified: true, paymentId: payment.paymentId, orderId: payment.orderId, status: payment.status, confirmedAt: payment.status === "succeeded" ? new Date().toISOString() : null };
  }
}

class UnavailablePaymentProvider {
  constructor() { this.name = "unconfigured"; }
  async createPayment() { throw configurationError("Production payment provider пока не подключён."); }
  async getPaymentStatus(paymentId) { return { paymentId, status: "unknown" }; }
  async handleWebhook() { return { verified: false }; }
}

function createPaymentProvider(env = process.env) {
  const mode = env.PAYMENT_MODE || (env.NODE_ENV === "production" ? "disabled" : "mock");
  if (mode === "mock") return new MockPaymentProvider({ env });
  return new UnavailablePaymentProvider();
}
function configurationError(message) { const error = new Error(message); error.code = "PAYMENT_CONFIGURATION_ERROR"; return error; }

module.exports = { MockPaymentProvider, UnavailablePaymentProvider, createPaymentProvider };
