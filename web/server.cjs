const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
const { calculateRequest } = require("./lib/calculate.cjs");
const { createFreePreviewRequest } = require("./lib/free-preview.cjs");
const { locationProvider } = require("./lib/location-provider.cjs");
const { searchTimeZones } = require("./lib/timezone-provider.cjs");
const { generateReportRequest } = require("./lib/report-service.cjs");
const { createPdfFromSavedReport, createPdfRequest } = require("./lib/pdf-service.cjs");
const { LocalReportStore } = require("./lib/report-store.cjs");
const { LocalOrderStore } = require("./lib/order-store.cjs");
const { createPaymentProvider } = require("./lib/payment-provider.cjs");
const { PremiumService } = require("./lib/premium-service.cjs");
const { PostgresPaymentStore, PostgresReportStore } = require("./lib/production-store.cjs");
const { assertProductionGenerationReady } = require("./lib/generation-config.cjs");

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

function createServer(options = {}) {
  const staticRoot = options.staticRoot || (fs.existsSync(path.join(__dirname, "dist", "index.html")) ? path.join(__dirname, "dist") : path.join(__dirname, "public"));
  const env = options.env || process.env;
  const paymentProvider = options.paymentProvider || createPaymentProvider(env);
  const orderStore = options.orderStore || (paymentProvider.name === "lorentsen" ? new PostgresPaymentStore({ env }) : new LocalOrderStore({ env }));
  const reportStore = options.reportStore || (paymentProvider.name === "lorentsen" ? new PostgresReportStore(orderStore) : new LocalReportStore());
  const premiumService = options.premiumService || new PremiumService({
    env, reportStore,
    orderStore,
    paymentProvider,
  });
  const freePreviewRequest = options.freePreviewRequest || createFreePreviewRequest;
  const reportRequest = options.reportRequest || generateReportRequest;
  const server = http.createServer(async (request, response) => {
    try {
      if (env.NODE_ENV === "production" && request.url.startsWith("/api/dev/")) return sendJson(response, 404, { error: "Страница не найдена." });
      if (request.method === "POST" && request.url === "/api/calculate") return await handleCalculation(request, response);
      if (request.method === "POST" && request.url === "/api/free-preview") return await handleFreePreview(request, response, freePreviewRequest);
      if (request.method === "POST" && request.url === "/api/report") return sendJson(response, 403, { error: "Прямая генерация отключена. Персональный разбор запускается сервером только после подтверждённой оплаты." });
      if (request.method === "GET" && request.url === "/api/premium/config") return sendJson(response, 200, premiumService.getConfig());
      if (request.method === "POST" && request.url === "/api/premium/checkout") return await handlePremiumAction(request, response, input => premiumService.createCheckout(input), 30_000);
      if (request.method === "POST" && request.url === "/api/premium/promo/apply") return await handlePremiumAction(request, response, input => premiumService.applyPromo(input), 30_000);
      if (request.method === "POST" && request.url === "/api/premium/promo/redeem") return await handlePremiumAction(request, response, input => premiumService.redeemPromo(input));
      if (request.method === "POST" && request.url === "/api/premium/payment/start") return await handlePremiumAction(request, response, input => premiumService.startPayment(input));
      if (request.method === "POST" && request.url === "/api/premium/dev/payment") return await handlePremiumAction(request, response, input => premiumService.applyMockOutcome(input.orderId, input.outcome));
      if (request.method === "POST" && request.url === "/api/payments/lorentsen/webhook") return await handleLorentsenWebhook(request, response, premiumService);
      if (request.method === "POST" && request.url === "/api/premium/generate") return await handlePremiumAction(request, response, input => premiumService.generate(input.orderId,{ expectedAttempt:input.reportGenerationAttempt }));
      if (request.method === "GET" && request.url.startsWith("/api/premium/order/")) return await handlePremiumOrder(request, response, premiumService);
      if (request.method === "GET" && request.url.startsWith("/api/premium/report/")) return await handlePremiumDelivery(request, response, premiumService);
      if (request.method === "POST" && request.url === "/api/pdf") return await handlePdf(request, response);
      if (request.method === "GET" && request.url === "/api/dev/reports/latest") return handleSavedReport(response, reportStore);
      if (request.method === "POST" && request.url === "/api/dev/reports/import-rendered") return await handleLegacyImport(request, response, reportStore);
      if (request.method === "POST" && request.url === "/api/dev/reports/pdf") return await handleSavedPdf(request, response, reportStore);
      if (request.method === "GET" && request.url.startsWith("/api/places")) return handlePlaces(request, response);
      if (request.method === "GET" && request.url.startsWith("/api/timezones")) return handleTimeZones(request, response);
      if (request.method !== "GET" && request.method !== "HEAD") return sendJson(response, 405, { error: "Метод не поддерживается." });
      return serveStatic(request, response, staticRoot);
    } catch {
      return sendJson(response, 500, { error: "Внутренняя ошибка. Попробуйте ещё раз." });
    }
  });
  server.deploymentReady = orderStore.ready || Promise.resolve();
  server.processPendingWebhooks = () => premiumService.processPendingWebhooks?.() || Promise.resolve([]);
  return server;
}

async function handlePremiumAction(request, response, action, limit = 10_000) {
  const input = await readJson(request, response, limit);
  if (!input) return;
  const result = await action(input);
  return sendJson(response, result.status, result.body);
}

async function handlePremiumOrder(request, response, premiumService) {
  const orderId = decodeURIComponent(new URL(request.url, "http://localhost").pathname.split("/").pop() || "");
  const result = await premiumService.getOrder(orderId);
  return sendJson(response, result.status, result.body);
}

