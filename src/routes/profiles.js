import { Router } from 'express';
import { Account } from '../models/Account.js';
import { User } from '../models/User.js';
import { Support } from '../models/Support.js';
import { normalizeUsername } from '../lib/username.js';
import { optionalViewerId } from '../middleware/auth.js';

const router = Router();

router.get('/:username', async (req, res) => {
  const username = normalizeUsername(req.params.username);
  if (!username) return res.status(404).json({ error: 'Profile not found' });

  const account = await Account.findOne({ username });
  if (!account) {
    const creator = await User.findBySlug(username, { slug: 1 });
    if (creator) return res.json({ redirect: `/${creator.slug}` });
    return res.status(404).json({ error: 'Profile not found' });
  }

  const isYou = optionalViewerId(req) === String(account._id);
  const base = { username: account.username, name: account.name, isYou };
  if (account.profilePublic === false && !isYou) return res.json({ profile: { username: account.username, name: '', isYou, private: true } });

  const filter = { account: account._id, accountKind: { $ne: 'creator' }, status: 'paid' };
  const [rows, [totals]] = await Promise.all([
    Support.find(filter).sort({ paidAt: -1 }).limit(30),
    Support.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          supports: { $sum: 1 },
          total: { $sum: '$amount' },
          moments: { $sum: { $cond: [{ $gt: ['$moment', null] }, 1, 0] } },
          first: { $min: '$paidAt' },
        },
      },
    ]),
  ]);
  const creators = await User.find({ _id: { $in: [...new Set(rows.map((s) => String(s.creator)))] } }, { name: 1, slug: 1, siteName: 1, mention: 1 });
  const creatorOf = new Map(creators.map((c) => [String(c._id), { name: c.name, slug: c.slug, siteName: c.siteName || '', mention: c.mention || '' }]));

  res.json({
    profile: {
      ...base,
      bio: account.bio || '',
      private: account.profilePublic === false,
      joinedAt: account.createdAt,
      supportingSince: totals?.first || null,
    },
    stats: { supports: totals?.supports || 0, total: (totals?.total || 0) / 100, moments: totals?.moments || 0 },
    activity: rows.map((s) => ({ ...s.toPublic(), creator: creatorOf.get(String(s.creator)) || null })),
  });
});

export default router;
