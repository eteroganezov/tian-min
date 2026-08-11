const cityTimezones = require("city-timezones");

// Небольшой словарь поиска: он переводит запрос, но не создаёт координаты сам.
// Все возвращаемые координаты и зоны всегда берутся из установленного набора данных.
const SEARCH_ALIASES = new Map([
  ["москва", "Moscow Russia"], ["лондон", "London United Kingdom"],
  ["нью-йорк", "New York New York"], ["нью йорк", "New York New York"],
  ["пекин", "Beijing China"], ["париж", "Paris France"],
  ["владивосток", "Vladivostok Russia"], ["калининград", "Kaliningrad Russia"],
]);

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
}

function dataKey(city) {
  return [city.city, city.province, city.country, city.lat, city.lng, city.timezone].join("|");
}

function placeId(city) {
  return Buffer.from(dataKey(city), "utf8").toString("base64url");
}

function toPlace(city) {
  return {
    id: placeId(city), city: city.city, region: city.province || "", country: city.country,
    countryCode: city.iso2, latitude: city.lat, longitude: city.lng, timeZone: city.timezone,
    label: [city.city, city.province, city.country].filter(Boolean).join(", "),
  };
}

class LocalLocationProvider {
  search(query, limit = 10) {
    const raw = normalize(query);
    if (raw.length < 2) return [];
    const translated = SEARCH_ALIASES.get(raw) || String(query).trim();
    const needle = normalize(translated);
    const firstToken = needle.split(" ")[0];
    return cityTimezones.findFromCityStateProvince(translated)
      .sort((a, b) => {
        const aExact = normalize(a.city) === firstToken ? 1 : 0;
        const bExact = normalize(b.city) === firstToken ? 1 : 0;
        return bExact - aExact || Number(b.pop || 0) - Number(a.pop || 0) || dataKey(a).localeCompare(dataKey(b));
      })
      .slice(0, Math.max(1, Math.min(limit, 20)))
      .map(toPlace);
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
module.exports = { LocalLocationProvider, locationProvider };
