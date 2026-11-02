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
  createAuditLog
};
