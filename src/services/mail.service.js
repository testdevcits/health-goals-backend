'use strict';

const nodemailer = require('nodemailer');
const env = require('../config/env');
const otpEmail = require('../templates/otp-email');
const ticketRewardEmail = require('../templates/ticket-reward-email');
const { AppError } = require('../middleware/error.middleware');

function smtpConfig() {
  const config = env.smtp;
  if (!config.host || !config.user || !config.pass || !config.from) {
    throw new AppError('Email delivery is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM.', 503);
  }
  return config;
}

function createTransport(timeout = 15000) {
  const config = smtpConfig();
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: timeout
  });
}

async function sendTemplate({ to, template, attachments = [], timeout = 15000, failureMessage }) {
  const config = smtpConfig();
  const transport = createTransport(timeout);
  try {
    await transport.sendMail({ from: config.from, to, ...template, ...(attachments.length ? { attachments } : {}) });
  } catch {
    throw new AppError(failureMessage, 503);
  } finally {
    transport.close();
  }
}

exports.verifySmtp = async () => {
  const config = smtpConfig();
  const transport = createTransport();
  try {
    await transport.verify();
    return { host: config.host, port: config.port, secure: config.secure, from: config.from };
  } finally {
    transport.close();
  }
};

exports.sendOtp = async (email, otp, purpose) => sendTemplate({
  to: email,
  template: otpEmail(otp, purpose),
  failureMessage: 'Could not send the requested email code. Check SMTP configuration and try again.'
});

exports.sendTicketReward = async ({ email, winnerName, month, ticketCount, bookingReference, image }) => sendTemplate({
  to: email,
  template: ticketRewardEmail({ winnerName, month, ticketCount, bookingReference }),
  attachments: [{ filename: image.filename, content: image.buffer, contentType: image.contentType }],
  timeout: 20000,
  failureMessage: 'Could not send the ticket email. The claim remains ready to retry.'
});
