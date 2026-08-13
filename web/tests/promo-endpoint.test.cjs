const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { createServer } = require("../server.cjs");

function postJson(server, url, body) {
  return new Promise((resolve, reject) => {
    const request = Readable.from([JSON.stringify(body)]);
    request.method = "POST";
    request.url = url;
    request.headers = { "content-type": "application/json" };
    const response = {
      status: 0,
      writeHead(status) { this.status = status; },
      end(value = "") { try { resolve({ status: this.status, body: JSON.parse(String(value)) }); } catch (error) { reject(error); } },
    };
    server.emit("request", request, response);
  });
}

test("promo apply/redeem routes передают данные только server service", async () => {
  const calls = [];
  const premiumService = {
    applyPromo: async input => { calls.push(["apply", input]); return { status: 200, body: { pricing: { finalAmount: 0 } } }; },
    redeemPromo: async input => { calls.push(["redeem", input]); return { status: 201, body: { entitlement: { accessReason: "complimentary_promo" } } }; },
  };
  const server = createServer({ premiumService });
  try {
    const applied = await postJson(server, "/api/premium/promo/apply", { code: " family0 ", birthInput: { date: "1995-09-03" } });
    const redeemed = await postJson(server, "/api/premium/promo/redeem", { code: "FAMILY0", orderId: "order_test" });
    assert.equal(applied.status, 200);
    assert.equal(applied.body.pricing.finalAmount, 0);
    assert.equal(redeemed.status, 201);
    assert.equal(redeemed.body.entitlement.accessReason, "complimentary_promo");
    assert.deepEqual(calls.map(call => call[0]), ["apply", "redeem"]);
  } finally { server.close(); }
});
