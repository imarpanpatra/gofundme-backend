import { config } from '../config.js';

export const emailConfigured = () => Boolean(config.resend.apiKey);

export async function sendEmail({ to, subject, html, text }) {
  if (!emailConfigured()) throw Object.assign(new Error('Email is not set up'), { status: 503 });
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.resend.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.resend.from, to: [to], subject, html, text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw Object.assign(new Error(`Resend rejected the email (${res.status}): ${detail.slice(0, 300)}`), { status: 502 });
  }
  return res.json();
}

const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function signupCodeEmail({ name, code, brand }) {
  const text = [
    `Hi ${name},`,
    '',
    `Your ${brand} sign-up code is ${code}`,
    '',
    "Enter it on the sign-up page to finish creating your account. It expires in 15 minutes. If you didn't try to sign up, ignore this email and no account will be created.",
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#222">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td style="font-size:20px;font-weight:bold;padding-bottom:16px">${escape(brand)}</td></tr>
<tr><td style="font-size:15px;line-height:1.6">Hi ${escape(name)},<br><br>Enter this code on the sign-up page to finish creating your account.</td></tr>
<tr><td style="padding:24px 0"><span style="display:inline-block;background:#f0f3ff;color:#222;font-size:32px;font-weight:bold;letter-spacing:8px;padding:12px 24px;border-radius:12px">${escape(code)}</span></td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:#6b6b6b">The code expires in 15 minutes. If you didn't try to sign up, ignore this email and no account will be created.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: `${code} is your ${brand} sign-up code`, html, text };
}

export function resetEmail({ name, link, brand }) {
  const text = [
    `Hi ${name},`,
    '',
    `Someone asked to reset the password for your ${brand} account. If that was you, open this link to choose a new password:`,
    '',
    link,
    '',
    "The link works once and expires in 1 hour. If you didn't ask for this, ignore this email and your password stays the same.",
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#222">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td style="font-size:20px;font-weight:bold;padding-bottom:16px">${escape(brand)}</td></tr>
<tr><td style="font-size:15px;line-height:1.6">Hi ${escape(name)},<br><br>Someone asked to reset the password for your account. If that was you, choose a new password below.</td></tr>
<tr><td style="padding:24px 0"><a href="${escape(link)}" style="display:inline-block;background:#5f7fff;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:999px">Choose a new password</a></td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:#6b6b6b">The link works once and expires in 1 hour. If you didn't ask for this, ignore this email and your password stays the same.<br><br>If the button doesn't work, copy this link into your browser:<br><span style="word-break:break-all">${escape(link)}</span></td></tr>
</table></td></tr></table></body></html>`;
  return { subject: `Reset your ${brand} password`, html, text };
}
