const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { MemoryOrderStore } = require("../lib/order-store.cjs");
const { MockPaymentProvider } = require("../lib/payment-provider.cjs");
const { PremiumService } = require("../lib/premium-service.cjs");
const { initialPromoRecords, normalizePromoCode, promoAvailability } = require("../lib/promo-config.cjs");
const { locationProvider } = require("../lib/location-provider.cjs");

const birthInput = { name: "Тест", date: "1995-09-03", time: "05:50", gender: "male", placeId: locationProvider.search("Москва")[0].id };
const now = new Date("2026-08-13T12:00:00.000Z");

function setup(promos = initialPromoRecords(now)) {
  const env = { NODE_ENV: "development", PAYMENT_MODE: "mock", OPENAI_MODEL: "test" };
  const orderStore = new MemoryOrderStore({ promos });
  const paymentProvider = new MockPaymentProvider({ env });
  let providerCalls = 0;
  const originalCreate = paymentProvider.createPayment.bind(paymentProvider);
  paymentProvider.createPayment = async (...args) => { providerCalls += 1; return originalCreate(...args); };
  const service = new PremiumService({ env, orderStore, reportStore: null, paymentProvider, now: () => now });
  return { service, orderStore, get providerCalls() { return providerCalls; } };
}

test("promo code нормализуется case-insensitive и trim, но не принимает произвольный текст", () => {
  assert.equal(normalizePromoCode("  family0  "), "FAMILY0");
  assert.equal(normalizePromoCode("Friend100"), "FRIEND100");
  assert.equal(normalizePromoCode("family 0"), "");
  assert.equal(normalizePromoCode("<script>"), "");
});

test("invalid, expired, inactive и exhausted promo имеют безопасные состояния", () => {
  assert.equal(promoAvailability(null, now).code, "PROMO_NOT_FOUND");
  assert.equal(promoAvailability({ active: true, expiresAt: "2026-08-12T00:00:00Z", redemptionCount: 0 }, now).code, "PROMO_EXPIRED");
  assert.equal(promoAvailability({ active: false, redemptionCount: 0 }, now).code, "PROMO_UNAVAILABLE");
  assert.equal(promoAvailability({ active: true, maxRedemptions: 1, redemptionCount: 1 }, now).code, "PROMO_EXHAUSTED");
});

test("FAMILY0 даёт final amount 0 и complimentary entitlement без PAID или provider call", async () => {
  const ctx = setup();
  const applied = await ctx.service.applyPromo({ birthInput, code: " family0 " });
  assert.equal(applied.status, 200);
  assert.deepEqual(applied.body.pricing, { baseAmount: 100, discountAmount: 100, finalAmount: 0, currency: "RUB", promoCode: "FAMILY0" });
  const redeemed = await ctx.service.redeemPromo({ orderId: applied.body.order.orderId, code: "FAMILY0" });
  assert.equal(redeemed.status, 201);
  assert.equal(redeemed.body.order.status, "REPORT_GENERATING");
  assert.equal(redeemed.body.order.accessReason, "complimentary_promo");
  assert.equal(redeemed.body.order.paymentId, null);
  assert.equal(redeemed.body.order.providerStatus, null);
  assert.equal(ctx.providerCalls, 0);
  assert.equal(ctx.orderStore.promoRedemptions.size, 1);
  assert.equal(ctx.orderStore.promoEvents.size, 3);
});

