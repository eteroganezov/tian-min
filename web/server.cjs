const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
const { calculateRequest } = require("./lib/calculate.cjs");
const { createFreePreviewRequest } = require("./lib/free-preview.cjs");
const { locationProvider } = require("./lib/location-provider.cjs");
const { generateReportRequest } = require("./lib/report-service.cjs");
const { createPdfFromSavedReport, createPdfRequest } = require("./lib/pdf-service.cjs");
const { LocalReportStore } = require("./lib/report-store.cjs");

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

function createServer(options = {}) {
  const staticRoot = options.staticRoot || (fs.existsSync(path.join(__dirname, "dist", "index.html")) ? path.join(__dirname, "dist") : path.join(__dirname, "public"));
  const reportStore = options.reportStore || new LocalReportStore();
  const freePreviewRequest = options.freePreviewRequest || createFreePreviewRequest;
  const reportRequest = options.reportRequest || generateReportRequest;
  return http.createServer(async (request, response) => {
    try {
      if (request.method === "POST" && request.url === "/api/calculate") return await handleCalculation(request, response);
      if (request.method === "POST" && request.url === "/api/free-preview") return await handleFreePreview(request, response, freePreviewRequest);
      if (request.method === "POST" && request.url === "/api/report") return await handleReport(request, response, reportStore, reportRequest);
      if (request.method === "POST" && request.url === "/api/pdf") return await handlePdf(request, response);
      if (request.method === "GET" && request.url === "/api/dev/reports/latest") return handleSavedReport(response, reportStore);
      if (request.method === "POST" && request.url === "/api/dev/reports/import-rendered") return await handleLegacyImport(request, response, reportStore);
      if (request.method === "POST" && request.url === "/api/dev/reports/pdf") return await handleSavedPdf(request, response, reportStore);
      if (request.method === "GET" && request.url.startsWith("/api/places")) return handlePlaces(request, response);
      if (request.method !== "GET" && request.method !== "HEAD") return sendJson(response, 405, { error: "Метод не поддерживается." });
      return serveStatic(request, response, staticRoot);
    } catch {
      return sendJson(response, 500, { error: "Внутренняя ошибка. Попробуйте ещё раз." });
    }
  });
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

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const server = createServer();
  server.listen(port, "127.0.0.1", () => console.log(`Тянь Мин запущен: http://localhost:${port}`));
}

module.exports = { createServer };
