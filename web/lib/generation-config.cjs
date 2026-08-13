const { resolveFontPaths } = require("./pdf-template-v4.cjs");

function assertProductionGenerationReady(env = process.env, options = {}) {
  if (env.NODE_ENV !== "production" || env.PAYMENT_MODE !== "lorentsen") return;
  const missing = [];
  if (!String(env.OPENAI_API_KEY || "").trim()) missing.push("OPENAI_API_KEY");
  if (!String(env.OPENAI_MODEL || "").trim()) missing.push("OPENAI_MODEL");
  const mode = String(env.AI_MODE || "").trim().toLowerCase();
  if (["mock", "disabled"].includes(mode)) missing.push("AI_MODE must allow the real provider");
  if (env.HAS_FULL_REPORT === "false") missing.push("HAS_FULL_REPORT must not be false");
  const fonts = (options.resolveFontPaths || resolveFontPaths)(env);
  for (const name of ["regular", "bold", "serif", "serifBold", "cjk"]) {
    if (!fonts?.[name]) missing.push(`PDF font ${name}`);
  }
  if (missing.length) {
    const error = new Error(`Production Premium generation is not configured: ${missing.join(", ")}`);
    error.code = "PREMIUM_GENERATION_CONFIGURATION_ERROR";
    throw error;
  }
}

module.exports = { assertProductionGenerationReady };
