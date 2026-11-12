'use strict';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

function renderEmail({ subject, preheader, eyebrow, heading, intro, contentHtml, contentText, footer = 'This is an automated email. Please do not reply.' }) {
  const safeSubject = escapeHtml(subject);
  const safePreheader = escapeHtml(preheader);
  const safeEyebrow = escapeHtml(eyebrow);
  const safeHeading = escapeHtml(heading);
  const safeIntro = escapeHtml(intro);
  const safeFooter = escapeHtml(footer);
  return {
    subject,
    text: `Health App\n${heading}\n\n${intro}\n\n${contentText}\n\n${footer}\n\nHealth App | Account and rewards`,
    html: `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${safeSubject}</title></head>
<body style="margin:0;padding:0;background-color:#f4f7f3;font-family:Arial,Helvetica,sans-serif;color:#243e35;">
<div style="display:none;font-size:1px;line-height:1px;color:#f4f7f3;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${safePreheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f7f3;"><tr><td align="center" style="padding:40px 16px;">
<!--[if mso]><table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
<tr><td style="padding:0 8px 24px;font-size:26px;font-weight:700;letter-spacing:-1px;color:#204f3e;">health<span style="color:#82a775;">.</span><span style="font-size:10px;letter-spacing:2px;font-weight:400;color:#718574;">&nbsp; HEALTH APP</span></td></tr>
<tr><td style="background-color:#ffffff;border:1px solid #e0e8dc;border-radius:16px;overflow:hidden;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:28px 28px 24px;background-color:#204f3e;color:#ffffff;border-radius:15px 15px 0 0;">
<p style="margin:0 0 12px;font-size:10px;line-height:16px;letter-spacing:2px;color:#c6dbbf;font-weight:700;">${safeEyebrow}</p>
<h1 style="margin:0;font-size:28px;line-height:36px;letter-spacing:-0.5px;font-weight:700;">${safeHeading}</h1>
<p style="margin:10px 0 0;font-size:14px;line-height:22px;color:#d8e5d4;">${safeIntro}</p>
</td></tr>
<tr><td style="padding:30px 28px;">${contentHtml}</td></tr>
</table></td></tr>
<tr><td align="center" style="padding:24px 12px 0;"><p style="margin:0;font-size:11px;line-height:18px;color:#8a9784;">Health App &nbsp;&bull;&nbsp; Account and rewards</p><p style="margin:6px 0 0;font-size:11px;line-height:18px;color:#9aa592;">${safeFooter}</p></td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`
  };
}

module.exports = { renderEmail, escapeHtml };
