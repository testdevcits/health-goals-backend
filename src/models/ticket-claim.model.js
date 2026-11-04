const mongoose = require('mongoose');
const env = require('../config/env');

const claimSchema = new mongoose.Schema({
  month: { type: String, required: true, index: true },
  audience: { type: String, enum: ['INDIVIDUAL', 'GROUP'], required: true },
  winnerId: { type: String, required: true },
  winnerName: { type: String, required: true },
  recipientName: { type: String, required: true },
  recipientUserId: { type: String, required: true, index: true },
  encryptedRecipientPhone: { type: String, default: null, select: false },
  recipientEmail: { type: String, required: true },
  rank: { type: Number, required: true },
  steps: { type: Number, required: true },
  memberSnapshot: { type: [mongoose.Schema.Types.Mixed], default: [] },
  status: { type: String, enum: ['CONSENT_PENDING', 'READY_TO_SEND', 'SENT'], default: 'CONSENT_PENDING', index: true },
  consent: { type: mongoose.Schema.Types.Mixed, default: null },
  bookingReference: { type: String, default: '' },
  ticketCount: { type: Number, default: 1 },
  ticketDate: { type: String, default: null },
  ticketNumber: { type: String, default: '' },
  encryptedImageData: { type: String, default: null },
  delivery: { type: mongoose.Schema.Types.Mixed, default: null },
  createdBy: { type: String, required: true },
  updatedBy: { type: String, default: null }
}, { timestamps: true });
claimSchema.index({ month: 1, audience: 1, winnerId: 1 }, { unique: true });
const TicketClaim = mongoose.models.TicketClaim || mongoose.model('TicketClaim', claimSchema);
const memoryClaims = [];
const dto = (row, { includePhone = true, includeImage = false } = {}) => {
  const value = row.toObject ? row.toObject() : row;
  const id = String(value._id || value.id);
  const phone = includePhone && value.consent?.encryptedPhone ? require('../services/voucher-code.service').decrypt(value.consent.encryptedPhone) : null;
  const contactPhone = includePhone && value.encryptedRecipientPhone ? require('../services/voucher-code.service').decrypt(value.encryptedRecipientPhone) : '';
  const ticketImage = includeImage && value.encryptedImageData ? `data:${value.delivery?.contentType || 'image/jpeg'};base64,${require('../services/voucher-code.service').decrypt(value.encryptedImageData)}` : null;
  return { id, month: value.month, audience: value.audience, winnerId: value.winnerId, winnerName: value.winnerName, recipientUserId: value.recipientUserId, recipientName: value.recipientName, recipientEmail: value.recipientEmail, contactPhone, rank: value.rank, steps: value.steps, memberSnapshot: value.memberSnapshot || [], status: value.status, consent: value.consent ? { method: value.consent.method, confirmedAt: value.consent.confirmedAt, confirmedBy: value.consent.confirmedBy, termsVersion: value.consent.termsVersion, phoneLast4: value.consent.phoneLast4, phone } : null, bookingReference: value.bookingReference || '', ticketCount: value.ticketCount || 1, ticketDate: value.ticketDate || null, ticketNumber: value.ticketNumber || '', delivery: value.delivery || null, ticketImage, createdAt: value.createdAt || value.created_at, updatedAt: value.updatedAt || value.updated_at };
};
async function list({ month } = {}) {
  const rows = env.useMongoDB ? await TicketClaim.find(month ? { month } : {}).select('+encryptedRecipientPhone').sort({ createdAt: -1 }).lean() : memoryClaims.filter(row => !month || row.month === month).sort((a,b) => new Date(b.created_at)-new Date(a.created_at));
  return rows.map(row => dto(row, { includeImage: true }));
}
async function find(id) {
  if (env.useMongoDB) return mongoose.isValidObjectId(id) ? TicketClaim.findById(id).select('+encryptedRecipientPhone') : null;
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
async function listForRecipient(userId) {
  const rows = env.useMongoDB ? await TicketClaim.find({ recipientUserId: String(userId) }).sort({ createdAt: -1 }).lean() : memoryClaims.filter(row => String(row.recipientUserId) === String(userId)).sort((a,b) => new Date(b.created_at)-new Date(a.created_at));
  return rows.map(row => {
    const item = dto(row, { includePhone: false });
    delete item.contactPhone;
    delete item.recipientUserId;
    delete item.consent;
    delete item.memberSnapshot;
    item.delivery = row.delivery ? { sentAt: row.delivery.sentAt, ticketCount: row.delivery.ticketCount, bookingReference: row.delivery.bookingReference, ticketDate: row.delivery.ticketDate, ticketNumber: row.delivery.ticketNumber, filename: row.delivery.filename } : null;
    if (row.encryptedImageData) item.ticketImage = `data:image/${row.delivery?.contentType?.split('/')[1] || 'jpeg'};base64,${require('../services/voucher-code.service').decrypt(row.encryptedImageData)}`;
    return item;
  });
}
module.exports = { TicketClaim, dto, list, listForRecipient, find, create, update };
