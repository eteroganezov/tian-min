const confidenceLevels = ["Высокий", "Средний", "Низкий"];

const string = { type: "string" };
const integer = { type: "integer" };
const strings = (minItems, maxItems = minItems) => ({ type: "array", items: string, minItems, maxItems });
const array = (items, minItems, maxItems = minItems) => ({ type: "array", items, minItems, maxItems });
const object = properties => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });

const keyTrait = object({ title: string, explanation: string, positive: string, shadow: string, evidence: strings(1, 4) });
const strength = object({ title: string, essence: string, manifestation: string, usefulWhere: string, practicalUse: string });
const challenge = object({ pattern: string, trigger: string, consequence: string, compensation: string });
const yearly = object({ year: integer, theme: string, opportunities: string, risks: string, focus: string, avoid: string });
const transition = object({ age: string, period: string, theme: string, change: string });
const scenario = object({ type: { type: "string", enum: ["Консервативный", "Рост", "Перегруз"] }, title: string, description: string, decisions: string });
const matrixRow = object({ area: string, bazi: string, ziwei: string, alignment: { type: "string", enum: ["Согласие", "Дополнение", "Расхождение"] }, synthesis: string });
const confidence = object({ conclusion: string, level: { type: "string", enum: confidenceLevels }, reason: string });

const REPORT_JSON_SCHEMA = object({
  archetype: string,
  subtitle: string,
  oneLineFormula: string,
  executiveSummary: string,
  personality: string,
  keyTraits: array(keyTrait, 5, 5),
  strengths: array(strength, 5, 7),
  challenges: array(challenge, 5, 7),
  externalVsInternal: object({ external: string, internal: string, synthesis: string }),
  stressPattern: object({ reaction: string, mistakes: string, decisions: string, recovery: string, avoid: string }),
  career: string,
  money: string,
  relationships: string,
  environment: object({ supports: string, drains: string, allies: string, toxicPatterns: string, communication: string }),
  leadership: object({ style: string, control: string, authority: string, conflict: string, negotiation: string, mistakes: string }),
  lifestyle: object({ rhythm: string, intensity: string, stabilityVsChange: string, rest: string, overload: string, recovery: string, environment: string }),
  currentPeriod: object({ period: string, theme: string, opportunities: string, risks: string, career: string, relationships: string, money: string, lesson: string }),
  yearlyOutlook: array(yearly, 3, 3),
  keyLifeTransitions: array(transition, 5, 5),
  scenarios: array(scenario, 3, 3),
  lifeAreaMatrix: array(matrixRow, 8, 8),
  crossValidation: object({ agreements: strings(1, 8), divergences: strings(1, 8), stableConclusions: strings(1, 8), weakerConclusions: strings(1, 8) }),
  confidence: array(confidence, 3, 12),
  actionPlan: object({ doMore: strings(5, 5), avoid: strings(5, 5), next12Months: strings(3, 3), questions: strings(3, 3) }),
  selfCheck: strings(5, 7),
  finalSummary: string,
});

function validatePersonalReport(report) {
  const errors = [];
  validateNode(REPORT_JSON_SCHEMA, report, "$", errors);
  return { valid: errors.length === 0, errors };
}

function validateNode(schema, value, path, errors) {
  if (schema.type === "string") {
    if (typeof value !== "string" || !value.trim()) errors.push(`${path}: ожидается непустой текст`);
    else if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: недопустимое значение`);
    return;
  }
  if (schema.type === "integer") {
    if (!Number.isInteger(value)) errors.push(`${path}: ожидается целое число`);
    return;
  }
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

module.exports = { REPORT_JSON_SCHEMA, validatePersonalReport };
