const { calculateLocalChart, calculateNormalizedSolarChart } = require("../../calculator/dist/local-chart.js");
const { locationProvider } = require("./location-provider.cjs");
const { resolveCivilTime } = require("./civil-time.cjs");
const { calculateTrueSolarTime, formatParts } = require("./true-solar-time.cjs");

function pad(value) { return String(value).padStart(2, "0"); }
function dateOf(parts) { return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`; }
function timeOf(parts) { return `${pad(parts.hour)}:${pad(parts.minute)}`; }
function pillarText(pillar) { return pillar.gan + pillar.zhi; }
function hourBranch(hour) { return Math.floor(((hour + 1) % 24) / 2); }

function beijingReference(utcMilliseconds) {
  const date = new Date(utcMilliseconds + 8 * 3_600_000);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: date.getUTCHours(), minute: date.getUTCMinutes() };
}

function calculateBirthChart(input) {
  const place = locationProvider.resolve(input.placeId);
  if (!place) throw Object.assign(new Error("Выберите место рождения из списка подсказок."), { code: "INVALID_PLACE" });
  const civil = resolveCivilTime(input.date, input.time, place.timeZone, input.timeOccurrence);
  const solar = calculateTrueSolarTime(civil, place.longitude);
  const trueParts = solar.parts;
  const birthInfo = { ...trueParts, gender: input.gender, isLunar: false, timeZone: 8 };
  const termReference = beijingReference(civil.utcMilliseconds);
  const chart = calculateNormalizedSolarChart({ ...trueParts, gender: input.gender }, termReference);
  const rawChart = calculateLocalChart({ date: input.date, time: input.time, gender: input.gender });
  const pillarChanges = ["year", "month", "day", "hour"].filter(key => pillarText(rawChart.bazi.siZhu[key]) !== pillarText(chart.bazi.siZhu[key]));
  const rawParts = civil.local;
  const changedZiWeiDate = dateOf(rawParts) !== dateOf(trueParts);
  const changedZiWeiHour = hourBranch(rawParts.hour) !== hourBranch(trueParts.hour) || changedZiWeiDate;
  const sensitivityFlags = {
    ChangedYearPillar: pillarChanges.includes("year"), ChangedMonthPillar: pillarChanges.includes("month"),
    ChangedDayPillar: pillarChanges.includes("day"), ChangedHourPillar: pillarChanges.includes("hour"),
    ChangedZiWeiDate: changedZiWeiDate, ChangedZiWeiHour: changedZiWeiHour,
  };
  const calculationSensitivity = Object.values(sensitivityFlags).some(Boolean) ? "HIGH" : "NORMAL";
  const metadata = {
    originalBirthDate: input.date,
    originalBirthTime: input.time,
    originalLocalDateTime: `${input.date} ${input.time}`,
    birthPlace: place.label,
    place: { name: place.label, city: place.city, region: place.region, country: place.country, latitude: place.latitude, longitude: place.longitude },
    latitude: place.latitude,
    longitude: place.longitude,
    ianaTimeZone: place.timeZone,
    historicalUtcOffset: civil.historicalUtcOffsetMinutes,
    standardUtcOffset: civil.standardOffsetMinutes,
    dstApplied: civil.dstApplied,
    absoluteUtcInstant: civil.utcInstant,
    absoluteBirthInstantUtc: civil.utcInstant,
    trueSolarDateTime: formatParts(trueParts),
    trueSolarDate: dateOf(trueParts),
    trueSolarTime: timeOf(trueParts),
    trueSolarCorrectionMinutes: solar.totalCorrectionMinutes,
    totalSolarCorrectionMinutes: solar.totalCorrectionMinutes,
    equationOfTimeMinutes: solar.equationOfTimeMinutes,
    longitudeCorrectionMinutes: solar.longitudeCorrectionMinutes,
    calculationMethod: solar.method,
    baziTimeUsed: "TRUE_SOLAR_LOCAL_DATE_TIME",
    ziweiTimeUsed: "TRUE_SOLAR_LOCAL_DATE_TIME",
    solarTermComparisonMethod: "ABSOLUTE_INSTANT_COMPARED_IN_UTC_PLUS_8",
    calculationSensitivity, sensitivityFlags,
    solarCorrectionChangedYearPillar: sensitivityFlags.ChangedYearPillar,
    solarCorrectionChangedMonthPillar: sensitivityFlags.ChangedMonthPillar,
    solarCorrectionChangedDayPillar: sensitivityFlags.ChangedDayPillar,
    solarCorrectionChangedHourPillar: sensitivityFlags.ChangedHourPillar,
    solarCorrectionChangedZiWeiDate: sensitivityFlags.ChangedZiWeiDate,
    solarCorrectionChangedZiWeiHour: sensitivityFlags.ChangedZiWeiHour,
  };
  return {
    chart, metadata,
    auditTrail: {
      input: { date: input.date, time: input.time, gender: input.gender, placeId: input.placeId },
      resolvedPlace: place, civilTime: civil, trueSolarTime: solar, solarTermReferenceUtcPlus8: termReference,
      engineInputs: { baziTrueSolarBirthInfo: birthInfo, ziWeiTrueSolarBirthInfo: birthInfo, solarTermAbsoluteReferenceUtcPlus8: termReference },
      rawCivilPillars: Object.fromEntries(Object.entries(rawChart.bazi.siZhu).map(([key, value]) => [key, pillarText(value)])),
      calculatedPillars: Object.fromEntries(Object.entries(chart.bazi.siZhu).map(([key, value]) => [key, pillarText(value)])),
      metadata,
    },
  };
}

module.exports = { beijingReference, calculateBirthChart };
