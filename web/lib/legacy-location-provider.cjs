const cityTimezones = require("city-timezones");

const russianCountries = new Intl.DisplayNames(["ru"], { type:"region" });
const LEGACY_LOCALIZED = new Map(Object.entries({
  "Moscow|RU":"Москва", "St. Petersburg|RU":"Санкт-Петербург", "Almaty|KZ":"Алматы",
  "Yerevan|AM":"Ереван", "Tbilisi|GE":"Тбилиси", "London|GB":"Лондон", "New York|US":"Нью-Йорк",
  "Beijing|CN":"Пекин", "Paris|FR":"Париж", "Vladivostok|RU":"Владивосток", "Kaliningrad|RU":"Калининград",
  "Yekaterinburg|RU":"Екатеринбург", "Nizhny Novgorod|RU":"Нижний Новгород", "Kazan|RU":"Казань",
}));

function dataKey(city) { return [city.city,city.province,city.country,city.lat,city.lng,city.timezone].join("|"); }

function toLegacyPlace(city, id) {
  const displayCity = LEGACY_LOCALIZED.get(`${city.city}|${city.iso2}`) || city.city;
  const displayCountry = russianCountries.of(city.iso2) || city.country;
  return {
    id, source:"city-timezones-legacy", sourceId:id, canonicalName:city.city, city:city.city,
    region:city.province || "", country:city.country, countryCode:city.iso2,
    latitude:city.lat, longitude:city.lng, timeZone:city.timezone,
    label:[city.city,city.province,city.country].filter(Boolean).join(", "),
    display:{ city:displayCity, country:displayCountry, label:[displayCity,displayCountry].filter(Boolean).join(", "), isCityLocalized:displayCity !== city.city },
  };
}

function resolveLegacyPlace(id) {
  if (typeof id !== "string" || !id || id.startsWith("geonames:")) return null;
  let decoded;
  try { decoded = Buffer.from(id,"base64url").toString("utf8"); } catch { return null; }
  const city = cityTimezones.cityMapping.find(value => dataKey(value) === decoded);
  return city ? toLegacyPlace(city,id) : null;
}

module.exports = { resolveLegacyPlace };
