const fs = require("node:fs");
const PDFDocument = require("pdfkit");
const { russianTypography } = require("./report-content.cjs");

const VERSION = "personal-report-v4";
const COLORS = Object.freeze({
  ink:"#19231f", muted:"#68736e", jade:"#173f36", jade2:"#24594c",
  sage:"#e1e9e3", sage2:"#cbdad1", sand:"#f2ede2", paper:"#fbfaf6",
  gold:"#b08d55", red:"#96503f", white:"#ffffff", line:"#d8ddd8",
});
const PAGE = Object.freeze({ x:48, width:499, top:46, contentTop:154, bottom:764 });
const PALACES = Object.freeze({ 命:"Судьба",命宫:"Судьба",兄弟:"Братья и сёстры",兄弟宫:"Братья и сёстры",夫妻:"Партнёрство",夫妻宫:"Партнёрство",子女:"Самовыражение",子女宫:"Самовыражение",财帛:"Финансы",财帛宫:"Финансы",疾厄:"Здоровье",疾厄宫:"Здоровье",迁移:"Перемещения",迁移宫:"Перемещения",交友:"Окружение",交友宫:"Окружение",官禄:"Карьера",官禄宫:"Карьера",田宅:"Дом",田宅宫:"Дом",福德:"Внутреннее состояние",福德宫:"Внутреннее состояние",父母:"Родители",父母宫:"Родители" });
const TRANSFORMATIONS = Object.freeze({ 化禄:"Хуа Лу · возможности и ресурс",化权:"Хуа Цюань · влияние и ответственность",化科:"Хуа Кэ · признание и ясность",化忌:"Хуа Цзи · зона внимания" });

function createPremiumReportV4Pdf({ chart, metadata, presentation = {}, report, evidenceCatalog }) {
  if (report?.schemaVersion !== VERSION) throw new Error("Renderer v4 принимает только personal-report-v4.");
  if (!Array.isArray(evidenceCatalog?.items)) throw new Error("Renderer v4 требует versioned evidence catalog.");
  return new Promise((resolve,reject)=>{
    const doc = new PDFDocument({
      size:"A4", margin:0, bufferPages:true, autoFirstPage:false,
      info:{
        Title:`${presentation.displayName ? `${presentation.displayName} — ` : ""}Ба-цзы + Цзы Вэй · Персональный разбор`,
        Author:"Тянь Мин", Subject:"Персональный отчёт Ба-цзы и Цзы Вэй Доу Шу",
        Keywords:`Тянь Мин, Ба-цзы, Цзы Вэй, персональный разбор, ${VERSION}`,
        Creator:"Тянь Мин Premium Report", Producer:"Тянь Мин / PDFKit",
        CreationDate:new Date(), ReportVersion:VERSION,
      },
    });
    const chunks=[];
    doc.on("data",chunk=>chunks.push(chunk));
    doc.on("error",reject);
    doc.on("end",()=>resolve(Buffer.concat(chunks)));
    try {
      const fonts=registerFonts(doc);
      const ctx={ doc, fonts, chart, metadata, presentation, report, catalog:evidenceCatalog, byId:new Map(evidenceCatalog.items.map(item=>[item.id,item])), sections:[], tocIndex:null, sectionTitle:"", pageKind:"" };
      cover(ctx);
      reserveToc(ctx);
      executivePortrait(ctx);
      readingGuide(ctx);
      baziEvidence(ctx);
      ziweiEvidence(ctx);
      timeline(ctx);
      personality(ctx);
      traits(ctx);
      strengths(ctx);
      challenges(ctx);
      editorial(ctx,report.career,"Работа, роль и реализация","РАБОЧАЯ РЕАЛИЗАЦИЯ");
      editorial(ctx,report.money,"Деньги и управление ресурсами","РЕСУРСЫ И ОБМЕН");
      editorial(ctx,report.relationships,"Отношения и границы","БЛИЗОСТЬ И ДОГОВОРЁННОСТИ");
      environmentLeadership(ctx);
      lifestyle(ctx);
      currentPeriod(ctx);
      yearlyThemes(ctx);
      crossValidation(ctx);
      actionPlan(ctx);
      manifestations(ctx);
      finalPage(ctx);
      renderToc(ctx);
      addPageNumbers(ctx);
      doc.end();
    } catch(error) { reject(error); }
  });
}

