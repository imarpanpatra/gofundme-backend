import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { User } from '../models/User.js';
import { Account } from '../models/Account.js';
import { requireAccount, signToken } from '../middleware/auth.js';
import { verifyGoogleCredential } from '../lib/google.js';

const router = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please wait a few minutes and try again.' } });
const googleLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please wait a few minutes and try again.' } });
const signupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please wait a few minutes and try again.' } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const creatorPayload = (user) => ({ ...user.toPublic(), email: user.email, kind: 'creator' });

router.post('/signup', signupLimiter, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').toLowerCase().trim();
  const password = String(req.body?.password || '');
  if (!name || name.length > 60) return res.status(400).json({ error: 'Enter your name (up to 60 characters)' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (password.length < 8 || password.length > 100) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if ((await Account.exists({ email })) || (await User.exists({ email }))) {
    return res.status(409).json({ error: 'An account with this email already exists. Log in instead.' });
  }
  const account = await Account.create({ name, email, passwordHash: await bcrypt.hash(password, 12) }).catch((err) => {
    if (err.code === 11000) return null;
    throw err;
  });
  if (!account) return res.status(409).json({ error: 'An account with this email already exists. Log in instead.' });
  res.status(201).json({ token: signToken(account, 'supporter'), user: account.toPublic() });
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
    return res.status(401).json({ error: 'This account uses Google sign-in. Use "Continue with Google" instead.' });
  }
  if (!account || !(await bcrypt.compare(String(password), account.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({ token: signToken(account, 'supporter'), user: account.toPublic() });
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
    if (!account.googleId) await Account.updateOne({ _id: account._id }, { googleId });
  } else {
    account = await Account.create({ name: name || email, email, googleId }).catch(async (err) => {
      if (err.code === 11000) return Account.findOne({ email });
      throw err;
    });
  }
  res.json({ token: signToken(account, 'supporter'), user: account.toPublic() });
});

router.get('/me', requireAccount, (req, res) => {
  const { kind, doc } = req.actor;
  res.json({ user: kind === 'creator' ? creatorPayload(doc) : doc.toPublic() });
});

export default router;
