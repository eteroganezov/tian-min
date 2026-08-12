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
  "正印": "Прямая печать", "偏印": "Косвенная печать", "正官": "Прямой чиновник",
  "七杀": "Семь убийц", "正财": "Прямое богатство", "偏财": "Косвенное богатство",
  "食神": "Дух пищи", "伤官": "Ранящий чиновник", "比肩": "Равное плечо", "劫财": "Грабитель богатства",
});

// Здесь только транслитерация. Смыслы звёзд намеренно не добавляются без независимого методологического эталона.
const MAJOR_STARS = Object.freeze({
  "紫微": "Цзы Вэй", "天机": "Тянь Цзи", "太阳": "Тай Ян", "武曲": "У Цюй",
  "天同": "Тянь Тун", "廉贞": "Лянь Чжэнь", "天府": "Тянь Фу", "太阴": "Тай Инь",
  "贪狼": "Тань Лан", "巨门": "Цзюй Мэнь", "天相": "Тянь Сян", "天梁": "Тянь Лян",
  "七杀": "Ци Ша", "破军": "По Цзюнь",
});

const AUXILIARY_STARS = Object.freeze({
  "禄存":"Лу Цунь", "天马":"Тянь Ма", "陀罗":"То Ло", "地空":"Ди Кун", "地劫":"Ди Цзе",
  "文昌":"Вэнь Чан", "铃星":"Лин Син", "火星":"Хо Син", "左辅":"Цзо Фу", "右弼":"Ю Би",
  "天魁":"Тянь Куй", "红鸾":"Хун Луань", "天姚":"Тянь Яо", "文曲":"Вэнь Цюй",
  "天钺":"Тянь Юэ", "擎羊":"Цин Ян", "天刑":"Тянь Син", "天喜":"Тянь Си",
});
const TRANSFORMATIONS = Object.freeze({ "化禄":"Хуа Лу", "化权":"Хуа Цюань", "化科":"Хуа Кэ", "化忌":"Хуа Цзи" });

const STEM_ELEMENTS = Object.freeze({
  "甲": "Дерево", "乙": "Дерево", "丙": "Огонь", "丁": "Огонь", "戊": "Земля",
  "己": "Земля", "庚": "Металл", "辛": "Металл", "壬": "Вода", "癸": "Вода",
});

const STEMS = Object.freeze({
  "甲": "Дерево Ян", "乙": "Дерево Инь", "丙": "Огонь Ян", "丁": "Огонь Инь", "戊": "Земля Ян",
  "己": "Земля Инь", "庚": "Металл Ян", "辛": "Металл Инь", "壬": "Вода Ян", "癸": "Вода Инь",
});

const BRANCHES = Object.freeze({
  "子": "Крыса", "丑": "Бык", "寅": "Тигр", "卯": "Кролик", "辰": "Дракон", "巳": "Змея",
  "午": "Лошадь", "未": "Коза", "申": "Обезьяна", "酉": "Петух", "戌": "Собака", "亥": "Свинья",
});

// Полный набор verdict из calculator/bazi-enrich/wang-shuai.ts.
const STRENGTH = Object.freeze({
  "极旺(可能从强)": "Очень сильная карта (возможна структура следования силе)",
  "偏旺": "Скорее сильная карта",
  "中和": "Сбалансированная карта",
  "偏弱": "Скорее ослабленная карта",
  "极弱(可能从弱)": "Очень слабая карта (возможна структура следования слабости)",
});
const CONFIDENCE = Object.freeze({ "高": "Высокая", "中": "Средняя", "低": "Низкая" });

function item(original, name) { return { original, name: name || original }; }
function palaceDisplay(original) { return item(original, PALACES[original]); }
function elementDisplay(original) { return item(original, FIVE_ELEMENTS[original]); }
function tenGodDisplay(original) { return item(original, TEN_GODS[original]); }
function starDisplay(original) { return item(original, MAJOR_STARS[original]); }
function auxiliaryStarDisplay(original) { return item(original, AUXILIARY_STARS[original]); }
function transformationDisplay(original) {
  const suffix = Object.keys(TRANSFORMATIONS).find(value => String(original).endsWith(value));
  if (!suffix) return item(original);
  const star = String(original).slice(0, -suffix.length);
  const starName = MAJOR_STARS[star] || AUXILIARY_STARS[star] || star;
  return item(original, `${starName} · ${TRANSFORMATIONS[suffix]}`);
}
function strengthDisplay(original) {
  if (Object.prototype.hasOwnProperty.call(STRENGTH, original)) return item(original, STRENGTH[original]);
  const message = `Неизвестный статус силы карты: ${String(original)}`;
  if (process.env.NODE_ENV !== "production") throw new RangeError(message);
  return item(original, "Статус требует уточнения");
}
function confidenceDisplay(original) { return item(original, CONFIDENCE[original]); }
function stemDisplay(original) { return item(original, STEMS[original] ? `${STEMS[original]} · небесный ствол` : undefined); }
function branchDisplay(original) { return item(original, BRANCHES[original] ? `${BRANCHES[original]} · земная ветвь` : undefined); }

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
  AUXILIARY_STARS, BRANCHES, CONFIDENCE, FIVE_ELEMENTS, MAJOR_STARS, PALACES, STEM_ELEMENTS, STEMS, STRENGTH, TEN_GODS, TRANSFORMATIONS,
  auxiliaryStarDisplay, branchDisplay, bureauDisplay, confidenceDisplay, elementDisplay, palaceDisplay, starDisplay, stemDisplay, transformationDisplay,
  strengthDisplay, structureDisplay, tenGodDisplay, tenGodPairDisplay,
};
