'use strict';

const { renderEmail, escapeHtml } = require('./email-layout');

module.exports = function ticketRewardEmail({ winnerName, month, ticketCount, bookingReference }) {
  const name = String(winnerName || 'there');
  const safeName = escapeHtml(name);
  const safeMonth = escapeHtml(month);
  const safeCount = escapeHtml(ticketCount);
  const reference = bookingReference ? String(bookingReference) : '';
  const referenceHtml = reference
    ? `<p style="margin:0 0 18px;font-size:13px;line-height:21px;color:#647366;">Booking reference: <strong style="color:#365440;">${escapeHtml(reference)}</strong></p>`
    : '';
  const subjectMonth = String(month || '').replace(/[\r\n]+/g, ' ').trim();
  return renderEmail({
    subject: `Your ${subjectMonth} Health App leaderboard ticket`,
    preheader: `Your ${subjectMonth} leaderboard reward ticket is attached.`,
    eyebrow: 'LEADERBOARD REWARD',
    heading: 'Congratulations!',
    intro: `Your ${subjectMonth} leaderboard reward is ready.`,
    contentHtml: `<h2 style="margin:0 0 12px;font-size:20px;line-height:28px;color:#243e35;">Hi ${safeName},</h2>
<p style="margin:0 0 18px;font-size:14px;line-height:23px;color:#6d7e70;">You earned a leaderboard reward for ${safeMonth}. Your ${safeCount} ticket(s) are attached to this email.</p>
${referenceHtml}<p style="margin:0;font-size:12px;line-height:20px;color:#84907e;">Keep this email for your records.</p>`,
    contentText: `Hi ${name},\nCongratulations on your ${month} leaderboard reward. Your ${ticketCount} ticket(s) are attached.${reference ? `\nBooking reference: ${reference}` : ''}`
  });
};