function choose(candidates){ return candidates.filter(Boolean).find(file=>fs.existsSync(file)); }
function registerFonts(doc){
  const regular=choose([process.env.PDF_FONT_REGULAR,"/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf","/System/Library/Fonts/Supplemental/Arial.ttf"]);
  const bold=choose([process.env.PDF_FONT_BOLD,"/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf","/System/Library/Fonts/Supplemental/Arial Bold.ttf"]);
  const serif=choose([process.env.PDF_FONT_SERIF,"/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf","/System/Library/Fonts/Supplemental/Georgia.ttf"]);
  const serifBold=choose([process.env.PDF_FONT_SERIF_BOLD,"/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf","/System/Library/Fonts/Supplemental/Georgia Bold.ttf"]);
  const cjk=choose([process.env.PDF_FONT_CJK,"/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc","/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf","/System/Library/Fonts/Supplemental/Arial Unicode.ttf"]);
  if(process.env.NODE_ENV==="production"&&!cjk) throw Object.assign(new Error("Для production PDF требуется PDF_FONT_CJK или Noto Sans CJK."),{code:"PDF_CJK_FONT_UNAVAILABLE"});
  if(regular)doc.registerFont("V4Body",regular);else doc.registerFont("V4Body","Helvetica");
  if(bold)doc.registerFont("V4Bold",bold);else doc.registerFont("V4Bold","Helvetica-Bold");
  if(serif)doc.registerFont("V4Serif",serif);else doc.registerFont("V4Serif","Times-Roman");
  if(serifBold)doc.registerFont("V4SerifBold",serifBold);else doc.registerFont("V4SerifBold","Times-Bold");
  let cjkReady=false;
  if(cjk){try{doc.registerFont("V4CJK",cjk);doc.font("V4CJK");cjkReady=true;}catch{cjkReady=false;}}
  if(process.env.NODE_ENV==="production"&&!cjkReady) throw Object.assign(new Error("Production CJK-шрифт не удалось зарегистрировать в PDFKit."),{code:"PDF_CJK_FONT_INVALID"});
  return { cjkReady, paths:{regular,bold,serif,serifBold,cjk} };
}

