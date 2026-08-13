#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const EXCLUDED_LANGUAGES = new Set(["link", "wkdt", "post", "iata", "icao", "faac"]);

function normalize(value) {
  return String(value || "").normalize("NFKD").replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[\u2010-\u2015]/gu, "-")
    .replace(/[\p{Pd}'’ʼ]+/gu, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ");
}

function prefix(value) { return Array.from(value).slice(0, 2).join(""); }
function shardKey(value) {
  let hash = 2166136261;
  for (const character of prefix(value)) { hash ^= character.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0 & 1023).toString(16).padStart(3, "0");
}
function placeShard(id) { return String(Number(id) % 512).padStart(3, "0"); }
function importance(place) {
  const feature={PPLC:120,PPLA:85,PPLA2:60,PPLA3:40,PPLA4:25}[place.featureCode] || 0;
  return feature + Math.min(30,Math.log10(Math.max(1,place.population))*3);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 2; index < argv.length; index += 2) result[argv[index].replace(/^--/, "")] = argv[index + 1];
  for (const required of ["cities", "alternates", "admin1", "out", "version"]) {
    if (!result[required]) throw new Error(`Missing --${required}`);
  }
  return result;
}

function inputStream(file, member) {
  if (!file.endsWith(".zip")) return fs.createReadStream(file);
  const child = spawn("unzip", ["-p", file, member], { stdio: ["ignore", "pipe", "inherit"] });
  child.on("exit", code => { if (code) child.stdout.destroy(new Error(`unzip exited with ${code}`)); });
  return child.stdout;
}

async function lines(file, member, visit) {
  const source = inputStream(file, member);
  const reader = readline.createInterface({ input: source, crlfDelay: Infinity });
  for await (const line of reader) if (line) await visit(line);
}

function sha256(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function writeGzipJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zlib.gzipSync(Buffer.from(JSON.stringify(value)), { level: 9 }));
}

