class PersonalizationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PersonalizationError";
    this.code = "INVALID_DISPLAY_NAME";
  }
}

function normalizeDisplayName(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") throw new PersonalizationError("Имя должно быть текстом.");
  const name = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!name) return "";
  if (name.length > 60) throw new PersonalizationError("Имя должно быть не длиннее 60 символов.");
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .’'\-]*$/u.test(name)) {
    throw new PersonalizationError("В имени можно использовать буквы, пробел, дефис, точку и апостроф.");
  }
  return name;
}

function canonicalBirthInput(input) {
  return {
    date: input?.date,
    time: input?.time,
    gender: input?.gender,
    placeId: input?.placeId,
    ...(input?.timeOccurrence ? { timeOccurrence: input.timeOccurrence } : {}),
  };
}

module.exports = { PersonalizationError, canonicalBirthInput, normalizeDisplayName };

