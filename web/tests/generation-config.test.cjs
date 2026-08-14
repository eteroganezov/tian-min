const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { assertProductionGenerationReady } = require("../lib/generation-config.cjs");
const { LOCAL_OPENAI_OPT_IN, createReportProvider, resolveReportProviderPolicy } = require("../lib/report-provider.cjs");
const { registerFonts } = require("../lib/pdf-template-v4.cjs");
const allFonts = () => ({ regular:"r",bold:"b",serif:"s",serifBold:"sb",cjk:"c" });
const readyOptions = { resolveFontPaths:allFonts, assertPdfRuntimeReady:()=>({ cjkReady:true }) };

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
      () => assertProductionGenerationReady({ NODE_ENV:"production",PAYMENT_MODE:"lorentsen",OPENAI_API_KEY:"present-not-real",OPENAI_MODEL:"gpt-test",AI_MODE },readyOptions),
      error => error.code === "PREMIUM_GENERATION_CONFIGURATION_ERROR" && /AI_MODE/.test(error.message),
    );
  }
});

test("legitimate production entitlement may use a configured real provider", () => {
  assert.doesNotThrow(() => assertProductionGenerationReady({
    NODE_ENV:"production",PAYMENT_MODE:"lorentsen",OPENAI_API_KEY:"present-not-real",OPENAI_MODEL:"gpt-test",HAS_FULL_REPORT:"true",
  },readyOptions));
});

test("production fails before serving users when frozen PDF fonts are missing", () => {
  assert.throws(() => assertProductionGenerationReady({
    NODE_ENV:"production",PAYMENT_MODE:"lorentsen",OPENAI_API_KEY:"present-not-real",OPENAI_MODEL:"gpt-test",
  },{ resolveFontPaths:()=>({}) }), error => error.code === "PREMIUM_GENERATION_CONFIGURATION_ERROR" && /PDF font/.test(error.message));
});

test("production preflight loads the renderer fonts instead of checking paths only", () => {
  assert.throws(() => assertProductionGenerationReady({
    NODE_ENV:"production",PAYMENT_MODE:"lorentsen",OPENAI_API_KEY:"present-not-real",OPENAI_MODEL:"gpt-test",
  },{ resolveFontPaths:allFonts,assertPdfRuntimeReady:()=>{throw Object.assign(new Error("invalid collection"),{code:"PDF_CJK_FONT_INVALID"});} }), error =>
    error.code === "PREMIUM_GENERATION_CONFIGURATION_ERROR" && /PDF runtime PDF_CJK_FONT_INVALID/.test(error.message));
});

test("Noto CJK collection selects its Simplified Chinese face for PDFKit", () => {
  const directory=fs.mkdtempSync(path.join(require("node:os").tmpdir(),"tian-min-font-"));
  const collection=path.join(directory,"NotoSansCJK-Regular.ttc");
  fs.writeFileSync(collection,"collection fixture path only");
  const calls=[];
  const doc={registerFont(...args){calls.push(args);return this;},font(){return this;}};
  try{
    const result=registerFonts(doc,{
      PDF_FONT_REGULAR:collection,PDF_FONT_BOLD:collection,PDF_FONT_SERIF:collection,PDF_FONT_SERIF_BOLD:collection,PDF_FONT_CJK:collection,
    });
    assert.deepEqual(calls.at(-1),["CJK",collection,"NotoSansCJKsc-Regular"]);
    assert.equal(result.paths.cjkFamily,"NotoSansCJKsc-Regular");
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test("development and automated mock tests do not require production credentials", () => {
  assert.doesNotThrow(() => assertProductionGenerationReady({ NODE_ENV:"test",PAYMENT_MODE:"mock",AI_MODE:"mock" }));
});

test("development API key alone cannot select the real OpenAI provider", () => {
  const env={ NODE_ENV:"development",OPENAI_API_KEY:"present-not-real",OPENAI_MODEL:"gpt-test" };
  assert.deepEqual(resolveReportProviderPolicy(env),{
    providerType:"unavailable",reason:"LOCAL_OPENAI_OPT_IN_REQUIRED",
    message:`Real OpenAI is disabled in local development by default. Set ${LOCAL_OPENAI_OPT_IN}=true to explicitly opt in to billable API calls.`,
  });
  assert.equal(createReportProvider(env).providerType,"unavailable");
});

test("blocked local generation explains the explicit billable opt-in without touching the network", async () => {
  const provider=createReportProvider({ NODE_ENV:"development",OPENAI_API_KEY:"present-not-real",OPENAI_MODEL:"gpt-test" });
  await assert.rejects(() => provider.generate({}), error =>
    error.code === "AI_NOT_CONFIGURED"
      && error.reason === "LOCAL_OPENAI_OPT_IN_REQUIRED"
      && error.message.includes(`${LOCAL_OPENAI_OPT_IN}=true`)
      && /billable API calls/.test(error.message));
});

test("development may select real OpenAI only with explicit local opt-in", () => {
  const provider=createReportProvider({ NODE_ENV:"development",OPENAI_API_KEY:"present-not-real",OPENAI_MODEL:"gpt-test",[LOCAL_OPENAI_OPT_IN]:"true" });
  assert.equal(provider.providerType,"openai");
  assert.equal(provider.model,"gpt-test");
});

test("test environment blocks real OpenAI even when key and local opt-in leak into it", () => {
  const env={ NODE_ENV:"test",AI_MODE:"real",OPENAI_API_KEY:"present-not-real",OPENAI_MODEL:"gpt-test",[LOCAL_OPENAI_OPT_IN]:"true" };
  const provider=createReportProvider(env);
  assert.equal(provider.providerType,"unavailable");
  assert.equal(resolveReportProviderPolicy(env).reason,"REAL_OPENAI_DISABLED_IN_TEST");
});

test("production selects real OpenAI without the local opt-in flag", () => {
  const env={ NODE_ENV:"production",OPENAI_API_KEY:"present-not-real",OPENAI_MODEL:"gpt-test" };
  const provider=createReportProvider(env);
  assert.equal(provider.providerType,"openai");
  assert.equal(resolveReportProviderPolicy(env).reason,"PRODUCTION_REAL");
});

test("Railpack deploy image installs the frozen PDF renderer font families", () => {
  const config=JSON.parse(fs.readFileSync(path.resolve(__dirname,"../../railpack.json"),"utf8"));
  assert.deepEqual(config.deploy.aptPackages,["fonts-dejavu-core","fonts-noto-cjk"]);
});
