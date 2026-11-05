import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { User } from '../models/User.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    const { sub } = jwt.verify(token, config.jwtSecret);
    const user = await User.findById(sub);
    if (!user) return res.status(401).json({ error: 'Not logged in' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

export function signToken(user) {
  return jwt.sign({ sub: user._id.toString() }, config.jwtSecret, { expiresIn: '7d' });
}
