const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const partners = require('../models/partner.model');
const { AppError } = require('../middleware/error.middleware');

const normalizeUsername = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._-]{4,40}$/.test(value.trim())) throw new AppError('Login ID must be 4 to 40 letters, numbers, dots, underscores, or hyphens', 400);
  return value.trim().toLowerCase();
};

function tokenFor(partner) {
  const partnerId = String(partner._id || partner.id);
  return jwt.sign({ scope: 'PARTNER_PORTAL', partnerId, authVersion: partner.portalAuthVersion || 0 }, env.jwt.secret, { expiresIn: '4h', jwtid: crypto.randomUUID() });
}

async function issueCredentials(partnerId, username) {
  username = normalizeUsername(username);
  const partner = await partners.find(partnerId);
  if (!partner) throw new AppError('Partner not found', 404);
  if (partner.status !== 'ACTIVE') throw new AppError('Approve and activate this partner before creating portal access', 409);
  const temporaryPassword = `Hg-${crypto.randomBytes(15).toString('base64url')}`;
  const updated = await partners.setPortalCredentials(partnerId, username, await bcrypt.hash(temporaryPassword, 12));
  if (!updated) throw new AppError('Partner is no longer active. Refresh and try again.', 409);
  return { partner: updated, username, temporaryPassword };
}

async function login({ username, password }) {
  username = normalizeUsername(username);
  if (typeof password !== 'string' || !password || password.length > 100) throw new AppError('Enter your partner login ID and password', 400);
  const partner = await partners.findPortalByUsername(username);
  if (!partner || !await bcrypt.compare(password, partner.portalPasswordHash)) throw new AppError('Invalid login ID or password', 401);
  const token = tokenFor(partner);
  return { token, expiresIn: 4 * 60 * 60, mustChangePassword: partner.portalMustChangePassword !== false, partner: { id: String(partner._id || partner.id), name: partner.name, username: partner.portalUsername } };
}

async function changePassword(partnerId, password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 72) throw new AppError('Choose a password with at least 12 characters', 400);
  const updated = await partners.changePortalPassword(partnerId, await bcrypt.hash(password, 12));
  if (!updated || updated.modifiedCount === 0 && updated.matchedCount === 0) throw new AppError('Partner portal is unavailable', 401);
  const partner = await partners.findPortalById(partnerId);
  return { token: tokenFor(partner), expiresIn: 4 * 60 * 60, mustChangePassword: false, partner: { id: String(partner._id || partner.id), name: partner.name, username: partner.portalUsername } };
}

module.exports = { issueCredentials, login, changePassword, normalizeUsername };
