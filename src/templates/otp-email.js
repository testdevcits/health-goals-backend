'use strict';

const { renderEmail, escapeHtml } = require('./email-layout');

module.exports = function otpEmail(otp, purpose = 'verification') {
  const code = escapeHtml(otp);
  const isPasswordReset = purpose === 'password_reset';
  const action = isPasswordReset ? 'Reset your password' : 'Verify your email';
  const instructions = isPasswordReset
    ? 'Enter this code on the password reset screen to choose a new password.'
    : 'Enter the code on the verification screen to securely complete registration or sign-in.';
  const subject = `${action} • Health App`;
  return renderEmail({
    subject,
    preheader: `Your Health App ${isPasswordReset ? 'password reset' : 'verification'} code expires in 5 minutes.`,
    eyebrow: isPasswordReset ? 'PASSWORD RESET' : 'ACCOUNT VERIFICATION',
    heading: isPasswordReset ? 'Reset your password.' : 'One step closer.',
    intro: isPasswordReset ? 'Use this code to choose a new Health App password.' : 'Verify your email to continue to Health App.',
    contentHtml: `<h2 style="margin:0 0 12px;font-size:20px;line-height:28px;color:#243e35;">${isPasswordReset ? 'Your password reset code' : 'Your verification code'}</h2>
<p style="margin:0 0 24px;font-size:14px;line-height:23px;color:#6d7e70;">${escapeHtml(instructions)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="background-color:#f0f5ec;border:1px solid #dce7d4;border-radius:10px;padding:22px 8px;"><span style="font-family:'Courier New',monospace;font-size:36px;line-height:44px;letter-spacing:6px;font-weight:700;color:#204f3e;">${code}</span></td></tr></table>
<p style="margin:14px 0 26px;text-align:center;font-size:12px;line-height:20px;color:#7c8c78;">Valid for <strong style="color:#4e6948;">5 minutes</strong> &nbsp;&bull;&nbsp; Single use only</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #e9eee5;padding-top:22px;"><p style="margin:0 0 8px;font-size:12px;line-height:20px;font-weight:700;color:#4d6548;">Keep your code private.</p><p style="margin:0;font-size:12px;line-height:20px;color:#84907e;">Never share this code. If you didn’t request it, ignore this email.</p></td></tr></table>`,
    contentText: `${isPasswordReset ? 'Your password reset code' : 'Your verification code'}: ${otp}\n${instructions}\n\nValid for 5 minutes. Single use only. Never share this code.`
  });
};
