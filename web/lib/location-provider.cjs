const cityTimezones = require("city-timezones");

// Reliable product localization is a display/search layer over the canonical dataset.
// It does not provide coordinates or time zones; those always come from city-timezones.
const LOCALIZED_PLACES = new Map(Object.entries({
  "Moscow|RU": { ru: "Москва" },
  "St. Petersburg|RU": { ru: "Санкт-Петербург", aliases: ["Петербург"] },
  "Almaty|KZ": { ru: "Алматы" },
  "Yerevan|AM": { ru: "Ереван" },
  "Tbilisi|GE": { ru: "Тбилиси" },
  "London|GB": { ru: "Лондон" },
  "New York|US": { ru: "Нью-Йорк" },
  "Beijing|CN": { ru: "Пекин", aliases: ["北京"] },
  "Paris|FR": { ru: "Париж" },
  "Vladivostok|RU": { ru: "Владивосток" },
  "Kaliningrad|RU": { ru: "Калининград" },
  "Yekaterinburg|RU": { ru: "Екатеринбург" },
  "Nizhny Novgorod|RU": { ru: "Нижний Новгород" },
  "Kazan|RU": { ru: "Казань" },
}));

const russianCountries = new Intl.DisplayNames(["ru"], { type: "region" });
const CYRILLIC_TO_LATIN = Object.freeze({
  а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"i",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"kh",ц:"ts",ч:"ch",ш:"sh",щ:"shch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya",
});

function normalize(value) {
  return String(value || "").normalize("NFKD").replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function transliterate(value) {
  return normalize(value).replace(/[\u0400-\u04ff]/gu, character => CYRILLIC_TO_LATIN[character] ?? character);
}

function queryVariants(value) {
  const normalized = normalize(value);
  const transliterated = transliterate(normalized);
  const variants = new Set([normalized, transliterated]);
  // Common Russian transliteration writes initial Е as either E or Ye.
  if (/^e/u.test(transliterated)) variants.add(`y${transliterated}`);
  return [...variants].filter(Boolean);
}

function dataKey(city) {
  return [city.city, city.province, city.country, city.lat, city.lng, city.timezone].join("|");
}

function placeId(city) {
  return Buffer.from(dataKey(city), "utf8").toString("base64url");
}

function localization(city) {
  return LOCALIZED_PLACES.get(`${city.city}|${city.iso2}`) || null;
}

function localizedDisplay(city) {
  const localized = localization(city);
  const localizedCity = localized?.ru || city.city;
  const localizedCountry = russianCountries.of(city.iso2) || city.country;
  return {
    city: localizedCity,
    country: localizedCountry,
    label: [localizedCity, localizedCountry].filter(Boolean).join(", "),
    isCityLocalized: localizedCity !== city.city,
  };
}

function toPlace(city) {
  const display = localizedDisplay(city);
  const id = placeId(city);
  return {
    id, source: "city-timezones", sourceId: id, canonicalName: city.city,
    city: city.city, region: city.province || "", country: city.country,
    countryCode: city.iso2, latitude: city.lat, longitude: city.lng, timeZone: city.timezone,
    label: [city.city, city.province, city.country].filter(Boolean).join(", "), display,
  };
}

function searchTerms(city) {
  const localized = localization(city);
  const terms = new Map();
  const add = (value, weight) => queryVariants(value).forEach(term => terms.set(term, Math.max(weight, terms.get(term) || 0)));
  [city.city, city.city_ascii].filter(Boolean).forEach(value => add(value, 50));
  [city.province, city.country].filter(Boolean).forEach(value => add(value, 0));
  [localized?.ru, ...(localized?.aliases || [])].filter(Boolean).forEach(value => add(value, 200));
  add([city.city, city.province, city.country].filter(Boolean).join(" "), 80);
  add([city.city, city.country].filter(Boolean).join(" "), 80);
  if (localized?.ru) add([localized.ru, russianCountries.of(city.iso2)].filter(Boolean).join(" "), 220);
  return [...terms].map(([term, weight]) => ({ term, weight }));
}

const SEARCH_INDEX = cityTimezones.cityMapping.map(city => ({ city, terms: searchTerms(city) }));

function matchScore(terms, variants) {
  let best = 0;
  for (const needle of variants) for (const entry of terms) {
    const { term, weight } = entry;
    if (term === needle) best = Math.max(best, 400 + weight);
    else if (term.startsWith(needle)) best = Math.max(best, 300 + weight);
    else if (term.split(" ").some(token => token.startsWith(needle))) best = Math.max(best, 200 + weight);
    else if (term.includes(needle)) best = Math.max(best, 100 + weight);
  }
  return best;
}

class LocalLocationProvider {
  search(query, limit = 10) {
    const variants = queryVariants(query);
    if (!variants.some(value => [...value].length >= 2)) return [];
    return SEARCH_INDEX.map(entry => ({ ...entry, score: matchScore(entry.terms, variants) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score || Number(b.city.pop || 0) - Number(a.city.pop || 0) || dataKey(a.city).localeCompare(dataKey(b.city)))
      .slice(0, Math.max(1, Math.min(limit, 20)))
      .map(entry => toPlace(entry.city));
  }

  resolve(id) {
    if (typeof id !== "string" || !id) return null;
    let decoded;
    try { decoded = Buffer.from(id, "base64url").toString("utf8"); } catch { return null; }
    const match = cityTimezones.cityMapping.find(city => dataKey(city) === decoded);
    return match ? toPlace(match) : null;
  }
}

const locationProvider = new LocalLocationProvider();
module.exports = { LocalLocationProvider, localizedDisplay, locationProvider, normalize, transliterate };
