const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { sanitizePersonalReport } = require("./report-content.cjs");

const LEGACY_SECTION_NAMES = Object.freeze({
  executive: ["Главное о вас", "Главное о вас"],
  confidence: ["Границы интерпретации", "Насколько устойчивы выводы"],
  manifestations: ["Наблюдения", "Как это проявляется в жизни"],
});

class LocalReportStore {
  constructor(options = {}) {
    this.root = options.root || path.resolve(__dirname, "..", ".local-reports");
    this.enabled = options.enabled !== false && process.env.NODE_ENV !== "production";
  }

  saveSemantic({ input, presentation, report, chartId, reportId, model, schemaVersion }) {
    return this.save({ kind: "semantic-report", schemaVersion, input, presentation, report, chartId, reportId, model });
  }

  importLegacy(payload) {
    if (!payload || !payload.input || !Array.isArray(payload.sections) || payload.sections.length < 3 || payload.sections.length > 40) throw new Error("Некорректный legacy-отчёт.");
    const sections = payload.sections.map((section, index) => normalizeLegacySection(section, index));
    return this.save({ kind: "legacy-rendered-report", schemaVersion: "legacy-dom-v1", input: payload.input, presentation: payload.presentation || {}, sections: sanitizePersonalReport(sections) });
  }

  save(envelope) {
    if (!this.enabled) return null;
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const id = envelope.reportId || `local-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const stored = { ...envelope, id, savedAt: new Date().toISOString() };
    const target = path.join(this.root, `${safeId(id)}.json`);
    writeJsonAtomic(target, stored);
    writeJsonAtomic(path.join(this.root, "latest.json"), stored);
    return { id, path: target };
  }

  load(id = "latest") {
    if (!this.enabled) return null;
    const filename = id === "latest" ? "latest.json" : `${safeId(id)}.json`;
    const target = path.join(this.root, filename);
    if (!fs.existsSync(target)) return null;
    return JSON.parse(fs.readFileSync(target, "utf8"));
  }
}

function normalizeLegacySection(section, index) {
  const key = String(section.key || `section-${index}`).slice(0, 80);
  const names = LEGACY_SECTION_NAMES[key];
  const originalLabel = String(section.label || "").trim();
  const originalTitle = String(section.title || "").trim();
  const paragraphs = cleanLegacyCollection(section.paragraphs).filter(value => !sameText(value, originalLabel) && !sameText(value, originalTitle));
  let items = cleanLegacyCollection(section.items);
  if (key === "confidence") items = groupLegacyConfidence(items);
  if (key === "manifestations") items = items.map(normalizeManifestation);
  return {
    key,
    label: String(names?.[0] || section.label || "").slice(0, 160),
    title: String(names?.[1] || section.title || "").slice(0, 240),
    paragraphs,
    items,
  };
}

function sameText(left, right) { return String(left).replace(/\u00a0/g, " ").trim() === String(right).replace(/\u00a0/g, " ").trim(); }

function groupLegacyConfidence(items) {
  const groups = { "Высокий": [], "Средний": [], "Низкий": [] };
  for (const item of items) {
    const level = Object.keys(groups).find(value => item.startsWith(`${value} `));
    if (level) groups[level].push(item.slice(level.length + 1));
  }
  return [
    ["Хорошо подтверждается картой", groups["Высокий"]],
    ["Требует дополнительного контекста", groups["Средний"]],
    ["Не стоит воспринимать буквально", groups["Низкий"]],
  ].filter(([, values]) => values.length).map(([heading, values]) => `${heading} — ${values.join("\n\n")}`);
}

function normalizeManifestation(value) {
  return value.replace(/^\d{2}\s+/u, "")
    .replace(/^Я могу /u, "Вы обычно можете ")
    .replace(/^Мои /u, "Ваши ")
    .replace(/^У меня /u, "У вас ")
    .replace(/^Я обсуждаю /u, "Вы предпочитаете обсуждать ")
    .replace(/^Мой /u, "Ваш ")
    .replace(/^Я отличаю /u, "Вы умеете отличать ")
    .replace(/^Я проверяю /u, "Вы склонны проверять ");
}

function cleanLegacyCollection(values) {
  if (!Array.isArray(values)) return [];
  return values.map(value => stripRepeatedDisclaimer(String(value)).slice(0, 20_000)).filter(Boolean);
}

function stripRepeatedDisclaimer(value) {
  return value.split(/(?<=[.!?])\s+/u).filter(sentence => !/(?:отч[её]т|карта|символические данные).*(?:не замен|предназначен)|обращайтесь к профильному специалисту|не использовать этот отч[её]т вместо|медицинск.*(?:не делается|не явля|не диагноз|не оценк)|не явля\p{L}* медицинской оценкой/iu.test(sentence)).join(" ").trim();
}

function safeId(value) {
  const id = String(value || "");
  if (!/^[a-z0-9-]{3,100}$/i.test(id)) throw new Error("Некорректный идентификатор отчёта.");
  return id;
}

function writeJsonAtomic(target, value) {
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, target);
}

module.exports = { LocalReportStore };
