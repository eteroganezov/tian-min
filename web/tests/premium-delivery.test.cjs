const test=require("node:test");
const assert=require("node:assert/strict");
const {Readable}=require("node:stream");
const {MemoryOrderStore}=require("../lib/order-store.cjs");
const {MockPaymentProvider}=require("../lib/payment-provider.cjs");
const {PremiumService,buildPersonalReportFilename}=require("../lib/premium-service.cjs");
const {locationProvider}=require("../lib/location-provider.cjs");
const {createServer}=require("../server.cjs");
const fs=require("node:fs");
const path=require("node:path");

const input={ name:"Тест",date:"1995-09-03",time:"05:50",gender:"male",placeId:locationProvider.search("Москва")[0].id };
const now=new Date("2026-08-13T12:00:00.000Z");

class MemoryReportStore {
  constructor(){this.records=new Map();this.writes=0;}
  load(id){return structuredClone(this.records.get(id) || null);}
  saveImmutable(record){if(this.records.has(record.reportId))return {id:record.reportId,existing:true};this.writes+=1;this.records.set(record.reportId,structuredClone({ ...record,id:record.reportId,savedAt:now.toISOString() }));return {id:record.reportId,existing:false};}
}

function semantic(order){return { kind:"semantic-report",artifactVersion:"premium-delivery-v1",schemaVersion:"personal-report-v4",reportId:order.reportId,chartId:order.chartId,input,presentation:{displayName:"Тест"},report:{fixture:true},model:"test",generatedAt:now.toISOString() };}
function setup(options={}) {
  const env={ NODE_ENV:"development",PAYMENT_MODE:"mock",OPENAI_MODEL:"test" };
  const orderStore=options.orderStore || new MemoryOrderStore();
  const reportStore=options.reportStore || new MemoryReportStore();
  const paymentProvider=options.paymentProvider || new MockPaymentProvider({env});
  let generationCalls=0;
  const reportGenerator=options.reportGenerator || (async order=>{generationCalls+=1;return semantic(order);});
  const pdfRenderer=options.pdfRenderer || (async()=>({status:200,buffer:Buffer.from("%PDF-premium-v1")}));
  const service=new PremiumService({env,orderStore,reportStore,paymentProvider,reportGenerator,pdfRenderer,now:()=>now,logger:{error(){}}});
  return {service,orderStore,reportStore,paymentProvider,get generationCalls(){return generationCalls;}};
}
async function ready(ctx,orderId){await ctx.service.waitForGenerationJobs();return (await ctx.service.getOrder(orderId)).body.order;}

test("FAMILY0 end-to-end: no payment/PAID, one immutable generation, authorized open/download and reload reuse",async()=>{
  const ctx=setup(); let paymentCalls=0;
  ctx.paymentProvider.createPayment=async()=>{paymentCalls+=1;throw new Error("payment must not run");};
  const applied=await ctx.service.applyPromo({birthInput:input,code:"FAMILY0"});
  const redeemed=await ctx.service.redeemPromo({orderId:applied.body.order.orderId,code:"FAMILY0"});
  assert.equal(redeemed.body.order.status,"REPORT_GENERATING");
  assert.equal(redeemed.body.order.accessReason,"complimentary_promo");
  assert.notEqual(redeemed.body.order.status,"PAID");
  const completed=await ready(ctx,redeemed.body.order.orderId);
  assert.equal(completed.status,"REPORT_READY"); assert.equal(ctx.generationCalls,1); assert.equal(ctx.reportStore.writes,1); assert.equal(paymentCalls,0);
  const opened=await ctx.service.deliver(completed.reportAccessToken);
  assert.equal(opened.status,200); assert.equal(opened.buffer.subarray(0,5).toString(),"%PDF-"); assert.equal(opened.filename,"Tian-Min_Тест_1995.pdf");
  const savedWithoutPresentationMetadata=ctx.reportStore.records.get(completed.reportId);
  ctx.reportStore.records.set(completed.reportId,{...savedWithoutPresentationMetadata,presentation:{},input:{...savedWithoutPresentationMetadata.input,date:""}});
  const legacyOpened=await ctx.service.deliver(completed.reportAccessToken);
  assert.equal(legacyOpened.filename,"Tian-Min_Тест_1995.pdf"); assert.equal(ctx.generationCalls,1);
  const restored=setup({orderStore:ctx.orderStore,reportStore:ctx.reportStore,paymentProvider:ctx.paymentProvider,reportGenerator:async()=>{throw new Error("must not regenerate");}});
  assert.equal((await restored.service.getOrder(completed.orderId)).body.order.status,"REPORT_READY");
  assert.equal((await restored.service.generate(completed.orderId)).body.order.status,"REPORT_READY");
  assert.equal(ctx.generationCalls,1); assert.equal(ctx.reportStore.writes,1);
});

