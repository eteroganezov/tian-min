const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveServerBinding } = require("../server.cjs");

test("server по умолчанию доступен извне контейнера и сохраняет local port", () => {
  assert.deepEqual(resolveServerBinding({}), { host: "0.0.0.0", port: 3000 });
});

test("server использует deployment PORT и допускает явный HOST override", () => {
  assert.deepEqual(resolveServerBinding({ PORT: "4317" }), { host: "0.0.0.0", port: 4317 });
  assert.deepEqual(resolveServerBinding({ PORT: "4318", HOST: "127.0.0.1" }), { host: "127.0.0.1", port: 4318 });
});

test("server fail-fast отклоняет некорректный PORT", () => {
  for (const port of ["abc", "0", "65536", "3.14"]) {
    assert.throws(() => resolveServerBinding({ PORT: port }), /PORT должен быть целым числом/);
  }
});
