const fs = require("node:fs");
const PDFDocument = require("pdfkit");
const { russianTypography } = require("./report-content.cjs");

const colors = { ink: "#18231f", muted: "#66736d", jade: "#173f36", sage: "#dfe8e2", sand: "#f4f0e7", gold: "#b5955d", red: "#9c4938", white: "#ffffff" };
const spacing = Object.freeze({ pageX: 52, top: 48, contentTop: 178, bottom: 756, cardPadding: 18, cardGap: 12, paragraphGap: 12 });
const dayMasters = Object.freeze({ 甲:"Янское Дерево",乙:"Иньское Дерево",丙:"Янский Огонь",丁:"Иньский Огонь",戊:"Янская Земля",己:"Иньская Земля",庚:"Янский Металл",辛:"Иньский Металл",壬:"Янская Вода",癸:"Иньская Вода" });
const branchNames = Object.freeze({ 子:"Цзы",丑:"Чоу",寅:"Инь",卯:"Мао",辰:"Чэнь",巳:"Сы",午:"У",未:"Вэй",申:"Шэнь",酉:"Ю",戌:"Сюй",亥:"Хай" });

function chooseFont(candidates) { return candidates.find(file => fs.existsSync(file)); }

function clean(value) {
  return russianTypography(String(value ?? "")
    .normalize("NFC")
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/gu, "")
    .replace(/[\uFFFD\uFFFE\uFFFF]/gu, "-")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu, "")
    .replace(/[−‑]/gu, "-")
    .replace(/\s+-\s+/gu, " — ")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .replace(/[ \t]{2,}/gu, " "));
}

function createReportPdf({ chart, metadata, presentation = {}, report, legacyReport, hasFullReport = true }) {
  return new Promise((resolve, reject) => {
    const person = presentation.displayName ? `${presentation.displayName} - ` : "";
    const doc = new PDFDocument({ size: "A4", margin: 52, bufferPages: true, info: { Title: `${person}персональная карта личности и жизненного пути`, Author: "Тянь Мин", Subject: "Персональный информационно-развлекательный отчёт" } });
    const chunks = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const regular = chooseFont([process.env.PDF_FONT_REGULAR, "/System/Library/Fonts/Supplemental/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"].filter(Boolean));
    const bold = chooseFont([process.env.PDF_FONT_BOLD, "/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"].filter(Boolean));
    const cjk = chooseFont([process.env.PDF_FONT_CJK, "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"].filter(Boolean));
    let cjkReady = false;
    if (cjk) { try { doc.registerFont("CJK", cjk); cjkReady = true; } catch { cjkReady = false; } }
    if (regular) doc.registerFont("Body", regular); else doc.registerFont("Body", "Helvetica");
    if (bold) doc.registerFont("Bold", bold); else doc.registerFont("Bold", "Helvetica-Bold");
    doc._tianMingBrandFont = cjkReady ? "CJK" : "Bold";
    doc._tianMingCjkReady = cjkReady;

    cover(doc, chart, metadata, presentation, report);
    baziVisualPage(doc, chart, cjkReady);
    ziweiVisualPages(doc, chart, cjkReady);
    luckTimelinePage(doc, chart, cjkReady);
    if (report && hasFullReport) fullReport(doc, report);
    else if (report) previewReport(doc, report);
    else if (legacyReport) legacyFullReport(doc, legacyReport);
    else unavailablePage(doc);
    addPageNumbers(doc);
    doc.end();
  });
}

function cover(doc, chart, metadata, presentation, report) {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(colors.jade);
  doc.fillColor(colors.gold).font(doc._tianMingBrandFont).fontSize(11).text("ТЯНЬ МИН · 天命", 52, 56, { characterSpacing: 1.2 });
  doc.fillColor("#a9bdb5").font("Body").fontSize(10).text("ПЕРСОНАЛЬНАЯ КАРТА ЛИЧНОСТИ И ЖИЗНЕННОГО ПУТИ", 52, 88, { characterSpacing: .7 });
  doc.fillColor(colors.white).font("Bold").fontSize(34).text(clean(presentation.displayName || "Ваша персональная карта"), 52, 168, { width: 490, lineGap: 8 });
  doc.fillColor("#d9e3dd").font("Body").fontSize(16).text("Понять себя. Увидеть свой ритм.", 52, 270, { width: 460, lineGap: 5 });
  if (report) doc.fillColor(colors.gold).font("Body").fontSize(11).text(cleanNarrative(`${report.archetype}. ${report.subtitle}`), 52, 330, { width: 450, lineGap: 4 });
  doc.fillColor("#a9bdb5").font(doc._tianMingBrandFont).fontSize(10).text("Ба-цзы (八字) + Цзы Вэй Доу Шу (紫微斗数)", 52, 430, { width: 450 });
  doc.moveTo(52, 490).lineTo(543, 490).strokeColor("#55736a").stroke();
  const rows = [
    ["Дата рождения", metadata.originalBirthDate], ["Время рождения", metadata.originalBirthTime],
    ["Место рождения", presentation.birthPlace?.label || metadata.birthPlace],
  ];
  rows.forEach(([label, value], index) => {
    const y = 520 + index * 42;
    doc.fillColor("#9eb2aa").font("Body").fontSize(9).text(label.toUpperCase(), 52, y);
    const valueSize = label === "Имя" && clean(value).length > 38 ? 9 : 11;
    doc.fillColor(colors.white).font("Bold").fontSize(valueSize).text(clean(value), 190, y, { width: 350, lineBreak: false, ellipsis: true });
  });
  doc.fillColor("#91a69e").font("Body").fontSize(8).text(
    "Время рождения учтено с поправкой на место рождения и исторические правила времени.",
    52, 664, { width: 470, lineGap: 2 },
  );
  doc.fillColor("#91a69e").font("Body").fontSize(7.4).text("Материалы предназначены для информационных, культурных и развлекательных целей и не заменяют медицинские, финансовые или юридические рекомендации.", 52, 738, { width: 470, lineGap: 2 });
}

function fullReport(doc, report) {
  executivePortrait(doc, report.executivePortrait);
  editorialSection(doc, report.personality);
  splitSection(doc, "Внешнее и внутреннее", [
    ["Как видят", report.externalVsInternal.external], ["Что внутри", report.externalVsInternal.internal], ["Синтез", report.externalVsInternal.synthesis],
    ["Реакция на стресс", report.stressPattern.reaction], ["Риск", report.stressPattern.mistakes], ["Восстановление", report.stressPattern.recovery],
  ]);
  cards(doc, "5 главных черт", report.keyTraits, item => `${item.title}\n${item.explanation}\n\nВ ресурсе: ${item.positive}\nРиск: ${item.shadow}\nОснования: ${item.evidence.join("; ")}`, { continuePage: true });
  cards(doc, "Сильные стороны", report.strengths, item => `${item.title}\n${item.essence}\n\nКак проявляется: ${item.manifestation}\nГде полезно: ${item.usefulWhere}\nПрактика: ${item.practicalUse}`, { continuePage: true });
  cards(doc, "Риски и слабые места", report.challenges, item => `${item.pattern}\nКогда: ${item.trigger}\nВозможное следствие: ${item.consequence}\nЧто помогает: ${item.compensation}`);
  editorialSection(doc, report.career);
  editorialSection(doc, report.money);
  editorialSection(doc, report.relationships);
  splitSection(doc, "Текущий большой период", [
    ["Период", report.currentPeriod.period], ["Главная тема", report.currentPeriod.headline], ["Что меняется", report.currentPeriod.summary],
    ["Возможности", report.currentPeriod.opportunities.join("\n• ")], ["На что обратить внимание", report.currentPeriod.risks.join("\n• ")],
    ["Что можно сделать", report.currentPeriod.actions.join("\n• ")],
    ...(report.currentPeriod.evidence.length ? [["Почему мы сделали такой вывод", report.currentPeriod.evidence.join("\n• ")]] : []),
    ["Границы интерпретации", report.currentPeriod.confidenceNote],
  ]);
  cards(doc, "Ближайшие 3 года", report.yearlyOutlook, item => `${item.year} - ${item.theme}\nВозможности: ${item.opportunities}\nРиски: ${item.risks}\nФокус: ${item.focus}\nНе форсировать: ${item.avoid}`);
  cards(doc, "Ключевые переходы", report.keyLifeTransitions, item => `${item.age} · ${item.period}\n${item.theme}\n${item.change}`);
  cards(doc, "Возможные сценарии", report.scenarios, item => `${item.type}: ${item.title}\n${item.description}\nОриентир: ${item.decisions}`);
  matrix(doc, report.lifeAreaMatrix);
  splitSection(doc, "Насколько устойчивы выводы", [
    ["Хорошо подтверждается картой", report.conclusionStability.wellSupported.join("\n• ")],
    ["Требует дополнительного контекста", report.conclusionStability.needsContext.join("\n• ")],
    ["Не стоит воспринимать буквально", report.conclusionStability.notLiteral.join("\n• ")],
  ]);
  splitSection(doc, "План действий", [
    ["Делать чаще", report.actionPlan.doMore.join("\n• ")], ["Избегать", report.actionPlan.avoid.join("\n• ")],
    ["Фокус на 12 месяцев", report.actionPlan.next12Months.join("\n• ")], ["Вопросы себе", report.actionPlan.questions.join("\n• ")],
  ]);
  cards(doc, "Как это проявляется в жизни", report.lifeManifestations, (item, index) => `${index + 1}. ${item}`);
  section(doc, report.finalSummary.headline, `${report.finalSummary.summary}\n\nПриоритеты:\n• ${report.finalSummary.priorities.join("\n• ")}`);
}

