const jwt = require('jsonwebtoken');
const env = require('../config/env');
const users = require('../models/user.model');
const community = require('../models/community.model');
const { AppError } = require('../middleware/error.middleware');

const groupRoom = (groupId) => `group:${groupId}`;
const publicError = (error) => ({ ok: false, error: error.statusCode ? error.message : 'Chat request failed.' });

async function getSocketUser(token) {
  if (typeof token !== 'string' || !token) throw new AppError('Authentication token is required.', 401);
  const claims = jwt.verify(token, env.jwt.secret);
  if (claims.otpVerified !== true || !Number.isInteger(claims.sessionExpiresAt) || claims.sessionExpiresAt <= Math.floor(Date.now() / 1000)) {
    throw new AppError('Your session has expired. Sign in again.', 401);
  }
  const user = await users.findUserById(claims.sub);
  if (!user || user.status !== 'ACTIVE' || (claims.authVersion || 0) !== (user.authVersion || 0)) {
    throw new AppError('Your session is no longer valid. Sign in again.', 401);
  }
  return { user, claims };
}

async function getCurrentSocketUser(socket) {
  const claims = socket.data.claims;
  if (!claims || !Number.isInteger(claims.sessionExpiresAt) || claims.sessionExpiresAt <= Math.floor(Date.now() / 1000)) {
    throw new AppError('Your session has expired. Sign in again.', 401);
  }
  const user = await users.findUserById(claims.sub);
  if (!user || user.status !== 'ACTIVE' || (claims.authVersion || 0) !== (user.authVersion || 0)) {
    throw new AppError('Your session is no longer valid. Sign in again.', 401);
  }
  return user;
}

function attachChatGateway(io) {
  io.use(async (socket, next) => {
    try {
      socket.data.token = socket.handshake.auth?.token;
      const { user, claims } = await getSocketUser(socket.data.token);
      socket.data.user = user;
      socket.data.claims = claims;
      next();
    } catch (cause) {
      const error = new Error('Authentication failed. Please sign in again.');
      error.data = { code: cause.statusCode === 401 || cause.name === 'JsonWebTokenError' || cause.name === 'TokenExpiredError' ? 'AUTH_REQUIRED' : 'SERVER_ERROR' };
      next(error);
    }
  });

  io.on('connection', (socket) => {
    const acknowledge = (callback, data) => {
      if (typeof callback === 'function') callback(data);
    };

    const verifyMembership = async (groupId) => {
      const user = await getCurrentSocketUser(socket);
      socket.data.user = user;
      const group = await community.getGroup(groupId, user.id);
      if (!group.joined) throw Object.assign(new Error('Join this group before using its chat.'), { statusCode: 403 });
      return user;
    };

    socket.on('group:join', async (payload = {}, callback) => {
      try {
        const groupId = String(payload.groupId || '').trim();
        if (!groupId || groupId.length > 100) throw Object.assign(new Error('A valid groupId is required.'), { statusCode: 400 });
        await verifyMembership(groupId);
        await socket.join(groupRoom(groupId));
        acknowledge(callback, { ok: true, groupId });
      } catch (error) {
        acknowledge(callback, publicError(error));
      }
    });

    socket.on('group:leave', (payload = {}, callback) => {
      const groupId = String(payload.groupId || '').trim();
      if (groupId) socket.leave(groupRoom(groupId));
      acknowledge(callback, { ok: true });
    });

    socket.on('group:send', async (payload = {}, callback) => {
      try {
        const groupId = String(payload.groupId || '').trim();
        const message = typeof payload.message === 'string' ? payload.message.trim() : '';
        if (!message || message.length > 1000) throw Object.assign(new Error('Message must be 1–1000 characters.'), { statusCode: 400 });
        const user = await verifyMembership(groupId);
        const saved = await community.postMessage(groupId, user.id, message);
        io.to(groupRoom(groupId)).emit('group:message', saved);
        acknowledge(callback, { ok: true, message: saved });
      } catch (error) {
        acknowledge(callback, publicError(error));
      }
    });
  });
}

module.exports = { attachChatGateway };
