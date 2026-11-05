import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { Account } from '../models/Account.js';

function readSession(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const { sub, kind } = jwt.verify(token, config.jwtSecret);
  return { id: sub, kind: kind || 'creator' };
}

export function optionalViewerId(req) {
  try {
    return readSession(req)?.id || null;
  } catch {
    return null;
  }
}

export async function optionalActor(req) {
  try {
    const session = readSession(req);
    return session ? await loadActor(session) : null;
  } catch {
    return null;
  }
}

export async function loadActor(session) {
  if (session.kind === 'creator') {
    const user = await User.findById(session.id);
    return user && { kind: 'creator', id: user._id, name: user.name, email: user.email, doc: user };
  }
  const account = await Account.findById(session.id);
  return account && { kind: 'supporter', id: account._id, name: account.name, email: account.email, doc: account };
}

export async function requireAuth(req, res, next) {
  try {
    const session = readSession(req);
    if (!session) return res.status(401).json({ error: 'Not logged in' });
    if (session.kind !== 'creator') return res.status(403).json({ error: 'Only the page owner can do this' });
    const user = await User.findById(session.id);
    if (!user) return res.status(401).json({ error: 'Not logged in' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

export async function requireAccount(req, res, next) {
  try {
    const session = readSession(req);
    if (!session) return res.status(401).json({ error: 'Please log in or create an account to support' });
    const actor = await loadActor(session);
    if (!actor) return res.status(401).json({ error: 'Please log in again' });
    req.actor = actor;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

export function signToken(doc, kind) {
  return jwt.sign({ sub: doc._id.toString(), kind }, config.jwtSecret, { expiresIn: '7d' });
}
