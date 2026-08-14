const { calculateBirthChart } = require("./birth-chart-pipeline.cjs");
const { toChartView } = require("./chart-view.cjs");
const { createReportProvider } = require("./report-provider.cjs");
const { validatePersonalReport } = require("./report-schema.cjs");
const { canonicalBirthInput, normalizeDisplayName } = require("./personalization.cjs");
const { createFingerprints, INTERPRETATION_PROMPT_VERSION, REPORT_SCHEMA_VERSION } = require("./report-fingerprint.cjs");
const { locationProvider } = require("./location-provider.cjs");
const { buildEvidenceCatalog, sanitizePersonalReport } = require("./report-content.cjs");

function buildReportContext(calculation, presentation = {}, options = {}) {
  const reportYears = options.reportYears || currentReportYears();
  const chartView = structuredClone(toChartView(calculation.chart));
  const evidenceCatalog = buildEvidenceCatalog(calculation, chartView, { reportYears });
  const context = {
    presentation: { displayName: presentation.displayName || "", birthPlace: presentation.birthPlace || null },
    interpretation: {
      promptVersion: INTERPRETATION_PROMPT_VERSION,
      schemaVersion: REPORT_SCHEMA_VERSION,
      model: options.model || "unspecified",
    },
    calculationMethod: calculation.metadata.calculationMethod,
    sensitivity: { level: calculation.metadata.calculationSensitivity, flags: calculation.metadata.sensitivityFlags },
    birth: {
      date: calculation.metadata.originalBirthDate,
      time: calculation.metadata.originalBirthTime,
      place: presentation.birthPlace?.label || calculation.metadata.birthPlace,
      trueSolarDate: calculation.metadata.trueSolarDate,
      trueSolarTime: calculation.metadata.trueSolarTime,
    },
    evidenceCatalog,
    evidenceRules: {
      interpretationMustReferenceEvidenceIds: true,
      annualMappingsAreNotEventPredictions: true,
      unsupportedClaims: ["медицинские выводы", "дата брака", "точный переезд", "обещание дохода", "гарантированный карьерный результат", "конкретное событие будущего"],
    },
    reportYears,
  };
  return deepFreeze(context);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function hasFullReport(env = process.env) {
  return env.HAS_FULL_REPORT !== "false";
}

function createPreview(report) {
  const result = {
    schemaVersion: report.schemaVersion,
    reportTitle: report.reportTitle,
    archetype: report.archetype,
    subtitle: report.subtitle,
    oneLineFormula: report.oneLineFormula,
    executivePortrait: report.executivePortrait,
    executiveInsights: report.executiveInsights.slice(0, 3),
    strengths: report.strengths.slice(0, 3),
    challenges: report.challenges.slice(0, 1),
  };
  return result;
}

async function generateReportRequest(input, options = {}) {
  let displayName;
  let calculation;
  try {
    displayName = normalizeDisplayName(input?.name);
    calculation = calculateBirthChart(canonicalBirthInput(input));
  }
  catch (error) { return { status: 400, body: { error: safeMessage(error) } }; }
  const provider = options.provider || createReportProvider(options.env || process.env);
  const onStage = typeof options.onStage === "function" ? options.onStage : () => {};
  const place = locationProvider.resolve(input.placeId);
  const model = provider.model || options.env?.OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-5.6-terra";
  const reportYears = options.reportYears || currentReportYears();
  const presentation = { displayName, birthPlace: place?.display || null };
  const context = buildReportContext(calculation, presentation, { model, reportYears });
  onStage({ stage: "evidence_ready", model, providerType: provider.providerType || "custom" });
  const fingerprints = createFingerprints({ input, calculation, displayName, model, reportYears });
  let report;
  let validation;
  let lastFailure = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const providerType = provider.providerType || "custom";
      onStage({ stage: providerType === "unavailable" ? "provider_unavailable" : "model_request_started", model, providerType, attempt: attempt + 1 });
      const requestStartedAt = Date.now();
      report = sanitizePersonalReport(await provider.generate(context, attempt ? validation.errors.slice(0, 4).join("; ") : undefined));
      onStage({ stage: "model_response_received", model, providerType: provider.providerType || "custom", attempt: attempt + 1,
        durationMs: Date.now() - requestStartedAt, requestId: provider.lastResponseMetadata?.requestId || null,
        responseStatus: provider.lastResponseMetadata?.responseStatus || null });
    } catch (error) {
      if (error && error.code === "AI_NOT_CONFIGURED") {
        if (error.reason === "LOCAL_OPENAI_OPT_IN_REQUIRED") console.warn(`[AI_CONFIGURATION] ${error.message}`);
        return { status: 200, body: { aiStatus: "unavailable", message: "Персональный разбор ещё не создан", hasFullReport: hasFullReport(options.env), presentation, ...fingerprints }, internal: { failure: safeAiFailure(error, "provider_configuration") } };
      }
      lastFailure = safeAiFailure(error);
      logAiError(error, { model, attempt: attempt + 1 });
      if (attempt === 1 || isNonRetryableAiError(error)) return { status: 502, body: { aiStatus: "error", error: "Не удалось подготовить персональный разбор. Карта остаётся доступна." }, internal: { failure: lastFailure } };
      validation = { errors: ["провайдер вернул техническую ошибку"] };
      continue;
    }
    validation = validatePersonalReport(report, { evidenceCatalog: context.evidenceCatalog });
    if (validation.valid) { onStage({ stage: "report_validated", model, attempt: attempt + 1 }); break; }
    lastFailure = { stage: "local_schema_validation", code: "INVALID_STRUCTURED_OUTPUT", type: "validation_error", httpStatus: null };
    logAiError({ aiStage: "local_schema_validation", code: "INVALID_STRUCTURED_OUTPUT", type: "validation_error" }, { model, attempt: attempt + 1 });
  }
  if (!validation || !validation.valid) return { status: 502, body: { aiStatus: "error", error: "Не удалось проверить персональный разбор. Карта остаётся доступна." }, internal: { failure: lastFailure } };
  const full = options.hasFullReport ?? hasFullReport(options.env);
  const result = {
    status: 200,
    body: {
      aiStatus: "ready", hasFullReport: full,
      report: full ? report : createPreview(report),
      model, schemaVersion: REPORT_SCHEMA_VERSION, presentation, ...fingerprints,
    },
    internal: { report, calculation, context },
  };
  if (options.reportStore) {
    try {
      options.reportStore.saveSemantic({ input: canonicalBirthInput(input), presentation, report, chartId: fingerprints.chartId, reportId: fingerprints.reportId, model, schemaVersion: REPORT_SCHEMA_VERSION });
    } catch { console.error("[REPORT_STORE_ERROR] Не удалось сохранить локальную копию отчёта."); }
  }
  return result;
}

