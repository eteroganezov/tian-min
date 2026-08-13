const { calculateRequest } = require("./calculate.cjs");
const { formatDisplayNumber, splitLunarDateDisplay } = require("./display-format.cjs");
const { branchDisplay, stemDisplay, strengthDisplay } = require("./astrology-localization.cjs");

function createFreePreviewRequest(input, options = {}) {
  const calculate = options.calculate || calculateRequest;
  const result = calculate(input);
  if (result.status !== 200) return result;

  const { chart, presentation } = result.body;
  const currentYear = Number(options.currentYear || new Date().getFullYear());
  const currentBaziPeriod = chart.bazi.majorPeriods.find(period => yearInRange(currentYear, period.years)) || null;
  const currentZiweiPalace = chart.ziwei.palaces.find(palace => palace.isCurrentPeriod) || null;
  const mingPalace = chart.ziwei.palaces.find(palace => palace.isMing) || null;
  const shenPalace = chart.ziwei.palaces.find(palace => palace.isShen) || null;
  const pillars = chart.bazi.pillars.map(pillar => ({
    ...pillar,
    stemDisplay: stemDisplay(pillar.gan),
    branchDisplay: branchDisplay(pillar.zhi),
  }));

  return {
    status: 200,
    body: {
      state: "FREE_PREVIEW_READY",
      person: {
        displayName: presentation.displayName,
        birthPlace: presentation.birthPlace,
        date: input.date,
        time: input.time,
        birthTimeCertainty: result.body.metadata.birthTimeCertainty,
        gender: chart.input.gender,
      },
      bazi: {
        pillars,
        dayMaster: chart.bazi.dayMaster,
        dayMasterDisplay: pillars.find(pillar => pillar.key === "day")?.stemDisplay || null,
        elements: chart.bazi.elementsDisplay.map(item => ({ ...item, displayValue: formatDisplayNumber(item.value) })),
        strength: { ...chart.bazi.strength, display: strengthDisplay(chart.bazi.strength.verdict) },
        currentPeriod: currentBaziPeriod ? withPeriodDisplay(currentBaziPeriod) : null,
      },
      ziwei: {
        lunarDate: chart.ziwei.lunarDateDisplay,
        lunarDateLines: splitLunarDateDisplay(chart.ziwei.lunarDateDisplay),
        mingPalace: mingPalace ? safePalaceIdentity(mingPalace) : { branch: chart.ziwei.mingPalace, displayName: null },
        shenPalace: shenPalace ? safePalaceIdentity(shenPalace) : { branch: chart.ziwei.shenPalace, displayName: null },
        fiveElementBureau: chart.ziwei.fiveElementBureauDisplay,
        transformations: chart.ziwei.transformationsDisplay,
        currentPalace: currentZiweiPalace ? safePalace(currentZiweiPalace) : null,
        palaces: chart.ziwei.palaces.map(safePalace),
      },
    },
  };
}

function withPeriodDisplay(period) {
  const [gan, zhi] = Array.from(String(period.ganZhi || ""));
  return { ...period, gan, zhi, stemDisplay: stemDisplay(gan), branchDisplay: branchDisplay(zhi) };
}

function safePalaceIdentity(palace) {
  return { branch: palace.dizhi, displayName: palace.displayName };
}

function yearInRange(year, range) {
  const [start, end] = String(range || "").split("–").map(Number);
  return Number.isFinite(start) && Number.isFinite(end) && year >= start && year <= end;
}

function safePalace(palace) {
  return {
    name: palace.name,
    displayName: palace.displayName,
    dizhi: palace.dizhi,
    ganZhi: palace.ganZhi,
    mainStars: palace.mainStarsDisplay,
    auxiliaryStars: palace.auxStarsDisplay,
    transformations: palace.transformations,
    majorPeriod: palace.majorPeriod,
    isCurrentPeriod: palace.isCurrentPeriod,
    isMing: palace.isMing,
    isShen: palace.isShen,
  };
}

module.exports = { createFreePreviewRequest };