function previewReport(doc, report) {
  executivePortrait(doc, report.executivePortrait);
  cards(doc, "Три сильные стороны", report.strengths.slice(0, 3), item => `${item.title}\n${item.essence}`);
  cards(doc, "Главная зона внимания", report.challenges.slice(0, 1), item => `${item.pattern}\n${item.compensation}`);
  section(doc, "Полная версия", "Расширенные разделы отчёта не входят в текущий доступ. Подробная карта приведена ниже.");
}

function executivePortrait(doc, data) {
  page(doc, "Главное о вас", data.headline);
  bodyText(doc, data.summary);
  doc.moveDown(.6);
  splitSectionContent(doc, [["Ваш основной ресурс", data.primaryResource], ["Как вы принимаете решения", data.decisionStyle], ["Главное внутреннее противоречие", data.innerTension], ["Что особенно важно сейчас", data.currentFocus], ["Если коротко", data.synthesis]]);
}

function editorialSection(doc, data) {
  page(doc, data.headline, data.title);
  bodyText(doc, data.summary);
  doc.moveDown(1);
  splitSectionContent(doc, [
    ...data.insights.map(item => [item.heading, item.text]),
    ["Сильные стороны", data.strengths.join("\n• ")],
    ["Риски", data.risks.join("\n• ")],
    ["Практические действия", data.actions.join("\n• ")],
    ...(data.evidence.length ? [["Основания в карте", data.evidence.join("\n• ")]] : []),
    ["Уверенность", data.confidenceNote],
  ]);
}

function legacyFullReport(doc, legacy) {
  const sections = new Map(prepareLegacySections(legacy.sections || []).map(section => [section.key, section]));
  legacyExecutive(doc, sections.get("executive"), sections.get("archetype"));
  legacyEditorial(doc, sections.get("personality"), ["Как вы воспринимаете ситуацию", "От чего зависит внутренний ритм"]);
  legacyTraits(doc, sections.get("traits"));
  legacyStrengths(doc, sections.get("strengths"));
  legacyChallenges(doc, sections.get("challenges"));
  legacyComparison(doc, sections.get("comparison"));
  legacyStress(doc, sections.get("stress"));
  legacyEditorial(doc, sections.get("career"), ["Ваша профессиональная роль", "Среда и полномочия", "Экспертность и люди", "Роль партнёрств", "Коммерческий язык", "Практическая стратегия", "Формат следующего шага"], { intro:"Роли и рабочая среда, в которых ваши качества раскрываются наиболее естественно." });
  legacyGuidance(doc, sections.get("environment"), "Среда, в которой вы раскрываетесь", "Условия, люди и правила взаимодействия, которые помогают сохранять ясность и ресурс.", "ВАШЕ ОКРУЖЕНИЕ");
  legacyGuidance(doc, sections.get("leadership"), "Ваш стиль влияния и лидерства", "Как вы задаёте направление, выстраиваете договорённости и поддерживаете качество работы.", "РОЛЬ И ВЛИЯНИЕ");
  legacyEditorial(doc, sections.get("money"), ["Как вы создаёте ценность", "Где финансовый риск", "Что укрепляет денежную систему"]);
  legacyEditorial(doc, sections.get("relationships"), ["Что для вас важно", "Как вы входите в близость", "Роль партнёрства сейчас", "Границы и ответственность", "Как проходит конфликт", "Что поддерживает отношения", "Чего лучше не накапливать", "Ближайший горизонт", "Главный ориентир"], { intro:"На первый план выходят качество выбора, ясность границ и договорённостей." });
  legacyGuidance(doc, sections.get("lifestyle"), "Ритм, нагрузка и восстановление", "Практические условия, которые помогают сохранять устойчивый темп и вовремя замечать перегруз.", "ПОВСЕДНЕВНЫЙ РИТМ");
  legacyCurrentPeriod(doc, sections.get("current-period"));
  legacyYears(doc, sections.get("years"));
  legacyTransitions(doc, sections.get("transitions"));
  legacyScenarios(doc, sections.get("scenarios"));
  legacyMatrix(doc, sections.get("matrix"));
  legacyCrossValidation(doc, sections.get("cross-validation"));
  legacyStability(doc, sections.get("confidence"));
  legacyManifestations(doc, sections.get("manifestations"));
  legacyActionPlan(doc, sections.get("action-plan"));
  legacyFinal(doc, sections.get("final"), sections.get("archetype"));
}

function legacyExecutive(doc, data, archetype) {
  if (!data) return;
  page(doc, "Главное о вас", archetype?.title || "Персональный портрет");
  const paragraphs = data.paragraphs || [];
  const lead = findSentence(paragraphs[0], /Главная объединяющая тема/u) || firstUsefulSentence(paragraphs[0]);
  if (lead) pullQuote(doc, lead);
  const labels = ["Ваш главный ресурс", "Что особенно заметно", "Что может мешать", "Тема текущего периода"];
  const sources = [
    findSentence(paragraphs[0], /лучше раскрывается/u) || firstUsefulSentence(paragraphs[0]),
    findSentence(paragraphs[2], /интеллектуальн|партнёр/u) || firstUsefulSentence(paragraphs[2]),
    String(findSentence(paragraphs[1], /давление дедлайнов|чужих ожиданий/u) || firstUsefulSentence(paragraphs[1])).replace(/^.*?(давление дедлайнов)/iu,"Давление дедлайнов"),
    findSentence(paragraphs[3], /практическая формула|период/u) || firstUsefulSentence(paragraphs[3]),
  ].map(editorialNarrative);
  const y = Math.max(doc.y + 18, 282);
  const heights = [0,1].map(row => Math.max(...sources.slice(row*2,row*2+2).map(text => insightCardHeight(doc,text,239)), 126));
  sources.forEach((text, index) => {
    const row=Math.floor(index/2), cardY=y+(row?heights[0]+12:0);
    insightCard(doc,52+(index%2)*251,cardY,239,heights[row],`${String(index+1).padStart(2,"0")} · ${labels[index]}`,text,index%2);
  });
  doc.y=y+heights[0]+heights[1]+30;
  if (archetype?.paragraphs?.[0]) summaryPath(doc, archetype.paragraphs[0]);
}

function legacyEditorial(doc, data, headings, options = {}) {
  if (!data) return;
  const chunks = (data.paragraphs || []).map((text,index)=>({heading:headings[index] || `Ключевая линия ${index+1}`,text:editorialNarrative(text)})).filter(item=>validConsumerText(item.text));
  const intro=options.intro||firstSentences(chunks[0]?.text,1);
  page(doc,data.title,intro,{kicker:"ПЕРСОНАЛЬНЫЙ РАЗБОР"});
  chunks.forEach((item,index)=>{
    const text=index===0?remainingSentences(item.text,1):item.text;
    if(!validConsumerText(text))return;
    if(doc.y+editorialBlockHeight(doc,text)>spacing.bottom)continuationPage(doc,data.title);
    editorialBlock(doc,item.heading,text,index);
  });
}

function legacyTraits(doc, data) {
  if (!data) return;
  const parsed=(data.items||[]).map(parseTrait);
  [parsed.slice(0,2),parsed.slice(2)].filter(x=>x.length).forEach((items,pageIndex)=>{
    if(pageIndex)continuationPage(doc,"Пять главных черт"); else page(doc,"Пять главных черт","Не ярлыки, а повторяющиеся способы воспринимать ситуацию и действовать.",{kicker:"ХАРАКТЕР"});
    items.forEach((item,index)=>traitCard(doc,item,pageIndex*2+index,pageIndex?190:228));
  });
}

function legacyStrengths(doc,data){
  if(!data)return;const parsed=(data.items||[]).map(parseStrength);
  [parsed.slice(0,3),parsed.slice(3)].filter(x=>x.length).forEach((items,pageIndex)=>{if(pageIndex)continuationPage(doc,"Сильные стороны");else page(doc,"Сильные стороны","Качества, которые особенно полезны в работе, отношениях и сложных решениях.",{kicker:"ВАШИ РЕСУРСЫ"});items.forEach((item,index)=>resourceCard(doc,item,pageIndex*3+index));});
}

function legacyChallenges(doc,data){
  if(!data)return;const parsed=(data.items||[]).map(parseChallenge);
  [parsed.slice(0,3),parsed.slice(3)].filter(x=>x.length).forEach((items,pageIndex)=>{if(pageIndex)continuationPage(doc,"Что может мешать");else page(doc,"Что может мешать","Ситуации, в которых сильные качества могут начать расходовать слишком много ресурса.",{kicker:"ЗОНЫ ВНИМАНИЯ"});items.forEach((item,index)=>challengeCard(doc,item,pageIndex*3+index));});
}

