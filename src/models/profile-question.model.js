const mongoose = require('mongoose');
const env = require('../config/env');
const crypto = require('crypto');
const { canonicalProfileKey } = require('../utils/profile-answers');

const questionSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, trim: true, lowercase: true },
  label: { type: String, required: true, trim: true, maxlength: 120 },
  type: { type: String, enum: ['text', 'number', 'select', 'date'], required: true },
  options: { type: [String], default: [] },
  required: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  order: { type: Number, default: 0 }
}, { timestamps: true });

const ProfileQuestion = mongoose.models.ProfileQuestion || mongoose.model('ProfileQuestion', questionSchema);
const memory = [];
const defaults = [
  { key: 'gender', label: 'Gender', type: 'select', options: ['Female', 'Male', 'Non-binary', 'Prefer not to say'], order: 10 },
  { key: 'birthDate', label: 'Date of birth (used to calculate age)', type: 'date', order: 20 },
  { key: 'heightCm', label: 'Height (cm)', type: 'number', order: 30 },
  { key: 'weightKg', label: 'Weight (kg)', type: 'number', order: 40 }
];
let memorySeeded = false;

const dto = row => ({
  id: String(row.id || row._id), key: canonicalProfileKey(row.key), label: row.label, type: row.type,
  options: row.key === 'gender'
    ? [...new Set((row.options?.length ? row.options : ['Female', 'Male', 'Non-binary', 'Prefer not to say']).map(value => value === 'Woman' ? 'Female' : value === 'Man' ? 'Male' : value))]
    : row.options || [], required: Boolean(row.required), active: row.active !== false,
  order: Number(row.order || 0), createdAt: row.createdAt || row.created_at || null,
  updatedAt: row.updatedAt || row.updated_at || null
});

async function ensureDefaults() {
  if (env.useMongoDB) {
    await Promise.all(defaults.map(async question => {
      try {
        await ProfileQuestion.updateOne({ key: question.key }, { $setOnInsert: question }, { upsert: true });
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
    }));
  } else if (!memorySeeded) {
    memory.push(...defaults.map(question => ({ id: crypto.randomUUID(), ...question, active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })));
    memorySeeded = true;
  }
}

async function list({ activeOnly = false } = {}) {
  await ensureDefaults();
  const filter = activeOnly ? { active: true } : {};
  const rows = env.useMongoDB
    ? await ProfileQuestion.find(filter).sort({ order: 1, createdAt: 1, _id: 1 }).lean()
    : memory.filter(row => !activeOnly || row.active).sort((a, b) => a.order - b.order || a.created_at.localeCompare(b.created_at));
  return rows.map(dto);
}

async function create(data) {
  await ensureDefaults();
  const input = { ...data, key: data.key.toLowerCase() };
  if (env.useMongoDB) return dto(await ProfileQuestion.create(input));
  if (memory.some(row => row.key === input.key)) return null;
  const now = new Date().toISOString();
  const row = { id: crypto.randomUUID(), ...input, created_at: now, updated_at: now };
  memory.push(row);
  return dto(row);
}

async function update(id, data) {
  await ensureDefaults();
  if (env.useMongoDB) {
    const row = await ProfileQuestion.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true }).lean();
    return row ? dto(row) : null;
  }
  const row = memory.find(item => item.id === id || item.key === id);
  if (!row) return null;
  Object.assign(row, data, { updated_at: new Date().toISOString() });
  return dto(row);
}

async function setActive(id, active) { return update(id, { active }); }

module.exports = { ProfileQuestion, defaults, list, create, update, setActive, ensureDefaults };
