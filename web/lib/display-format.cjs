function formatDisplayNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "");
  return String(Math.round((number + Number.EPSILON) * 10) / 10);
}

function splitLunarDateDisplay(value) {
  const parts = String(value || "").split(/\s*·\s*/u).map(part => part.trim()).filter(Boolean);
  return parts.length === 3 ? parts : [String(value || "—")];
}

module.exports = { formatDisplayNumber, splitLunarDateDisplay };