function legacyComparison(doc,data){if(!data)return;page(doc,"Как вас видят и что происходит внутри","Два слоя восприятия: внешнее впечатление и внутреннее переживание.",{kicker:"ДВА СЛОЯ"});const y=220;(data.items||[]).slice(0,2).forEach((item,index)=>insightCard(doc,52+index*251,y,239,210,index?"Что происходит внутри":"Как вас видят",stripLeadingLabel(item),index));if(data.paragraphs?.[0]){doc.y=460;quietNote(doc,"Практический ориентир",data.paragraphs[0]);}}
function legacyStress(doc,data){if(!data)return;page(doc,data.title,"Как меняется способ думать и действовать под давлением.",{kicker:"ПОД ДАВЛЕНИЕМ"});const labels=["Первая реакция","Где возникает ошибка","Как восстановить ясность"];(data.items||[]).slice(0,3).forEach((item,index)=>processStep(doc,index,labels[index],stripStep(item)));if(data.paragraphs?.[0]){doc.y=Math.max(doc.y,650);quietNote(doc,"Один важный ориентир",String(data.paragraphs[0]).replace(/^Лучше не делать:\s*Не следует\s*/u,"Не "));}}

function legacyCurrentPeriod(doc,data){if(!data)return;page(doc,"Текущий жизненный период",data.title,{kicker:"СЕЙЧАС"});const parsed=(data.items||[]).map(parseUpperItem);parsed.forEach((item,index)=>periodCell(doc,item,index));}
function legacyYears(doc,data){if(!data)return;page(doc,data.title,"Три главные темы ближайших лет — каждая со своим фокусом и задачами.",{kicker:"БЛИЖАЙШИЙ ГОРИЗОНТ"});(data.items||[]).map(parseYear).forEach((item,index)=>yearCard(doc,item,index));}
function legacyTransitions(doc,data){if(!data)return;page(doc,data.title,"Пять поворотных точек в долгой перспективе.",{kicker:"ДЛИННАЯ ПЕРСПЕКТИВА"});(data.items||[]).map(parseTransition).forEach((item,index)=>transitionRow(doc,item,index));}
function legacyScenarios(doc,data){if(!data)return;page(doc,data.title,"Сценарии показывают последствия разных способов использовать один и тот же потенциал.",{kicker:"ТРИ ВАРИАНТА РАЗВИТИЯ"});const labels=["Устойчивый путь","Путь роста","Сценарий перегруза"];(data.items||[]).map(parseScenario).forEach((item,index)=>scenarioCard(doc,item,labels[index],index));}
function legacyMatrix(doc,data){if(!data)return;const rows=(data.items||[]).map(parseMatrixItem).filter(Boolean);[rows.slice(0,4),rows.slice(4)].filter(x=>x.length).forEach((group,pageIndex)=>{if(pageIndex)continuationPage(doc,"Матрица жизненных сфер");else page(doc,"Матрица жизненных сфер","Как Ба-цзы и Цзы Вэй дополняют друг друга в разных областях жизни.",{kicker:"ДВЕ СИСТЕМЫ"});group.forEach((item,index)=>matrixRow(doc,item,index));});}
function legacyGuidance(doc,data,title,intro,kicker){if(!data?.items?.length)return;page(doc,title,intro,{kicker});data.items.map(parseUpperItem).forEach((item,index)=>guidanceRow(doc,item,index,title));}
function legacyCrossValidation(doc,data){if(!data?.items?.length)return;page(doc,"Как две системы дополняют друг друга","Где Ба-цзы и Цзы Вэй сходятся, а где показывают разные стороны одной темы.",{kicker:"СОПОСТАВЛЕНИЕ ВЫВОДОВ"});const labels=["Где системы сходятся","Разные акценты","Наиболее устойчивые выводы","Где важен контекст"];data.items.forEach((text,index)=>guidanceRow(doc,{label:labels[index]||"Ключевой вывод",text:normalizeCrossText(stripCrossLabel(text))},index,"Как две системы дополняют друг друга"));}
function legacyStability(doc,data){if(!data)return;page(doc,data.title,"Где выводы устойчивы, а где важен жизненный контекст.",{kicker:"ГРАНИЦЫ ИНТЕРПРЕТАЦИИ"});(data.items||[]).forEach((item,index)=>stabilityBand(doc,normalizeStabilityText(item),index));doc.y=Math.min(doc.y,690);quietNote(doc,"Точность времени","Точность времени рождения влияет на отдельные детали карты и временные акценты.");}
function legacyManifestations(doc,data){if(!data?.items?.length)return;page(doc,"Практическая самопроверка","Сверьте выводы с вашей реальной жизнью.",{kicker:"ПРАКТИЧЕСКАЯ САМОПРОВЕРКА"});data.items.forEach((item,index)=>manifestationRow(doc,item,index));}
function legacyActionPlan(doc,data){if(!data)return;page(doc,data.title,"Короткий список действий, которые помогают перевести выводы в практику.",{kicker:"ПРАКТИЧЕСКИЙ ИТОГ"});(data.items||[]).forEach((item,index)=>actionColumn(doc,item,index));}
function legacyFinal(doc,data,archetype){
  if(!data)return;
  doc.addPage();
  doc.rect(0,0,doc.page.width,doc.page.height).fill(colors.jade);
  doc.fillColor(colors.gold).font(doc._tianMingBrandFont).fontSize(9).text("ТЯНЬ МИН · 天命",52,52,{characterSpacing:1.1});
  doc.fillColor("#a9bdb5").font("Bold").fontSize(9).text("ФИНАЛ ПЕРСОНАЛЬНОЙ ЧАСТИ",52,94,{characterSpacing:1});
  doc.fillColor(colors.white).font("Bold").fontSize(30).text(clean(data.title),52,134,{width:490});
  if(archetype?.paragraphs?.[0])doc.fillColor(colors.gold).font("Body").fontSize(16).text(clean(archetype.paragraphs[0]),52,210,{width:460,lineGap:5});
  doc.moveTo(52,292).lineTo(543,292).strokeColor("#55736a").stroke();
  let y=320;
  (data.paragraphs||[]).forEach((text,index)=>{
    const value=cleanNarrative(editorialNarrative(text));
    const font=index===0?"Bold":"Body",size=index===0?11.5:9.4,width=470,lineGap=index===0?4:3.5;
    doc.font(font).fontSize(size);
    const height=doc.heightOfString(value,{width,lineGap});
    doc.fillColor(index===0?colors.white:"#d9e3dd").text(value,52,y,{width,lineGap});
    y+=height+(index===0?22:18);
  });
}

