const test = require("node:test");
const assert = require("node:assert/strict");
const pdfParse = require("pdf-parse");
const { locationProvider } = require("../lib/location-provider.cjs");
const { buildReportContext } = require("../lib/report-service.cjs");
const { calculateBirthChart } = require("../lib/birth-chart-pipeline.cjs");
const { toChartView } = require("../lib/chart-view.cjs");
const { createMockReport } = require("../lib/mock-report.cjs");
const { createPdfFilename, createPdfFromSavedReport, createPdfRequest, safeFilenamePart } = require("../lib/pdf-service.cjs");
const { buildReviewVariants, buildLongStressVariant } = require("../scripts/generate-sample-pdf.cjs");

const moscow = locationProvider.search("Москва")[0];
const input = { name: "Эдуард", date: "2000-01-01", time: "12:00", gender: "male", placeId: moscow.id };

function consecutiveTextDuplicates(value,path=[],issues=[]) {
  if(typeof value==="string"){
    const parts=value.split(/(?<=[.!?])\s+|\n+/u).map(part=>part.trim()).filter(part=>part.length>=24);
    for(let index=1;index<parts.length;index++){
      const previous=parts[index-1].toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{N}]+/gu," ").trim();
      const current=parts[index].toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{N}]+/gu," ").trim();
      if(previous===current)issues.push(`${path.join(".")}: ${parts[index]}`);
    }
    return issues;
  }
  if(Array.isArray(value)){
    for(let index=1;index<value.length;index++){
      if(typeof value[index-1]==="string"&&typeof value[index]==="string"&&value[index-1].trim()===value[index].trim())issues.push(`${path.join(".")}: ${value[index]}`);
    }
    value.forEach((item,index)=>consecutiveTextDuplicates(item,[...path,String(index)],issues));
    return issues;
  }
  if(value&&typeof value==="object")for(const [key,item] of Object.entries(value))consecutiveTextDuplicates(item,[...path,key],issues);
  return issues;
}