async function importGeoNames(options) {
  const started = process.hrtime.bigint();
  const out = path.resolve(options.out);
  const temp = `${out}.tmp-${process.pid}`;
  fs.rmSync(temp, { recursive: true, force: true });
  fs.mkdirSync(path.join(temp, "names-raw"), { recursive: true });
  const admin1 = new Map();
  await lines(options.admin1, "admin1CodesASCII.txt", line => {
    const [code, name] = line.split("\t");
    if (code && name) admin1.set(code, name);
  });

  const places = new Map();
  await lines(options.cities, "cities500.txt", line => {
    const fields = line.split("\t");
    if (fields.length < 19 || fields[6] !== "P") return;
    const [id, name, ascii, , lat, lng, , featureCode, countryCode, , admin1Code, admin2Code, , , population, , , timeZone, modified] = fields;
    places.set(Number(id), {
      id:Number(id), name, ascii, latitude:Number(lat), longitude:Number(lng), featureCode, countryCode,
      admin1Code, admin2Code, region:admin1.get(`${countryCode}.${admin1Code}`) || "",
      population:Number(population) || 0, timeZone, modified, ru:"",
    });
  });

  const handles = new Map();
  const rawFile = key => {
    if (handles.has(key)) {
      const fd=handles.get(key); handles.delete(key); handles.set(key,fd); return fd;
    }
    const fd=fs.openSync(path.join(temp, "names-raw", `${key}.tsv`), "a"); handles.set(key,fd);
    if (handles.size>128) { const oldest=handles.keys().next().value; fs.closeSync(handles.get(oldest)); handles.delete(oldest); }
    return fd;
  };
  let alternateCount = 0;
  let historicCount = 0;
  const addName = entry => {
    const normalized = normalize(entry.name);
    if ([...normalized].length < 2) return;
    const searchRank=entry.rank + importance(places.get(entry.id));
    fs.writeSync(rawFile(shardKey(normalized)), `${normalized}\t${entry.id}\t${searchRank}\t${JSON.stringify(entry.name)}\t${entry.language}\t${entry.preferred ? 1 : 0}\t${entry.short ? 1 : 0}\t${entry.colloquial ? 1 : 0}\t${entry.historic ? 1 : 0}\t${entry.from || ""}\t${entry.to || ""}\n`);
  };
  for (const place of places.values()) {
    addName({ name:place.name, id:place.id, rank:500, language:"", preferred:true });
    if (normalize(place.ascii) !== normalize(place.name)) addName({ name:place.ascii, id:place.id, rank:400, language:"", preferred:false });
  }

  await lines(options.alternates, "alternateNamesV2.txt", line => {
    const [alternateNameId, geonameId, language, name, preferred, short, colloquial, historic, from, to] = line.split("\t");
    const place = places.get(Number(geonameId));
    if (!place || !name || EXCLUDED_LANGUAGES.has(language)) return;
    const isHistoric = historic === "1";
    const isPreferred = preferred === "1";
    const rank = language === "ru" ? (isPreferred ? 650 : 600) : isHistoric ? 300 : isPreferred ? 550 : 450;
    addName({ id:place.id, name, language, rank, preferred:isPreferred, short:short === "1", colloquial:colloquial === "1", historic:isHistoric, from, to, alternateNameId });
    alternateCount += 1;
    if (isHistoric) historicCount += 1;
    if (language === "ru" && !isHistoric && (isPreferred || !place.ru)) place.ru = name;
  });
  for (const fd of handles.values()) fs.closeSync(fd);

  const placeGroups = new Map();
  for (const place of places.values()) {
    const key = placeShard(place.id);
    if (!placeGroups.has(key)) placeGroups.set(key, []);
    placeGroups.get(key).push(place);
  }
  for (const [key, values] of placeGroups) writeGzipJson(path.join(temp, "places", `${key}.json.gz`), values.sort((a,b)=>a.id-b.id));

  let nameCount = 0;
  const rawFiles = fs.readdirSync(path.join(temp, "names-raw")).sort();
  for (const filename of rawFiles) {
    const groups = {};
    await lines(path.join(temp, "names-raw", filename), "", line => {
      const [normalized, id, rank, encodedName, language, preferred, short, colloquial, historic, from, to] = line.split("\t");
      const key = prefix(normalized);
      (groups[key] ||= []).push([normalized, Number(id), Number(rank), JSON.parse(encodedName), language, preferred === "1", short === "1", colloquial === "1", historic === "1", from, to]);
      nameCount += 1;
    });
    for (const values of Object.values(groups)) values.sort((a,b)=>a[0].localeCompare(b[0],"ru") || b[2]-a[2] || a[1]-b[1]);
    writeGzipJson(path.join(temp, "names", filename.replace(/\.tsv$/, ".json.gz")), groups);
  }
  fs.rmSync(path.join(temp, "names-raw"), { recursive: true, force: true });

  const russianPlaceCount = [...places.values()].filter(place => place.ru).length;
  const candidateNorms=new Set([...places.values()].flatMap(place=>[normalize(place.ru),normalize(place.name)].filter(Boolean)));
  const nameOwner=new Map();
  const recordOwner=(normalized,id)=>{ if(!candidateNorms.has(normalized)) return; const current=nameOwner.get(normalized); if(current===undefined) nameOwner.set(normalized,id); else if(current!==id) nameOwner.set(normalized,0); };
  for(const place of places.values()) recordOwner(normalize(place.name),place.id);
  await lines(options.alternates,"alternateNamesV2.txt",line=>{ const [,geonameId,language,name]=line.split("\t"); const id=Number(geonameId); if(places.has(id)&&name&&!EXCLUDED_LANGUAGES.has(language)) recordOwner(normalize(name),id); });
  const comparable=[...places.values()].filter(place=>place.ru&&normalize(place.ru)!==normalize(place.name)&&nameOwner.get(normalize(place.ru))===place.id&&nameOwner.get(normalize(place.name))===place.id).map(place=>[place.id,place.ru,place.name]).sort((a,b)=>a[0]-b[0]);
  writeGzipJson(path.join(temp,"coverage-ru.json.gz"),comparable);
  const files = fs.readdirSync(path.join(temp, "names")).length + fs.readdirSync(path.join(temp, "places")).length;
  const manifest = {
    format:"tian-min-geonames-v2", version:options.version, builtAt:new Date().toISOString(), license:"CC BY 4.0",
    source:"https://download.geonames.org/export/dump/", sourceFiles:{
      cities500:{ name:path.basename(options.cities), bytes:fs.statSync(options.cities).size, sha256:sha256(options.cities) },
      alternateNamesV2:{ name:path.basename(options.alternates), bytes:fs.statSync(options.alternates).size, sha256:sha256(options.alternates) },
      admin1CodesASCII:{ name:path.basename(options.admin1), bytes:fs.statSync(options.admin1).size, sha256:sha256(options.admin1) },
    },
    placeCount:places.size, alternateNameCount:alternateCount, indexedNameCount:nameCount, historicNameCount:historicCount,
    russianPlaceCount, russianCoverage:Number((russianPlaceCount / places.size * 100).toFixed(2)), multilingualComparableCount:comparable.length, shardFileCount:files+1,
    importDurationMs:Number((process.hrtime.bigint()-started)/1_000_000n),
  };
  fs.writeFileSync(path.join(temp, "manifest.json"), `${JSON.stringify(manifest,null,2)}\n`);
  fs.rmSync(out, { recursive: true, force: true });
  fs.renameSync(temp, out);
  return manifest;
}

if (require.main === module) importGeoNames(parseArgs(process.argv)).then(value => console.log(JSON.stringify(value,null,2))).catch(error => { console.error(error); process.exitCode=1; });
module.exports = { importGeoNames, normalize, prefix, shardKey };