function firstSentences(text,count){return sentences(text).slice(0,count).join(" ");}
function remainingSentences(text,count){return sentences(text).slice(count).join(" ");}
function sentences(text){return String(text||"").split(/(?<=[.!?])\s+/u).filter(Boolean);}
function findSentence(text,pattern){return sentences(text).find(sentence=>pattern.test(sentence))||"";}
function firstUsefulSentence(text){return sentences(text).find(sentence=>!isMethodSentence(sentence))||"";}
function compactText(text,max=260){const value=cleanNarrative(text);return value.length<=max?value:`${value.slice(0,max).replace(/\s+\S*$/u,"")}…`;}
function isMethodSentence(value){return /(?:этот отчёт основан|в рамках (?:этой )?(?:системы|символической интерпретации)|оценк\p{L}* (?:силы|обозначен)|уверенност\p{L}* обозначен|структура.*уверенност|не объективн\p{L}* прогноз|высок\p{L}* чувствительност|следует (?:трактовать|воспринимать) осторожно|расч[её]т чувствителен|не стоит воспринимать символические указания как инвестиционный совет|карта не да[её]т основания ни запрещать, ни гарантировать)/iu.test(String(value));}
function stripMethodClauses(value){return String(value).replace(/(?:;|,)\s*(?:слабость дневного хозяина оценена с низкой уверенностью|сила дневного хозяина неопределённа|вывод осторожный)/giu,"").replace(/(?:;|,)\s*оценка силы дневного хозяина[^.;]*/giu,"").replace(/в рамках (?:этой )?(?:системы|символической интерпретации)\s*/giu,"").replace(/Это не предсказание кризиса, а\s+практический фокус[^.]*Цзы Вэй\./giu,"").trim();}
function editorialNarrative(value){return stripMethodClauses(sentences(value).filter(sentence=>!isMethodSentence(sentence)).join(" "));}
function validConsumerText(value){const text=cleanNarrative(value).replace(/\bв рамках этой символической интерпретации\s*/giu,"").trim();return text&&!/\b(?:undefined|null|nan)\b|(?:соединение|столкновение|сочетание|вред|конфликт)\s*[-–—](?:\s|$)/iu.test(text)?text:"";}
function validEvidenceText(value){const text=stripMethodClauses(clean(value).replace(/,?\s*уверенность\s+(?:низкая|средняя|высокая)/giu,"")).trim();return text&&!/\b(?:undefined|null|nan)\b|(?:соединение|столкновение|сочетание|вред)\s*[-–—](?=\s*(?:[·.;,]|$))/iu.test(text)?text:"";}
function prepareLegacySections(sections){return sections.map(section=>({...section,paragraphs:(section.paragraphs||[]).map(normalizeSensitivity).filter(Boolean),items:(section.items||[]).map(normalizeSensitivity).filter(Boolean)}));}
function normalizeSensitivity(text){const timeWord="(?<!\\p{L})(?:час(?:а|у|ом|ов)?|время|времени|временем)(?!\\p{L})";const warning=new RegExp(`(?:(?:чувствительн\\p{L}*|точност\\p{L}*)[^.]{0,180}${timeWord}|${timeWord}[^.]{0,180}(?:чувствительн\\p{L}*|точност\\p{L}*)|следует воспринимать особенно осторожно)`,"iu");return sentences(text).filter(sentence=>!warning.test(sentence)).map(sentence=>sentence.replace(/в рамках этой символической интерпретации\s*/iu,"")).filter(Boolean).join(" ").trim();}
function splitByMarkers(text,markers){const source=String(text||"");const positions=markers.map(marker=>({marker,index:source.search(marker)})).filter(x=>x.index>=0).sort((a,b)=>a.index-b.index);const result={lead:positions.length?source.slice(0,positions[0].index).trim():source.trim()};positions.forEach((entry,index)=>{const start=entry.index+source.slice(entry.index).match(entry.marker)[0].length;const end=positions[index+1]?.index??source.length;result[entry.marker.source]=source.slice(start,end).trim();});return result;}
function splitLegacyTitle(prefix,bodyStart){const match=String(prefix).match(bodyStart);if(!match)return{title:compactText(prefix,70),body:""};return{title:prefix.slice(0,match.index).trim(),body:prefix.slice(match.index).trim()};}
function parseTrait(text){const number=String(text).match(/^(\d{2})\s+/)?.[1]||"";const raw=String(text).replace(/^\d{2}\s+/,"");const parts=splitByMarkers(raw,[/В\s+РЕСУРСЕ\s+/u,/В\s+ПЕРЕГРУЗЕ\s+/u,/Основания карты:\s*/u]);const main=splitLegacyTitle(parts.lead,/(?:Преобладание|Структура|Текущий|Финансовый|Связка)/u);return{number,title:main.title,description:main.body,strong:parts[/В\s+РЕСУРСЕ\s+/u.source],low:parts[/В\s+ПЕРЕГРУЗЕ\s+/u.source],evidence:validEvidenceText(parts[/Основания карты:\s*/u.source])};}
function parseStrength(text){const main=splitLegacyTitle(text,/(?:Способность|Влияние|Умение|Сочетание|Возможность)/u);const body=sentences(main.body);return{title:main.title,description:body.slice(0,-1).join(" ")||body[0]||"",action:body.length>1?body.at(-1):""};}
function parseChallenge(text){const raw=String(text);const when=raw.indexOf("Когда:");const risk=raw.indexOf("Риск:");if(when<0||risk<0)return{title:compactText(raw,80),when:"",risk:"",help:""};const title=raw.slice(0,when).trim();const whenText=raw.slice(when+6,risk).trim();const tail=raw.slice(risk+5).trim();const tailSentences=sentences(tail);return{title,when:whenText,risk:tailSentences[0]||tail,help:tailSentences.slice(1).join(" ")};}
function parseUpperItem(text){const match=String(text).match(/^([А-ЯЁ\s]+)\s+(.+)$/u);return{label:match?.[1]?.trim()||"Ключевая тема",text:match?.[2]||text};}
function parseYear(text){const year=String(text).match(/^\d{4}/)?.[0]||"";const rest=String(text).slice(year.length).trim();const focusIndex=rest.indexOf("Фокус:");const avoidIndex=rest.indexOf("Не форсировать:");const before=rest.slice(0,focusIndex>=0?focusIndex:rest.length).trim();const supportStart=before.search(/(?:Показать|Уточнить|Укрепить|Сделать|Выстроить|Проверить)\s/u);return{year,title:(supportStart>0?before.slice(0,supportStart):before).trim(),support:(supportStart>0?before.slice(supportStart):"").trim(),focus:focusIndex>=0?rest.slice(focusIndex+6,avoidIndex>=0?avoidIndex:rest.length).trim():"",avoid:avoidIndex>=0?rest.slice(avoidIndex+15).trim():""};}
function parseTransition(text){const match=String(text).match(/^(\d+\s+(?:лет|год|года))\s+([\d–-]+)\s+(.+)$/u);return{age:match?.[1]||"",years:match?.[2]||"",text:match?.[3]||text};}
function parseScenario(text){const match=String(text).match(/^(КОНСЕРВАТИВНЫЙ|РОСТ|ПЕРЕГРУЗ)\s+(.+)$/u);const body=match?.[2]||text;const parts=sentences(body);const intro=splitLegacyTitle(parts[0]||body,/(?:Вы|Фокус|Начать|Остановить)/u);return{type:match?.[1]||"",title:intro.title,text:[intro.body,...parts.slice(1,-1)].filter(Boolean).join(" "),action:parts.length>1?parts.at(-1):""};}
function parseMatrixItem(text){const source=String(text).replace(/\u00a0/g," ");const areas=["Карьера","Финансы","Отношения","Самовыражение","Окружение","Внутреннее состояние","Дом и перемены","Здоровье"];const area=areas.find(x=>source.startsWith(x));if(!area&&/^Цзы Вэй Доу Шу\s+/u.test(source))return{area:"Здоровье",alignment:"",text:source};if(!area)return null;const rest=source.slice(area.length).trim();const alignment=["Согласие","Дополнение","Расхождение"].find(x=>rest.startsWith(x));if(!alignment)return{area,alignment:"",text:rest};return{area,alignment,text:rest.slice(alignment.length).trim()};}
function splitEvidence(value){return String(value||"").split(/\s*·\s*/u).map(validEvidenceText).filter(Boolean);}
function stripCrossLabel(text){return String(text).replace(/^(?:Подтверждают|Расходятся|Устойчивые выводы|Требуют осторожности)\s+/iu,"");}
function normalizeCrossText(text){return String(text).replace(/Ба-цзы-оценка слабости дневного хозяина имеет низкую уверенность, поэтому она не должна перевешивать реальные жизненные факты\./iu,"Оценку силы Дневного хозяина полезно сопоставлять с реальными жизненными фактами.");}
function normalizeStabilityText(text){return String(text).replace(/;\s*оценка силы дневного хозяина неустойчива\./iu,".").replace(/Конкретные даты брака, переезда, крупных потерь или болезней\.\s*Таких данных расчёт не подтверждает; высокая чувствительность расчёта не позволяет делать точные событийные заявления\./iu,"В вопросах брака, переезда и других крупных жизненных событий особенно важны точность исходных данных и реальные обстоятельства. Карта показывает периоды, в которых эти темы могут становиться более заметными.");}
function stripLeadingLabel(text){return String(text).replace(/^(?:СНАРУЖИ|ВНУТРИ)\s+/u,"");}
function stripStep(text){return String(text).replace(/^\d{2}\s+(?:Реакция|Ошибка|Восстановление)\s+/u,"");}