test("FAMILY0 redemption атомарен, идемпотентен и соблюдает max redemption", async () => {
  const promos = initialPromoRecords(now).map(promo => promo.normalizedCode === "FAMILY0" ? { ...promo, maxRedemptions: 1 } : promo);
  const ctx = setup(promos);
  const first = await ctx.service.applyPromo({ birthInput, code: "FAMILY0" });
  const [a, b] = await Promise.all([
    ctx.service.redeemPromo({ orderId: first.body.order.orderId, code: "FAMILY0" }),
    ctx.service.redeemPromo({ orderId: first.body.order.orderId, code: "FAMILY0" }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
  assert.equal(ctx.orderStore.getPromo("FAMILY0").redemptionCount, 1);

  const other = await ctx.service.applyPromo({ birthInput: { ...birthInput, date: "1996-10-04" }, code: "FAMILY0" });
  assert.equal(other.status, 409);
  assert.equal(other.body.error, "Промокод больше недоступен");
});

test("terminal payment сохраняется в истории, но тот же order/report может перейти в FAMILY0", async () => {
  const ctx = setup();
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  const attempt = { attemptId: "attempt_terminal", orderId: order.orderId, providerStatus: "failed" };
  await ctx.orderStore.saveAttempt(attempt);
  await ctx.orderStore.save({ ...order, status: "CHECKOUT_STARTED", currentAttemptId: attempt.attemptId, paymentId: "pay_terminal", providerStatus: "failed", paymentFailureReason: "failed" });
  const applied = await ctx.service.applyPromo({ orderId: order.orderId, code: "FAMILY0" });
  assert.equal(applied.status, 200);
  assert.equal(applied.body.order.orderId, order.orderId);
  assert.equal(applied.body.order.reportId, order.reportId);
  assert.equal(applied.body.order.currentAttemptId, null);
  assert.equal((await ctx.orderStore.loadAttempt(attempt.attemptId)).providerStatus, "failed");
  const redeemed = await ctx.service.redeemPromo({ orderId: order.orderId, code: "FAMILY0" });
  assert.equal(redeemed.body.order.accessReason, "complimentary_promo");
  assert.equal(redeemed.body.order.status, "REPORT_GENERATING");
  assert.equal(ctx.providerCalls, 0);
});

test("active payment по-прежнему не разрешает применить промокод", async () => {
  const ctx = setup();
  const order = (await ctx.service.createCheckout(birthInput)).body.order;
  const attempt = { attemptId: "attempt_active", orderId: order.orderId, providerStatus: "requires_action" };
  await ctx.orderStore.saveAttempt(attempt);
  await ctx.orderStore.save({ ...order, status: "PAYMENT_PENDING", currentAttemptId: attempt.attemptId, paymentId: "pay_active", providerStatus: "requires_action" });
  const applied = await ctx.service.applyPromo({ orderId: order.orderId, code: "FAMILY0" });
  assert.equal(applied.status, 409);
  assert.equal((await ctx.orderStore.load(order.orderId)).currentAttemptId, attempt.attemptId);
  assert.equal((await ctx.orderStore.loadAttempt(attempt.attemptId)).providerStatus, "requires_action");
  assert.equal(ctx.providerCalls, 0);
});

test("production FAMILY0 redemption использует transaction, row locks и unique order binding", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "lib", "production-store.cjs"), "utf8");
  assert.match(source, /CREATE TABLE IF NOT EXISTS tian_min_promo_redemptions[\s\S]*order_id TEXT NOT NULL UNIQUE/);
  assert.match(source, /redeemComplimentaryPromo[\s\S]*query\("BEGIN"\)[\s\S]*tian_min_promos[^"`]*FOR UPDATE[\s\S]*tian_min_orders[^"`]*FOR UPDATE[\s\S]*redemption_count=redemption_count\+1[\s\S]*query\("COMMIT"\)/);
});

test("complimentary entitlement связан с точным order/report и не открывает изменённую карту", async () => {
  const ctx = setup();
  const first = await ctx.service.applyPromo({ birthInput, code: "FAMILY0" });
  await ctx.service.redeemPromo({ orderId: first.body.order.orderId, code: "FAMILY0" });
  const changed = (await ctx.service.createCheckout({ ...birthInput, birthTimeCertainty: "approximate" })).body.order;
  assert.notEqual(changed.orderId, first.body.order.orderId);
  assert.notEqual(changed.reportId, first.body.order.reportId);
  assert.equal((await ctx.service.generate(changed.orderId)).status, 403);
  assert.equal((await ctx.service.getOrder(changed.orderId)).body.order.accessReason, undefined);
});

test("FRIEND100 и SUPPORT399 configured, но production redemption заблокирован до подтверждения minimum", async () => {
  const ctx = setup();
  assert.equal(ctx.orderStore.getPromo("FRIEND100").targetFinalAmount, 100);
  assert.equal(ctx.orderStore.getPromo("SUPPORT399").targetFinalAmount, 399);
  assert.equal((await ctx.service.applyPromo({ birthInput, code: "FRIEND100" })).body.error, "Промокод больше недоступен");
  assert.equal((await ctx.service.applyPromo({ birthInput, code: "SUPPORT399" })).body.error, "Промокод больше недоступен");
  assert.equal(ctx.providerCalls, 0);
  assert.equal(ctx.orderStore.orders.size, 0);
});

test("normal price без promo остаётся server-owned: DEV 100, production 599", async () => {
  const dev = setup();
  assert.equal((await dev.service.createCheckout(birthInput)).body.order.amount, 100);
  const productionService = new PremiumService({
    env: { NODE_ENV: "production", PAYMENT_MODE: "lorentsen" }, orderStore: new MemoryOrderStore(), reportStore: null,
    paymentProvider: { name: "lorentsen", config: { partnerPublicName: "Тянь Мин", termsUrl: "https://example.test/terms", privacyUrl: "https://example.test/privacy", autoRedemptionTermsUrl: "https://example.test/redemption" } }, now: () => now,
  });
  assert.equal((await productionService.createCheckout(birthInput)).body.order.amount, 599);
});

test("favicon assets и head references существуют", () => {
  const publicRoot = path.resolve(__dirname, "..", "public");
  const html = fs.readFileSync(path.join(publicRoot, "index.html"), "utf8");
  for (const asset of ["favicon.svg", "favicon-16.png", "favicon-32.png", "apple-touch-icon.png"]) {
    assert.ok(fs.statSync(path.join(publicRoot, asset)).size > 0, `${asset} отсутствует`);
    assert.match(html, new RegExp(asset.replace(".", "\\.")));
  }
  assert.match(fs.readFileSync(path.join(publicRoot, "favicon.svg"), "utf8"), />命</);
});