test("v4 PDF является самостоятельным premium-документом с TOC, metadata и всеми разделами", async () => {
  const calculation = calculateBirthChart(input);
  const report = createMockReport(buildReportContext(calculation, { displayName: input.name }, { model: "mock-v1", reportYears: [2026, 2027, 2028] }));
  const result = await createPdfRequest({ ...input, report }, { hasFullReport: true });
  assert.equal(result.status, 200);
  assert.equal(result.buffer.subarray(0, 5).toString(), "%PDF-");
  assert.equal(result.buffer.length > 50000, true);
  const parsed = await pdfParse(result.buffer);
  assert.match(parsed.text, /ТЯНЬ МИН/);
  assert.match(parsed.text, /Эдуард/);
  assert.match(parsed.text, /ПЕРСОНАЛЬНЫЙ РАЗБОР/i);
  assert.match(parsed.text, /Содержание/);
  assert.match(parsed.text, /Ваш портрет в двух минутах/);
  assert.match(parsed.text, /Ваша карта · Ба-цзы/);
  assert.match(parsed.text, /Ваша карта · Пять элементов/);
  assert.match(parsed.text, /Ваша карта · Цзы Вэй/);
  assert.match(parsed.text, /Ваше место на временной карте/);
  assert.match(parsed.text, /Как читать этот отчёт/);
  assert.match(parsed.text, /ОСНОВАНИЯ ВАШЕГО РАЗБОРА/i);
  assert.match(parsed.text, /Баланс и структура Ба-цзы/);
  assert.match(parsed.text, /Двенадцать дворцов Цзы Вэй/);
  assert.match(parsed.text, /Временные шкалы/);
  assert.match(parsed.text, /Характер и внутренние мотивы/);
  assert.match(parsed.text, /Сильные стороны/);
  assert.match(parsed.text, /Точки роста/);
  assert.match(parsed.text, /Роль, где можно влиять на качество/);
  assert.match(parsed.text, /Деньги и управление ресурсами/);
  assert.match(parsed.text, /Отношения и границы/);
  assert.match(parsed.text, /Как вас видят/);
  assert.match(parsed.text, /Ключевые переходы/);
  assert.match(parsed.text, /Где Ба-цзы и Цзы Вэй/);
  assert.match(parsed.text, /Возможные сценарии/);
  assert.match(parsed.text, /Ближайшие три года/);
  assert.match(parsed.text, /Персональный план на 12 месяцев/);
  assert.match(parsed.text, /Итоговая персональная линия/);
  assert.match(parsed.text, /Москва, Россия/);
  assert.equal(parsed.numpages >= 30 && parsed.numpages <= 36, true, `Получилось ${parsed.numpages} страниц`);
  assert.equal(parsed.info.Title,"Эдуард - Ба-цзы + Цзы Вэй Доу Шу · Персональный разбор");
  assert.equal(parsed.info.Author,"Тянь Мин");
  assert.match(parsed.info.Keywords,/personal-report-v4/);
  assert.equal(result.buffer.toString("latin1").includes("/Outlines"),true);
  const normalizedText=parsed.text.replace(/\s+/gu," ");
  const opening=["Содержание","Ваша карта · Ба-цзы","Ваша карта · Пять элементов","Ваша карта · Цзы Вэй","Ваше место на временной карте","Ваш портрет в двух минутах","Как читать этот отчёт"].map((title,index)=>index===0?normalizedText.indexOf(title):normalizedText.lastIndexOf(title));
  assert.equal(opening.every((position,index)=>position>=0&&(index===0||position>opening[index-1])),true,opening.join(" < "));
  assert.equal(parsed.text.indexOf("Характер и внутренние мотивы") < parsed.text.lastIndexOf("Баланс и структура Ба-цзы"),true);
  assert.equal(parsed.text.indexOf("Итоговая персональная линия") < parsed.text.lastIndexOf("ОСНОВАНИЯ ВАШЕГО РАЗБОРА"),true);
  assert.match(parsed.text,/РАССЧИТАНО[\s\S]*ИНТЕРПРЕТАЦИЯ[\s\S]*ПРИМЕНЕНИЕ/i);
  assert.match(parsed.text,/Хуа Лу[\s\S]{0,100}РЕСУРС И ВОЗМОЖНОСТИ/i);
  assert.doesNotMatch(parsed.text, /\b(?:BaZi|Bazi|Zi\s*Wei|ZiWei|undefined|null|NaN)\b/i);
  assert.doesNotMatch(parsed.text,/\[object Object\]/i);
  assert.doesNotMatch(parsed.text, /(?:bazi|ziwei|time)\.[a-z0-9_.-]+/i);
  assert.doesNotMatch(parsed.text, /[\u0000\uFFFD\uFFFE\uFFFF]/u);
  assert.doesNotMatch(parsed.text, /\b(?:произойдёт|вас ждёт|точно случится)\b/iu);
  assert.doesNotMatch(parsed.text, /TRUE_SOLAR_TIME_V1|Equation of Time|AI-интерпретация/);
  assert.doesNotMatch(parsed.text, /raw JSON|evidence ID|calculation core|provider|parser|renderer/i);
  assert.match(parsed.text,/Легенда технической силы[\s\S]{0,120}得令\s*[—-]\s*сезонная поддержка[\s\S]{0,260}得势\s*[—-]\s*поддержка\s+общей конфигурации/i);
});

test("PDF создаётся без персонального разбора и сохраняет рассчитанную карту", async () => {
  const result = await createPdfRequest(input, { hasFullReport: true });
  assert.equal(result.status, 200);
  const parsed = await pdfParse(result.buffer);
  assert.match(parsed.text, /Персональный разбор ещё не/);
  assert.match(parsed.text, /Ваша карта в одном взгляде/);
  assert.match(parsed.text, /Двенадцать дворцов Цзы Вэй/);
  assert.doesNotMatch(parsed.text, /TRUE_SOLAR_TIME_V1|Equation of Time|AI|техническ/i);
});

test("PDF безопасно принимает длинное русское имя", async () => {
  const longName = "Александра-Мария Константиновна Мирославская";
  const result = await createPdfRequest({ ...input, name: longName }, { hasFullReport: true });
  assert.equal(result.status, 200);
  const parsed = await pdfParse(result.buffer);
  assert.match(parsed.text, /Александра-Мария/);
});

test("PDF сохраняет китайские оригинальные обозначения", async () => {
  const result = await createPdfRequest(input, { hasFullReport: true });
  assert.equal(result.status, 200);
  const parsed = await pdfParse(result.buffer);
  assert.match(parsed.text, /紫微/);
  assert.match(parsed.text, /正财\s*格/);
});

