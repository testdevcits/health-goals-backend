const mongoose = require('mongoose');
const env = require('../config/env');

const claimSchema = new mongoose.Schema({
  month: { type: String, required: true, index: true },
  audience: { type: String, enum: ['INDIVIDUAL', 'GROUP'], required: true },
  winnerId: { type: String, required: true },
  winnerName: { type: String, required: true },
  recipientName: { type: String, required: true },
  recipientEmail: { type: String, required: true },
  rank: { type: Number, required: true },
  steps: { type: Number, required: true },
  memberSnapshot: { type: [mongoose.Schema.Types.Mixed], default: [] },
  status: { type: String, enum: ['CONSENT_PENDING', 'READY_TO_SEND', 'SENT'], default: 'CONSENT_PENDING', index: true },
  consent: { type: mongoose.Schema.Types.Mixed, default: null },
  bookingReference: { type: String, default: '' },
  ticketCount: { type: Number, default: 1 },
  delivery: { type: mongoose.Schema.Types.Mixed, default: null },
  createdBy: { type: String, required: true },
  updatedBy: { type: String, default: null }
}, { timestamps: true });
claimSchema.index({ month: 1, audience: 1, winnerId: 1 }, { unique: true });
const TicketClaim = mongoose.models.TicketClaim || mongoose.model('TicketClaim', claimSchema);
const memoryClaims = [];
const dto = row => {
  const value = row.toObject ? row.toObject() : row;
  const id = String(value._id || value.id);
  const phone = value.consent?.encryptedPhone ? require('../services/voucher-code.service').decrypt(value.consent.encryptedPhone) : null;
  return { id, month: value.month, audience: value.audience, winnerId: value.winnerId, winnerName: value.winnerName, recipientName: value.recipientName, recipientEmail: value.recipientEmail, rank: value.rank, steps: value.steps, memberSnapshot: value.memberSnapshot || [], status: value.status, consent: value.consent ? { method: value.consent.method, confirmedAt: value.consent.confirmedAt, confirmedBy: value.consent.confirmedBy, termsVersion: value.consent.termsVersion, phoneLast4: value.consent.phoneLast4, phone } : null, bookingReference: value.bookingReference || '', ticketCount: value.ticketCount || 1, delivery: value.delivery || null, createdAt: value.createdAt || value.created_at, updatedAt: value.updatedAt || value.updated_at };
};
async function list({ month } = {}) {
  const rows = env.useMongoDB ? await TicketClaim.find(month ? { month } : {}).sort({ createdAt: -1 }).lean() : memoryClaims.filter(row => !month || row.month === month).sort((a,b) => new Date(b.created_at)-new Date(a.created_at));
  return rows.map(dto);
}
async function find(id) {
  if (env.useMongoDB) return mongoose.isValidObjectId(id) ? TicketClaim.findById(id) : null;
  return memoryClaims.find(row => row.id === id) || null;
}
async function create(payload) {
  if (env.useMongoDB) return TicketClaim.create(payload);
  const row = { ...payload, id: require('crypto').randomUUID(), status: 'CONSENT_PENDING', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  memoryClaims.unshift(row); return row;
}
async function update(id, patch) {
  if (env.useMongoDB) return TicketClaim.findByIdAndUpdate(id, { $set: { ...patch, updatedAt: new Date(), updatedBy: patch.updatedBy } }, { new: true, runValidators: true });
  const row = memoryClaims.find(item => item.id === id); if (!row) return null;
  Object.assign(row, patch, { updated_at: new Date().toISOString() }); return row;
}
module.exports = { TicketClaim, dto, list, find, create, update };