function clean(value,ctx){
  let text=russianTypography(String(value??"").normalize("NFC")
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/gu,"")
    .replace(/[\uFFFD\uFFFE\uFFFF]/gu,"-")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu,"")
    .replace(/[−‑]/gu,"-").replace(/[ \t]{2,}/gu," ").trim());
  if(ctx&&!ctx.fonts.cjkReady) text=text.replace(/[\u3400-\u9FFF]+/gu,"").replace(/\s+([,.;:])/gu,"$1").replace(/\s{2,}/gu," ");
  return text;
}
function font(ctx,text,bold=false,serif=false){
  if(ctx.fonts.cjkReady&&/[\u3400-\u9FFF]/u.test(String(text)))return "V4CJK";
  if(serif)return bold?"V4SerifBold":"V4Serif";
  return bold?"V4Bold":"V4Body";
}
function pageNumber(ctx){return ctx.doc.bufferedPageRange().count;}
function basePage(ctx,dark=false){
  const {doc}=ctx; doc.addPage(); doc.rect(0,0,doc.page.width,doc.page.height).fill(dark?COLORS.jade:COLORS.paper); doc.y=PAGE.top;
}
function registerSection(ctx,title,tocTitle=title){
  const page=pageNumber(ctx); ctx.sections.push({title:tocTitle,page}); ctx.doc.outline.addItem(tocTitle); ctx.sectionTitle=title;
}
function sectionPage(ctx,title,intro,kicker,tocTitle=title){
  basePage(ctx); registerSection(ctx,title,tocTitle);
  brand(ctx); const {doc}=ctx;
  if(kicker)doc.fillColor(COLORS.gold).font("V4Bold").fontSize(7.2).text(clean(kicker,ctx).toUpperCase(),PAGE.x,78,{width:PAGE.width,characterSpacing:1.05});
  const y=kicker?103:88; doc.fillColor(COLORS.ink).font(font(ctx,title,true,true)).fontSize(title.length>44?23:27).text(clean(title,ctx),PAGE.x,y,{width:PAGE.width,lineGap:2});
  doc.y=Math.max(doc.y+10,kicker?146:132);
  if(intro){doc.fillColor(COLORS.muted).font("V4Body").fontSize(9.4).text(clean(intro,ctx),PAGE.x,doc.y,{width:PAGE.width,lineGap:3});doc.y+=15;}
}
function continuation(ctx){
  basePage(ctx); brand(ctx); const {doc}=ctx;
  doc.fillColor(COLORS.gold).font("V4Bold").fontSize(7.4).text(clean(ctx.sectionTitle,ctx).toUpperCase(),PAGE.x,84,{width:PAGE.width,characterSpacing:.8});
  doc.moveTo(PAGE.x,112).lineTo(PAGE.x+PAGE.width,112).strokeColor(COLORS.line).stroke();doc.y=138;
}
function brand(ctx){ctx.doc.fillColor(COLORS.gold).font(ctx.fonts.cjkReady?"V4CJK":"V4Bold").fontSize(8.2).text(clean("ТЯНЬ МИН · 天命",ctx),PAGE.x,44,{width:PAGE.width,characterSpacing:1});}
function ensure(ctx,height){if(ctx.doc.y+height>PAGE.bottom)continuation(ctx);}
function rule(ctx){const{doc}=ctx;doc.moveTo(PAGE.x,doc.y).lineTo(PAGE.x+PAGE.width,doc.y).strokeColor(COLORS.line).lineWidth(.7).stroke();doc.y+=12;}
function eyebrow(ctx,text,color=COLORS.gold){ctx.doc.fillColor(color).font("V4Bold").fontSize(6.8).text(clean(text,ctx).toUpperCase(),PAGE.x,ctx.doc.y,{width:PAGE.width,characterSpacing:.8});ctx.doc.y+=16;}
function flowText(ctx,text,options={}){
  const {doc}=ctx; let rest=clean(text,ctx); const size=options.size||9.3,lineGap=options.lineGap??3,width=options.width||PAGE.width,x=options.x||PAGE.x,color=options.color||COLORS.ink;
  while(rest){if(doc.y>PAGE.bottom-55)continuation(ctx);const available=PAGE.bottom-doc.y;doc.font(font(ctx,rest,options.bold,options.serif)).fontSize(size);let chunk=fitChunk(doc,rest,width,available,lineGap);if(!chunk){continuation(ctx);continue;}doc.fillColor(color).text(chunk,x,doc.y,{width,lineGap});rest=rest.slice(chunk.length).trim();if(rest)continuation(ctx);}
  doc.y+=options.after??10;
}
function fitChunk(doc,text,width,height,lineGap){
  if(doc.heightOfString(text,{width,lineGap})<=height)return text;
  let lo=1,hi=text.length,best="";while(lo<=hi){const mid=Math.floor((lo+hi)/2);let end=text.lastIndexOf(" ",mid);if(end<1)end=mid;const part=text.slice(0,end);if(doc.heightOfString(part,{width,lineGap})<=height){best=part;lo=mid+1;}else hi=mid-1;}return best;
}
function card(ctx,{label,title,text,action,tone="sage",basis}){
  const {doc}=ctx,w=PAGE.width,pad=15; const bg=tone==="sand"?COLORS.sand:tone==="plain"?COLORS.white:COLORS.sage;
  doc.font(font(ctx,title||text,true)).fontSize(10.4);const th=title?doc.heightOfString(clean(title,ctx),{width:w-pad*2,lineGap:2}):0;
  doc.font("V4Body").fontSize(8.5);const bh=doc.heightOfString(clean(text,ctx),{width:w-pad*2,lineGap:2.5});
  const ah=action?doc.heightOfString(clean(action,ctx),{width:w-pad*2-92,lineGap:2.3})+24:0;
  const eh=basis?doc.heightOfString(clean(basis,ctx),{width:w-pad*2-82,lineGap:2})+22:0;
  const h=Math.max(72,18+th+(title?8:0)+bh+ah+eh+18);ensure(ctx,h+10);const y=doc.y;
  doc.roundedRect(PAGE.x,y,w,h,8).fill(bg);let cy=y+13;
  if(label){doc.fillColor(COLORS.gold).font("V4Bold").fontSize(6.4).text(clean(label,ctx).toUpperCase(),PAGE.x+pad,cy,{width:w-pad*2,characterSpacing:.7});cy+=14;}
  if(title){doc.fillColor(COLORS.jade).font(font(ctx,title,true,true)).fontSize(10.4).text(clean(title,ctx),PAGE.x+pad,cy,{width:w-pad*2,lineGap:2});cy+=th+8;}
  doc.fillColor(COLORS.ink).font(font(ctx,text)).fontSize(8.5).text(clean(text,ctx),PAGE.x+pad,cy,{width:w-pad*2,lineGap:2.5});cy+=bh+8;
  if(action){doc.fillColor(COLORS.gold).font("V4Bold").fontSize(6.2).text("ПРИМЕНЕНИЕ",PAGE.x+pad,cy+2,{width:78});doc.fillColor(COLORS.ink).font("V4Body").fontSize(8).text(clean(action,ctx),PAGE.x+pad+92,cy,{width:w-pad*2-92,lineGap:2.3});cy+=ah;}
  if(basis){doc.fillColor(COLORS.muted).font("V4Bold").fontSize(6.1).text("ОСНОВАНИЕ",PAGE.x+pad,cy+2,{width:70});doc.fillColor(COLORS.muted).font(font(ctx,basis)).fontSize(7.2).text(clean(basis,ctx),PAGE.x+pad+82,cy,{width:w-pad*2-82,lineGap:2});}
  doc.y=y+h+10;
}
function compactRow(ctx,label,text,{accent=COLORS.gold,size=8.3}={}){
  const{doc}=ctx;doc.font(font(ctx,text)).fontSize(size);const h=Math.max(42,doc.heightOfString(clean(text,ctx),{width:354,lineGap:2.4})+16);ensure(ctx,h);const y=doc.y;
  doc.fillColor(accent).font("V4Bold").fontSize(6.5).text(clean(label,ctx).toUpperCase(),PAGE.x,y+4,{width:124,characterSpacing:.35});
  doc.fillColor(COLORS.ink).font(font(ctx,text)).fontSize(size).text(clean(text,ctx),PAGE.x+145,y,{width:354,lineGap:2.4});
  doc.moveTo(PAGE.x,y+h-8).lineTo(PAGE.x+PAGE.width,y+h-8).strokeColor(COLORS.line).stroke();doc.y=y+h;
}
function insightRow(ctx,{label,title,text,action,basisText,accent=COLORS.gold}){
  const{doc}=ctx,left=137,right=PAGE.width-left-18;const heading=clean(title,ctx),body=clean(text,ctx),use=clean(action,ctx),source=clean(basisText,ctx);
  doc.font(font(ctx,heading,true,true)).fontSize(9.1);const lh=doc.heightOfString(heading,{width:left,lineGap:1.5})+(label?18:0);
  doc.font(font(ctx,body)).fontSize(7.8);const bh=doc.heightOfString(body,{width:right,lineGap:2});
  doc.font(font(ctx,use)).fontSize(7.3);const ah=use?doc.heightOfString(use,{width:right-78,lineGap:1.8})+13:0;
  doc.font(font(ctx,source)).fontSize(6.6);const sh=source?doc.heightOfString(source,{width:right-72,lineGap:1.4})+12:0;
  const h=Math.max(55,lh,bh+ah+sh)+18;ensure(ctx,h);const y=doc.y;
  if(label)doc.fillColor(accent).font("V4Bold").fontSize(6.2).text(clean(label,ctx).toUpperCase(),PAGE.x,y+2,{width:left,characterSpacing:.45});
  doc.fillColor(COLORS.jade).font(font(ctx,heading,true,true)).fontSize(9.1).text(heading,PAGE.x,y+(label?18:0),{width:left,lineGap:1.5});
  let ry=y;doc.fillColor(COLORS.ink).font(font(ctx,body)).fontSize(7.8).text(body,PAGE.x+left+18,ry,{width:right,lineGap:2});ry+=bh+7;
  if(use){doc.fillColor(COLORS.gold).font("V4Bold").fontSize(5.9).text("ПРИМЕНЕНИЕ",PAGE.x+left+18,ry+1,{width:70});doc.fillColor(COLORS.ink).font(font(ctx,use)).fontSize(7.3).text(use,PAGE.x+left+96,ry,{width:right-78,lineGap:1.8});ry+=ah;}
  if(source){doc.fillColor(COLORS.muted).font("V4Bold").fontSize(5.7).text("ОСНОВАНИЕ",PAGE.x+left+18,ry+1,{width:64});doc.fillColor(COLORS.muted).font(font(ctx,source)).fontSize(6.6).text(source,PAGE.x+left+90,ry,{width:right-72,lineGap:1.4});}
  doc.moveTo(PAGE.x,y+h-7).lineTo(PAGE.x+PAGE.width,y+h-7).strokeColor(COLORS.line).stroke();doc.y=y+h;
}
function bulletList(ctx,items,{label,color=COLORS.jade,size=8.5}={}){if(label)eyebrow(ctx,label,color);for(const item of items||[]){ensure(ctx,38);const y=ctx.doc.y;ctx.doc.circle(PAGE.x+5,y+7,2.4).fill(color);ctx.doc.fillColor(COLORS.ink).font(font(ctx,item)).fontSize(size).text(clean(item,ctx),PAGE.x+18,y,{width:PAGE.width-18,lineGap:2.4});ctx.doc.y=Math.max(ctx.doc.y+7,y+30);}}
function basis(ctx,ids){return evidenceLabels(ctx,ids).join(" + ");}
function evidenceLabels(ctx,ids){return [...new Set((ids||[]).map(id=>consumerEvidenceLabel(ctx.byId.get(id))).filter(Boolean))];}
function consumerEvidenceLabel(value){
  if(!value)return "";const data=value.data||{};
  if(value.id.startsWith("ziwei.transformation."))return `Трансформация ${TRANSFORMATIONS[data.hua]||data.hua||"Цзы Вэй"} · ${PALACES[data.palace]||"дворец Цзы Вэй"}`;
  if(value.id.startsWith("ziwei.palace."))return `Дворец «${PALACES[data.palace]||"Цзы Вэй"}»`;
  if(value.id.startsWith("ziwei.annual."))return `Годовое сопоставление Цзы Вэй ${data.year||""}`.trim();
  return value.label;
}
function evidenceFacts(ctx,ids){return (ids||[]).map(id=>ctx.byId.get(id)).filter(Boolean);}
function item(ctx,id){return ctx.byId.get(id);}
function first(ctx,prefix){return ctx.catalog.items.find(value=>value.id.startsWith(prefix));}

