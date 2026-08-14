const PROVIDER_STATUSES = Object.freeze([
  "preparing", "processing", "requires_action", "succeeded_pending", "settled",
  "manual_review", "failed", "expired", "provider_result_unknown",
]);
const TERMINAL_STATUSES = new Set(["failed", "expired"]);
const PARTNER_PUBLIC_NAME = "Тянь Мин";

class LorentsenPaymentProvider {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.fetch = options.fetch || globalThis.fetch;
    this.logger = options.logger || console;
    this.config = resolveLorentsenConfig(this.env);
    this.name = "lorentsen";
  }

  async createPayment(attempt) {
    return this.request("POST", "/api/v1/integration/payments", {
      body: attempt.requestBody,
      idempotencyKey: attempt.idempotencyKey,
      acceptedStatuses: [200, 201],
    });
  }

  async getPaymentStatus(paymentPublicId) {
    if (!isProviderId(paymentPublicId)) throw providerError("Некорректный payment_public_id.", 400, false, "INVALID_PAYMENT_ID");
    return this.request("GET", `/api/v1/integration/payments/${encodeURIComponent(paymentPublicId)}`, { acceptedStatuses: [200] });
  }

  async request(method, pathname, options = {}) {
    const url = new URL(pathname, this.config.apiBaseUrl);
    assertProviderUrl(url, this.config.apiBaseUrl);
    const headers = { Authorization: `Bearer ${this.config.apiToken}`, Accept: "application/json" };
    let body;
    if (options.body) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
    let response;
    try {
      response = await this.fetch(url, { method, headers, body, redirect: "error", signal: AbortSignal.timeout(this.config.requestTimeoutMs) });
    } catch (error) {
      throw providerError(error?.name === "TimeoutError" ? "Lorentsen не ответил вовремя." : "Не удалось связаться с Lorentsen.", 503, true, error?.name === "TimeoutError" ? "PROVIDER_TIMEOUT" : "PROVIDER_NETWORK_ERROR");
    }
    const retryAfterSeconds = parseRetryAfter(response.headers?.get?.("retry-after"));
    const payload = await readSafeJson(response);
    this.logger.info?.("[PAYMENT_PROVIDER_RESPONSE]", JSON.stringify({
      timestamp: new Date().toISOString(),
      stage: method === "POST" ? "create_payment" : "get_payment",
      httpStatus: response.status,
      ...describePaymentResponse(payload),
      responseShape: describePaymentPayload(payload),
    }));
    if (!options.acceptedStatuses.includes(response.status)) {
      const retryable = response.status === 429 || response.status >= 500;
      const code = response.status === 409 ? "IDEMPOTENCY_CONFLICT" : response.status === 422 ? "PROVIDER_VALIDATION_ERROR" : response.status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_HTTP_ERROR";
      const error = providerError(safeProviderMessage(response.status), response.status, retryable, code);
      error.retryAfterSeconds = retryAfterSeconds;
      error.traceId = safeString(payload?.trace_id, 160);
      error.providerDetails = safeProviderErrorDetails(payload);
      throw error;
    }
    return normalizePayment(payload, response.status, retryAfterSeconds);
  }
}

