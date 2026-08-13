const test = require("node:test");
const assert = require("node:assert/strict");
const { locationProvider } = require("../lib/location-provider.cjs");
const { createMockReport } = require("../lib/mock-report.cjs");
const { LEGACY_REPORT_SCHEMA_VERSION, REPORT_SCHEMA_VERSION, validatePersonalReport } = require("../lib/report-schema.cjs");
const { buildReportContext, generateReportRequest } = require("../lib/report-service.cjs");
const { INTERPRETATION_PROMPT_VERSION } = require("../lib/report-fingerprint.cjs");
const { OpenAIReportProvider } = require("../lib/report-provider.cjs");
const { EVIDENCE_CATALOG_VERSION, buildEvidenceCatalog, localizeReportText, russianTypography, sanitizePersonalReport } = require("../lib/report-content.cjs");
const { calculateBirthChart } = require("../lib/birth-chart-pipeline.cjs");
const { toChartView } = require("../lib/chart-view.cjs");

const moscow = locationProvider.search("Москва")[0];
const input = { date:"2000-01-01",time:"12:00",gender:"male",placeId:moscow.id };
const reportYears = [2026,2027,2028];
const DIZHI = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];

function contextFor(birthInput = input, name = "Эдуард") {
  const calculation = calculateBirthChart(birthInput);
  return { calculation, context:buildReportContext(calculation,{ displayName:name },{ model:"mock-v1",reportYears }) };
}

test("OpenAI provider использует Responses API и strict v4 Structured Output", async () => {
  let request;
  const client = { responses:{ async create(value) { request=value; return { output_text:"{\"ok\":true}" }; } } };
  const provider = new OpenAIReportProvider({ client,model:"gpt-test" });
  assert.deepEqual(await provider.generate({ diagnostic:true }),{ ok:true });
  assert.equal(request.model,"gpt-test");
  assert.equal(request.store,false);
  assert.equal(request.reasoning.effort,"low");
  assert.equal(request.text.format.type,"json_schema");
  assert.equal(request.text.format.strict,true);
  assert.deepEqual(request.text.format.schema.properties.schemaVersion.enum,[REPORT_SCHEMA_VERSION]);
  assert.match(request.input[1].content,/EVIDENCE_CONTEXT/);
  assert.doesNotMatch(request.input[1].content,/CALCULATION_DATA/);
});

test("v4 mock проходит schema и содержит все обязательные смысловые разделы", async () => {
  const result = await generateReportRequest({ ...input,name:"  Эдуард  " },{ env:{ AI_MODE:"mock" },reportYears });
  assert.equal(result.status,200);
  assert.equal(result.body.aiStatus,"ready");
  assert.equal(result.body.schemaVersion,REPORT_SCHEMA_VERSION);
  assert.equal(result.body.report.schemaVersion,REPORT_SCHEMA_VERSION);
  const validation = validatePersonalReport(result.body.report,{ evidenceCatalog:result.internal.context.evidenceCatalog });
  assert.deepEqual(validation,{ valid:true,errors:[],schemaVersion:REPORT_SCHEMA_VERSION,legacy:false });
  for (const key of ["executivePortrait","executiveInsights","readingGuide","personality","strengths","challenges","career","money","relationships","environment","leadership","lifestyle","currentPeriod","yearlyOutlook","crossValidation","actionPlan","finalSummary"]) assert.ok(result.body.report[key],key);
  assert.equal(result.body.report.executiveInsights.length,6);
  assert.equal(result.body.report.lifeAreaMatrix.length,8);
  assert.equal(result.body.presentation.displayName,"Эдуард");
  assert.match(result.body.reportId,/^tmr_[a-f0-9]{24}$/);
  assert.match(result.body.chartId,/^tmc_[a-f0-9]{24}$/);
});

