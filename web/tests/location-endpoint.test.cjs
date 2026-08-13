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
    for (const [query, expected] of [["моск", "Москва, Россия"], ["санкт", "Санкт-Петербург, Россия"], ["екат", "Екатеринбург, Россия"], ["нижний н", "Нижний Новгород, Россия"], ["казан", "Казань, Россия"]]) {
      const lower = await requestJson(server, `/api/places?q=${encodeURIComponent(query)}`);
      const upper = await requestJson(server, `/api/places?q=${encodeURIComponent(query.toLocaleUpperCase("ru-RU"))}`);
      assert.equal(lower.status, 200, query);
      assert.equal(lower.body.places[0].display.label, expected, query);
      assert.equal(upper.body.places[0].id, lower.body.places[0].id, query);
      assert.ok(Number.isFinite(lower.body.places[0].latitude), query);
      assert.ok(Number.isFinite(lower.body.places[0].longitude), query);
      assert.match(lower.body.places[0].timeZone, /\//, query);
      assert.equal(lower.body.places[0].source, "geonames", query);
    }
  } finally { server.close(); }
});

test("GET /api/places находит один GeoNames Phuket по Russian/English и возвращает top 8", async () => {
  const server=createServer();
  try {
    const russian=await requestJson(server,`/api/places?q=${encodeURIComponent("Пхукет")}`),english=await requestJson(server,"/api/places?q=Phuket");
    assert.equal(russian.body.places[0].geonameId,1151254); assert.equal(russian.body.places[0].id,english.body.places[0].id);
    assert.equal(russian.body.places[0].display.label,"Пхукет, Таиланд"); assert.equal(russian.body.places[0].timeZone,"Asia/Bangkok");
    const broad=await requestJson(server,"/api/places?q=San"); assert.ok(broad.body.places.length<=8);
  } finally { server.close(); }
});

test("GET /api/places возвращает один канонический Ереван для Cyrillic/Latin", async () => {
  const server = createServer();
  try {
    const russian = await requestJson(server, `/api/places?q=${encodeURIComponent("Ереван")}`);
    const english = await requestJson(server, "/api/places?q=Yerevan");
    assert.equal(russian.body.places[0].id, english.body.places[0].id);
    assert.equal(russian.body.places[0].display.label, "Ереван, Армения");
    assert.equal(russian.body.places[0].timeZone, "Asia/Yerevan");
  } finally { server.close(); }
});

test("GET /api/timezones ищет IANA zone и не возвращает голый UTC offset", async () => {
  const server = createServer();
  try {
    const response = await requestJson(server, "/api/timezones?q=yerevan");
    assert.equal(response.status, 200);
    assert.equal(response.body.timeZones[0].id, "Asia/Yerevan");
    assert.ok(response.body.timeZones.every(zone => zone.id.includes("/")));
  } finally { server.close(); }
});
