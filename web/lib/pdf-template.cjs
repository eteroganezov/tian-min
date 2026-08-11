const fs = require("node:fs");
const PDFDocument = require("pdfkit");
const { russianTypography } = require("./report-content.cjs");

const colors = { ink: "#18231f", muted: "#66736d", jade: "#173f36", sage: "#dfe8e2", sand: "#f4f0e7", gold: "#b5955d", red: "#9c4938", white: "#ffffff" };
const spacing = Object.freeze({ pageX: 52, top: 48, contentTop: 178, bottom: 756, cardPadding: 18, cardGap: 12, paragraphGap: 12 });
const dayMasters = Object.freeze({ 甲:"Янское Дерево",乙:"Иньское Дерево",丙:"Янский Огонь",丁:"Иньский Огонь",戊:"Янская Земля",己:"Иньская Земля",庚:"Янский Металл",辛:"Иньский Металл",壬:"Янская Вода",癸:"Иньская Вода" });

function chooseFont(candidates) { return candidates.find(file => fs.existsSync(file)); }

function clean(value) {
  return russianTypography(String(value ?? "").replace(/[–—−‑]/g, "-").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ""));
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
    if (report && hasFullReport) fullReport(doc, report);
    else if (report) previewReport(doc, report);
    else if (legacyReport) legacyFullReport(doc, legacyReport);
    else unavailablePage(doc);
    appendixDividerPage(doc);
    luckTimelinePage(doc, chart, cjkReady);
    ziweiVisualPages(doc, chart, cjkReady);
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
  doc.fillColor("#91a69e").font("Body").fontSize(7.4).text("Материал носит информационный, культурный и развлекательный характер. Интерпретации Ба-цзы и Цзы Вэй не являются медицинскими, финансовыми или юридическими рекомендациями и не заменяют консультацию профильного специалиста.", 52, 738, { width: 470, lineGap: 2 });
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
  legacyEditorial(doc, sections.get("career"), ["Ваша профессиональная роль", "Среда и полномочия", "Экспертность и люди", "Роль партнёрств", "Коммерческий язык", "Практическая стратегия", "Формат следующего шага"], { splitAt: 4 });
  legacyEditorial(doc, sections.get("money"), ["Как вы создаёте ценность", "Где финансовый риск", "Что укрепляет денежную систему"]);
  legacyEditorial(doc, sections.get("relationships"), ["Что для вас важно", "Как вы входите в близость", "Роль партнёрства сейчас", "Границы и ответственность", "Как проходит конфликт", "Что поддерживает отношения", "Чего лучше не накапливать", "Ближайший горизонт", "Главный ориентир"], { splitAt: 5 });
  legacyCurrentPeriod(doc, sections.get("current-period"));
  legacyYears(doc, sections.get("years"));
  legacyTransitions(doc, sections.get("transitions"));
  legacyScenarios(doc, sections.get("scenarios"));
  legacyMatrix(doc, sections.get("matrix"));
  legacyStability(doc, sections.get("confidence"));
  legacyActionPlan(doc, sections.get("action-plan"));
  legacyManifestations(doc, sections.get("manifestations"));
  legacyFinal(doc, sections.get("final"), sections.get("archetype"));
}

function legacyExecutive(doc, data, archetype) {
  if (!data) return;
  page(doc, "Главное о вас", archetype?.title || "Персональный портрет", { kicker:"ПЕРСОНАЛЬНЫЙ СИНТЕЗ" });
  const paragraphs = data.paragraphs || [];
  const lead = firstSentences(paragraphs[0], 2);
  if (lead) pullQuote(doc, lead);
  const labels = ["Ваш главный ресурс", "Что особенно заметно", "Что может мешать", "Тема текущего периода"];
  const sources = paragraphs.length >= 4 ? paragraphs : [...paragraphs, ...(archetype?.paragraphs || [])];
  const y = Math.max(doc.y + 22, 330);
  sources.slice(0, 4).forEach((text, index) => insightCard(doc, 52 + (index % 2) * 251, y + Math.floor(index / 2) * 152, 239, 138, `${String(index + 1).padStart(2,"0")} · ${labels[index]}`, compactText(text, 360), index % 2));
  doc.y = y + 316;
  if (archetype?.paragraphs?.[0]) quietNote(doc, "Если коротко", archetype.paragraphs[0]);
}