test("evidence catalog покрывает реальные deterministic категории и использует стабильные ID", () => {
  const reference = { date:"1995-09-03",time:"05:50",gender:"male",placeId:moscow.id };
  const calculation = calculateBirthChart(reference);
  const catalog = buildEvidenceCatalog(calculation,toChartView(calculation.chart),{ reportYears });
  assert.equal(catalog.version,EVIDENCE_CATALOG_VERSION);
  const ids = new Set(catalog.items.map(item=>item.id));
  assert.equal(ids.size,catalog.items.length);
  for (const id of [
    "bazi.day_master","bazi.pillar.year","bazi.hidden_stems.hour","bazi.ten_god_groups","bazi.elements.weighted","bazi.elements.seasonal",
    "bazi.structure","bazi.strength","bazi.strength.breakdown","bazi.regulating","bazi.annual.2026",
    "ziwei.life_palace","ziwei.body_palace","ziwei.five_element_bureau","ziwei.palace.career","ziwei.palace.finance","ziwei.palace.partnership",
    "ziwei.current_palace","time.civil","time.timezone","time.true_solar","time.sensitivity","time.sensitivity.changed_hour_pillar",
  ]) assert.equal(ids.has(id),true,id);
  assert.equal([...ids].some(id=>id.startsWith("bazi.relation.stem.")),true);
  assert.equal([...ids].some(id=>id.startsWith("bazi.relation.branch.")),true);
  assert.equal([...ids].some(id=>id.startsWith("ziwei.transformation.")),true);
  assert.equal([...ids].some(id=>id.startsWith("ziwei.age_period.")),true);
});

test("structured evidence сохраняет точные deterministic values calculator", () => {
  const { calculation,context } = contextFor();
  const byId = new Map(context.evidenceCatalog.items.map(item=>[item.id,item]));
  assert.deepEqual(byId.get("bazi.pillar.year").data.pillar,calculation.chart.bazi.siZhu.year);
  assert.deepEqual(byId.get("bazi.hidden_stems.year").data,calculation.chart.bazi.cangGan.year);
  assert.deepEqual(byId.get("bazi.elements.weighted").data,calculation.chart.bazi.enrichment.五行统计.withCangGan);
  assert.deepEqual(byId.get("bazi.structure").data,calculation.chart.bazi.enrichment.格局);
  assert.deepEqual(byId.get("bazi.strength.breakdown").data,calculation.chart.bazi.enrichment.旺衰.breakdown);
  assert.equal(byId.get("ziwei.body_palace").data.branch,DIZHI[calculation.chart.ziwei.shenGongIndex]);
  assert.deepEqual(byId.get("ziwei.palace.career").data.mainStars,calculation.chart.ziwei.gongs.find(gong=>gong.gong === "官禄").mainStars);
  assert.equal(byId.get("time.true_solar").data.time,calculation.metadata.trueSolarTime);
});

test("несуществующий evidence ID блокирует отчёт", () => {
  const { context } = contextFor();
  const report = createMockReport(context);
  report.career.evidence[0] = "bazi.nonexistent.claim";
  const validation = validatePersonalReport(report,{ evidenceCatalog:context.evidenceCatalog });
  assert.equal(validation.valid,false);
  assert.match(validation.errors.join("\n"),/bazi\.nonexistent\.claim отсутствует/);
});

test("матрица запрещает ссылку на систему другого типа", () => {
  const { context } = contextFor();
  const report = createMockReport(context);
  report.lifeAreaMatrix[0].baziEvidence[0] = "ziwei.palace.career";
  const validation = validatePersonalReport(report,{ evidenceCatalog:context.evidenceCatalog });
  assert.equal(validation.valid,false);
  assert.match(validation.errors.join("\n"),/ожидается evidence Ба-цзы/);
});

test("yearly themes имеют evidence конкретного года и не содержат событийных обещаний", () => {
  const { context } = contextFor();
  const report = createMockReport(context);
  report.yearlyOutlook.forEach(item=>{
    assert.equal(item.evidence.includes(`bazi.annual.${item.year}`),true);
    assert.match(item.confidenceNote,/тематическая рамка, а не событийное обещание/);
  });
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized,/"(?:event|events|probability|guaranteedOutcome|marriageDate|relocationDate|incomeForecast|healthPrediction)"\s*:/);
  const hostile = structuredClone(report);
  hostile.yearlyOutlook[0].event = "Повышение";
  assert.equal(validatePersonalReport(hostile,{ evidenceCatalog:context.evidenceCatalog }).valid,false);
});

