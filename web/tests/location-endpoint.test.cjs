const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { createServer } = require("../server.cjs");

function requestJson(server, url) {
  return new Promise((resolve, reject) => {
    const request = Readable.from([]);
    request.method = "GET";
    request.url = url;
    request.headers = {};
    const response = {
      status: 0,
      headers: {},
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(body = "") {
        try { resolve({ status: this.status, headers: this.headers, body: JSON.parse(String(body)) }); }
        catch (error) { reject(error); }
      },
    };
    server.emit("request", request, response);
  });
}

test("GET /api/places проходит реальную route → provider цепочку для partial/case-insensitive query", async () => {
  const server = createServer();
  try {
    for (const [query, expected] of [["мо", "Москва, Россия"], ["моск", "Москва, Россия"], ["сан", "Санкт-Петербург, Россия"], ["санкт", "Санкт-Петербург, Россия"], ["екат", "Екатеринбург, Россия"], ["ниж", "Нижний Новгород, Россия"], ["каз", "Казань, Россия"]]) {
      const lower = await requestJson(server, `/api/places?q=${encodeURIComponent(query)}`);
      const upper = await requestJson(server, `/api/places?q=${encodeURIComponent(query.toLocaleUpperCase("ru-RU"))}`);
      assert.equal(lower.status, 200, query);
      assert.equal(lower.body.places[0].display.label, expected, query);
      assert.equal(upper.body.places[0].id, lower.body.places[0].id, query);
      assert.ok(Number.isFinite(lower.body.places[0].latitude), query);
      assert.ok(Number.isFinite(lower.body.places[0].longitude), query);
      assert.match(lower.body.places[0].timeZone, /\//, query);
    }
  } finally { server.close(); }
});
