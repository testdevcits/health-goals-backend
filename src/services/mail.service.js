const nodemailer = require('nodemailer');
const otpEmail = require('../templates/otp-email');
const env = require('../config/env');
const { AppError } = require('../middleware/error.middleware');

exports.sendOtp = async (email, otp, purpose) => {
  const config = env.smtp;
  if (!config.host || !config.user || !config.pass || !config.from) {
    throw new AppError('Email delivery is not configured. Configure SMTP before using registration, login, or password reset.', 503);
  }
  const transport = nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
  });
  try {
    await transport.sendMail({ from: config.from, to: email,
      ...otpEmail(otp, purpose) });
  } catch {
    throw new AppError('Could not send the requested email code. Please try again later.', 503);
  } finally { transport.close(); }
};