test("generation gate rejects no entitlement and provider-unsettled paid-looking state",async()=>{
  const ctx=setup(); const order=(await ctx.service.createCheckout(input)).body.order;
  assert.equal((await ctx.service.generate(order.orderId)).status,403);
  await ctx.orderStore.saveAttempt({attemptId:"attempt_pending",orderId:order.orderId,providerStatus:"succeeded_pending",paymentPublicId:"pay_pending"});
  await ctx.orderStore.save({...await ctx.orderStore.load(order.orderId),status:"PAID",paymentId:"pay_pending",paymentConfirmedAt:now.toISOString()});
  const lorentsen=new PremiumService({env:{NODE_ENV:"production"},orderStore:ctx.orderStore,reportStore:ctx.reportStore,paymentProvider:{name:"lorentsen",config:{}},reportGenerator:async o=>semantic(o),pdfRenderer:async()=>({status:200,buffer:Buffer.from("%PDF-x")}),now:()=>now,logger:{error(){}}});
  assert.equal((await lorentsen.generate(order.orderId)).status,403);
});

test("authenticated Lorentsen settled is a paid entitlement for the same generation pipeline",async()=>{
  const ctx=setup(); const order=(await ctx.service.createCheckout(input)).body.order;
  await ctx.orderStore.saveAttempt({attemptId:"attempt_settled",orderId:order.orderId,providerStatus:"settled",paymentPublicId:"pay_settled"});
  await ctx.orderStore.save({...await ctx.orderStore.load(order.orderId),status:"PAID",paymentId:"pay_settled",paymentConfirmedAt:now.toISOString()});
  let calls=0;
  const service=new PremiumService({env:{NODE_ENV:"production"},orderStore:ctx.orderStore,reportStore:ctx.reportStore,paymentProvider:{name:"lorentsen",config:{}},reportGenerator:async o=>{calls+=1;return semantic(o);},pdfRenderer:async()=>({status:200,buffer:Buffer.from("%PDF-paid")}),now:()=>now,logger:{error(){}}});
  assert.equal((await service.generate(order.orderId)).status,202); await service.waitForGenerationJobs();
  assert.equal((await service.getOrder(order.orderId)).body.order.status,"REPORT_READY"); assert.equal(calls,1);
});

test("two service instances race on one report but the store transition grants one generation claim",async()=>{
  const ctx=setup(); const order=(await ctx.service.createCheckout(input)).body.order;
  await ctx.service.startPayment(order.orderId); await ctx.service.applyMockOutcome(order.orderId,"succeeded");
  let calls=0,release; const gate=new Promise(resolve=>{release=resolve;});
  const generator=async current=>{calls+=1;await gate;return semantic(current);};
  const options={orderStore:ctx.orderStore,reportStore:ctx.reportStore,paymentProvider:ctx.paymentProvider,reportGenerator:generator,pdfRenderer:async()=>({status:200,buffer:Buffer.from("%PDF-race")})};
  const a=setup(options),b=setup(options);
  const [first,second]=await Promise.all([a.service.generate(order.orderId),b.service.generate(order.orderId)]);
  assert.equal(first.body.order.status,"REPORT_GENERATING"); assert.equal(second.body.order.status,"REPORT_GENERATING"); assert.equal(calls,1);
  release(); await a.service.waitForGenerationJobs();
  assert.equal((await a.service.getOrder(order.orderId)).body.order.status,"REPORT_READY"); assert.equal(calls,1);
});

test("failed generation exposes safe state and retry reuses entitlement without payment or promo redemption",async()=>{
  const ctx=setup(); const applied=await ctx.service.applyPromo({birthInput:input,code:"FAMILY0"});
  let calls=0;
  ctx.service.reportGenerator=async order=>{calls+=1;if(calls===1)throw Object.assign(new Error("secret provider detail"),{code:"TEST_FAILURE"});return semantic(order);};
  const redeemed=await ctx.service.redeemPromo({orderId:applied.body.order.orderId,code:"FAMILY0"});
  let order=await ready(ctx,redeemed.body.order.orderId); assert.equal(order.status,"REPORT_FAILED");
  assert.equal(ctx.orderStore.promoRedemptions.size,1);
  await ctx.service.generate(order.orderId,{ expectedAttempt:order.reportGenerationAttempt }); order=await ready(ctx,order.orderId);
  assert.equal(order.status,"REPORT_READY"); assert.equal(calls,2); assert.equal(ctx.orderStore.promoRedemptions.size,1);
});

