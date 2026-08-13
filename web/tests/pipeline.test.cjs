const test = require("node:test");
const assert = require("node:assert/strict");
const cityTimezones = require("city-timezones");
const { locationProvider } = require("../lib/location-provider.cjs");
const { calculateRequest } = require("../lib/calculate.cjs");

function place(query) {
  const result=locationProvider.search(query)[0];
  assert.ok(result,`Не найдено тестовое место: ${query}`);
  return result;
}
function legacyId(city) { return Buffer.from([city.city,city.province,city.country,city.lat,city.lng,city.timezone].join("|"),"utf8").toString("base64url"); }

test("GeoNames place хранит stable identity, coordinates и IANA timezone",()=>{
  const moscow=place("Москва");
  assert.equal(moscow.source,"geonames");
  assert.equal(moscow.geonameId,524901);
  assert.equal(moscow.id,"geonames:524901");
  assert.equal(moscow.timeZone,"Europe/Moscow");
  assert.equal(moscow.display.label,"Москва, Россия");
  assert.equal(locationProvider.resolve(moscow.id).longitude,37.61781);
  assert.equal(locationProvider.resolve("geonames:999999999"),null);
});

test("legacy city-timezones IDs читаются, но новый search всегда возвращает GeoNames",()=>{
  const old=cityTimezones.findFromCityStateProvince("Moscow Russia").find(value=>value.city==="Moscow");
  const resolved=locationProvider.resolve(legacyId(old));
  assert.equal(resolved.source,"city-timezones-legacy");
  assert.equal(resolved.timeZone,"Europe/Moscow");
  assert.equal(place("Москва").source,"geonames");
});

test("partial, case-insensitive и Unicode normalization работают",()=>{
  for(const [query,expected] of [["моск","Москва, Россия"],["санкт","Санкт-Петербург, Россия"],["екат","Екатеринбург, Россия"]]) assert.equal(place(query).display.label,expected,query);
  assert.equal(place("ЕРЕВАН").id,place("Yerevan").id);
  assert.equal(place("Йорк").id,place("йорк").id);
  assert.equal(place("екатеринбург").id,place("ёкатеринбург").id);
});

const FIXED=[
  ["Пхукет","Phuket","Пхукет, Таиланд"],["Бангкок","Bangkok"],["Паттайя","Pattaya"],["Чиангмай","Chiang Mai"],["Ереван","Yerevan"],["Гюмри","Gyumri"],
  ["Тбилиси","Tbilisi"],["Батуми","Batumi"],["Алматы","Almaty"],["Астана","Astana"],["Стамбул","Istanbul"],["Анталья","Antalya"],["Дубай","Dubai"],["Абу-Даби","Abu Dhabi"],
  ["Нью-Йорк","New York"],["Лос-Анджелес","Los Angeles"],["Майами","Miami"],["Лондон","London"],["Париж","Paris"],["Берлин","Berlin"],["Барселона","Barcelona"],["Рим","Rome"],
  ["Пекин","Beijing"],["Шанхай","Shanghai"],["Токио","Tokyo"],["Сеул","Seoul"],["Буэнос-Айрес","Buenos Aires"],["Мехико","Mexico City"],["Рио-де-Жанейро","Rio de Janeiro"],
];

test("fixed global multilingual regression возвращает same geonameId/coordinates/timezone",()=>{
  for(const [ru,en,display] of FIXED) {
    const localized=place(ru),canonical=place(en);
    assert.equal(localized.geonameId,canonical.geonameId,`${ru}/${en}`);
    assert.equal(localized.latitude,canonical.latitude,ru);
    assert.equal(localized.longitude,canonical.longitude,ru);
    assert.equal(localized.timeZone,canonical.timeZone,ru);
    if(display) assert.equal(localized.display.label,display);
  }
  assert.equal(place("北京").id,place("Beijing").id);
  assert.equal(place("上海").id,place("Shanghai").id);
  assert.equal(place("ภูเก็ต").id,place("Phuket").id);
  assert.equal(place("서울").id,place("Seoul").id);
  assert.equal(place("東京").id,place("Tokyo").id);
});

test("GeoNames historical alias resolve сохраняет current canonical place и dates",()=>{
  const historic=place("Ленинград"),current=place("Saint Petersburg");
  assert.equal(historic.id,current.id);
  assert.equal(historic.matchedName.isHistoric,true);
  assert.equal(historic.matchedName.from,"1924");
  assert.equal(historic.matchedName.to,"1991");
  assert.equal(historic.display.label,"Санкт-Петербург, Россия");
});

test("duplicate names имеют stable IDs и region в ambiguity labels",()=>{
  const results=locationProvider.search("Springfield",8);
  assert.ok(results.length>1);
  assert.equal(new Set(results.map(value=>value.id)).size,results.length);
  assert.ok(results.filter(value=>value.countryCode==="US").every(value=>value.display.label.split(",").length>=3));
});

test("timezone override сохраняет GeoNames longitude и принимает только IANA",()=>{
  const yerevan=place("Ереван");
  const result=calculateRequest({date:"1990-05-15",time:"14:30",gender:"female",placeId:yerevan.id,timeZoneOverride:"Europe/Moscow"});
  assert.equal(result.status,200); assert.equal(result.body.metadata.ianaTimeZone,"Europe/Moscow");
  assert.equal(result.body.metadata.placeTimeZone,"Asia/Yerevan"); assert.equal(result.body.metadata.longitude,yerevan.longitude);
  assert.equal(calculateRequest({date:"1990-05-15",time:"14:30",gender:"female",placeId:yerevan.id,timeZoneOverride:"UTC+04:00"}).body.code,"INVALID_TIME_ZONE");
});

test("representative GeoNames IANA IDs совместимы с historical engine",()=>{
  for(const [query,zone] of [["Москва","Europe/Moscow"],["Ереван","Asia/Yerevan"],["Пхукет","Asia/Bangkok"],["New York","America/New_York"],["Пекин","Asia/Shanghai"],["London","Europe/London"],["Дубай","Asia/Dubai"]]) assert.equal(place(query).timeZone,zone,query);
});

test("full free calculation и true-solar path работают для global places",()=>{
  for(const query of ["Пхукет","Москва","Ереван","New York","Пекин"]) {
    const selected=place(query); const result=calculateRequest({date:"1990-05-15",time:"14:30",gender:"female",placeId:selected.id});
    assert.equal(result.status,200,query); assert.equal(result.body.metadata.ianaTimeZone,selected.timeZone,query);
    assert.equal(result.body.metadata.longitude,selected.longitude,query); assert.equal(Number.isFinite(result.body.metadata.trueSolarCorrectionMinutes),true,query);
    assert.equal(result.body.chart.bazi.pillars.length,4,query); assert.equal(result.body.chart.ziwei.palaces.length,12,query);
  }
});

test("historical DST и граничные часы сохраняют existing pipeline behavior",()=>{
  const moscow=place("Москва");
  for(const time of ["00:05","00:59","01:00","22:59","23:00"]) { const result=calculateRequest({date:"1995-07-01",time,gender:"male",placeId:moscow.id}); assert.equal(result.status,200,time); assert.equal(result.body.metadata.dstApplied,true); assert.equal(result.body.metadata.historicalUtcOffset,240); }
});

test.skip("точные астрологические эталоны TRUE_SOLAR_TIME_V1 требуют внешней верификации",()=>{});