function resolveLorentsenConfig(env = process.env) {
  const apiBaseUrl = env.LORENTSEN_API_BASE_URL || "https://api.lorentsen.pro";
  assertProviderUrl(new URL(apiBaseUrl), apiBaseUrl);
  const required = {
    apiToken: "LORENTSEN_API_TOKEN",
    webhookEndpointId: "LORENTSEN_WEBHOOK_ENDPOINT_ID",
    webhookSecret: "LORENTSEN_WEBHOOK_SECRET",
    webhookSigningKeyVersion: "LORENTSEN_WEBHOOK_SIGNING_KEY_VERSION",
    publicBaseUrl: "PUBLIC_BASE_URL",
    termsUrl: "LORENTSEN_TERMS_URL",
    privacyUrl: "LORENTSEN_PRIVACY_URL",
    autoRedemptionTermsUrl: "LORENTSEN_AUTO_REDEMPTION_TERMS_URL",
  };
  const values = {};
  const missing = [];
  for (const [key, name] of Object.entries(required)) {
    const value = String(env[name] || "").trim();
    if (!value) missing.push(name);
    values[key] = value;
  }
  if (!String(env.DATABASE_URL || "").trim()) missing.push("DATABASE_URL");
  if (missing.length) throw configurationError(`Для PAYMENT_MODE=lorentsen не настроены: ${missing.join(", ")}.`);
  for (const [name, value] of [["PUBLIC_BASE_URL", values.publicBaseUrl], ["LORENTSEN_TERMS_URL", values.termsUrl], ["LORENTSEN_PRIVACY_URL", values.privacyUrl], ["LORENTSEN_AUTO_REDEMPTION_TERMS_URL", values.autoRedemptionTermsUrl]]) assertHttpsUrl(value, name);
  return Object.freeze({
    apiBaseUrl: new URL(apiBaseUrl).toString(),
    ...values,
    partnerPublicName: PARTNER_PUBLIC_NAME,
    consentVersion: env.LORENTSEN_CONSENT_VERSION || "certificate_purchase_terms_v1",
    autoRedemptionConsentVersion: env.LORENTSEN_AUTO_REDEMPTION_CONSENT_VERSION || "partner_auto_redemption_consent_v1",
    requestTimeoutMs: positiveInteger(env.LORENTSEN_REQUEST_TIMEOUT_MS, 10_000),
  });
}

function normalizePayment(payload, httpStatus, headerRetryAfter) {
  if (!payload || typeof payload !== "object") throw providerError("Lorentsen вернул некорректный JSON.", 502, true, "INVALID_PROVIDER_RESPONSE");
  const payment = findPaymentRecord(payload);
  const statusValue = payment?.payment_status ?? payment?.status;
  const settlement = normalizeSettlementProof(payment);
  const normalizedStatus = PROVIDER_STATUSES.includes(statusValue) ? statusValue : "provider_result_unknown";
  const status = normalizedStatus === "settled" || settlement.confirmed ? "settled" : normalizedStatus;
  const paymentPublicId = safeString(payment?.payment_public_id, 200);
  const externalOrderId = safeString(payment?.external_order_id, 200);
  if (!paymentPublicId) throw providerError("Lorentsen не вернул payment_public_id.", 502, true, "INVALID_PROVIDER_RESPONSE");
  if (!externalOrderId) throw providerError("Lorentsen не вернул external_order_id.", 502, true, "INVALID_PROVIDER_RESPONSE");
  return {
    paymentId: paymentPublicId,
    paymentPublicId,
    externalOrderId,
    status,
    providerPaymentStatus: normalizedStatus,
    settlement,
    paymentMethod: normalizePaymentMethod(payment.payment_method),
    retryAfterSeconds: positiveInteger(payment.retry_after_seconds ?? payload.retry_after_seconds, headerRetryAfter || 5),
    traceId: safeString(payment.trace_id, 160) || safeString(payload.trace_id, 160),
    httpStatus,
  };
}

function findPaymentRecord(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const queue = [{ value: payload, depth: 0 }];
  const matches = [];
  while (queue.length) {
    const { value, depth } = queue.shift();
    if (Object.hasOwn(value, "payment_public_id")) matches.push(value);
    if (depth >= 3) continue;
    for (const child of Object.values(value)) {
      if (child && typeof child === "object" && !Array.isArray(child)) queue.push({ value: child, depth: depth + 1 });
    }
  }
  if (matches.length !== 1) return null;
  return matches[0];
}

function describePaymentPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { kind: "invalid" };
  const fields = [];
  const queue = [{ value: payload, path: "$", depth: 0 }];
  while (queue.length && fields.length < 80) {
    const { value, path, depth } = queue.shift();
    for (const [key, child] of Object.entries(value)) {
      if (!/^[A-Za-z0-9_.-]{1,120}$/.test(key)) continue;
      const childPath = `${path}.${key}`;
      fields.push(childPath);
      if (depth < 2 && child && typeof child === "object" && !Array.isArray(child)) queue.push({ value: child, path: childPath, depth: depth + 1 });
    }
  }
  return { kind: "object", fields };
}

