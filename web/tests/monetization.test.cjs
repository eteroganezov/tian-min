const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MemoryOrderStore, LocalOrderStore } = require("../lib/order-store.cjs");
const { MockPaymentProvider, createPaymentProvider } = require("../lib/payment-provider.cjs");
const { PremiumService, ORDER_STATES } = require("../lib/premium-service.cjs");
const { getProductConfig } = require("../lib/product-config.cjs");
const { LocalReportStore } = require("../lib/report-store.cjs");
const { createFreePreviewRequest } = require("../lib/free-preview.cjs");
const { locationProvider } = require("../lib/location-provider.cjs");

const input = { name: "Эдуард", date: "1995-09-03", time: "05:50", gender: "male", placeId: locationProvider.search("Москва")[0].id };

function setup(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tian-min-premium-"));
  const env = { NODE_ENV: "development", PAYMENT_MODE: "mock", OPENAI_MODEL: "test-model" };
  const orderStore = options.orderStore || new MemoryOrderStore();
  const reportStore = new LocalReportStore({ root: path.join(root, "reports") });
  const paymentProvider = new MockPaymentProvider({ env });
  const reportGenerator=async order=>({ kind:"semantic-report",reportId:order.reportId,chartId:order.chartId,
    input:orderStore.load(order.orderId).birthInput,presentation:{ displayName:"Тест" },report:await (options.stubGenerator || (async()=>({ ready:true })))(order),schemaVersion:"test" });
  const pdfRenderer=async()=>({ status:200,buffer:Buffer.from("%PDF-test") });
  const service = new PremiumService({ env, orderStore, reportStore, paymentProvider, reportGenerator, pdfRenderer });
  return { root, env, orderStore, reportStore, paymentProvider, service };
}

test("модель заказа содержит все состояния monetization flow", () => {
  assert.deepEqual(ORDER_STATES, ["FREE_PREVIEW", "CHECKOUT_STARTED", "PAYMENT_PENDING", "PAID", "REPORT_GENERATING", "REPORT_READY", "REPORT_FAILED"]);
});

test("free preview не создаёт order и не вызывает OpenAI", () => {
  const context = setup();
  try {
    let aiCalls = 0;
    assert.equal(createFreePreviewRequest(input, { aiProvider: () => { aiCalls += 1; } }).status, 200);
    assert.equal(context.orderStore.orders.size, 0);
    assert.equal(aiCalls, 0);
  } finally { fs.rmSync(context.root, { recursive: true, force: true }); }
});

test("checkout создаёт один заказ, использует server price и игнорирует paid от браузера", async () => {
  const context = setup();
  try {
    const first = await context.service.createCheckout({ ...input, paid: true, amount: 1, status: "PAID" });
    const second = await context.service.createCheckout(input);
    assert.equal(first.status, 201);
    assert.equal(first.body.order.status, "CHECKOUT_STARTED");
    assert.equal(first.body.order.amount, getProductConfig(context.env).amount);
    assert.equal(first.body.order.currency, "RUB");
    assert.equal(second.status, 200);
    assert.equal(second.body.order.orderId, first.body.order.orderId);
    assert.equal(context.orderStore.orders.size, 1);
    assert.equal(first.body.order.birthInput, undefined);
  } finally { fs.rmSync(context.root, { recursive: true, force: true }); }
});

test("checkout сохраняет birthTimeCertainty как metadata с legacy default exact", async () => {
  const context = setup();
  try {
    const exactOrder = (await context.service.createCheckout(input)).body.order;
    const storedExact = await context.orderStore.load(exactOrder.orderId);
    assert.equal(storedExact.birthInput.birthTimeCertainty, "exact");

    const approximateContext = setup();
    try {
      const approximateOrder = (await approximateContext.service.createCheckout({ ...input, birthTimeCertainty: "approximate" })).body.order;
      const storedApproximate = await approximateContext.orderStore.load(approximateOrder.orderId);
      assert.equal(storedApproximate.birthInput.birthTimeCertainty, "approximate");
      assert.equal(storedApproximate.birthInput.time, input.time);
    } finally { fs.rmSync(approximateContext.root, { recursive: true, force: true }); }
  } finally { fs.rmSync(context.root, { recursive: true, force: true }); }
});