test("PDF-инфографика использует реальные столпы, элементы и периоды карты", async () => {
  const calculation = calculateBirthChart(input);
  const result = await createPdfRequest(input, { hasFullReport: true });
  const parsed = await pdfParse(result.buffer);
  const chart = calculation.chart;
  for (const pillar of Object.values(chart.bazi.siZhu)) assert.match(parsed.text, new RegExp(`${pillar.gan}${pillar.zhi}`));
  for (const period of chart.bazi.dayun.slice(0, 6)) assert.match(parsed.text, new RegExp(period.ganZhi));
  for (const palace of toChartView(chart).ziwei.palaces) {
    const pattern = palace.displayName.name.split(/\s+/u).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    assert.match(parsed.text, new RegExp(pattern));
  }
  assert.match(parsed.text, /Четыре трансформации/i);
});

test("consumer PDF удаляет пустые evidence-значения целиком", async () => {
  const saved = {
    kind: "legacy-rendered-report",
    input,
    presentation: { displayName: input.name },
    sections: [
      { key: "archetype", title: "Спокойный стратег", paragraphs: ["Знания превращаются в ясные решения."] },
      { key: "executive", title: "Главное о вас", paragraphs: ["Вы внимательно изучаете ситуацию.", "Вам важна ясность.", "Перегруз может мешать.", "Сейчас важна последовательность."] },
      { key: "traits", title: "Ваш характер в деталях", items: ["01 Наблюдательность Преобладание внимания к деталям. В РЕСУРСЕ Видите связи. В ПЕРЕГРУЗЕ Долго проверяете решение. Основания карты: соединение - и вред -."] },
      { key: "final", title: "Ваша главная линия", paragraphs: ["Ваша опора — ясность и последовательность."] },
    ],
  };
  const result = await createPdfFromSavedReport(saved);
  assert.equal(result.status, 200);
  const parsed = await pdfParse(result.buffer);
  assert.doesNotMatch(parsed.text, /\b(?:undefined|null|NaN)\b/i);
  assert.doesNotMatch(parsed.text, /(?:соединение|столкновение|сочетание|вред)\s*[-–—](?:\s|$)/i);
});

