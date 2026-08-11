const crypto = require("node:crypto");
const { canonicalBirthInput } = require("./personalization.cjs");

const INTERPRETATION_PROMPT_VERSION = "consumer-ru-v4";
const REPORT_SCHEMA_VERSION = "personal-report-v3";

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(prefix, value) {
  return `${prefix}_${crypto.createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 24)}`;
}

function createFingerprints({ input, calculation, displayName, model, reportYears }) {
  const canonical = {
    input: canonicalBirthInput(input),
    resolvedTime: {
      placeId: calculation.metadata.place?.id || input.placeId,
      timeZone: calculation.metadata.ianaTimeZone,
      utcOffsetMinutes: calculation.metadata.utcOffsetMinutes,
      trueSolarDate: calculation.metadata.trueSolarDate,
      trueSolarTime: calculation.metadata.trueSolarTime,
      calculationMethod: calculation.metadata.calculationMethod,
    },
    chart: calculation.chart,
  };
  const chartId = digest("tmc", canonical);
  const reportId = digest("tmr", {
    chartId, displayName, model, reportYears,
    promptVersion: INTERPRETATION_PROMPT_VERSION,
    schemaVersion: REPORT_SCHEMA_VERSION,
  });
  return { chartId, reportId };
}

module.exports = { INTERPRETATION_PROMPT_VERSION, REPORT_SCHEMA_VERSION, createFingerprints, stableStringify };