test("оплата старого order не открывает Premium для изменённых birth data или birthTimeCertainty", async () => {
  const context = setup();
  try {
    const original = (await context.service.createCheckout(input)).body.order;
    const changedBirthData = (await context.service.createCheckout({
      ...input,
      date: "1996-10-04",
      time: "06:40",
      placeId: locationProvider.search("Санкт-Петербург")[0].id,
    })).body.order;
    const changedCertainty = (await context.service.createCheckout({ ...input, birthTimeCertainty: "approximate" })).body.order;

    assert.notEqual(changedBirthData.orderId, original.orderId);
    assert.notEqual(changedBirthData.reportId, original.reportId);
    assert.notEqual(changedCertainty.orderId, original.orderId);
    assert.notEqual(changedCertainty.reportId, original.reportId);

    await context.service.startPayment(original.orderId);
    await context.service.applyMockOutcome(original.orderId, "succeeded");

    assert.equal((await context.service.getOrder(original.orderId)).body.order.status, "PAID");
    assert.equal((await context.service.getOrder(changedBirthData.orderId)).body.order.status, "CHECKOUT_STARTED");
    assert.equal((await context.service.getOrder(changedCertainty.orderId)).body.order.status, "CHECKOUT_STARTED");
    assert.equal((await context.service.generate(changedBirthData.orderId)).status, 403);
    assert.equal((await context.service.generate(changedCertainty.orderId)).status, 403);
  } finally { fs.rmSync(context.root, { recursive: true, force: true }); }
});

test("неоплаченный order не проходит generation gate, provider success выставляет PAID", async () => {
  const context = setup();
  try {
    const order = (await context.service.createCheckout(input)).body.order;
    assert.equal((await context.service.generate(order.orderId)).status, 403);
    const pending = await context.service.startPayment(order.orderId);
    assert.equal(pending.body.order.status, "PAYMENT_PENDING");
    const paid = await context.service.applyMockOutcome(order.orderId, "succeeded");
    assert.equal(paid.body.order.status, "PAID");
    assert.ok(paid.body.order.paymentConfirmedAt);
  } finally { fs.rmSync(context.root, { recursive: true, force: true }); }
});

test("mock payment разрешён только development и production mode fail-closed", () => {
  assert.equal(createPaymentProvider({ NODE_ENV: "development", PAYMENT_MODE: "mock" }).name, "mock");
  assert.throws(() => createPaymentProvider({ NODE_ENV: "production", PAYMENT_MODE: "mock" }), /запрещён в production/);
  assert.throws(() => createPaymentProvider({ NODE_ENV: "development", PAYMENT_MODE: "lorentsen" }), /только в production/);
  assert.equal(createPaymentProvider({ NODE_ENV: "production" }).name, "unconfigured");
});

test("server source закрывает прямой legacy /api/report обход payment gate", () => {
  const server = fs.readFileSync(path.resolve(__dirname, "..", "server.cjs"), "utf8");
  assert.match(server, /request\.url === "\/api\/report"\) return sendJson\(response, 403/);
});

test("ошибка оплаты допускает retry и сохраняет бесплатный результат независимым", async () => {
  const context = setup();
  try {
    const order = (await context.service.createCheckout(input)).body.order;
    await context.service.startPayment(order.orderId);
    const failed = await context.service.applyMockOutcome(order.orderId, "failed");
    assert.equal(failed.body.order.status, "CHECKOUT_STARTED");
    assert.equal(failed.body.order.paymentFailureReason, "failed");
    assert.equal(createFreePreviewRequest(input).status, 200);
    assert.equal((await context.service.startPayment(order.orderId)).body.order.status, "PAYMENT_PENDING");
  } finally { fs.rmSync(context.root, { recursive: true, force: true }); }
});

