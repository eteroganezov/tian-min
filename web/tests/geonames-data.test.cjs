const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const zlib=require("node:zlib");
const {locationProvider,normalize}=require("../lib/location-provider.cjs");

const root=path.resolve(__dirname,"..","data","geonames");
const manifest=JSON.parse(fs.readFileSync(path.join(root,"manifest.json"),"utf8"));

test("versioned GeoNames snapshot имеет provenance, counts и CC BY metadata",()=>{
  assert.equal(manifest.version,"2026-08-13"); assert.equal(manifest.license,"CC BY 4.0");
  assert.ok(manifest.placeCount>200000); assert.ok(manifest.alternateNameCount>1000000); assert.ok(manifest.historicNameCount>8000);
  assert.ok(manifest.russianPlaceCount>40000); assert.ok(manifest.multilingualComparableCount>20000);
  assert.match(manifest.sourceFiles.cities500.sha256,/^[a-f0-9]{64}$/); assert.match(manifest.sourceFiles.alternateNamesV2.sha256,/^[a-f0-9]{64}$/);
});

test("mass multilingual regression по 1000 automatically selected unambiguous GeoNames places",()=>{
  const comparable=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,"coverage-ru.json.gz"))));
  const step=Math.floor(comparable.length/1000); const sample=comparable.filter((_,index)=>index%step===0).slice(0,1000);
  assert.equal(sample.length,1000);
  for(const [id,ru,canonical] of sample) {
    const localized=locationProvider.search(ru)[0],english=locationProvider.search(canonical)[0];
    assert.equal(localized?.geonameId,id,`${ru} -> ${id}`); assert.equal(english?.geonameId,id,`${canonical} -> ${id}`);
    assert.equal(localized.latitude,english.latitude,ru); assert.equal(localized.longitude,english.longitude,ru); assert.equal(localized.timeZone,english.timeZone,ru);
  }
});

test("normalization handles Unicode, diacritics, punctuation, hyphens, apostrophes и ё/е",()=>{
  assert.equal(normalize("  Río‑de‑Janeiro  "),"rio de janeiro");
  assert.equal(normalize("Орёл"),normalize("орел"));
  assert.equal(normalize("О’Коннор"),"о коннор");
});

test("search is bounded to eight browser results and malformed/no-result input is safe",()=>{
  assert.ok(locationProvider.search("San",999).length<=8);
  assert.deepEqual(locationProvider.search(""),[]); assert.deepEqual(locationProvider.search("\u0000\u0001"),[]);
  assert.deepEqual(locationProvider.search("zzzzzzzzzzzzzzzzzzzz"),[]);
});
