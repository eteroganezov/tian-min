const REPORT_SCHEMA_VERSION = "personal-report-v4";
const LEGACY_REPORT_SCHEMA_VERSION = "personal-report-v3";

const string = { type: "string" };
const integer = { type: "integer" };
const evidenceId = { type: "string", pattern: "^(?:bazi|ziwei|time)\\.[a-z0-9_.-]+$" };
const strings = (minItems, maxItems = minItems) => ({ type: "array", items: string, minItems, maxItems });
const evidence = (minItems = 1, maxItems = 8) => ({ type: "array", items: evidenceId, minItems, maxItems });
const array = (items, minItems, maxItems = minItems) => ({ type: "array", items, minItems, maxItems });
const object = properties => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });

const executiveInsight = object({ id: string, title: string, conclusion: string, evidence: evidence(1, 6), practicalApplication: string });
const keyTrait = object({ title: string, explanation: string, positive: string, shadow: string, evidence: evidence(1, 6) });
const strength = object({ title: string, essence: string, manifestation: string, usefulWhere: string, practicalUse: string, evidence: evidence(1, 6) });
const challenge = object({ pattern: string, trigger: string, consequence: string, compensation: string, evidence: evidence(1, 6) });
const yearly = object({ year: integer, theme: string, opportunities: string, risks: string, focus: string, avoid: string, evidence: evidence(1, 6), confidenceNote: string });
const transition = object({ age: string, period: string, theme: string, change: string, evidence: evidence(1, 6) });
const scenario = object({ type: { type: "string", enum: ["Консервативный", "Рост", "Перегруз"] }, title: string, description: string, decisions: string, evidence: evidence(1, 6) });
const matrixRow = object({
  area: string,
  bazi: string,
  ziwei: string,
  alignment: { type: "string", enum: ["Согласие", "Дополнение", "Расхождение"] },
  synthesis: string,
  baziEvidence: evidence(1, 5),
  ziweiEvidence: evidence(1, 5),
});
const insight = object({ heading: string, text: string, practicalApplication: string, evidence: evidence(1, 6) });
const editorialSection = object({
  title: string,
  headline: string,
  summary: string,
  insights: array(insight, 3, 4),
  strengths: strings(1, 4),
  risks: strings(1, 3),
  actions: strings(2, 4),
  evidence: evidence(2, 10),
  confidenceNote: string,
});
const evidenceConclusion = object({ conclusion: string, evidence: evidence(1, 8) });

const REPORT_JSON_SCHEMA = object({
  schemaVersion: { type: "string", enum: [REPORT_SCHEMA_VERSION] },
  reportTitle: string,
  archetype: string,
  subtitle: string,
  oneLineFormula: string,
  executivePortrait: object({ headline: string, summary: string, primaryResource: string, decisionStyle: string, innerTension: string, currentFocus: string, synthesis: string, evidence: evidence(2, 8) }),
  executiveInsights: array(executiveInsight, 5, 7),
  readingGuide: object({ calculatedFacts: string, interpretation: string, practicalApplication: string, accuracy: string, sensitiveTopics: string }),
  personality: editorialSection,
  keyTraits: array(keyTrait, 5, 5),
  strengths: array(strength, 5, 7),
  challenges: array(challenge, 5, 7),
  externalVsInternal: object({ external: string, internal: string, synthesis: string, evidence: evidence(2, 8) }),
  stressPattern: object({ reaction: string, mistakes: string, decisions: string, recovery: string, avoid: string, evidence: evidence(2, 8) }),
  career: editorialSection,
  money: editorialSection,
  relationships: editorialSection,
  environment: object({ supports: string, drains: string, allies: string, toxicPatterns: string, communication: string, evidence: evidence(2, 8) }),
  leadership: object({ style: string, control: string, authority: string, conflict: string, negotiation: string, mistakes: string, evidence: evidence(2, 8) }),
  lifestyle: object({ rhythm: string, intensity: string, stabilityVsChange: string, rest: string, overload: string, recovery: string, environment: string, evidence: evidence(2, 8) }),
  currentPeriod: object({ period: string, headline: string, summary: string, opportunities: strings(2, 4), risks: strings(1, 3), actions: strings(2, 4), evidence: evidence(2, 10), confidenceNote: string }),
  yearlyOutlook: array(yearly, 3, 3),
  keyLifeTransitions: array(transition, 5, 5),
  scenarios: array(scenario, 3, 3),
  lifeAreaMatrix: array(matrixRow, 8, 8),
  crossValidation: object({
    agreements: array(evidenceConclusion, 1, 6),
    divergences: array(evidenceConclusion, 1, 6),
    stableConclusions: array(evidenceConclusion, 1, 6),
    weakerConclusions: array(evidenceConclusion, 1, 6),
  }),
  conclusionStability: object({ wellSupported: strings(2, 5), needsContext: strings(1, 4), notLiteral: strings(3, 6), evidence: evidence(2, 10) }),
  actionPlan: object({ doMore: strings(5, 5), avoid: strings(5, 5), next12Months: strings(3, 3), questions: strings(3, 3), sourceInsightIds: strings(3, 7), evidence: evidence(2, 10) }),
  lifeManifestations: strings(5, 7),
  lifeManifestationEvidence: evidence(2, 10),
  finalSummary: object({ headline: string, summary: string, priorities: strings(3, 5), evidence: evidence(2, 8) }),
});