function legacyEditorial(doc, data, headings, options = {}) {
  if (!data) return;
  const chunks = (data.paragraphs || []).map((text,index)=>({heading:headings[index] || `Ключевая линия ${index+1}`,text}));
  let pageIndex=0;
  page(doc,data.title,firstSentences(chunks[0]?.text,1),{kicker:"ПЕРСОНАЛЬНЫЙ РАЗБОР"});
  chunks.forEach((item,index)=>{
    const text=index===0?remainingSentences(item.text,1):item.text;
    if(doc.y+editorialBlockHeight(doc,text)>spacing.bottom){pageIndex+=1;page(doc,`${data.title} · продолжение`,"Продолжение персонального разбора",{kicker:"ПРОДОЛЖЕНИЕ"});}
    editorialBlock(doc,item.heading,text,index);
  });
}

function legacyTraits(doc, data) {
  if (!data) return;
  const parsed=(data.items||[]).map(parseTrait);
  [parsed.slice(0,2),parsed.slice(2,4),parsed.slice(4)].filter(x=>x.length).forEach((items,pageIndex)=>{
    page(doc,pageIndex?"Пять главных черт · продолжение":"Пять главных черт",pageIndex?"Каждая черта может проявляться по-разному в зависимости от ресурса и среды.":"Не ярлыки, а повторяющиеся способы воспринимать ситуацию и действовать.",{kicker:"ХАРАКТЕР"});
    items.forEach((item,index)=>traitCard(doc,item,pageIndex*2+index));
  });
}

function legacyStrengths(doc,data){
  if(!data)return;const parsed=(data.items||[]).map(parseStrength);
  [parsed.slice(0,3),parsed.slice(3)].filter(x=>x.length).forEach((items,pageIndex)=>{page(doc,pageIndex?"Сильные стороны · продолжение":"Сильные стороны",pageIndex?"Ещё два ресурса, на которые можно опираться.":"Качества, которые особенно полезны в работе, отношениях и сложных решениях.",{kicker:"ВАШИ РЕСУРСЫ"});items.forEach((item,index)=>resourceCard(doc,item,pageIndex*3+index));});
}

function legacyChallenges(doc,data){
  if(!data)return;const parsed=(data.items||[]).map(parseChallenge);
  [parsed.slice(0,3),parsed.slice(3)].filter(x=>x.length).forEach((items,pageIndex)=>{page(doc,pageIndex?"Что может мешать · продолжение":"Что может мешать",pageIndex?"Эти паттерны не являются приговором: важен способ вовремя их заметить.":"Ситуации, в которых сильные качества могут начать расходовать слишком много ресурса.",{kicker:"ЗОНЫ ВНИМАНИЯ"});items.forEach((item,index)=>challengeCard(doc,item,pageIndex*3+index));});
}

function legacyComparison(doc,data){if(!data)return;page(doc,data.title,"Разница между внешним впечатлением и внутренним переживанием.",{kicker:"ДВА СЛОЯ"});const y=220;(data.items||[]).slice(0,2).forEach((item,index)=>insightCard(doc,52+index*251,y,239,210,index?"Что происходит внутри":"Как вас видят",stripLeadingLabel(item),index));if(data.paragraphs?.[0]){doc.y=460;pullQuote(doc,data.paragraphs[0]);}}
function legacyStress(doc,data){if(!data)return;page(doc,data.title,"Как меняется способ думать и действовать под давлением.",{kicker:"ПОД ДАВЛЕНИЕМ"});const labels=["Первая реакция","Где возникает ошибка","Как восстановить ясность"];(data.items||[]).slice(0,3).forEach((item,index)=>processStep(doc,index,labels[index],stripStep(item)));if(data.paragraphs?.[0]){doc.y=Math.max(doc.y,650);quietNote(doc,"Важно",data.paragraphs[0]);}}