function pullQuote(doc,text){const value=validConsumerText(text);if(!value)return;doc.fillColor(colors.jade).font("Bold").fontSize(15).text(value,52,doc.y,{width:491,lineGap:6});doc.y+=18;}
function quietNote(doc,label,text){const value=validConsumerText(text);if(!value)return;doc.font("Body").fontSize(9.2);const bodyHeight=doc.heightOfString(value,{width:342,lineGap:3});const height=Math.max(70,bodyHeight+28);ensure(doc,height+12);const y=doc.y;doc.roundedRect(52,y,491,height,7).fill(colors.sand);doc.fillColor(colors.gold).font("Bold").fontSize(7.6).text(clean(label).toUpperCase(),68,y+15,{width:112,lineGap:2});doc.fillColor(colors.ink).font("Body").fontSize(9.2).text(value,183,y+14,{width:342,lineGap:3});doc.y=y+height+12;}
function insightCardHeight(doc,text,width){doc.font("Body").fontSize(9.2);return Math.max(126,doc.heightOfString(validConsumerText(text),{width:width-32,lineGap:3})+65);}
function insightCard(doc,x,y,w,h,label,text,variant=0){doc.roundedRect(x,y,w,h,8).fill(variant%2?colors.sand:colors.sage);doc.fillColor(colors.gold).font("Bold").fontSize(7.6).text(clean(label).toUpperCase(),x+16,y+16,{width:w-32});doc.fillColor(colors.ink).font("Body").fontSize(9.2).text(validConsumerText(text),x+16,y+44,{width:w-32,lineGap:3});}
function summaryPath(doc,text){const value=validConsumerText(text);if(!value)return;const parts=value.split(/\s*→\s*/u);const content=parts.join("  →  "),y=doc.y,h=96;doc.roundedRect(52,y,491,h,8).fill(colors.jade);doc.fillColor(colors.gold).font("Bold").fontSize(7.5).text("ЕСЛИ КОРОТКО",52,y+15,{width:491,align:"center",characterSpacing:1});doc.font("Bold").fontSize(12.5);const textHeight=doc.heightOfString(content,{width:451,lineGap:4});const textY=y+39+Math.max(0,(43-textHeight)/2);doc.fillColor(colors.white).text(content,72,textY,{width:451,align:"center",lineGap:4});doc.y=y+h+12;}
function editorialBlockHeight(doc,text){const value=validConsumerText(text);doc.font("Body").fontSize(9.4);return Math.max(94,doc.heightOfString(value,{width:491,lineGap:3})+58)+8;}
function editorialBlock(doc,heading,text,index){const value=validConsumerText(text);if(!value)return;const parts=sentences(value),takeaway=parts[0]||value,body=parts.slice(1).join(" ");const y=doc.y;doc.fillColor(colors.gold).font("Bold").fontSize(8).text(`${String(index+1).padStart(2,"0")} · ${clean(heading).toUpperCase()}`,52,y,{width:460});doc.fillColor(colors.jade).font("Bold").fontSize(10.2).text(takeaway,52,y+23,{width:491,lineGap:3});if(body){const bodyY=doc.y+9;doc.fillColor(colors.ink).font("Body").fontSize(9.2).text(body,52,bodyY,{width:491,lineGap:3});}doc.y+=14;doc.moveTo(52,doc.y).lineTo(543,doc.y).strokeColor("#dde1dc").stroke();doc.y+=14;}
function traitCard(doc,item,index,height=228){const evidence=splitEvidence(item.evidence);ensure(doc,height+12);const y=doc.y;doc.roundedRect(52,y,491,height,9).fill("#f8f7f2");doc.fillColor(colors.gold).font("Bold").fontSize(9).text(String(index+1).padStart(2,"0"),70,y+17,{width:22});doc.fillColor(colors.ink).font("Bold").fontSize(15).text(clean(item.title),99,y+13,{width:422});doc.fillColor(colors.ink).font("Body").fontSize(8.8).text(validConsumerText(item.description),70,y+44,{width:451,lineGap:2});const splitY=y+(height>200?88:72),panelH=height>200?82:72;[[70,colors.sage,colors.jade,"СИЛЬНАЯ СТОРОНА",item.strong],[299,"#f3e9df",colors.gold,"КОГДА РЕСУРСА МАЛО",item.low]].forEach(([x,bg,accent,label,text])=>{doc.roundedRect(x,splitY,222,panelH,6).fill(bg);doc.rect(x,splitY,4,panelH).fill(accent);doc.fillColor(accent).font("Bold").fontSize(7).text(label,x+14,splitY+11,{width:194});doc.fillColor(colors.ink).font("Body").fontSize(height>200?8.1:7.7).text(validConsumerText(text),x+14,splitY+28,{width:194,lineGap:2});});if(evidence.length){const evidenceY=y+height-47;doc.moveTo(70,evidenceY-5).lineTo(521,evidenceY-5).strokeColor("#d8ded9").stroke();doc.fillColor(colors.gold).font("Bold").fontSize(6.2).text("ОСНОВАНИЕ В КАРТЕ",70,evidenceY,{width:100,lineGap:1});evidence.forEach((line,lineIndex)=>doc.fillColor(colors.muted).font(doc._tianMingBrandFont).fontSize(6.2).text(line,181,evidenceY+lineIndex*11,{width:340,lineGap:1}));}doc.y=y+height+12;}
function resourceCard(doc,item,index){ensure(doc,150);const y=doc.y;doc.fillColor(colors.gold).font("Bold").fontSize(8).text(String(index+1).padStart(2,"0"),52,y+4,{width:20});doc.fillColor(colors.jade).font("Bold").fontSize(14).text(clean(item.title).toUpperCase(),78,y,{width:465});doc.fillColor(colors.ink).font("Body").fontSize(9.3).text(validConsumerText(item.description),78,y+29,{width:465,lineGap:3});if(item.action){doc.roundedRect(78,y+80,465,46,5).fill(colors.sand);doc.fillColor(colors.gold).font("Bold").fontSize(7).text("КАК ИСПОЛЬЗОВАТЬ",90,y+93,{width:98});doc.fillColor(colors.muted).font("Body").fontSize(8.3).text(validConsumerText(item.action),190,y+91,{width:341,lineGap:2});}doc.moveTo(52,y+138).lineTo(543,y+138).strokeColor("#d8ded9").stroke();doc.y=y+152;}
function challengeCard(doc,item,index){ensure(doc,170);const y=doc.y;doc.roundedRect(52,y,491,156,8).lineWidth(1).strokeColor("#d8ded9").stroke();doc.rect(52,y,5,156).fill(index%2?colors.gold:colors.red);doc.fillColor(colors.ink).font("Bold").fontSize(14).text(clean(item.title),72,y+16,{width:450});[["КОГДА ПРОЯВЛЯЕТСЯ",item.when],["ЧТО ПРОИСХОДИТ",item.risk],["ЧТО ПОМОГАЕТ",item.help]].forEach(([label,text],i)=>{doc.fillColor(i===1?colors.red:colors.gold).font("Bold").fontSize(7).text(label,72,y+51+i*31,{width:116});doc.fillColor(colors.ink).font("Body").fontSize(8.3).text(validConsumerText(text),194,y+49+i*31,{width:329,height:28,lineGap:2,ellipsis:true});});doc.y=y+170;}
function processStep(doc,index,label,text){const y=doc.y;doc.circle(73,y+20,20).fill(index===1?colors.sand:colors.sage);doc.fillColor(colors.gold).font("Bold").fontSize(9).text(String(index+1).padStart(2,"0"),61,y+15,{width:24,align:"center"});doc.fillColor(colors.jade).font("Bold").fontSize(13).text(label,112,y,{width:420});doc.fillColor(colors.ink).font("Body").fontSize(9.5).text(validConsumerText(text),112,y+25,{width:420,lineGap:3});doc.y=y+115;}
function periodCell(doc,item,index){const col=index%2,row=Math.floor(index/2),x=52+col*251,y=218+row*164;insightCard(doc,x,y,239,148,item.label,item.text,index);doc.y=Math.max(doc.y,y+160);}
function yearCard(doc,item,index){const x=52+index*166,y=224,w=154,h=430;doc.roundedRect(x,y,w,h,9).fill(index===1?colors.sage:colors.sand);doc.fillColor(colors.gold).font("Bold").fontSize(26).text(item.year,x+16,y+18,{width:w-32});doc.fillColor(colors.ink).font("Bold").fontSize(12).text(clean(item.title),x+16,y+66,{width:w-32,height:55});[["ЧТО ПОДДЕРЖИВАЕТ",item.support],["ФОКУС",item.focus],["НЕ ФОРСИРОВАТЬ",item.avoid]].forEach(([label,text],i)=>{const sy=y+145+i*92;doc.fillColor(i===2?colors.red:colors.gold).font("Bold").fontSize(6.7).text(label,x+16,sy,{width:w-32});doc.fillColor(colors.ink).font("Body").fontSize(7.8).text(validConsumerText(text),x+16,sy+18,{width:w-32,height:70,lineGap:2,ellipsis:true});});}
function transitionRow(doc,item,index){const y=doc.y;doc.moveTo(92,y).lineTo(92,y+94).lineWidth(2).strokeColor("#d8ded9").stroke();doc.circle(92,y+18,index===2?8:5).fill(index===2?colors.red:colors.gold);doc.fillColor(colors.gold).font("Bold").fontSize(9).text(item.age,52,y+8,{width:30,align:"right"});doc.fillColor(colors.jade).font("Bold").fontSize(12).text(item.years,120,y+4,{width:90});doc.fillColor(colors.ink).font("Body").fontSize(9).text(validConsumerText(item.text),220,y+2,{width:323,lineGap:3});doc.y=y+100;}
function scenarioCard(doc,item,label,index){const x=52+index*166,y=230,w=154,h=420;doc.roundedRect(x,y,w,h,9).fill(index===2?"#eee6df":index===1?colors.sage:colors.sand);doc.fillColor(index===2?colors.red:colors.gold).font("Bold").fontSize(7.2).text(label.toUpperCase(),x+16,y+18,{width:w-32});doc.fillColor(colors.ink).font("Bold").fontSize(13).text(clean(item.title),x+16,y+55,{width:w-32});doc.fillColor(colors.ink).font("Body").fontSize(8.3).text(validConsumerText(item.text),x+16,y+120,{width:w-32,height:180,lineGap:3,ellipsis:true});doc.fillColor(colors.gold).font("Bold").fontSize(7).text("ОРИЕНТИР",x+16,y+322);doc.fillColor(colors.muted).font("Body").fontSize(7.7).text(validConsumerText(item.action),x+16,y+342,{width:w-32,height:65,lineGap:2,ellipsis:true});}
function matrixRow(doc,item,index){const value=validConsumerText(stripMethodClauses(item.text));if(!value)return;doc.font("Body").fontSize(8.5);const height=Math.max(112,doc.heightOfString(value,{width:338,lineGap:2.5})+10);ensure(doc,height+24);const y=doc.y;doc.fillColor(colors.jade).font("Bold").fontSize(12).text(clean(item.area),52,y,{width:135});if(item.alignment)doc.fillColor(item.alignment==="Расхождение"?colors.red:colors.gold).font("Bold").fontSize(7.3).text(item.alignment.toUpperCase(),52,y+38,{width:130});doc.fillColor(colors.ink).font("Body").fontSize(8.5).text(value,205,y,{width:338,lineGap:2.5});doc.moveTo(52,y+height).lineTo(543,y+height).strokeColor("#d8ded9").stroke();doc.y=y+height+14;}
function guidanceRow(doc,item,index,sectionTitle){const value=validConsumerText(item.text);if(!value)return;doc.font("Body").fontSize(8.8);const bodyHeight=doc.heightOfString(value,{width:372,lineGap:2.7});const height=Math.max(66,bodyHeight+24);if(doc.y+height>755)continuationPage(doc,sectionTitle);const y=doc.y;const label=String(item.label).replace(/^ОПАСНЫЕ ПАТТЕРНЫ$/u,"НЕЖЕЛАТЕЛЬНЫЕ СЦЕНАРИИ");doc.fillColor(colors.gold).font("Bold").fontSize(7.4).text(clean(label).toUpperCase(),52,y+4,{width:105,lineGap:2});doc.fillColor(colors.ink).font("Body").fontSize(8.8).text(value,171,y,{width:372,lineGap:2.7});doc.moveTo(52,y+height-9).lineTo(543,y+height-9).strokeColor("#d8ded9").stroke();doc.y=y+height;}
function manifestationRow(doc,text,index){const value=validConsumerText(text);if(!value)return;doc.font("Body").fontSize(10);const height=Math.max(64,doc.heightOfString(value,{width:424,lineGap:3})+24);if(doc.y+height>755)continuationPage(doc,"Как это проявляется в жизни");const y=doc.y;doc.circle(70,y+15,15).fill(index%2?colors.sand:colors.sage);doc.fillColor(colors.gold).font("Bold").fontSize(8).text(String(index+1).padStart(2,"0"),59,y+10,{width:22,align:"center"});doc.fillColor(colors.ink).font("Body").fontSize(10).text(value,105,y+5,{width:424,lineGap:3});doc.moveTo(105,y+height-8).lineTo(543,y+height-8).strokeColor("#d8ded9").stroke();doc.y=y+height;}
function stabilityBand(doc,item,index){const sourceLabels=["Хорошо подтверждается картой","Требует дополнительного контекста","Не стоит воспринимать буквально"],labels=["Опирается на несколько сигналов","Зависит от жизненного контекста","Где важен дополнительный контекст"];const text=String(item).replace(new RegExp(`^${sourceLabels[index]}\\s*[-—–]\\s*`),"");const y=doc.y,h=index===1?160:135;doc.roundedRect(52,y,491,h,8).fill(index===0?colors.sage:index===1?colors.sand:"#eee6df");doc.fillColor(index===2?colors.red:colors.gold).font("Bold").fontSize(8).text(labels[index].toUpperCase(),70,y+18,{width:455});doc.fillColor(colors.ink).font("Body").fontSize(9.3).text(validConsumerText(text),70,y+48,{width:455,height:h-60,lineGap:3,ellipsis:true});doc.y=y+h+14;}
function actionColumn(doc,item,index){const label=index?"Чего избегать":"Делать чаще";const text=String(item).replace(new RegExp(`^${index?"Избегать":"Делать чаще"}\\s+`),"");const values=sentences(text);const x=52+index*251,y=230,w=239,accent=index?colors.red:colors.jade;doc.fillColor(accent).font("Bold").fontSize(14).text(label,x,y,{width:w});doc.moveTo(x,y+26).lineTo(x+w-12,y+26).lineWidth(2).strokeColor(accent).stroke();if(index)doc.moveTo(52+239+12,y-5).lineTo(52+239+12,690).lineWidth(1).strokeColor("#e3e4df").stroke();values.forEach((value,i)=>{const iy=y+50+i*82;doc.circle(x+13,iy+7,13).fill(i%2?colors.sand:colors.sage);doc.fillColor(colors.gold).font("Bold").fontSize(7.5).text(String(i+1).padStart(2,"0"),x+2,iy+2,{width:22,align:"center"});doc.fillColor(colors.ink).font("Body").fontSize(8.7).text(validConsumerText(value),x+38,iy-1,{width:w-44,height:72,lineGap:2.5,ellipsis:true});});}
function numberedObservation(doc,item,index){const y=doc.y;doc.fillColor(colors.gold).font("Bold").fontSize(10).text(String(index+1).padStart(2,"0"),52,y+4,{width:28});doc.fillColor(colors.ink).font(index<2?"Bold":"Body").fontSize(index<2?11.2:10).text(validConsumerText(item),96,y,{width:447,lineGap:3});doc.y=y+72;doc.moveTo(96,doc.y-14).lineTo(543,doc.y-14).strokeColor("#e1e3df").stroke();}

