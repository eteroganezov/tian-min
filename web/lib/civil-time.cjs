const { zone } = require("timezonecomplete");

class CivilTimeError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}

function parseLocalDateTime(date, time) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time || "");
  if (!dateMatch) throw new CivilTimeError("INVALID_DATE", "Укажите корректную дату рождения.");
  if (!timeMatch) throw new CivilTimeError("INVALID_TIME", "Укажите корректное время рождения.");
  const parts = { year: +dateMatch[1], month: +dateMatch[2], day: +dateMatch[3], hour: +timeMatch[1], minute: +timeMatch[2] };
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute));
  if (parts.year < 1900 || parts.year > 2100 || parts.hour > 23 || parts.minute > 59 ||
      check.getUTCFullYear() !== parts.year || check.getUTCMonth() + 1 !== parts.month || check.getUTCDate() !== parts.day) {
    throw new CivilTimeError("INVALID_LOCAL_DATETIME", "Такой местной даты или времени не существует.");
  }
  return parts;
}

function utcParts(milliseconds) {
  const value = new Date(milliseconds);
  return [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate(), value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds(), value.getUTCMilliseconds()];
}

function sameWallTime(milliseconds, offsetMinutes, local) {
  const value = new Date(milliseconds + offsetMinutes * 60_000);
  return value.getUTCFullYear() === local.year && value.getUTCMonth() + 1 === local.month && value.getUTCDate() === local.day &&
    value.getUTCHours() === local.hour && value.getUTCMinutes() === local.minute;
}

function resolveCivilTime(date, time, timeZone, occurrence) {
  const local = parseLocalDateTime(date, time);
  let timeZoneObject;
  try { timeZoneObject = zone(timeZone); } catch { throw new CivilTimeError("INVALID_TIME_ZONE", "Не удалось определить часовой пояс выбранного места."); }
  const wallMilliseconds = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const offsets = new Set();
  for (let sample = wallMilliseconds - 172_800_000; sample <= wallMilliseconds + 172_800_000; sample += 1_800_000) {
    offsets.add(timeZoneObject.offsetForUtc(...utcParts(sample)));
  }
  const candidates = [...offsets].map(offset => ({ offset, utcMilliseconds: wallMilliseconds - offset * 60_000 }))
    .filter(candidate => timeZoneObject.offsetForUtc(...utcParts(candidate.utcMilliseconds)) === candidate.offset && sameWallTime(candidate.utcMilliseconds, candidate.offset, local))
    .sort((a, b) => a.utcMilliseconds - b.utcMilliseconds);
  if (!candidates.length) {
    throw new CivilTimeError("NONEXISTENT_LOCAL_TIME", "В выбранном месте такого местного времени не существовало из-за перевода часов. Укажите другое время.");
  }
  if (candidates.length > 1 && occurrence !== "first" && occurrence !== "second") {
    throw new CivilTimeError("AMBIGUOUS_LOCAL_TIME", "Это местное время встречалось дважды из-за перевода часов. Выберите нужный вариант.", {
      options: [
        { value: "first", label: "Первый вариант — до перевода часов" },
        { value: "second", label: "Второй вариант — после перевода часов" },
      ],
    });
  }
  const selectedIndex = candidates.length > 1 && occurrence === "second" ? candidates.length - 1 : 0;
  const selected = candidates[selectedIndex];
  const standardOffsetMinutes = timeZoneObject.standardOffsetForUtc(...utcParts(selected.utcMilliseconds));
  return {
    local, utcMilliseconds: selected.utcMilliseconds, utcInstant: new Date(selected.utcMilliseconds).toISOString(),
    historicalUtcOffsetMinutes: selected.offset, standardOffsetMinutes,
    dstOffsetMinutes: selected.offset - standardOffsetMinutes,
    dstApplied: selected.offset !== standardOffsetMinutes,
    ambiguity: candidates.length > 1 ? { occurrence: selectedIndex === 0 ? "first" : "second", candidates: candidates.map(item => ({ utcInstant: new Date(item.utcMilliseconds).toISOString(), offsetMinutes: item.offset })) } : null,
  };
}

module.exports = { CivilTimeError, parseLocalDateTime, resolveCivilTime };
