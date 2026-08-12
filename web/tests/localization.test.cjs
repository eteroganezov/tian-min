const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BRANCHES, STEMS, STRENGTH, TEN_GODS, branchDisplay, elementDisplay, palaceDisplay, starDisplay, stemDisplay,
  strengthDisplay, structureDisplay, tenGodDisplay,
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

test("полный набор статусов силы из calculation core имеет русское отображение", () => {
  const expected = {
    "极旺(可能从强)": "Очень сильная карта (возможна структура следования силе)",
    "偏旺": "Скорее сильная карта",
    "中和": "Сбалансированная карта",
    "偏弱": "Скорее ослабленная карта",
    "极弱(可能从弱)": "Очень слабая карта (возможна структура следования слабости)",
  };
  assert.deepEqual(STRENGTH, expected);
  for (const [original, name] of Object.entries(expected)) {
    assert.deepEqual(strengthDisplay(original), { original, name });
    assert.notEqual(name, original);
  }
});

test("неизвестный статус силы обнаруживается в test/dev и не протекает raw-строкой в production", () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "test";
    assert.throws(() => strengthDisplay("未知强度"), /Неизвестный статус силы карты/);
    process.env.NODE_ENV = "production";
    assert.deepEqual(strengthDisplay("未知强度"), { original: "未知强度", name: "Статус требует уточнения" });
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test("все небесные стволы и земные ветви получают отдельные понятные подписи", () => {
  assert.equal(Object.keys(STEMS).length, 10);
  assert.equal(Object.keys(BRANCHES).length, 12);
  assert.deepEqual(stemDisplay("壬"), { original: "壬", name: "Вода Ян · небесный ствол" });
  assert.deepEqual(branchDisplay("申"), { original: "申", name: "Обезьяна · земная ветвь" });
  for (const stem of Object.keys(STEMS)) assert.match(stemDisplay(stem).name, /(?:Ян|Инь) · небесный ствол$/);
  for (const branch of Object.keys(BRANCHES)) assert.match(branchDisplay(branch).name, / · земная ветвь$/);
});

test("все десять традиционных ролей Ба-цзы локализованы без внутренних enum", () => {
  const expected = {
    "正印": "Прямая печать", "偏印": "Косвенная печать", "正官": "Прямой чиновник",
    "七杀": "Семь убийц", "正财": "Прямое богатство", "偏财": "Косвенное богатство",
    "食神": "Дух пищи", "伤官": "Ранящий чиновник", "比肩": "Равное плечо", "劫财": "Грабитель богатства",
  };
  assert.deepEqual(TEN_GODS, expected);
  for (const [original, name] of Object.entries(expected)) assert.deepEqual(tenGodDisplay(original), { original, name });
});

test("основные звёзды получают только безопасную транслитерацию", () => {
  assert.deepEqual(starDisplay("紫微"), { original: "紫微", name: "Цзы Вэй" });
  assert.deepEqual(starDisplay("天府"), { original: "天府", name: "Тянь Фу" });
  assert.deepEqual(starDisplay("Неизвестная"), { original: "Неизвестная", name: "Неизвестная" });
});
