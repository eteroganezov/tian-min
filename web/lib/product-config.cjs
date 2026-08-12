const DEFAULT_DEV_PRICE_RUB = 100;
const PRODUCTION_PRICE_RUB = 399;

function getProductConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const configured = Number(env.PREMIUM_REPORT_PRICE_RUB);
  const validConfigured = Number.isSafeInteger(configured) && configured > 0 && Number.isSafeInteger(configured * 100);
  const amount = validConfigured ? configured : (production ? PRODUCTION_PRICE_RUB : DEFAULT_DEV_PRICE_RUB);
  return Object.freeze({
    productId: "premium-personal-report",
    amount,
    currency: "RUB",
    priceIsDevPlaceholder: !production && !validConfigured,
    available: true,
  });
}

module.exports = { DEFAULT_DEV_PRICE_RUB, PRODUCTION_PRICE_RUB, getProductConfig };
