const fs = require("node:fs");
const path = require("node:path");
const { LocalReportStore } = require("../lib/report-store.cjs");

const source = process.argv[2];
if (!source) throw new Error("Укажите путь к JSON-снимку отчёта.");
const payload = JSON.parse(fs.readFileSync(path.resolve(source), "utf8"));
const saved = new LocalReportStore().importLegacy(payload);
console.log(saved.id);