// Explicit compatibility contract for semantic reports saved before v4.
const legacyKeyTrait = object({ title: string, explanation: string, positive: string, shadow: string, evidence: strings(1, 4) });
const legacyStrength = object({ title: string, essence: string, manifestation: string, usefulWhere: string, practicalUse: string });
const legacyChallenge = object({ pattern: string, trigger: string, consequence: string, compensation: string });
const legacyYearly = object({ year: integer, theme: string, opportunities: string, risks: string, focus: string, avoid: string });
const legacyTransition = object({ age: string, period: string, theme: string, change: string });
const legacyScenario = object({ type: { type: "string", enum: ["Консервативный", "Рост", "Перегруз"] }, title: string, description: string, decisions: string });
const legacyMatrixRow = object({ area: string, bazi: string, ziwei: string, alignment: { type: "string", enum: ["Согласие", "Дополнение", "Расхождение"] }, synthesis: string });
const legacyInsight = object({ heading: string, text: string });
const legacyEditorial = object({ title: string, headline: string, summary: string, insights: array(legacyInsight, 3, 4), strengths: strings(1, 4), risks: strings(1, 3), actions: strings(2, 4), evidence: strings(0, 6), confidenceNote: string });
const LEGACY_REPORT_JSON_SCHEMA_V3 = object({
  archetype: string, subtitle: string, oneLineFormula: string,
  executivePortrait: object({ headline: string, summary: string, primaryResource: string, decisionStyle: string, innerTension: string, currentFocus: string, synthesis: string }),
  personality: legacyEditorial, keyTraits: array(legacyKeyTrait, 5, 5), strengths: array(legacyStrength, 5, 7), challenges: array(legacyChallenge, 5, 7),
  externalVsInternal: object({ external: string, internal: string, synthesis: string }),
  stressPattern: object({ reaction: string, mistakes: string, decisions: string, recovery: string, avoid: string }),
  career: legacyEditorial, money: legacyEditorial, relationships: legacyEditorial,
  environment: object({ supports: string, drains: string, allies: string, toxicPatterns: string, communication: string }),
  leadership: object({ style: string, control: string, authority: string, conflict: string, negotiation: string, mistakes: string }),
  lifestyle: object({ rhythm: string, intensity: string, stabilityVsChange: string, rest: string, overload: string, recovery: string, environment: string }),
  currentPeriod: object({ period: string, headline: string, summary: string, opportunities: strings(2, 4), risks: strings(1, 3), actions: strings(2, 4), evidence: strings(0, 6), confidenceNote: string }),
  yearlyOutlook: array(legacyYearly, 3, 3), keyLifeTransitions: array(legacyTransition, 5, 5), scenarios: array(legacyScenario, 3, 3), lifeAreaMatrix: array(legacyMatrixRow, 8, 8),
  crossValidation: object({ agreements: strings(1, 8), divergences: strings(1, 8), stableConclusions: strings(1, 8), weakerConclusions: strings(1, 8) }),
  conclusionStability: object({ wellSupported: strings(2, 5), needsContext: strings(1, 4), notLiteral: strings(3, 6) }),
  actionPlan: object({ doMore: strings(5, 5), avoid: strings(5, 5), next12Months: strings(3, 3), questions: strings(3, 3) }),
  lifeManifestations: strings(5, 7), finalSummary: object({ headline: string, summary: string, priorities: strings(3, 5) }),
});

function validatePersonalReport(report, options = {}) {
  const schemaVersion = report?.schemaVersion || LEGACY_REPORT_SCHEMA_VERSION;
  const schema = schemaVersion === REPORT_SCHEMA_VERSION ? REPORT_JSON_SCHEMA
    : schemaVersion === LEGACY_REPORT_SCHEMA_VERSION && !report?.schemaVersion ? LEGACY_REPORT_JSON_SCHEMA_V3
      : null;
  const errors = [];
  if (!schema) errors.push(`$.schemaVersion: неподдерживаемая версия ${String(schemaVersion)}`);
  else validateNode(schema, report, "$", errors);
  if (errors.length === 0 && schemaVersion === REPORT_SCHEMA_VERSION) {
    errors.push(...validateEvidenceReferences(report, options.evidenceCatalog));
    errors.push(...validateInsightReferences(report));
    errors.push(...validateForbiddenPredictiveFields(report));
  }
  return { valid: errors.length === 0, errors, schemaVersion, legacy: schemaVersion === LEGACY_REPORT_SCHEMA_VERSION };
}

