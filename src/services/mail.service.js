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

exports.sendTicketReward = async ({ email, winnerName, month, ticketCount, bookingReference, image }) => {
  const config = env.smtp;
  if (!config.host || !config.user || !config.pass || !config.from) {
    throw new AppError('Email delivery is not configured. Configure SMTP to send ticket rewards.', 503);
  }
  const transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, requireTLS: !config.secure, auth: { user: config.user, pass: config.pass }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 });
  const safe = value => String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  try {
    await transport.sendMail({
      from: config.from, to: email, subject: `Your ${month} Health App leaderboard ticket`,
      text: `Hi ${winnerName},\n\nCongratulations on your ${month} leaderboard reward. Your ${ticketCount} ticket(s) are attached.${bookingReference ? `\nBooking reference: ${bookingReference}` : ''}\n\nHealth App`,
      html: `<p>Hi ${safe(winnerName)},</p><p>Congratulations on your ${safe(month)} leaderboard reward. Your ${safe(ticketCount)} ticket(s) are attached.</p>${bookingReference ? `<p>Booking reference: ${safe(bookingReference)}</p>` : ''}<p>Health App</p>`,
      attachments: [{ filename: image.filename, content: image.buffer, contentType: image.contentType }]
    });
  } catch {
    throw new AppError('Could not send the ticket email. The claim remains ready to retry.', 503);
  } finally { transport.close(); }
};
