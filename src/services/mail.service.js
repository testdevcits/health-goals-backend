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

exports.sendPartnerStaffInvite = async ({ email, name, partnerName, loginId, temporaryPassword, loginUrl }) => {
  const config = env.smtp;
  if (!config.host || !config.user || !config.pass || !config.from) throw new AppError('Email delivery is not configured. Configure SMTP before inviting partner staff.', 503);
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const safeName = escapeHtml(name), safePartner = escapeHtml(partnerName), safeEmail = escapeHtml(loginId), safePassword = escapeHtml(temporaryPassword), safeUrl = escapeHtml(loginUrl);
  const transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, requireTLS: !config.secure, auth: { user: config.user, pass: config.pass }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
  try {
    await transport.sendMail({ from: config.from, to: email, subject: `Partner staff access • ${partnerName}`,
      text: `Hello ${name},\n\n${partnerName} has invited you to verify Health Goals reward coupons.\n\nOpen: ${loginUrl}\nUser ID: ${loginId}\nTemporary password: ${temporaryPassword}\n\nYou must choose a new password at first sign-in. This link is for partner staff only. If you were not expecting this invitation, contact the partner administrator.`,
      html: `<!doctype html><html lang="en"><body style="margin:0;background:#f3f6f2;font-family:Arial,sans-serif;color:#263d30"><main style="max-width:540px;margin:32px auto;background:#fff;border:1px solid #dfe8dc;border-radius:14px;padding:28px"><p style="color:#62805f;font-size:11px;letter-spacing:1.4px;font-weight:bold">HEALTH GOALS · PARTNER ACCESS</p><h1 style="font-size:23px">Verify reward coupons</h1><p>Hello ${safeName}, ${safePartner} invited you to verify reward coupons issued through Health Goals.</p><p><a href="${safeUrl}" style="display:inline-block;padding:12px 18px;background:#cfe3c6;color:#203a2c;text-decoration:none;border-radius:8px;font-weight:bold">Open staff verification</a></p><p><strong>User ID</strong><br>${safeEmail}</p><p><strong>Temporary password</strong><br><code style="font-size:16px;padding:8px;background:#f1f5ef;display:inline-block">${safePassword}</code></p><p style="font-size:13px;color:#67766b">For account security, you must choose a new password at first sign-in. Keep this email private. Contact your partner administrator if you did not expect this invitation.</p></main></body></html>`
    });
  } catch { throw new AppError('Could not send the partner invitation email. The staff account was not activated.', 503); }
  finally { transport.close(); }
};
