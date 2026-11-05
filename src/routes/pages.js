import { Router } from 'express';
import multer from 'multer';
import sanitizeHtml from 'sanitize-html';
import { User } from '../models/User.js';
import { Support } from '../models/Support.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { uploadImage, deleteImage } from '../lib/catbox.js';

const router = Router();

const PAGE_SIZE = 5;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype));
  },
});

const sanitizeAbout = (html) =>
  sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'div'],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: { a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'nofollow noopener' }) },
  });

async function supportersPage(creatorId, before) {
  const filter = { creator: creatorId, status: 'paid' };
  if (before) filter.paidAt = { $lt: new Date(before) };
  const rows = await Support.find(filter).sort({ paidAt: -1 }).limit(PAGE_SIZE + 1);
  const hasMore = rows.length > PAGE_SIZE;
  return { supporters: rows.slice(0, PAGE_SIZE).map((s) => s.toPublic()), hasMore };
}

router.get('/default', async (req, res) => {
  const creator = await User.findOne({ slug: config.defaultCreator });
  if (!creator) return res.status(404).json({ error: 'Page not found' });
  res.json({ slug: creator.slug, creator: creator.toPublic() });
});

router.get('/:slug', async (req, res) => {
  const creator = await User.findOne({ slug: req.params.slug.toLowerCase() });
  if (!creator) return res.status(404).json({ error: 'Page not found' });
  const [page, supporterCount] = await Promise.all([
    supportersPage(creator._id),
    Support.countDocuments({ creator: creator._id, status: 'paid' }),
  ]);
  res.json({ creator: creator.toPublic(), supporterCount, ...page });
});

router.get('/:slug/supporters', async (req, res) => {
  const creator = await User.findOne({ slug: req.params.slug.toLowerCase() });
  if (!creator) return res.status(404).json({ error: 'Page not found' });
  const before = req.query.before && !Number.isNaN(Date.parse(req.query.before)) ? req.query.before : null;
  res.json(await supportersPage(creator._id, before));
});

router.put('/me', requireAuth, async (req, res) => {
  const { name, about, links, themeColor, suggestedAmounts, supportButtonText, recurringEnabled, contact } = req.body || {};
  const user = req.user;

  if (name !== undefined) {
    const v = String(name).trim();
    if (!v) return res.status(400).json({ error: 'Name is required' });
    user.name = v.slice(0, 60);
  }
  if (about !== undefined) user.about = sanitizeAbout(String(about)).slice(0, 20000);
  if (Array.isArray(links)) {
    user.links = links
      .map((l) => String(l).trim())
      .filter(Boolean)
      .map((l) => (/^https?:\/\//i.test(l) ? l : `https://${l}`))
      .slice(0, 10);
  }
  if (themeColor !== undefined) {
    if (!/^#[0-9a-f]{6}$/i.test(themeColor)) return res.status(400).json({ error: 'Invalid theme color' });
    user.themeColor = themeColor.toUpperCase();
  }
  if (Array.isArray(suggestedAmounts)) {
    const amounts = suggestedAmounts.map(Number).filter((n) => Number.isInteger(n) && n >= config.minAmount && n <= config.maxAmount);
    if (amounts.length !== 3) return res.status(400).json({ error: 'Provide 3 whole-number suggested amounts' });
    user.suggestedAmounts = amounts;
  }
  if (supportButtonText !== undefined) user.supportButtonText = String(supportButtonText).trim().slice(0, 20) || 'Support';
  if (recurringEnabled !== undefined) user.recurringEnabled = Boolean(recurringEnabled);
  if (contact && typeof contact === 'object') {
    const email = String(contact.email ?? user.contact.email).trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid contact email' });
    user.contact = {
      legalName: String(contact.legalName ?? user.contact.legalName).trim().slice(0, 100),
      email: email.slice(0, 120),
      phone: String(contact.phone ?? user.contact.phone).trim().slice(0, 30),
      address: String(contact.address ?? user.contact.address).trim().slice(0, 300),
    };
  }

  await user.save();
  res.json({ creator: user.toPublic() });
});

async function replaceImage(req, res, field) {
  if (!req.file) return res.status(400).json({ error: 'Upload a JPG, PNG, WEBP or GIF up to 4MB' });
  const url = await uploadImage({ buffer: req.file.buffer, contentType: req.file.mimetype, prefix: field });
  const old = req.user[field];
  req.user[field] = url;
  await req.user.save();
  if (old && old !== url && !(await User.exists({ $or: [{ avatar: old }, { cover: old }] }))) await deleteImage(old);
  res.json({ creator: req.user.toPublic() });
}

router.post('/me/cover', requireAuth, upload.single('cover'), (req, res) => replaceImage(req, res, 'cover'));
router.post('/me/avatar', requireAuth, upload.single('avatar'), (req, res) => replaceImage(req, res, 'avatar'));

export default router;