test("редакционный PDF очищает внутренние формулировки, Unicode и сохраняет последовательную нумерацию", async () => {
  const saved = {
    kind: "legacy-rendered-report",
    input,
    presentation: { displayName: input.name },
    sections: [
      { key: "archetype", title: "Спокойный стратег", paragraphs: ["Знания → ясное решение → устойчивый результат."] },
      { key: "executive", title: "Главное о вас", paragraphs: [
        "Этот отчёт основан на двух системах — это методическое пояснение. Главная объединяющая тема карты — ясность и последовательность. Лучше раскрывается там, где знания становятся результатом.",
        "Оценка силы обозначена как низкая. Давление ожиданий может истощать.",
        "Особенно заметна способность соединять людей.",
        "Практическая формула периода — ясные договорённости.",
      ] },
      { key: "traits", title: "Ваш характер в деталях", items: [
        "01 Наблюдательность Преобладание внимания к деталям. В РЕСУРСЕ Видите связи. В ПЕРЕГРУЗЕ Долго проверяете решение. Основания карты: Ба-цзы: первый признак. · Ба-цзы: второй длинный признак проверяет перенос строки и увеличение высоты блока без наложения на соседнее основание.",
        "02 Ответственность Структура помогает держать рамку. В РЕСУРСЕ Соблюдаете договорённости. В ПЕРЕГРУЗЕ Берёте лишнюю ответственность. Основания карты: Ба-цзы: один короткий признак.",
      ] },
      { key: "career", title: "Работа и рост", paragraphs: [
        "Контекст роли. Структура «Прямой чиновник» часто интерпретируется как чувствительность к стандарту, обязательствам и репутации.",
        "Тянь Тун часто интерпретируется как потребность в человеческом формате работы.",
        "Символически это сочетание рыночных возможностей с конкуренцией, равными партнёрами и необходимостью делить ресурс.",
      ] },
      { key: "relationships", title: "Близость, выбор и конфликты", paragraphs: [
        "Первый вводный смысл. Первый реальный смысловой пункт.",
        "Второй реальный смысловой пункт.",
        "Третий реальный смысловой пункт.",
        "Ба-цзы: Конфликт 申–寅 может отражать разные внутренние импульсы.",
        "Высокая чувствительность расчёта к часу рождения требует снизить уверенность.",
        "Шестой исходный, но пятый отображаемый смысловой пункт.",
      ] },
      { key: "environment", title: "", items: ["ЧТО УСИЛИВАЕТ Уникальная проверочная фраза о подходящей среде."] },
      { key: "leadership", title: "", items: ["СТИЛЬ Уникальная проверочная фраза о стиле лидерства."] },
      { key: "lifestyle", title: "", items: ["РИТМ Уникальная проверочная фраза о жизненном ритме."] },
      { key: "matrix", title: "Матрица жизненных сфер", items: ["Окружение Согласие Ба-цзы Конфликт 申–寅 может отражать напряжение. Экспертно\uFFFEструктурные роли поддерживают результат.", "Цзы Вэй Доу Шу Тань Лан во дворце уязвимостей напоминает о режиме."] },
      { key: "cross-validation", title: "Где выводы устойчивее", items: ["Подтверждают Уникальная проверочная фраза о согласовании систем."] },
      { key: "confidence", title: "Насколько устойчивы выводы", items: ["Хорошо подтверждается картой — Основная линия.", "Требует дополнительного контекста — Детали периода.", "Не стоит воспринимать буквально — Конкретные даты брака, переезда, крупных потерь или болезней. Таких данных расчёт не подтверждает; высокая чувствительность расчёта не позволяет делать точные событийные заявления."] },
      { key: "manifestations", title: "Как это проявляется в жизни", items: ["Уникальная проверочная фраза о проявлении в жизни."] },
      { key: "action-plan", title: "План действий", items: [
        "Делать чаще Короткий пункт. Длинный пункт проверяет перенос строки в левой колонке и корректный расчёт общей высоты контейнера. Третий пункт.",
        "Избегать Один пункт справа.",
      ] },
      { key: "final", title: "Ваша главная линия", paragraphs: ["В рамках этой символической интерпретации ваша опора — ясность."] },
    ],
  };
  const result = await createPdfFromSavedReport(saved);
  assert.equal(result.status, 200);
  const parsed = await pdfParse(result.buffer);
  assert.equal((parsed.text.match(/Главное о вас/g) || []).length, 1);
  assert.doesNotMatch(parsed.text, /Этот отчёт основан|в рамках этой символической интерпретации|ПЕРСОНАЛЬНЫЙ СИНТЕЗ|Профессиональный слой отчёта|Русское название показано первым/i);
  assert.doesNotMatch(parsed.text, /(?:Конфликт|Соединение|Столкновение|Сочетание|Вред)\s*[-–—](?:\s|$)/i);
  assert.doesNotMatch(parsed.text, /[\u00AD\u200B-\u200D\u2060\uFFFD\uFFFE\uFFFF]/u);
  assert.doesNotMatch(parsed.text, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u);
  assert.doesNotMatch(parsed.text, /\b(?:undefined|null|NaN|sensitivity)\b|следует воспринимать особенно осторожно/i);
  const relationships = parsed.text.slice(parsed.text.indexOf("Близость, выбор и конфликты"), parsed.text.indexOf("Матрица жизненных сфер"));
  for (const number of ["01", "02", "03", "04", "05"]) assert.match(relationships, new RegExp(`${number}\\s*·`));
  assert.doesNotMatch(relationships, /06\s*·/);
  assert.equal((parsed.text.match(/Материалы предназначены для информационных, культурных/g) || []).length, 1);
  assert.match(parsed.text, /Здоровье[\s\S]{0,120}Тань Лан/);
  assert.match(parsed.text, /Здоровье[\s\S]{0,80}ДАННЫЕ ЦЗЫ ВЭЙ/i);
  assert.match(parsed.text, /ОСНОВАНИЕ В КАРТЕ[\s\S]{0,120}первый признак/i);
  assert.match(parsed.text, /первый признак[\s\S]{0,220}второй длинный признак/i);
  assert.doesNotMatch(parsed.text, /Почему карта на это указывает\s*·/i);
  assert.match(parsed.text, /экспертные и\s+структурные роли/i);
  assert.doesNotMatch(parsed.text, /взаимодействие элементов,\s*взаимодействие элементов/i);
  assert.doesNotMatch(parsed.text, /не буквальный событийный прогноз|сохран[её]нн\p{L}* отч[её]т/iu);
  assert.doesNotMatch(parsed.text, /Оценка\s*-?\d/i);
  for (const phrase of ["подходящей среде", "стиле лидерства", "жизненном ритме", "согласовании систем", "проявлении в жизни"]) assert.match(parsed.text, new RegExp(phrase, "i"));
  assert.match(parsed.text, /Практическая самопроверка[\s\S]{0,100}Сверьте выводы с вашей реальной жизнью/i);
  assert.equal((parsed.text.match(/Практическая самопроверка/gi) || []).length, 1);
  assert.match(parsed.text, /Структура «Прямой чиновник» связана с чувствительностью к стандарту/i);
  assert.match(parsed.text, /Тянь Тун часто связывают с потребностью в человеческом формате работы/i);
  assert.match(parsed.text, /Это сочетание связывают с рыночными возможностями, конкуренцией, партнёрством и\s+необходимостью делить ресурсы/i);
  assert.match(parsed.text, /Где важен дополнительный контекст[\s\S]{0,250}В вопросах брака, переезда и других крупных жизненных событий/i);
  assert.equal(parsed.text.indexOf("Большие жизненные периоды") < parsed.text.indexOf("Главное о вас"), true);
  assert.equal(parsed.text.lastIndexOf("Ваша главная линия") > parsed.text.lastIndexOf("Большие жизненные периоды"), true);
  assert.doesNotMatch(parsed.text, /Продолжение|—\s*—|–\s*–|--|бизнес(?:\uFFFE)?анализ|экспертно(?:\uFFFE)?структурные|Требуют осторожности|высокая чувствительность расчёта|более осторожный вывод|более безопасный сценарий|следует трактовать осторожно|гарантированный сценарий|крупных потерь|болезней/iu);
});

