const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { resolveLegacyPlace } = require("./legacy-location-provider.cjs");

const russianCountries = new Intl.DisplayNames(["ru"], { type:"region" });
const englishCountries = new Intl.DisplayNames(["en"], { type:"region" });
const DEFAULT_DATA_ROOT = path.resolve(__dirname,"..","data","geonames");

function normalize(value) {
  return String(value || "").normalize("NFKD").replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[\u2010-\u2015]/gu, "-")
    .replace(/[\p{Pd}'’ʼ]+/gu, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ");
}
function prefix(value) { return Array.from(value).slice(0,2).join(""); }
function shardKey(value) {
  let hash=2166136261;
  for(const character of prefix(value)) { hash^=character.codePointAt(0); hash=Math.imul(hash,16777619); }
  return (hash>>>0&1023).toString(16).padStart(3,"0");
}
function placeShard(id) { return String(Number(id)%512).padStart(3,"0"); }

class LruCache {
  constructor(limit) { this.limit=limit; this.values=new Map(); }
  get(key,load) {
    if (this.values.has(key)) { const value=this.values.get(key); this.values.delete(key); this.values.set(key,value); return value; }
    const value=load(); this.values.set(key,value);
    if (this.values.size>this.limit) this.values.delete(this.values.keys().next().value);
    return value;
  }
}

function readGzipJson(file) { return JSON.parse(zlib.gunzipSync(fs.readFileSync(file))); }
function editDistanceAtMostOne(left,right) {
  if (Math.abs(left.length-right.length)>1) return false;
  let i=0,j=0,differences=0;
  while(i<left.length&&j<right.length) {
    if(left[i]===right[j]) { i++; j++; continue; }
    if(++differences>1) return false;
    if(left.length>right.length) i++; else if(right.length>left.length) j++; else { i++; j++; }
  }
  return differences + Number(i<left.length||j<right.length) <= 1;
}
class GeoNamesLocationProvider {
  constructor(options={}) {
    this.root=options.root || DEFAULT_DATA_ROOT;
    this.manifest=JSON.parse(fs.readFileSync(path.join(this.root,"manifest.json"),"utf8"));
    this.nameCache=new LruCache(options.nameCacheSize || 4);
    this.placeCache=new LruCache(options.placeCacheSize || 8);
  }
  nameShard(query) {
    const key=shardKey(query);
    return this.nameCache.get(key,()=>readGzipJson(path.join(this.root,"names",`${key}.json.gz`)));
  }
  place(id) {
    const key=placeShard(id);
    const places=this.placeCache.get(key,()=>new Map(readGzipJson(path.join(this.root,"places",`${key}.json.gz`)).map(value=>[value.id,value])));
    return places.get(Number(id)) || null;
  }
  search(query,limit=8) {
    const needle=normalize(query);
    if(Array.from(needle).length<2) return [];
    let shard;
    try { shard=this.nameShard(needle); } catch { return []; }
    const candidates=shard[prefix(needle)] || [];
    const byId=new Map();
    const consider=(entry,matchScore)=>{
      const [matchedName,id,rank,name,language,preferred,short,colloquial,historic,from,to]=entry;
      const score=matchScore+rank, current=byId.get(id);
      if(current&&current.score>=score) return;
      byId.set(id,{id,score,matchedName,name,language,preferred,short,colloquial,historic,from,to});
      if(byId.size>12) {
        let lowest=null;
        for(const value of byId.values()) if(!lowest||value.score<lowest.score||(value.score===lowest.score&&value.id>lowest.id)) lowest=value;
        byId.delete(lowest.id);
      }
    };
    let prefixMatch=false;
    for(const entry of candidates) if(entry[0].startsWith(needle)) { prefixMatch=true; consider(entry,entry[0]===needle?3000:2000); }
    if(!prefixMatch&&candidates.length&&needle.length>=4) for(const entry of candidates) {
      if(Math.abs(entry[0].length-needle.length)<=1&&editDistanceAtMostOne(entry[0],needle)) consider(entry,1000);
    }
    const finalists=[...byId.values()].sort((a,b)=>b.score-a.score||a.id-b.id).slice(0,12);
    const results=finalists.map(match=>({match,place:this.place(match.id)})).filter(value=>value.place)
      .sort((a,b)=>b.match.score-a.match.score||b.place.population-a.place.population||a.place.id-b.place.id)
      .slice(0,Math.max(1,Math.min(Number(limit)||8,8))).map(({place,match})=>this.toPlace(place,match));
    const duplicateKeys=new Map();
    for(const result of results) { const key=`${result.display.city}|${result.countryCode}`; duplicateKeys.set(key,(duplicateKeys.get(key)||0)+1); }
    for(const result of results) if(duplicateKeys.get(`${result.display.city}|${result.countryCode}`)>1&&result.region) result.display.label=`${result.display.city}, ${result.region}, ${result.display.country}`;
    return results;
  }
  resolve(id) {
    const match=String(id||"").match(/^geonames:(\d+)$/u);
    if(match) { const place=this.place(Number(match[1])); return place?this.toPlace(place):null; }
    return resolveLegacyPlace(id);
  }
  toPlace(place,match=null) {
    const displayCity=place.ru || place.name;
    const displayCountry=russianCountries.of(place.countryCode) || place.countryCode;
    const canonicalCountry=englishCountries.of(place.countryCode) || place.countryCode;
    return {
      id:`geonames:${place.id}`, geonameId:place.id, source:"geonames", sourceId:String(place.id), canonicalName:place.name,
      city:place.name, region:place.region || "", country:canonicalCountry, countryCode:place.countryCode,
      latitude:place.latitude, longitude:place.longitude, timeZone:place.timeZone,
      label:[place.name,place.region,canonicalCountry].filter(Boolean).join(", "),
      display:{city:displayCity,country:displayCountry,label:[displayCity,displayCountry].filter(Boolean).join(", "),isCityLocalized:Boolean(place.ru)},
      ...(match?{matchedName:{name:match.name,language:match.language||null,isPreferred:match.preferred,isShort:match.short,isColloquial:match.colloquial,isHistoric:match.historic,from:match.from||null,to:match.to||null}}:{}),
    };
  }
}

const locationProvider=new GeoNamesLocationProvider();
module.exports={GeoNamesLocationProvider,locationProvider,normalize};
