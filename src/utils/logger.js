const redact = (value) => {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const blocked = new Set([
    'password',
    'passwordHash',
    'password_hash',
    'authorization',
    'accessToken',
    'refreshToken',
    'token',
    'jwt',
    'secret'
  ]);

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      blocked.has(key) ? '[REDACTED]' : entry
    ])
  );
};

const info = (message, meta = {}) => {
  console.log(JSON.stringify({ level: 'info', message, ...redact(meta) }));
};

const error = (message, meta = {}) => {
  console.error(JSON.stringify({ level: 'error', message, ...redact(meta) }));
};

module.exports = {
  info,
  error
};