test("один paid report генерируется один раз и REPORT_READY переиспользуется", async () => {
  let generationCalls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const context = setup({ stubGenerator: async order => { generationCalls += 1; await gate; return { mode: "stub", reportId: order.reportId }; } });
  try {
    const order = (await context.service.createCheckout(input)).body.order;
    await context.service.startPayment(order.orderId);
    await context.service.applyMockOutcome(order.orderId, "succeeded");
    const firstPromise = context.service.generate(order.orderId);
    await new Promise(resolve => setImmediate(resolve));
    const duplicate = await context.service.generate(order.orderId);
    assert.equal(duplicate.status, 202);
    assert.equal(duplicate.body.order.status, "REPORT_GENERATING");
    release();
    await firstPromise;
    await context.service.waitForGenerationJobs();
    const ready = await context.service.getOrder(order.orderId);
    assert.equal(ready.body.order.status, "REPORT_READY");
    assert.equal(generationCalls, 1);
    const repeated = await context.service.generate(order.orderId);
    assert.equal(repeated.body.order.status, "REPORT_READY");
    assert.equal(generationCalls, 1);
  } finally { fs.rmSync(context.root, { recursive: true, force: true }); }
});

test("повторный payment callback после REPORT_READY идемпотентен", async () => {
  const context = setup();
  try {
    const order = (await context.service.createCheckout(input)).body.order;
    await context.service.startPayment(order.orderId);
    const paid = await context.service.applyMockOutcome(order.orderId, "succeeded");
    await context.service.generate(order.orderId);
    await context.service.waitForGenerationJobs();
    const ready = await context.service.getOrder(order.orderId);
    const repeated = await context.service.applyMockOutcome(order.orderId, "succeeded");
    assert.equal(repeated.body.order.status, "REPORT_READY");
    assert.equal(repeated.body.order.paymentConfirmedAt, paid.body.order.paymentConfirmedAt);
    assert.equal(repeated.body.order.reportGenerationCompletedAt, ready.body.order.reportGenerationCompletedAt);
  } finally { fs.rmSync(context.root, { recursive: true, force: true }); }
});

test("REPORT_FAILED можно повторить без новой оплаты", async () => {
  let calls = 0;
  const context = setup({ stubGenerator: async order => { calls += 1; if (calls === 1) throw new Error("stub failed"); return { mode: "stub", reportId: order.reportId }; } });
  try {
    const order = (await context.service.createCheckout(input)).body.order;
    await context.service.startPayment(order.orderId);
    await context.service.applyMockOutcome(order.orderId, "succeeded");
    await context.service.generate(order.orderId); await context.service.waitForGenerationJobs();
    const failed=(await context.service.getOrder(order.orderId)).body.order;
    assert.equal(failed.status, "REPORT_FAILED");
    await context.service.generate(order.orderId,{expectedAttempt:failed.reportGenerationAttempt}); await context.service.waitForGenerationJobs();
    assert.equal((await context.service.getOrder(order.orderId)).body.order.status, "REPORT_READY");
    assert.equal(calls, 2);
  } finally { fs.rmSync(context.root, { recursive: true, force: true }); }
});