async function handlePremiumDelivery(request,response,premiumService) {
  const url=new URL(request.url,"http://localhost");
  const token=decodeURIComponent(url.pathname.split("/").pop() || "");
  const result=await premiumService.deliver(token);
  if(result.status!==200) return sendJson(response,result.status,{ error:result.error });
  const disposition=url.searchParams.get("download") === "1" ? "attachment" : "inline";
  response.writeHead(200,{ "Content-Type":"application/pdf","Content-Disposition":`${disposition}; filename="${result.filename}"`,
    "Content-Length":result.buffer.length,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer" });
  return response.end(result.buffer);
}

async function handleLorentsenWebhook(request, response, premiumService) {
  const rawBody = await readRawBody(request, response, 256 * 1024);
  if (!rawBody) return;
  const result = await premiumService.handleLorentsenWebhook(rawBody, request.headers);
  return sendJson(response, result.status, result.body);
}

async function handleFreePreview(request, response, freePreviewRequest) {
  const input = await readJson(request, response, 20_000);
  if (!input) return;
  const result = freePreviewRequest(input);
  return sendJson(response, result.status, result.body);
}

function handlePlaces(request, response) {
  const url = new URL(request.url, "http://localhost");
  const query = url.searchParams.get("q") || "";
  if (query.length > 100) return sendJson(response, 400, { error: "Слишком длинный поисковый запрос." });
  return sendJson(response, 200, { places: locationProvider.search(query) });
}

function handleTimeZones(request, response) {
  const url = new URL(request.url, "http://localhost");
  const query = url.searchParams.get("q") || "";
  if (query.length > 100) return sendJson(response, 400, { error: "Слишком длинный поисковый запрос." });
  return sendJson(response, 200, { timeZones: searchTimeZones(query) });
}

async function handleCalculation(request, response) {
  const input = await readJson(request, response, 20_000);
  if (!input) return;
  const result = calculateRequest(input);
  return sendJson(response, result.status, result.body);
}

async function handleReport(request, response, reportStore, reportRequest) {
  const input = await readJson(request, response, 30_000);
  if (!input) return;
  const result = await reportRequest(input, { reportStore });
  return sendJson(response, result.status, result.body);
}

function handleSavedReport(response, reportStore) {
  const saved = reportStore.load();
  return saved ? sendJson(response, 200, saved) : sendJson(response, 404, { error: "Сохранённый отчёт не найден." });
}

async function handleLegacyImport(request, response, reportStore) {
  const input = await readImportPayload(request, response, 600_000);
  if (!input) return;
  try { return sendJson(response, 201, reportStore.importLegacy(input)); }
  catch { return sendJson(response, 400, { error: "Не удалось сохранить существующий отчёт." }); }
}

async function readImportPayload(request, response, limit) {
  if (!String(request.headers["content-type"] || "").startsWith("application/x-www-form-urlencoded")) return readJson(request, response, limit);
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > limit) { sendJson(response, 413, { error: "Слишком большой запрос." }); return null; }
  }
  try { return JSON.parse(new URLSearchParams(raw).get("payload") || ""); }
  catch { sendJson(response, 400, { error: "Не удалось прочитать сохранённый отчёт." }); return null; }
}

async function handleSavedPdf(request, response, reportStore) {
  const input = await readJson(request, response, 10_000);
  if (!input) return;
  const saved = reportStore.load(input.id || "latest");
  if (!saved) return sendJson(response, 404, { error: "Сохранённый отчёт не найден." });
  const result = await createPdfFromSavedReport(saved);
  if (result.status !== 200) return sendJson(response, result.status, { error: result.error });
  response.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${result.filename}"`, "Content-Length": result.buffer.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  return response.end(result.buffer);
}

async function handlePdf(request, response) {
  const input = await readJson(request, response, 750_000);
  if (!input) return;
  const result = await createPdfRequest(input);
  if (result.status !== 200) return sendJson(response, result.status, { error: result.error });
  response.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${result.filename}"`,
    "Content-Length": result.buffer.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  return response.end(result.buffer);
}

async function readJson(request, response, limit) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > limit) { sendJson(response, 413, { error: "Слишком большой запрос." }); return null; }
  }
  try { return JSON.parse(raw); } catch { sendJson(response, 400, { error: "Не удалось прочитать данные формы." }); return null; }
}

async function readRawBody(request, response, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) { sendJson(response, 413, { error: "Слишком большой webhook." }); return null; }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function serveStatic(request, response, staticRoot) {
  const url = new URL(request.url, "http://localhost");
  const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const filePath = path.resolve(staticRoot, requested);
  if (!filePath.startsWith(path.resolve(staticRoot) + path.sep)) return sendJson(response, 404, { error: "Страница не найдена." });
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return sendJson(response, 404, { error: "Страница не найдена." });
  response.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream", "Cache-Control": "no-store" });
  if (request.method === "HEAD") return response.end();
  fs.createReadStream(filePath).pipe(response);
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function resolveServerBinding(env = process.env) {
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT должен быть целым числом от 1 до 65535.");
  return { host: env.HOST || "0.0.0.0", port };
}

if (require.main === module) void startServer().catch(() => { console.error("[STARTUP_ERROR] Production configuration или persistence недоступна."); process.exitCode = 1; });

async function startServer() {
  const { host, port } = resolveServerBinding();
  assertProductionGenerationReady(process.env);
  const server = createServer();
  await server.deploymentReady;
  server.listen(port, host, () => {
    console.log(`Тянь Мин запущен: http://localhost:${port} (bind ${host})`);
    void server.processPendingWebhooks().catch(() => {});
    const worker = setInterval(() => void server.processPendingWebhooks().catch(() => {}), 15_000);
    worker.unref();
  });
}

module.exports = { createServer, resolveServerBinding, startServer };