function validateEvidenceReferences(report, evidenceCatalog) {
  if (!evidenceCatalog) return [];
  const items = Array.isArray(evidenceCatalog) ? evidenceCatalog : evidenceCatalog.items;
  if (!Array.isArray(items)) return ["$evidenceCatalog: ожидается versioned список evidence items"];
  const ids = new Set();
  const errors = [];
  for (const item of items) {
    if (!item?.id || ids.has(item.id)) errors.push(`$evidenceCatalog: повторный или пустой evidence ID ${String(item?.id || "")}`);
    else ids.add(item.id);
  }
  visitEvidence(report, "$", (id, path, key) => {
    if (!ids.has(id)) errors.push(`${path}: evidence ID ${id} отсутствует в каталоге`);
    if (key === "baziEvidence" && !id.startsWith("bazi.")) errors.push(`${path}: ожидается evidence Ба-цзы`);
    if (key === "ziweiEvidence" && !id.startsWith("ziwei.")) errors.push(`${path}: ожидается evidence Цзы Вэй`);
  });
  return errors;
}

function visitEvidence(value, path, callback) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if ((key === "evidence" || key.endsWith("Evidence")) && Array.isArray(child)) child.forEach((id, index) => callback(id, `${childPath}[${index}]`, key));
    else visitEvidence(child, childPath, callback);
  }
}

function validateInsightReferences(report) {
  const insightIds = new Set();
  const errors = [];
  for (const insight of report.executiveInsights || []) {
    if (!/^insight-[a-z0-9-]+$/.test(insight.id)) errors.push(`$.executiveInsights: некорректный insight ID ${insight.id}`);
    else if (insightIds.has(insight.id)) errors.push(`$.executiveInsights: повторный insight ID ${insight.id}`);
    insightIds.add(insight.id);
  }
  for (const [index, id] of (report.actionPlan?.sourceInsightIds || []).entries()) if (!insightIds.has(id)) errors.push(`$.actionPlan.sourceInsightIds[${index}]: insight ID ${id} отсутствует`);
  return errors;
}

function validateForbiddenPredictiveFields(report) {
  const forbidden = new Set(["event", "events", "probability", "guaranteedOutcome", "marriageDate", "relocationDate", "incomeForecast", "healthPrediction"]);
  const errors = [];
  visitKeys(report, "$", (key, path) => { if (forbidden.has(key)) errors.push(`${path}: неподдерживаемое predictive поле`); });
  return errors;
}

function visitKeys(value, path, callback) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) { callback(key, `${path}.${key}`); visitKeys(child, `${path}.${key}`, callback); }
}

function validateNode(schema, value, path, errors) {
  if (schema.type === "string") {
    if (typeof value !== "string" || !value.trim()) errors.push(`${path}: ожидается непустой текст`);
    else if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: недопустимое значение`);
    else if (schema.pattern && !(new RegExp(schema.pattern).test(value))) errors.push(`${path}: неверный формат`);
    else if (schema !== evidenceId && hasBrokenPlaceholder(value)) errors.push(`${path}: обнаружен незаполненный шаблон`);
    else if (schema !== evidenceId && hasEnglishSystemTerm(value)) errors.push(`${path}: название системы должно быть по-русски`);
    return;
  }
  if (schema.type === "integer") { if (!Number.isInteger(value)) errors.push(`${path}: ожидается целое число`); return; }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return errors.push(`${path}: ожидается список`);
    if (value.length < schema.minItems || value.length > schema.maxItems) errors.push(`${path}: неверное количество элементов`);
    value.forEach((item, index) => validateNode(schema.items, item, `${path}[${index}]`, errors));
    return;
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return errors.push(`${path}: ожидается объект`);
    for (const key of schema.required) if (!(key in value)) errors.push(`${path}.${key}: поле отсутствует`);
    for (const [key, child] of Object.entries(schema.properties)) if (key in value) validateNode(child, value[key], `${path}.${key}`, errors);
    for (const key of Object.keys(value)) if (!schema.properties[key]) errors.push(`${path}.${key}: неизвестное поле`);
  }
}

function hasEnglishSystemTerm(value) { return /\b(?:BaZi|Bazi|Zi\s*Wei(?:\s*Dou\s*Shu)?|ZiWei)\b/i.test(String(value)); }
function hasBrokenPlaceholder(value) {
  const text = String(value).trim();
  return /^(?:-|–|—|undefined|null|nan)$/i.test(text)
    || /(?:столкновени\p{L}*|сочетани\p{L}*|соединени\p{L}*|вред\p{L}*)\s*[-–—](?=[\s.,;]|$)/iu.test(text)
    || /\b(?:undefined|null|nan)\b/i.test(text);
}

module.exports = {
  LEGACY_REPORT_JSON_SCHEMA_V3, LEGACY_REPORT_SCHEMA_VERSION, REPORT_JSON_SCHEMA, REPORT_SCHEMA_VERSION,
  hasBrokenPlaceholder, hasEnglishSystemTerm, validateEvidenceReferences, validatePersonalReport,
};