function describePaymentResponse(payload) {
  const payment = findPaymentRecord(payload);
  const method = payment?.payment_method && typeof payment.payment_method === "object" && !Array.isArray(payment.payment_method)
    ? payment.payment_method
    : null;
  return {
    paymentPublicId: safeLogIdentifier(payment?.payment_public_id),
    externalOrderId: safeLogIdentifier(payment?.external_order_id),
    paymentStatus: safeDiagnosticToken(payment?.payment_status ?? payment?.status),
    settlementStatus: safeDiagnosticToken(payment?.settlement_status),
    certificateStatus: safeDiagnosticToken(payment?.certificate?.status),
    redemptionStatus: safeDiagnosticToken(payment?.certificate?.redemption_status),
    hasRedeemedAt: validDate(payment?.certificate?.redeemed_at),
    settlementConfirmed: normalizeSettlementProof(payment).confirmed,
    hasPaymentMethod: Boolean(method),
    hasPaymentLink: Boolean(method && typeof method.link === "string" && method.link.trim()),
    hasPaymentImage: Boolean(method && typeof method.image === "string" && method.image.trim()),
    hasPaymentMethodExpiry: Boolean(method && typeof method.expires_at === "string" && method.expires_at.trim()),
    topLevelFields: safeFieldNames(payload),
    dataFields: safeFieldNames(payload?.data),
    requestId: safeLogIdentifier(payload?.request_id ?? payload?.meta?.request_id),
    traceId: safeLogIdentifier(payment?.trace_id ?? payload?.trace_id ?? payload?.meta?.trace_id),
  };
}

function normalizeSettlementProof(payment) {
  const paymentStatus = safeDiagnosticToken(payment?.payment_status ?? payment?.status)?.toLowerCase() || null;
  const settlementStatus = safeDiagnosticToken(payment?.settlement_status)?.toLowerCase() || null;
  const certificateStatus = safeDiagnosticToken(payment?.certificate?.status)?.toLowerCase() || null;
  const redemptionStatus = safeDiagnosticToken(payment?.certificate?.redemption_status)?.toLowerCase() || null;
  const redeemedAt = validDate(payment?.certificate?.redeemed_at) ? new Date(payment.certificate.redeemed_at).toISOString() : null;
  const settlementConfirmed = new Set(["settled", "completed", "credited"]).has(settlementStatus);
  const redemptionConfirmed = certificateStatus === "redeemed" && redemptionStatus === "redeemed" && Boolean(redeemedAt);
  const customerPaymentSucceeded = new Set(["succeeded_pending", "settled"]).has(paymentStatus);
  return {
    confirmed: redemptionConfirmed && (settlementConfirmed || customerPaymentSucceeded),
    settlementStatus,
    certificateStatus,
    redemptionStatus,
    redeemedAt,
  };
}

function normalizePaymentMethod(value) {
  if (value == null) return null;
  if (typeof value !== "object") return null;
  const link = safeExternalUrl(value.link);
  const image = safeImageUrl(value.image);
  const expiresAt = validDate(value.expires_at) ? new Date(value.expires_at).toISOString() : null;
  return link || image ? { link, image, expiresAt } : null;
}

