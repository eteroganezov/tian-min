const DIZHI = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];
const {
  bureauDisplay, confidenceDisplay, elementDisplay, palaceDisplay, starDisplay, stemDisplay,
  strengthDisplay, structureDisplay, tenGodDisplay, tenGodPairDisplay,
} = require("./astrology-localization.cjs");

function toChartView(chart) {
  const bazi = chart.bazi;
  const ziwei = chart.ziwei;
  const pillars = [["year", "Год"], ["month", "Месяц"], ["day", "День"], ["hour", "Час"]].map(([key, label]) => ({
    key, label, gan: bazi.siZhu[key].gan, zhi: bazi.siZhu[key].zhi,
    shiShen: key === "day" ? "Дневной хозяин" : bazi.shiShen[key],
    shiShenDisplay: key === "day" ? { original: "日主", name: "Дневной хозяин" } : tenGodDisplay(bazi.shiShen[key]),
    stemDisplay: stemDisplay(bazi.siZhu[key].gan),
    branchDisplay: { original: bazi.siZhu[key].zhi, name: "Земная ветвь" },
  }));
  const transformations = ziwei.gongs.flatMap(gong => (gong.sihua || []).map(item => `${item.star}${item.hua}`));
  return {
    input: {
      date: `${String(bazi.birthInfo.year).padStart(4, "0")}-${String(bazi.birthInfo.month).padStart(2, "0")}-${String(bazi.birthInfo.day).padStart(2, "0")}`,
      time: `${String(bazi.birthInfo.hour).padStart(2, "0")}:${String(bazi.birthInfo.minute).padStart(2, "0")}`,
      gender: bazi.birthInfo.gender === "male" ? "Мужчина" : "Женщина",
    },
    bazi: {
      pillars, dayMaster: bazi.dayMaster,
      structure: bazi.enrichment.格局.primary,
      structureDisplay: structureDisplay(bazi.enrichment.格局.primary),
      structureConfidence: bazi.enrichment.格局.confidence,
      strength: {
        verdict: bazi.enrichment.旺衰.verdict, score: bazi.enrichment.旺衰.score, confidence: bazi.enrichment.旺衰.confidence,
        display: strengthDisplay(bazi.enrichment.旺衰.verdict), confidenceDisplay: confidenceDisplay(bazi.enrichment.旺衰.confidence),
      },
      elements: bazi.enrichment.五行统计.withCangGan,
      elementsDisplay: Object.entries(bazi.enrichment.五行统计.withCangGan).map(([original, value]) => ({ ...elementDisplay(original), value })),
      regulating: bazi.enrichment.调候用神,
      regulatingDisplay: bazi.enrichment.调候用神.map(stemDisplay),
      majorPeriods: bazi.dayun.slice(0, 6).map(period => ({
        ganZhi: period.ganZhi.gan + period.ganZhi.zhi,
        range: `${period.startAge}–${period.endAge} лет`, years: `${period.startYear}–${period.endYear}`,
        detail: `${period.ganShiShen} · ${period.zhiShiShen}`,
        detailDisplay: tenGodPairDisplay(`${period.ganShiShen} · ${period.zhiShiShen}`),
      })),
    },
    ziwei: {
      lunarDate: ziwei.lunarDate ? `${ziwei.lunarDate.year} год · ${ziwei.lunarDate.monthCn} месяц · ${ziwei.lunarDate.dayCn}` : "—",
      yinYang: ziwei.yinYang || "—", mingPalace: ziwei.gongs[0]?.dizhi || "—",
      shenPalace: DIZHI[ziwei.shenGongIndex] || "—", fiveElementBureau: ziwei.wuXingJu?.name || "—",
      fiveElementBureauDisplay: bureauDisplay(ziwei.wuXingJu?.name || "—"),
      transformations,
      palaces: ziwei.gongs.map(gong => ({
        name: gong.gong.endsWith("宫") ? gong.gong : `${gong.gong}宫`,
        displayName: palaceDisplay(gong.gong.endsWith("宫") ? gong.gong : `${gong.gong}宫`), dizhi: gong.dizhi,
        ganZhi: gong.tiangan + gong.dizhi, mainStars: gong.mainStars, auxStars: gong.auxStars,
        mainStarsDisplay: gong.mainStars.map(starDisplay),
        transformations: (gong.sihua || []).map(item => `${item.star}${item.hua}`),
        majorPeriod: gong.daXian ? `${gong.daXian.startAge}–${gong.daXian.endAge}` : "—",
        isCurrentPeriod: Boolean(gong.daXian?.isCurrent),
        isMing: gong.gong === "命宫", isShen: gong.dizhi === DIZHI[ziwei.shenGongIndex],
      })),
      majorPeriods: ziwei.gongs.filter(gong => gong.daXian).map(gong => ({
        gong: gong.gong.endsWith("宫") ? gong.gong : `${gong.gong}宫`,
        gongDisplay: palaceDisplay(gong.gong.endsWith("宫") ? gong.gong : `${gong.gong}宫`),
        range: `${gong.daXian.startAge}–${gong.daXian.endAge} лет`,
        detail: gong.daXian.isCurrent ? "Текущий период" : "", startAge: gong.daXian.startAge,
      })).sort((a, b) => a.startAge - b.startAge).slice(0, 6).map(({ startAge, ...period }) => period),
    },
  };
}

module.exports = { toChartView };
