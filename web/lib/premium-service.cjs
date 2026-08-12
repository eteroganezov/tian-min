const crypto = require("node:crypto");
const { calculateBirthChart } = require("./birth-chart-pipeline.cjs");
const { canonicalBirthInput, normalizeDisplayName } = require("./personalization.cjs");
const { createFingerprints } = require("./report-fingerprint.cjs");
const { currentReportYears } = require("./report-service.cjs");
const { getProductConfig } = require("./product-config.cjs");

const ORDER_STATES = Object.freeze(["FREE_PREVIEW", "CHECKOUT_STARTED", "PAYMENT_PENDING", "PAID", "REPORT_GENERATING", "REPORT_READY", "REPORT_FAILED"]);

class PremiumService {
  constructor(options) {
    this.env = options.env || process.env;
    this.orderStore = options.orderStore;
    this.reportStore = options.reportStore;
    this.paymentProvider = options.paymentProvider;
    this.config = options.config || getProductConfig(this.env);
    this.stubGenerator = options.stubGenerator || defaultStubGenerator;
    this.generationPromises = new Map();
  }

  getConfig() {
    return { productId: this.config.productId, amount: this.config.amount, currency: this.config.currency, priceIsDevPlaceholder: this.config.priceIsDevPlaceholder, available: this.config.available, paymentMode: this.paymentProvider.name === "mock" ? "mock" : "unavailable" };
  }

  createCheckout(input) {
    if (!this.config.available) return failure(503, "Продажа полного разбора пока не настроена.");
    let ids;
    let birthInput;
    try {
      birthInput = canonicalBirthInput(input);
      const calculation = calculateBirthChart(birthInput);
      ids = createFingerprints({ input: birthInput, calculation, displayName: normalizeDisplayName(input?.name), model: this.env.OPENAI_MODEL || "gpt-5.6-terra", reportYears: currentReportYears() });
    } catch (error) { return failure(400, safeMessage(error)); }
    const checkoutKeyHash = hash(`${ids.reportId}:${this.config.productId}:${this.config.amount}:${this.config.currency}`);
    const existing = this.orderStore.findByCheckoutKey(checkoutKeyHash);
    if (existing) return success(200, existing);
    const now = new Date().toISOString();
    const order = {
      orderId: `order_${crypto.randomBytes(16).toString("hex")}`,
      chartId: ids.chartId, reportId: ids.reportId,
      createdAt: now, updatedAt: now, status: "CHECKOUT_STARTED",
      amount: this.config.amount, currency: this.config.currency,
      paymentProvider: this.paymentProvider.name, paymentId: null, paymentConfirmedAt: null,
      reportGenerationStartedAt: null, reportGenerationCompletedAt: null,
      checkoutKeyHash, birthInput, displayName: normalizeDisplayName(input?.name),
      paymentFailureReason: null,
    };
    return success(201, this.orderStore.save(order));
  }

  async startPayment(orderId) {
    const order = this.orderStore.load(orderId);
    if (!order) return failure(404, "Заказ не найден.");
    if (["PAID", "REPORT_GENERATING", "REPORT_READY"].includes(order.status)) return success(200, order);
    if (order.status === "PAYMENT_PENDING" && order.paymentId) {
      const payment = await this.paymentProvider.getPaymentStatus(order.paymentId);
      if (payment.status !== "unknown") return success(200, order);
    }
    try {
      const payment = await this.paymentProvider.createPayment(order);
      return success(200, this.saveOrder(order, { status: "PAYMENT_PENDING", paymentId: payment.paymentId, paymentFailureReason: null }));
    } catch (error) { return failure(503, error.message || "Платёжный способ пока недоступен."); }
  }

  async applyMockOutcome(orderId, outcome) {
    if (this.env.NODE_ENV === "production" || this.paymentProvider.name !== "mock") return failure(404, "DEV payment endpoint недоступен.");
    const order = this.orderStore.load(orderId);
    if (!order || !order.paymentId) return failure(404, "Платёж не найден.");
    const event = await this.paymentProvider.handleWebhook({ paymentId: order.paymentId, outcome });
    if (!event.verified || event.orderId !== order.orderId) return failure(400, "Платёжное событие не подтверждено провайдером.");
    if (event.status === "succeeded") {
      if (["PAID", "REPORT_GENERATING", "REPORT_READY"].includes(order.status)) return success(200, order);
      return success(200, this.saveOrder(order, { status: "PAID", paymentConfirmedAt: event.confirmedAt, paymentFailureReason: null }));
    }
    if (event.status === "failed" || event.status === "cancelled") return success(200, this.saveOrder(order, { status: "CHECKOUT_STARTED", paymentId: null, paymentFailureReason: event.status }));
    return success(200, this.saveOrder(order, { status: "PAYMENT_PENDING" }));
  }

  getOrder(orderId) {
    const order = this.orderStore.load(orderId);
    return order ? success(200, order) : failure(404, "Заказ не найден.");
  }

  async generate(orderId) {
    let order = this.orderStore.load(orderId);
    if (!order) return failure(404, "Заказ не найден.");
    if (order.status === "REPORT_READY") return success(200, order);
    if (order.status === "REPORT_GENERATING") return success(202, order);
    if (!["PAID", "REPORT_FAILED"].includes(order.status)) return failure(403, "Персональный разбор доступен только после подтверждённой оплаты.");
    const saved = this.reportStore?.load(order.reportId);
    if (saved?.kind === "premium-generation-stub") return success(200, this.saveOrder(order, { status: "REPORT_READY", reportGenerationCompletedAt: saved.savedAt }));
    order = this.saveOrder(order, { status: "REPORT_GENERATING", reportGenerationStartedAt: new Date().toISOString(), reportGenerationCompletedAt: null });
    if (!this.generationPromises.has(order.reportId)) this.generationPromises.set(order.reportId, this.finishStubGeneration(order).finally(() => this.generationPromises.delete(order.reportId)));
    await this.generationPromises.get(order.reportId);
    return success(200, this.orderStore.load(orderId));
  }

  async finishStubGeneration(order) {
    try {
      const stub = await this.stubGenerator(publicOrder(order));
      this.reportStore?.save({ kind: "premium-generation-stub", reportId: order.reportId, chartId: order.chartId, stub });
      this.saveOrder(this.orderStore.load(order.orderId), { status: "REPORT_READY", reportGenerationCompletedAt: new Date().toISOString() });
    } catch {
      this.saveOrder(this.orderStore.load(order.orderId), { status: "REPORT_FAILED", reportGenerationCompletedAt: new Date().toISOString() });
    }
  }

  saveOrder(order, changes) { return this.orderStore.save({ ...order, ...changes, updatedAt: new Date().toISOString() }); }
}

async function defaultStubGenerator(order) { return { mode: "stub", reportId: order.reportId, message: "Тестовый полный разбор подготовлен без обращения к AI." }; }
function publicOrder(order) { const { birthInput, checkoutKeyHash, displayName, ...safe } = order; return { ...safe, displayName: displayName || "" }; }
function success(status, order) { return { status, body: { order: publicOrder(order) } }; }
function failure(status, error) { return { status, body: { error } }; }
function hash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function safeMessage(error) { return String(error?.message || "Некорректные данные рождения.").replace(/^(Некорректные данные рождения|排盘计算失败):\s*/, ""); }

module.exports = { ORDER_STATES, PremiumService, publicOrder };
