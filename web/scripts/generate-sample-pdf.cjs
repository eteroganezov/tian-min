const fs = require("node:fs/promises");
const path = require("node:path");
const { locationProvider } = require("../lib/location-provider.cjs");
const { calculateBirthChart } = require("../lib/birth-chart-pipeline.cjs");
const { buildReportContext, currentReportYears } = require("../lib/report-service.cjs");
const { createMockReport } = require("../lib/mock-report.cjs");
const { createPdfRequest } = require("../lib/pdf-service.cjs");
const { canonicalBirthInput } = require("../lib/personalization.cjs");

const moscow = locationProvider.search("Москва")[0];

function buildVariant({ input, reportYears, mutate }) {
  const calculation = calculateBirthChart(canonicalBirthInput(input));
  const context = buildReportContext(calculation,{ displayName:input.name },{ model:"mock-v1",reportYears });
  const report = createMockReport(context);
  if(mutate) mutate(report);
  return { input, report, calculationMetadata:calculation.metadata, evidenceCatalog:context.evidenceCatalog };
}

function buildReviewVariants() {
  const baseInput={ name:"Александра",date:"1995-09-03",time:"05:50",gender:"female",placeId:moscow.id };
  const reportYears=currentReportYears();
  return ["exact","approximate"].map(birthTimeCertainty=>({
    key:birthTimeCertainty,
    filename:`sample-personal-report-v4-${birthTimeCertainty}.pdf`,
    ...buildVariant({ input:{ ...baseInput,birthTimeCertainty },reportYears }),
  }));
}

function buildLongStressVariant() {
  const input={ name:"Александра-Мария Константиновна Мирославская",date:"1995-09-03",time:"05:50",gender:"female",placeId:moscow.id,birthTimeCertainty:"exact" };
  return { key:"long",filename:"sample-personal-report-v4-long.pdf",...buildVariant({ input,reportYears:currentReportYears(),mutate:report=>{
      report.executiveInsights[0].title="Сначала собрать разрозненные факты в единую проверяемую систему, затем определить достаточный критерий и перейти к действию";
      report.career.headline="Роль, в которой можно не только отвечать за качество результата, но и влиять на правила, критерии и способ совместного исполнения";
      report.relationships.summary+=` ${report.relationships.insights[3].text}`;
      report.environment.communication+=` ${report.leadership.negotiation}`;
      report.money.insights[0].text+=" Ценность становится понятнее, когда путь от исходной неопределённости до принятого решения можно показать на одном завершённом примере.";
      report.strengths[0].essence+=" Особенно заметен навык удерживать связь между исходным вопросом, выбранным критерием и конечным результатом даже в длинной задаче.";
    } }) };
}

function buildDistinctChartVariant() {
  const input={ name:"Илья",date:"1988-02-17",time:"18:20",gender:"male",placeId:moscow.id,birthTimeCertainty:"exact" };
  return { key:"distinct",filename:"sample-personal-report-v4-distinct-chart-qa.pdf",...buildVariant({ input,reportYears:currentReportYears() }) };
}

async function main() {
  const outputDir=path.resolve(__dirname,"..","..","output","pdf");await fs.mkdir(outputDir,{recursive:true});
  for(const variant of [...buildReviewVariants(),buildLongStressVariant(),buildDistinctChartVariant()]){
    const result=await createPdfRequest({ ...variant.input,report:variant.report },{ hasFullReport:true });
    if(result.status!==200)throw new Error(result.error||`Не удалось создать PDF ${variant.key}`);
    const outputPath=path.join(outputDir,variant.filename);await fs.writeFile(outputPath,result.buffer);process.stdout.write(`${variant.key}: ${outputPath}\n`);
  }
}

if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});

module.exports={ buildDistinctChartVariant,buildReviewVariants,buildLongStressVariant };
