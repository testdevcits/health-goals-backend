const crypto = require('crypto');
const env = require('../config/env');
const { AppError } = require('../middleware/error.middleware');

function key() {
  if (!env.voucherEncryptionKey || Buffer.byteLength(env.voucherEncryptionKey) < 32) {
    throw new AppError('Voucher code storage is not configured. Set VOUCHER_ENCRYPTION_KEY to a random secret of at least 32 characters.', 503);
  }
  return crypto.createHash('sha256').update(env.voucherEncryptionKey).digest();
}

const encrypt = value => {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), nonce);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [nonce, cipher.getAuthTag(), data].map(part => part.toString('base64url')).join('.');
};

const decrypt = value => {
  const [nonce, tag, data] = value.split('.').map(part => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
};

const hash = value => crypto.createHmac('sha256', key()).update(value.toUpperCase()).digest('hex');

module.exports = { encrypt, decrypt, hash };
