import { Router } from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import { User } from '../models/User.js';
import { Post } from '../models/Post.js';
import { Comment } from '../models/Comment.js';
import { requireAccount, optionalActor } from '../middleware/auth.js';
import { canViewPost } from '../lib/access.js';

const router = Router();

const PAGE_SIZE = 12;
const commentLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please wait a few minutes and try again.' } });

async function findCreator(req, res) {
  const creator = await User.findOne({ slug: String(req.params.slug).toLowerCase() });
  if (!creator) res.status(404).json({ error: 'Page not found' });
  return creator;
}

async function findPost(req, res, creator) {
  const post = await Post.findOne({ creator: creator._id, slug: String(req.params.postSlug).toLowerCase(), status: 'published' });
  if (!post) res.status(404).json({ error: 'Post not found' });
  return post;
}

const card = (post, unlocked) => ({
  slug: post.slug,
  title: post.title,
  excerpt: unlocked ? post.excerpt : '',
  cover: unlocked ? post.cover : '',
  visibility: post.visibility,
  locked: !unlocked,
  categories: post.categories,
  publishedAt: post.publishedAt,
  views: post.views,
});

router.get('/:slug', async (req, res) => {
  const creator = await findCreator(req, res);
  if (!creator) return;
  const actor = await optionalActor(req);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const base = { creator: creator._id, status: 'published' };
  const filter = req.query.category ? { ...base, categories: String(req.query.category) } : base;

  const [rows, total, categories] = await Promise.all([
    Post.find(filter).sort({ publishedAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE),
    Post.countDocuments(filter),
    Post.aggregate([
      { $match: base },
      { $unwind: '$categories' },
      { $group: { _id: '$categories', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]),
  ]);
  const posts = await Promise.all(rows.map(async (p) => card(p, await canViewPost(p, actor))));
  res.json({
    posts,
    categories: categories.map((c) => ({ name: c._id, count: c.count })),
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
});

router.get('/:slug/:postSlug', async (req, res) => {
  const creator = await findCreator(req, res);
  if (!creator) return;
  const post = await findPost(req, res, creator);
  if (!post) return;
  const actor = await optionalActor(req);
  const unlocked = await canViewPost(post, actor);
  const isOwner = actor?.kind === 'creator' && String(actor.id) === String(creator._id);
  if (!isOwner) await Post.updateOne({ _id: post._id }, { $inc: { views: 1 } });

  res.json({
    post: {
      ...card(post, unlocked),
      html: unlocked ? post.html : '',
      views: post.views + (isOwner ? 0 : 1),
      likeCount: post.likes.length,
      liked: Boolean(actor && post.likes.some((id) => String(id) === String(actor.id))),
      commentCount: post.commentCount,
    },
  });
});

router.post('/:slug/:postSlug/like', requireAccount, async (req, res) => {
  const creator = await findCreator(req, res);
  if (!creator) return;
  const post = await findPost(req, res, creator);
  if (!post) return;
  if (!(await canViewPost(post, req.actor))) return res.status(403).json({ error: 'This post is locked' });
  const liked = post.likes.some((id) => String(id) === String(req.actor.id));
  const updated = await Post.findByIdAndUpdate(
    post._id,
    liked ? { $pull: { likes: req.actor.id } } : { $addToSet: { likes: req.actor.id } },
    { new: true }
  );
  res.json({ liked: !liked, likeCount: updated.likes.length });
});

router.get('/:slug/:postSlug/comments', async (req, res) => {
  const creator = await findCreator(req, res);
  if (!creator) return;
  const post = await findPost(req, res, creator);
  if (!post) return;
  const actor = await optionalActor(req);
  if (!(await canViewPost(post, actor))) return res.json({ comments: [], locked: true });
  const rows = await Comment.find({ post: post._id }).sort({ createdAt: 1 }).limit(200);
  const isOwner = actor?.kind === 'creator' && String(actor.id) === String(creator._id);
  res.json({
    comments: rows.map((c) => ({
      id: c._id,
      name: c.name,
      text: c.text,
      isCreator: c.actorKind === 'creator' && String(c.actor) === String(creator._id),
      canDelete: Boolean(actor && (isOwner || String(c.actor) === String(actor.id))),
      createdAt: c.createdAt,
    })),
  });
});

router.post('/:slug/:postSlug/comments', commentLimiter, requireAccount, async (req, res) => {
  const creator = await findCreator(req, res);
  if (!creator) return;
  const post = await findPost(req, res, creator);
  if (!post) return;
  if (!(await canViewPost(post, req.actor))) return res.status(403).json({ error: 'This post is locked' });
  const text = String(req.body?.text || '').trim();
  if (!text || text.length > 1000) return res.status(400).json({ error: 'Write a comment (up to 1000 characters)' });
  const comment = await Comment.create({
    post: post._id,
    actor: req.actor.id,
    actorKind: req.actor.kind,
    name: req.actor.name,
    text,
  });
  await Post.updateOne({ _id: post._id }, { $inc: { commentCount: 1 } });
  res.status(201).json({
    comment: {
      id: comment._id,
      name: comment.name,
      text: comment.text,
      isCreator: req.actor.kind === 'creator' && String(req.actor.id) === String(creator._id),
      canDelete: true,
      createdAt: comment.createdAt,
    },
  });
});

router.delete('/:slug/:postSlug/comments/:commentId', requireAccount, async (req, res) => {
  const creator = await findCreator(req, res);
  if (!creator) return;
  if (!mongoose.isValidObjectId(req.params.commentId)) return res.status(404).json({ error: 'Comment not found' });
  const comment = await Comment.findById(req.params.commentId);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  const isOwner = req.actor.kind === 'creator' && String(req.actor.id) === String(creator._id);
  if (!isOwner && String(comment.actor) !== String(req.actor.id)) return res.status(403).json({ error: 'You can only delete your own comments' });
  await comment.deleteOne();
  await Post.updateOne({ _id: comment.post, commentCount: { $gt: 0 } }, { $inc: { commentCount: -1 } });
  res.json({ ok: true });
});

export default router;
