const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {importGeoNames}=require("../scripts/import-geonames.cjs");
const {GeoNamesLocationProvider}=require("../lib/location-provider.cjs");

test("reproducible importer filters P places, joins alternateNamesV2 and preserves historic metadata",async t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"tian-min-geonames-test-")); t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const cities=path.join(temp,"cities500.txt"),alternates=path.join(temp,"alternateNamesV2.txt"),admin1=path.join(temp,"admin1CodesASCII.txt"),out=path.join(temp,"out");
  fs.writeFileSync(admin1,"TH.40\tPhuket\tPhuket\t1\nRU.66\tSt.-Petersburg\tSt.-Petersburg\t2\n");
  const row=({id,name,ascii,lat,lng,code,country,admin,pop,tz})=>[id,name,ascii,"",lat,lng,"P",code,country,"",admin,"","","",pop,"","",tz,"2026-08-13"].join("\t");
  fs.writeFileSync(cities,[row({id:1,name:"Phuket",ascii:"Phuket",lat:7.89,lng:98.4,code:"PPLA",country:"TH",admin:"40",pop:79000,tz:"Asia/Bangkok"}),row({id:2,name:"Saint Petersburg",ascii:"Saint Petersburg",lat:59.93,lng:30.31,code:"PPLA",country:"RU",admin:"66",pop:5000000,tz:"Europe/Moscow"})].join("\n")+"\n");
  fs.writeFileSync(alternates,["10\t1\tru\tПхукет\t1\t0\t0\t0\t\t","11\t1\tth\tภูเก็ต\t1\t0\t0\t0\t\t","12\t2\tru\tСанкт-Петербург\t1\t0\t0\t0\t\t","13\t2\tru\tЛенинград\t0\t0\t0\t1\t1924\t1991","14\t1\tlink\thttps://example.com\t0\t0\t0\t0\t\t"].join("\n")+"\n");
  const manifest=await importGeoNames({cities,alternates,admin1,out,version:"test"});
  assert.equal(manifest.placeCount,2); assert.equal(manifest.alternateNameCount,4); assert.equal(manifest.historicNameCount,1);
  const provider=new GeoNamesLocationProvider({root:out});
  assert.equal(provider.search("Пхукет")[0].geonameId,1); assert.equal(provider.search("ภูเก็ต")[0].geonameId,1);
  const historic=provider.search("Ленинград")[0]; assert.equal(historic.geonameId,2); assert.equal(historic.matchedName.isHistoric,true); assert.equal(historic.matchedName.to,"1991");
});
