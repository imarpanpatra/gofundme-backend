import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { User } from '../models/User.js';
import { Support } from '../models/Support.js';
import { requireAuth, optionalViewerId } from '../middleware/auth.js';
import { leaderboard, supporterList } from '../lib/hallOfFame.js';
import { config } from '../config.js';
import { uploadImage, deleteImage } from '../lib/catbox.js';
import { sanitizeAbout } from '../lib/html.js';
import { parseYouTubeId } from '../lib/youtube.js';
import { Post } from '../models/Post.js';
import { MembershipTier } from '../models/MembershipTier.js';
import { Product } from '../models/Product.js';
import { Moment } from '../models/Moment.js';
import { itineraryFor } from '../lib/moments.js';
import { withUsernames } from '../lib/profiles.js';
import { Account } from '../models/Account.js';

const router = Router();

const PAGE_SIZE = 5;

const RESERVED_SLUGS = new Set([
  'about', 'account', 'api', 'admin', 'assets', 'contact', 'dashboard', 'default', 'disclaimer', 'forgot-password', 'hall-of-fame', 'hof',
  'login', 'logout', 'privacy', 'refund-policy', 'reset-password', 'return-policy', 'shipping-policy', 'signup', 'terms',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype));
  },
});

export async function creatorPayload(creator) {
  const [posts, tiers, products, moments] = await Promise.all([
    Post.countDocuments({ creator: creator._id, status: 'published' }),
    creator.membershipEnabled ? MembershipTier.countDocuments({ creator: creator._id, active: true }) : 0,
    Product.countDocuments({ creator: creator._id, active: true }),
    Moment.countDocuments({ creator: creator._id, active: true }),
  ]);
  return { ...creator.toPublic(), tabs: { posts, membership: tiers > 0, shop: products, itinerary: moments } };
}

async function latestPosts(creatorId) {
  const rows = await Post.find({ creator: creatorId, status: 'published' }).sort({ publishedAt: -1 }).limit(2);
  return rows.map((p) => ({
    slug: p.slug,
    title: p.title,
    excerpt: p.visibility === 'public' ? p.excerpt : '',
    cover: p.visibility === 'public' ? p.cover : '',
    visibility: p.visibility,
    publishedAt: p.publishedAt,
    views: p.views,
  }));
}

