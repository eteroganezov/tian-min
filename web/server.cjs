const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { calculateRequest } = require("./lib/calculate.cjs");

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

function createServer(options = {}) {
  const staticRoot = options.staticRoot || (fs.existsSync(path.join(__dirname, "dist", "index.html")) ? path.join(__dirname, "dist") : path.join(__dirname, "public"));
  return http.createServer(async (request, response) => {
    try {
      if (request.method === "POST" && request.url === "/api/calculate") return await handleCalculation(request, response);
      if (request.method !== "GET" && request.method !== "HEAD") return sendJson(response, 405, { error: "Метод не поддерживается." });
      return serveStatic(request, response, staticRoot);
    } catch {
      return sendJson(response, 500, { error: "Внутренняя ошибка. Попробуйте ещё раз." });
    }
  });
}

async function handleCalculation(request, response) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 20_000) return sendJson(response, 413, { error: "Слишком большой запрос." });
  }
  let input;
  try { input = JSON.parse(raw); } catch { return sendJson(response, 400, { error: "Не удалось прочитать данные формы." }); }
  const result = calculateRequest(input);
  return sendJson(response, result.status, result.body);
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