test("AI_NOT_CONFIGURED failure keeps FAMILY0 entitlement and retry reuses the same order/report",async()=>{
  const ctx=setup(); let paymentCalls=0;
  ctx.paymentProvider.createPayment=async()=>{paymentCalls+=1;throw new Error("payment must not run");};
  ctx.service.reportGenerator=async()=>{throw Object.assign(new Error("provider unavailable"),{code:"AI_NOT_CONFIGURED",generationStage:"provider_configuration"});};
  const applied=await ctx.service.applyPromo({birthInput:input,code:"FAMILY0"});
  const redeemed=await ctx.service.redeemPromo({orderId:applied.body.order.orderId,code:"FAMILY0"});
  const failed=await ready(ctx,redeemed.body.order.orderId);
  assert.equal(failed.status,"REPORT_FAILED");
  assert.equal(failed.accessReason,"complimentary_promo");
  assert.notEqual(failed.status,"PAID");
  assert.equal(ctx.orderStore.promoRedemptions.size,1);
  assert.equal(ctx.orderStore.orders.size,1);
  assert.equal(paymentCalls,0);

  let retryCalls=0;
  ctx.service.reportGenerator=async order=>{retryCalls+=1;return semantic(order);};
  const retryOptions={ expectedAttempt:failed.reportGenerationAttempt };
  const [first,second]=await Promise.all([ctx.service.generate(failed.orderId,retryOptions),ctx.service.generate(failed.orderId,retryOptions)]);
  assert.equal(first.body.order.reportId,failed.reportId);
  assert.equal(second.body.order.reportId,failed.reportId);
  const completed=await ready(ctx,failed.orderId);
  assert.equal(completed.status,"REPORT_READY");
  assert.equal(completed.orderId,failed.orderId);
  assert.equal(completed.reportId,failed.reportId);
  assert.equal(retryCalls,1);
  assert.equal(ctx.orderStore.promoRedemptions.size,1);
  assert.equal(ctx.orderStore.orders.size,1);
  assert.equal(paymentCalls,0);
});

test("PDF failure persists validated semantic report and retry renders it without a second model call",async()=>{
  let renderCalls=0;
  const ctx=setup({pdfRenderer:async()=>{renderCalls+=1;if(renderCalls===1)throw Object.assign(new Error("font missing"),{code:"PDF_FONT_UNAVAILABLE"});return{status:200,buffer:Buffer.from("%PDF-recovered")};}});
  const applied=await ctx.service.applyPromo({birthInput:input,code:"FAMILY0"});
  const redeemed=await ctx.service.redeemPromo({orderId:applied.body.order.orderId,code:"FAMILY0"});
  const failed=await ready(ctx,redeemed.body.order.orderId);
  assert.equal(failed.status,"REPORT_FAILED");
  assert.equal(ctx.generationCalls,1);
  assert.equal(ctx.reportStore.writes,1);
  const retry=await ctx.service.generate(failed.orderId,{expectedAttempt:failed.reportGenerationAttempt});
  assert.equal(retry.status,202);
  const completed=await ready(ctx,failed.orderId);
  assert.equal(completed.status,"REPORT_READY");
  assert.equal(ctx.generationCalls,1);
  assert.equal(ctx.reportStore.writes,1);
  assert.equal(renderCalls,2);
});

test("stale sequential retry cannot claim a second generation after the displayed attempt changed",async()=>{
  const ctx=setup();
  const applied=await ctx.service.applyPromo({birthInput:input,code:"FAMILY0"});
  ctx.service.reportGenerator=async()=>{throw Object.assign(new Error("failed"),{code:"TEST_FAILURE"});};
  const redeemed=await ctx.service.redeemPromo({orderId:applied.body.order.orderId,code:"FAMILY0"});
  const failed=await ready(ctx,redeemed.body.order.orderId);
  const displayedAttempt=failed.reportGenerationAttempt;
  await ctx.service.generate(failed.orderId,{expectedAttempt:displayedAttempt});
  const failedAgain=await ready(ctx,failed.orderId);
  assert.equal(failedAgain.reportGenerationAttempt,displayedAttempt+1);
  assert.equal((await ctx.service.generate(failed.orderId,{expectedAttempt:displayedAttempt})).status,409);
});