function cover(ctx){
  basePage(ctx,true);const{doc,report,metadata,presentation}=ctx;
  doc.fillColor(COLORS.gold).font(ctx.fonts.cjkReady?"V4CJK":"V4Bold").fontSize(11).text(clean("ТЯНЬ МИН  天命",ctx),PAGE.x,58,{characterSpacing:1.5});
  doc.moveTo(PAGE.x,96).lineTo(PAGE.x+112,96).strokeColor("#6d837a").stroke();
  doc.fillColor("#a9bbb4").font("V4Bold").fontSize(8.2).text("ПЕРСОНАЛЬНЫЙ РАЗБОР",PAGE.x,130,{characterSpacing:1.25});
  doc.fillColor(COLORS.white).font("V4SerifBold").fontSize(31).text("Ба-цзы · Цзы Вэй\nДоу Шу",PAGE.x,176,{width:390,lineGap:7});
  doc.fillColor(COLORS.gold).font(ctx.fonts.cjkReady?"V4CJK":"V4Serif").fontSize(54).text(clean("命",ctx),455,166,{width:90,align:"center"});
  doc.fillColor("#dce5df").font("V4Serif").fontSize(17).text(clean(presentation.displayName||"Персональный отчёт",ctx),PAGE.x,315,{width:450});
  doc.fillColor("#a9bbb4").font("V4Body").fontSize(9.4).text(clean(`${report.archetype} · ${report.subtitle}`,ctx),PAGE.x,360,{width:455,lineGap:3});
  doc.moveTo(PAGE.x,455).lineTo(PAGE.x+PAGE.width,455).strokeColor("#55736a").stroke();
  [["Дата рождения",metadata.originalBirthDate],["Время",metadata.originalBirthTime],["Место",presentation.birthPlace?.label||metadata.birthPlace]].forEach(([label,value],index)=>{
    const y=490+index*45;doc.fillColor("#91a69e").font("V4Bold").fontSize(7.2).text(label.toUpperCase(),PAGE.x,y,{width:115});
    doc.fillColor(COLORS.white).font("V4Body").fontSize(10.3).text(clean(value,ctx),PAGE.x+135,y-1,{width:360,lineBreak:false,ellipsis:true});
  });
  doc.fillColor("#82978f").font("V4Body").fontSize(7).text("Персональный информационно-развлекательный отчёт. Не заменяет медицинские, финансовые или юридические рекомендации.",PAGE.x,735,{width:PAGE.width,lineGap:2});
}
function reserveToc(ctx){basePage(ctx);ctx.tocIndex=pageNumber(ctx)-1;registerSection(ctx,"Оглавление");}
function renderToc(ctx){
  const{doc}=ctx;const last=pageNumber(ctx)-1;doc.switchToPage(ctx.tocIndex);doc.rect(0,0,doc.page.width,doc.page.height).fill(COLORS.paper);brand(ctx);
  doc.fillColor(COLORS.ink).font("V4SerifBold").fontSize(28).text("Содержание",PAGE.x,94,{width:PAGE.width});doc.y=155;
  ctx.sections.filter((_,index)=>index>0).forEach((entry,index)=>{
    const y=doc.y;doc.fillColor(COLORS.gold).font("V4Bold").fontSize(7).text(String(index+1).padStart(2,"0"),PAGE.x,y+2,{width:28});
    doc.fillColor(COLORS.ink).font("V4Body").fontSize(9).text(clean(entry.title,ctx),PAGE.x+40,y,{width:395});
    doc.fillColor(COLORS.gold).font("V4Bold").fontSize(8.5).text(String(entry.page),PAGE.x+455,y,{width:44,align:"right"});
    doc.moveTo(PAGE.x+40,y+20).lineTo(PAGE.x+PAGE.width,y+20).dash(1,3).strokeColor(COLORS.line).stroke().undash();doc.y=y+31;
  });doc.switchToPage(last);
}

