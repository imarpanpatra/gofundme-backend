import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { limiter } from '../lib/limiter.js';
import { User } from '../models/User.js';
import { Account } from '../models/Account.js';
import { PasswordReset } from '../models/PasswordReset.js';
import { SignupVerification } from '../models/SignupVerification.js';
import { requireAccount, signToken } from '../middleware/auth.js';
import { verifyGoogleCredential } from '../lib/google.js';
import { emailConfigured, resetEmail, sendEmail, signupCodeEmail } from '../lib/email.js';
import { ensureUsername } from '../lib/username.js';
import { config } from '../config.js';

const router = Router();

const loginLimiter = limiter('loginLimiter', 15 * 60 * 1000, 20);
const googleLimiter = limiter('googleLimiter', 15 * 60 * 1000, 30);
const signupLimiter = limiter('signupLimiter', 60 * 60 * 1000, 10);
const forgotLimiter = limiter('forgotLimiter', 60 * 60 * 1000, 5);
const resetLimiter = limiter('resetLimiter', 15 * 60 * 1000, 20);
const codeLimiter = limiter('signupCodeLimiter', 15 * 60 * 1000, 30);
const resendLimiter = limiter('signupResendLimiter', 60 * 60 * 1000, 10);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_TTL_MS = 60 * 60 * 1000;
const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_CODE_SENDS = 5;
const EXISTS_ERROR = 'An account with this email already exists. Log in instead.';

const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const codeHashFor = (signupId, code) => hashToken(`${signupId}:${code}`);
const sameHash = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const creatorPayload = (user) => ({ ...user.toPublic(), email: user.email, kind: 'creator' });
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function appOrigin(req) {
  const origin = String(req.get('origin') || '').replace(/\/$/, '');
  if (origin && config.clientUrls.includes(origin)) return origin;
  return config.appUrl || config.clientUrls[0];
}

async function brandName() {
  const creator = await User.defaultCreator(config.defaultCreator, { siteName: 1, name: 1 });
  const site = String(creator?.siteName || '').replace(/^[\p{Extended_Pictographic}️‍\s]+/u, '');
  return site || creator?.name || 'Go fund my trip';
}

async function supporterSession(account) {
  await ensureUsername(account);
  return { token: signToken(account, 'supporter'), user: account.toPublic() };
}

async function emailTaken(email) {
  if (await User.exists({ email })) return true;
  const account = await Account.findOne({ email }, { passwordHash: 1 });
  return Boolean(account?.passwordHash);
}

async function sendSignupCode(pending, code) {
  await sendEmail({ to: pending.email, ...signupCodeEmail({ name: pending.name, code, brand: await brandName() }) });
}