function unavailablePage(doc) { section(doc, "Персональный разбор ещё не создан", "Карта уже рассчитана. Ниже приведены четыре столпа Ба-цзы, баланс пяти элементов, жизненные периоды и двенадцать дворцов Цзы Вэй Доу Шу."); }

function baziVisualPage(doc, chart, hasCjk) {
  page(doc, "Ваша карта в одном взгляде", "Четыре столпа Ба-цзы, Дневной хозяин и соотношение пяти элементов.", { kicker:"БА-ЦЗЫ" });
  const cardWidth = 116;
  chart.bazi.pillars.forEach((pillar, index) => {
    const x = 52 + index * 125;
    doc.roundedRect(x, 188, cardWidth, 158, 8).fill(index % 2 ? colors.sand : colors.sage);
    doc.fillColor(colors.muted).font("Bold").fontSize(8).text(pillar.label.toUpperCase(), x + 12, 204, { width: 92, align: "center" });
    doc.fillColor(colors.jade).font(hasCjk ? "CJK" : "Bold").fontSize(27).text(`${pillar.gan}${pillar.zhi}`, x + 12, 235, { width: 92, align: "center" });
    doc.fillColor(colors.ink).font("Bold").fontSize(9).text(pillar.shiShenDisplay.name, x + 10, 285, { width: 96, align: "center" });
    doc.fillColor(colors.red).font(hasCjk ? "CJK" : "Body").fontSize(8).text(pillar.shiShenDisplay.original, x + 12, 320, { width: 92, align: "center" });
  });

  const summaries = [
    ["Дневной хозяин", dayMasters[chart.bazi.dayMaster] || "Дневной хозяин", `${chart.bazi.dayMaster} · ваш основной элемент`],
    ["Структура карты", chart.bazi.structureDisplay.name.replace(/^Структура\s*/, ""), `${chart.bazi.structureDisplay.original} · ведущий принцип организации карты`],
    ["Баланс карты", chart.bazi.strength.display.name.replace(/\s+карта$/iu, ""), "Основному элементу требуется больше поддержки со стороны карты."],
  ];
  summaries.forEach(([label, value, note], index) => {
    const x = 52 + index * 166;
    doc.roundedRect(x, 374, 156, 108, 6).lineWidth(1).strokeColor("#d8ded9").stroke();
    doc.fillColor(colors.gold).font("Bold").fontSize(7.5).text(label.toUpperCase(), x + 12, 390, { width: 132 });
    doc.fillColor(colors.ink).font("Bold").fontSize(10.5).text(clean(value), x + 12, 410, { width: 132, height:30 });
    doc.fillColor(colors.muted).font(hasCjk&&/[\u3400-\u9FFF]/u.test(String(note))?"CJK":"Body").fontSize(6.8).text(clean(note), x + 12, 447, { width: 132, height:31, lineGap:1 });
  });

  doc.fillColor(colors.ink).font("Bold").fontSize(16).text("Баланс пяти элементов", 52, 520);
  const max = Math.max(...chart.bazi.elementsDisplay.map(item => Number(item.value)), 1);
  chart.bazi.elementsDisplay.forEach((item, index) => {
    const y = 560 + index * 36;
    doc.fillColor(colors.ink).font("Bold").fontSize(9).text(item.name, 52, y, { width: 82 });
    doc.fillColor(colors.gold).font(hasCjk ? "CJK" : "Body").fontSize(9).text(item.original, 122, y, { width: 24 });
    doc.roundedRect(158, y + 1, 330, 10, 5).fill("#e7e7e1");
    doc.roundedRect(158, y + 1, Math.max(4, 330 * Number(item.value) / max), 10, 5).fill(index === 2 ? colors.red : colors.jade);
    doc.fillColor(colors.ink).font("Bold").fontSize(9).text(String(item.value), 505, y, { width: 35, align: "right" });
  });
}