function executivePortrait(ctx){
  const r=ctx.report;sectionPage(ctx,"Ваш портрет в двух минутах",r.executivePortrait.summary,"ГЛАВНОЕ О ВАС");
  card(ctx,{label:"ИНТЕРПРЕТАЦИЯ",title:r.executivePortrait.headline,text:r.executivePortrait.synthesis,action:r.executivePortrait.currentFocus,basis:basis(ctx,r.executivePortrait.evidence)});
  r.executiveInsights.slice(0,2).forEach((value,index)=>insightRow(ctx,{label:`ВЫВОД ${String(index+1).padStart(2,"0")}`,title:value.title,text:value.conclusion,action:value.practicalApplication,basisText:basis(ctx,value.evidence)}));
  const second=r.executiveInsights.slice(2);if(second.length){continuation(ctx);second.forEach((value,index)=>insightRow(ctx,{label:`ВЫВОД ${String(index+3).padStart(2,"0")}`,title:value.title,text:value.conclusion,action:value.practicalApplication,basisText:basis(ctx,value.evidence)}));}
}
function readingGuide(ctx){const g=ctx.report.readingGuide;sectionPage(ctx,"Как читать отчёт","Три уровня помогают отделить исходные данные от их смысла и практического применения.","ТОЧНОСТЬ И ГРАНИЦЫ");
  card(ctx,{label:"РАССЧИТАНО",title:"То, что получено расчётным модулем без интерпретации",text:g.calculatedFacts,tone:"sage"});
  card(ctx,{label:"ИНТЕРПРЕТАЦИЯ",title:"Синтез нескольких рассчитанных признаков",text:"Персональные выводы являются синтезом рассчитанных признаков и сопровождаются понятными основаниями из обеих систем.",tone:"sand"});
  card(ctx,{label:"ПРИМЕНЕНИЕ",title:"Наблюдаемое действие или вопрос",text:g.practicalApplication,tone:"plain"});
  compactRow(ctx,"Точность",g.accuracy);compactRow(ctx,"Чувствительные темы",g.sensitiveTopics,{accent:COLORS.red});
}
function baziEvidence(ctx){
  sectionPage(ctx,"Доказательная база Ба-цзы","Не копия бесплатной карты, а компактная основа, на которую опираются выводы отчёта.","РАССЧИТАНО");
  const dm=item(ctx,"bazi.day_master");if(dm)card(ctx,{label:"ДНЕВНОЙ ХОЗЯИН",title:dm.label,text:dm.fact,tone:"sand"});
  eyebrow(ctx,"Четыре столпа");
  ["year","month","day","hour"].forEach(key=>{const p=item(ctx,`bazi.pillar.${key}`),h=item(ctx,`bazi.hidden_stems.${key}`);if(p)compactRow(ctx,p.label,`${p.fact}${h?` ${h.fact}`:""}`);});
  continuation(ctx);eyebrow(ctx,"Баланс и структура");
  ["bazi.elements.weighted","bazi.elements.seasonal","bazi.structure","bazi.strength","bazi.strength.breakdown","bazi.regulating"].map(id=>item(ctx,id)).filter(Boolean).forEach(value=>compactRow(ctx,value.label,value.fact,{size:7.8}));
  const relations=ctx.catalog.items.filter(value=>value.id.startsWith("bazi.relation.")||value.id.startsWith("bazi.pillar_relation.")).slice(0,5);
  if(relations.length){eyebrow(ctx,"Релевантные связи");relations.forEach(value=>compactRow(ctx,value.label,value.fact));}
}
function ziweiEvidence(ctx){
  sectionPage(ctx,"Доказательная база Цзы Вэй","Ключевые параметры, трансформации и возрастной контекст — без сверхплотного технического дампа.","РАССЧИТАНО");
  ["ziwei.life_palace","ziwei.body_palace","ziwei.five_element_bureau","ziwei.current_palace"].map(id=>item(ctx,id)).filter(Boolean).forEach(value=>compactRow(ctx,value.label,value.fact,{size:7.9}));
  const transformations=ctx.catalog.items.filter(value=>value.id.startsWith("ziwei.transformation."));
  if(transformations.length){eyebrow(ctx,"Четыре трансформации");transformations.slice(0,4).forEach(value=>compactRow(ctx,TRANSFORMATIONS[value.data?.hua]||"Трансформация Цзы Вэй",value.fact));}
  const palaces=ctx.catalog.items.filter(value=>value.id.startsWith("ziwei.palace."));
  [palaces.slice(0,6),palaces.slice(6,12)].forEach((group,pageIndex)=>{
    continuation(ctx);eyebrow(ctx,pageIndex?"Дворцы 07–12":"Двенадцать дворцов · 01–06");
    group.forEach(value=>{const d=value.data||{};const stars=[...(d.mainStars||[]),...(d.auxiliaryStars||[]).slice(0,3)].join(" · ")||"Главные звёзды не указаны";compactRow(ctx,`Дворец «${PALACES[d.palace]||"Цзы Вэй"}»`,`${d.stem||""}${d.branch||""} · ${stars}${d.agePeriod?` · период ${d.agePeriod.startAge}–${d.agePeriod.endAge} лет`:""}`);});
  });
}
function timeline(ctx){
  sectionPage(ctx,"Общая временная шкала","Две временные системы дают контекст последующим разделам, но не обещают конкретных событий.","ПЕРИОДЫ И БЛИЖАЙШИЕ ГОДЫ");
  const luck=ctx.catalog.items.filter(value=>value.id.startsWith("bazi.luck_period."));const current=luck.find(value=>value.data?.startYear<=ctx.report.yearlyOutlook[0]?.year&&value.data?.endYear>=ctx.report.yearlyOutlook[0]?.year);
  if(current)card(ctx,{label:"ТЕКУЩИЙ ПЕРИОД БА-ЦЗЫ",title:`${current.data.startYear}–${current.data.endYear}`,text:current.fact,tone:"sage"});
  const nearby=luck.filter(value=>!current||Math.abs(value.data?.startYear-current.data.startYear)<=20).slice(0,4);nearby.forEach(value=>compactRow(ctx,`${value.data.startYear}–${value.data.endYear}`,value.fact));
  const zw=item(ctx,"ziwei.current_palace");if(zw)card(ctx,{label:"ТЕКУЩИЙ ВОЗРАСТНОЙ ДВОРЕЦ",title:zw.label,text:zw.fact,tone:"sand"});
  eyebrow(ctx,"Ближайшие отчётные годы");ctx.report.yearlyOutlook.forEach(year=>compactRow(ctx,String(year.year),`${item(ctx,`bazi.annual.${year.year}`)?.fact||year.theme} · ${year.theme}`));
}
function personality(ctx){const r=ctx.report.personality;sectionPage(ctx,"Характер и внутренние мотивы",r.headline,"ВНУТРЕННИЙ ПОРТРЕТ");flowText(ctx,r.summary,{size:8.6,after:6});r.insights.forEach(value=>insightRow(ctx,{label:"ИНТЕРПРЕТАЦИЯ",title:value.heading,text:value.text,action:value.practicalApplication,basisText:basis(ctx,value.evidence)}));}
function traits(ctx){sectionPage(ctx,"Ваш характер в деталях","Пять устойчивых черт: ресурсная сторона и риск перегруза.","КЛЮЧЕВЫЕ ЧЕРТЫ");ctx.report.keyTraits.forEach((value,index)=>insightRow(ctx,{label:`ЧЕРТА ${String(index+1).padStart(2,"0")}`,title:value.title,text:`${value.explanation} В ресурсе: ${value.positive} Риск: ${value.shadow}`,basisText:basis(ctx,value.evidence)}));}
function strengths(ctx){sectionPage(ctx,"Сильные стороны","Сильная сторона становится ценностью, когда проявляется в конкретном контексте и действии. Основания раскрыты в разделах Ба-цзы и Цзы Вэй.","РЕСУРС");ctx.report.strengths.forEach((value,index)=>insightRow(ctx,{label:`РЕСУРС ${String(index+1).padStart(2,"0")}`,title:value.title,text:`${value.essence} ${value.manifestation} Где полезно: ${value.usefulWhere}`,action:value.practicalUse}));}
function challenges(ctx){sectionPage(ctx,"Точки роста","Это не недостатки характера, а повторяющиеся способы терять ресурс — вместе с возможной компенсацией.","ЗОНЫ ВНИМАНИЯ");ctx.report.challenges.forEach((value,index)=>insightRow(ctx,{label:`ПАТТЕРН ${String(index+1).padStart(2,"0")}`,title:value.pattern,text:`Триггер: ${value.trigger} Возможное следствие: ${value.consequence}`,action:value.compensation,accent:COLORS.red}));flowText(ctx,`Основания раздела: ${basis(ctx,ctx.report.challenges.flatMap(value=>value.evidence))}.`,{size:6.7,color:COLORS.muted,after:0});}
function editorial(ctx,data,title,kicker){sectionPage(ctx,title,data.headline,kicker);flowText(ctx,data.summary,{size:8.5,after:5});data.insights.forEach(value=>insightRow(ctx,{label:"ИНТЕРПРЕТАЦИЯ",title:value.heading,text:value.text,action:value.practicalApplication,basisText:basis(ctx,value.evidence)}));}
function environmentLeadership(ctx){const{environment:e,leadership:l}=ctx.report;sectionPage(ctx,"Среда и лидерство","Как условия вокруг вас влияют на качество решений и какой способ влияния выглядит наиболее органичным.","КОНТЕКСТ И ВЛИЯНИЕ");[["Поддерживает",e.supports],["Истощает",e.drains],["Союзники",e.allies],["Нежелательные сценарии",e.toxicPatterns],["Коммуникация",e.communication],["Стиль лидерства",l.style],["Контроль",l.control],["Авторитет",l.authority],["Конфликт",l.conflict],["Переговоры",l.negotiation],["Типичная ошибка",l.mistakes]].forEach(([label,text])=>compactRow(ctx,label,text,{accent:/Истощ|Нежел|ошибка/.test(label)?COLORS.red:COLORS.gold,size:7.9}));}
function lifestyle(ctx){const l=ctx.report.lifestyle;sectionPage(ctx,"Ритм и восстановление","Ресурс поддерживается не постоянной интенсивностью, а качеством переключения и завершения циклов.","ВОССТАНОВЛЕНИЕ");[["Рабочий ритм",l.rhythm],["Интенсивность",l.intensity],["Стабильность и перемены",l.stabilityVsChange],["Отдых",l.rest],["Ранний сигнал перегруза",l.overload],["Восстановление",l.recovery],["Физическая и цифровая среда",l.environment]].forEach(([label,text])=>card(ctx,{label,title:label,text,tone:/перегруз/i.test(label)?"sand":"sage"}));}
function currentPeriod(ctx){const p=ctx.report.currentPeriod;sectionPage(ctx,"Текущий жизненный период",p.headline,"АКЦЕНТ ПЕРИОДА");card(ctx,{label:"РАССЧИТАНО",title:"Временной контекст",text:p.period,basis:basis(ctx,p.evidence),tone:"sand"});card(ctx,{label:"ИНТЕРПРЕТАЦИЯ",title:p.headline,text:p.summary,tone:"sage"});bulletList(ctx,p.opportunities,{label:"Возможности"});bulletList(ctx,p.risks,{label:"Риски",color:COLORS.red});bulletList(ctx,p.actions,{label:"ПРАКТИЧЕСКИЙ ФОКУС",color:COLORS.gold});compactRow(ctx,"Точность",p.confidenceNote);}
function yearlyThemes(ctx){sectionPage(ctx,"Ближайшие три года","Годовые темы — это рамка для наблюдения и выбора фокуса, а не событийный прогноз.","ОСТОРОЖНЫЕ ТЕМЫ");ctx.report.yearlyOutlook.forEach((value,index)=>{const annual=item(ctx,`bazi.annual.${value.year}`),ganZhi=`${annual?.data?.ganZhi?.gan||""}${annual?.data?.ganZhi?.zhi||""}`;card(ctx,{label:String(value.year),title:value.theme,text:`Рассчитано: годовой знак ${ganZhi}.\nВозможности: ${value.opportunities}\nРиски: ${value.risks}\nФокус: ${value.focus}\nНе форсировать: ${value.avoid}`,action:value.confidenceNote,basis:basis(ctx,value.evidence),tone:index===1?"sand":"sage"});});}
function crossValidation(ctx){const c=ctx.report.crossValidation;sectionPage(ctx,"Где Ба-цзы и Цзы Вэй сходятся и расходятся","Синтез показывает не две параллельные трактовки, а степень поддержки каждого вывода.","СОПОСТАВЛЕНИЕ СИСТЕМ");const groups=[["Обе системы поддерживают",c.agreements,"high"],["Акценты отличаются",c.divergences,"medium"],["Наиболее устойчиво",c.stableConclusions,"high"],["Требует контекста",c.weakerConclusions,"medium"]];groups.forEach(([label,values,confidence],g)=>values.forEach((value,index)=>card(ctx,{label:`${label} · ${confidence.toUpperCase()}`,title:index?`${label} · ${index+1}`:label,text:value.conclusion,basis:basis(ctx,value.evidence),tone:g%2?"sand":"sage"})));const s=ctx.report.conclusionStability;bulletList(ctx,s.wellSupported,{label:"Хорошо подтверждается"});bulletList(ctx,s.needsContext,{label:"Зависит от жизненного контекста",color:COLORS.gold});bulletList(ctx,s.notLiteral,{label:"Нельзя воспринимать буквально",color:COLORS.red});}
function actionPlan(ctx){const a=ctx.report.actionPlan;sectionPage(ctx,"Персональный план на 12 месяцев","Наблюдаемые действия и небольшие эксперименты, связанные с главными выводами отчёта.","ПРАКТИЧЕСКИЙ ИТОГ");bulletList(ctx,a.next12Months,{label:"Три фокуса на год"});rule(ctx);bulletList(ctx,a.doMore,{label:"Делать чаще"});rule(ctx);bulletList(ctx,a.avoid,{label:"Чего избегать",color:COLORS.red});rule(ctx);bulletList(ctx,a.questions,{label:"Вопросы для самопроверки",color:COLORS.gold});const linked=(a.sourceInsightIds||[]).map(id=>ctx.report.executiveInsights.find(value=>value.id===id)?.title).filter(Boolean);if(linked.length)card(ctx,{label:"СВЯЗЬ С ГЛАВНЫМИ ВЫВОДАМИ",title:"Откуда взят этот план",text:linked.join(" · "),basis:basis(ctx,a.evidence),tone:"sand"});}
function manifestations(ctx){const r=ctx.report;sectionPage(ctx,"Как это может проявляться в жизни","Сверьте выводы отчёта с реальным опытом — совпадение не требуется принимать на веру.","САМОПРОВЕРКА");r.lifeManifestations.forEach((value,index)=>compactRow(ctx,String(index+1).padStart(2,"0"),value));eyebrow(ctx,"Границы интерпретации");bulletList(ctx,r.conclusionStability.needsContext,{color:COLORS.gold});bulletList(ctx,r.conclusionStability.notLiteral,{color:COLORS.red});}
function finalPage(ctx){const r=ctx.report.finalSummary;basePage(ctx,true);registerSection(ctx,"Итоговая персональная линия");brand(ctx);const{doc}=ctx;doc.fillColor("#a9bbb4").font("V4Bold").fontSize(8).text("ИТОГОВАЯ ПЕРСОНАЛЬНАЯ ЛИНИЯ",PAGE.x,104,{characterSpacing:1.1});doc.fillColor(COLORS.white).font("V4SerifBold").fontSize(28).text(clean(r.headline,ctx),PAGE.x,152,{width:470,lineGap:5});doc.fillColor("#dce5df").font("V4Body").fontSize(10.2).text(clean(r.summary,ctx),PAGE.x,280,{width:465,lineGap:4});doc.moveTo(PAGE.x,415).lineTo(PAGE.x+PAGE.width,415).strokeColor("#55736a").stroke();r.priorities.forEach((value,index)=>{const y=452+index*64;doc.fillColor(COLORS.gold).font("V4Bold").fontSize(9).text(String(index+1).padStart(2,"0"),PAGE.x,y,{width:30});doc.fillColor(COLORS.white).font("V4Serif").fontSize(14).text(clean(value,ctx),PAGE.x+50,y-3,{width:430});});doc.fillColor("#91a69e").font("V4Body").fontSize(8).text("Используйте этот отчёт как карту вопросов и наблюдений, а решения проверяйте реальными фактами вашей жизни.",PAGE.x,710,{width:470,lineGap:3});}
function addPageNumbers(ctx){const{doc}=ctx;const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(range.start+i);const dark=i===0||i===range.count-1;doc.fillColor(dark?"#82978f":COLORS.muted).font("V4Body").fontSize(7.2).text(`${i+1} / ${range.count}`,PAGE.x,792,{width:PAGE.width,align:"right",lineBreak:false});}}

module.exports={ VERSION, createPremiumReportV4Pdf, registerFonts };