test("action plan ссылается на существующие executive insights", () => {
  const { context } = contextFor();
  const report = createMockReport(context);
  assert.equal(validatePersonalReport(report,{ evidenceCatalog:context.evidenceCatalog }).valid,true);
  report.actionPlan.sourceInsightIds[0] = "insight-missing";
  const validation = validatePersonalReport(report,{ evidenceCatalog:context.evidenceCatalog });
  assert.equal(validation.valid,false);
  assert.match(validation.errors.join("\n"),/insight-missing отсутствует/);
});

test("v4 versioning и fingerprint стабильны, а имя не меняет chart ID", async () => {
  assert.equal(REPORT_SCHEMA_VERSION,"personal-report-v4");
  assert.equal(INTERPRETATION_PROMPT_VERSION,"consumer-ru-v5-evidence");
  const options={ env:{ AI_MODE:"mock" },reportYears };
  const first=await generateReportRequest({ ...input,name:"Эдуард" },options);
  const second=await generateReportRequest({ ...input,name:"Эдуард" },options);
  const renamed=await generateReportRequest({ ...input,name:"Анна" },options);
  assert.equal(first.body.reportId,second.body.reportId);
  assert.equal(first.body.chartId,renamed.body.chartId);
  assert.notEqual(first.body.reportId,renamed.body.reportId);
});

test("AI видит frozen evidence context, но не полный raw calculation snapshot", async () => {
  let frozen;
  const provider={ model:"test",async generate(context) {
    frozen=Object.isFrozen(context)&&Object.isFrozen(context.evidenceCatalog)&&Object.isFrozen(context.evidenceCatalog.items[0]);
    assert.equal(Object.prototype.hasOwnProperty.call(context,"calculationData"),false);
    assert.equal(Object.prototype.hasOwnProperty.call(context,"chartView"),false);
    const before=context.evidenceCatalog.items[0].fact;
    context.evidenceCatalog.items[0].fact="Подмена";
    assert.equal(context.evidenceCatalog.items[0].fact,before);
    return createMockReport(context);
  }};
  const result=await generateReportRequest({ ...input,name:"Эдуард" },{ provider,reportYears });
  assert.equal(result.status,200);
  assert.equal(frozen,true);
});

test("legacy semantic v3 валидируется только через явную compatibility ветку", () => {
  const { context } = contextFor();
  const legacy = toLegacyV3(createMockReport(context));
  const validation = validatePersonalReport(legacy);
  assert.equal(validation.valid,true,validation.errors.join("\n"));
  assert.equal(validation.schemaVersion,LEGACY_REPORT_SCHEMA_VERSION);
  assert.equal(validation.legacy,true);
  const mislabeled={ ...legacy,schemaVersion:REPORT_SCHEMA_VERSION };
  assert.equal(validatePersonalReport(mislabeled,{ evidenceCatalog:context.evidenceCatalog }).valid,false);
  const unknown={ ...legacy,schemaVersion:"personal-report-v99" };
  assert.match(validatePersonalReport(unknown).errors[0],/неподдерживаемая версия/);
});

test("sanitize сохраняет evidence IDs и удаляет сломанные consumer strings", () => {
  const { context } = contextFor();
  const report=createMockReport(context);
  const evidenceId=report.career.evidence[0];
  report.career.actions=["undefined","Проверить критерии роли"];
  const cleaned=sanitizePersonalReport(report);
  assert.equal(cleaned.career.evidence[0],evidenceId);
  assert.deepEqual(cleaned.career.actions,["Проверить критерии роли"]);
});

test("без API-ключа report generation остаётся честно недоступна", async () => {
  const stages=[];
  const result=await generateReportRequest(input,{ env:{},onStage:event=>stages.push(event.stage) });
  assert.equal(result.status,200);
  assert.equal(result.body.aiStatus,"unavailable");
  assert.equal(result.body.report,undefined);
  assert.deepEqual(stages,["evidence_ready","provider_unavailable"]);
  assert.equal(result.internal.failure.stage,"provider_configuration");
});