test("DEV LocalOrderStore даёт повторный доступ после нового service instance", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tian-min-orders-"));
  const env = { NODE_ENV: "development", PAYMENT_MODE: "mock" };
  try {
    const firstStore = new LocalOrderStore({ root, env });
    const reportRoot = path.join(root, "reports");
    const first = new PremiumService({ env, orderStore: firstStore, reportStore: new LocalReportStore({ root: reportRoot }), paymentProvider: new MockPaymentProvider({ env }) });
    const order = (await first.createCheckout(input)).body.order;
    const second = new PremiumService({ env, orderStore: new LocalOrderStore({ root, env }), reportStore: new LocalReportStore({ root: reportRoot }), paymentProvider: new MockPaymentProvider({ env }) });
    assert.equal((await second.getOrder(order.orderId)).body.order.reportId, order.reportId);
    assert.equal((await second.createCheckout(input)).body.order.orderId, order.orderId);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("REPORT_READY восстанавливается из persistence без повторной генерации", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tian-min-ready-"));
  const env = { NODE_ENV: "development", PAYMENT_MODE: "mock" };
  let generationCalls = 0;
  try {
    const reportRoot = path.join(root, "reports");
    const first = new PremiumService({
      env,
      orderStore: new LocalOrderStore({ root: path.join(root, "orders"), env }),
      reportStore: new LocalReportStore({ root: reportRoot }),
      paymentProvider: new MockPaymentProvider({ env }),
      reportGenerator: async order => { generationCalls += 1; return { kind:"semantic-report",reportId:order.reportId,chartId:order.chartId,input,report:{},presentation:{},schemaVersion:"test" }; },
      pdfRenderer: async()=>({ status:200,buffer:Buffer.from("%PDF-test") }),
    });
    const order = (await first.createCheckout(input)).body.order;
    await first.startPayment(order.orderId);
    await first.applyMockOutcome(order.orderId, "succeeded");
    await first.generate(order.orderId); await first.waitForGenerationJobs();
    assert.equal((await first.getOrder(order.orderId)).body.order.status, "REPORT_READY");

    const restored = new PremiumService({
      env,
      orderStore: new LocalOrderStore({ root: path.join(root, "orders"), env }),
      reportStore: new LocalReportStore({ root: reportRoot }),
      paymentProvider: new MockPaymentProvider({ env }),
      reportGenerator: async () => { generationCalls += 1; throw new Error("не должна запускаться"); },
      pdfRenderer: async()=>({ status:200,buffer:Buffer.from("%PDF-test") }),
    });
    assert.equal((await restored.getOrder(order.orderId)).body.order.status, "REPORT_READY");
    assert.equal((await restored.generate(order.orderId)).body.order.status, "REPORT_READY");
    assert.equal(generationCalls, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("production price и local order storage работают fail-closed", () => {
  const env = { NODE_ENV: "production", PREMIUM_REPORT_PRICE_RUB: "599" };
  assert.equal(getProductConfig(env).available, true);
  assert.equal(getProductConfig(env).amount, 599);
  const store = new LocalOrderStore({ root: path.join(os.tmpdir(), "unused-production-orders"), env });
  assert.throws(() => store.save({ orderId: "order_1234567890abcdef1234567890abcdef" }), /Production order storage/);
});

test("frontend monetization не вызывает OpenAI/report API", () => {
  const script = fs.readFileSync(path.resolve(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(script, /\/api\/premium\/checkout/);
  assert.match(script, /Симулировать успешную оплату/);
  assert.match(script, /REPORT_READY/);
  assert.match(script, /restorePremiumOrder\(\)/);
  assert.match(script, /\["PAID", "REPORT_GENERATING", "REPORT_FAILED"\]/);
  assert.match(script, /\["CHECKOUT_STARTED", "PAYMENT_PENDING"\]/);
  assert.match(script, /name="payerEmail"/);
  assert.match(script, /name="termsAccepted"/);
  assert.match(script, /name="autoRedemptionAccepted"/);
  assert.match(script, /button\.disabled.*email\.validity\.valid/);
  assert.match(script, /paymentMethod\.link|method\.link/);
  assert.match(script, /methodIsUsable/);
  assert.match(script, /provider_result_unknown.*methodIsUsable|methodIsUsable[\s\S]*provider_result_unknown/);
  assert.doesNotMatch(script, /decode.*QR|status\s*:\s*["']PAID/);
  assert.doesNotMatch(script, /\/api\/report|OPENAI_API_KEY|paid\s*:\s*true/);
});
