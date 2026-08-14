const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { createServer } = require("../server.cjs");

function postRaw(server, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = Readable.from([body]);
    request.method = "POST";
    request.url = "/api/payments/lorentsen/webhook";
    request.headers = headers;
    const response = {
      status: 0,
      writeHead(status) { this.status = status; },
      end(value = "") { try { resolve({ status: this.status, body: JSON.parse(String(value)) }); } catch (error) { reject(error); } },
    };
    server.emit("request", request, response);
  });
}

function getJson(server, url) {
  return new Promise((resolve, reject) => {
    const request = Readable.from([]);
    request.method = "GET";
    request.url = url;
    request.headers = {};
    const response = {
      status: 0,
      writeHead(status) { this.status = status; },
      end(value = "") { try { resolve({ status: this.status, body: JSON.parse(String(value)) }); } catch (error) { reject(error); } },
    };
    server.emit("request", request, response);
  });
}

test("webhook route передаёт exact raw bytes до JSON.parse", async () => {
  const expected = Buffer.from('{ "id" : "evt_exact", "unicode" : "天命" }');
  let received;
  const premiumService = { handleLorentsenWebhook: async (rawBody, headers) => { received = { rawBody, headers }; return { status: 202, body: { accepted: true } }; } };
  const server = createServer({ premiumService });
  try {
    const result = await postRaw(server, expected, { "x-lorensten-event-id": "evt_exact" });
    assert.equal(result.status, 202);
    assert.deepEqual(received.rawBody, expected);
    assert.equal(received.headers["x-lorensten-event-id"], "evt_exact");
  } finally { server.close(); }
});

test("webhook route отклоняет body больше 256 KB до service", async () => {
  let called = false;
  const server = createServer({ premiumService: { handleLorentsenWebhook: async () => { called = true; return { status: 202, body: {} }; } } });
  try {
    const result = await postRaw(server, Buffer.alloc(256 * 1024 + 1, 65));
    assert.equal(result.status, 413);
    assert.equal(called, false);
  } finally { server.close(); }
});

test("order recovery route forwards lifecycle source, forced refresh and preview request", async () => {
  let received;
  const premiumService = { getOrder: async (orderId, options) => { received = { orderId, options }; return { status: 200, body: { order: { orderId } } }; } };
  const server = createServer({ premiumService });
  try {
    const result = await getJson(server, "/api/premium/order/order_safe?source=pageshow&refresh=1&includePreview=1");
    assert.equal(result.status, 200);
    assert.deepEqual(received, { orderId: "order_safe", options: { source: "pageshow", refresh: true, includePreview: true } });
  } finally { server.close(); }
});
