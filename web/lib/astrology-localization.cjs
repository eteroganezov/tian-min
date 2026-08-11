const PALACES = Object.freeze({
  "命宫": "Дворец судьбы и личности",
  "兄弟宫": "Дворец братьев, сестёр и близкого окружения",
  "夫妻宫": "Дворец партнёрства и отношений",
  "子女宫": "Дворец детей и самовыражения",
  "财帛宫": "Дворец финансов и ресурсов",
  "疾厄宫": "Дворец здоровья и уязвимостей",
  "迁移宫": "Дворец внешнего мира и перемен",
  "交友宫": "Дворец друзей, связей и окружения",
  "官禄宫": "Дворец карьеры и реализации",
  "田宅宫": "Дворец дома, имущества и основы",
  "福德宫": "Дворец внутреннего состояния и благополучия",
  "父母宫": "Дворец родителей и старших",
});

const FIVE_ELEMENTS = Object.freeze({
  "木": "Дерево", "火": "Огонь", "土": "Земля", "金": "Металл", "水": "Вода",
});

const TEN_GODS = Object.freeze({
  "正印": "Прямая печать", "偏印": "Косая печать", "正官": "Прямой чиновник",
  "七杀": "Семь убийц", "正财": "Прямое богатство", "偏财": "Косвенное богатство",
  "食神": "Дух пищи", "伤官": "Ранящий чиновника", "比肩": "Равное плечо", "劫财": "Грабитель богатства",
});

// Здесь только транслитерация. Смыслы звёзд намеренно не добавляются без независимого методологического эталона.
const MAJOR_STARS = Object.freeze({
  "紫微": "Цзы Вэй", "天机": "Тянь Цзи", "太阳": "Тай Ян", "武曲": "У Цюй",
  "天同": "Тянь Тун", "廉贞": "Лянь Чжэнь", "天府": "Тянь Фу", "太阴": "Тай Инь",
  "贪狼": "Тань Лан", "巨门": "Цзюй Мэнь", "天相": "Тянь Сян", "天梁": "Тянь Лян",
  "七杀": "Ци Ша", "破军": "По Цзюнь",
});

const STEM_ELEMENTS = Object.freeze({
  "甲": "Дерево", "乙": "Дерево", "丙": "Огонь", "丁": "Огонь", "戊": "Земля",
  "己": "Земля", "庚": "Металл", "辛": "Металл", "壬": "Вода", "癸": "Вода",
});

const STRENGTH = Object.freeze({ "身强": "Сильная карта", "身弱": "Ослабленная карта", "中和": "Сбалансированная карта" });
const CONFIDENCE = Object.freeze({ "高": "Высокая", "中": "Средняя", "低": "Низкая" });

function item(original, name) { return { original, name: name || original }; }
function palaceDisplay(original) { return item(original, PALACES[original]); }
function elementDisplay(original) { return item(original, FIVE_ELEMENTS[original]); }
function tenGodDisplay(original) { return item(original, TEN_GODS[original]); }
function starDisplay(original) { return item(original, MAJOR_STARS[original]); }
function strengthDisplay(original) { return item(original, STRENGTH[original]); }
function confidenceDisplay(original) { return item(original, CONFIDENCE[original]); }
function stemDisplay(original) { return item(original, STEM_ELEMENTS[original] ? `${STEM_ELEMENTS[original]} · небесный ствол` : undefined); }

function structureDisplay(original) {
  const base = String(original || "").endsWith("格") ? String(original).slice(0, -1) : String(original || "");
  const translated = TEN_GODS[base];
  return item(original, translated ? `Структура «${translated}»` : "Структура карты");
}

function bureauDisplay(original) {
  const element = FIVE_ELEMENTS[String(original || "")[0]];
  return item(original, element ? `Система элемента «${element}»` : "Система пяти элементов");
}

function tenGodPairDisplay(value) {
  return String(value || "").split(/\s*·\s*/).map(part => tenGodDisplay(part));
}

module.exports = {
  CONFIDENCE, FIVE_ELEMENTS, MAJOR_STARS, PALACES, STEM_ELEMENTS, STRENGTH, TEN_GODS,
  bureauDisplay, confidenceDisplay, elementDisplay, palaceDisplay, starDisplay, stemDisplay,
  strengthDisplay, structureDisplay, tenGodDisplay, tenGodPairDisplay,
};