test("report capability is high-entropy, bound server-side and unauthorized tokens fail closed",async()=>{
  const ctx=setup(); const applied=await ctx.service.applyPromo({birthInput:input,code:"FAMILY0"});
  const redeemed=await ctx.service.redeemPromo({orderId:applied.body.order.orderId,code:"FAMILY0"}); const order=await ready(ctx,redeemed.body.order.orderId);
  assert.match(order.reportAccessToken,/^[A-Za-z0-9_-]{43}$/); assert.doesNotMatch(order.reportAccessToken,/order|pay|1995|09|03/i);
  assert.equal((await ctx.service.deliver("A".repeat(43))).status,404);
  const saved=ctx.reportStore.records.get(order.reportId); ctx.reportStore.records.set(order.reportId,{...saved,chartId:"different_chart"});
  assert.equal((await ctx.service.deliver(order.reportAccessToken)).status,404);
});

test("personalized report filename uses only sanitized first name and birth year",()=>{
  assert.equal(buildPersonalReportFilename("Эдуард Иванов","1995-09-03"),"Tian-Min_Эдуард_1995.pdf");
  assert.equal(buildPersonalReportFilename("Роза","1971-01-01"),"Tian-Min_Роза_1971.pdf");
  assert.equal(buildPersonalReportFilename("  Anne-Marie O'Neil  ","2000-02-29"),"Tian-Min_Anne-Marie_2000.pdf");
  assert.equal(buildPersonalReportFilename("O'Neil","2000-02-29"),"Tian-Min_O'Neil_2000.pdf");
  assert.equal(buildPersonalReportFilename("../\\<script>Эдуард\u0000:*?","1995-09-03"),"Tian-Min_scriptЭдуард_1995.pdf");
  assert.equal(buildPersonalReportFilename("ОченьДлинноеИмя".repeat(8),"1995-09-03").length<100,true);
  assert.equal(buildPersonalReportFilename("","1995-09-03"),"Tian-Min_1995.pdf");
  assert.equal(buildPersonalReportFilename("Эдуард",""),"Tian-Min_Report.pdf");
  assert.equal(buildPersonalReportFilename("",""),"tian-min-personal-report.pdf");
});

function get(server,url){return new Promise((resolve,reject)=>{const request=Readable.from([]);request.method="GET";request.url=url;request.headers={};const chunks=[];const response={status:0,headers:{},writeHead(status,headers){this.status=status;this.headers=headers;},end(value=""){chunks.push(Buffer.from(value));resolve({status:this.status,headers:this.headers,body:Buffer.concat(chunks)});},write(value){chunks.push(Buffer.from(value));}};server.emit("request",request,response);});}

test("open/download routes set inline vs attachment and never expose internal filename",async()=>{
  const deliveredTokens=[];
  const premiumService={deliver:async token=>{deliveredTokens.push(token);return /^[A-Za-z0-9_-]{43}$/.test(token)?{status:200,buffer:Buffer.from("%PDF-route"),filename:"Tian-Min_Эдуард_1995.pdf"}:{status:404,error:"Отчёт не найден."};}};
  const server=createServer({premiumService});
  try{
    const token="A".repeat(43);
    const legacyOpen=await get(server,"/api/premium/report/"+token);
    const open=await get(server,"/api/premium/report/"+token+"/tian-min-personal-report.pdf");
    const download=await get(server,"/api/premium/report/"+token+"/tian-min-personal-report.pdf?download=1");
    const invalidToken=await get(server,"/api/premium/report/invalid/tian-min-personal-report.pdf");
    const invalidFilename=await get(server,"/api/premium/report/"+token+"/"+token);
    assert.equal(legacyOpen.status,200); assert.equal(open.status,200); assert.equal(download.status,200);
    assert.equal(open.headers["Content-Type"],"application/pdf"); assert.equal(download.headers["Content-Type"],"application/pdf");
    const encodedPersonalized="Tian-Min_%D0%AD%D0%B4%D1%83%D0%B0%D1%80%D0%B4_1995.pdf";
    assert.equal(open.headers["Content-Disposition"],`inline; filename="tian-min-personal-report.pdf"; filename*=UTF-8''${encodedPersonalized}`);
    assert.equal(download.headers["Content-Disposition"],`attachment; filename="tian-min-personal-report.pdf"; filename*=UTF-8''${encodedPersonalized}`);
    assert.doesNotMatch(open.headers["Content-Disposition"],new RegExp(token));
    assert.doesNotMatch(download.headers["Content-Disposition"],new RegExp(token));
    assert.equal(invalidToken.status,404); assert.equal(invalidFilename.status,404);
    assert.deepEqual(deliveredTokens,[token,token,token,"invalid"]);
    assert.equal(open.headers["Referrer-Policy"],"no-referrer");
    assert.equal(open.headers["Cache-Control"],"private, no-store");
  }finally{server.close();}
});