function assertProviderUrl(url, configuredBase) {
  const base = new URL(configuredBase);
  if (url.protocol !== "https:" || base.protocol !== "https:" || base.hostname !== "api.lorentsen.pro" || url.hostname !== base.hostname || url.username || url.password) {
    throw configurationError("LORENTSEN_API_BASE_URL должен указывать на https://api.lorentsen.pro.");
  }
}
function assertHttpsUrl(value, name) { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password) throw configurationError(`${name} должен быть публичным HTTPS URL.`); }
function safeExternalUrl(value) { try { const url = new URL(String(value || "")); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null; } catch { return null; } }
function safeImageUrl(value) { const string = String(value || ""); return /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(string) ? string : safeExternalUrl(string); }
function validDate(value) { return Number.isFinite(Date.parse(String(value || ""))); }
function isProviderId(value) { return typeof value === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(value); }
function safeString(value, limit) { return typeof value === "string" ? value.slice(0, limit) : null; }
function positiveInteger(value, fallback) { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback; }
function parseRetryAfter(value) { const seconds = Number(value); if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds); const date = Date.parse(String(value || "")); return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : null; }
async function readSafeJson(response) {
  const limit = 512 * 1024;
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw providerError("Lorentsen вернул слишком большой ответ.", 502, true, "PROVIDER_RESPONSE_TOO_LARGE");
  try {
    if (!response.body?.getReader) {
      const text = await response.text();
      if (Buffer.byteLength(text) > limit) throw providerError("Lorentsen вернул слишком большой ответ.", 502, true, "PROVIDER_RESPONSE_TOO_LARGE");
      return JSON.parse(text);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw providerError("Lorentsen вернул слишком большой ответ.", 502, true, "PROVIDER_RESPONSE_TOO_LARGE"); }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error?.code === "PROVIDER_RESPONSE_TOO_LARGE") throw error;
    return null;
  }
}
function safeProviderMessage(status) { if (status === 409) return "Lorentsen отклонил изменённый idempotent request."; if (status === 422) return "Lorentsen отклонил параметры платежа."; if (status === 429) return "Lorentsen временно ограничил частоту запросов."; return "Lorentsen временно не обработал запрос."; }
function safeProviderErrorDetails(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const error = payload.error && typeof payload.error === "object" ? payload.error : payload;
  const providerCode = safeDiagnosticToken(error.code || payload.code);
  const providerType = safeDiagnosticToken(error.type || payload.type);
  const providerMessage = safeDiagnosticText(error.message || error.detail || payload.message || payload.detail);
  const fields = [...new Set([
    ...collectDiagnosticFields(error),
    ...(error !== payload ? collectDiagnosticFields(payload) : []),
  ])].slice(0, 20);
  return providerCode || providerType || providerMessage || fields.length ? { providerCode, providerType, providerMessage, fields } : null;
}
function collectDiagnosticFields(value) {
  if (!value || typeof value !== "object") return [];
  const candidates = [];
  for (const key of ["field", "param", "path"]) if (typeof value[key] === "string") candidates.push(value[key]);
  for (const key of ["errors", "details", "violations"]) {
    const items = Array.isArray(value[key]) ? value[key] : [];
    for (const item of items) if (item && typeof item === "object") {
      for (const name of ["field", "param", "path"]) if (typeof item[name] === "string") candidates.push(item[name]);
    }
  }
  return candidates.map(safeDiagnosticField).filter(Boolean);
}
function safeDiagnosticToken(value) { const string = String(value || "").trim(); return /^[A-Za-z0-9_.:-]{1,120}$/.test(string) ? string : null; }
function safeLogIdentifier(value) { const string = String(value || "").trim(); return /^[A-Za-z0-9_.:-]{1,200}$/.test(string) ? string : null; }
function safeFieldNames(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).filter(key => /^[A-Za-z0-9_.-]{1,120}$/.test(key)).slice(0, 80);
}
function safeDiagnosticField(value) { const string = String(value || "").trim(); return /^[A-Za-z0-9_.\[\]-]{1,160}$/.test(string) ? string : null; }
function safeDiagnosticText(value) {
  if (typeof value !== "string") return null;
  const string = value.replace(/[\r\n\t]+/g, " ").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]").replace(/\bBearer\s+\S+/gi, "Bearer [redacted]").trim();
  return string ? string.slice(0, 240) : null;
}
function providerError(message, status, retryable, code) { const error = new Error(message); error.status = status; error.retryable = retryable; error.code = code; return error; }
function configurationError(message) { const error = new Error(message); error.code = "PAYMENT_CONFIGURATION_ERROR"; return error; }

module.exports = { LorentsenPaymentProvider, PARTNER_PUBLIC_NAME, PROVIDER_STATUSES, TERMINAL_STATUSES, describePaymentPayload, describePaymentResponse, normalizePayment, parseRetryAfter, resolveLorentsenConfig, safeProviderErrorDetails };