function legacyCurrentPeriod(doc,data){if(!data)return;page(doc,"Текущий жизненный период",data.title,{kicker:"СЕЙЧАС"});const parsed=(data.items||[]).map(parseUpperItem);parsed.forEach((item,index)=>periodCell(doc,item,index));}
function legacyYears(doc,data){if(!data)return;page(doc,data.title,"Три последовательных фокуса, а не буквальный событийный прогноз.",{kicker:"БЛИЖАЙШИЙ ГОРИЗОНТ"});(data.items||[]).map(parseYear).forEach((item,index)=>yearCard(doc,item,index));}
function legacyTransitions(doc,data){if(!data)return;page(doc,data.title,"Поворотные точки, уже выделенные в сохранённом отчёте.",{kicker:"ДЛИННАЯ ПЕРСПЕКТИВА"});(data.items||[]).map(parseTransition).forEach((item,index)=>transitionRow(doc,item,index));}
function legacyScenarios(doc,data){if(!data)return;page(doc,data.title,"Сценарии показывают последствия разных способов использовать один и тот же потенциал.",{kicker:"ВЫБОР, А НЕ ПРЕДСКАЗАНИЕ"});const labels=["Устойчивый путь","Путь роста","Сценарий перегруза"];(data.items||[]).map(parseScenario).forEach((item,index)=>scenarioCard(doc,item,labels[index],index));}
function legacyMatrix(doc,data){if(!data)return;const rows=(data.items||[]).map(parseMatrixItem).filter(Boolean);[rows.slice(0,4),rows.slice(4)].filter(x=>x.length).forEach((group,pageIndex)=>{page(doc,pageIndex?"Матрица жизненных сфер · продолжение":"Матрица жизненных сфер",pageIndex?"Оставшиеся области сопоставления.":"Как Ба-цзы и Цзы Вэй дополняют друг друга в разных областях жизни.",{kicker:"ДВЕ СИСТЕМЫ"});group.forEach((item,index)=>matrixRow(doc,item,index));});}
function legacyStability(doc,data){if(!data)return;page(doc,data.title,"Методологическая прозрачность: где выводы устойчивы, а где важен жизненный контекст.",{kicker:"ГРАНИЦЫ ИНТЕРПРЕТАЦИИ"});(data.items||[]).forEach((item,index)=>stabilityBand(doc,item,index));}
function legacyActionPlan(doc,data){if(!data)return;page(doc,data.title,"Практические действия, уже сформулированные в сохранённом отчёте.",{kicker:"ПРАКТИЧЕСКИЙ ИТОГ"});(data.items||[]).forEach((item,index)=>actionColumn(doc,item,index));}
function legacyManifestations(doc,data){if(!data)return;page(doc,data.title,"Наблюдения, по которым выводы карты можно сопоставить с реальной жизнью.",{kicker:"УЗНАВАЕМЫЕ ПАТТЕРНЫ"});(data.items||[]).forEach((item,index)=>numberedObservation(doc,item,index));}
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
    const value=cleanNarrative(text);
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
function compactText(text,max=260){const value=cleanNarrative(text);return value.length<=max?value:`${value.slice(0,max).replace(/\s+\S*$/u,"")}…`;}
function validConsumerText(value){const text=cleanNarrative(value).replace(/\bв рамках этой символической интерпретации\s*/giu,"").trim();return text&&!/\b(?:undefined|null|nan)\b|(?:соединение|столкновение|сочетание|вред)\s*[-–—](?:\s|$)/iu.test(text)?text:"";}
function validEvidenceText(value){const text=clean(value).replace(/\bв рамках этой символической интерпретации\s*/giu,"").trim();return text&&!/\b(?:undefined|null|nan)\b|(?:соединение|столкновение|сочетание|вред)\s*[-–—](?=\s*(?:[·.;,]|$))/iu.test(text)?text:"";}
function prepareLegacySections(sections){return sections.map(section=>({...section,paragraphs:(section.paragraphs||[]).map(text=>normalizeSensitivity(text,section.key==="final")).filter(Boolean),items:(section.items||[]).map(text=>normalizeSensitivity(text,false)).filter(Boolean)}));}
function normalizeSensitivity(text,keep){const parts=sentences(text);let inserted=false;const timeWord="(?<!\\p{L})(?:час(?:а|у|ом|ов)?|время|времени|временем)(?!\\p{L})";const warning=new RegExp(`(?:(?:чувствительн\\p{L}*|точност\\p{L}*)[^.]{0,90}${timeWord}|${timeWord}[^.]{0,90}чувствительн\\p{L}*)`,"iu");return parts.map(sentence=>{if(!warning.test(sentence))return sentence.replace(/\bв рамках этой символической интерпретации\s*/iu,"");if(keep&&!inserted){inserted=true;return "Расчёт чувствителен к точности времени рождения, поэтому детали, связанные с конкретными датами и событиями, могут меняться при уточнении времени.";}return "";}).filter(Boolean).join(" ").trim();}
function splitByMarkers(text,markers){const source=String(text||"");const positions=markers.map(marker=>({marker,index:source.search(marker)})).filter(x=>x.index>=0).sort((a,b)=>a.index-b.index);const result={lead:positions.length?source.slice(0,positions[0].index).trim():source.trim()};positions.forEach((entry,index)=>{const start=entry.index+source.slice(entry.index).match(entry.marker)[0].length;const end=positions[index+1]?.index??source.length;result[entry.marker.source]=source.slice(start,end).trim();});return result;}
function splitLegacyTitle(prefix,bodyStart){const match=String(prefix).match(bodyStart);if(!match)return{title:compactText(prefix,70),body:""};return{title:prefix.slice(0,match.index).trim(),body:prefix.slice(match.index).trim()};}
function parseTrait(text){const number=String(text).match(/^(\d{2})\s+/)?.[1]||"";const raw=String(text).replace(/^\d{2}\s+/,"");const parts=splitByMarkers(raw,[/В\s+РЕСУРСЕ\s+/u,/В\s+ПЕРЕГРУЗЕ\s+/u,/Основания карты:\s*/u]);const main=splitLegacyTitle(parts.lead,/(?:Преобладание|Структура|Текущий|Финансовый|Связка)/u);return{number,title:main.title,description:main.body,strong:parts[/В\s+РЕСУРСЕ\s+/u.source],low:parts[/В\s+ПЕРЕГРУЗЕ\s+/u.source],evidence:validEvidenceText(parts[/Основания карты:\s*/u.source])};}
function parseStrength(text){const main=splitLegacyTitle(text,/(?:Способность|Влияние|Умение|Сочетание|Возможность)/u);const body=sentences(main.body);return{title:main.title,description:body.slice(0,-1).join(" ")||body[0]||"",action:body.length>1?body.at(-1):""};}
function parseChallenge(text){const raw=String(text);const when=raw.indexOf("Когда:");const risk=raw.indexOf("Риск:");if(when<0||risk<0)return{title:compactText(raw,80),when:"",risk:"",help:""};const title=raw.slice(0,when).trim();const whenText=raw.slice(when+6,risk).trim();const tail=raw.slice(risk+5).trim();const tailSentences=sentences(tail);return{title,when:whenText,risk:tailSentences[0]||tail,help:tailSentences.slice(1).join(" ")};}
function parseUpperItem(text){const match=String(text).match(/^([А-ЯЁ\s]+)\s+(.+)$/u);return{label:match?.[1]?.trim()||"Ключевая тема",text:match?.[2]||text};}
function parseYear(text){const year=String(text).match(/^\d{4}/)?.[0]||"";const rest=String(text).slice(year.length).trim();const focusIndex=rest.indexOf("Фокус:");const avoidIndex=rest.indexOf("Не форсировать:");const before=rest.slice(0,focusIndex>=0?focusIndex:rest.length).trim();const supportStart=before.search(/(?:Показать|Уточнить|Укрепить|Сделать|Выстроить|Проверить)\s/u);return{year,title:(supportStart>0?before.slice(0,supportStart):before).trim(),support:(supportStart>0?before.slice(supportStart):"").trim(),focus:focusIndex>=0?rest.slice(focusIndex+6,avoidIndex>=0?avoidIndex:rest.length).trim():"",avoid:avoidIndex>=0?rest.slice(avoidIndex+15).trim():""};}
function parseTransition(text){const match=String(text).match(/^(\d+\s+(?:лет|год|года))\s+([\d–-]+)\s+(.+)$/u);return{age:match?.[1]||"",years:match?.[2]||"",text:match?.[3]||text};}
function parseScenario(text){const match=String(text).match(/^(КОНСЕРВАТИВНЫЙ|РОСТ|ПЕРЕГРУЗ)\s+(.+)$/u);const body=match?.[2]||text;const parts=sentences(body);const intro=splitLegacyTitle(parts[0]||body,/(?:Вы|Фокус|Начать|Остановить)/u);return{type:match?.[1]||"",title:intro.title,text:[intro.body,...parts.slice(1,-1)].filter(Boolean).join(" "),action:parts.length>1?parts.at(-1):""};}
function parseMatrixItem(text){const source=String(text).replace(/\u00a0/g," ");const areas=["Карьера","Финансы","Отношения","Самовыражение","Окружение","Внутреннее состояние","Дом и перемены","Здоровье"];const area=areas.find(x=>source.startsWith(x));if(!area)return null;const rest=source.slice(area.length).trim();const alignment=["Согласие","Дополнение","Расхождение"].find(x=>rest.startsWith(x));if(!alignment)return null;return{area,alignment,text:rest.slice(alignment.length).trim()};}
function stripLeadingLabel(text){return String(text).replace(/^(?:СНАРУЖИ|ВНУТРИ)\s+/u,"");}
function stripStep(text){return String(text).replace(/^\d{2}\s+(?:Реакция|Ошибка|Восстановление)\s+/u,"");}