router.post('/signup', signupLimiter, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').toLowerCase().trim();
  const password = String(req.body?.password || '');
  if (!name || name.length > 60) return res.status(400).json({ error: 'Enter your name (up to 60 characters)' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (password.length < 8 || password.length > 100) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (await emailTaken(email)) return res.status(409).json({ error: EXISTS_ERROR });
  if (!emailConfigured()) return res.status(503).json({ error: "Email sign-up isn't available right now. Use Continue with Google instead." });
  const recent = await SignupVerification.countDocuments({ email, createdAt: { $gt: new Date(Date.now() - 60 * 60 * 1000) } });
  if (recent >= MAX_CODE_SENDS) return res.status(429).json({ error: 'Too many sign-up codes were sent to this email. Please try again in an hour.' });

  const signupId = crypto.randomBytes(24).toString('base64url');
  const code = newCode();
  const pending = await SignupVerification.create({
    email,
    name,
    passwordHash: await bcrypt.hash(password, 12),
    signupHash: hashToken(signupId),
    codeHash: codeHashFor(signupId, code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  try {
    await sendSignupCode(pending, code);
  } catch (err) {
    console.error('Sign-up code email failed:', err.message);
    await pending.deleteOne();
    return res.status(502).json({ error: "We couldn't send the code right now. Please try again in a few minutes." });
  }
  res.status(202).json({ pending: true, signupId, email });
});

router.post('/signup/verify', codeLimiter, async (req, res) => {
  const signupId = String(req.body?.signupId || '');
  const code = String(req.body?.code || '').replace(/\D/g, '');
  const pending = signupId ? await SignupVerification.findOne({ signupHash: hashToken(signupId) }) : null;
  if (!pending || pending.expiresAt < new Date()) {
    return res.status(400).json({ error: 'This code has expired. Ask for a new one.', expired: true });
  }
  const counted = await SignupVerification.findOneAndUpdate(
    { _id: pending._id, attempts: { $lt: MAX_CODE_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { new: true }
  );
  if (!counted) return res.status(400).json({ error: 'Too many wrong codes. Ask for a new one.', expired: true });
  if (code.length !== 6 || !sameHash(codeHashFor(signupId, code), counted.codeHash)) {
    const left = MAX_CODE_ATTEMPTS - counted.attempts;
    return res.status(400).json({ error: left > 0 ? "That code isn't right. Check the email and try again." : 'Too many wrong codes. Ask for a new one.', expired: left <= 0 });
  }
  const claimed = await SignupVerification.findOneAndDelete({ _id: counted._id, codeHash: counted.codeHash });
  if (!claimed) return res.status(400).json({ error: 'This code has already been used. Log in instead.' });
  if (await User.exists({ email: claimed.email })) return res.status(409).json({ error: EXISTS_ERROR });

  let account = await Account.findOne({ email: claimed.email });
  if (!account) {
    account = await Account.create({ name: claimed.name, email: claimed.email, passwordHash: claimed.passwordHash }).catch((err) => {
      if (err.code === 11000) return null;
      throw err;
    });
    if (!account) account = await Account.findOne({ email: claimed.email });
  } else if (!account.passwordHash) {
    account.passwordHash = claimed.passwordHash;
    await account.save();
  } else {
    return res.status(409).json({ error: EXISTS_ERROR });
  }
  await SignupVerification.deleteMany({ email: claimed.email });
  res.status(201).json(await supporterSession(account));
});

router.post('/signup/resend', resendLimiter, async (req, res) => {
  const signupId = String(req.body?.signupId || '');
  const pending = signupId ? await SignupVerification.findOne({ signupHash: hashToken(signupId) }) : null;
  if (!pending) return res.status(400).json({ error: 'This sign-up has expired. Please start again.', restart: true });
  if (await emailTaken(pending.email)) return res.status(409).json({ error: EXISTS_ERROR });
  const code = newCode();
  const updated = await SignupVerification.findOneAndUpdate(
    { _id: pending._id, sends: { $lt: MAX_CODE_SENDS } },
    { $set: { codeHash: codeHashFor(signupId, code), attempts: 0, expiresAt: new Date(Date.now() + CODE_TTL_MS) }, $inc: { sends: 1 } },
    { new: true }
  );
  if (!updated) return res.status(429).json({ error: 'Too many codes sent. Please start again in a while.' });
  try {
    await sendSignupCode(updated, code);
  } catch (err) {
    console.error('Sign-up code email failed:', err.message);
    return res.status(502).json({ error: "We couldn't send the code right now. Please try again in a few minutes." });
  }
  res.json({ ok: true });
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const normalized = String(email).toLowerCase().trim();

  const user = await User.findOne({ email: normalized });
  if (user) {
    if (!user.passwordHash || !(await bcrypt.compare(String(password), user.passwordHash))) return res.status(401).json({ error: 'Invalid email or password' });
    return res.json({ token: signToken(user, 'creator'), user: creatorPayload(user) });
  }
  const account = await Account.findOne({ email: normalized });
  if (account && !account.passwordHash) {
    return res.status(401).json({ error: 'This account uses Google sign-in. Use "Continue with Google", or reset your password to add one.' });
  }
  if (!account || !(await bcrypt.compare(String(password), account.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json(await supporterSession(account));
});

router.post('/google', googleLimiter, async (req, res) => {
  let profile;
  try {
    profile = await verifyGoogleCredential(req.body?.credential);
  } catch (err) {
    return res.status(err.status || 502).json({ error: err.message });
  }
  const { googleId, email, name } = profile;

  const user = await User.findOne({ email });
  if (user) {
    if (!user.googleId) await User.updateOne({ _id: user._id }, { googleId });
    return res.json({ token: signToken(user, 'creator'), user: creatorPayload(user) });
  }

  let account = await Account.findOne({ email });
  if (account) {
    if (!account.googleId) await Account.updateOne({ _id: account._id }, { $set: { googleId } });
  } else {
    account = await Account.create({ name: name || email, email, googleId }).catch(async (err) => {
      if (err.code === 11000) return Account.findOne({ email });
      throw err;
    });
  }
  res.json(await supporterSession(account));
});

router.post('/forgot', forgotLimiter, async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (!emailConfigured()) return res.status(503).json({ error: "Password reset emails aren't set up yet. Please contact us." });

  const user = await User.findOne({ email });
  const account = user ? null : await Account.findOne({ email });
  const doc = user || account;
  if (!doc) return res.json({ ok: true });

  const kind = user ? 'creator' : 'supporter';
  const token = crypto.randomBytes(32).toString('base64url');
  await PasswordReset.deleteMany({ account: doc._id, usedAt: { $exists: false } });
  await PasswordReset.create({ kind, account: doc._id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) });

  const link = `${appOrigin(req)}/reset-password?token=${token}`;
  try {
    await sendEmail({ to: doc.email, ...resetEmail({ name: doc.name, link, brand: await brandName() }) });
  } catch (err) {
    console.error('Password reset email failed:', err.message);
    return res.status(502).json({ error: "We couldn't send the email right now. Please try again in a few minutes." });
  }
  res.json({ ok: true });
});

router.post('/reset', resetLimiter, async (req, res) => {
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');
  if (password.length < 8 || password.length > 100) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const reset = token ? await PasswordReset.findOne({ tokenHash: hashToken(token) }) : null;
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired. Ask for a new one.' });
  }
  const claimed = await PasswordReset.findOneAndUpdate({ _id: reset._id, usedAt: { $exists: false } }, { usedAt: new Date() });
  if (!claimed) return res.status(400).json({ error: 'This reset link has already been used. Ask for a new one.' });

  const Model = reset.kind === 'creator' ? User : Account;
  const doc = await Model.findById(reset.account);
  if (!doc) return res.status(400).json({ error: 'This reset link is invalid or has expired. Ask for a new one.' });

  const changedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  doc.passwordHash = await bcrypt.hash(password, 12);
  doc.passwordChangedAt = changedAt;
  await doc.save();
  await PasswordReset.deleteMany({ account: doc._id, _id: { $ne: reset._id } });

  if (reset.kind === 'creator') return res.json({ token: signToken(doc, 'creator'), user: creatorPayload(doc) });
  res.json(await supporterSession(doc));
});

router.get('/me', requireAccount, async (req, res) => {
  const { kind, doc } = req.actor;
  if (kind === 'creator') return res.json({ user: creatorPayload(doc) });
  await ensureUsername(doc);
  res.json({ user: doc.toPublic() });
});

export default router;
