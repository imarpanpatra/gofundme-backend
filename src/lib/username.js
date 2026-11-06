import crypto from 'node:crypto';
import { Account } from '../models/Account.js';
import { User } from '../models/User.js';

const RESERVED = new Set([
  'admin', 'api', 'about', 'account', 'assets', 'contact', 'dashboard', 'default', 'disclaimer', 'forgot-password', 'hall-of-fame',
  'help', 'hof', 'login', 'logout', 'me', 'privacy', 'refund-policy', 'reset-password', 'return-policy', 'settings', 'shipping-policy',
  'signup', 'support', 'terms', 'www',
]);

export const USERNAME_RE = /^[a-z0-9][a-z0-9._]{1,28}[a-z0-9]$/;

export const normalizeUsername = (v) => String(v || '').trim().replace(/^@/, '').toLowerCase();

export async function usernameProblem(username, accountId) {
  if (!USERNAME_RE.test(username) || /[._]{2}/.test(username)) {
    return 'Usernames are 3–30 characters: letters, numbers, dots and underscores, starting and ending with a letter or number';
  }
  if (RESERVED.has(username)) return 'That username is reserved';
  const [account, creator] = await Promise.all([Account.findOne({ username }, { _id: 1 }), User.slugInUse(username)]);
  if (creator || (account && String(account._id) !== String(accountId))) return 'That username is taken';
  return null;
}

export async function generateUsername(name, email) {
  const clean = (s) =>
    String(s || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 20);
  const base = clean(name) || clean(String(email || '').split('@')[0]) || 'traveller';
  const stem = base.length >= 3 ? base : `${base}fan`;
  if (!(await usernameProblem(stem))) return stem;
  for (let i = 0; i < 20; i++) {
    const candidate = `${stem.slice(0, 24)}${crypto.randomInt(100, 99999)}`;
    if (!(await usernameProblem(candidate))) return candidate;
  }
  return `fan${crypto.randomBytes(5).toString('hex')}`;
}

export async function ensureUsername(account) {
  if (account.username) return account.username;
  for (let i = 0; i < 3; i++) {
    const username = await generateUsername(account.name, account.email);
    try {
      await Account.updateOne({ _id: account._id, username: { $exists: false } }, { username });
      account.username = (await Account.findById(account._id, { username: 1 }))?.username || username;
      return account.username;
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
  return account.username || '';
}
