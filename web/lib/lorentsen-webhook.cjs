const crypto = require("node:crypto");

const WEBHOOK_EVENTS = new Set(["payment.succeeded", "payment.settled"]);

function verifyLorentsenWebhook({ rawBody, headers, secret, signingKeyVersion, now = Date.now() }) {
  if (!Buffer.isBuffer(rawBody)) throw webhookError(400, "WEBHOOK_BODY_REQUIRED", "Некорректное тело webhook.");
  const eventId = header(headers, "x-lorensten-event-id");
  const timestamp = header(headers, "x-lorensten-timestamp");
  const signature = header(headers, "x-lorensten-signature");
  const keyVersion = header(headers, "x-lorensten-signing-key-version");
  if (!eventId || !timestamp || !signature || !keyVersion) throw webhookError(400, "WEBHOOK_HEADERS_REQUIRED", "Отсутствуют обязательные webhook headers.");
  if (keyVersion !== signingKeyVersion) throw webhookError(401, "WEBHOOK_KEY_VERSION_MISMATCH", "Неизвестная версия signing key.");
  const expected = `v1=${crypto.createHmac("sha256", secret).update(rawBody).digest("base64")}`;
  if (!safeEqual(signature, expected)) throw webhookError(401, "WEBHOOK_SIGNATURE_INVALID", "Webhook signature не подтверждена.");
  let event;
  try { event = JSON.parse(rawBody.toString("utf8")); } catch { throw webhookError(400, "WEBHOOK_JSON_INVALID", "Webhook содержит некорректный JSON."); }
  if (!event || typeof event !== "object" || !WEBHOOK_EVENTS.has(event.type)) throw webhookError(422, "WEBHOOK_EVENT_UNSUPPORTED", "Webhook event не поддерживается.");
  if (String(event.id || "") !== eventId) throw webhookError(400, "WEBHOOK_EVENT_ID_MISMATCH", "Event ID не совпадает с header.");
  const headerTime = parseTimestamp(timestamp);
  const eventTime = Date.parse(String(event.created_at || ""));
  if (!Number.isFinite(headerTime) || !Number.isFinite(eventTime) || Math.abs(headerTime - eventTime) > 1_000) throw webhookError(400, "WEBHOOK_TIMESTAMP_MISMATCH", "Webhook timestamp не совпадает с event.created_at.");
  if (headerTime - now > 300_000) throw webhookError(400, "WEBHOOK_TIMESTAMP_FUTURE", "Webhook timestamp находится слишком далеко в будущем.");
  const paymentPublicId = findPaymentPublicId(event);
  if (!paymentPublicId) throw webhookError(422, "WEBHOOK_PAYMENT_ID_REQUIRED", "Webhook не содержит payment_public_id.");
  return {
    event,
    eventId,
    eventType: event.type,
    paymentPublicId,
    createdAt: new Date(eventTime).toISOString(),
    payloadHash: crypto.createHash("sha256").update(rawBody).digest("hex"),
  };
}

function findPaymentPublicId(event) {
  const value = event.payment_public_id || event.data?.payment_public_id || event.payment?.payment_public_id;
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(value) ? value : null;
}
function header(headers, name) { const value = headers?.[name] ?? headers?.[name.toLowerCase()]; return Array.isArray(value) ? String(value[0] || "") : String(value || ""); }
function parseTimestamp(value) { const numeric = Number(value); if (Number.isFinite(numeric)) return numeric > 1e12 ? numeric : numeric * 1000; return Date.parse(value); }
function safeEqual(actual, expected) { const a = Buffer.from(String(actual)); const b = Buffer.from(String(expected)); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function webhookError(status, code, message) { const error = new Error(message); error.status = status; error.code = code; return error; }

module.exports = { verifyLorentsenWebhook, WEBHOOK_EVENTS };