test("PDF-рендерер принимает короткие и длинные смысловые блоки без потери финала", async () => {
  const calculation = calculateBirthChart(input);
  const shortReport = createMockReport(buildReportContext(calculation, { displayName: input.name }, { model: "mock-v1" }));
  shortReport.career.summary = "Короткий вывод.";
  const shortPdf = await createPdfRequest({ ...input, report: shortReport }, { hasFullReport: true });
  assert.equal(shortPdf.status, 200);
  const longReport = structuredClone(shortReport);
  longReport.relationships.summary = Array(35).fill("Развёрнутый абзац проверяет перенос текста и сохранение читаемой структуры страницы.").join(" ");
  const longPdf = await createPdfRequest({ ...input, report: longReport }, { hasFullReport: true });
  assert.equal(longPdf.status, 200);
  const parsed = await pdfParse(longPdf.buffer);
  assert.match(parsed.text, /Информационно-развлекательный персональный отчёт/);
  assert.match(parsed.text, /Раньше проговаривать ожидания/);
});

test("review pair использует единую текущую точку и не обрывает critical hero copy", async () => {
  const [exact,approximate]=buildReviewVariants();
  const referenceYear=new Date().getUTCFullYear();
  assert.deepEqual(exact.report.yearlyOutlook.map(value=>value.year),[referenceYear,referenceYear+1,referenceYear+2]);
  assert.deepEqual(exact.report,approximate.report,"certainty metadata не должна менять рассчитанное содержание карты");
  assert.deepEqual(exact.evidenceCatalog,approximate.evidenceCatalog);
  const byId=new Map(exact.evidenceCatalog.items.map(value=>[value.id,value]));
  const currentBazi=(exact.report.currentPeriod.evidence||[]).map(id=>byId.get(id)).find(value=>value?.id.startsWith("bazi.luck_period."));
  const currentZiwei=byId.get("ziwei.current_palace");
  assert.ok(currentBazi?.data.startYear<=referenceYear&&currentBazi?.data.endYear>=referenceYear,currentBazi?.fact);
  const calculatedAge=referenceYear-Number(exact.input.date.slice(0,4))+1;
  assert.ok(currentZiwei?.data.agePeriod.startAge<=calculatedAge&&currentZiwei?.data.agePeriod.endAge>=calculatedAge,currentZiwei?.fact);
  assert.equal(exact.report.money.summary.endsWith("заранее определять предел финансового риска."),true);
  const result=await createPdfRequest({ ...exact.input,report:exact.report },{ hasFullReport:true });
  const parsed=await pdfParse(result.buffer);
  assert.match(parsed.text,/Это\s+не\s+обещание дохода:[\s\S]{0,760}заранее определять\s+предел финансового риска\./i);
  assert.match(parsed.text,new RegExp(`ТОЧКА ОТСЧ[ЕЁ]ТА[\\s\\S]{0,80}${referenceYear}`));
  assert.match(parsed.text,new RegExp(`Ближайшие три года[\\s\\S]{0,900}${referenceYear}[\\s\\S]{0,900}${referenceYear+1}[\\s\\S]{0,900}${referenceYear+2}`));
  assert.match(parsed.text,/уверенность\s+расчёта\s*[—-]\s*Средняя \(中\)/i);
  assert.match(parsed.text,/уверенность\s+расчёта\s*[—-]\s*Низкая \(低\)/i);
  assert.match(parsed.text,/Уровень чувствительности расчёта\s*[—-]\s*Высокая \(HIGH\)/i);
});

