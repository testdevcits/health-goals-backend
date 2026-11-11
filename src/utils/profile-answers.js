const canonicalDefaults = {
  gender: 'gender',
  birthdate: 'birthDate',
  heightcm: 'heightCm',
  weightkg: 'weightKg'
};

const defaultKeys = new Set(Object.values(canonicalDefaults));
const empty = value => value === undefined || value === null || value === '';

function canonicalProfileKey(key) {
  return canonicalDefaults[String(key).toLowerCase()] || key;
}

function normalizeProfileAnswers(answers = {}) {
  const entries = answers instanceof Map ? [...answers.entries()] : Object.entries(answers || {});
  const normalized = {};
  for (const [key, value] of entries) {
    const canonical = canonicalProfileKey(key);
    if (!Object.prototype.hasOwnProperty.call(normalized, canonical) || key === canonical || empty(normalized[canonical])) {
      normalized[canonical] = value;
    }
  }
  return normalized;
}

function customProfileAnswers(answers = {}) {
  return Object.fromEntries(Object.entries(normalizeProfileAnswers(answers)).filter(([key]) => !defaultKeys.has(key)));
}

function normalizeGender(value) {
  return value === 'Woman' ? 'Female' : value === 'Man' ? 'Male' : value;
}

module.exports = { canonicalProfileKey, normalizeProfileAnswers, customProfileAnswers, normalizeGender, defaultProfileKeys: defaultKeys };
