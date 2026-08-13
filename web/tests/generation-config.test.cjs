const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { assertProductionGenerationReady } = require("../lib/generation-config.cjs");
const allFonts = () => ({ regular:"r",bold:"b",serif:"s",serifBold:"sb",cjk:"c" });

test("production Lorentsen fails closed when Premium generation config is absent", () => {
  assert.throws(
    () => assertProductionGenerationReady({ NODE_ENV:"production",PAYMENT_MODE:"lorentsen" }),
    error => error.code === "PREMIUM_GENERATION_CONFIGURATION_ERROR"
      && /OPENAI_API_KEY/.test(error.message)
      && /OPENAI_MODEL/.test(error.message),
  );
});

test("production Lorentsen rejects mock or disabled AI runtime", () => {
  for (const AI_MODE of ["mock","disabled"]) {
    assert.throws(
      () => assertProductionGenerationReady({ NODE_ENV:"production",PAYMENT_MODE:"lorentsen",OPENAI_API_KEY:"present-not-real",OPENAI_MODEL:"gpt-test",AI_MODE },{ resolveFontPaths:allFonts }),
      error => error.code === "PREMIUM_GENERATION_CONFIGURATION_ERROR" && /AI_MODE/.test(error.message),
    );
  }
});

test("legitimate production entitlement may use a configured real provider", () => {
  assert.doesNotThrow(() => assertProductionGenerationReady({
    NODE_ENV:"production",PAYMENT_MODE:"lorentsen",OPENAI_API_KEY:"present-not-real",OPENAI_MODEL:"gpt-test",HAS_FULL_REPORT:"true",
  },{ resolveFontPaths:allFonts }));
});

test("production fails before serving users when frozen PDF fonts are missing", () => {
  assert.throws(() => assertProductionGenerationReady({
    NODE_ENV:"production",PAYMENT_MODE:"lorentsen",OPENAI_API_KEY:"present-not-real",OPENAI_MODEL:"gpt-test",
  },{ resolveFontPaths:()=>({}) }), error => error.code === "PREMIUM_GENERATION_CONFIGURATION_ERROR" && /PDF font/.test(error.message));
});

test("development and automated mock tests do not require production credentials", () => {
  assert.doesNotThrow(() => assertProductionGenerationReady({ NODE_ENV:"test",PAYMENT_MODE:"mock",AI_MODE:"mock" }));
});

test("Railpack deploy image installs the frozen PDF renderer font families", () => {
  const config=JSON.parse(fs.readFileSync(path.resolve(__dirname,"../../railpack.json"),"utf8"));
  assert.deepEqual(config.deploy.aptPackages,["fonts-dejavu-core","fonts-noto-cjk"]);
});
