const test = require("node:test");
const assert = require("node:assert/strict");
const {
  elementDisplay, palaceDisplay, starDisplay, structureDisplay, tenGodDisplay,
} = require("../lib/astrology-localization.cjs");

test("все 12 дворцов Цзы Вэй имеют централизованные русские названия", () => {
  const expected = {
    "命宫": "Дворец судьбы и личности", "兄弟宫": "Дворец братьев, сестёр и близкого окружения",
    "夫妻宫": "Дворец партнёрства и отношений", "子女宫": "Дворец детей и самовыражения",
    "财帛宫": "Дворец финансов и ресурсов", "疾厄宫": "Дворец здоровья и уязвимостей",
    "迁移宫": "Дворец внешнего мира и перемен", "交友宫": "Дворец друзей, связей и окружения",
    "官禄宫": "Дворец карьеры и реализации", "田宅宫": "Дворец дома, имущества и основы",
    "福德宫": "Дворец внутреннего состояния и благополучия", "父母宫": "Дворец родителей и старших",
  };
  for (const [original, name] of Object.entries(expected)) assert.deepEqual(palaceDisplay(original), { original, name });
});

test("пять элементов показываются по-русски с сохранением оригинала", () => {
  assert.deepEqual(["木", "火", "土", "金", "水"].map(elementDisplay), [
    { original: "木", name: "Дерево" }, { original: "火", name: "Огонь" },
    { original: "土", name: "Земля" }, { original: "金", name: "Металл" }, { original: "水", name: "Вода" },
  ]);
});

test("ключевые термины Ба-цзы используют единый русский словарь", () => {
  assert.equal(tenGodDisplay("正印").name, "Прямая печать");
  assert.equal(tenGodDisplay("偏财").name, "Косвенное богатство");
  assert.equal(tenGodDisplay("七杀").name, "Семь убийц");
  assert.equal(tenGodDisplay("劫财").name, "Грабитель богатства");
  assert.deepEqual(structureDisplay("正财格"), { original: "正财格", name: "Структура «Прямое богатство»" });
});

test("основные звёзды получают только безопасную транслитерацию", () => {
  assert.deepEqual(starDisplay("紫微"), { original: "紫微", name: "Цзы Вэй" });
  assert.deepEqual(starDisplay("天府"), { original: "天府", name: "Тянь Фу" });
  assert.deepEqual(starDisplay("Неизвестная"), { original: "Неизвестная", name: "Неизвестная" });
});
