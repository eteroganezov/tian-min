const { TzDatabase } = require("timezonecomplete");
const { normalize } = require("./location-provider.cjs");

const ZONE_NAMES = TzDatabase.instance().zoneNames().filter(name => name.includes("/")).sort();
const ZONE_SET = new Set(ZONE_NAMES);

function isValidTimeZone(value) {
  return typeof value === "string" && ZONE_SET.has(value);
}

function searchTimeZones(query, limit = 20) {
  const needle = normalize(query);
  if ([...needle].length < 2) return [];
  return ZONE_NAMES.map(id => {
    const searchable = normalize(id.replace(/_/g, " "));
    const score = searchable === needle ? 3 : searchable.startsWith(needle) ? 2 : searchable.includes(needle) ? 1 : 0;
    return { id, label: id.replace(/_/g, " "), score };
  }).filter(zone => zone.score).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit)
    .map(({ score, ...zone }) => zone);
}

module.exports = { isValidTimeZone, searchTimeZones };
