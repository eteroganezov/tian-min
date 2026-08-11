const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { LocalReportStore } = require("../lib/report-store.cjs");

test("DEV-хранилище сохраняет и повторно читает отрендеренный отчёт", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tian-min-report-"));
  try {
    const store = new LocalReportStore({ root });
    const saved = store.importLegacy({
      input: { date: "2000-01-01", time: "12:00", gender: "male", placeId: "place-id" },
      presentation: { displayName: "Эдуард" },
      sections: Array.from({ length: 3 }, (_, index) => ({ key: `s-${index}`, title: `Раздел ${index}`, paragraphs: ["Текст без undefined"], items: [] })),
    });
    assert.match(saved.id, /^local-/);
    assert.equal(store.load(saved.id).kind, "legacy-rendered-report");
    assert.equal(store.load().presentation.displayName, "Эдуард");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("legacy-адаптер превращает проверочный блок в наблюдения и три группы устойчивости", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tian-min-report-"));
  try {
    const store = new LocalReportStore({ root });
    store.importLegacy({ input: { date: "2000-01-01", time: "12:00", gender: "male", placeId: "place-id" }, sections: [
      { key: "executive", label: "В двух словах", title: "Главное о вас", paragraphs: ["В двух словах", "Содержание"], items: [] },
      { key: "confidence", label: "Уверенность", title: "Старое название", paragraphs: ["Уверенность"], items: ["Высокий Первый вывод", "Средний Второй вывод", "Средний Третий вывод", "Низкий Четвёртый вывод"] },
      { key: "manifestations", label: "Проверьте на себе", title: "Насколько это про вас?", paragraphs: ["Проверьте на себе"], items: ["01 Я могу назвать критерий"] },
    ] });
    const sections = store.load().sections;
    assert.equal(sections[1].title, "Насколько устойчивы выводы");
    assert.equal(sections[1].items.length, 3);
    assert.equal(sections[2].title, "Как это проявляется в\u00a0жизни");
    assert.equal(sections[2].items[0], "Вы обычно можете назвать критерий");
    assert.doesNotMatch(JSON.stringify(sections), /Проверьте на себе|Насколько это про вас/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