test("successful report emits safe generation stages without prompt or birth data", async () => {
  const stages=[];
  const result=await generateReportRequest(input,{ env:{AI_MODE:"mock"},reportYears,onStage:event=>stages.push(event) });
  assert.equal(result.status,200);
  assert.deepEqual(stages.map(event=>event.stage),["evidence_ready","model_request_started","model_response_received","report_validated"]);
  const serialized=JSON.stringify(stages);
  assert.doesNotMatch(serialized,/2000-01-01|12:00|EVIDENCE_CONTEXT|prompt/i);
});

test("невалидный ответ повторяется один раз, затем возвращает safe error", async () => {
  let calls=0;
  const provider={ model:"test",async generate(){calls+=1;return {};} };
  const result=await generateReportRequest(input,{ provider,reportYears });
  assert.equal(calls,2);
  assert.equal(result.status,502);
  assert.doesNotMatch(result.body.error,/at\s|\.cjs:/);
});

test("первый невалидный ответ можно исправить без изменения deterministic context", async () => {
  let calls=0;
  const provider={ model:"test",async generate(context){calls+=1;return calls===1?{}:createMockReport(context);} };
  const result=await generateReportRequest(input,{ provider,reportYears });
  assert.equal(calls,2);
  assert.equal(result.status,200);
});

test("preview не раскрывает тематические premium sections", async () => {
  const result=await generateReportRequest(input,{ env:{ AI_MODE:"mock" },hasFullReport:false,reportYears });
  assert.equal(result.status,200);
  assert.equal(result.body.hasFullReport,false);
  assert.equal(result.body.report.executiveInsights.length,3);
  assert.equal(result.body.report.strengths.length,3);
  assert.equal(result.body.report.challenges.length,1);
  assert.equal(result.body.report.career,undefined);
  assert.ok(result.internal.report.career.summary.length>100);
});

test("центральная локализация и русская типографика сохраняются", () => {
  assert.equal(localizeReportText("BaZi + Zi Wei Dou Shu, Bazi и ZiWei"),"Ба-цзы + Цзы Вэй Доу Шу, Ба-цзы и Цзы Вэй");
  assert.equal(russianTypography("с опорой на опыт и ясность"),"с\u00a0опорой на\u00a0опыт и\u00a0ясность");
});

function toLegacyV3(source) {
  const report=structuredClone(source);
  for (const key of ["schemaVersion","reportTitle","executiveInsights","readingGuide","lifeManifestationEvidence"]) delete report[key];
  delete report.executivePortrait.evidence;
  for (const section of [report.personality,report.career,report.money,report.relationships]) {
    section.insights=section.insights.map(({ heading,text })=>({ heading,text }));
    section.evidence=[];
  }
  report.keyTraits.forEach(item=>{item.evidence=["Ба-цзы: рассчитанный признак."];});
  report.strengths.forEach(item=>delete item.evidence);
  report.challenges.forEach(item=>delete item.evidence);
  delete report.externalVsInternal.evidence;
  delete report.stressPattern.evidence;
  delete report.environment.evidence;
  delete report.leadership.evidence;
  delete report.lifestyle.evidence;
  report.currentPeriod.evidence=[];
  report.yearlyOutlook.forEach(item=>{delete item.evidence;delete item.confidenceNote;});
  report.keyLifeTransitions.forEach(item=>delete item.evidence);
  report.scenarios.forEach(item=>delete item.evidence);
  report.lifeAreaMatrix.forEach(item=>{delete item.baziEvidence;delete item.ziweiEvidence;});
  for (const key of Object.keys(report.crossValidation)) report.crossValidation[key]=report.crossValidation[key].map(item=>item.conclusion);
  delete report.conclusionStability.evidence;
  delete report.actionPlan.sourceInsightIds;
  delete report.actionPlan.evidence;
  delete report.finalSummary.evidence;
  return report;
}
