function dayOfYearUtc(date) {
  return Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000);
}

// Приближение NOAA для Equation of Time. Точность достаточна для минутного ввода MVP;
// метод фиксируется как версия TRUE_SOLAR_TIME_V1 и не подменяется молча.
function equationOfTimeMinutes(utcMilliseconds) {
  const date = new Date(utcMilliseconds);
  const days = isLeapYear(date.getUTCFullYear()) ? 366 : 365;
  const fractionalHour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const gamma = 2 * Math.PI / days * (dayOfYearUtc(date) - 1 + (fractionalHour - 12) / 24);
  return 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
}

function isLeapYear(year) { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }

function partsFromNeutralMilliseconds(milliseconds) {
  const date = new Date(milliseconds);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: date.getUTCHours(), minute: date.getUTCMinutes() };
}

function formatParts(parts) {
  const two = value => String(value).padStart(2, "0");
  return `${String(parts.year).padStart(4, "0")}-${two(parts.month)}-${two(parts.day)} ${two(parts.hour)}:${two(parts.minute)}`;
}

function calculateTrueSolarTime(civilTime, longitude) {
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error("Некорректная долгота места рождения.");
  const standardMeridianLongitude = civilTime.standardOffsetMinutes / 4;
  const longitudeCorrectionMinutes = 4 * (longitude - standardMeridianLongitude);
  const equationMinutes = equationOfTimeMinutes(civilTime.utcMilliseconds);
  const totalCorrectionMinutes = longitudeCorrectionMinutes + equationMinutes - civilTime.dstOffsetMinutes;
  const local = civilTime.local;
  const wallMilliseconds = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  // Ядро принимает минуты, поэтому фиксируем прозрачное округление до ближайшей минуты.
  const trueSolarWallMilliseconds = Math.round((wallMilliseconds + totalCorrectionMinutes * 60_000) / 60_000) * 60_000;
  const parts = partsFromNeutralMilliseconds(trueSolarWallMilliseconds);
  return {
    method: "TRUE_SOLAR_TIME_V1", parts, formatted: formatParts(parts),
    equationOfTimeMinutes: equationMinutes, longitudeCorrectionMinutes,
    dstRemovalMinutes: -civilTime.dstOffsetMinutes, totalCorrectionMinutes,
    standardMeridianLongitude, dateChanged: parts.year !== local.year || parts.month !== local.month || parts.day !== local.day,
  };
}

module.exports = { calculateTrueSolarTime, equationOfTimeMinutes, formatParts };