test("v4 renderer выдерживает exact, approximate и внутренний long stress-test без пустых страниц", async () => {
  const review=buildReviewVariants();
  const long=buildLongStressVariant();
  const variants=[...review,long];
  assert.equal(review.length,2);
  const exact=review.find(value=>value.key==="exact");
  const approximate=review.find(value=>value.key==="approximate");
  assert.deepEqual(
    { ...exact.input,birthTimeCertainty:undefined },
    { ...approximate.input,birthTimeCertainty:undefined },
  );
  assert.equal(exact.input.birthTimeCertainty,"exact");
  assert.equal(approximate.input.birthTimeCertainty,"approximate");
  assert.equal(exact.calculationMetadata.calculationSensitivity,approximate.calculationMetadata.calculationSensitivity);
  assert.deepEqual(exact.calculationMetadata.sensitivityFlags,approximate.calculationMetadata.sensitivityFlags);
  assert.deepEqual(exact.report.yearlyOutlook.map(year=>year.evidence),approximate.report.yearlyOutlook.map(year=>year.evidence));
  for(const variant of variants){
    assert.deepEqual(consecutiveTextDuplicates(variant.report),[],`${variant.key}: найдены соседние дубли`);
    const result=await createPdfRequest({ ...variant.input,report:variant.report },{ hasFullReport:true });
    assert.equal(result.status,200,variant.key);
    const pages=[];
    const parsed=await pdfParse(result.buffer,{ pagerender:async page=>{
      const content=await page.getTextContent({ normalizeWhitespace:true });
      const text=content.items.map(item=>item.str).filter(Boolean).join(" ");pages.push(text);return text;
    }});
    assert.equal(pages.length,parsed.numpages,variant.key);
    assert.equal(pages.every(text=>text.replace(/\s+/g,"").length>25),true,`${variant.key}: пустая или случайная страница`);
    assert.match(parsed.text,/Итоговая персональная линия/i);
    assert.doesNotMatch(parsed.text,/(?:bazi|ziwei|time)\.[a-z0-9_.-]+|\[object Object\]|[\u0000\uFFFD\uFFFE\uFFFF]/iu);
    assert.equal(parsed.numpages>=30&&parsed.numpages<=36,true,`${variant.key}: ${parsed.numpages} страниц`);
    assert.doesNotMatch(parsed.text,/raw JSON|evidence ID|calculation core|provider|parser|renderer/i);
    if(variant.key==="approximate"){
      assert.match(parsed.text,/Время (?:рождения )?(?:указано|указали) приблизительно/i);
      assert.match(parsed.text,/Часозависимый акцент/i);
    }else{
      assert.doesNotMatch(parsed.text,/Время (?:рождения )?(?:указано|указали) приблизительно/i);
    }
  }
});

test("сохранённый отчёт повторно создаёт PDF без обращения к AI-провайдеру", async () => {
  let providerCalls = 0;
  const calculation = calculateBirthChart(input);
  const report = createMockReport(buildReportContext(calculation, { displayName: input.name }, { model: "mock-v1" }));
  const saved = { kind: "semantic-report", input, presentation: { displayName: input.name }, report };
  const result = await createPdfFromSavedReport(saved, { provider: { async generate() { providerCalls += 1; } } });
  assert.equal(result.status, 200);
  assert.equal(providerCalls, 0);
});

test("имя PDF безопасно для macOS, Windows и не допускает путь к чужому файлу", () => {
  assert.equal(createPdfFilename({ displayName: "Эдуард", date: "2000-01-01", time: "12:05" }), "tian-min-eduard-2000-01-01-12-05.pdf");
  const hostile = createPdfFilename({ displayName: "../../\\secret:<script>", date: "../../etc", time: "12/00" });
  assert.equal(hostile.includes("/"), false);
  assert.equal(hostile.includes("\\"), false);
  assert.equal(hostile.includes(".."), false);
  assert.match(hostile, /^tian-min-[a-z0-9-]+-date-time\.pdf$/);
  assert.equal(safeFilenamePart("  Анна Мария  "), "anna-mariya");
});
