const fs = require("node:fs/promises");
const path = require("node:path");
const { locationProvider } = require("../lib/location-provider.cjs");
const { calculateBirthChart } = require("../lib/birth-chart-pipeline.cjs");
const { buildReportContext } = require("../lib/report-service.cjs");
const { createMockReport } = require("../lib/mock-report.cjs");
const { createPdfRequest } = require("../lib/pdf-service.cjs");
const { canonicalBirthInput } = require("../lib/personalization.cjs");

async function main() {
  const moscow = locationProvider.search("Москва")[0];
  const input = { name: "Эдуард", date: "2000-01-01", time: "12:00", gender: "male", placeId: moscow.id };
  const calculation = calculateBirthChart(canonicalBirthInput(input));
  const report = createMockReport(buildReportContext(calculation, { displayName: input.name }, { model: "mock-v1" }));
  const result = await createPdfRequest({ ...input, report }, { hasFullReport: true });
  if (result.status !== 200) throw new Error(result.error || "Не удалось создать PDF");
  const outputDir = path.resolve(__dirname, "..", "..", "output", "pdf");
  const outputPath = path.join(outputDir, "sample-personal-report.pdf");
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputPath, result.buffer);
  process.stdout.write(`${outputPath}\n`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