function pullQuote(doc,text){const value=validConsumerText(text);if(!value)return;doc.fillColor(colors.jade).font("Bold").fontSize(15).text(value,52,doc.y,{width:491,lineGap:6});doc.y+=18;}
function quietNote(doc,label,text){const value=validConsumerText(text);if(!value)return;doc.roundedRect(52,doc.y,491,70,7).fill(colors.sand);doc.fillColor(colors.gold).font("Bold").fontSize(8).text(clean(label).toUpperCase(),68,doc.y+14,{width:130});doc.fillColor(colors.ink).font("Body").fontSize(9.5).text(value,170,doc.y+13,{width:355,lineGap:3});doc.y+=82;}
function insightCard(doc,x,y,w,h,label,text,variant=0){doc.roundedRect(x,y,w,h,8).fill(variant%2?colors.sand:colors.sage);doc.fillColor(colors.gold).font("Bold").fontSize(7.6).text(clean(label).toUpperCase(),x+16,y+16,{width:w-32});doc.fillColor(colors.ink).font("Body").fontSize(9.2).text(validConsumerText(text),x+16,y+44,{width:w-32,height:h-56,lineGap:3,ellipsis:true});}
function editorialBlockHeight(doc,text){const value=validConsumerText(text);doc.font("Body").fontSize(9.6);return Math.max(86,doc.heightOfString(value,{width:491,lineGap:3})+48)+8;}
function editorialBlock(doc,heading,text,index){const value=validConsumerText(text);if(!value)return;const height=editorialBlockHeight(doc,value)-8;const y=doc.y;doc.fillColor(colors.gold).font("Bold").fontSize(8).text(`${String(index+1).padStart(2,"0")} · ${clean(heading).toUpperCase()}`,52,y,{width:460});doc.fillColor(colors.ink).font("Body").fontSize(9.6).text(value,52,y+24,{width:491,lineGap:3});doc.y=y+height+8;doc.moveTo(52,doc.y-2).lineTo(543,doc.y-2).strokeColor("#dde1dc").stroke();}
function traitCard(doc,item,index){const evidence=validEvidenceText(item.evidence);const height=evidence?245:205;ensure(doc,height+12);const y=doc.y;doc.roundedRect(52,y,491,height,9).fill(index%2?colors.sand:colors.sage);doc.fillColor(colors.gold).font("Bold").fontSize(10).text(item.number||String(index+1).padStart(2,"0"),70,y+18);doc.fillColor(colors.ink).font("Bold").fontSize(16).text(clean(item.title),112,y+15,{width:410});doc.fillColor(colors.ink).font("Body").fontSize(9.5).text(validConsumerText(item.description),70,y+52,{width:451,lineGap:3});const splitY=y+112;doc.fillColor(colors.jade).font("Bold").fontSize(7.5).text("В СИЛЬНОЙ ПОЗИЦИИ",70,splitY);doc.fillColor(colors.ink).font("Body").fontSize(8.7).text(validConsumerText(item.strong),70,splitY+18,{width:210,lineGap:2});doc.fillColor(colors.red).font("Bold").fontSize(7.5).text("КОГДА РЕСУРСА МАЛО",305,splitY);doc.fillColor(colors.ink).font("Body").fontSize(8.7).text(validConsumerText(item.low),305,splitY+18,{width:216,lineGap:2});if(evidence){doc.fillColor(colors.muted).font(doc._tianMingBrandFont).fontSize(7.3).text(`Почему карта на это указывает · ${evidence}`,70,y+height-40,{width:451,lineGap:2});}doc.y=y+height+12;}
function resourceCard(doc,item,index){ensure(doc,150);const y=doc.y;doc.fillColor(colors.gold).font("Bold").fontSize(8).text(String(index+1).padStart(2,"0"),52,y+4);doc.fillColor(colors.jade).font("Bold").fontSize(15).text(clean(item.title).toUpperCase(),88,y,{width:440});doc.fillColor(colors.ink).font("Body").fontSize(9.5).text(validConsumerText(item.description),88,y+29,{width:455,lineGap:3});if(item.action){doc.fillColor(colors.gold).font("Bold").fontSize(7.5).text("КАК ИСПОЛЬЗОВАТЬ",88,y+84);doc.fillColor(colors.muted).font("Body").fontSize(8.8).text(validConsumerText(item.action),190,y+82,{width:353,lineGap:3});}doc.moveTo(52,y+136).lineTo(543,y+136).strokeColor("#d8ded9").stroke();doc.y=y+150;}
function challengeCard(doc,item,index){ensure(doc,170);const y=doc.y;doc.roundedRect(52,y,491,156,8).lineWidth(1).strokeColor("#d8ded9").stroke();doc.rect(52,y,5,156).fill(index%2?colors.gold:colors.red);doc.fillColor(colors.ink).font("Bold").fontSize(14).text(clean(item.title),72,y+16,{width:450});[["КОГДА ПРОЯВЛЯЕТСЯ",item.when],["ЧТО ПРОИСХОДИТ",item.risk],["ЧТО ПОМОГАЕТ",item.help]].forEach(([label,text],i)=>{doc.fillColor(i===1?colors.red:colors.gold).font("Bold").fontSize(7).text(label,72,y+51+i*31,{width:116});doc.fillColor(colors.ink).font("Body").fontSize(8.3).text(validConsumerText(text),194,y+49+i*31,{width:329,height:28,lineGap:2,ellipsis:true});});doc.y=y+170;}
function processStep(doc,index,label,text){const y=doc.y;doc.circle(73,y+20,20).fill(index===1?colors.sand:colors.sage);doc.fillColor(colors.gold).font("Bold").fontSize(9).text(String(index+1).padStart(2,"0"),61,y+15,{width:24,align:"center"});doc.fillColor(colors.jade).font("Bold").fontSize(13).text(label,112,y,{width:420});doc.fillColor(colors.ink).font("Body").fontSize(9.5).text(validConsumerText(text),112,y+25,{width:420,lineGap:3});doc.y=y+115;}
function periodCell(doc,item,index){const col=index%2,row=Math.floor(index/2),x=52+col*251,y=218+row*164;insightCard(doc,x,y,239,148,item.label,item.text,index);doc.y=Math.max(doc.y,y+160);}
function yearCard(doc,item,index){const x=52+index*166,y=224,w=154,h=430;doc.roundedRect(x,y,w,h,9).fill(index===1?colors.sage:colors.sand);doc.fillColor(colors.gold).font("Bold").fontSize(26).text(item.year,x+16,y+18,{width:w-32});doc.fillColor(colors.ink).font("Bold").fontSize(12).text(clean(item.title),x+16,y+66,{width:w-32,height:55});[["ЧТО ПОДДЕРЖИВАЕТ",item.support],["ФОКУС",item.focus],["НЕ ФОРСИРОВАТЬ",item.avoid]].forEach(([label,text],i)=>{const sy=y+145+i*92;doc.fillColor(i===2?colors.red:colors.gold).font("Bold").fontSize(6.7).text(label,x+16,sy,{width:w-32});doc.fillColor(colors.ink).font("Body").fontSize(7.8).text(validConsumerText(text),x+16,sy+18,{width:w-32,height:70,lineGap:2,ellipsis:true});});}
function transitionRow(doc,item,index){const y=doc.y;doc.moveTo(92,y).lineTo(92,y+94).lineWidth(2).strokeColor("#d8ded9").stroke();doc.circle(92,y+18,index===2?8:5).fill(index===2?colors.red:colors.gold);doc.fillColor(colors.gold).font("Bold").fontSize(9).text(item.age,52,y+8,{width:30,align:"right"});doc.fillColor(colors.jade).font("Bold").fontSize(12).text(item.years,120,y+4,{width:90});doc.fillColor(colors.ink).font("Body").fontSize(9).text(validConsumerText(item.text),220,y+2,{width:323,lineGap:3});doc.y=y+100;}
function scenarioCard(doc,item,label,index){const x=52+index*166,y=230,w=154,h=420;doc.roundedRect(x,y,w,h,9).fill(index===2?"#eee6df":index===1?colors.sage:colors.sand);doc.fillColor(index===2?colors.red:colors.gold).font("Bold").fontSize(7.2).text(label.toUpperCase(),x+16,y+18,{width:w-32});doc.fillColor(colors.ink).font("Bold").fontSize(13).text(clean(item.title),x+16,y+55,{width:w-32});doc.fillColor(colors.ink).font("Body").fontSize(8.3).text(validConsumerText(item.text),x+16,y+120,{width:w-32,height:180,lineGap:3,ellipsis:true});doc.fillColor(colors.gold).font("Bold").fontSize(7).text("ОРИЕНТИР",x+16,y+322);doc.fillColor(colors.muted).font("Body").fontSize(7.7).text(validConsumerText(item.action),x+16,y+342,{width:w-32,height:65,lineGap:2,ellipsis:true});}
function matrixRow(doc,item,index){ensure(doc,135);const y=doc.y;doc.fillColor(colors.jade).font("Bold").fontSize(12).text(clean(item.area),52,y,{width:135});doc.fillColor(item.alignment==="Расхождение"?colors.red:colors.gold).font("Bold").fontSize(7.3).text(item.alignment.toUpperCase(),52,y+38,{width:130});doc.fillColor(colors.ink).font("Body").fontSize(8.7).text(validConsumerText(item.text),205,y,{width:338,height:112,lineGap:2.5,ellipsis:true});doc.moveTo(52,y+122).lineTo(543,y+122).strokeColor("#d8ded9").stroke();doc.y=y+136;}
function stabilityBand(doc,item,index){const labels=["Хорошо подтверждается картой","Требует дополнительного контекста","Не стоит воспринимать буквально"];const text=String(item).replace(new RegExp(`^${labels[index]}\\s*[-—–]\\s*`),"");const y=doc.y,h=index===1?160:135;doc.roundedRect(52,y,491,h,8).fill(index===0?colors.sage:index===1?colors.sand:"#eee6df");doc.fillColor(index===2?colors.red:colors.gold).font("Bold").fontSize(8).text(labels[index].toUpperCase(),70,y+18,{width:455});doc.fillColor(colors.ink).font("Body").fontSize(9.3).text(validConsumerText(text),70,y+48,{width:455,height:h-60,lineGap:3,ellipsis:true});doc.y=y+h+14;}
function actionColumn(doc,item,index){const label=index?"Чего избегать":"Делать чаще";const text=String(item).replace(new RegExp(`^${index?"Избегать":"Делать чаще"}\\s+`),"");const values=sentences(text);const x=52+index*251,y=230,w=239;doc.fillColor(index?colors.red:colors.jade).font("Bold").fontSize(14).text(label,x,y,{width:w});values.forEach((value,i)=>{const iy=y+45+i*82;doc.fillColor(colors.gold).font("Bold").fontSize(8).text(String(i+1).padStart(2,"0"),x,iy);doc.fillColor(colors.ink).font("Body").fontSize(8.7).text(validConsumerText(value),x+34,iy-2,{width:w-34,height:72,lineGap:2.5,ellipsis:true});});}
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
    ["Дневной хозяин", `${dayMasters[chart.bazi.dayMaster] || "Дневной хозяин"} · ${chart.bazi.dayMaster}`, "Центральный элемент личности в системе Ба-цзы"],
    ["Структура карты", `${chart.bazi.structureDisplay.name.replace(/^Структура\s*/, "")} · ${chart.bazi.structureDisplay.original}`, "Способ организации основного потенциала карты"],
    ["Баланс карты", chart.bazi.strength.display.name.replace(/\s+карта$/iu, ""), "Показывает, насколько Дневной хозяин поддержан остальными элементами"],
  ];
  summaries.forEach(([label, value, note], index) => {
    const x = 52 + index * 166;
    doc.roundedRect(x, 374, 156, 92, 6).lineWidth(1).strokeColor("#d8ded9").stroke();
    doc.fillColor(colors.gold).font("Bold").fontSize(7.5).text(label.toUpperCase(), x + 12, 390, { width: 132 });
    doc.fillColor(colors.ink).font(hasCjk && /[\u3400-\u9FFF]/.test(String(value)) ? "CJK" : "Bold").fontSize(10.5).text(clean(value), x + 12, 410, { width: 132, height:30 });
    doc.fillColor(colors.muted).font("Body").fontSize(7.1).text(clean(note), x + 12, 443, { width: 132, height:26, lineGap:1 });
  });

  doc.fillColor(colors.ink).font("Bold").fontSize(16).text("Баланс пяти элементов", 52, 505);
  const max = Math.max(...chart.bazi.elementsDisplay.map(item => Number(item.value)), 1);
  chart.bazi.elementsDisplay.forEach((item, index) => {
    const y = 548 + index * 38;
    doc.fillColor(colors.ink).font("Bold").fontSize(9).text(item.name, 52, y, { width: 82 });
    doc.fillColor(colors.gold).font(hasCjk ? "CJK" : "Body").fontSize(9).text(item.original, 122, y, { width: 24 });
    doc.roundedRect(158, y + 1, 330, 10, 5).fill("#e7e7e1");
    doc.roundedRect(158, y + 1, Math.max(4, 330 * Number(item.value) / max), 10, 5).fill(index === 2 ? colors.red : colors.jade);
    doc.fillColor(colors.ink).font("Bold").fontSize(9).text(String(item.value), 505, y, { width: 35, align: "right" });
  });
}

