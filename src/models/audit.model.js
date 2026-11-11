const mongoose = require('mongoose');
const env = require('../config/env');
const crypto = require('crypto');

const auditSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    action: { type: String, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    requestId: { type: String, default: null }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const AuditLog = mongoose.model('AuditLog', auditSchema);
const auditLogs = [];

const createAuditLog = async ({ userId = null, action, metadata = {}, requestId = null }) => {
  const safeMetadata = { ...metadata };
  delete safeMetadata.password;
  delete safeMetadata.token;
  delete safeMetadata.accessToken;
  delete safeMetadata.refreshToken;

  if (!env.useMongoDB) {
    auditLogs.push({
      id: crypto.randomUUID(),
      user_id: userId,
      action,
      metadata: safeMetadata,
      request_id: requestId,
      created_at: new Date().toISOString()
    });
    return;
  }

  await AuditLog.create({ userId, action, metadata: safeMetadata, requestId });
};

module.exports = {
  AuditLog,
  createAuditLog,
  listAuditLogs: async ({ userId, action, from, to, page = 1, limit = 100 } = {}) => {
    const filter = { ...(userId ? { userId } : {}), ...(action ? { action: new RegExp(action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } : {}), ...(from || to ? { createdAt: { ...(from ? { $gte: new Date(from) } : {}), ...(to ? { $lte: new Date(to) } : {}) } } : {}) };
    if (!env.useMongoDB) {
      const rows = auditLogs.filter(row => (!userId || String(row.user_id) === String(userId)) && (!action || row.action.toLowerCase().includes(action.toLowerCase())) && (!from || new Date(row.created_at) >= new Date(from)) && (!to || new Date(row.created_at) <= new Date(to))).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
      return { items: rows.slice((page-1)*limit,page*limit).map(row => ({ id: row.id, userId: row.user_id, action: row.action, metadata: row.metadata, requestId: row.request_id, createdAt: row.created_at })), total: rows.length, page, limit, totalPages: Math.ceil(rows.length/limit) };
    }
    const [rows,total] = await Promise.all([AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page-1)*limit).limit(limit).lean(), AuditLog.countDocuments(filter)]);
    return { items: rows.map(row => ({ id: String(row._id), userId: row.userId ? String(row.userId) : null, action: row.action, metadata: row.metadata || {}, requestId: row.requestId || null, createdAt: row.createdAt })), total, page, limit, totalPages: Math.ceil(total/limit) };
  }
};
