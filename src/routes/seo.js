import { Router } from 'express';
import { User } from '../models/User.js';
import { Post } from '../models/Post.js';
import { Moment } from '../models/Moment.js';
import { MembershipTier } from '../models/MembershipTier.js';
import { Product } from '../models/Product.js';
import { config } from '../config.js';

const router = Router();

const publicOrigin = () => config.appUrl || 'https://gofundmytrip.imarpan.in';

const xmlEscape = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

const latest = (...dates) => dates.filter(Boolean).map((d) => new Date(d)).sort((a, b) => b - a)[0];

router.get('/sitemap.xml', async (req, res) => {
  const origin = publicOrigin();
  const entries = [];
  const add = (path, lastmod, priority) => entries.push({ loc: origin + path, lastmod: day(lastmod), priority });

  const [creators, allPosts, momentRows, tierRows, productRows] = await Promise.all([
    User.find({}, { slug: 1, updatedAt: 1, membershipEnabled: 1 }).sort({ createdAt: 1 }).limit(5000),
    Post.find({ status: 'published', visibility: 'public' }, { creator: 1, slug: 1, updatedAt: 1, publishedAt: 1 }).sort({ publishedAt: -1 }).limit(45000),
    Moment.aggregate([{ $match: { active: true } }, { $group: { _id: '$creator', updatedAt: { $max: '$updatedAt' } } }]),
    MembershipTier.aggregate([{ $match: { active: true } }, { $group: { _id: '$creator', n: { $sum: 1 } } }]),
    Product.aggregate([{ $match: { active: true } }, { $group: { _id: '$creator', n: { $sum: 1 } } }]),
  ]);
  const byCreator = (rows) => new Map(rows.map((r) => [String(r._id), r]));
  const moments = byCreator(momentRows);
  const tierCounts = byCreator(tierRows);
  const productCounts = byCreator(productRows);
  const postsOf = new Map();
  for (const p of allPosts) {
    const k = String(p.creator);
    if (!postsOf.has(k)) postsOf.set(k, []);
    postsOf.get(k).push(p);
  }
  for (const c of creators) {
    const id = String(c._id);
    const posts = postsOf.get(id) || [];
    const moment = moments.get(id);
    const tiers = c.membershipEnabled ? tierCounts.get(id)?.n || 0 : 0;
    const products = productCounts.get(id)?.n || 0;
    const newestPost = posts[0] && latest(posts[0].updatedAt, posts[0].publishedAt);
    add(`/${c.slug}`, latest(c.updatedAt, newestPost, moment?.updatedAt), '1.0');
    if (moment) add(`/${c.slug}/itinerary`, moment.updatedAt, '0.9');
    if (posts.length) add(`/${c.slug}/posts`, newestPost, '0.8');
    for (const p of posts) add(`/${c.slug}/posts/${p.slug}`, latest(p.updatedAt, p.publishedAt), '0.7');
    if (tiers) add(`/${c.slug}/membership`, null, '0.4');
    if (products) add(`/${c.slug}/shop`, null, '0.4');
  }
  add('/hall-of-fame', null, '0.5');
  add('/about', null, '0.3');
  add('/contact', null, '0.3');

  const body = entries
    .map((e) => `  <url><loc>${xmlEscape(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}<priority>${e.priority}</priority></url>`)
    .join('\n');
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
});

export default router;