function appendixDividerPage(doc) {
  doc.addPage();
  doc.rect(0,0,doc.page.width,doc.page.height).fill(colors.sand);
  doc.fillColor(colors.gold).font(doc._tianMingBrandFont).fontSize(10).text("ТЯНЬ МИН · 天命",52,54,{characterSpacing:1.1});
  doc.fillColor(colors.jade).font("Bold").fontSize(11).text("ПРИЛОЖЕНИЕ",52,210,{characterSpacing:1.8});
  doc.fillColor(colors.ink).font("Bold").fontSize(34).text("Подробная карта",52,250,{width:480});
  doc.fillColor(colors.muted).font("Body").fontSize(12).text("Профессиональный слой отчёта: большие периоды Ба-цзы, двенадцать дворцов Цзы Вэй и исходные китайские обозначения.",52,332,{width:430,lineGap:6});
  doc.moveTo(52,445).lineTo(543,445).strokeColor("#d4cbb9").stroke();
  doc.fillColor(colors.gold).font(doc._tianMingBrandFont).fontSize(42).text("八字  ·  紫微斗数",52,500,{width:491,align:"center"});
}

function luckTimelinePage(doc, chart, hasCjk) {
  page(doc, "Большие жизненные периоды", "Последовательные десятилетние этапы карты Ба-цзы. Выделен период, включающий текущий календарный год.");
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
  const groups=[chart.ziwei.palaces.slice(0,6),chart.ziwei.palaces.slice(6)];
  groups.forEach((palaces,pageIndex)=>{
  page(doc, pageIndex?"Цзы Вэй: двенадцать дворцов · продолжение":"Цзы Вэй: двенадцать дворцов", pageIndex?"Оставшиеся шесть дворцов подробной карты.":"Русское название показано первым. Китайские обозначения сохранены как профессиональный слой.", { kicker:"ЦЗЫ ВЭЙ ДОУ ШУ" });
  if(pageIndex===0){
  const lunar=formatLunarDate(chart.ziwei.lunarDateDisplay);
  const bureauElement=String(chart.ziwei.fiveElementBureau||"")[0];
  const facts = [
    ["Лунная дата", lunar], ["Дворец судьбы", chart.ziwei.mingPalace],
    ["Дворец тела", chart.ziwei.shenPalace], ["Система элементов", `${chart.ziwei.fiveElementBureauDisplay.name.replace(/^Система элемента\s*[«"]?|[»"]$/gu,"")} · ${bureauElement}`],
  ];
  facts.forEach(([label, value], index) => {
    const col=index%2,row=Math.floor(index/2),x=52+col*251,y=188+row*76;
    doc.roundedRect(x,y,239,66,7).fill(index%2?colors.sand:colors.sage);
    doc.fillColor(colors.gold).font("Bold").fontSize(7).text(label.toUpperCase(),x+14,y+12,{width:100});
    doc.fillColor(colors.ink).font(hasCjk&&/[\u3400-\u9FFF]/.test(String(value))?"CJK":"Bold").fontSize(10).text(clean(value),x+114,y+11,{width:110,height:45,lineGap:2});
  });
  if (chart.ziwei.transformationsDisplay.length) {
    doc.fillColor(colors.muted).font("Body").fontSize(7.5).text(`Четыре трансформации: ${chart.ziwei.transformationsDisplay.map(item => item.name).join(" · ")}`, 52, 342, { width: 491 });
  }
  }
  palaces.forEach((palace, index) => {
    const col = index % 2, row = Math.floor(index / 2);
    const x = 52 + col * 251, y = (pageIndex?205:380) + row * 128;
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

function formatLunarDate(value){const match=String(value).match(/(\d{4})\s+год\s+·\s+(\d+)-й\s+лунный месяц\s+·\s+(\d+)-й\s+день/u);return match?`${match[3]}-й день · ${match[2]}-й месяц · ${match[1]}`:value;}

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

function section(doc, title, text) { page(doc, title); bodyText(doc, text); }

function cards(doc, title, items, formatter, { continuePage = false } = {}) {
  if (continuePage) subheading(doc, title); else page(doc, title);
  items.forEach((item, index) => {
    const text = cleanNarrative(formatter(item, index));
    doc.font("Body").fontSize(9.5);
    const height = doc.heightOfString(text, { width: 459, lineGap: 2 }) + 22;
    if (doc.y + height + 10 > 770) page(doc, `${title} - продолжение`);
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
    .replace(/[\u3400-\u9FFF]+/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]+([;,:.])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
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
