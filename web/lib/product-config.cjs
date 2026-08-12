const DEFAULT_DEV_PRICE_RUB = 100;

function getProductConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const configured = Number(env.PREMIUM_REPORT_PRICE_RUB);
  const amount = Number.isSafeInteger(configured) && configured > 0 ? configured : (production ? null : DEFAULT_DEV_PRICE_RUB);
  return Object.freeze({
    productId: "premium-personal-report",
    amount,
    currency: "RUB",
    priceIsDevPlaceholder: !production && !(Number.isSafeInteger(configured) && configured > 0),
    available: amount !== null,
  });
}

module.exports = { DEFAULT_DEV_PRICE_RUB, getProductConfig };
