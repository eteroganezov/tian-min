const fs = require("node:fs");
const path = require("node:path");
const { createPdfFromSavedReport } = require("../lib/pdf-service.cjs");
const { LocalReportStore } = require("../lib/report-store.cjs");

async function main() {
  const saved = new LocalReportStore().load(process.argv[2] || "latest");
  if (!saved) throw new Error("Сохранённый отчёт не найден. Сначала создайте или импортируйте его локально.");
  const result = await createPdfFromSavedReport(saved);
  if (result.status !== 200) throw new Error(result.error);
  const output = path.resolve(__dirname, "..", "..", "output", "pdf", "sample-personal-report-v2.pdf");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, result.buffer);
  console.log(output);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
