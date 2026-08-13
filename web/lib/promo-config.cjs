const INITIAL_PROMOS = Object.freeze([
  Object.freeze({
    code: "FAMILY0", normalizedCode: "FAMILY0", discountType: "target_final_amount", discountValue: 599,
    targetFinalAmount: 0, active: true, startsAt: "2026-08-01T00:00:00.000Z", expiresAt: "2026-12-31T23:59:59.999Z",
    maxRedemptions: 25, redemptionCount: 0, perOrderLimit: 1, campaign: "family_and_qa", source: "product_foundation_v1",
  }),
  Object.freeze({
    code: "FRIEND100", normalizedCode: "FRIEND100", discountType: "target_final_amount", discountValue: 499,
    targetFinalAmount: 100, active: false, startsAt: null, expiresAt: null,
    maxRedemptions: 100, redemptionCount: 0, perOrderLimit: 1, campaign: "early_friends", source: "product_foundation_v1",
  }),
  Object.freeze({
    code: "SUPPORT399", normalizedCode: "SUPPORT399", discountType: "target_final_amount", discountValue: 200,
    targetFinalAmount: 399, active: false, startsAt: null, expiresAt: null,
    maxRedemptions: 100, redemptionCount: 0, perOrderLimit: 1, campaign: "early_supporters", source: "product_foundation_v1",
  }),
]);

function initialPromoRecords(now = new Date()) {
  const timestamp = now.toISOString();
  return INITIAL_PROMOS.map(promo => ({ ...promo, createdAt: timestamp, updatedAt: timestamp }));
}

function normalizePromoCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9]{3,32}$/.test(normalized) ? normalized : "";
}

function promoAvailability(promo, now = new Date()) {
  if (!promo) return { ok: false, code: "PROMO_NOT_FOUND", message: "Промокод не найден" };
  if (!promo.active) return { ok: false, code: "PROMO_UNAVAILABLE", message: "Промокод больше недоступен" };
  const timestamp = now.getTime();
  if (promo.startsAt && Date.parse(promo.startsAt) > timestamp) return { ok: false, code: "PROMO_NOT_STARTED", message: "Этот промокод нельзя применить" };
  if (promo.expiresAt && Date.parse(promo.expiresAt) <= timestamp) return { ok: false, code: "PROMO_EXPIRED", message: "Срок действия промокода истёк" };
  if (promo.maxRedemptions != null && Number(promo.redemptionCount || 0) >= Number(promo.maxRedemptions)) return { ok: false, code: "PROMO_EXHAUSTED", message: "Промокод больше недоступен" };
  return { ok: true };
}

function promoError(result) {
  const error = new Error(result?.message || "Этот промокод нельзя применить");
  error.code = result?.code || "PROMO_INVALID";
  error.status = result?.code === "PROMO_NOT_FOUND" ? 404 : 409;
  return error;
}

module.exports = { INITIAL_PROMOS, initialPromoRecords, normalizePromoCode, promoAvailability, promoError };