function luckTimelinePage(doc, chart, hasCjk) {
  page(doc, "Большие жизненные периоды", "Последовательные десятилетние этапы карты Ба-цзы. Выделен период, включающий текущий календарный год.", { kicker:"ПОДРОБНЫЕ ДАННЫЕ ВАШЕЙ КАРТЫ" });
  const currentYear = new Date().getUTCFullYear();
  doc.moveTo(96, 202).lineTo(96, 720).lineWidth(2).strokeColor("#d6ddd8").stroke();
  chart.bazi.majorPeriods.forEach((item, index) => {
    const y = 205 + index * 86;
    const years = String(item.years).match(/(\d{4}).*?(\d{4})/);
    const current = years && currentYear >= Number(years[1]) && currentYear <= Number(years[2]);
    doc.circle(96, y + 21, current ? 9 : 6).fill(current ? colors.red : colors.gold);
    if (current) doc.roundedRect(122, y - 2, 420, 67, 7).fill(colors.sage);
    doc.fillColor(colors.muted).font("Bold").fontSize(8).text(item.range, 52, y + 8, { width: 34, align: "right" });
    doc.fillColor(colors.jade).font(hasCjk ? "CJK" : "Bold").fontSize(18).text(item.ganZhi, 140, y + 7, { width: 70 });
    doc.fillColor(colors.ink).font("Bold").fontSize(10).text(item.detailDisplay.map(value => value.name).join(" · "), 225, y + 8, { width: 285 });
    doc.fillColor(colors.muted).font("Body").fontSize(8).text(`${item.years}${current ? " · текущий период" : ""}`, 225, y + 35, { width: 285 });
  });
}

function ziweiVisualPages(doc, chart, hasCjk) {
  const groups=[chart.ziwei.palaces.slice(0,4),chart.ziwei.palaces.slice(4)];
  groups.forEach((palaces,pageIndex)=>{
  if(pageIndex)continuationPage(doc,"Двенадцать дворцов Цзы Вэй");else page(doc,"Двенадцать дворцов Цзы Вэй","Сначала — рассчитанная карта: дворцы, главные звёзды и возрастные периоды. Затем — персональная интерпретация.",{ kicker:"ОСНОВА ПЕРСОНАЛЬНОГО РАЗБОРА" });
  if(pageIndex===0){
  const lunar=formatLunarDate(chart.ziwei.lunarDateDisplay);
  const bureauElement=String(chart.ziwei.fiveElementBureau||"")[0];
  const facts = [
    ["Лунная дата", lunar], ["Дворец судьбы", branchLabel(chart.ziwei.mingPalace)],
    ["Дворец тела", branchLabel(chart.ziwei.shenPalace)], ["Система элементов", `${chart.ziwei.fiveElementBureauDisplay.name.replace(/^Система элемента\s*[«"]?|[»"]$/gu,"")} · ${bureauElement}`],
  ];
  facts.forEach(([label, value], index) => {
    const col=index%2,row=Math.floor(index/2),x=52+col*251,y=212+row*58;
    doc.roundedRect(x,y,239,50,7).fill(index%2?colors.sand:colors.sage);
    doc.fillColor(colors.gold).font("Bold").fontSize(6.7).text(label.toUpperCase(),x+12,y+10,{width:94});
    doc.fillColor(colors.ink).font(hasCjk?"CJK":"Body").fontSize(9.2).text(clean(value),x+106,y+9,{width:120,height:34,lineGap:2});
  });
  if (chart.ziwei.transformationsDisplay.length) {
    transformationBlock(doc,chart.ziwei.transformationsDisplay,hasCjk);
  }
  }
  palaces.forEach((palace, index) => {
    const col = index % 2, row = Math.floor(index / 2);
    const x = 52 + col * 251, y = (pageIndex ? 145 + row * 130 : 504 + row * 121);
    doc.roundedRect(x, y, 239, 114, 7).fill(palace.isCurrentPeriod ? colors.sage : index % 2 ? colors.sand : "#f8f7f2");
    if (palace.isCurrentPeriod) doc.rect(x, y, 5, 114).fill(colors.gold);
    doc.fillColor(colors.ink).font("Bold").fontSize(9).text(palace.displayName.name, x + 14, y + 12, { width: 211, height: 28 });
    doc.fillColor(colors.gold).font(hasCjk ? "CJK" : "Body").fontSize(7).text(`${palace.name} · ${palace.ganZhi}`, x + 14, y + 44, { width: 211 });
    const stars = palace.mainStarsDisplay.length ? palace.mainStarsDisplay.map(star => star.name).join(" · ") : "Без главной звезды";
    doc.fillColor(colors.jade).font("Bold").fontSize(8).text(stars, x + 14, y + 66, { width: 211 });
    doc.fillColor(colors.muted).font("Body").fontSize(7).text(`Возрастной период · ${palace.majorPeriod} лет${palace.isCurrentPeriod ? " · текущий" : ""}`, x + 14, y + 92, { width: 211 });
  });
  });
}

function transformationBlock(doc,items,hasCjk){
  const definitions=[
    {original:"化禄",name:"Хуа Лу",meaning:"Возможности и ресурс"},
    {original:"化权",name:"Хуа Цюань",meaning:"Влияние и ответственность"},
    {original:"化科",name:"Хуа Кэ",meaning:"Признание и проявленность"},
    {original:"化忌",name:"Хуа Цзи",meaning:"Напряжение и зона развития"},
  ];
  doc.fillColor(colors.jade).font("Bold").fontSize(8.8).text("ЧЕТЫРЕ ТРАНСФОРМАЦИИ",52,330,{width:491});
  doc.fillColor(colors.muted).font("Body").fontSize(7.5).text("Четыре специальных акцента показывают, где потенциал карты усиливается, проявляется или требует больше внимания.",52,350,{width:491,lineGap:2});
  definitions.forEach((definition,index)=>{
    const item=items.find(value=>String(value.original).endsWith(definition.original));
    if(!item)return;
    const x=52+index*125,y=390,w=116,h=96;
    const starName=String(item.name).split(/\s*·\s*/u)[0];
    const starOriginal=String(item.original).slice(0,-definition.original.length);
    doc.roundedRect(x,y,w,h,6).fill(index%2?colors.sand:colors.sage);
    doc.fillColor(colors.gold).font(hasCjk?"CJK":"Bold").fontSize(7.3).text(`${definition.name} · ${definition.original}`,x+10,y+10,{width:w-20,height:18});
    doc.fillColor(colors.muted).font("Body").fontSize(6.7).text(definition.meaning,x+10,y+33,{width:w-20,height:28,lineGap:1});
    doc.fillColor(colors.jade).font(hasCjk?"CJK":"Bold").fontSize(7.8).text(`${starName} · ${starOriginal}`,x+10,y+69,{width:w-20,height:18});
  });
}

function formatLunarDate(value){const match=String(value).match(/(\d{4})\s+год\s+·\s+(\d+)-й\s+лунный месяц\s+·\s+(\d+)-й\s+день/u);return match?`${match[3]}-й день · ${match[2]}-й месяц · ${match[1]}`:value;}
function branchLabel(value){const name=branchNames[value];return name?`${name} · ${value}`:value;}

function page(doc, title, intro, options = {}) {
  doc.addPage();
  doc.fillColor(colors.gold).font(doc._tianMingBrandFont).fontSize(9).text("ТЯНЬ МИН · 天命", 52, 48, { characterSpacing: 1.1 });
  if(options.kicker)doc.fillColor(colors.gold).font("Bold").fontSize(7.5).text(clean(options.kicker),52,82,{width:490,characterSpacing:1.1});
  doc.fillColor(colors.ink).font("Bold").fontSize(27).text(clean(title), 52, options.kicker?108:88, { width: 490 });
  const titleBottom = doc.y;
  if (intro) {
    const introY = Math.max(options.kicker?170:148, titleBottom + 12);
    doc.fillColor(colors.muted).font("Body").fontSize(10).text(clean(intro), 52, introY, { width: 490, lineGap: 4 });
    doc.y = Math.max(options.kicker?204:188, doc.y + 18);
  } else doc.y = Math.max(options.kicker?170:145, titleBottom + 20);
}

function continuationPage(doc, sectionTitle) {
  doc.addPage();
  doc.fillColor(colors.gold).font(doc._tianMingBrandFont).fontSize(9).text("ТЯНЬ МИН · 天命",52,48,{characterSpacing:1.1});
  doc.fillColor(colors.muted).font("Bold").fontSize(8).text(clean(sectionTitle).toUpperCase(),52,84,{width:490,characterSpacing:.8});
  doc.moveTo(52,108).lineTo(543,108).strokeColor("#dde1dc").stroke();
  doc.y=128;
}

function section(doc, title, text) { page(doc, title); bodyText(doc, text); }

function cards(doc, title, items, formatter, { continuePage = false } = {}) {
  if (continuePage) subheading(doc, title); else page(doc, title);
  items.forEach((item, index) => {
    const text = cleanNarrative(formatter(item, index));
    doc.font("Body").fontSize(9.5);
    const height = doc.heightOfString(text, { width: 459, lineGap: 2 }) + 22;
    if (doc.y + height + 10 > 770) continuationPage(doc,title);
    const y = doc.y;
    doc.roundedRect(52, y, 491, height, 8).fill(index % 2 ? colors.sand : colors.sage);
    doc.fillColor(colors.ink).font("Body").fontSize(9.5).text(text, 68, y + 11, { width: 459, lineGap: 2 });
    doc.y = y + height + 8;
  });
}

function splitSection(doc, title, entries) {
  page(doc, title);
  splitSectionContent(doc, entries);
}