function currentReportYears() {
  const year = new Date().getUTCFullYear();
  return [year, year + 1, year + 2];
}

function safeMessage(error) {
  const message = error instanceof Error ? error.message : "Некорректные данные рождения.";
  return message.replace(/^(Некорректные данные рождения|排盘计算失败):\s*/, "") || "Некорректные данные рождения.";
}

function isNonRetryableAiError(error) {
  const status = Number(error?.status || 0);
  const code = String(error?.code || "");
  return ["credit_balance_exhausted", "insufficient_quota", "invalid_api_key", "model_not_found"].includes(code)
    || [400, 401, 403, 404].includes(status);
}

function safeAiMessage(error) {
  const code = String(error?.code || "");
  const type = String(error?.type || "");
  if (code === "credit_balance_exhausted" || code === "insufficient_quota" || type === "insufficient_quota") return "OpenAI API credits are exhausted.";
  if (code === "invalid_api_key") return "OpenAI API key was rejected.";
  if (code === "model_not_found") return "OpenAI model is unavailable or access is denied.";
  if (code === "rate_limit_exceeded") return "OpenAI API rate limit was exceeded.";
  if (error?.aiStage === "local_schema_validation") return "OpenAI response failed local schema validation.";
  if (error?.aiStage === "responses.output_text") return "OpenAI response did not contain output text.";
  if (error?.aiStage === "responses.parse_json") return "OpenAI response was not valid JSON.";
  return "OpenAI API request failed.";
}

function logAiError(error, { model, attempt }) {
  const entry = {
    stage: error?.aiStage || "provider.generate",
    status: Number.isInteger(error?.status) ? error.status : null,
    code: error?.code || null,
    reason: error?.reason || null,
    type: error?.type || error?.name || "Error",
    message: safeAiMessage(error),
    model,
    attempt,
  };
  console.error(`[AI_ERROR] ${JSON.stringify(entry)}`);
}

function safeAiFailure(error, fallbackStage) {
  return {
    stage: fallbackStage || error?.aiStage || "provider.generate",
    httpStatus: Number.isInteger(error?.status) ? error.status : null,
    code: error?.code || null,
    type: error?.type || error?.name || "Error",
  };
}

module.exports = { buildReportContext, createPreview, currentReportYears, generateReportRequest, hasFullReport, isNonRetryableAiError, logAiError };