async function totalRaised(creatorId) {
  const [row] = await Support.aggregate([
    { $match: { creator: creatorId, status: 'paid' } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  return (row?.total || 0) / 100;
}

async function supportersPage(creatorId, before, beforeId) {
  const filter = { creator: creatorId, status: 'paid' };
  if (before && beforeId) {
    const at = new Date(before);
    filter.$or = [{ paidAt: { $lt: at } }, { paidAt: at, _id: { $lt: new mongoose.Types.ObjectId(beforeId) } }];
  } else if (before) {
    filter.paidAt = { $lt: new Date(before) };
  }
  const rows = await Support.find(filter).sort({ paidAt: -1, _id: -1 }).limit(PAGE_SIZE + 1);
  const hasMore = rows.length > PAGE_SIZE;
  return { supporters: await withUsernames(rows.slice(0, PAGE_SIZE)), hasMore };
}

router.get('/default', async (req, res) => {
  const creator = await User.defaultCreator(config.defaultCreator);
  if (!creator) return res.status(404).json({ error: 'Page not found' });
  res.json({ slug: creator.slug, creator: await creatorPayload(creator) });
});

router.get('/:slug/profile', async (req, res) => {
  const creator = await User.findBySlug(req.params.slug);
  if (!creator) return res.status(404).json({ error: 'Page not found' });
  res.json({ creator: await creatorPayload(creator) });
});

router.get('/:slug', async (req, res) => {
  const creator = await User.findBySlug(req.params.slug);
  if (!creator) return res.status(404).json({ error: 'Page not found' });
  const [page, supporterCount, payload, posts, raised] = await Promise.all([
    supportersPage(creator._id),
    Support.countDocuments({ creator: creator._id, status: 'paid' }),
    creatorPayload(creator),
    latestPosts(creator._id),
    totalRaised(creator._id),
  ]);
  res.json({ creator: payload, supporterCount, raised, latestPosts: posts, ...page });
});

router.get('/:slug/supporters', async (req, res) => {
  const creator = await User.findBySlug(req.params.slug);
  if (!creator) return res.status(404).json({ error: 'Page not found' });
  const before = typeof req.query.before === 'string' && !Number.isNaN(Date.parse(req.query.before)) ? req.query.before : null;
  const beforeId = typeof req.query.beforeId === 'string' && mongoose.isValidObjectId(req.query.beforeId) ? req.query.beforeId : null;
  res.json(await supportersPage(creator._id, before, beforeId));
});

router.get('/:slug/itinerary', async (req, res) => {
  const creator = await User.findBySlug(req.params.slug);
  if (!creator) return res.status(404).json({ error: 'Page not found' });
  res.json({ items: await itineraryFor(creator._id) });
});

router.get('/:slug/hall-of-fame', async (req, res) => {
  const creator = await User.findBySlug(req.params.slug);
  if (!creator) return res.status(404).json({ error: 'Page not found' });
  const period = req.query.period === 'month' ? 'month' : 'all';
  res.json(await leaderboard(creator._id, { period, viewerId: optionalViewerId(req) }));
});

router.get('/:slug/hall-of-fame/supporters', async (req, res) => {
  const creator = await User.findBySlug(req.params.slug);
  if (!creator) return res.status(404).json({ error: 'Page not found' });
  const page = Math.min(1000, Math.max(1, parseInt(req.query.page, 10) || 1));
  res.json(await supporterList(creator._id, { page, viewerId: optionalViewerId(req) }));
});

router.put('/me', requireAuth, async (req, res) => {
  const { slug, name, siteName, mention, destination, seoDescription, about, links, themeColor, suggestedAmounts, supportButtonText, recurringEnabled, contact, featuredVideo, goal } = req.body || {};
  const user = req.user;

  if (name !== undefined) {
    const v = String(name).trim();
    if (!v) return res.status(400).json({ error: 'Name is required' });
    user.name = v.slice(0, 60);
  }
  if (slug !== undefined) {
    const next = String(slug).trim().toLowerCase();
    if (next !== user.slug) {
      if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(next) || next.includes('--')) {
        return res.status(400).json({ error: 'Page URL must be 3–40 characters: lowercase letters, numbers and single hyphens' });
      }
      if (RESERVED_SLUGS.has(next)) return res.status(400).json({ error: 'That page URL is reserved' });
      if ((await User.slugInUse(next, user._id)) || (await Account.exists({ username: next }))) {
        return res.status(400).json({ error: 'That page URL is taken' });
      }
      user.slug = next;
    }
  }
  if (siteName !== undefined) user.siteName = String(siteName).trim().slice(0, 40);
  if (mention !== undefined) user.mention = String(mention).trim().slice(0, 60);
  if (destination !== undefined) user.destination = String(destination).replace(/\s+/g, ' ').trim().slice(0, 40);
  if (seoDescription !== undefined) user.seoDescription = String(seoDescription).replace(/\s+/g, ' ').trim().slice(0, 160);
  if (about !== undefined) user.about = sanitizeAbout(String(about)).slice(0, 20000);
  if (Array.isArray(links)) {
    user.links = links
      .map((l) => String(l).trim())
      .filter(Boolean)
      .map((l) => (/^https?:\/\//i.test(l) ? l : `https://${l}`))
      .slice(0, 10);
  }
  if (themeColor !== undefined) {
    if (typeof themeColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(themeColor)) return res.status(400).json({ error: 'Invalid theme color' });
    user.themeColor = themeColor.toUpperCase();
  }
  if (Array.isArray(suggestedAmounts)) {
    const amounts = suggestedAmounts.map(Number).filter((n) => Number.isInteger(n) && n >= config.minAmount && n <= config.maxAmount);
    if (amounts.length !== 3) return res.status(400).json({ error: 'Provide 3 whole-number suggested amounts' });
    user.suggestedAmounts = amounts;
  }
  if (supportButtonText !== undefined) user.supportButtonText = String(supportButtonText).trim().slice(0, 20) || 'Support';
  if (recurringEnabled !== undefined) user.recurringEnabled = Boolean(recurringEnabled);
  if (featuredVideo !== undefined) {
    const id = parseYouTubeId(featuredVideo);
    if (id === null) return res.status(400).json({ error: 'Enter a valid YouTube link, or leave it empty' });
    user.featuredVideoId = id;
  }
  if (goal && typeof goal === 'object') {
    const amount = goal.amount === '' || goal.amount == null ? 0 : Number(goal.amount);
    if (!Number.isInteger(amount) || amount < 0 || amount > 100000000) {
      return res.status(400).json({ error: 'Enter the target as a whole number of rupees, up to ₹10,00,00,000' });
    }
    user.goal = {
      amount,
      title: String(goal.title ?? user.goal?.title ?? '').trim().slice(0, 80),
      raisingFor: String(goal.raisingFor ?? user.goal?.raisingFor ?? '').trim().slice(0, 120),
    };
  }
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
  res.json({ creator: await creatorPayload(user) });
});

async function replaceImage(req, res, field) {
  if (!req.file) return res.status(400).json({ error: 'Upload a JPG, PNG, WEBP or GIF up to 4MB' });
  const url = await uploadImage({ buffer: req.file.buffer, contentType: req.file.mimetype, prefix: field });
  const old = req.user[field];
  req.user[field] = url;
  await req.user.save();
  if (old && old !== url && !(await User.exists({ $or: [{ avatar: old }, { cover: old }] }))) await deleteImage(old);
  res.json({ creator: await creatorPayload(req.user) });
}

router.post('/me/cover', requireAuth, upload.single('cover'), (req, res) => replaceImage(req, res, 'cover'));
router.post('/me/avatar', requireAuth, upload.single('avatar'), (req, res) => replaceImage(req, res, 'avatar'));

export default router;
