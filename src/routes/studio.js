import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { Support } from '../models/Support.js';
import { Account } from '../models/Account.js';
import { Post } from '../models/Post.js';
import { MembershipTier } from '../models/MembershipTier.js';
import { Membership } from '../models/Membership.js';
import { Product } from '../models/Product.js';
import { requireAuth } from '../middleware/auth.js';
import { sanitizePost, excerptOf, firstImage } from '../lib/html.js';
import { uploadFile, baseType } from '../lib/catbox.js';
import { config } from '../config.js';

const router = Router();
router.use(requireAuth);

const PAGE_SIZE = 20;
const DAY = 24 * 60 * 60 * 1000;
const validId = (id) => mongoose.isValidObjectId(id);

const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'application/zip', 'video/mp4', 'video/webm'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, UPLOAD_TYPES.includes(baseType(file.mimetype))),
});

router.post('/uploads', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload an image, PDF, ZIP or video up to 4MB' });
  const url = await uploadFile({ buffer: req.file.buffer, contentType: req.file.mimetype, prefix: 'studio' });
  res.json({ url });
});

async function emailsFor(rows, creatorEmail) {
  const ids = rows.filter((s) => s.account && s.accountKind === 'supporter').map((s) => s.account);
  const emails = new Map((await Account.find({ _id: { $in: ids } }, { email: 1 })).map((a) => [String(a._id), a.email]));
  return (s) => (s.accountKind === 'creator' ? creatorEmail : emails.get(String(s.account)) || '');
}

const txn = (s, emailOf) => ({
  id: s._id,
  type: s.type || 'tip',
  name: s.name || 'Someone',
  email: emailOf(s),
  message: s.message,
  isPrivate: s.isPrivate,
  videoUrl: s.videoUrl,
  amount: s.amount / 100,
  currency: s.currency,
  monthly: s.monthly,
  tierName: s.tierName,
  productTitle: s.productTitle,
  buyerAnswer: s.buyerAnswer,
  status: s.status,
  paymentId: s.razorpayPaymentId || '',
  subscriptionStatus: s.subscriptionStatus,
  createdAt: s.paidAt || s.createdAt,
});

