import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { ContactMessage } from '../models/ContactMessage.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please wait a few minutes and try again.' } });

router.post('/', contactLimiter, async (req, res) => {
  const { name, email, subject, message } = req.body || {};
  const clean = {
    name: String(name || '').trim(),
    email: String(email || '').trim(),
    subject: String(subject || '').trim(),
    message: String(message || '').trim(),
  };
  if (!clean.name || !clean.message) return res.status(400).json({ error: 'Name and message are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (clean.name.length > 80 || clean.subject.length > 150 || clean.message.length > 3000) {
    return res.status(400).json({ error: 'Message is too long' });
  }

  const creator = await User.findOne({ slug: config.defaultCreator });
  if (!creator) return res.status(404).json({ error: 'Page not found' });
  await ContactMessage.create({ creator: creator._id, ...clean });
  res.status(201).json({ ok: true });
});

router.get('/', requireAuth, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const filter = { creator: req.user._id };
  const [total, unread, rows] = await Promise.all([
    ContactMessage.countDocuments(filter),
    ContactMessage.countDocuments({ ...filter, read: false }),
    ContactMessage.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20),
  ]);
  res.json({
    messages: rows.map((m) => ({
      id: m._id,
      name: m.name,
      email: m.email,
      subject: m.subject,
      message: m.message,
      read: m.read,
      createdAt: m.createdAt,
    })),
    unread,
    page,
    pages: Math.max(1, Math.ceil(total / 20)),
  });
});

router.patch('/:id/read', requireAuth, async (req, res) => {
  const updated = await ContactMessage.findOneAndUpdate(
    { _id: req.params.id, creator: req.user._id },
    { read: req.body?.read !== false },
    { new: true }
  ).catch(() => null);
  if (!updated) return res.status(404).json({ error: 'Message not found' });
  res.json({ ok: true });
});

export default router;