function splitSectionContent(doc, entries) {
  entries.forEach(([label, value]) => {
    const narrativeValue = cleanNarrative(value);
    doc.font("Body").fontSize(10);
    const height = doc.heightOfString(narrativeValue, { width: 350, lineGap: 3 });
    ensure(doc, Math.max(54, height + 20));
    const y = doc.y;
    doc.fillColor(colors.gold).font("Bold").fontSize(9).text(clean(label).toUpperCase(), 52, y, { width: 118 });
    doc.fillColor(colors.ink).font("Body").fontSize(10).text(narrativeValue, 185, y, { width: 358, lineGap: 3 });
    doc.y = y + Math.max(54, height + 20);
    doc.moveTo(52, doc.y - 10).lineTo(543, doc.y - 10).strokeColor("#d8ded9").stroke();
  });
}

function matrix(doc, rows) {
  page(doc, "Матрица жизненных сфер", "Как две системы дополняют или уточняют друг друга.");
  rows.forEach(row => {
    const text = cleanNarrative(`Ба-цзы: ${row.bazi}\nЦзы Вэй: ${row.ziwei}\nСинтез: ${row.synthesis}`);
    const height = doc.heightOfString(text, { width: 384, lineGap: 1 }) + 16;
    ensure(doc, height + 7);
    const y = doc.y;
    doc.fillColor(colors.jade).font("Bold").fontSize(11).text(clean(row.area), 52, y, { width: 95 });
    doc.fillColor(row.alignment === "Расхождение" ? colors.red : colors.gold).font("Bold").fontSize(8).text(clean(row.alignment).toUpperCase(), 52, y + 22, { width: 100 });
    doc.fillColor(colors.ink).font("Body").fontSize(8.2).text(text, 153, y, { width: 390, lineGap: 1 });
    doc.y = y + height + 5;
  });
}

function bodyText(doc, text) { doc.fillColor(colors.ink).font("Body").fontSize(11).text(cleanNarrative(text), 52, doc.y, { width: 491, lineGap: 5, align: "left" }); }
function subheading(doc, text) { ensure(doc, 90); const font = doc._tianMingCjkReady && /[\u3400-\u9FFF]/.test(String(text)) ? "CJK" : "Bold"; doc.moveDown(1).fillColor(colors.jade).font(font).fontSize(15).text(clean(text)); doc.moveDown(.5); }
function technicalRow(doc, label, value, cjk) { ensure(doc, 34); const y = doc.y; doc.fillColor(colors.muted).font(cjk ? "CJK" : "Body").fontSize(8).text(clean(label), 52, y, { width: 175 }); doc.fillColor(colors.ink).font(cjk ? "CJK" : "Body").fontSize(9).text(clean(value), 230, y, { width: 313 }); doc.y = Math.max(doc.y, y + 28); }
function ensure(doc, height) { if (doc.y + height > 770) { doc.addPage(); doc.y = 58; } }

function cleanNarrative(value) {
  return clean(value)
    .replace(/в\s+рамках\s+(?:этой\s+)?(?:системы|символической\s+интерпретации)\s*/giu, "")
    .replace(/Однако нельзя игнорировать конфликтные сигналы Ба-цзы\./giu,"Конфликтные сигналы Ба-цзы добавляют важное уточнение.")
    .replace(/Поэтому не стоит строить вывод «вам подходит только корпорация» или «вам противопоказан бизнес»\.\s*Более осторожный вывод:/giu,"Более точный вывод:")
    .replace(/Практически\s+оптимальная\s+карьерная\s+стратегия\s+состоит\s+из\s+пяти\s+шагов\./giu,"На практике карьерную стратегию можно выстроить в пять шагов.")
    .replace(/Более безопасный сценарий\s*—\s*постепенный:/giu,"Более устойчивый сценарий — постепенный:")
    .replace(/Это\s+не\s+карта,\s+по\s+которой\s+можно\s+честно\s+«назначить»\s+срок\s+брака\s+или\s+характеристику\s+партнёра\./giu,"Карта здесь лучше раскрывает качество и динамику отношений, чем конкретную дату брака или портрет будущего партнёра.")
    .replace(/Во внешнем мире полезно выглядеть как человек структуры:\s*спокойный переговорщик, эксперт, организатор сложных вопросов\./giu,"Со стороны вы можете восприниматься как человек структуры: спокойный переговорщик, эксперт и организатор сложных вопросов.")
    .replace(/В\s+сочетании\s+это\s+не\s+обязательно\s+про\s+«лёгкую»\s+карьеру\.\s*Скорее,\s+про\s+продуктивность/giu,"В сочетании это указывает на продуктивность")
    .replace(/Структура\s+«Прямой чиновник»\s+часто\s+интерпретируется\s+как/giu,"Структура «Прямой чиновник» связана с")
    .replace(/Тянь\s+Тун\s+часто\s+интерпретируется\s+как/giu,"Тянь Тун часто связывают с")
    .replace(/интерпретируют\s+как\s+возможность\s+создавать\s+доход/giu,"связывают с возможностью создавать доход")
    .replace(/Это не убивает романтику;/giu,"Такие разговоры поддерживают романтику;")
    .replace(/Символически\s+это\s+сочетание/giu,"Это сочетание описывает")
    .replace(/этот\s+же\s+символический\s+набор\s+просит/giu,"эта же связка предлагает")
    .replace(/для\s+вашей\s+символической\s+конфигурации/giu,"для вашей карты")
    .replace(/Мало\s+Земли,\s+символически\s+связанной/giu,"Мало Земли, связанной")
    .replace(/Ба-цзы\s+По\s+имеющимся\s+данным\s+нет\s+достаточно\s+надёжного\s+отдельного\s+сигнала\s+для\s+конкретных\s+жилищных\s+выводов\./giu,"В Ба-цзы тема жилья выражена слабее.")
    .replace(/Здесь\s+приоритет\s+у\s+практической\s+проверки\s+условий\.\s+Не\s+делайте\s+дальних\s+выводов\s+из\s+символов;\s+решения\s+о\s+жилье\s+и\s+переездах\s+требуют\s+реальных\s+расчётов\./giu,"Здесь особенно важна практическая проверка условий: решения о жилье и переездах лучше опирать на реальные расчёты.")
    .replace(/могут\s+указывать\s+на\s+необходимость\s+осторожности\s+при\s+крупных\s+изменениях/giu,"могут указывать на повышенное внимание к условиям крупных изменений")
    .replace(/\.\s*практический фокус, выведенный из смены годовых тем Ба-цзы и текущего партнёрского периода Цзы Вэй\./giu,".")
    .replace(/конфликт\s+[\u3400-\u9FFF]+\s*[–—-]\s*[\u3400-\u9FFF]+/giu, "конфликт элементов")
    .replace(/соединение\s+[\u3400-\u9FFF]+\s*[–—-]\s*[\u3400-\u9FFF]+/giu, "соединение элементов")
    .replace(/столкновение\s+[\u3400-\u9FFF]+\s*[–—-]\s*[\u3400-\u9FFF]+/giu, "столкновение элементов")
    .replace(/сочетание\s+[\u3400-\u9FFF]+\s*[–—-]\s*[\u3400-\u9FFF]+/giu, "сочетание элементов")
    .replace(/вред\s+[\u3400-\u9FFF]+\s*[–—-]\s*[\u3400-\u9FFF]+/giu, "связь типа «вред»")
    .replace(/Это общие рекомендации, не медицинские назначения\./giu, "")
    .replace(/бизнес(?:[‐‑-])?анализ/giu, "анализ бизнеса")
    .replace(/экспертно(?:[‐‑-])?структурные роли/giu,"экспертные и структурные роли")
    .replace(/Тань\s+Лан\s+и\s+То\s+Ло\s+(?:в|во)\s+дворце\s+уязвимостей\s*—\s*повод\s+не\s+игнорировать\s+режим\s+и\s+профилактику,\s+но\s+не\s+диагноз\./giu, "Тань Лан и То Ло во дворце уязвимостей подчёркивают важность режима и профилактики.")
    .replace(/[\u3400-\u9FFF]+/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s*[·]\s*(?=[,.;:]|$)/gu, "")
    .replace(/\s+([;,:.])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/(?:соединение|столкновение|сочетание|вред|конфликт)\s*[–—-](?=\s*[,.;:]|\s|$)/giu, "взаимодействие элементов")
    .replace(/([.!?]\s+)такие связи/gu,"$1Такие связи");
}

function addPageNumbers(doc) {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    doc.fillColor("#8b9691").font("Body").fontSize(8).text(`${index + 1} / ${range.count}`, 52, 780, { width: 491, align: "right", lineBreak: false });
  }
}

function labelFor(key) {
  return ({ reaction: "Реакция", mistakes: "Типичные ошибки", decisions: "Решения", recovery: "Восстановление", avoid: "Чего избегать", supports: "Что усиливает", drains: "Что истощает", allies: "Союзники", toxicPatterns: "Токсичные паттерны", communication: "Общение", style: "Стиль", control: "Контроль", authority: "Авторитет", conflict: "Спор", negotiation: "Договорённости", rhythm: "Ритм", intensity: "Интенсивность", stabilityVsChange: "Стабильность и перемены", rest: "Отдых", overload: "Перегруз", environment: "Среда", period: "Период", theme: "Тема", opportunities: "Возможности", risks: "Риски", career: "Карьера", relationships: "Отношения", money: "Деньги", lesson: "Урок" })[key] || key;
}

module.exports = { createReportPdf };