router.get('/overview', async (req, res) => {
  const creator = req.user._id;
  const days = ['7', '30', '90'].includes(req.query.days) ? Number(req.query.days) : req.query.days === 'all' ? null : 30;
  const match = { creator, status: 'paid' };
  if (days) match.paidAt = { $gte: new Date(Date.now() - days * DAY) };

  const [byType, recent, supporters, members] = await Promise.all([
    Support.aggregate([{ $match: match }, { $group: { _id: { $ifNull: ['$type', 'tip'] }, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    Support.find({ creator, status: 'paid' }).sort({ paidAt: -1 }).limit(8),
    Support.distinct('account', { creator, status: 'paid' }),
    Membership.countDocuments({ creator, status: 'active' }),
  ]);
  const breakdown = { tip: 0, membership: 0, shop: 0 };
  for (const row of byType) breakdown[row._id] = row.total / 100;
  const emailOf = await emailsFor(recent, req.user.email);
  res.json({
    days: days || 'all',
    total: breakdown.tip + breakdown.membership + breakdown.shop,
    breakdown,
    supporterCount: supporters.length,
    activeMembers: members,
    recent: recent.map((s) => txn(s, emailOf)),
  });
});

router.get('/transactions', async (req, res) => {
  const creator = req.user._id;
  const status = ['paid', 'created', 'failed'].includes(req.query.status) ? req.query.status : 'paid';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const filter = { creator, status };
  if (['tip', 'membership', 'shop'].includes(req.query.type)) {
    filter.type = req.query.type === 'tip' ? { $in: ['tip', null] } : req.query.type;
  }

  const sum = async (extra) => {
    const [row] = await Support.aggregate([
      { $match: { creator, status: 'paid', ...(filter.type ? { type: filter.type } : {}), ...extra } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);
    return { total: (row?.total || 0) / 100, count: row?.count || 0 };
  };

  const [allTime, last30, people, total, rows] = await Promise.all([
    sum({}),
    sum({ paidAt: { $gte: new Date(Date.now() - 30 * DAY) } }),
    Support.distinct('account', { creator, status: 'paid', ...(filter.type ? { type: filter.type } : {}) }),
    Support.countDocuments(filter),
    Support.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE),
  ]);
  const emailOf = await emailsFor(rows, req.user.email);
  res.json({
    stats: { allTime, last30, supporters: people.length },
    transactions: rows.map((s) => txn(s, emailOf)),
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
});

function cleanCategories(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((c) => String(c).trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 10);
}

function slugify(title) {
  return (
    String(title)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'post'
  );
}

async function uniqueSlug(creator, title, excludeId) {
  const base = slugify(title);
  for (let i = 0; i < 50; i++) {
    const slug = i ? `${base}-${i + 1}` : base;
    const clash = await Post.exists({ creator, slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
    if (!clash) return slug;
  }
  return `${base}-${Date.now()}`;
}

const studioPost = (p) => ({
  id: p._id,
  slug: p.slug,
  title: p.title,
  html: p.html,
  excerpt: p.excerpt,
  visibility: p.visibility,
  categories: p.categories,
  status: p.status,
  publishedAt: p.publishedAt,
  updatedAt: p.updatedAt,
  views: p.views,
  likeCount: p.likes.length,
  commentCount: p.commentCount,
});

async function applyPost(post, body, creator) {
  const title = String(body.title ?? post.title ?? '').trim();
  if (!title) return 'Give your post a title';
  if (title.length > 150) return 'Title is too long (max 150 characters)';
  if (title !== post.title || !post.slug) post.slug = await uniqueSlug(creator, title, post._id);
  post.title = title;
  if (body.html !== undefined) {
    post.html = sanitizePost(String(body.html)).slice(0, 200000);
    post.excerpt = excerptOf(post.html);
    post.cover = firstImage(post.html);
  }
  if (body.visibility !== undefined) {
    if (!['public', 'followers', 'supporters'].includes(body.visibility)) return 'Invalid visibility';
    post.visibility = body.visibility;
  }
  if (body.categories !== undefined) post.categories = cleanCategories(body.categories);
  if (body.status !== undefined) {
    if (!['draft', 'published'].includes(body.status)) return 'Invalid status';
    if (body.status === 'published' && post.status !== 'published') post.publishedAt = new Date();
    post.status = body.status;
  }
  return null;
}

router.get('/posts', async (req, res) => {
  const posts = await Post.find({ creator: req.user._id }).sort({ updatedAt: -1 });
  const categories = [...new Set(posts.flatMap((p) => p.categories))].sort();
  res.json({ posts: posts.map(studioPost), categories });
});

router.get('/posts/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Post not found' });
  const post = await Post.findOne({ _id: req.params.id, creator: req.user._id });
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json({ post: studioPost(post) });
});

router.post('/posts', async (req, res) => {
  const post = new Post({ creator: req.user._id });
  const error = await applyPost(post, req.body || {}, req.user._id);
  if (error) return res.status(400).json({ error });
  await post.save();
  res.status(201).json({ post: studioPost(post) });
});

router.put('/posts/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Post not found' });
  const post = await Post.findOne({ _id: req.params.id, creator: req.user._id });
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const error = await applyPost(post, req.body || {}, req.user._id);
  if (error) return res.status(400).json({ error });
  await post.save();
  res.json({ post: studioPost(post) });
});

router.delete('/posts/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Post not found' });
  const result = await Post.deleteOne({ _id: req.params.id, creator: req.user._id });
  if (!result.deletedCount) return res.status(404).json({ error: 'Post not found' });
  res.json({ ok: true });
});

function readTier(body) {
  const name = String(body.name || '').trim();
  const price = Number(body.price);
  if (!name || name.length > 60) return { error: 'Give the tier a name (up to 60 characters)' };
  if (!Number.isInteger(price) || price < config.minAmount || price > config.maxAmount) return { error: 'Enter a whole-rupee monthly price' };
  const perks = (Array.isArray(body.perks) ? body.perks : String(body.perks || '').split('\n'))
    .map((p) => String(p).trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 10);
  return { value: { name, price, description: String(body.description || '').trim().slice(0, 1000), perks } };
}

router.get('/memberships', async (req, res) => {
  const creator = req.user._id;
  const [tiers, members, counts] = await Promise.all([
    MembershipTier.find({ creator }).sort({ active: -1, price: 1 }),
    Membership.find({ creator, status: { $in: ['active', 'halted', 'paused', 'cancelled'] } }).sort({ createdAt: -1 }).limit(100),
    Membership.aggregate([{ $match: { creator, status: 'active' } }, { $group: { _id: '$tier', count: { $sum: 1 }, mrr: { $sum: '$amount' } } }]),
  ]);
  const countOf = new Map(counts.map((c) => [String(c._id), c.count]));
  const supporterIds = members.filter((m) => m.accountKind === 'supporter').map((m) => m.account);
  const emails = new Map((await Account.find({ _id: { $in: supporterIds } }, { email: 1 })).map((a) => [String(a._id), a.email]));
  res.json({
    enabled: Boolean(req.user.membershipEnabled),
    monthlyIncome: counts.reduce((s, c) => s + c.mrr, 0) / 100,
    tiers: tiers.map((t) => ({ ...t.toPublic(), members: countOf.get(String(t._id)) || 0 })),
    members: members.map((m) => ({
      id: m._id,
      name: m.name,
      email: m.accountKind === 'creator' ? req.user.email : emails.get(String(m.account)) || '',
      tierName: m.tierName,
      amount: m.amount / 100,
      status: m.status,
      cancelRequested: m.cancelRequested,
      startedAt: m.startedAt || m.createdAt,
    })),
  });
});

