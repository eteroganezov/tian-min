const { calculateRequest } = require("./calculate.cjs");

function createFreePreviewRequest(input, options = {}) {
  const calculate = options.calculate || calculateRequest;
  const result = calculate(input);
  if (result.status !== 200) return result;

  const { chart, presentation } = result.body;
  const currentYear = Number(options.currentYear || new Date().getFullYear());
  const currentBaziPeriod = chart.bazi.majorPeriods.find(period => yearInRange(currentYear, period.years)) || null;
  const currentZiweiPalace = chart.ziwei.palaces.find(palace => palace.isCurrentPeriod) || null;

  return {
    status: 200,
    body: {
      state: "FREE_PREVIEW_READY",
      person: {
        displayName: presentation.displayName,
        birthPlace: presentation.birthPlace,
        date: input.date,
        time: input.time,
        gender: chart.input.gender,
      },
      bazi: {
        pillars: chart.bazi.pillars,
        dayMaster: chart.bazi.dayMaster,
        dayMasterDisplay: chart.bazi.pillars.find(pillar => pillar.key === "day")?.stemDisplay || null,
        elements: chart.bazi.elementsDisplay,
        strength: chart.bazi.strength,
        currentPeriod: currentBaziPeriod,
      },
      ziwei: {
        lunarDate: chart.ziwei.lunarDateDisplay,
        mingPalace: chart.ziwei.mingPalace,
        shenPalace: chart.ziwei.shenPalace,
        fiveElementBureau: chart.ziwei.fiveElementBureauDisplay,
        transformations: chart.ziwei.transformationsDisplay,
        currentPalace: currentZiweiPalace ? safePalace(currentZiweiPalace) : null,
        palaces: chart.ziwei.palaces.map(safePalace),
      },
    },
  };
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
