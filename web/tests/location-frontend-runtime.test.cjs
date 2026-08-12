const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function element() {
  const listeners = new Map();
  return {
    hidden: false, value: "", dataset: {}, attributes: new Map(), innerHTML: "",
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type, event = {}) { return listeners.get(type)?.({ preventDefault() {}, key: "", target: this, ...event }); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    removeAttribute(name) { this.attributes.delete(name); },
    querySelector() { return element(); },
    querySelectorAll(selector) {
      if (selector !== "button") return [];
      return [...this.innerHTML.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)].map((match, index) => {
        const button = element();
        button.textContent = match[1];
        button.dataset.index = String(index);
        return button;
      });
    },
    closest() { return null; }, scrollIntoView() {}, insertAdjacentHTML() {},
  };
}

function frontendHarness(fetchImpl) {
  const nodes = {
    "#birth-form": element(), "#form-error": element(), "#submit-button": element(),
    "#result-root": element(), "#birth-place": element(), "#place-options": element(), "#ambiguity-box": element(),
  };
  nodes["#submit-button"].querySelector = () => element();
  const document = { querySelector: selector => nodes[selector] || element(), addEventListener() {} };
  const context = {
    document, fetch: fetchImpl, FormData: class {}, localStorage: { getItem: () => null, removeItem() {}, setItem() {} },
    setTimeout, clearTimeout, console, Intl, URLSearchParams, encodeURIComponent,
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "..", "public", "app.js"), "utf8"), context);
  return { input: nodes["#birth-place"], options: nodes["#place-options"] };
}

const moscow = { id: "canonical-moscow", display: { label: "Москва, Россия" }, latitude: 55.75, longitude: 37.61, timeZone: "Europe/Moscow" };

test("frontend autocomplete проходит input → debounce → fetch → JSON → visible DOM", async () => {
  const urls = [];
  const ui = frontendHarness(async url => {
    urls.push(url);
    return { ok: true, json: async () => ({ places: [moscow] }) };
  });
  ui.input.value = "москв";
  ui.input.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.deepEqual(urls, ["/api/places?q=%D0%BC%D0%BE%D1%81%D0%BA%D0%B2"]);
  assert.equal(ui.options.hidden, false);
  assert.match(ui.options.innerHTML, /Москва, Россия/);
  assert.equal(ui.input.attributes.get("aria-expanded"), "true");
  ui.input.dispatch("keydown", { key: "ArrowDown" });
  assert.equal(ui.input.attributes.get("aria-activedescendant"), "place-option-0");
  ui.input.dispatch("keydown", { key: "Enter" });
  assert.equal(ui.input.value, "Москва, Россия");
  assert.equal(ui.options.hidden, true);
});

test("frontend autocomplete сохраняет новый результат при позднем старом response", async () => {
  let resolveOld;
  const oldResponse = new Promise(resolve => { resolveOld = resolve; });
  const ui = frontendHarness(url => url.includes(encodeURIComponent("мо")) && !url.includes(encodeURIComponent("моск"))
    ? oldResponse
    : Promise.resolve({ ok: true, json: async () => ({ places: [moscow] }) }));
  ui.input.value = "мо";
  ui.input.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 190));
  ui.input.value = "моск";
  ui.input.dispatch("input");
  await new Promise(resolve => setTimeout(resolve, 220));
  resolveOld({ ok: true, json: async () => ({ places: [] }) });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(ui.options.hidden, false);
  assert.match(ui.options.innerHTML, /Москва, Россия/);
});

test("dropdown CSS не скрывает и не обрезает непустой список", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "..", "public", "styles.css"), "utf8");
  const baseRule = css.match(/\.place-options\{([^}]*)\}/)?.[1] || "";
  const fieldRule = css.match(/\.place-field\{([^}]*)\}/)?.[1] || "";
  assert.match(baseRule, /position:absolute/);
  assert.match(baseRule, /z-index:30/);
  assert.doesNotMatch(baseRule, /display:none|visibility:hidden|opacity:0|height:0/);
  assert.doesNotMatch(fieldRule, /overflow:hidden/);
});