router.put('/memberships/settings', async (req, res) => {
  req.user.membershipEnabled = Boolean(req.body?.enabled);
  await req.user.save();
  res.json({ enabled: req.user.membershipEnabled });
});

router.post('/memberships/tiers', async (req, res) => {
  const { error, value } = readTier(req.body || {});
  if (error) return res.status(400).json({ error });
  const tier = await MembershipTier.create({ creator: req.user._id, ...value });
  res.status(201).json({ tier: tier.toPublic() });
});

router.put('/memberships/tiers/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Tier not found' });
  const tier = await MembershipTier.findOne({ _id: req.params.id, creator: req.user._id });
  if (!tier) return res.status(404).json({ error: 'Tier not found' });
  if (req.body?.active !== undefined && Object.keys(req.body).length === 1) {
    tier.active = Boolean(req.body.active);
  } else {
    const { error, value } = readTier(req.body || {});
    if (error) return res.status(400).json({ error });
    if (value.price !== tier.price && (await Membership.exists({ tier: tier._id, status: 'active' }))) {
      return res.status(409).json({ error: "This tier has active members, so its price can't change. Create a new tier instead." });
    }
    Object.assign(tier, value);
  }
  await tier.save();
  res.json({ tier: tier.toPublic() });
});

router.delete('/memberships/tiers/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Tier not found' });
  const tier = await MembershipTier.findOne({ _id: req.params.id, creator: req.user._id });
  if (!tier) return res.status(404).json({ error: 'Tier not found' });
  if (await Membership.exists({ tier: tier._id })) {
    tier.active = false;
    await tier.save();
    return res.json({ archived: true });
  }
  await tier.deleteOne();
  res.json({ deleted: true });
});

const PRODUCT_KINDS = ['custom', 'digital', 'close-friends', 'call', 'ticket'];

function readProduct(body) {
  const title = String(body.title || '').trim();
  const price = Number(body.price);
  if (!title || title.length > 120) return { error: 'Give the item a title (up to 120 characters)' };
  if (!Number.isInteger(price) || price < config.minAmount || price > config.maxAmount) return { error: 'Enter a whole-rupee price' };
  const stockRaw = body.stock;
  const stock = stockRaw === '' || stockRaw === null || stockRaw === undefined ? null : Number(stockRaw);
  if (stock !== null && (!Number.isInteger(stock) || stock < 0)) return { error: 'Stock must be a whole number, or empty for unlimited' };
  const deliveryUrl = String(body.deliveryUrl || '').trim();
  if (deliveryUrl && !/^https:\/\//i.test(deliveryUrl)) return { error: 'The delivery link must start with https://' };
  const image = String(body.image || '').trim();
  if (image && !/^https:\/\//i.test(image)) return { error: 'Invalid image' };
  return {
    value: {
      kind: PRODUCT_KINDS.includes(body.kind) ? body.kind : 'custom',
      title,
      price,
      stock,
      image,
      deliveryUrl,
      description: String(body.description || '').trim().slice(0, 3000),
      question: String(body.question || '').trim().slice(0, 200),
      deliveryNote: String(body.deliveryNote || '').trim().slice(0, 2000),
    },
  };
}

router.get('/products', async (req, res) => {
  const products = await Product.find({ creator: req.user._id }).sort({ active: -1, createdAt: -1 });
  res.json({ products: products.map((p) => p.toStudio()) });
});

router.post('/products', async (req, res) => {
  const { error, value } = readProduct(req.body || {});
  if (error) return res.status(400).json({ error });
  const product = await Product.create({ creator: req.user._id, ...value });
  res.status(201).json({ product: product.toStudio() });
});

router.put('/products/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Item not found' });
  const product = await Product.findOne({ _id: req.params.id, creator: req.user._id });
  if (!product) return res.status(404).json({ error: 'Item not found' });
  if (req.body?.active !== undefined && Object.keys(req.body).length === 1) {
    product.active = Boolean(req.body.active);
  } else {
    const { error, value } = readProduct(req.body || {});
    if (error) return res.status(400).json({ error });
    Object.assign(product, value);
  }
  await product.save();
  res.json({ product: product.toStudio() });
});

router.delete('/products/:id', async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ error: 'Item not found' });
  const product = await Product.findOne({ _id: req.params.id, creator: req.user._id });
  if (!product) return res.status(404).json({ error: 'Item not found' });
  if (product.sold > 0 || (await Support.exists({ product: product._id, status: 'paid' }))) {
    product.active = false;
    await product.save();
    return res.json({ archived: true });
  }
  await product.deleteOne();
  res.json({ deleted: true });
});

export default router;
