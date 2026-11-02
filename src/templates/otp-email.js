const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

module.exports = function otpEmail(otp, purpose = 'verification') {
  const code = escapeHtml(otp);
  const isPasswordReset = purpose === 'password_reset';
  const subject = isPasswordReset ? 'Reset your password • Health App' : 'Verify your email • Health App';
  const heading = isPasswordReset ? 'Reset your password.' : 'One step closer.';
  const kicker = isPasswordReset ? 'PASSWORD RESET' : 'ACCOUNT VERIFICATION';
  const title = isPasswordReset ? 'Your password reset code' : 'Your verification code';
  const intro = isPasswordReset ? 'Use this code to choose a new Health App password.' : 'Verify your email to continue to Health App.';
  const instructions = isPasswordReset ? 'Enter this code on the password reset screen to choose a new password.' : 'Enter the code below on the verification screen to securely complete your registration or sign-in.';
  return {
    subject,
    text: `Health App\n\n${isPasswordReset ? 'Reset your password' : 'Verify your email'}\n\nYour code is: ${otp}\n\n${instructions} It expires in 5 minutes and can only be used once.\n\nNever share this code with anyone. If you did not request it, you can ignore this email.\n\nHealth App | Account security`,
    html: `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${subject}</title></head>
<body style="margin:0;padding:0;background-color:#f4f7f3;font-family:Arial,Helvetica,sans-serif;color:#243e35;">
<div style="display:none;font-size:1px;line-height:1px;color:#f4f7f3;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">Your Health App ${isPasswordReset ? 'password reset' : 'verification'} code expires in 5 minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f7f3;"><tr><td align="center" style="padding:40px 16px;">
<!--[if mso]><table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
<tr><td style="padding:0 8px 24px;font-size:26px;font-weight:700;letter-spacing:-1px;color:#204f3e;">health<span style="color:#82a775;">.</span><span style="font-size:10px;letter-spacing:2px;font-weight:400;color:#718574;">&nbsp; HEALTH APP</span></td></tr>
<tr><td style="background-color:#ffffff;border:1px solid #e0e8dc;border-radius:16px;overflow:hidden;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:28px 28px 24px;background-color:#204f3e;color:#ffffff;border-radius:15px 15px 0 0;">
<p style="margin:0 0 12px;font-size:10px;line-height:16px;letter-spacing:2px;color:#c6dbbf;font-weight:700;">${kicker}</p>
<h1 style="margin:0;font-size:28px;line-height:36px;letter-spacing:-0.5px;font-weight:700;">${heading}</h1>
<p style="margin:10px 0 0;font-size:14px;line-height:22px;color:#d8e5d4;">${intro}</p>
</td></tr>
<tr><td style="padding:30px 28px;">
<h2 style="margin:0 0 12px;font-size:20px;line-height:28px;color:#243e35;">${title}</h2>
<p style="margin:0 0 24px;font-size:14px;line-height:23px;color:#6d7e70;">${instructions}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="background-color:#f0f5ec;border:1px solid #dce7d4;border-radius:10px;padding:22px 8px;">
<span style="font-family:'Courier New',monospace;font-size:36px;line-height:44px;letter-spacing:6px;font-weight:700;color:#204f3e;">${code}</span>
</td></tr></table>
<p style="margin:14px 0 26px;text-align:center;font-size:12px;line-height:20px;color:#7c8c78;">Valid for <strong style="color:#4e6948;">5 minutes</strong> &nbsp;&bull;&nbsp; Single use only</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #e9eee5;padding-top:22px;">
<p style="margin:0 0 8px;font-size:12px;line-height:20px;font-weight:700;color:#4d6548;">Keep your code private.</p>
<p style="margin:0;font-size:12px;line-height:20px;color:#84907e;">Never share this code with anyone. If you didn’t request it, you can safely ignore this email.</p>
</td></tr></table>
</td></tr></table>
</td></tr>
<tr><td align="center" style="padding:24px 12px 0;"><p style="margin:0;font-size:11px;line-height:18px;color:#8a9784;">Health App &nbsp;&bull;&nbsp; Account security</p><p style="margin:6px 0 0;font-size:11px;line-height:18px;color:#9aa592;">This is an automated email. Please do not reply.</p></td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`
  };
};