test("existing personal-report-v4 mock pipeline and frozen PDF renderer integrate into READY artifact",async()=>{
  const env={NODE_ENV:"development",PAYMENT_MODE:"mock",AI_MODE:"mock",OPENAI_MODEL:"mock-v1"};
  const orderStore=new MemoryOrderStore(),reportStore=new MemoryReportStore(),paymentProvider=new MockPaymentProvider({env});
  const service=new PremiumService({env,orderStore,reportStore,paymentProvider,now:()=>now,logger:{error(){}}});
  const applied=await service.applyPromo({birthInput:input,code:"FAMILY0"});
  const redeemed=await service.redeemPromo({orderId:applied.body.order.orderId,code:"FAMILY0"});
  await service.waitForGenerationJobs();
  const order=(await service.getOrder(redeemed.body.order.orderId)).body.order;
  assert.equal(order.status,"REPORT_READY");
  const saved=reportStore.load(order.reportId);
  assert.equal(saved.kind,"semantic-report"); assert.equal(saved.schemaVersion,"personal-report-v4");
  const delivery=await service.deliver(order.reportAccessToken);
  assert.equal(delivery.filename,"Tian-Min_Тест_1995.pdf");
  assert.equal(delivery.status,200); assert.equal(delivery.buffer.subarray(0,5).toString(),"%PDF-"); assert.ok(delivery.buffer.length>50000);
});

test("production persistence owns atomic generation claim and immutable report insert",()=>{
  const source=fs.readFileSync(path.resolve(__dirname,"../lib/production-store.cjs"),"utf8");
  assert.match(source,/claimReportGeneration[\s\S]*UPDATE tian_min_orders[\s\S]*reportGenerationAttempt[\s\S]*REPORT_GENERATING[\s\S]*RETURNING record/);
  assert.match(source,/saveImmutable[\s\S]*ON CONFLICT\(report_id\) DO NOTHING/);
  assert.match(source,/CREATE UNIQUE INDEX IF NOT EXISTS tian_min_orders_report_access_idx/);
});

test("customer UX contains generating, failed, ready, open/download and same-browser recovery without stub copy",()=>{
  const source=fs.readFileSync(path.resolve(__dirname,"../public/app.js"),"utf8");
  assert.match(source,/Готовим ваш персональный разбор/); assert.match(source,/Обычно это занимает 1–3 минуты\./);
  assert.match(source,/Не удалось подготовить отчёт\. Попробуйте ещё раз\./);
  assert.match(source,/Вернуться к результату/); assert.match(source,/reportGenerationAttempt:order\.reportGenerationAttempt/);
  assert.match(source,/Ваш персональный разбор готов/); assert.match(source,/Сохраните PDF, чтобы вернуться к нему в любое время\./);
  assert.match(source,/class="premium-button" data-action="download-report"[^>]*>Сохранить PDF</);
  assert.match(source,/class="secondary-checkout-button" data-action="open-report"[^>]*>Открыть отчёт</);
  assert.ok(source.indexOf('data-action="download-report"') < source.indexOf('data-action="open-report"'));
  assert.match(source,/\/api\/premium\/report\/\$\{encodeURIComponent\(order\.reportAccessToken\)\}\/tian-min-personal-report\.pdf/);
  assert.match(source,/localStorage\.getItem\("tianMinOrderId"\)/); assert.match(source,/scheduleGenerationPoll/);
  assert.doesNotMatch(source,/Тестовый отчёт сохранён|Открыть тестовый результат|Report ID:/);
  const styles=fs.readFileSync(path.resolve(__dirname,"../public/styles.css"),"utf8");
  assert.match(styles,/checkout-progress-indeterminate/); assert.doesNotMatch(styles,/\.checkout-progress i\{display:block;width:65%/);
  assert.doesNotMatch(source,/Поделиться PDF|Web Share|navigator\.share/);
});
