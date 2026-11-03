const jwt = require('jsonwebtoken');
const env = require('../config/env');
const partners = require('../models/partner.model');
const { AppError } = require('./error.middleware');

module.exports = async function authenticatePartnerPortal(req, res, next) {
  try {
    const raw = req.get('authorization') || '';
    if (!raw.startsWith('Bearer ')) throw new AppError('Partner login is required', 401);
    const decoded = jwt.verify(raw.slice(7), env.jwt.secret);
    if (decoded.scope !== 'PARTNER_PORTAL' || !decoded.partnerId) throw new AppError('Invalid partner session', 401);
    const partner = await partners.findPortalById(decoded.partnerId);
    if (!partner) throw new AppError('Partner portal access is disabled. Contact Health Goals support.', 403);
    if (decoded.authVersion !== (partner.portalAuthVersion || 0)) throw new AppError('Partner session was reset. Sign in again.', 401);
    req.portalPartner = { id: String(partner._id || partner.id), name: partner.name, username: partner.portalUsername, mustChangePassword: partner.portalMustChangePassword === true };
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') return next(new AppError('Partner session expired. Sign in again.', 401));
    next(error);
  }
};
